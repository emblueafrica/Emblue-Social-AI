import prisma from '../db/prisma';
import { createSupabaseUser } from './supabaseAdmin';

export async function bootstrapSuperAdmin(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await prisma.appUser.findUnique({
    where: { email },
    select: { userId: true },
  });

  if (existing) {
    await prisma.platformUser.upsert({
      where: { userId_role: { userId: existing.userId, role: 'super_admin' } },
      create: {
        userId: existing.userId,
        role: 'super_admin',
        isActive: true,
      },
      update: { isActive: true },
    });
    return;
  }

  const user = await createSupabaseUser({
    email,
    password,
    fullName: 'Social Emblue AI Super Admin',
    emailConfirm: true,
  });

  await prisma.$transaction([
    prisma.appUser.create({
      data: {
        userId: user.id,
        email,
        fullName: 'Social Emblue AI Super Admin',
        status: 'active',
      },
    }),
    prisma.platformUser.create({
      data: {
        userId: user.id,
        role: 'super_admin',
        isActive: true,
      },
    }),
  ]);

  console.log('[Bootstrap] super_admin created');
}
