import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '../audit/service';
import prisma from '../db/prisma';
import { createSupabaseUser } from '../auth/supabaseAdmin';
import { requirePlatformRole } from '../middleware/auth';
import { provisionToolAccess } from '../tools/access';
import {
  B2B_TOOL_PLANS,
  B2BPlanId,
  getDefaultToolIdsForAccountType,
  getPlanDefinition,
  isB2BPlanId,
  parseToolIdList,
  resolveProvisioningToolIds,
} from '../tools/plans';
import { isToolId, ToolId } from '../tools/registry';
import { BrandAccountType, BrandRole } from '../types';
import { sendPlatformAdminCreatedEmail, sendSignupApprovedEmail, sendSignupRejectedEmail } from '../utils/email';
import { getRequiredBrandId, sendServerError, sendValidationError } from '../utils/validation';

const router = Router();

type SignupRequestRow = Prisma.ClientSignupRequestGetPayload<Record<string, never>>;

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseExpiresAt(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === '') return null;

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseRequestId(value: unknown): bigint | null {
  const parsed = getRequiredBrandId(value);
  return parsed ? BigInt(parsed) : null;
}

function parseToolIds(value: unknown): ToolId[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const toolIds: ToolId[] = [];
  for (const toolId of value) {
    if (!isToolId(toolId)) return null;
    toolIds.push(toolId);
  }
  return Array.from(new Set(toolIds));
}

function parseOptionalToolIds(value: unknown): ToolId[] | null | undefined {
  if (value === null || value === undefined) return null;
  const parsed = parseToolIdList(value);
  return parsed ?? undefined;
}

function parseOptionalPlanId(value: unknown): B2BPlanId | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return isB2BPlanId(value) ? value : undefined;
}

function parseOptionalAccountType(value: unknown): BrandAccountType | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (value === 'b2b_licensed' || value === 'b2c_managed' || value === 'internal') return value;
  return undefined;
}

function parseOptionalBrandRole(value: unknown): BrandRole | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (value === 'client_owner' || value === 'client_member' || value === 'client_viewer' || value === 'client_approver') return value;
  return undefined;
}

function defaultClientRoleForAccountType(accountType: BrandAccountType): BrandRole {
  return accountType === 'b2b_licensed' ? 'client_owner' : 'client_viewer';
}

function isClientRoleAllowedForAccountType(role: BrandRole, accountType: BrandAccountType): boolean {
  if (accountType === 'b2b_licensed') return role === 'client_owner' || role === 'client_member';
  if (accountType === 'b2c_managed') return role === 'client_viewer' || role === 'client_approver';
  return role === 'client_viewer';
}

function parseWatchlistKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 50);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function getUniqueBrandSlug(baseValue: string): Promise<string> {
  const base = slugify(baseValue) || `brand-${Date.now()}`;
  for (let index = 0; index < 25; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.brand.findUnique({ where: { slug }, select: { brandId: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

function signupRequestJson(row: SignupRequestRow) {
  return {
    request_id: Number(row.requestId),
    user_id: row.userId,
    email: row.email,
    contact_name: row.contactName,
    company_name: row.companyName,
    website: row.website,
    industry: row.industry,
    team_size: row.teamSize,
    social_handles: row.socialHandles,
    goals: row.goals,
    requested_plan: row.requestedPlan,
    requested_account_type: row.requestedAccountType,
    requested_platforms: row.requestedPlatforms,
    billing_notes: row.billingNotes,
    status: row.status,
    reviewed_by: row.reviewedBy,
    reviewed_at: row.reviewedAt,
    rejection_reason: row.rejectionReason,
    brand_id: row.brandId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function assertCanManageUserLifecycle(req: Request, res: Response, userId: string): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (userId === req.user.id) {
    res.status(400).json({ error: 'Invalid operation', message: 'Cannot suspend your own account' });
    return false;
  }

  const targetPlatformRoles = await prisma.platformUser.findMany({
    where: { userId, isActive: true },
    select: { role: true },
  });
  if (targetPlatformRoles.some(row => row.role === 'super_admin')) {
    res.status(403).json({ error: 'Forbidden', message: 'Cannot manage super_admin accounts with lifecycle routes' });
    return false;
  }

  return true;
}

router.get('/users', requirePlatformRole('super_admin', 'platform_admin'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.appUser.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const userIds = users.map(user => user.userId);
    const [platformRows, membershipRows] = await Promise.all([
      prisma.platformUser.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, role: true, isActive: true },
      }),
      prisma.brandMembership.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, brandId: true, role: true, isActive: true },
      }),
    ]);

    res.json({
      users: users.map(user => ({
        user_id: user.userId,
        email: user.email,
        full_name: user.fullName,
        phone: user.phone,
        status: user.status,
        platform_roles: platformRows
          .filter(row => row.userId === user.userId && row.isActive)
          .map(row => row.role),
        brand_memberships: membershipRows
          .filter(row => row.userId === user.userId && row.isActive)
          .map(row => ({
            brand_id: row.brandId,
            role: row.role,
          })),
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'User lookup failed', err);
  }
});

router.get('/audit-logs', requirePlatformRole('super_admin'), async (req: Request, res: Response): Promise<void> => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  const targetUserId = cleanString(req.query['target_user_id'] ?? req.query['targetUserId']);
  const action = cleanString(req.query['action']);
  const takeRaw = Number(req.query['limit'] ?? 100);
  const take = Number.isInteger(takeRaw) && takeRaw > 0 ? Math.min(takeRaw, 200) : 100;

  try {
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(brandId ? { brandId } : {}),
        ...(targetUserId ? { targetUserId } : {}),
        ...(action ? { action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.json({
      audit_logs: rows.map(row => ({
        audit_id: Number(row.auditId),
        actor_user_id: row.actorUserId,
        actor_platform_role: row.actorPlatformRole,
        action: row.action,
        resource_type: row.resourceType,
        resource_id: row.resourceId,
        brand_id: row.brandId,
        target_user_id: row.targetUserId,
        metadata: row.metadata,
        ip_address: row.ipAddress,
        user_agent: row.userAgent,
        created_at: row.createdAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Audit log lookup failed', err);
  }
});

router.get('/signup-requests', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  const status = cleanString(req.query['status']);
  const where = status && ['pending', 'approved', 'rejected'].includes(status)
    ? { status: status as 'pending' | 'approved' | 'rejected' }
    : {};

  try {
    const rows = await prisma.clientSignupRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ requests: rows.map(signupRequestJson) });
  } catch (err) {
    sendServerError(res, 'Signup request lookup failed', err);
  }
});

router.get('/plans', requirePlatformRole('super_admin', 'platform_admin'), (_req: Request, res: Response): void => {
  res.json({
    plans: Object.values(B2B_TOOL_PLANS).map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      tool_ids: resolveProvisioningToolIds(plan.id),
    })),
  });
});

router.get('/brands', requirePlatformRole('super_admin', 'platform_admin'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const brands = await prisma.brand.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const brandIds = brands.map(brand => brand.brandId);
    const [memberships, toolRows] = await Promise.all([
      prisma.brandMembership.findMany({
        where: { brandId: { in: brandIds }, isActive: true },
        select: { brandId: true, userId: true, role: true },
      }),
      prisma.brandToolAccess.findMany({
        where: { brandId: { in: brandIds }, isActive: true },
        select: { brandId: true, toolId: true, planName: true, expiresAt: true },
      }),
    ]);

    res.json({
      brands: brands.map(brand => {
        const brandTools = toolRows.filter(row => row.brandId === brand.brandId);
        const plans = Array.from(new Set(brandTools.map(row => row.planName).filter(Boolean)));
        return {
          brand_id: brand.brandId,
          name: brand.name,
          slug: brand.slug,
          account_type: brand.accountType,
          campaign_objective: brand.campaignObjective,
          tone: brand.tone,
          owner_user_id: brand.ownerUserId,
          members: memberships
            .filter(row => row.brandId === brand.brandId)
            .map(row => ({ user_id: row.userId, role: row.role })),
          enabled_tools: brandTools.map(row => row.toolId).filter(isToolId),
          plan: plans.length === 1 ? plans[0] : plans.length > 1 ? 'custom' : null,
          created_at: brand.createdAt,
          updated_at: brand.updatedAt,
        };
      }),
    });
  } catch (err) {
    sendServerError(res, 'Brand lookup failed', err);
  }
});

router.post('/signup-requests/:request_id/approve', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const requestId = parseRequestId(req.params['request_id']);
  if (!requestId) { sendValidationError(res, 'request_id must be a positive integer'); return; }

  const body = req.body as Record<string, unknown>;
  const planId = parseOptionalPlanId(body.plan_id ?? body.planId ?? body.plan_name ?? body.planName);
  if (planId === undefined) { sendValidationError(res, 'plan_id must be starter, growth, or enterprise'); return; }
  const extraToolIds = parseOptionalToolIds(body.tool_ids ?? body.toolIds);
  if (extraToolIds === undefined) { sendValidationError(res, 'tool_ids must be an array of valid tool IDs'); return; }

  const expiresAt = parseExpiresAt(body.expires_at ?? body.expiresAt);
  if (expiresAt === undefined) { sendValidationError(res, 'expires_at must be a valid date or null'); return; }

  const accountTypeOverride = parseOptionalAccountType(body.account_type ?? body.accountType);
  if (accountTypeOverride === undefined) {
    sendValidationError(res, 'account_type must be b2b_licensed, b2c_managed, or internal');
    return;
  }

  const membershipRoleOverride = parseOptionalBrandRole(body.membership_role ?? body.membershipRole ?? body.client_role ?? body.clientRole);
  if (membershipRoleOverride === undefined) {
    sendValidationError(res, 'membership_role must be client_owner, client_member, client_viewer, or client_approver');
    return;
  }

  try {
    const signupRequest = await prisma.clientSignupRequest.findUnique({ where: { requestId } });
    if (!signupRequest) { res.status(404).json({ error: 'Signup request not found' }); return; }
    if (signupRequest.status !== 'pending') {
      res.status(409).json({ error: 'Signup request already reviewed', status: signupRequest.status });
      return;
    }

    const accountType = accountTypeOverride ?? signupRequest.requestedAccountType as BrandAccountType;
    if (accountType === 'internal' && req.user.platform_role !== 'super_admin') {
      res.status(403).json({ error: 'Forbidden', message: 'Only super_admin can approve internal workspaces' });
      return;
    }

    const membershipRole = membershipRoleOverride ?? defaultClientRoleForAccountType(accountType);
    if (!isClientRoleAllowedForAccountType(membershipRole, accountType)) {
      sendValidationError(res, `membership_role ${membershipRole} is not allowed for account_type ${accountType}`);
      return;
    }
    const effectivePlanId = planId ?? 'starter';
    const plan = getPlanDefinition(effectivePlanId);
    const planName = accountType === 'b2c_managed' ? 'b2c_managed' : plan?.id ?? 'starter';
    const toolIds = getDefaultToolIdsForAccountType(accountType, effectivePlanId, extraToolIds ?? []);

    const slug = await getUniqueBrandSlug(cleanString(body.brand_slug ?? body.brandSlug) ?? signupRequest.companyName);
    const now = new Date();
    const brand = await prisma.$transaction(async tx => {
      const createdBrand = await tx.brand.create({
        data: {
          name: signupRequest.companyName,
          slug,
          accountType,
          campaignObjective: cleanString(body.campaign_objective ?? body.campaignObjective) ?? 'brand awareness',
          tone: cleanString(body.tone) ?? 'professional and friendly',
          watchlistKeywords: parseWatchlistKeywords(body.watchlist_keywords ?? body.watchlistKeywords),
          ownerUserId: signupRequest.userId,
        },
      });

      await tx.brandMembership.upsert({
        where: { brandId_userId: { brandId: createdBrand.brandId, userId: signupRequest.userId } },
        create: {
          brandId: createdBrand.brandId,
          userId: signupRequest.userId,
          role: membershipRole,
          isActive: true,
          createdBy: req.user!.id,
        },
        update: {
          role: membershipRole,
          isActive: true,
          createdBy: req.user!.id,
        },
      });

      await tx.appUser.update({
        where: { userId: signupRequest.userId },
        data: { status: 'active', updatedAt: now },
      });

      await Promise.all(toolIds.map(toolId =>
        tx.brandToolAccess.upsert({
          where: { brandId_toolId: { brandId: createdBrand.brandId, toolId } },
          create: {
            brandId: createdBrand.brandId,
            toolId,
            isActive: true,
            planName,
            expiresAt,
          },
          update: {
            isActive: true,
            planName,
            expiresAt,
            activatedAt: now,
          },
        })
      ));

      await tx.clientSignupRequest.update({
        where: { requestId },
        data: {
          status: 'approved',
          reviewedBy: req.user!.id,
          reviewedAt: now,
          rejectionReason: null,
          brandId: createdBrand.brandId,
          updatedAt: now,
        },
      });

      await writeAuditLog({
        req,
        tx,
        action: 'signup_request.approved',
        resourceType: 'client_signup_request',
        resourceId: requestId,
        brandId: createdBrand.brandId,
        targetUserId: signupRequest.userId,
        metadata: {
          account_type: accountType,
          membership_role: membershipRole,
          plan_name: planName,
          tool_ids: toolIds,
          expires_at: expiresAt?.toISOString() ?? null,
        },
      });

      return createdBrand;
    });

    const provisioned = toolIds;
    void sendSignupApprovedEmail(signupRequest.email, brand.name);

    res.json({
      ok: true,
      request_id: Number(requestId),
      brand_id: brand.brandId,
      account_type: accountType,
      membership_role: membershipRole,
      plan_name: planName,
      provisioned: provisioned.length,
      enabled: provisioned,
    });
  } catch (err) {
    sendServerError(res, 'Signup approval failed', err);
  }
});

router.post('/signup-requests/:request_id/reject', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const requestId = parseRequestId(req.params['request_id']);
  if (!requestId) { sendValidationError(res, 'request_id must be a positive integer'); return; }

  const reason = cleanString((req.body as Record<string, unknown>).reason ?? (req.body as Record<string, unknown>).rejection_reason) ?? 'Rejected by platform admin';

  try {
    const request = await prisma.$transaction(async tx => {
      const updated = await tx.clientSignupRequest.update({
        where: { requestId },
        data: {
          status: 'rejected',
          reviewedBy: req.user!.id,
          reviewedAt: new Date(),
          rejectionReason: reason,
          updatedAt: new Date(),
        },
      });

      await tx.appUser.update({
        where: { userId: updated.userId },
        data: { status: 'rejected', updatedAt: new Date() },
      });

      await writeAuditLog({
        req,
        tx,
        action: 'signup_request.rejected',
        resourceType: 'client_signup_request',
        resourceId: requestId,
        targetUserId: updated.userId,
        metadata: {
          reason,
        },
      });

      return updated;
    });
    void sendSignupRejectedEmail(request.email, reason);
    res.json({ ok: true, request: signupRequestJson(request) });
  } catch (err) {
    sendServerError(res, 'Signup rejection failed', err);
  }
});

