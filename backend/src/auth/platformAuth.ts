// src/auth/platformAuth.ts
import { Request, Response } from 'express';
import { upsertConnectedAccount, getConnectedAccount } from '../db/queries';
import { Platform } from '../types';
import { createOAuthState, verifyOAuthState } from './oauthState';

// ── META (INSTAGRAM + FACEBOOK) ───────────────────────────────────────────────
export function getMetaAuthUrl(brandId: number): string {
  const params = new URLSearchParams({
    client_id:     process.env.META_APP_ID ?? '',
    redirect_uri:  process.env.META_REDIRECT_URI ?? '',
    scope:         'instagram_basic,instagram_manage_comments,instagram_manage_messages,pages_show_list,pages_manage_engagement,pages_read_engagement',
    response_type: 'code',
    state:         createOAuthState(brandId),
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

export async function handleMetaCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as Record<string, string>;

  try {
    const brandId = verifyOAuthState(state);
    // Exchange code for short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      `client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}` +
      `&redirect_uri=${process.env.META_REDIRECT_URI}&code=${code}`
    );
    const tokenData = await tokenRes.json() as { access_token: string; error?: { message: string } };
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Exchange for long-lived token (60 days)
    const llRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      `grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}` +
      `&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const llData = await llRes.json() as { access_token: string; expires_in?: number };

    const expiresAt = llData.expires_in
      ? new Date(Date.now() + llData.expires_in * 1000)
      : new Date(Date.now() + 60 * 24 * 3600 * 1000);

    // Get user info
    const meRes = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${llData.access_token}`
    );
    const meData = await meRes.json() as { id: string; name: string };

    await upsertConnectedAccount(
      brandId, 'instagram',
      llData.access_token, null, expiresAt,
      meData.name, meData.id, 'instagram_basic,pages_show_list'
    );

    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontend}/client?auth=success&platform=instagram&handle=${encodeURIComponent(meData.name)}`);

  } catch (err) {
    console.error('[Auth] Meta callback error:', (err as Error).message);
    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontend}/client?auth=error&reason=${encodeURIComponent((err as Error).message)}`);
  }
}

// ── X (TWITTER) — PKCE FLOW ───────────────────────────────────────────────────
const xStateStore = new Map<string, string>();

export function getXAuthUrl(brandId: number): { url: string; state: string } {
  const state = createOAuthState(brandId);
  const codeVerifier = Math.random().toString(36).repeat(3).slice(0, 50);
  xStateStore.set(state, codeVerifier);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             process.env.X_CLIENT_ID ?? '',
    redirect_uri:          process.env.X_REDIRECT_URI ?? '',
    scope:                 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge:        codeVerifier,
    code_challenge_method: 'plain',
  });

  return { url: `https://twitter.com/i/oauth2/authorize?${params.toString()}`, state };
}

export async function handleXCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as Record<string, string>;
  const codeVerifier = xStateStore.get(state);

  try {
    if (!codeVerifier) throw new Error('Invalid OAuth state');
    const brandId = verifyOAuthState(state);
    xStateStore.delete(state);

    const body = new URLSearchParams({
      code, grant_type: 'authorization_code',
      client_id:     process.env.X_CLIENT_ID ?? '',
      redirect_uri:  process.env.X_REDIRECT_URI ?? '',
      code_verifier: codeVerifier,
    });

    const credentials = Buffer.from(
      `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
    ).toString('base64');

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const tokenData = await tokenRes.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
      error?:        string;
    };
    if (tokenData.error) throw new Error(tokenData.error);

    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const meData = await meRes.json() as { data: { id: string; username: string } };

    await upsertConnectedAccount(
      brandId, 'x',
      tokenData.access_token,
      tokenData.refresh_token,
      new Date(Date.now() + tokenData.expires_in * 1000),
      meData.data.username,
      meData.data.id,
      'tweet.read tweet.write users.read'
    );

    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontend}/client?auth=success&platform=x&handle=${meData.data.username}`);

  } catch (err) {
    console.error('[Auth] X callback error:', (err as Error).message);
    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontend}/client?auth=error&reason=${encodeURIComponent((err as Error).message)}`);
  }
}

// ── GET VALID TOKEN ───────────────────────────────────────────────────────────
export async function getValidToken(
  brandId: number,
  platform: Platform
): Promise<string | null> {
  const account = await getConnectedAccount(brandId, platform);
  return account?.access_token ?? null;
}
