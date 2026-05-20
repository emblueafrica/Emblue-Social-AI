import prisma from '../db/prisma';
import { AppUserStatus, AuthBrandMembership, AuthUser, BrandAccountType, BrandRole, JwtPayload, PlatformRole, SignupStatus } from '../types';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getSuperadminEmails(): Set<string> {
  return new Set(
    (process.env.SUPERADMIN_EMAILS ?? '')
      .split(',')
      .map(email => normalizeEmail(email))
      .filter(Boolean)
  );
}

function getDisplayName(payload: JwtPayload): string | null {
  const metadata = payload.user_metadata;
  const name = metadata?.full_name ?? metadata?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function getPhone(payload: JwtPayload): string | null {
  const phone = payload.user_metadata?.phone;
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null;
}

function rankPlatformRole(email: string, roles: PlatformRole[]): PlatformRole | null {
  if (getSuperadminEmails().has(normalizeEmail(email))) return 'super_admin';
  if (roles.includes('super_admin')) return 'super_admin';
  if (roles.includes('platform_admin')) return 'platform_admin';
  return null;
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'super_admin' || value === 'platform_admin';
}

export function isBrandRole(value: unknown): value is BrandRole {
  return value === 'client_owner'
    || value === 'client_member'
    || value === 'client_viewer'
    || value === 'client_approver';
}

export async function loadAuthContext(payload: JwtPayload): Promise<AuthUser> {
  if (!payload.sub || !payload.email) {
    throw new Error('JWT is missing required identity claims');
  }

  const email = normalizeEmail(payload.email);
  const fullName = getDisplayName(payload);
  const phone = getPhone(payload);

  const appUser = await prisma.appUser.upsert({
    where: { userId: payload.sub },
    create: {
      userId: payload.sub,
      email,
      fullName,
      phone,
    },
    update: {
      email,
      fullName,
      phone,
      updatedAt: new Date(),
    },
  });

  const [platformRows, membershipRows, signupRequest] = await Promise.all([
    prisma.platformUser.findMany({
      where: { userId: payload.sub, isActive: true },
      select: { role: true },
    }),
    prisma.brandMembership.findMany({
      where: { userId: payload.sub, isActive: true },
      select: { brandId: true, role: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.clientSignupRequest.findFirst({
      where: { userId: payload.sub },
      select: { status: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const brandIds = Array.from(new Set(membershipRows.map(row => row.brandId)));
  const brandRows = brandIds.length
    ? await prisma.brand.findMany({
        where: { brandId: { in: brandIds } },
        select: {
          brandId: true,
          name: true,
          slug: true,
          accountType: true,
        },
      })
    : [];
  const brandsById = new Map(brandRows.map(row => [row.brandId, row]));

  const brandMemberships: AuthBrandMembership[] = membershipRows.map(row => {
    const brand = brandsById.get(row.brandId);
    return {
      brand_id: row.brandId,
      role: row.role as BrandRole,
      account_type: (brand?.accountType ?? 'b2b_licensed') as BrandAccountType,
      brand_name: brand?.name,
      brand_slug: brand?.slug,
    };
  });

  return {
    id: payload.sub,
    email,
    app_role: payload.role ?? 'authenticated',
    status: appUser.status as AppUserStatus,
    platform_role: rankPlatformRole(email, platformRows.map(row => row.role as PlatformRole)),
    brand_id: brandMemberships.length === 1 ? brandMemberships[0].brand_id : null,
    brand_memberships: brandMemberships,
    pending_signup_status: signupRequest?.status as SignupStatus | null ?? null,
  };
}
