import dotenv from 'dotenv';

dotenv.config({ path: '../Frontend/.env' });
dotenv.config();

const API_URL = (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://emblue-social-ai-production.up.railway.app').replace(/\/$/, '');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const PASSWORD = process.env.RBAC_TEST_PASSWORD || 'EmblueTest#2026!';

const accounts = [
  { label: 'super_admin', email: 'rbac.superadmin@emblue.test', expect: { platform_role: 'super_admin' } },
  { label: 'platform_admin', email: 'rbac.platformadmin@emblue.test', expect: { platform_role: 'platform_admin' } },
  { label: 'b2b_owner', email: 'rbac.b2b.owner@emblue.test', expect: { brand_id: 5, role: 'client_owner', account_type: 'b2b_licensed' } },
  { label: 'b2b_member', email: 'rbac.b2b.member@emblue.test', expect: { brand_id: 5, role: 'client_member', account_type: 'b2b_licensed' } },
  { label: 'b2c_viewer', email: 'rbac.b2c.viewer@emblue.test', expect: { brand_id: 6, role: 'client_viewer', account_type: 'b2c_managed' } },
  { label: 'b2c_approver', email: 'rbac.b2c.approver@emblue.test', expect: { brand_id: 6, role: 'client_approver', account_type: 'b2c_managed' } },
  { label: 'pending', email: 'rbac.pending@emblue.test', expect: { status: 'pending', pending_signup_status: 'pending' } },
  { label: 'suspended', email: 'rbac.suspended@emblue.test', expect: { status: 'suspended' } },
  { label: 'rejected', email: 'rbac.rejected@emblue.test', expect: { status: 'rejected', pending_signup_status: 'rejected' } },
];

function requireConfig() {
  const missing = [];
  if (!API_URL) missing.push('API_URL or NEXT_PUBLIC_API_URL');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}`);
}

async function login(email) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.msg || payload.error || `login failed ${response.status}`);
  }
  return payload.access_token;
}

async function api(path, token, init = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function activeBrandRole(me, brandId) {
  return me.brand_memberships?.find(item => item.brand_id === brandId) ?? null;
}

function expectedLanding(me) {
  if (me.platform_role === 'super_admin' || me.platform_role === 'platform_admin') return '/admin';
  const active = me.active_brand;
  if (active?.account_type === 'b2c_managed') return '/client-portal';
  if (active?.account_type === 'b2b_licensed') return '/dashboard';
  if (me.pending_signup_status === 'pending' || me.user?.status === 'pending') return '/success';
  return '/';
}

function assertExpectation(account, me) {
  const problems = [];
  const expect = account.expect;
  if (expect.platform_role && me.platform_role !== expect.platform_role) problems.push(`platform_role expected ${expect.platform_role}, got ${me.platform_role}`);
  if (expect.status && me.user?.status !== expect.status) problems.push(`status expected ${expect.status}, got ${me.user?.status}`);
  if (expect.pending_signup_status && me.pending_signup_status !== expect.pending_signup_status) {
    problems.push(`pending_signup_status expected ${expect.pending_signup_status}, got ${me.pending_signup_status}`);
  }
  if (expect.brand_id) {
    const brand = activeBrandRole(me, expect.brand_id);
    if (!brand) problems.push(`missing brand ${expect.brand_id}`);
    if (brand && expect.role && brand.role !== expect.role) problems.push(`brand role expected ${expect.role}, got ${brand.role}`);
    if (brand && expect.account_type && brand.account_type !== expect.account_type) {
      problems.push(`account type expected ${expect.account_type}, got ${brand.account_type}`);
    }
  }
  return problems;
}

async function main() {
  requireConfig();

  const results = [];
  for (const account of accounts) {
    try {
      const token = await login(account.email);
      const me = await api('/api/v1/auth/me', token);
      if (me.status !== 200) {
        results.push({ label: account.label, email: account.email, ok: false, detail: `/auth/me ${me.status}: ${me.payload.message || me.payload.error}` });
        continue;
      }

      const problems = assertExpectation(account, me.payload);
      results.push({
        label: account.label,
        email: account.email,
        ok: problems.length === 0,
        detail: problems.length ? problems.join('; ') : `landing=${expectedLanding(me.payload)}`,
        token,
        me: me.payload,
      });
    } catch (error) {
      results.push({ label: account.label, email: account.email, ok: false, detail: error.message });
    }
  }

  console.log(`Live API: ${API_URL}`);
  console.log('\nRole checks:');
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label} (${result.email}) - ${result.detail}`);
  }

  const b2b = results.find(result => result.label === 'b2b_owner' && result.ok);
  const b2c = results.find(result => result.label === 'b2c_viewer' && result.ok);
  const admin = results.find(result => result.label === 'platform_admin' && result.ok);

  if (b2b) {
    const access = await api('/api/v1/tools/my-access', b2b.token);
    const summary = await api('/api/v1/dashboard/summary?brand_id=5', b2b.token);
    const connect = await api('/api/v1/auth/meta/connect?brand_id=5&redirect=false', b2b.token);
    console.log('\nB2B owner API checks:');
    console.log(`${access.status === 200 ? 'PASS' : 'FAIL'} tool access status=${access.status} enabled=${access.payload.tools?.filter?.(tool => tool.enabled).length ?? 'n/a'}`);
    console.log(`${summary.status === 200 ? 'PASS' : 'FAIL'} dashboard summary status=${summary.status}`);
    console.log(`${connect.status === 200 && typeof connect.payload.url === 'string' ? 'PASS' : 'FAIL'} meta connect-url status=${connect.status} host=${connect.payload.url ? new URL(connect.payload.url).hostname : 'n/a'}`);
  }

  if (b2c) {
    const clientSummary = await api('/api/v1/dashboard/client-summary?brand_id=6', b2c.token);
    const b2bSummary = await api('/api/v1/dashboard/summary?brand_id=5', b2c.token);
    const tools = await api('/api/v1/tools/my-access', b2c.token);
    console.log('\nB2C viewer API checks:');
    console.log(`${clientSummary.status === 200 ? 'PASS' : 'FAIL'} client summary status=${clientSummary.status}`);
    console.log(`${b2bSummary.status === 403 ? 'PASS' : 'FAIL'} blocked foreign B2B brand status=${b2bSummary.status}`);
    console.log(`${tools.status === 200 && tools.payload.tools?.every?.(tool => !tool.enabled) ? 'PASS' : 'FAIL'} no B2B tools enabled status=${tools.status}`);
  }

  if (admin) {
    const users = await api('/api/v1/admin/users', admin.token);
    const audit = await api('/api/v1/admin/audit-logs', admin.token);
    console.log('\nPlatform admin API checks:');
    console.log(`${users.status === 200 ? 'PASS' : 'FAIL'} admin users status=${users.status}`);
    console.log(`${audit.status === 403 ? 'PASS' : 'FAIL'} super-admin-only audit log blocked status=${audit.status}`);
  }

  const failed = results.some(result => !result.ok);
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(`QA failed: ${error.message}`);
  process.exitCode = 1;
});
