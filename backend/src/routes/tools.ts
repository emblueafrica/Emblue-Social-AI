import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { resolveRequestBrandId } from '../middleware/auth';
import { getBrandToolPlan, getEnabledToolIds } from '../tools/access';

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
    if (membership?.role !== 'client_owner' && !req.user?.platform_role) {
      res.json({
        enabled,
        account_type: accountType,
      });
      return;
    }

    const plan = await getBrandToolPlan(brandId);
    res.json({
      enabled,
      plan,
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
    res.status(500).json({ error: 'Tool access lookup failed', message: (err as Error).message });
  }
});

export default router;