router.post('/platform-admins', requirePlatformRole('super_admin'), async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const body = req.body as Record<string, unknown>;
  let userId = cleanString(body.user_id ?? body.userId);
  const email = cleanString(body.email);
  const fullName = cleanString(body.full_name ?? body.fullName);
  const password = cleanString(body.password);
  if (!email) { sendValidationError(res, 'email is required'); return; }

  try {
    let temporaryPassword: string | undefined;
    if (!userId) {
      if (!password) {
        sendValidationError(res, 'password is required when user_id is not provided');
        return;
      }
      const supabaseUser = await createSupabaseUser({
        email: email.toLowerCase(),
        password,
        fullName,
        emailConfirm: true,
      });
      userId = supabaseUser.id;
      temporaryPassword = password;
    }
    if (!userId) {
      sendServerError(res, 'Platform admin creation failed');
      return;
    }
    const platformAdminUserId = userId;

    await prisma.$transaction(async tx => {
      await tx.appUser.upsert({
        where: { userId: platformAdminUserId },
        create: { userId: platformAdminUserId, email: email.toLowerCase(), fullName, status: 'active' },
        update: { email: email.toLowerCase(), fullName, status: 'active', updatedAt: new Date() },
      });

      await tx.platformUser.upsert({
        where: { userId_role: { userId: platformAdminUserId, role: 'platform_admin' } },
        create: {
          userId: platformAdminUserId,
          role: 'platform_admin',
          isActive: true,
          createdBy: req.user!.id,
        },
        update: {
          isActive: true,
          createdBy: req.user!.id,
        },
      });

      await writeAuditLog({
        req,
        tx,
        action: 'platform_admin.granted',
        resourceType: 'platform_user',
        targetUserId: platformAdminUserId,
        metadata: {
          email: email.toLowerCase(),
          created_supabase_user: Boolean(temporaryPassword),
        },
      });
    });

    void sendPlatformAdminCreatedEmail(email.toLowerCase(), temporaryPassword);
    res.json({ ok: true, user_id: platformAdminUserId, role: 'platform_admin', is_active: true });
  } catch (err) {
    sendServerError(res, 'Platform admin creation failed', err);
  }
});

