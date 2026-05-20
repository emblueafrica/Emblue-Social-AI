// src/routes/dashboard.ts
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { getRequiredBrandId, sendValidationError } from '../utils/validation';

const router = Router();

router.get('/summary', requireBrandAccess, requireToolAccess('tool_5'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const [msgs, replies, kpi] = await Promise.all([
      prisma.socialMessage.count({
        where: { brandId, capturedAt: { gt: since } },
      }),
      prisma.replySuggestion.count({
        where: { brandId, status: 'posted', createdAt: { gt: since } },
      }),
      prisma.kpiSnapshot.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        select: { listeningKpi: true, replyKpi: true, funnelKpi: true },
      }),
    ]);
    res.json({
      total_messages: msgs,
      replies_sent: replies,
      listening_kpi: kpi?.listeningKpi === null || kpi?.listeningKpi === undefined ? null : Number(kpi.listeningKpi),
      reply_kpi: kpi?.replyKpi === null || kpi?.replyKpi === undefined ? null : Number(kpi.replyKpi),
      funnel_kpi: kpi?.funnelKpi === null || kpi?.funnelKpi === undefined ? null : Number(kpi.funnelKpi),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
