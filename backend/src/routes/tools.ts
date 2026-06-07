import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { resolveRequestBrandId } from '../middleware/auth';
import { getBrandToolPlan, getEnabledToolIds } from '../tools/access';
import { B2B_TOOL_PLANS } from '../tools/plans';
import { ALL_TOOL_IDS, TOOL_REGISTRY } from '../tools/registry';
import { sendServerError } from '../utils/validation';

const router = Router();

router.get('/my-access', async (req: Request, res: Response): Promise<void> => {
  const brandId = resolveRequestBrandId(req);
  if (!brandId) {
    res.status(403).json({
      error: 'Brand access required',
      message: 'This account is not attached to an approved brand workspace.',
    });
    return;
  }

  try {
    const enabled = await getEnabledToolIds(brandId);
    const membership = req.user?.brand_memberships.find(item => item.brand_id === brandId);
    const brand = membership ? null : await prisma.brand.findUnique({
      where: { brandId },
      select: { brandId: true, accountType: true, name: true, slug: true },
    });
    const accountType = membership?.account_type ?? brand?.accountType;
    const tools = ALL_TOOL_IDS.map(toolId => ({
      id: toolId,
      name: TOOL_REGISTRY[toolId].name,
      route_group: TOOL_REGISTRY[toolId].routeGroup,
      dependencies: TOOL_REGISTRY[toolId].dependencies,
      enabled: enabled.includes(toolId),
    }));
    if (membership?.role !== 'client_owner' && !req.user?.platform_role) {
      res.json({
        enabled,
        tools,
        account_type: accountType,
      });
      return;
    }

    const plan = await getBrandToolPlan(brandId);
    res.json({
      enabled,
      plan,
      plans: Object.values(B2B_TOOL_PLANS).map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        tool_ids: item.toolIds,
      })),
      tools,
      account_type: accountType,
      brand: membership ? {
        brand_id: membership.brand_id,
        name: membership.brand_name,
        slug: membership.brand_slug,
      } : brand ? {
        brand_id: brand.brandId,
        name: brand.name,
        slug: brand.slug,
      } : undefined,
    });
  } catch (err) {
    sendServerError(res, 'Tool access lookup failed', err);
  }
});

export default router;