router.post('/users/:user_id/suspend', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  const userId = cleanString(req.params['user_id']);
  if (!userId) { sendValidationError(res, 'user_id is required'); return; }

  try {
    if (!await assertCanManageUserLifecycle(req, res, userId)) return;
    await prisma.$transaction(async tx => {
      await tx.appUser.update({
        where: { userId },
        data: { status: 'suspended', updatedAt: new Date() },
      });
      await writeAuditLog({
        req,
        tx,
        action: 'user.suspended',
        resourceType: 'app_user',
        targetUserId: userId,
      });
    });
    res.json({ ok: true, user_id: userId, status: 'suspended' });
  } catch (err) {
    sendServerError(res, 'User suspension failed', err);
  }
});

router.post('/users/:user_id/activate', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  const userId = cleanString(req.params['user_id']);
  if (!userId) { sendValidationError(res, 'user_id is required'); return; }

  try {
    if (!await assertCanManageUserLifecycle(req, res, userId)) return;
    await prisma.$transaction(async tx => {
      await tx.appUser.update({
        where: { userId },
        data: { status: 'active', updatedAt: new Date() },
      });
      await writeAuditLog({
        req,
        tx,
        action: 'user.activated',
        resourceType: 'app_user',
        targetUserId: userId,
      });
    });
    res.json({ ok: true, user_id: userId, status: 'active' });
  } catch (err) {
    sendServerError(res, 'User activation failed', err);
  }
});

