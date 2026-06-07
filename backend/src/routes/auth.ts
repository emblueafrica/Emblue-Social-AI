// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import {
  getMetaAuthUrl,
  handleMetaCallback,
  getXAuthUrl,
  handleXCallback,
  getTikTokAuthUrl,
  handleTikTokCallback,
} from '../auth/platformAuth';
import { syncAllPlatforms } from '../auth/platformSync';
import { startAutomation, stopAutomation, getAutomationStatus } from '../automation/scheduler';
import prisma from '../db/prisma';
import { requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { getRequiredBrandId, isPlatform, sendServerError, sendValidationError } from '../utils/validation';

const router = Router();

router.get('/me', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const activeMembership = req.user.brand_id
    ? req.user.brand_memberships.find(item => item.brand_id === req.user!.brand_id)
    : null;

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      app_role: req.user.app_role,
      status: req.user.status,
    },
    platform_role: req.user.platform_role,
    brand_memberships: req.user.brand_memberships,
    active_brand: activeMembership ? {
      brand_id: activeMembership.brand_id,
      account_type: activeMembership.account_type,
      name: activeMembership.brand_name,
      slug: activeMembership.brand_slug,
      role: activeMembership.role,
    } : null,
    pending_signup_status: req.user.pending_signup_status ?? null,
  });
});

// ── META OAUTH ────────────────────────────────────────────────────────────────
router.get('/meta/connect', requireBrandAccess, (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  res.redirect(getMetaAuthUrl(brandId));
});

router.get('/meta/callback', (req: Request, res: Response) => {
  void handleMetaCallback(req, res);
});

// ── X OAUTH ───────────────────────────────────────────────────────────────────
router.get('/x/connect', requireBrandAccess, (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  res.redirect(getXAuthUrl(brandId));
});

router.get('/x/callback', (req: Request, res: Response) => {
  void handleXCallback(req, res);
});

// ── TIKTOK OAUTH ──────────────────────────────────────────────────────────────
router.get('/tiktok/connect', requireBrandAccess, (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  res.redirect(getTikTokAuthUrl(brandId));
});

router.get('/tiktok/callback', (req: Request, res: Response) => {
  void handleTikTokCallback(req, res);
});

// ── CONNECTIONS LIST ──────────────────────────────────────────────────────────
router.get('/connections/:brand_id', requireBrandAccess, async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.connectedAccount.findMany({
      where: { brandId },
      select: {
        platform: true,
        accountHandle: true,
        isActive: true,
        connectedAt: true,
      },
      orderBy: { connectedAt: 'desc' },
    });

    res.json({
      connections: rows.map(row => ({
        platform: row.platform,
        account_handle: row.accountHandle,
        is_active: row.isActive,
        connected_at: row.connectedAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Connection lookup failed', err);
  }
});

// ── DISCONNECT ────────────────────────────────────────────────────────────────
router.delete('/disconnect/:brand_id/:platform', requireBrandRole('client_owner'), requireBrandAccess, async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!isPlatform(req.params['platform'])) { sendValidationError(res, 'platform is invalid'); return; }

  try {
    await prisma.connectedAccount.updateMany({
      where: { brandId, platform: req.params['platform'] as never },
      data: { isActive: false, updatedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, 'Disconnect failed', err);
  }
});

// ── AUTOMATION ────────────────────────────────────────────────────────────────
router.post('/automation/start', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_1'), (req: Request, res: Response) => {
  const { brand_id } = req.body as { brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  startAutomation(brandId);
  res.json({ ok: true, message: `Automation started for brand ${brandId}` });
});

router.post('/automation/stop', requireBrandRole('client_owner'), requireBrandAccess, (req: Request, res: Response) => {
  const { brand_id } = req.body as { brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  stopAutomation(brandId);
  res.json({ ok: true, message: `Automation stopped for brand ${brandId}` });
});

router.get('/automation/status/:brand_id', requireBrandAccess, (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  const status = getAutomationStatus(brandId);
  res.json(status);
});

router.post('/automation/run-now', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const { brand_id, job } = req.body as { brand_id: number; job: string };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const result = await syncAllPlatforms(brandId);
    res.json({ ok: true, job, result });
  } catch (err) {
    sendServerError(res, 'Automation run failed', err);
  }
});

export default router;
