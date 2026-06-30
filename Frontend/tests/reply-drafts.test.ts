import assert from "node:assert/strict";
import { CAMPAIGN_REPLY_TEMPLATE_LIMIT, clampCampaignReplyTemplate } from "../lib/campaign-limits.ts";
import { resolveEditableReplyDraft } from "../lib/reply-drafts.ts";

assert.equal(resolveEditableReplyDraft("operator edit", "generated", "backend"), "operator edit");
assert.equal(resolveEditableReplyDraft(undefined, "generated", "backend"), "generated");
assert.equal(resolveEditableReplyDraft(undefined, undefined, "backend"), "backend");
assert.equal(resolveEditableReplyDraft(undefined, undefined, undefined), "");

assert.equal(CAMPAIGN_REPLY_TEMPLATE_LIMIT, 150);
assert.equal(clampCampaignReplyTemplate("a".repeat(151)).length, 150);

console.log("reply draft tests passed");
