// src/agents/agent8_attribution.ts
import { randomUUID } from 'crypto';
import prisma from '../db/prisma';
import { Platform, TrackedLink } from '../types';
import { isHttpUrl } from '../utils/validation';

export interface CreateTrackedLinkPayload {
  brand_id: number;
  dest_url: string;
  campaign?: string;
  platform?: Platform;
  content_type?: string;
}

export interface CreateTrackedLinkResult {
  ok: boolean;
  link?: TrackedLink;
  short_code?: string;
  tracked_url?: string;
  error?: string;
}

function makeShortCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

function buildTrackedUrl(shortCode: string): string {
  const baseUrl = process.env.LINK_BASE_URL ?? process.env.FRONTEND_URL ?? '';
  return baseUrl ? `${baseUrl.replace(/\/$/, '')}/r/${shortCode}` : `/r/${shortCode}`;
}

export async function createTrackedLink(payload: CreateTrackedLinkPayload): Promise<CreateTrackedLinkResult> {
  const { brand_id, dest_url, campaign = null, platform = null, content_type = null } = payload;

  if (!brand_id || !isHttpUrl(dest_url)) {
    return { ok: false, error: 'brand_id and a valid dest_url are required' };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shortCode = makeShortCode();

    try {
      const row = await prisma.trackedLink.create({
        data: {
          brandId: brand_id,
          shortCode,
          destUrl: dest_url,
          campaign,
          platform: platform as never,
          contentType: content_type,
        },
      });

      return {
        ok: true,
        link: {
          link_id: Number(row.linkId),
          brand_id: row.brandId ?? brand_id,
          short_code: row.shortCode,
          dest_url: row.destUrl,
          campaign: row.campaign ?? undefined,
          platform: row.platform ? row.platform as Platform : undefined,
          content_type: row.contentType ?? undefined,
          clicks: row.clicks,
          conversions: row.conversions,
          created_at: row.createdAt,
        } satisfies TrackedLink,
        short_code: shortCode,
        tracked_url: buildTrackedUrl(shortCode),
      };
    } catch (err) {
      if (attempt === 2) {
        return { ok: false, error: (err as Error).message };
      }
    }
  }

  return { ok: false, error: 'Unable to create tracked link' };
}
