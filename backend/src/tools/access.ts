import prisma from '../db/prisma';
import { ALL_TOOL_IDS, ToolId, getRequiredToolIds, isToolId } from './registry';

function uniqueToolIds(toolIds: ToolId[]): ToolId[] {
  return Array.from(new Set(toolIds));
}

export async function getEnabledToolIds(brandId: number): Promise<ToolId[]> {
  const rows = await prisma.brandToolAccess.findMany({
    where: {
      brandId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { toolId: true },
    orderBy: { toolId: 'asc' },
  });

  return rows
    .map(row => row.toolId)
    .filter(isToolId);
}

export async function getMissingToolIds(brandId: number, toolId: ToolId): Promise<ToolId[]> {
  const enabled = new Set(await getEnabledToolIds(brandId));
  return getRequiredToolIds(toolId).filter(requiredToolId => !enabled.has(requiredToolId));
}

export async function getBrandToolPlan(brandId: number): Promise<string | null> {
  const rows = await prisma.brandToolAccess.findMany({
    where: {
      brandId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { planName: true },
  });

  const plans = Array.from(new Set(rows.map(row => row.planName).filter(Boolean)));
  if (plans.length === 0) return null;
  if (plans.length === 1) return plans[0] ?? null;
  if (plans.includes('legacy')) return 'legacy';
  return 'custom';
}

export async function hasToolAccess(brandId: number, toolId: ToolId): Promise<boolean> {
  const missing = await getMissingToolIds(brandId, toolId);
  return missing.length === 0;
}

export async function provisionToolAccess(
  brandId: number,
  toolIds: ToolId[],
  planName: string,
  expiresAt: Date | null
): Promise<ToolId[]> {
  const uniqueIds = uniqueToolIds(toolIds);

  await prisma.$transaction(
    uniqueIds.map(toolId =>
      prisma.brandToolAccess.upsert({
        where: { brandId_toolId: { brandId, toolId } },
        create: {
          brandId,
          toolId,
          isActive: true,
          planName,
          expiresAt,
        },
        update: {
          isActive: true,
          planName,
          expiresAt,
          activatedAt: new Date(),
        },
      })
    )
  );

  return uniqueIds;
}

export async function replaceToolAccess(
  brandId: number,
  toolIds: ToolId[],
  planName: string | null,
  expiresAt: Date | null
): Promise<ToolId[]> {
  const uniqueIds = uniqueToolIds(toolIds);
  const enabledSet = new Set(uniqueIds);
  const now = new Date();

  await prisma.$transaction(async tx => {
    await tx.brandToolAccess.updateMany({
      where: {
        brandId,
        toolId: { notIn: uniqueIds },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    await Promise.all(uniqueIds.map(toolId =>
      tx.brandToolAccess.upsert({
        where: { brandId_toolId: { brandId, toolId } },
        create: {
          brandId,
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

    if (enabledSet.size === 0) {
      await tx.brandToolAccess.updateMany({
        where: { brandId, isActive: true },
        data: { isActive: false },
      });
    }
  });

  return uniqueIds;
}

export async function provisionFullSuite(brandId: number, planName = 'full_suite'): Promise<ToolId[]> {
  return provisionToolAccess(brandId, ALL_TOOL_IDS, planName, null);
}
