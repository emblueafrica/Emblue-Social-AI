// src/middleware/rateLimit.ts
import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

interface LimitRule {
  limit: number;
  windowMs: number;
  scope: 'ip' | 'identity';
}

const buckets = new Map<string, Bucket>();

const ONE_MINUTE = 60_000;
const FIFTEEN_MINUTES = 15 * 60_000;

const GENERAL_LIMIT: LimitRule = { limit: 60, windowMs: ONE_MINUTE, scope: 'ip' };
const SESSION_LIMIT: LimitRule = { limit: 120, windowMs: ONE_MINUTE, scope: 'identity' };
const AUTH_LIMIT: LimitRule = { limit: 5, windowMs: FIFTEEN_MINUTES, scope: 'ip' };
const AI_LIMIT: LimitRule = { limit: 10, windowMs: ONE_MINUTE, scope: 'identity' };
const UPLOAD_LIMIT: LimitRule = { limit: 5, windowMs: ONE_MINUTE, scope: 'ip' };
const CAMPAIGN_ACTION_LIMIT: LimitRule = { limit: 10, windowMs: ONE_MINUTE, scope: 'identity' };

function isSkippedPath(method: string, path: string): boolean {
  if (method === 'GET' && path === '/') return true;
  if (method === 'GET' && path === '/api/v1/health') return true;
  if (path.startsWith('/api/v1/rt/webhook/')) return true;
  return false;
}

function isAiPath(path: string): boolean {
  return [
    '/api/v1/ingest',
    '/api/v1/cluster',
    '/api/v1/strategize',
    '/api/v1/reply',
    '/api/v1/kpi',
    '/api/v1/creative',
    '/api/v1/insights',
    '/api/v1/warroom',
  ].some(prefix => path.startsWith(prefix));
}

function limitForPath(path: string): LimitRule {
  if (path === '/api/v1/auth/me' || path.startsWith('/api/v1/auth/connections/')) return SESSION_LIMIT;
  if (path.startsWith('/api/v1/auth') || path.startsWith('/api/v1/onboarding')) return AUTH_LIMIT;
  if (path.includes('/upload') || path.includes('/uploads')) return UPLOAD_LIMIT;
  if (path.startsWith('/api/v1/campaigns') && (path.endsWith('/sync') || path.endsWith('/activate') || path.includes('/retry') || path.includes('/campaigns/keyword'))) return CAMPAIGN_ACTION_LIMIT;
  if (isAiPath(path)) return AI_LIMIT;
  return GENERAL_LIMIT;
}

function identityKey(req: Request, rule: LimitRule): string {
  if (rule.scope === 'identity') {
    const authorization = req.headers.authorization ?? '';
    if (authorization.startsWith('Bearer ')) {
      return `bearer:${createHash('sha256').update(authorization.slice(7)).digest('hex')}`;
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

function cleanupExpiredBuckets(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function apiRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (isSkippedPath(req.method, req.path)) {
    next();
    return;
  }

  const now = Date.now();
  cleanupExpiredBuckets(now);

  const rule = limitForPath(req.path);
  const key = `${identityKey(req, rule)}:${req.path}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    next();
    return;
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    res.setHeader('Retry-After', Math.ceil((existing.resetAt - now) / 1000));
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please wait before retrying this endpoint.',
    });
    return;
  }

  next();
}
