export const CAMPAIGN_REPLY_TEMPLATE_LIMIT = 150;

type CampaignReplyTemplates = {
  reply_template?: unknown;
  public_reply_template?: unknown;
  private_followup_template?: unknown;
};

export function validateCampaignReplyTemplates(input: CampaignReplyTemplates) {
  const templates = [input.reply_template, input.public_reply_template, input.private_followup_template];
  if (templates.some(value => typeof value === 'string' && value.length > CAMPAIGN_REPLY_TEMPLATE_LIMIT)) {
    return { ok: false as const, message: `Reply templates must be ${CAMPAIGN_REPLY_TEMPLATE_LIMIT} characters or fewer.` };
  }
  return { ok: true as const };
}
