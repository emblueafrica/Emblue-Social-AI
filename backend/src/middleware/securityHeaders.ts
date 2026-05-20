import { Request, Response, NextFunction } from 'express';

function contentSecurityPolicy(path: string): string {
  const scriptSrc = path.startsWith('/api-docs') ? "script-src 'self' 'unsafe-inline';" : "script-src 'self';";
  const styleSrc = path.startsWith('/api-docs') ? "style-src 'self' 'unsafe-inline';" : "style-src 'self';";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    scriptSrc,
    styleSrc,
  ].join('; ');
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(req.path));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
