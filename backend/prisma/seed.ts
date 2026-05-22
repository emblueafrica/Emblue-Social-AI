import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient, Platform, Sentiment, Intent, ApprovalStatus } from '@prisma/client';

const prisma = new PrismaClient();

const ALL_TOOL_IDS = [
  'tool_1',
  'tool_2',
  'tool_3',
  'tool_4',
  'tool_5',
  'tool_6',
  'tool_7',
  'tool_8',
  'tool_9',
  'tool_10',
];

const demo = {
  email: (process.env.DEMO_USER_EMAIL ?? 'demo@socialemblue.ai').trim().toLowerCase(),
  password: process.env.DEMO_USER_PASSWORD ?? 'DemoPass123!',
  fullName: process.env.DEMO_USER_NAME ?? 'Social Emblue Demo User',
  brandName: process.env.DEMO_BRAND_NAME ?? 'Emblue Demo Cafe',
  brandSlug: process.env.DEMO_BRAND_SLUG ?? 'emblue-demo-cafe',
  userId: process.env.DEMO_USER_ID,
};

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  msg?: string;
  error?: string;
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function createSupabaseUser(): Promise<string | null> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: demo.email,
      password: demo.password,
      email_confirm: true,
      user_metadata: { full_name: demo.fullName },
    }),
  });

  const payload = (await response.json().catch(() => null)) as SupabaseUserResponse | null;
  if (response.ok && payload?.id) return payload.id;

  const existing = await prisma.appUser.findUnique({ where: { email: demo.email }, select: { userId: true } });
  if (existing?.userId) return existing.userId;

  const message = payload?.msg ?? payload?.error ?? `status ${response.status}`;
  if (/already|registered|exists/i.test(message) && demo.userId) return demo.userId;

  throw new Error(`Supabase demo user creation failed: ${message}`);
}

async function resolveDemoUserId(): Promise<string> {
  const existing = await prisma.appUser.findUnique({ where: { email: demo.email }, select: { userId: true } });
  if (existing?.userId) return existing.userId;

  const supabaseUserId = await createSupabaseUser();
  if (supabaseUserId) return supabaseUserId;

  if (demo.userId) return demo.userId;

  const generated = randomUUID();
  console.warn('[Seed] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set.');
  console.warn('[Seed] Created database demo user only. For login, create a Supabase Auth user with this UUID or set DEMO_USER_ID.');
  return generated;
}

async function clearDemoBrandData(brandId: number): Promise<void> {
  const previousRuns = await prisma.searchRun.findMany({
    where: { brandId },
    select: { runId: true },
  });
  const previousRunIds = previousRuns.map(run => run.runId);

  await prisma.$transaction([
    prisma.campaignPostEngager.deleteMany({ where: { brandId } }),
    prisma.campaignPostUrl.deleteMany({ where: { brandId } }),
    prisma.campaignAsset.deleteMany({ where: { brandId } }),
    prisma.autoEngagement.deleteMany({ where: { brandId } }),
    prisma.engageCampaign.deleteMany({ where: { brandId } }),
    prisma.replyTemplate.deleteMany({ where: { brandId } }),
    prisma.approvalQueue.deleteMany({ where: { brandId } }),
    prisma.triggerRule.deleteMany({ where: { brandId } }),
    prisma.campaignMetric.deleteMany({ where: { brandId } }),
    prisma.connectedAccount.deleteMany({ where: { brandId } }),
    prisma.warRoom.deleteMany({ where: { brandId } }),
    prisma.painPoint.deleteMany({ where: { brandId } }),
    prisma.faqItem.deleteMany({ where: { brandId } }),
    prisma.insightRun.deleteMany({ where: { brandId } }),
    prisma.creativeScore.deleteMany({ where: { brandId } }),
    prisma.linkEvent.deleteMany({ where: { brandId } }),
    prisma.trackedLink.deleteMany({ where: { brandId } }),
    prisma.kpiSnapshot.deleteMany({ where: { brandId } }),
    prisma.dmEvent.deleteMany({ where: { brandId } }),
    prisma.funnel.deleteMany({ where: { brandId } }),
    prisma.replySuggestion.deleteMany({ where: { brandId } }),
    prisma.contentRecommendation.deleteMany({ where: { brandId } }),
    prisma.clusterItem.deleteMany({ where: { clusterId: null } }),
    prisma.cluster.deleteMany({ where: { brandId } }),
    previousRunIds.length
      ? prisma.searchVolume.deleteMany({ where: { runId: { in: previousRunIds } } })
      : prisma.searchVolume.deleteMany({ where: { runId: BigInt(-1) } }),
    prisma.searchResult.deleteMany({ where: { brandId } }),
    prisma.searchRun.deleteMany({ where: { brandId } }),
    prisma.keywordGroup.deleteMany({ where: { brandId } }),
    prisma.socialMessage.deleteMany({ where: { brandId } }),
  ]);
}

