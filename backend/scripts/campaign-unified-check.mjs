import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildCampaignDeliveryJobId,
  campaignModeFromSource,
  isPreviewFresh,
  selectLiveCampaign,
  verifyMetaWebhookSignature,
} from '../dist/campaigns/unified.js';

assert.equal(campaignModeFromSource('keyword'), 'keyword');
assert.equal(campaignModeFromSource('existing'), 'post_url');
assert.equal(campaignModeFromSource('publish_new'), 'post_url');

const selected = selectLiveCampaign([
  {
    campaignId: 11,
    priority: 10,
    platforms: ['x'],
    scopeType: 'all_owned_posts',
    keywords: ['bank'],
    intentFilter: ['complaint'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    campaignId: 12,
    priority: 10,
    platforms: ['x'],
    scopeType: 'selected_posts',
    selectedPostIds: ['post-1'],
    keywords: ['bank', 'failed transfer'],
    intentFilter: ['complaint'],
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  },
], {
  platform: 'x',
  postId: 'post-1',
  text: 'My bank failed transfer is unresolved',
  intent: 'complaint',
});

assert.equal(selected?.campaignId, 12, 'more specific campaign must own the event');
assert.equal(selectLiveCampaign([
  {
    campaignId: 13,
    priority: 20,
    platforms: ['instagram'],
    scopeType: 'all_owned_posts',
    keywords: [],
    intentFilter: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  },
], { platform: 'x', postId: 'post-1', text: 'hello', intent: 'inquiry' }), null);

assert.equal(buildCampaignDeliveryJobId(4, 19, 'public_reply'), 'campaign:4:19:public_reply');
assert.equal(isPreviewFresh(new Date('2026-06-22T10:00:00.000Z'), new Date('2026-06-22T10:14:59.000Z')), true);
assert.equal(isPreviewFresh(new Date('2026-06-22T10:00:00.000Z'), new Date('2026-06-22T10:15:01.000Z')), false);

const body = Buffer.from('{"entry":[]}');
const secret = 'test-secret';
const { createHmac } = await import('node:crypto');
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
assert.equal(verifyMetaWebhookSignature(body, signature, secret), true);
assert.equal(verifyMetaWebhookSignature(body, 'sha256=bad', secret), false);
assert.equal(verifyMetaWebhookSignature(body, signature, ''), false);

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
for (const [field, type] of [
  ['mode', 'CampaignMode'],
  ['platforms', 'Platform[]'],
  ['priority', 'Int'],
  ['scopeType', 'CampaignScopeType'],
  ['replyMode', 'CampaignReplyMode'],
  ['maxDmPerDay', 'Int'],
  ['spacingMinutes', 'Int'],
  ['modeConfig', 'Json'],
  ['previewFetchedAt', 'DateTime?'],
  ['bullJobId', 'String?'],
  ['scheduledAt', 'DateTime?'],
  ['profileClassification', 'String?'],
]) assert.match(schema, new RegExp(`\\b${field}\\s+${type.replace(/[?\[\]]/g, '\\$&')}`));

const migration = await readFile(new URL('../prisma/migrations/20260622150000_unified_engage_campaigns/migration.sql', import.meta.url), 'utf8');
assert.match(migration, /WHEN source_mode = 'keyword' THEN 'keyword'/);
assert.match(migration, /ELSE 'post_url'/);

const routes = await readFile(new URL('../src/routes/campaigns.ts', import.meta.url), 'utf8');
for (const route of [
  "router.get('/capabilities'",
  "router.get('/activity'",
  "router.post('/:campaign_id/post-urls/fetch'",
  "router.post('/:campaign_id/post-urls/run'",
  "router.get('/:campaign_id/progress'",
  "router.patch('/:campaign_id'",
  "router.post('/:campaign_id/pause'",
  "router.post('/:campaign_id/resume'",
]) assert.ok(routes.includes(route), `campaign routes must include ${route}`);

const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
assert.match(server, /rawBody/);
const realtime = await readFile(new URL('../src/routes/realtime.ts', import.meta.url), 'utf8');
assert.match(realtime, /verifyMetaWebhookSignature/);
const rateLimit = await readFile(new URL('../src/middleware/rateLimit.ts', import.meta.url), 'utf8');
assert.match(rateLimit, /WEBHOOK_LIMIT/);
assert.doesNotMatch(rateLimit, /path\.startsWith\('\/api\/v1\/rt\/webhook\/'\) return true/);

console.log('unified campaign checks passed');
