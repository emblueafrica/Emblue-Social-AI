import { spawn } from 'node:child_process';

const port = Number(process.env.ENDPOINT_CHECK_PORT ?? 3999);
const providedBaseUrl = process.env.ENDPOINT_BASE_URL?.replace(/\/$/, '');
const baseUrl = providedBaseUrl ?? `http://127.0.0.1:${port}`;
const includeDbBackedChecks = process.env.ENDPOINT_CHECK_DB === 'true' || Boolean(providedBaseUrl);

const endpoints = [
  { method: 'GET', path: '/', expect: [200] },
  { method: 'GET', path: '/api/v1/health', expect: [200] },
  { method: 'GET', path: '/api-docs.json', expect: [200, 404] },
  { method: 'GET', path: '/api/v1/auth/me', expect: [401] },
  { method: 'GET', path: '/api/v1/tools/my-access', expect: [401] },
  { method: 'GET', path: '/api/v1/admin/users', expect: [401] },
  { method: 'GET', path: '/api/v1/dashboard/summary?brand_id=1', expect: [401] },
  { method: 'GET', path: '/api/v1/campaigns/1', expect: [401] },
  { method: 'GET', path: '/api/v1/campaigns/1/stats', expect: [401] },
  { method: 'GET', path: '/api/v1/listening/keyword-groups/1', expect: [401] },
  { method: 'GET', path: '/api/v1/listening/runs/1', expect: [401] },
  { method: 'GET', path: '/api/v1/listening/feed/1', expect: [401] },
  { method: 'GET', path: '/api/v1/rt/queue/1', expect: [401] },
  { method: 'GET', path: '/api/v1/rt/webhook/meta', expect: [403] },
  {
    method: 'POST',
    path: '/api/v1/rt/events/convert',
    body: { brand_id: 1, short_code: 'demo' },
    expect: [200, 400],
    dbBacked: true,
  },
  { method: 'POST', path: '/api/v1/onboarding/client-signup', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/ingest', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/cluster', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/strategize', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/reply', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/kpi', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/creative/score', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/insights/run', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/warroom/snapshot', body: {}, expect: [401] },
  { method: 'POST', path: '/api/v1/attribution/links', body: {}, expect: [401] },
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await wait(300);
  }
  throw new Error('server did not become ready in 15s');
}

async function checkEndpoint(endpoint) {
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    method: endpoint.method,
    headers: endpoint.body ? { 'Content-Type': 'application/json' } : undefined,
    body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
  });

  const accepted = endpoint.expect.includes(response.status);
  const noServerError = response.status < 500;
  const passed = accepted && noServerError;
  return {
    ...endpoint,
    status: response.status,
    passed,
  };
}

async function main() {
  const env = {
    ...process.env,
    PORT: String(port),
    DISABLE_AUTOMATION_AUTOSTART: 'true',
    ENABLE_SWAGGER: process.env.ENABLE_SWAGGER ?? 'true',
  };

  const child = providedBaseUrl
    ? null
    : spawn(process.execPath, ['dist/server.js'], {
        cwd: new URL('..', import.meta.url),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

  child?.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  child?.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));

  try {
    if (child) await waitForServer(child);
    const results = [];
    for (const endpoint of endpoints.filter(endpoint => includeDbBackedChecks || !endpoint.dbBacked)) {
      results.push(await checkEndpoint(endpoint));
    }

    const failed = results.filter(result => !result.passed);
    for (const result of results) {
      const label = result.passed ? 'PASS' : 'FAIL';
      console.log(`${label} ${result.method} ${result.path} -> ${result.status}`);
    }

    if (failed.length) {
      process.exitCode = 1;
      return;
    }

    console.log(`[EndpointCheck] ${results.length} endpoint checks passed with no 5xx status errors`);
    if (!includeDbBackedChecks) {
      console.log('[EndpointCheck] DB-backed public conversion check skipped locally. Set ENDPOINT_CHECK_DB=true or ENDPOINT_BASE_URL=https://... to include it.');
    }
  } finally {
    child?.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('[EndpointCheck] Failed:', err.message);
  process.exitCode = 1;
});
