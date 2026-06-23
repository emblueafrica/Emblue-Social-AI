import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') args.json = true;
    else if (item === '--brand-id') args.brandId = Number(argv[++index]);
    else if (item.startsWith('--brand-id=')) args.brandId = Number(item.split('=')[1]);
    else if (item === '--campaign-id') args.campaignId = Number(argv[++index]);
    else if (item.startsWith('--campaign-id=')) args.campaignId = Number(item.split('=')[1]);
  }
  return args;
}

function envFlag(name) {
  return Boolean(process.env[name]?.trim());
}

function stringify(value) {
  return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? Number(inner) : inner), 2);
}

function deliveryChannels(replyMode) {
  if (replyMode === 'dm_only') return ['direct_message'];
  if (replyMode === 'dm_with_public_fallback') return ['public_reply', 'direct_message'];
  return ['public_reply'];
}

function statusBucket(rows, key = 'status') {
  return rows.reduce((acc, row) => {
    const value = row[key] ?? 'unknown';
    acc[value] = (acc[value] ?? 0) + (row._count?._all ?? 1);
    return acc;
  }, {});
}

async function resolveBrandId(inputBrandId) {
  if (Number.isInteger(inputBrandId) && inputBrandId > 0) return inputBrandId;
  const campaign = await prisma.engageCampaign.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { brandId: true },
  });
  if (campaign) return campaign.brandId;
  const brand = await prisma.brand.findFirst({ orderBy: { brandId: 'asc' }, select: { brandId: true } });
  return brand?.brandId ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const brandId = await resolveBrandId(args.brandId);
  if (!brandId) {
    console.error('No brand or campaign data found.');
    process.exitCode = 1;
    return;
  }

  const whereCampaign = {
    brandId,
    ...(Number.isInteger(args.campaignId) && args.campaignId > 0 ? { campaignId: BigInt(args.campaignId) } : {}),
  };
  const campaigns = await prisma.engageCampaign.findMany({
    where: whereCampaign,
    orderBy: { updatedAt: 'desc' },
    take: 25,
  });
  const campaignIds = campaigns.map(campaign => campaign.campaignId);

  const [
    keywordGroups,
    recentSearchRuns,
    postUrls,
    engagerStatusGroups,
    deliveryStatusGroups,
    deliveryChannelGroups,
    queuedDeliveries,
    approvalRows,
  ] = await Promise.all([
    prisma.keywordGroup.findMany({
      where: { brandId, ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}) },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.searchRun.findMany({
      where: { brandId, ...(campaignIds.length ? { groupId: { in: [] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch(() => []),
    prisma.campaignPostUrl.findMany({
      where: { brandId, ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}) },
      orderBy: { submittedAt: 'desc' },
      take: 25,
    }),
    prisma.campaignPostEngager.groupBy({
      by: ['campaignId', 'status'],
      where: { brandId, ...(campaignIds.length ? { campaignId: { in: campaignIds.map(String) } } : {}) },
      _count: { _all: true },
    }),
    prisma.campaignDeliveryAttempt.groupBy({
      by: ['campaignId', 'status'],
      where: { brandId, ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}) },
      _count: { _all: true },
    }),
    prisma.campaignDeliveryAttempt.groupBy({
      by: ['campaignId', 'channel', 'status'],
      where: { brandId, ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}) },
      _count: { _all: true },
    }),
    prisma.campaignDeliveryAttempt.findMany({
      where: {
        brandId,
        ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}),
        status: { in: ['queued', 'processing', 'needs_review', 'manual_action_required', 'failed', 'rate_limited'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.approvalQueue.findMany({
      where: { brandId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  const queuedEngagers = queuedDeliveries.length
    ? await prisma.campaignPostEngager.findMany({
        where: { engagerId: { in: queuedDeliveries.map(item => item.engagerId) } },
      })
    : [];
  const queuedEngagerById = new Map(queuedEngagers.map(item => [String(item.engagerId), item]));

  const keywordGroupIds = keywordGroups.map(group => group.groupId);
  const keywordRuns = keywordGroupIds.length
    ? await prisma.searchRun.findMany({
        where: { brandId, groupId: { in: keywordGroupIds } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : recentSearchRuns;

  const issues = [];
  const warnings = [];

  if (!envFlag('REDIS_URL')) issues.push('REDIS_URL is not configured, so campaign activation/delivery jobs cannot run in production.');
  if (!envFlag('APIFY_API_TOKEN')) warnings.push('APIFY_API_TOKEN is not configured, so keyword campaigns cannot discover platform keyword matches.');
  if (!envFlag('ANTHROPIC_API_KEY') && !envFlag('OPENAI_API_KEY')) issues.push('No AI provider key is configured, so reply generation will fall back or fail.');

  const campaignSummaries = campaigns.map(campaign => {
    const id = String(campaign.campaignId);
    const requiredChannels = deliveryChannels(campaign.replyMode);
    const campaignEngagerGroups = engagerStatusGroups.filter(row => row.campaignId === id);
    const campaignDeliveryGroups = deliveryStatusGroups.filter(row => row.campaignId === campaign.campaignId);
    const campaignChannelGroups = deliveryChannelGroups.filter(row => row.campaignId === campaign.campaignId);
    const sentDeliveries = campaignDeliveryGroups
      .filter(row => row.status === 'sent')
      .reduce((total, row) => total + row._count._all, 0);
    if ((campaign.totalSent ?? 0) !== sentDeliveries) {
      issues.push(`Campaign ${id} totalSent=${campaign.totalSent ?? 0} but sent delivery attempts=${sentDeliveries}.`);
    }
    if (campaign.sourceMode === 'keyword') {
      const group = keywordGroups.find(item => String(item.campaignId) === id);
      if (!group) issues.push(`Keyword campaign ${id} has no hidden keyword group.`);
      else if (!group.isActive && campaign.isActive) issues.push(`Keyword campaign ${id} is active but its hidden keyword group is inactive.`);
      const lastRun = group ? keywordRuns.find(run => run.groupId && run.groupId === group.groupId) : null;
      if (campaign.isActive && !lastRun) warnings.push(`Keyword campaign ${id} has not run a keyword search yet.`);
      if (lastRun?.status === 'failed') issues.push(`Keyword campaign ${id} latest search failed: ${lastRun.errorMsg ?? 'unknown error'}.`);
    }
    return {
      id: Number(campaign.campaignId),
      name: campaign.name,
      mode: campaign.mode,
      source_mode: campaign.sourceMode,
      active: campaign.isActive,
      activation_status: campaign.activationStatus,
      reply_mode: campaign.replyMode,
      required_channels: requiredChannels,
      platforms: campaign.platforms,
      keywords: campaign.keywords,
      total_sent_cached: campaign.totalSent ?? 0,
      engager_statuses: statusBucket(campaignEngagerGroups),
      delivery_statuses: statusBucket(campaignDeliveryGroups),
      delivery_channels: campaignChannelGroups.map(row => ({
        channel: row.channel,
        status: row.status,
        count: row._count._all,
      })),
    };
  });

  for (const campaign of campaigns) {
    const id = String(campaign.campaignId);
    const expected = deliveryChannels(campaign.replyMode);
    const eligibleEngagers = await prisma.campaignPostEngager.findMany({
      where: {
        brandId,
        campaignId: id,
        status: { notIn: ['ignored_keyword', 'ignored_intent', 'ignored_urgency', 'bot_blocked', 'dismissed'] },
      },
      take: 250,
    });
    const deliveryAttempts = eligibleEngagers.length
      ? await prisma.campaignDeliveryAttempt.findMany({
          where: { brandId, engagerId: { in: eligibleEngagers.map(item => item.engagerId) } },
        })
      : [];
    const deliveriesByEngager = new Map();
    for (const delivery of deliveryAttempts) {
      const key = String(delivery.engagerId);
      deliveriesByEngager.set(key, [...(deliveriesByEngager.get(key) ?? []), delivery]);
    }
    for (const engager of eligibleEngagers) {
      const existing = new Set((deliveriesByEngager.get(String(engager.engagerId)) ?? []).map(delivery => delivery.channel));
      for (const channel of expected) {
        if (!existing.has(channel) && !['needs_review', 'setup_required'].includes(engager.status)) {
          issues.push(`Campaign ${id} engager ${engager.engagerId} is missing ${channel} delivery attempt.`);
          break;
        }
      }
    }
  }

  const blankCampaignQueueItems = queuedDeliveries.filter(item => !queuedEngagerById.get(String(item.engagerId))?.replyText?.trim());
  if (blankCampaignQueueItems.length) {
    issues.push(`${blankCampaignQueueItems.length} campaign queue item(s) have no prepared AI reply text.`);
  }
  const blankApprovalRows = approvalRows.filter(item => !item.replyText?.trim());
  if (blankApprovalRows.length) {
    issues.push(`${blankApprovalRows.length} pending non-campaign approval row(s) have no AI reply text.`);
  }

  const report = {
    ok: issues.length === 0,
    brand_id: brandId,
    env: {
      redis_url: envFlag('REDIS_URL'),
      apify_api_token: envFlag('APIFY_API_TOKEN'),
      anthropic_api_key: envFlag('ANTHROPIC_API_KEY'),
      openai_api_key: envFlag('OPENAI_API_KEY'),
      x_client_id: envFlag('X_CLIENT_ID'),
      x_client_secret: envFlag('X_CLIENT_SECRET'),
      x_redirect_uri: envFlag('X_REDIRECT_URI'),
      meta_app_id: envFlag('META_APP_ID'),
      meta_app_secret: envFlag('META_APP_SECRET'),
    },
    campaigns: campaignSummaries,
    keyword_groups: keywordGroups.map(group => ({
      group_id: Number(group.groupId),
      campaign_id: group.campaignId ? Number(group.campaignId) : null,
      active: group.isActive,
      keywords: group.keywords,
      platforms: group.platforms,
      last_run_at: group.lastRunAt,
    })),
    keyword_runs: keywordRuns.map(run => ({
      run_id: Number(run.runId),
      group_id: run.groupId ? Number(run.groupId) : null,
      status: run.status,
      total_results: run.totalResults,
      error: run.errorMsg,
      created_at: run.createdAt,
      completed_at: run.completedAt,
    })),
    post_urls: postUrls.map(post => ({
      url_id: Number(post.urlId),
      campaign_id: post.campaignId ? Number(post.campaignId) : null,
      platform: post.platform,
      status: post.status,
      binding_status: post.bindingStatus,
      post_id_ext: post.postIdExt,
      total_fetched: post.totalFetched,
      error: post.errorMsg,
    })),
    queue: {
      pending_approval_rows: approvalRows.length,
      pending_approval_rows_without_reply: blankApprovalRows.length,
      campaign_delivery_queue_rows: queuedDeliveries.length,
      campaign_delivery_rows_without_reply: blankCampaignQueueItems.length,
      campaign_delivery_statuses: statusBucket(queuedDeliveries),
    },
    warnings,
    issues,
  };

  if (args.json) {
    console.log(stringify(report));
  } else {
    console.log(`Campaign lifecycle diagnostic for brand ${brandId}`);
    console.log(`Status: ${report.ok ? 'OK' : 'ISSUES FOUND'}`);
    console.log(`Env: Redis=${report.env.redis_url ? 'yes' : 'no'}, Apify=${report.env.apify_api_token ? 'yes' : 'no'}, AI=${report.env.anthropic_api_key || report.env.openai_api_key ? 'yes' : 'no'}`);
    console.log('\nCampaigns');
    for (const campaign of report.campaigns) {
      console.log(`- #${campaign.id} ${campaign.name} [${campaign.source_mode}/${campaign.reply_mode}] active=${campaign.active} sent=${campaign.total_sent_cached}`);
      console.log(`  engagers=${stringify(campaign.engager_statuses)} deliveries=${stringify(campaign.delivery_statuses)}`);
    }
    if (report.keyword_groups.length) {
      console.log('\nKeyword Groups');
      for (const group of report.keyword_groups) {
        console.log(`- campaign #${group.campaign_id}: active=${group.active} keywords=${group.keywords.join(', ')} platforms=${group.platforms.join(', ')} lastRun=${group.last_run_at ?? 'never'}`);
      }
    }
    console.log(`\nQueue: campaign=${report.queue.campaign_delivery_queue_rows}, blank campaign replies=${report.queue.campaign_delivery_rows_without_reply}, approvals=${report.queue.pending_approval_rows}, blank approvals=${report.queue.pending_approval_rows_without_reply}`);
    if (warnings.length) {
      console.log('\nWarnings');
      warnings.forEach(item => console.log(`- ${item}`));
    }
    if (issues.length) {
      console.log('\nIssues');
      issues.forEach(item => console.log(`- ${item}`));
    }
  }

  process.exitCode = issues.length ? 1 : 0;
}

main()
  .catch(error => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
