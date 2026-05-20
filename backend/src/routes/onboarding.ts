import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { toInputJson } from '../db/mappers';
import { BrandAccountType } from '../types';
import { sendValidationError } from '../utils/validation';

const router = Router();

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 20);
}

function parsePublicAccountType(value: unknown): BrandAccountType | null {
  if (value === 'b2b_licensed' || value === 'b2c_managed') return value;
  return null;
}

router.post('/client-signup', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.brand_memberships.length > 0) {
    res.status(409).json({
      error: 'Brand already active',
      message: 'This account is already attached to an approved brand workspace.',
    });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const contactName = cleanString(body.contact_name ?? body.contactName);
  const companyName = cleanString(body.company_name ?? body.companyName);
  const requestedAccountTypeRaw = body.requested_account_type ?? body.requestedAccountType ?? body.account_type ?? body.accountType;
  const requestedAccountType = requestedAccountTypeRaw === undefined || requestedAccountTypeRaw === null || requestedAccountTypeRaw === ''
    ? 'b2b_licensed'
    : parsePublicAccountType(requestedAccountTypeRaw);
  if (!contactName) { sendValidationError(res, 'contact_name is required'); return; }
  if (!companyName) { sendValidationError(res, 'company_name is required'); return; }
  if (!requestedAccountType) { sendValidationError(res, 'requested_account_type must be b2b_licensed or b2c_managed'); return; }

  const data = {
    userId: req.user.id,
    email: req.user.email,
    contactName,
    companyName,
    website: cleanString(body.website),
    industry: cleanString(body.industry),
    teamSize: cleanString(body.team_size ?? body.teamSize),
    socialHandles: toInputJson(body.social_handles ?? body.socialHandles ?? {}),
    goals: toInputJson(Array.isArray(body.goals) ? body.goals : []),
    requestedPlan: cleanString(body.requested_plan ?? body.requestedPlan),
    requestedAccountType,
    requestedPlatforms: cleanStringArray(body.requested_platforms ?? body.requestedPlatforms),
    billingNotes: cleanString(body.billing_notes ?? body.billingNotes),
    status: 'pending' as const,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    brandId: null,
    updatedAt: new Date(),
  };

  try {
    const pending = await prisma.clientSignupRequest.findFirst({
      where: { userId: req.user.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });

    const request = await prisma.$transaction(async tx => {
      const saved = pending
        ? await tx.clientSignupRequest.update({
            where: { requestId: pending.requestId },
            data,
          })
        : await tx.clientSignupRequest.create({
            data,
          });

      await tx.appUser.update({
        where: { userId: req.user!.id },
        data: { status: 'pending', updatedAt: new Date() },
      });

      return saved;
    });

    res.status(202).json({
      ok: true,
      status: 'pending',
      request_id: Number(request.requestId),
      requested_account_type: requestedAccountType,
      message: 'No tools or brand access is granted until a platform admin approves this request.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Client signup failed', message: (err as Error).message });
  }
});

export default router;
