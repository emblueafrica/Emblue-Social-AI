import { CampaignPlatform } from './lifecycle';

export type CampaignChannelStatus =
  | 'automatic'
  | 'setup_required'
  | 'connection_required';

export type CampaignCapability = {
  platform: CampaignPlatform;
  keyword_discovery: CampaignChannelStatus;
  public_reply: CampaignChannelStatus;
  direct_message: CampaignChannelStatus;
  issues: string[];
};

type CapabilityInput = {
  platform: CampaignPlatform;
  connected: boolean;
  scopes: string | null | undefined;
  discoveryConfigured: boolean;
  publicReplyEnabled?: boolean;
  directMessageEnabled?: boolean;
};

function scopeSet(scopes: string | null | undefined): Set<string> {
  return new Set(
    String(scopes ?? '')
      .split(/[,\s]+/)
      .map(scope => scope.trim())
      .filter(Boolean),
  );
}

function hasEvery(scopes: Set<string>, required: string[]): boolean {
  return required.every(scope => scopes.has(scope));
}

export function resolveCampaignCapability(input: CapabilityInput): CampaignCapability {
  const scopes = scopeSet(input.scopes);
  const disconnected: CampaignChannelStatus = input.connected ? 'setup_required' : 'connection_required';
  const issues: string[] = [];
  const publicReplyEnabled = input.publicReplyEnabled !== false;
  const directMessageEnabled = input.directMessageEnabled !== false;

  let publicReply: CampaignChannelStatus = disconnected;
  let directMessage: CampaignChannelStatus = disconnected;

  if (input.connected) {
    if (input.platform === 'x') {
      publicReply = hasEvery(scopes, ['tweet.read', 'tweet.write', 'users.read'])
        ? 'automatic'
        : 'setup_required';
      directMessage = hasEvery(scopes, ['dm.read', 'dm.write'])
        ? 'automatic'
        : 'setup_required';
      if (publicReplyEnabled && publicReply !== 'automatic') {
        issues.push('Reconnect X with tweet.read, tweet.write and users.read.');
      }
      if (directMessageEnabled && directMessage !== 'automatic') {
        issues.push('Reconnect X with dm.read and dm.write after X grants Direct Message API access.');
      }
    } else if (input.platform === 'tiktok') {
      publicReply = scopes.has('video.comment') ? 'automatic' : 'setup_required';
      directMessage = scopes.has('direct_message') || scopes.has('message.send')
        ? 'automatic'
        : 'setup_required';
      if (publicReplyEnabled && publicReply !== 'automatic') {
        issues.push('TikTok comment replies require approved video.comment access.');
      }
      if (directMessageEnabled && directMessage !== 'automatic') {
        issues.push('TikTok direct messages require an approved messaging product and scope.');
      }
    } else if (input.platform === 'instagram') {
      publicReply = scopes.has('instagram_manage_comments') ? 'automatic' : 'setup_required';
      directMessage = scopes.has('instagram_manage_messages') ? 'automatic' : 'setup_required';
      if (publicReplyEnabled && publicReply !== 'automatic') {
        issues.push('Instagram comment replies require instagram_manage_comments.');
      }
      if (directMessageEnabled && directMessage !== 'automatic') {
        issues.push('Instagram private replies require instagram_manage_messages and an eligible comment conversation.');
      }
    } else {
      publicReply = scopes.has('pages_manage_engagement') ? 'automatic' : 'setup_required';
      directMessage = scopes.has('pages_messaging') ? 'automatic' : 'setup_required';
      if (publicReplyEnabled && publicReply !== 'automatic') {
        issues.push('Facebook comment replies require pages_manage_engagement.');
      }
      if (directMessageEnabled && directMessage !== 'automatic') {
        issues.push('Facebook direct messages require pages_messaging and an eligible conversation.');
      }
    }
  } else {
    issues.push(`Connect ${input.platform === 'x' ? 'X' : input.platform} before enabling outbound delivery.`);
  }

  if (!input.discoveryConfigured) {
    issues.unshift('Keyword discovery requires a configured search provider.');
  }

  return {
    platform: input.platform,
    keyword_discovery: input.discoveryConfigured ? 'automatic' : 'setup_required',
    public_reply: publicReply,
    direct_message: directMessage,
    issues,
  };
}
