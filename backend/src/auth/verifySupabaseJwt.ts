import { createPublicKey, JsonWebKey } from 'crypto';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

type SupabaseJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type SupabaseJwks = {
  keys: SupabaseJwk[];
};

let cachedJwks: { keys: SupabaseJwk[]; expiresAt: number } | null = null;
const JWKS_CACHE_MS = 10 * 60 * 1000;

function jwksUrl(): string | null {
  if (process.env.SUPABASE_JWKS_URL) return process.env.SUPABASE_JWKS_URL;

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  return supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : null;
}

async function fetchJwks(forceRefresh = false): Promise<SupabaseJwk[]> {
  if (!forceRefresh && cachedJwks && cachedJwks.expiresAt > Date.now()) {
    return cachedJwks.keys;
  }

  const url = jwksUrl();
  if (!url) {
    throw new jwt.JsonWebTokenError('SUPABASE_JWKS_URL or SUPABASE_URL is required for JWKS auth');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new jwt.JsonWebTokenError(`Supabase JWKS fetch failed with ${response.status}`);
  }

  const payload = await response.json() as SupabaseJwks;
  if (!Array.isArray(payload.keys)) {
    throw new jwt.JsonWebTokenError('Supabase JWKS response is invalid');
  }

  cachedJwks = {
    keys: payload.keys,
    expiresAt: Date.now() + JWKS_CACHE_MS,
  };
  return cachedJwks.keys;
}

async function findJwk(kid: string): Promise<SupabaseJwk> {
  const currentKeys = await fetchJwks();
  const currentMatch = currentKeys.find(key => key.kid === kid);
  if (currentMatch) return currentMatch;

  const refreshedKeys = await fetchJwks(true);
  const refreshedMatch = refreshedKeys.find(key => key.kid === kid);
  if (refreshedMatch) return refreshedMatch;

  throw new jwt.JsonWebTokenError('Supabase JWT key id was not found in JWKS');
}

export async function verifySupabaseJwt(token: string): Promise<JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new jwt.JsonWebTokenError('Invalid JWT');
  }

  const { alg, kid } = decoded.header;
  if (alg === 'HS256') {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new jwt.JsonWebTokenError('SUPABASE_JWT_SECRET is required for HS256 auth');
    }
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
  }

  if (alg === 'ES256') {
    if (!kid) {
      throw new jwt.JsonWebTokenError('Supabase ES256 JWT is missing kid');
    }
    const jwk = await findJwk(kid);
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    return jwt.verify(token, publicKey, { algorithms: ['ES256'] }) as JwtPayload;
  }

  throw new jwt.JsonWebTokenError(`Unsupported Supabase JWT algorithm: ${alg ?? 'unknown'}`);
}
