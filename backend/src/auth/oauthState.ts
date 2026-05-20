import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type OAuthStatePayload = {
  brand_id: number;
  nonce: string;
  ts: number;
};

const MAX_STATE_AGE_MS = 10 * 60 * 1000;

function getStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('OAUTH_STATE_SECRET or SUPABASE_JWT_SECRET is required');
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
}

export function createOAuthState(brandId: number): string {
  const payload: OAuthStatePayload = {
    brand_id: brandId,
    nonce: randomBytes(16).toString('hex'),
    ts: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOAuthState(state: string): number {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) throw new Error('Invalid OAuth state');

  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid OAuth state signature');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (!Number.isInteger(payload.brand_id) || payload.brand_id <= 0) throw new Error('Invalid OAuth state brand');
  if (!Number.isInteger(payload.ts) || Date.now() - payload.ts > MAX_STATE_AGE_MS) throw new Error('OAuth state expired');
  return payload.brand_id;
}
