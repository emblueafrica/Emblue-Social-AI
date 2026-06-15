// src/auth/platformAuth.ts — Social platform OAuth (connect, callback, token refresh)
import { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import {
  upsertConnectedAccount,
  getConnectedAccountRecord,
  updateConnectedAccountTokens,
} from '../db/queries';
import { Platform } from '../types';
import { createOAuthState, verifyOAuthState } from './oauthState';

// ── REDIRECT HELPERS ──────────────────────────────────────────────────────────
// FRONTEND_URL may be a comma-separated list; OAuth redirects use the first entry.
function frontendBaseUrl(): string {
  const raw = (process.env.FRONTEND_URL ?? 'http://localhost:3000').split(',')[0] ?? '';
  return raw.trim().replace(/\/+$/, '') || 'http://localhost:3000';
}

function redirectSuccess(res: Response, platform: string, handle: string): void {
  res.redirect(`${frontendBaseUrl()}/client?auth=success&platform=${platform}&handle=${encodeURIComponent(handle)}`);
}

function redirectError(res: Response, reason: string): void {
  res.redirect(`${frontendBaseUrl()}/client?auth=error&reason=${encodeURIComponent(reason)}`);
}

// ── META (INSTAGRAM + FACEBOOK) ───────────────────────────────────────────────
const META_SCOPE = [
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_manage_engagement',
  'pages_read_engagement',
  'pages_messaging',
].join(',');

export function getMetaAuthUrl(brandId: number): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? '',
    redirect_uri: process.env.META_REDIRECT_URI ?? '',
    scope: META_SCOPE,
    response_type: 'code',
    state: createOAuthState(brandId),
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

type MetaTokenResponse = { access_token?: string; expires_in?: number; error?: { message: string } };
type MetaPage = { id: string; name: string; access_token: string };
type MetaUserResponse = { id?: string; name?: string; error?: { message: string } };

/**
 * Resolve and store the connected accounts behind a Meta login. Comment and
 * messaging actions need a Page access token (not the user token), so this
 * fetches the user's Pages and persists the Page token for both `facebook` and
 * the Instagram business account linked to that Page. Page tokens derived from
 * a long-lived user token do not expire, so they are stored with no expiry.
 */
async function persistMetaConnections(brandId: number, userToken: string, platformUserId: string | null): Promise<string> {
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${userToken}`,
  );
  const pagesData = (await pagesRes.json()) as { data?: MetaPage[]; error?: { message: string } };
  const page = pagesData.data?.[0];

  if (!page) {
    // No managed Page — fall back to the long-lived user token under `instagram`.
    await upsertConnectedAccount(
      brandId, 'instagram', userToken, null,
      new Date(Date.now() + 60 * 24 * 3600 * 1000),
      'Meta account', '', 'instagram_basic', platformUserId,
    );
    return 'Meta account';
  }

  await upsertConnectedAccount(
    brandId, 'facebook', page.access_token, null, null,
    page.name, page.id, 'pages_manage_engagement,pages_messaging', platformUserId,
  );

  // An Instagram business account may be linked to the Page; it shares the Page token.
  let igHandle = page.name;
  let igId = page.id;
  try {
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}` +
      `?fields=instagram_business_account{id,username}&access_token=${page.access_token}`,
    );
    const igData = (await igRes.json()) as {
      instagram_business_account?: { id: string; username: string };
    };
    if (igData.instagram_business_account) {
      igHandle = igData.instagram_business_account.username;
      igId = igData.instagram_business_account.id;
    }
  } catch {
    /* IG linkage is best-effort */
  }

  await upsertConnectedAccount(
    brandId, 'instagram', page.access_token, null, null,
    igHandle, igId, 'instagram_manage_comments,instagram_manage_messages', platformUserId,
  );

  return igHandle;
}

