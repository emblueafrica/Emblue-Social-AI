// src/routes/templates.ts — Reply template library (PRD Tool 3)
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { canAccessBrandId, requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { getRequiredBrandId, isPlatform, requireNonEmptyString, sendServerError, sendValidationError } from '../utils/validation';

const router = Router();

type TemplateRow = {
  templateId: bigint;
  brandId: number | null;
  name: string;
  platform: string | null;
  triggerKeywords: string[];
  templateText: string | null;
  isActive: boolean | null;
  useCount: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeTemplate(t: TemplateRow) {
  return {
    template_id: Number(t.templateId),
    brand_id: t.brandId,
    name: t.name,
    platform: t.platform,
    trigger_keywords: t.triggerKeywords,
    template_text: t.templateText,
    is_active: t.isActive,
    use_count: t.useCount,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/** Load a reply template by `:id` and verify brand access. */
async function loadOwnedTemplate(
  req: Request,
  res: Response,
): Promise<{ templateId: bigint; brandId: number } | null> {
  const templateId = getRequiredBrandId(req.params['id']);
  if (!templateId) { sendValidationError(res, 'id must be a positive integer'); return null; }

  const template = await prisma.replyTemplate.findUnique({
    where: { templateId: BigInt(templateId) },
    select: { templateId: true, brandId: true },
  });
  if (!template || !template.brandId) { res.status(404).json({ error: 'Template not found' }); return null; }
  if (!canAccessBrandId(req.user, template.brandId)) {
    res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
    return null;
  }
  return { templateId: template.templateId, brandId: template.brandId };
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/:brand_id', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try {
    const rows = await prisma.replyTemplate.findMany({
      where: { brandId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ templates: rows.map(serializeTemplate) });
  } catch (err) {
    sendServerError(res, 'Reply template lookup failed', err);
  }
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id: number; name?: string; platform?: string;
    trigger_keywords?: string[]; template_text?: string; is_active?: boolean;
  };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!requireNonEmptyString(body.name)) { sendValidationError(res, 'name is required'); return; }
  if (body.platform && !isPlatform(body.platform)) { sendValidationError(res, 'platform is invalid'); return; }

  try {
    const row = await prisma.replyTemplate.create({
      data: {
        brandId,
        name: body.name.trim(),
        platform: body.platform ? (body.platform as never) : null,
        triggerKeywords: body.trigger_keywords ?? [],
        templateText: body.template_text ?? null,
        isActive: body.is_active ?? true,
      },
    });
    res.json({ ok: true, template: serializeTemplate(row) });
  } catch (err) {
    sendServerError(res, 'Reply template creation failed', err);
  }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.put('/:id', requireBrandRole('client_owner'), requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const owned = await loadOwnedTemplate(req, res);
  if (!owned) return;
  const body = req.body as {
    name?: string; platform?: string; trigger_keywords?: string[];
    template_text?: string; is_active?: boolean;
  };
  if (body.platform && !isPlatform(body.platform)) { sendValidationError(res, 'platform is invalid'); return; }

  try {
    const row = await prisma.replyTemplate.update({
      where: { templateId: owned.templateId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.platform !== undefined ? { platform: body.platform as never } : {}),
        ...(body.trigger_keywords !== undefined ? { triggerKeywords: body.trigger_keywords } : {}),
        ...(body.template_text !== undefined ? { templateText: body.template_text } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
        updatedAt: new Date(),
      },
    });
    res.json({ ok: true, template: serializeTemplate(row) });
  } catch (err) {
    sendServerError(res, 'Reply template update failed', err);
  }
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireBrandRole('client_owner'), requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const owned = await loadOwnedTemplate(req, res);
  if (!owned) return;
  try {
    await prisma.replyTemplate.delete({ where: { templateId: owned.templateId } });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, 'Reply template deletion failed', err);
  }
});

export default router;
