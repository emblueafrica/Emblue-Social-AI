import assert from 'node:assert/strict';
import {
  eligibleForCampaign,
  evaluateKeywordCampaignEvent,
  validateKeywordCampaignInput,
  validateActivationRequest,
  validateMediaSet,
} from '../dist/campaigns/lifecycle.js';
import { resolveCampaignCapability } from '../dist/campaigns/capabilities.js';

assert.deepEqual(validateMediaSet([
  { mime_type: 'image/jpeg', size_bytes: 1024 },
  { mime_type: 'image/png', size_bytes: 2048 },
]), { ok: true, media_type: 'image' });

assert.equal(validateMediaSet([
  { mime_type: 'image/jpeg', size_bytes: 1024 },
  { mime_type: 'video/mp4', size_bytes: 2048 },
]).ok, false);

assert.equal(validateActivationRequest({
  source_mode: 'existing',
  platforms: ['x', 'instagram'],
  existing_posts: [{ platform: 'x', url: 'https://x.com/example/status/123' }],
  allocation: { x: 50, instagram: 50 },
}).ok, false);

assert.equal(validateActivationRequest({
  source_mode: 'existing',
  platforms: ['x'],
  existing_posts: [{ platform: 'x', url: 'https://x.com/example/status/123' }],
  allocation: { x: 100 },
}).ok, true);

assert.equal(eligibleForCampaign({ kind: 'comment', text: 'How much is this?' }, ['price', 'how much']), true);
assert.equal(eligibleForCampaign({ kind: 'comment', text: 'Nice post' }, ['price']), false);
assert.equal(eligibleForCampaign({ kind: 'like', text: '' }, ['price']), true);

assert.deepEqual(validateKeywordCampaignInput({
  keywords: ['GTBank problem'],
  platforms: ['x', 'instagram'],
  intent_filter: ['complaint'],
  confidence_threshold: 75,
  urgency_threshold: 3,
  max_per_day: 50,
  public_reply_enabled: true,
  direct_message_enabled: true,
}), { ok: true });

assert.equal(validateKeywordCampaignInput({
  keywords: [], platforms: ['x'], intent_filter: [], confidence_threshold: 75,
  urgency_threshold: 3, max_per_day: 50, public_reply_enabled: true, direct_message_enabled: false,
}).ok, false);

assert.equal(evaluateKeywordCampaignEvent({
  text: 'GTBank problem again', intent: 'complaint', urgency: 4, confidence: 80,
}, { keywords: ['GTBank problem'], intents: ['complaint'], urgencyThreshold: 3, confidenceThreshold: 75 }), null);
assert.equal(evaluateKeywordCampaignEvent({
  text: 'GTBank problem again', intent: 'praise', urgency: 4, confidence: 80,
}, { keywords: ['GTBank problem'], intents: ['complaint'], urgencyThreshold: 3, confidenceThreshold: 75 }), 'ignored_intent');
assert.equal(evaluateKeywordCampaignEvent({
  text: 'GTBank problem again', intent: 'complaint', urgency: 2, confidence: 80,
}, { keywords: ['GTBank problem'], intents: ['complaint'], urgencyThreshold: 3, confidenceThreshold: 75 }), 'ignored_urgency');
assert.equal(evaluateKeywordCampaignEvent({
  text: 'GTBank problem again', intent: 'complaint', urgency: 4, confidence: 60,
}, { keywords: ['GTBank problem'], intents: ['complaint'], urgencyThreshold: 3, confidenceThreshold: 75 }), 'needs_review');

assert.deepEqual(resolveCampaignCapability({
  platform: 'x',
  connected: true,
  scopes: 'tweet.read tweet.write users.read offline.access',
  discoveryConfigured: true,
}), {
  platform: 'x',
  keyword_discovery: 'automatic',
  public_reply: 'automatic',
  direct_message: 'setup_required',
  issues: ['Reconnect X with dm.read and dm.write after X grants Direct Message API access.'],
});

assert.equal(resolveCampaignCapability({
  platform: 'tiktok',
  connected: true,
  scopes: 'user.info.basic video.list',
  discoveryConfigured: true,
}).public_reply, 'setup_required');

assert.equal(resolveCampaignCapability({
  platform: 'instagram',
  connected: false,
  scopes: '',
  discoveryConfigured: true,
}).direct_message, 'connection_required');

console.log('campaign lifecycle checks passed');
