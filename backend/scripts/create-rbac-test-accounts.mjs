import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = process.env.RBAC_TEST_PASSWORD || 'EmblueTest#2026!';

const ALL_TOOL_IDS = [
  'tool_1',
  'tool_2',
  'tool_3',
  'tool_4',
  'tool_5',
  'tool_6',
  'tool_7',
  'tool_8',
  'tool_9',
  'tool_10',
];

const accounts = [
  {
    key: 'super_admin',
    email: 'rbac.superadmin@emblue.test',
    fullName: 'RBAC Super Admin',
    appStatus: 'active',
    platformRole: 'super_admin',
  },
  {
    key: 'platform_admin',
    email: 'rbac.platformadmin@emblue.test',
    fullName: 'RBAC Platform Admin',
    appStatus: 'active',
    platformRole: 'platform_admin',
  },
  {
    key: 'b2b_owner',
    email: 'rbac.b2b.owner@emblue.test',
    fullName: 'RBAC B2B Owner',
    appStatus: 'active',
    brand: 'b2b',
    brandRole: 'client_owner',
  },
  {
    key: 'b2b_member',
    email: 'rbac.b2b.member@emblue.test',
    fullName: 'RBAC B2B Member',
    appStatus: 'active',
    brand: 'b2b',
    brandRole: 'client_member',
  },
  {
    key: 'b2c_viewer',
    email: 'rbac.b2c.viewer@emblue.test',
    fullName: 'RBAC B2C Viewer',
    appStatus: 'active',
    brand: 'b2c',
    brandRole: 'client_viewer',
  },
  {
    key: 'b2c_approver',
    email: 'rbac.b2c.approver@emblue.test',
    fullName: 'RBAC B2C Approver',
    appStatus: 'active',
    brand: 'b2c',
    brandRole: 'client_approver',
  },
  {
    key: 'pending_client',
    email: 'rbac.pending@emblue.test',
    fullName: 'RBAC Pending Client',
    appStatus: 'pending',
    signupStatus: 'pending',
    requestedAccountType: 'b2b_licensed',
  },
  {
    key: 'suspended_client',
    email: 'rbac.suspended@emblue.test',
    fullName: 'RBAC Suspended Client',
    appStatus: 'suspended',
    brand: 'b2b',
    brandRole: 'client_owner',
  },
  {
    key: 'rejected_client',
    email: 'rbac.rejected@emblue.test',
    fullName: 'RBAC Rejected Client',
    appStatus: 'rejected',
    signupStatus: 'rejected',
    requestedAccountType: 'b2c_managed',
  },
];

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in backend/.env');
  }
}

async function supabaseAdminFetch(path, options = {}) {
  requireSupabaseConfig();

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.msg || payload?.error || payload?.message || `Supabase admin request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function findSupabaseUserByEmail(email) {
  const target = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const payload = await supabaseAdminFetch(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
    const match = users.find(user => String(user.email || '').toLowerCase() === target);
    if (match) return match;
    if (users.length < 1000) return null;
  }

  throw new Error(`Could not find ${email}; Supabase user list exceeded 20 pages`);
}

async function updateSupabaseUser(userId, account) {
  const payload = await supabaseAdminFetch(`/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    }),
  });

  return payload;
}

async function upsertSupabaseUser(account) {
  const existing = await findSupabaseUserByEmail(account.email);
  if (existing?.id) {
    await updateSupabaseUser(existing.id, account);
    return existing.id;
  }

  try {
    const created = await supabaseAdminFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: account.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      }),
    });

    if (!created?.id) throw new Error(`Supabase did not return a user id for ${account.email}`);
    return created.id;
  } catch (error) {
    const duplicate = /already|registered|exists/i.test(error.message);
    if (!duplicate) throw error;
    const user = await findSupabaseUserByEmail(account.email);
    if (!user?.id) throw error;
    await updateSupabaseUser(user.id, account);
    return user.id;
  }
}

async function upsertAppUser(account, userId) {
  return prisma.appUser.upsert({
    where: { userId },
    create: {
      userId,
      email: account.email.toLowerCase(),
      fullName: account.fullName,
      status: account.appStatus,
    },
    update: {
      email: account.email.toLowerCase(),
      fullName: account.fullName,
      status: account.appStatus,
      updatedAt: new Date(),
    },
  });
}

async function upsertPlatformRole(userId, role) {
  if (!role) return null;

  return prisma.platformUser.upsert({
    where: { userId_role: { userId, role } },
    create: {
      userId,
      role,
      isActive: true,
    },
    update: {
      isActive: true,
    },
  });
}

async function upsertBrand({ slug, name, accountType, ownerUserId, campaignObjective, tone, watchlistKeywords }) {
  return prisma.brand.upsert({
    where: { slug },
    create: {
      slug,
      name,
      accountType,
      ownerUserId,
      campaignObjective,
      tone,
      watchlistKeywords,
    },
    update: {
      name,
      accountType,
      ownerUserId,
      campaignObjective,
      tone,
      watchlistKeywords,
      updatedAt: new Date(),
    },
  });
}

