// src/utils/validation.ts
import { Response } from 'express';
import { Platform } from '../types';

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'x', 'tiktok', 'youtube', 'reddit', 'whatsapp'];

export function sendValidationError(res: Response, message: string): void {
  res.status(400).json({ error: 'Validation failed', message });
}

export function parsePositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getRequiredBrandId(value: unknown): number | null {
  return parsePositiveInt(value);
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && PLATFORMS.includes(value as Platform);
}

export function requireNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function requireNonEmptyArray<T>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

export function validateAllocationTotal(
  allocation: Record<string, number | undefined>,
  allowedVariance = 0
): { ok: true; total: number } | { ok: false; total: number; message: string } {
  const total = Object.values(allocation).reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
  const ok = Math.abs(total - 100) <= allowedVariance;

  if (!ok) {
    return { ok: false, total, message: `Allocation must sum to 100% (got ${total}%)` };
  }

  return { ok: true, total };
}

export function isHttpUrl(value: unknown): value is string {
  if (!requireNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
