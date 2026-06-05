// src/routes/funnels.ts — Comment → DM Funnel (PRD Tool 4)
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { canAccessBrandId, requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { runFunnel } from '../stream/funnelRunner';
import { getRequiredBrandId, isPlatform, requireNonEmptyString, sendValidationError } from '../utils/validation';

const router = Router();

type FunnelRow = {
  funnelId: bigint;
  brandId: number | null;
  name: string | null;
  platform: string | null;
  keywords: string[];
  triggerActions: string[];
  maxPerHour: number | null;
  delaySec: number | null;
  destUrl: string | null;
  isActive: boolean | null;
  createdAt: Date;
};

function serializeFunnel(f: FunnelRow) {
  return {
    funnel_id: Number(f.funnelId),
    brand_id: f.brandId,
    name: f.name,
    platform: f.platform,
    keywords: f.keywords,
    trigger_actions: f.triggerActions,
    max_per_hour: f.maxPerHour,
    delay_sec: f.delaySec,
    dest_url: f.destUrl,
    is_active: f.isActive,
    created_at: f.createdAt,
  };
}

/** Load a funnel by `:id` and verify the caller can access its brand. */
async function loadOwnedFunnel(
  req: Request,
  res: Response,
): Promise<{ funnelId: bigint; brandId: number } | null> {
  const funnelId = getRequiredBrandId(req.params['id']);
  if (!funnelId) { sendValidationError(res, 'id must be a positive integer'); return null; }

  const funnel = await prisma.funnel.findUnique({
    where: { funnelId: BigInt(funnelId) },
    select: { funnelId: true, brandId: true },
  });
  if (!funnel || !funnel.brandId) { res.status(404).json({ error: 'Funnel not found' }); return null; }
  if (!canAccessBrandId(req.user, funnel.brandId)) {
    res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
    return null;
  }
  return { funnelId: funnel.funnelId, brandId: funnel.brandId };
}

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id: number; name?: string; platform?: string; keywords?: string[];
    trigger_actions?: string[]; max_per_hour?: number; delay_sec?: number;
    dest_url?: string; is_active?: boolean;
  };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (body.platform && !isPlatform(body.platform)) { sendValidationError(res, 'platform is invalid'); return; }

  try {
    const row = await prisma.funnel.create({
      data: {
        brandId,
        name: body.name?.trim() || 'Untitled funnel',
        platform: body.platform ? (body.platform as never) : null,
        keywords: body.keywords ?? [],
        triggerActions: body.trigger_actions ?? [],
        maxPerHour: body.max_per_hour ?? 20,
        delaySec: body.delay_sec ?? 30,
        destUrl: body.dest_url ?? null,
        isActive: body.is_active ?? false,
      },
    });
    res.json({ ok: true, funnel: serializeFunnel(row) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/:brand_id', requireBrandAccess, requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try {
    const rows = await prisma.funnel.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' } });
    res.json({ funnels: rows.map(serializeFunnel) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── TRIGGERS ──────────────────────────────────────────────────────────────────
router.post('/:id/triggers', requireBrandRole('client_owner'), requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  const body = req.body as { keywords?: string[]; trigger_actions?: string[] };
  try {
    const row = await prisma.funnel.update({
      where: { funnelId: owned.funnelId },
      data: {
        ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
        ...(body.trigger_actions !== undefined ? { triggerActions: body.trigger_actions } : {}),
      },
    });
    res.json({ ok: true, funnel: serializeFunnel(row) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── DM TEMPLATES ──────────────────────────────────────────────────────────────
router.post('/:id/templates', requireBrandRole('client_owner'), requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  const body = req.body as { name?: string; body?: string; cta_link?: string };
  if (!requireNonEmptyString(body.name)) { sendValidationError(res, 'name is required'); return; }
  if (!requireNonEmptyString(body.body)) { sendValidationError(res, 'body is required'); return; }
  try {
    const row = await prisma.dmTemplate.create({
      data: {
        brandId: owned.brandId,
        funnelId: owned.funnelId,
        name: body.name.trim(),
        body: body.body,
        ctaLink: body.cta_link ?? null,
      },
    });
    res.json({
      ok: true,
      template: {
        template_id: Number(row.templateId),
        funnel_id: Number(owned.funnelId),
        name: row.name,
        body: row.body,
        cta_link: row.ctaLink,
        is_active: row.isActive,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id/templates', requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  try {
    const rows = await prisma.dmTemplate.findMany({
      where: { funnelId: owned.funnelId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      templates: rows.map(t => ({
        template_id: Number(t.templateId),
        name: t.name,
        body: t.body,
        cta_link: t.ctaLink,
        is_active: t.isActive,
        created_at: t.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── RUN ───────────────────────────────────────────────────────────────────────
router.post('/:id/run', requireBrandRole('client_owner'), requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  try {
    const result = await runFunnel(Number(owned.funnelId));
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── TOGGLE ────────────────────────────────────────────────────────────────────
router.post('/:id/toggle', requireBrandRole('client_owner'), requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  try {
    const current = await prisma.funnel.findUnique({
      where: { funnelId: owned.funnelId },
      select: { isActive: true },
    });
    const row = await prisma.funnel.update({
      where: { funnelId: owned.funnelId },
      data: { isActive: !(current?.isActive ?? false) },
      select: { funnelId: true, isActive: true },
    });
    res.json({ ok: true, funnel_id: Number(row.funnelId), is_active: row.isActive });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── METRICS ───────────────────────────────────────────────────────────────────
router.get('/:id/metrics', requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  try {
    const events = await prisma.dmEvent.findMany({
      where: { funnelId: owned.funnelId },
      select: { status: true, dmSentAt: true, openedAt: true, clickedAt: true, converted: true },
    });
    res.json({
      funnel_id: Number(owned.funnelId),
      metrics: {
        total: events.length,
        queued: events.filter(e => e.status === 'queued').length,
        sent: events.filter(e => e.dmSentAt !== null).length,
        opened: events.filter(e => e.openedAt !== null).length,
        clicked: events.filter(e => e.clickedAt !== null).length,
        converted: events.filter(e => e.converted === true).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── DM EVENTS (Funnel Performance feed) ───────────────────────────────────────
router.get('/:id/events', requireToolAccess('tool_4'), async (req: Request, res: Response) => {
  const owned = await loadOwnedFunnel(req, res);
  if (!owned) return;
  try {
    const rows = await prisma.dmEvent.findMany({
      where: { funnelId: owned.funnelId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      events: rows.map(e => ({
        event_id: Number(e.eventId),
        author_handle: e.authorHandle,
        status: e.status,
        dm_text: e.dmText,
        dm_sent_at: e.dmSentAt,
        opened_at: e.openedAt,
        clicked_at: e.clickedAt,
        converted: e.converted,
        created_at: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
