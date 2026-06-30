import assert from 'node:assert/strict';
import { CAMPAIGN_REPLY_TEMPLATE_LIMIT, validateCampaignReplyTemplates } from '../src/campaigns/templateValidation.ts';

assert.equal(CAMPAIGN_REPLY_TEMPLATE_LIMIT, 150);
assert.deepEqual(validateCampaignReplyTemplates({ reply_template: 'a'.repeat(150) }), { ok: true });
assert.deepEqual(validateCampaignReplyTemplates({ public_reply_template: 'a'.repeat(151) }), {
  ok: false,
  message: 'Reply templates must be 150 characters or fewer.',
});
assert.deepEqual(validateCampaignReplyTemplates({ private_followup_template: 'a'.repeat(151) }), {
  ok: false,
  message: 'Reply templates must be 150 characters or fewer.',
});

console.log('campaign template validation tests passed');