router.delete('/platform-admins/:user_id', requirePlatformRole('super_admin'), async (req: Request, res: Response): Promise<void> => {
  const userId = cleanString(req.params['user_id']);
  if (!userId) { sendValidationError(res, 'user_id is required'); return; }

  try {
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.platformUser.updateMany({
        where: { userId, role: 'platform_admin' },
        data: { isActive: false },
      });
      await writeAuditLog({
        req,
        tx,
        action: 'platform_admin.deactivated',
        resourceType: 'platform_user',
        targetUserId: userId,
        metadata: { deactivated: updated.count },
      });
      return updated;
    });
    res.json({ ok: true, user_id: userId, deactivated: result.count });
  } catch (err) {
    sendServerError(res, 'Platform admin removal failed', err);
  }
});

router.post('/provision', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  const { brand_id, tool_ids, plan_name, expires_at } = req.body as {
    brand_id?: unknown;
    tool_ids?: unknown;
    plan_name?: unknown;
    expires_at?: unknown;
  };

  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const toolIds = parseToolIds(tool_ids);
  if (!toolIds) {
    sendValidationError(res, 'tool_ids must be a non-empty array of valid tool IDs');
    return;
  }

  const expiresAt = parseExpiresAt(expires_at);
  if (expiresAt === undefined) {
    sendValidationError(res, 'expires_at must be a valid date or null');
    return;
  }

  const planName = cleanString(plan_name);
  if (!planName) {
    sendValidationError(res, 'plan_name is required');
    return;
  }

  try {
    const provisioned = await provisionToolAccess(brandId, toolIds, planName, expiresAt);
    await writeAuditLog({
      req,
      action: 'brand_tools.provisioned',
      resourceType: 'brand',
      resourceId: brandId,
      brandId,
      metadata: {
        plan_name: planName,
        tool_ids: provisioned,
        expires_at: expiresAt?.toISOString() ?? null,
      },
    });
    res.json({ ok: true, brand_id: brandId, provisioned: provisioned.length, enabled: provisioned });
  } catch (err) {
    sendServerError(res, 'Provisioning failed', err);
  }
});

