import { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { PlatformRole } from '../types';

type AuditClient = typeof prisma | Prisma.TransactionClient;

interface AuditLogInput {
  req?: Request;
  tx?: AuditClient;
  action: string;
  resourceType: string;
  resourceId?: string | number | bigint | null;
  brandId?: number | null;
  targetUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value.join(', ') : value;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const actor = input.req?.user;
  const client = input.tx ?? prisma;

  await client.auditLog.create({
    data: {
      actorUserId: actor?.id ?? null,
      actorPlatformRole: (actor?.platform_role ?? null) as PlatformRole | null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId === null || input.resourceId === undefined ? null : String(input.resourceId),
      brandId: input.brandId ?? null,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.req?.ip ?? null,
      userAgent: headerValue(input.req?.headers['user-agent']),
    },
  });
}