async function main(): Promise<void> {
  const userId = await resolveDemoUserId();

  const brand = await prisma.$transaction(async tx => {
    await tx.appUser.upsert({
      where: { userId },
      create: {
        userId,
        email: demo.email,
        fullName: demo.fullName,
        status: 'active',
      },
      update: {
        email: demo.email,
        fullName: demo.fullName,
        status: 'active',
        updatedAt: new Date(),
      },
    });

    await tx.platformUser.upsert({
      where: { userId_role: { userId, role: 'super_admin' } },
      create: { userId, role: 'super_admin', isActive: true },
      update: { isActive: true },
    });

    const demoBrand = await tx.brand.upsert({
      where: { slug: demo.brandSlug },
      create: {
        name: demo.brandName,
        slug: demo.brandSlug,
        accountType: 'internal',
        campaignObjective: 'Show a complete AI social listening, reply, attribution, and campaign command center.',
        tone: 'warm, sharp, practical',
        watchlistKeywords: ['late delivery', 'best coffee', 'refund', 'opening hours', 'customer service'],
        ownerUserId: userId,
      },
      update: {
        name: demo.brandName,
        accountType: 'internal',
        campaignObjective: 'Show a complete AI social listening, reply, attribution, and campaign command center.',
        tone: 'warm, sharp, practical',
        watchlistKeywords: ['late delivery', 'best coffee', 'refund', 'opening hours', 'customer service'],
        ownerUserId: userId,
        updatedAt: new Date(),
      },
    });

    await tx.brandMembership.upsert({
      where: { brandId_userId: { brandId: demoBrand.brandId, userId } },
      create: { brandId: demoBrand.brandId, userId, role: 'client_owner', isActive: true },
      update: { role: 'client_owner', isActive: true },
    });

    return demoBrand;
  });

  for (const toolId of ALL_TOOL_IDS) {
    await prisma.brandToolAccess.upsert({
      where: { brandId_toolId: { brandId: brand.brandId, toolId } },
      create: { brandId: brand.brandId, toolId, isActive: true, planName: 'demo_full_suite' },
      update: { isActive: true, planName: 'demo_full_suite', expiresAt: null },
    });
  }

  await clearDemoBrandData(brand.brandId);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  await prisma.socialMessage.createMany({
    data: [
      {
        brandId: brand.brandId,
        platform: Platform.instagram,
        kind: 'comment',
        externalId: 'demo-ig-001',
        text: 'The new oat latte is the best coffee I have had this month.',
        authorHandle: 'mariaeatsnyc',
        authorIdHash: hash('mariaeatsnyc'),
        url: 'https://instagram.com/p/demo-ig-001',
        sentiment: Sentiment.positive,
        intent: Intent.praise,
        urgencyScore: 2,
        topics: ['product love', 'coffee'],
        rawMetrics: { likes: 124, replies: 8 },
        capturedAt: twoDaysAgo,
      },
      {
        brandId: brand.brandId,
        platform: Platform.x,
        kind: 'mention',
        externalId: 'demo-x-001',
        text: 'Still waiting on my refund from Emblue Demo Cafe. Support said 24 hours and it has been three days.',
        authorHandle: 'jayneedshelp',
        authorIdHash: hash('jayneedshelp'),
        url: 'https://x.com/jayneedshelp/status/demo-x-001',
        sentiment: Sentiment.negative,
        intent: Intent.complaint,
        urgencyScore: 5,
        topics: ['refund', 'support'],
        rawMetrics: { likes: 19, replies: 6, reposts: 4 },
        capturedAt: yesterday,
      },
      {
        brandId: brand.brandId,
        platform: Platform.tiktok,
        kind: 'comment',
        externalId: 'demo-tt-001',
        text: 'Do you ship cold brew packs outside Lagos?',
        authorHandle: 'nifemidrinks',
        authorIdHash: hash('nifemidrinks'),
        url: 'https://tiktok.com/@embluedemo/video/demo-tt-001',
        sentiment: Sentiment.neutral,
        intent: Intent.inquiry,
        urgencyScore: 3,
        topics: ['shipping', 'cold brew'],
        rawMetrics: { likes: 44, replies: 2 },
        capturedAt: now,
      },
    ],
  });

  const keywordGroup = await prisma.keywordGroup.create({
    data: {
      brandId: brand.brandId,
      name: 'Demo Brand Monitoring',
      keywords: ['emblue demo cafe', 'late delivery', 'refund', 'cold brew', 'best coffee'],
      platforms: ['instagram', 'x', 'tiktok', 'facebook'],
      mode: 'realtime',
      alertUrgencyThreshold: 4,
      alertIntents: ['complaint', 'purchase_intent'],
      isActive: true,
      lastRunAt: now,
    },
  });

  const searchRun = await prisma.searchRun.create({
    data: {
      brandId: brand.brandId,
      groupId: keywordGroup.groupId,
      keywords: keywordGroup.keywords,
      platforms: keywordGroup.platforms,
      mode: 'historical',
      status: 'completed',
      totalResults: 3,
      positiveCount: 1,
      negativeCount: 1,
      neutralCount: 1,
      peakDate: yesterday,
      peakCount: 2,
      insightsSummary: 'Positive product love is strong, but refund complaints need immediate support follow-up.',
      completedAt: now,
    },
  });

  await prisma.searchResult.createMany({
    data: [
      {
        runId: searchRun.runId,
        brandId: brand.brandId,
        groupId: keywordGroup.groupId,
        matchedKeyword: 'best coffee',
        platform: Platform.instagram,
        text: 'The new oat latte is the best coffee I have had this month.',
        authorHandle: 'mariaeatsnyc',
        authorIdExt: 'demo-author-1',
        url: 'https://instagram.com/p/demo-ig-001',
        postedAt: twoDaysAgo,
        sentiment: Sentiment.positive,
        intent: Intent.praise,
        urgencyScore: 2,
        topics: ['product love', 'coffee'],
        likes: 124,
        repliesCount: 8,
        shares: 3,
        views: 4200,
      },
      {
        runId: searchRun.runId,
        brandId: brand.brandId,
        groupId: keywordGroup.groupId,
        matchedKeyword: 'refund',
        platform: Platform.x,
        text: 'Still waiting on my refund from Emblue Demo Cafe. Support said 24 hours and it has been three days.',
        authorHandle: 'jayneedshelp',
        authorIdExt: 'demo-author-2',
        url: 'https://x.com/jayneedshelp/status/demo-x-001',
        postedAt: yesterday,
        sentiment: Sentiment.negative,
        intent: Intent.complaint,
        urgencyScore: 5,
        topics: ['refund', 'support'],
        likes: 19,
        repliesCount: 6,
        shares: 4,
        views: 2100,
      },
      {
        runId: searchRun.runId,
        brandId: brand.brandId,
        groupId: keywordGroup.groupId,
        matchedKeyword: 'cold brew',
        platform: Platform.tiktok,
        text: 'Do you ship cold brew packs outside Lagos?',
        authorHandle: 'nifemidrinks',
        authorIdExt: 'demo-author-3',
        url: 'https://tiktok.com/@embluedemo/video/demo-tt-001',
        postedAt: now,
        sentiment: Sentiment.neutral,
        intent: Intent.inquiry,
        urgencyScore: 3,
        topics: ['shipping', 'cold brew'],
        likes: 44,
        repliesCount: 2,
        shares: 1,
        views: 9800,
      },
    ],
  });

  await prisma.searchVolume.createMany({
    data: [
      { runId: searchRun.runId, periodStart: twoDaysAgo, periodEnd: twoDaysAgo, mentionCount: 18, positiveCount: 12, negativeCount: 2, neutralCount: 4 },
      { runId: searchRun.runId, periodStart: yesterday, periodEnd: yesterday, mentionCount: 31, positiveCount: 16, negativeCount: 9, neutralCount: 6 },
      { runId: searchRun.runId, periodStart: now, periodEnd: now, mentionCount: 24, positiveCount: 13, negativeCount: 3, neutralCount: 8 },
    ],
  });

  const cluster = await prisma.cluster.create({
    data: {
      brandId: brand.brandId,
      label: 'Refund support and delivery timing',
      opportunityScore: 88,
      messageCount: 14,
      topPhrases: ['refund delay', 'support response', 'delivery timing'],
      recommendations: [
        'Pin a refund timeline post for the next 72 hours.',
        'Create a saved reply for late refund complaints.',
        'Route refund comments to a human approver.',
      ],
    },
  });

  await prisma.contentRecommendation.createMany({
    data: [
      {
        brandId: brand.brandId,
        clusterId: cluster.clusterId,
        platform: Platform.instagram,
        format: 'carousel',
        headline: 'How refunds work at Emblue Demo Cafe',
        brief: 'Clarify timelines, support channels, and escalation steps.',
        status: 'idea',
      },
      {
        brandId: brand.brandId,
        clusterId: cluster.clusterId,
        platform: Platform.tiktok,
        format: 'short_video',
        headline: 'Cold brew delivery FAQ',
        brief: 'Answer shipping and storage questions with a concise founder-led clip.',
        status: 'idea',
      },
    ],
  });

  await prisma.replySuggestion.createMany({
    data: [
      {
        brandId: brand.brandId,
        text: 'Thanks for flagging this. Please DM your order number and we will check the refund status right away.',
        tone: 'calm',
        confidence: 91,
        riskFlags: ['needs_human_review'],
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        text: 'Yes, we ship cold brew packs nationwide. Delivery estimates depend on your city.',
        tone: 'helpful',
        confidence: 94,
        riskFlags: [],
        status: ApprovalStatus.approved,
      },
    ],
  });

  const funnel = await prisma.funnel.create({
    data: {
      brandId: brand.brandId,
      platform: Platform.instagram,
      keywords: ['cold brew', 'ship', 'delivery'],
      maxPerHour: 20,
      delaySec: 45,
      destUrl: 'https://demo.socialemblue.ai/cold-brew',
      isActive: true,
    },
  });

  const trackedLink = await prisma.trackedLink.create({
    data: {
      brandId: brand.brandId,
      shortCode: 'demo-coldbrew',
      destUrl: 'https://demo.socialemblue.ai/cold-brew',
      campaign: 'Cold Brew Demo Launch',
      platform: Platform.instagram,
      contentType: 'dm_cta',
      clicks: 126,
      conversions: 18,
    },
  });

  await prisma.linkEvent.createMany({
    data: [
      { brandId: brand.brandId, linkId: trackedLink.linkId, eventType: 'click', ipHash: hash('127.0.0.1'), userAgent: 'Demo Browser' },
      { brandId: brand.brandId, linkId: trackedLink.linkId, eventType: 'conversion', ipHash: hash('127.0.0.2'), userAgent: 'Demo Browser' },
    ],
  });

  await prisma.dmEvent.createMany({
    data: [
      {
        brandId: brand.brandId,
        funnelId: funnel.funnelId,
        authorHandle: 'nifemidrinks',
        dmSentAt: yesterday,
        openedAt: yesterday,
        clickedAt: now,
        converted: true,
      },
      {
        brandId: brand.brandId,
        funnelId: funnel.funnelId,
        authorHandle: 'coffeehunter',
        dmSentAt: now,
        openedAt: now,
        converted: false,
      },
    ],
  });

  await prisma.kpiSnapshot.create({
    data: {
      brandId: brand.brandId,
      periodStart: twoDaysAgo,
      periodEnd: now,
      listeningKpi: 82.4,
      replyKpi: 91.2,
      funnelKpi: 74.8,
      riskEvents: 2,
      kpis: [
        { label: 'Mentions', value: 73, delta: 18 },
        { label: 'Avg response time', value: '11m', delta: -32 },
        { label: 'Conversion rate', value: '14.3%', delta: 4.1 },
      ],
      alerts: [
        { severity: 'high', message: 'Refund complaints increased yesterday.' },
        { severity: 'medium', message: 'Cold brew shipping questions are trending.' },
      ],
    },
  });

  await prisma.insightRun.create({
    data: {
      brandId: brand.brandId,
      messagesProcessed: 73,
      faqsFound: 6,
      painPoints: 3,
      summary: 'Customers love the product quality but need clearer refund and delivery communication.',
    },
  });

  await prisma.faqItem.createMany({
    data: [
      { brandId: brand.brandId, question: 'Do you ship cold brew packs outside Lagos?', frequency: 17, platforms: ['instagram', 'tiktok'] },
      { brandId: brand.brandId, question: 'How long do refunds take?', frequency: 9, platforms: ['x', 'instagram'] },
    ],
  });

  await prisma.painPoint.createMany({
    data: [
      { brandId: brand.brandId, text: 'Refund expectations are unclear after support handoff.', severity: 'high', frequency: 9 },
      { brandId: brand.brandId, text: 'Delivery time estimates vary by platform response.', severity: 'medium', frequency: 6 },
    ],
  });

  await prisma.warRoom.create({
    data: {
      brandId: brand.brandId,
      health: 'amber',
      summary: 'Product sentiment is strong, but refund complaints need a visible response playbook.',
      alerts: [
        { severity: 'high', channel: 'x', message: 'Refund thread gaining traction.' },
        { severity: 'medium', channel: 'instagram', message: 'Shipping questions increasing.' },
      ],
      metrics: {
        mentions: 73,
        positive: 41,
        negative: 14,
        neutral: 18,
        avgResponseMinutes: 11,
      },
    },
  });

  await prisma.creativeScore.createMany({
    data: [
      {
        brandId: brand.brandId,
        platform: Platform.instagram,
        caption: 'Cold brew that survives Lagos traffic and still tastes like a good morning.',
        grade: 'A-',
        score: 88,
        analysis: { hook: 91, clarity: 86, cta: 78 },
      },
      {
        brandId: brand.brandId,
        platform: Platform.tiktok,
        caption: 'POV: your coffee arrives before your standup starts.',
        grade: 'B+',
        score: 82,
        analysis: { hook: 84, clarity: 80, cta: 76 },
      },
    ],
  });

  await prisma.campaignMetric.createMany({
    data: [
      { brandId: brand.brandId, campaign: 'Cold Brew Demo Launch', platform: Platform.instagram, metric: 'replies_sent', value: 64 },
      { brandId: brand.brandId, campaign: 'Cold Brew Demo Launch', platform: Platform.instagram, metric: 'clicks', value: 126 },
      { brandId: brand.brandId, campaign: 'Cold Brew Demo Launch', platform: Platform.instagram, metric: 'conversions', value: 18 },
    ],
  });

  await prisma.triggerRule.createMany({
    data: [
      { brandId: brand.brandId, keyword: 'refund', action: 'escalate_to_support', confidence: 90, isActive: true },
      { brandId: brand.brandId, keyword: 'cold brew', action: 'send_dm_link', confidence: 85, isActive: true },
    ],
  });

  await prisma.approvalQueue.createMany({
    data: [
      {
        brandId: brand.brandId,
        platform: Platform.x,
        replyText: 'We are checking this now. Please DM your order number so support can resolve it today.',
        confidence: 89,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.instagram,
        replyText: 'Thanks for the love. The oat latte is available all week.',
        confidence: 96,
        status: ApprovalStatus.approved,
      },
    ],
  });

  await prisma.replyTemplate.createMany({
    data: [
      {
        brandId: brand.brandId,
        name: 'Refund escalation',
        platform: Platform.x,
        triggerKeywords: ['refund', 'late', 'support'],
        templateText: 'Please DM your order number. We will check the refund status and update you today.',
        isActive: true,
        useCount: 12,
      },
      {
        brandId: brand.brandId,
        name: 'Cold brew shipping',
        platform: Platform.instagram,
        triggerKeywords: ['cold brew', 'ship', 'delivery'],
        templateText: 'Yes, we ship cold brew packs nationwide. Tap the link for current delivery windows.',
        isActive: true,
        useCount: 31,
      },
    ],
  });

  const campaign = await prisma.engageCampaign.create({
    data: {
      brandId: brand.brandId,
      name: 'Cold Brew Demo Launch',
      platform: Platform.instagram,
      postIds: ['demo-ig-001', 'demo-ig-002'],
      keywords: ['cold brew', 'ship', 'coffee'],
      engageAll: true,
      engageNegative: false,
      tone: 'friendly and direct',
      replyTemplate: 'Thanks for asking. We ship cold brew packs nationwide.',
      fallbackTemplate: 'Thanks for reaching out. Our team can help in DM.',
      ctaLink: trackedLink.destUrl,
      trackedLinkCode: trackedLink.shortCode,
      autoFireThreshold: 88,
      maxPerHour: 45,
      isActive: true,
      totalSent: 64,
      platformAllocation: { instagram: 60, facebook: 20, tiktok: 20 },
      includeLikers: true,
      includeCommenters: true,
    },
  });

  await prisma.autoEngagement.createMany({
    data: [
      {
        brandId: brand.brandId,
        campaignId: campaign.campaignId,
        platform: Platform.instagram,
        authorHandle: 'nifemidrinks',
        originalText: 'Do you ship cold brew packs outside Lagos?',
        replyText: 'Yes, we ship nationwide. Check the link for delivery windows.',
        trackedLink: trackedLink.shortCode,
        status: 'sent',
        firedAt: now,
      },
      {
        brandId: brand.brandId,
        campaignId: campaign.campaignId,
        platform: Platform.instagram,
        authorHandle: 'coffeehunter',
        originalText: 'Need this for my office fridge.',
        replyText: 'We can help with office packs. Sending details by DM.',
        trackedLink: trackedLink.shortCode,
        status: 'queued',
      },
    ],
  });

  await prisma.campaignAsset.create({
    data: {
      brandId: brand.brandId,
      campaignId: String(campaign.campaignId),
      imageUrl: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735',
      isActive: true,
    },
  });

  await prisma.campaignPostUrl.create({
    data: {
      brandId: brand.brandId,
      campaignId: campaign.campaignId,
      platform: Platform.instagram,
      postUrl: 'https://instagram.com/p/demo-ig-001',
      postIdExt: 'demo-ig-001',
      includeCommenters: true,
      includeLikers: true,
      status: 'completed',
      totalFetched: 128,
      completedAt: now,
    },
  });

  await prisma.campaignPostEngager.createMany({
    data: [
      {
        brandId: brand.brandId,
        campaignId: String(campaign.campaignId),
        platform: Platform.instagram,
        action: 'comment',
        authorId: 'demo-author-3',
        authorHandle: 'nifemidrinks',
        originalText: 'Do you ship cold brew packs outside Lagos?',
        status: 'processed',
        processedAt: now,
      },
      {
        brandId: brand.brandId,
        campaignId: String(campaign.campaignId),
        platform: Platform.instagram,
        action: 'like',
        authorId: 'demo-author-4',
        authorHandle: 'coffeehunter',
        status: 'pending',
      },
    ],
  });

  console.log('[Seed] Demo database is ready');
  console.log(`email=${demo.email}`);
  console.log('password=[redacted]');
  console.log(`user_id=${userId}`);
  console.log(`brand_id=${brand.brandId}`);
  console.log(`brand_slug=${brand.slug}`);
  console.log(`tools=${ALL_TOOL_IDS.join(',')}`);
}

main()
  .catch(error => {
    console.error('[Seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