export async function handleMetaCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as Record<string, string>;

  try {
    const { brandId } = verifyOAuthState(state);
    if (!code) throw new Error('Missing authorization code');

    // Exchange code for a short-lived token.
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI ?? '')}&code=${encodeURIComponent(code)}`,
    );
    const tokenData = (await tokenRes.json()) as MetaTokenResponse;
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error?.message ?? 'Meta token exchange failed');
    }

    // Exchange for a long-lived token (~60 days).
    const llRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}` +
      `&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`,
    );
    const llData = (await llRes.json()) as MetaTokenResponse;
    if (llData.error || !llData.access_token) {
      throw new Error(llData.error?.message ?? 'Meta long-lived token exchange failed');
    }

    const meRes = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${llData.access_token}`,
    );
    const meData = (await meRes.json()) as MetaUserResponse;
    if (meData.error || !meData.id) {
      throw new Error(meData.error?.message ?? 'Meta user lookup failed');
    }

    const handle = await persistMetaConnections(brandId, llData.access_token, meData.id);
    redirectSuccess(res, 'instagram', handle);
  } catch (err) {
    console.error('[Auth] Meta callback error:', (err as Error).message);
    redirectError(res, (err as Error).message);
  }
}

// ── X (TWITTER) — PKCE FLOW ───────────────────────────────────────────────────
export function getXAuthUrl(brandId: number): string {
  // PKCE with S256. The code verifier is carried in the signed `state`; X is a
  // confidential client, so the token exchange is additionally protected by the
  // client secret (HTTP Basic auth).
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID ?? '',
    redirect_uri: process.env.X_REDIRECT_URI ?? '',
    scope: 'tweet.read tweet.write users.read offline.access',
    state: createOAuthState(brandId, { cv: codeVerifier }),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

function xBasicAuthHeader(): string {
  return Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
}

export async function handleXCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as Record<string, string>;

  try {
    const { brandId, data } = verifyOAuthState(state);
    const codeVerifier = data.cv;
    if (!code || !codeVerifier) throw new Error('Invalid OAuth state');

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${xBasicAuthHeader()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.X_CLIENT_ID ?? '',
        redirect_uri: process.env.X_REDIRECT_URI ?? '',
        code_verifier: codeVerifier,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description ?? tokenData.error ?? 'X token exchange failed');
    }

    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = (await meRes.json()) as { data?: { id: string; username: string } };

    await upsertConnectedAccount(
      brandId, 'x',
      tokenData.access_token,
      tokenData.refresh_token ?? null,
      new Date(Date.now() + (tokenData.expires_in ?? 7200) * 1000),
      meData.data?.username ?? 'x account',
      meData.data?.id ?? '',
      'tweet.read tweet.write users.read offline.access',
    );

    redirectSuccess(res, 'x', meData.data?.username ?? 'x account');
  } catch (err) {
    console.error('[Auth] X callback error:', (err as Error).message);
    redirectError(res, (err as Error).message);
  }
}

// ── TIKTOK ────────────────────────────────────────────────────────────────────
// Scopes are deployment-specific (some require TikTok app review), so they are
// overridable via TIKTOK_SCOPES.
const TIKTOK_SCOPE = process.env.TIKTOK_SCOPES?.trim() || 'user.info.basic,video.list';

export function getTikTokAuthUrl(brandId: number): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI ?? '',
    scope: TIKTOK_SCOPE,
    response_type: 'code',
    state: createOAuthState(brandId),
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

type TikTokTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function handleTikTokCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as Record<string, string>;

  try {
    const { brandId } = verifyOAuthState(state);
    if (!code) throw new Error('Missing authorization code');

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI ?? '',
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as TikTokTokenResponse;
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description ?? tokenData.error ?? 'TikTok token exchange failed');
    }

    // Display name is best-effort — it requires the user.info.basic scope.
    let handle = 'tiktok account';
    try {
      const meRes = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      const meData = (await meRes.json()) as { data?: { user?: { display_name?: string } } };
      handle = meData.data?.user?.display_name ?? handle;
    } catch {
      /* user info is best-effort */
    }

    await upsertConnectedAccount(
      brandId, 'tiktok',
      tokenData.access_token,
      tokenData.refresh_token ?? null,
      new Date(Date.now() + (tokenData.expires_in ?? 86400) * 1000),
      handle,
      tokenData.open_id ?? '',
      tokenData.scope ?? TIKTOK_SCOPE,
    );

    redirectSuccess(res, 'tiktok', handle);
  } catch (err) {
    console.error('[Auth] TikTok callback error:', (err as Error).message);
    redirectError(res, (err as Error).message);
  }
}

// ── TOKEN REFRESH ─────────────────────────────────────────────────────────────
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

type RefreshedToken = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

async function refreshPlatformToken(
  platform: Platform,
  refreshToken: string | null,
  currentToken: string,
): Promise<RefreshedToken | null> {
  if (platform === 'x') {
    if (!refreshToken) return null;
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${xBasicAuthHeader()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.X_CLIENT_ID ?? '',
      }).toString(),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000),
    };
  }

  if (platform === 'tiktok') {
    if (!refreshToken) return null;
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 86400) * 1000),
    };
  }

  if (platform === 'instagram' || platform === 'facebook') {
    // Meta has no refresh token — re-extend the long-lived token instead.
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}` +
      `&fb_exchange_token=${currentToken}`,
    );
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  }

  return null;
}

/**
 * Return a usable access token for a brand + platform, transparently refreshing
 * it when it is missing or close to expiry. A `null` stored expiry means the
 * token does not expire (e.g. Meta Page tokens) and is returned as-is.
 */
export async function getValidToken(
  brandId: number,
  platform: Platform
): Promise<string | null> {
  const account = await getConnectedAccountRecord(brandId, platform);
  if (!account) return null;

  if (!account.tokenExpiresAt) return account.accessToken;
  if (account.tokenExpiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS) {
    return account.accessToken;
  }

  try {
    const refreshed = await refreshPlatformToken(platform, account.refreshToken, account.accessToken);
    if (refreshed) {
      await updateConnectedAccountTokens(
        brandId, platform,
        refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt,
      );
      return refreshed.accessToken;
    }
  } catch (err) {
    console.error(`[Auth] ${platform} token refresh failed for brand ${brandId}:`, (err as Error).message);
  }

  // Refresh unavailable or failed — fall back to the stored token.
  return account.accessToken;
}