async function upsertMembership(brandId, userId, role) {
  return prisma.brandMembership.upsert({
    where: { brandId_userId: { brandId, userId } },
    create: {
      brandId,
      userId,
      role,
      isActive: true,
    },
    update: {
      role,
      isActive: true,
    },
  });
}

async function replaceToolAccess(brandId, toolIds, planName) {
  const now = new Date();
  const enabled = new Set(toolIds);

  await prisma.$transaction(async tx => {
    await tx.brandToolAccess.updateMany({
      where: {
        brandId,
        toolId: { notIn: toolIds },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    await Promise.all(toolIds.map(toolId =>
      tx.brandToolAccess.upsert({
        where: { brandId_toolId: { brandId, toolId } },
        create: {
          brandId,
          toolId,
          isActive: true,
          planName,
          expiresAt: null,
        },
        update: {
          isActive: true,
          planName,
          expiresAt: null,
          activatedAt: now,
        },
      })
    ));

    if (enabled.size === 0) {
      await tx.brandToolAccess.updateMany({
        where: { brandId, isActive: true },
        data: { isActive: false },
      });
    }
  });
}

async function upsertSignupRequest(account, userId, brandId = null) {
  if (!account.signupStatus) return null;

  const existing = await prisma.clientSignupRequest.findFirst({
    where: {
      userId,
      email: account.email.toLowerCase(),
    },
    orderBy: { createdAt: 'desc' },
  });

  const data = {
    email: account.email.toLowerCase(),
    contactName: account.fullName,
    companyName: `${account.fullName} Company`,
    website: 'https://example.com',
    industry: 'RBAC QA',
    teamSize: '1-10',
    socialHandles: {},
    goals: ['RBAC test account'],
    requestedPlan: account.requestedAccountType === 'b2c_managed' ? null : 'starter',
    requestedAccountType: account.requestedAccountType,
    requestedPlatforms: ['instagram', 'facebook'],
    billingNotes: 'Generated by seed:rbac for QA only.',
    status: account.signupStatus,
    reviewedAt: account.signupStatus === 'pending' ? null : new Date(),
    rejectionReason: account.signupStatus === 'rejected' ? 'Generated rejected QA account.' : null,
    brandId,
    updatedAt: new Date(),
  };

  if (existing) {
    return prisma.clientSignupRequest.update({
      where: { requestId: existing.requestId },
      data,
    });
  }

  return prisma.clientSignupRequest.create({
    data: {
      userId,
      ...data,
    },
  });
}

async function main() {
  requireSupabaseConfig();

  const userIds = new Map();
  const results = [];

  for (const account of accounts) {
    const userId = await upsertSupabaseUser(account);
    await upsertAppUser(account, userId);
    await upsertPlatformRole(userId, account.platformRole);
    userIds.set(account.key, userId);
    results.push({ ...account, userId });
  }

  const b2bBrand = await upsertBrand({
    slug: 'rbac-b2b-test-brand',
    name: 'RBAC B2B Test Brand',
    accountType: 'b2b_licensed',
    ownerUserId: userIds.get('b2b_owner'),
    campaignObjective: 'Validate B2B licensed tool access and role enforcement.',
    tone: 'Professional',
    watchlistKeywords: ['emblue', 'rbac', 'support'],
  });

  const b2cBrand = await upsertBrand({
    slug: 'rbac-b2c-managed-brand',
    name: 'RBAC B2C Managed Brand',
    accountType: 'b2c_managed',
    ownerUserId: userIds.get('b2c_viewer'),
    campaignObjective: 'Validate read-only B2C KPI portal access.',
    tone: 'Clear',
    watchlistKeywords: ['campaign', 'client', 'report'],
  });

  for (const account of results) {
    if (account.brand === 'b2b') {
      await upsertMembership(b2bBrand.brandId, account.userId, account.brandRole);
    }
    if (account.brand === 'b2c') {
      await upsertMembership(b2cBrand.brandId, account.userId, account.brandRole);
    }
    await upsertSignupRequest(account, account.userId);
  }

  await replaceToolAccess(b2bBrand.brandId, ALL_TOOL_IDS, 'enterprise');
  await replaceToolAccess(b2cBrand.brandId, [], 'b2c_managed');

  console.log('\nRBAC test accounts are ready.');
  console.log(`Password for every account: ${TEST_PASSWORD}`);
  console.log(`B2B brand: ${b2bBrand.name} (brand_id=${b2bBrand.brandId}, plan=enterprise)`);
  console.log(`B2C brand: ${b2cBrand.name} (brand_id=${b2cBrand.brandId}, read-only portal)`);
  console.log('\nAccounts:');
  for (const account of results) {
    const role = account.platformRole || account.brandRole || account.signupStatus || account.appStatus;
    const surface = account.platformRole
      ? 'Admin console'
      : account.brand === 'b2b'
        ? 'B2B workspace'
        : account.brand === 'b2c'
          ? 'B2C portal'
          : 'Status flow';
    console.log(`- ${account.email} | ${role} | ${surface}`);
  }
}

main()
  .catch(error => {
    console.error(`RBAC seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
