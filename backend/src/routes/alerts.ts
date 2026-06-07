// src/routes/alerts.ts — Alerts Centre (PRD Tool 1 & 9)
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { canAccessBrandId, requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { getRequiredBrandId, sendServerError, sendValidationError } from '../utils/validation';

const router = Router();

type AlertRow = {
  alertId: bigint;
  brandId: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  metadata: unknown;
  status: string;
  assignedToUserId: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

function serializeAlert(a: AlertRow) {
  return {
    alert_id: Number(a.alertId),
    brand_id: a.brandId,
    type: a.type,
    severity: a.severity,
    title: a.title,
    message: a.message,
    metadata: a.metadata,
    status: a.status,
    assigned_to_user_id: a.assignedToUserId,
    acknowledged_by: a.acknowledgedBy,
    acknowledged_at: a.acknowledgedAt,
    created_at: a.createdAt,
  };
}

/** Load an alert by `:id` and verify the caller can access its brand. */
async function loadOwnedAlert(
  req: Request,
  res: Response,
): Promise<{ alertId: bigint; brandId: number } | null> {
  const alertId = getRequiredBrandId(req.params['id']);
  if (!alertId) { sendValidationError(res, 'id must be a positive integer'); return null; }

  const alert = await prisma.alert.findUnique({
    where: { alertId: BigInt(alertId) },
    select: { alertId: true, brandId: true },
  });
  if (!alert) { res.status(404).json({ error: 'Alert not found' }); return null; }
  if (!canAccessBrandId(req.user, alert.brandId)) {
    res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
    return null;
  }
  return { alertId: alert.alertId, brandId: alert.brandId };
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/:brand_id', requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
  const type = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;

  try {
    const rows = await prisma.alert.findMany({
      where: { brandId, ...(status ? { status } : {}), ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ alerts: rows.map(serializeAlert) });
  } catch (err) {
    sendServerError(res, 'Alert lookup failed', err);
  }
});

// ── ACKNOWLEDGE ───────────────────────────────────────────────────────────────
router.post('/:id/acknowledge', requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const owned = await loadOwnedAlert(req, res);
  if (!owned) return;
  try {
    const row = await prisma.alert.update({
      where: { alertId: owned.alertId },
      data: { status: 'acknowledged', acknowledgedBy: req.user?.id ?? null, acknowledgedAt: new Date() },
    });
    res.json({ ok: true, alert: serializeAlert(row) });
  } catch (err) {
    sendServerError(res, 'Alert acknowledgement failed', err);
  }
});

// ── ASSIGN ────────────────────────────────────────────────────────────────────
router.post('/:id/assign', requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const owned = await loadOwnedAlert(req, res);
  if (!owned) return;
  const body = req.body as { user_id?: string };
  try {
    const row = await prisma.alert.update({
      where: { alertId: owned.alertId },
      data: { assignedToUserId: body.user_id ?? null },
    });
    res.json({ ok: true, alert: serializeAlert(row) });
  } catch (err) {
    sendServerError(res, 'Alert assignment failed', err);
  }
});

export default router;
