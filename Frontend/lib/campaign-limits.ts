export const CAMPAIGN_REPLY_TEMPLATE_LIMIT = 150;

export function clampCampaignReplyTemplate(value: string) {
  return value.slice(0, CAMPAIGN_REPLY_TEMPLATE_LIMIT);
}
