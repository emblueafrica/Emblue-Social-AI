import assert from 'node:assert/strict';
import {
  eligibleForCampaign,
  validateActivationRequest,
  validateMediaSet,
} from '../dist/campaigns/lifecycle.js';

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

console.log('campaign lifecycle checks passed');
