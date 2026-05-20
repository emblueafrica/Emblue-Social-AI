// src/stream/templateManager.ts — Client reply template manager
import prisma from "../db/prisma";
import { Platform } from "../types";

export interface ReplyTemplate {
  template_id:  number;
  brand_id:     number;
  name:         string;
  platform?:    Platform;
  trigger_keywords: string[];
  template_text:    string;
  is_active:    boolean;
  use_count:    number;
  created_at:   Date;
}

export interface TemplateMatchResult {
  matched:   boolean;
  template?: ReplyTemplate;
  text?:     string;
}

type ReplyTemplateRow = NonNullable<Awaited<ReturnType<typeof prisma.replyTemplate.findFirst>>>;

function mapReplyTemplate(row: ReplyTemplateRow): ReplyTemplate {
  return {
    template_id: Number(row.templateId),
    brand_id: row.brandId ?? 0,
    name: row.name,
    platform: row.platform ? row.platform as Platform : undefined,
    trigger_keywords: row.triggerKeywords ?? [],
    template_text: row.templateText ?? "",
    is_active: row.isActive ?? false,
    use_count: row.useCount ?? 0,
    created_at: row.createdAt,
  };
}

export async function getTemplatesForBrand(brandId: number, platform?: Platform): Promise<ReplyTemplate[]> {
  const rows = await prisma.replyTemplate.findMany({
    where: {
      brandId,
      isActive: true,
      ...(platform ? { OR: [{ platform: platform as never }, { platform: null }] } : {}),
    },
    orderBy: { useCount: 'desc' },
  });
  return rows.map(mapReplyTemplate);
}

export async function findMatchingTemplate(
  brandId:  number,
  platform: Platform,
  text:     string
): Promise<TemplateMatchResult> {
  const templates = await getTemplatesForBrand(brandId, platform);
  const lower     = text.toLowerCase();

  for (const template of templates) {
    const keywords = template.trigger_keywords ?? [];
    if (keywords.length === 0 || keywords.some((k: string) => lower.includes(k.toLowerCase()))) {
      await prisma.replyTemplate.update({
        where: { templateId: BigInt(template.template_id) },
        data: { useCount: { increment: 1 } },
      });
      return { matched: true, template, text: template.template_text };
    }
  }

  return { matched: false };
}

export async function createTemplate(data: {
  brand_id:         number;
  name:             string;
  platform?:        Platform;
  trigger_keywords: string[];
  template_text:    string;
}): Promise<ReplyTemplate> {
  const row = await prisma.replyTemplate.create({
    data: {
      brandId: data.brand_id,
      name: data.name,
      platform: data.platform as never,
      triggerKeywords: data.trigger_keywords,
      templateText: data.template_text,
      isActive: true,
      useCount: 0,
    },
  });
  return mapReplyTemplate(row);
}

export async function toggleTemplate(templateId: number): Promise<{ is_active: boolean }> {
  const existing = await prisma.replyTemplate.findUnique({
    where: { templateId: BigInt(templateId) },
    select: { isActive: true },
  });
  if (!existing) return { is_active: false };

  const row = await prisma.replyTemplate.update({
    where: { templateId: BigInt(templateId) },
    data: { isActive: !(existing.isActive ?? false), updatedAt: new Date() },
    select: { isActive: true },
  });
  return { is_active: row.isActive ?? false };
}

export async function deleteTemplate(templateId: number, brandId: number): Promise<boolean> {
  const result = await prisma.replyTemplate.deleteMany({
    where: { templateId: BigInt(templateId), brandId },
  });
  return result.count > 0;
}

export async function getTopTemplates(brandId: number, limit = 5): Promise<ReplyTemplate[]> {
  const rows = await prisma.replyTemplate.findMany({
    where: { brandId, isActive: true },
    orderBy: { useCount: 'desc' },
    take: limit,
  });
  return rows.map(mapReplyTemplate);
}
