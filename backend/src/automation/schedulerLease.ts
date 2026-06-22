import { randomUUID } from 'node:crypto';
import prisma from '../db/prisma';

export async function withSchedulerLease<T>(
  brandId: number,
  jobType: string,
  leaseMs: number,
  task: () => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const ownerId = randomUUID();
  const leaseUntil = new Date(Date.now() + leaseMs);
  const acquired = await prisma.$executeRaw`
    INSERT INTO "scheduler_leases" ("brand_id", "job_type", "owner_id", "lease_until", "updated_at")
    VALUES (${brandId}, ${jobType}, ${ownerId}, ${leaseUntil}, CURRENT_TIMESTAMP)
    ON CONFLICT ("brand_id", "job_type") DO UPDATE
      SET "owner_id" = EXCLUDED."owner_id", "lease_until" = EXCLUDED."lease_until", "updated_at" = CURRENT_TIMESTAMP
      WHERE "scheduler_leases"."lease_until" < CURRENT_TIMESTAMP
  `;
  if (!acquired) return { acquired: false };
  try {
    return { acquired: true, value: await task() };
  } finally {
    await prisma.schedulerLease.deleteMany({ where: { brandId, jobType, ownerId } }).catch(() => undefined);
  }
}
