// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUser, BrandRole, PlatformRole, UserRole } from '../types';
import { loadAuthContext } from '../rbac/service';
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt';
import { sendServerError } from '../utils/validation';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface PublicPath {
  method: string;
  path?: string;
  prefix?: string;
}

const PUBLIC_PATHS: PublicPath[] = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/api/v1/health' },
  { method: 'GET', prefix: '/api/v1/auth/x/callback' },
  { method: 'GET', prefix: '/api/v1/auth/meta/callback' },
  { method: 'GET', prefix: '/api/v1/auth/tiktok/callback' },
  { method: 'GET', prefix: '/api/v1/l/' },
  { method: 'GET', prefix: '/api/v1/rt/webhook/' },
  { method: 'POST', path: '/api/v1/rt/events/convert' },
  { method: 'POST', prefix: '/api/v1/rt/webhook/' },
];

const STATUS_VISIBLE_PATHS = new Set(['/api/v1/auth/me']);

function isPublic(method: string, path: string): boolean {
  return PUBLIC_PATHS.some(p => {
    if (p.method !== method) return false;
    if (p.path) return p.path === path;
    if (p.prefix) return path.startsWith(p.prefix);
    return false;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBrandId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function directRequestBrandId(req: Request): number | null {
  const paramBrandId = parseBrandId(req.params['brand_id'] ?? req.params['brandId']);
  if (paramBrandId) return paramBrandId;

  const body = isRecord(req.body) ? req.body : {};
  const bodyBrandId = parseBrandId(body.brand_id ?? body.brandId);
  if (bodyBrandId) return bodyBrandId;

  const queryBrandId = parseBrandId(req.query['brand_id'] ?? req.query['brandId']);
  if (queryBrandId) return queryBrandId;

  return null;
}

export function resolveRequestBrandId(req: Request): number | null {
  const requestedBrandId = directRequestBrandId(req);
  if (requestedBrandId) return requestedBrandId;

  const memberships = req.user?.brand_memberships ?? [];
  return memberships.length === 1 ? memberships[0].brand_id : null;
}

export function canAccessBrandId(user: AuthUser | undefined, brandId: number): boolean {
  if (!user) return false;
  if (user.platform_role === 'super_admin' || user.platform_role === 'platform_admin') return true;
  return user.brand_memberships.some(membership => membership.brand_id === brandId);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isPublic(req.method, req.path)) {
    next();
    return;
  }

  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header. Format: Bearer <token>',
    });
    return;
  }

  try {
    const decoded = await verifySupabaseJwt(header.slice(7));
    req.user = await loadAuthContext(decoded);
    if (req.user.status === 'suspended' && !STATUS_VISIBLE_PATHS.has(req.path)) {
      res.status(403).json({
        error: 'Account suspended',
        message: 'This account has been suspended. Contact Social Emblue AI support.',
      });
      return;
    }
    if (req.user.status === 'rejected' && !STATUS_VISIBLE_PATHS.has(req.path)) {
      res.status(403).json({
        error: 'Account rejected',
        message: 'This account registration was rejected.',
      });
      return;
    }
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', message: 'Please log in again' });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token', message: 'Token signature is invalid' });
      return;
    }
    sendServerError(res, 'Auth context lookup failed', err);
  }
}

export function requirePlatformRole(...roles: PlatformRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.user.platform_role || !roles.includes(req.user.platform_role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of: ${roles.join(', ')}`,
      });
      return;
    }
    next();
  };
}

export function requireBrandAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const requestedBrandId = directRequestBrandId(req);
  if (requestedBrandId) {
    if (!canAccessBrandId(req.user, requestedBrandId)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this brand',
      });
      return;
    }
    next();
    return;
  }

  if (req.user.platform_role || req.user.brand_memberships.length > 0) {
    next();
    return;
  }

  res.status(403).json({
    error: 'Brand access required',
    message: 'This account is not attached to an approved brand workspace.',
  });
}

export function requireBrandRole(...roles: BrandRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (req.user.platform_role) {
      next();
      return;
    }

    const brandId = resolveRequestBrandId(req);
    if (!brandId) {
      res.status(403).json({
        error: 'Brand access required',
        message: 'This account is not attached to an approved brand workspace.',
      });
      return;
    }

    const membership = req.user.brand_memberships.find(item => item.brand_id === brandId);
    if (!membership || !roles.includes(membership.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of: ${roles.join(', ')}`,
      });
      return;
    }
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const allowsOwner = roles.includes('owner') && req.user.platform_role === 'super_admin';
    const allowsAdmin = roles.includes('admin') && Boolean(req.user.platform_role);
    const allowsMember = roles.includes('member') && req.user.brand_memberships.length > 0;
    if (allowsOwner || allowsAdmin || allowsMember) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Forbidden',
      message: `This action requires one of: ${roles.join(', ')}`,
    });
  };
}