router.put('/brands/:brand_id/access', requirePlatformRole('super_admin', 'platform_admin'), async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const body = req.body as Record<string, unknown>;
  const accountType = parseOptionalAccountType(body.account_type ?? body.accountType);
  if (accountType === undefined || accountType === null) {
    sendValidationError(res, 'account_type must be b2b_licensed, b2c_managed, or internal');
    return;
  }
  if (accountType === 'internal' && req.user.platform_role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden', message: 'Only super_admin can assign internal workspaces' });
    return;
  }

  const planId = parseOptionalPlanId(body.plan_id ?? body.planId ?? body.plan_name ?? body.planName);
  if (planId === undefined) {
    sendValidationError(res, 'plan_id must be starter, growth, or enterprise');
    return;
  }
  const extraToolIds = parseOptionalToolIds(body.tool_ids ?? body.toolIds);
  if (extraToolIds === undefined) {
    sendValidationError(res, 'tool_ids must be an array of valid tool IDs');
    return;
  }

  const effectivePlanId = planId ?? 'starter';
  const planName = accountType === 'b2c_managed' ? 'b2c_managed' : effectivePlanId;
  const enabled = getDefaultToolIdsForAccountType(accountType, effectivePlanId, extraToolIds ?? []);

  try {
    const brand = await prisma.$transaction(async tx => {
      const updatedBrand = await tx.brand.update({
        where: { brandId },
        data: {
          accountType,
          updatedAt: new Date(),
        },
      });

      await tx.brandToolAccess.updateMany({
        where: {
          brandId,
          toolId: { notIn: enabled },
          isActive: true,
        },
        data: { isActive: false },
      });

      await Promise.all(enabled.map(toolId =>
        tx.brandToolAccess.upsert({
          where: { brandId_toolId: { brandId, toolId } },
          create: { brandId, toolId, isActive: true, planName, expiresAt: null },
          update: { isActive: true, planName, expiresAt: null, activatedAt: new Date() },
        })
      ));

      if (!enabled.length) {
        await tx.brandToolAccess.updateMany({
          where: { brandId, isActive: true },
          data: { isActive: false },
        });
      }

      await writeAuditLog({
        req,
        tx,
        action: 'brand_access.updated',
        resourceType: 'brand',
        resourceId: brandId,
        brandId,
        metadata: {
          account_type: accountType,
          plan_name: planName,
          enabled_tools: enabled,
        },
      });

      return updatedBrand;
    });

    res.json({
      ok: true,
      brand_id: brand.brandId,
      account_type: brand.accountType,
      plan: planName,
      enabled,
    });
  } catch (err) {
    sendServerError(res, 'Brand access update failed', err);
  }
});

export default router;
