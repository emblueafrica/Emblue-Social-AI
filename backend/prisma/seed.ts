import "dotenv/config";
import { randomUUID, createHash } from "node:crypto";
import {
  PrismaClient,
  Platform,
  Sentiment,
  Intent,
  ApprovalStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const ALL_TOOL_IDS = [
  "tool_1",
  "tool_2",
  "tool_3",
  "tool_4",
  "tool_5",
  "tool_6",
  "tool_7",
  "tool_8",
  "tool_9",
  "tool_10",
];

const demo = {
  email: (process.env.DEMO_USER_EMAIL ?? "demo@socialemblue.ai")
    .trim()
    .toLowerCase(),
  password: process.env.DEMO_USER_PASSWORD ?? "DemoPass123!",
  fullName: process.env.DEMO_USER_NAME ?? "Social Emblue Demo User",
  brandName: process.env.DEMO_BRAND_NAME ?? "Emblue Demo Cafe",
  brandSlug: process.env.DEMO_BRAND_SLUG ?? "emblue-demo-cafe",
  userId: process.env.DEMO_USER_ID,
};

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  msg?: string;
  error?: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createSupabaseUser(): Promise<string | null> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: demo.email,
      password: demo.password,
      email_confirm: true,
      user_metadata: { full_name: demo.fullName },
    }),
  });

  const payload = (await response
    .json()
    .catch(() => null)) as SupabaseUserResponse | null;
  if (response.ok && payload?.id) return payload.id;

  const existing = await prisma.appUser.findUnique({
    where: { email: demo.email },
    select: { userId: true },
  });
  if (existing?.userId) return existing.userId;

  const message = payload?.msg ?? payload?.error ?? `status ${response.status}`;
  if (/already|registered|exists/i.test(message) && demo.userId)
    return demo.userId;

  throw new Error(`Supabase demo user creation failed: ${message}`);
}

async function resolveDemoUserId(): Promise<string> {
  const existing = await prisma.appUser.findUnique({
    where: { email: demo.email },
    select: { userId: true },
  });
  if (existing?.userId) return existing.userId;

  const supabaseUserId = await createSupabaseUser();
  if (supabaseUserId) return supabaseUserId;

  if (demo.userId) return demo.userId;

  const generated = randomUUID();
  console.warn("[Seed] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set.");
  console.warn(
    "[Seed] Created database demo user only. For login, create a Supabase Auth user with this UUID or set DEMO_USER_ID.",
  );
  return generated;
}

async function clearDemoBrandData(brandId: number): Promise<void> {
  const previousRuns = await prisma.searchRun.findMany({
    where: { brandId },
    select: { runId: true },
  });
  const previousRunIds = previousRuns.map((run) => run.runId);

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
      ? prisma.searchVolume.deleteMany({
          where: { runId: { in: previousRunIds } },
        })
      : prisma.searchVolume.deleteMany({ where: { runId: BigInt(-1) } }),
    prisma.searchResult.deleteMany({ where: { brandId } }),
    prisma.searchRun.deleteMany({ where: { brandId } }),
    prisma.keywordGroup.deleteMany({ where: { brandId } }),
    prisma.socialMessage.deleteMany({ where: { brandId } }),
  ]);
}

async function main(): Promise<void> {
  const userId = await resolveDemoUserId();

  const brand = await prisma.$transaction(async (tx) => {
    await tx.appUser.upsert({
      where: { userId },
      create: {
        userId,
        email: demo.email,
        fullName: demo.fullName,
        status: "active",
      },
      update: {
        email: demo.email,
        fullName: demo.fullName,
        status: "active",
        updatedAt: new Date(),
      },
    });

    await tx.platformUser.upsert({
      where: { userId_role: { userId, role: "super_admin" } },
      create: { userId, role: "super_admin", isActive: true },
      update: { isActive: true },
    });

    const demoBrand = await tx.brand.upsert({
      where: { slug: demo.brandSlug },
      create: {
        name: demo.brandName,
        slug: demo.brandSlug,
        accountType: "internal",
        campaignObjective:
          "Show a complete AI social listening, reply, attribution, and campaign command center.",
        tone: "warm, sharp, practical",
        watchlistKeywords: [
          "late delivery",
          "best coffee",
          "refund",
          "opening hours",
          "customer service",
        ],
        ownerUserId: userId,
      },
      update: {
        name: demo.brandName,
        accountType: "internal",
        campaignObjective:
          "Show a complete AI social listening, reply, attribution, and campaign command center.",
        tone: "warm, sharp, practical",
        watchlistKeywords: [
          "late delivery",
          "best coffee",
          "refund",
          "opening hours",
          "customer service",
        ],
        ownerUserId: userId,
        updatedAt: new Date(),
      },
    });

    await tx.brandMembership.upsert({
      where: { brandId_userId: { brandId: demoBrand.brandId, userId } },
      create: {
        brandId: demoBrand.brandId,
        userId,
        role: "client_owner",
        isActive: true,
      },
      update: { role: "client_owner", isActive: true },
    });

    return demoBrand;
  });

  for (const toolId of ALL_TOOL_IDS) {
    await prisma.brandToolAccess.upsert({
      where: { brandId_toolId: { brandId: brand.brandId, toolId } },
      create: {
        brandId: brand.brandId,
        toolId,
        isActive: true,
        planName: "demo_full_suite",
      },
      update: { isActive: true, planName: "demo_full_suite", expiresAt: null },
    });
  }

  await clearDemoBrandData(brand.brandId);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const daysAgo = (n: number): Date =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const messageSeed: {
    platform: Platform;
    kind: string;
    text: string;
    handle: string;
    sentiment: Sentiment;
    intent: Intent;
    urgency: number;
    topics: string[];
    day: number;
    metrics: Record<string, number>;
  }[] = [
    {
      platform: Platform.instagram,
      kind: "comment",
      text: "The new oat latte is the best coffee I have had this month.",
      handle: "mariaeatsnyc",
      sentiment: Sentiment.positive,
      intent: Intent.praise,
      urgency: 2,
      topics: ["product love", "coffee"],
      day: 6,
      metrics: { likes: 124, replies: 8 },
    },
    {
      platform: Platform.x,
      kind: "mention",
      text: "Still waiting on my refund from Emblue Demo Cafe. Support said 24 hours and it has been three days.",
      handle: "jayneedshelp",
      sentiment: Sentiment.negative,
      intent: Intent.complaint,
      urgency: 5,
      topics: ["refund", "support"],
      day: 6,
      metrics: { likes: 19, replies: 6, reposts: 4 },
    },
    {
      platform: Platform.tiktok,
      kind: "comment",
      text: "Do you ship cold brew packs outside Lagos?",
      handle: "nifemidrinks",
      sentiment: Sentiment.neutral,
      intent: Intent.inquiry,
      urgency: 3,
      topics: ["shipping", "cold brew"],
      day: 5,
      metrics: { likes: 44, replies: 2 },
    },
    {
      platform: Platform.instagram,
      kind: "comment",
      text: "Came for the latte art, stayed for the playlist. Whole vibe.",
      handle: "lagosfoodie",
      sentiment: Sentiment.positive,
      intent: Intent.praise,
      urgency: 1,
      topics: ["ambience"],
      day: 5,
      metrics: { likes: 88, replies: 3 },
    },
    {
      platform: Platform.facebook,
      kind: "mention",
      text: "My discount code would not apply at checkout — a bit annoying.",
      handle: "adunni.so",
      sentiment: Sentiment.negative,
      intent: Intent.complaint,
      urgency: 4,
      topics: ["discount", "checkout"],
      day: 4,
      metrics: { likes: 7, replies: 5 },
    },
    {
      platform: Platform.x,
      kind: "mention",
      text: "Honestly the fastest support reply I have had from a cafe brand.",
      handle: "tunde_lagos",
      sentiment: Sentiment.positive,
      intent: Intent.praise,
      urgency: 2,
      topics: ["support"],
      day: 4,
      metrics: { likes: 31, replies: 2 },
    },
    {
      platform: Platform.tiktok,
      kind: "comment",
      text: "Is there a student discount?",
      handle: "streetbrew",
      sentiment: Sentiment.neutral,
      intent: Intent.inquiry,
      urgency: 2,
      topics: ["discount"],
      day: 3,
      metrics: { likes: 12, replies: 1 },
    },
    {
      platform: Platform.instagram,
      kind: "comment",
      text: "App keeps crashing when I try to reorder. Please fix.",
      handle: "oluwa.fin",
      sentiment: Sentiment.negative,
      intent: Intent.complaint,
      urgency: 4,
      topics: ["bug", "app"],
      day: 3,
      metrics: { likes: 9, replies: 4 },
    },
    {
      platform: Platform.facebook,
      kind: "comment",
      text: "Do you cater for office events?",
      handle: "kemiwears",
      sentiment: Sentiment.neutral,
      intent: Intent.inquiry,
      urgency: 3,
      topics: ["catering"],
      day: 2,
      metrics: { likes: 5, replies: 2 },
    },
    {
      platform: Platform.x,
      kind: "mention",
      text: "Cold brew delivery arrived early and still cold. Impressed.",
      handle: "coffeehunter",
      sentiment: Sentiment.positive,
      intent: Intent.praise,
      urgency: 1,
      topics: ["delivery", "cold brew"],
      day: 2,
      metrics: { likes: 26, replies: 1 },
    },
    {
      platform: Platform.instagram,
      kind: "comment",
      text: "Second time my order was late this week.",
      handle: "nene_pr",
      sentiment: Sentiment.negative,
      intent: Intent.complaint,
      urgency: 4,
      topics: ["late delivery"],
      day: 1,
      metrics: { likes: 14, replies: 6 },
    },
    {
      platform: Platform.tiktok,
      kind: "comment",
      text: "Tell me why this is the cleanest cafe aesthetic on my feed.",
      handle: "bimbowears",
      sentiment: Sentiment.positive,
      intent: Intent.praise,
      urgency: 1,
      topics: ["ambience"],
      day: 1,
      metrics: { likes: 203, replies: 11 },
    },
    {
      platform: Platform.instagram,
      kind: "comment",
      text: "What time do you open on Sundays?",
      handle: "luxe.ng",
      sentiment: Sentiment.neutral,
      intent: Intent.inquiry,
      urgency: 2,
      topics: ["opening hours"],
      day: 0,
      metrics: { likes: 4, replies: 1 },
    },
    {
      platform: Platform.x,
      kind: "mention",
      text: "Best coffee near the island, no debate.",
      handle: "chinwe.code",
      sentiment: Sentiment.positive,
      intent: Intent.praise,
      urgency: 1,
      topics: ["best coffee"],
      day: 0,
      metrics: { likes: 57, replies: 3 },
    },
  ];

  await prisma.socialMessage.createMany({
    data: messageSeed.map((msg, index) => ({
      brandId: brand.brandId,
      platform: msg.platform,
      kind: msg.kind,
      externalId: `demo-msg-${index + 1}`,
      text: msg.text,
      authorHandle: msg.handle,
      authorIdHash: hash(msg.handle),
      url: `https://social.demo/${msg.handle}/post-${index + 1}`,
      sentiment: msg.sentiment,
      intent: msg.intent,
      urgencyScore: msg.urgency,
      topics: msg.topics,
      rawMetrics: msg.metrics,
      capturedAt: daysAgo(msg.day),
    })),
  });

  const keywordGroup = await prisma.keywordGroup.create({
    data: {
      brandId: brand.brandId,
      name: "Demo Brand Monitoring",
      keywords: [
        "emblue demo cafe",
        "late delivery",
        "refund",
        "cold brew",
        "best coffee",
      ],
      platforms: ["instagram", "x", "tiktok", "facebook"],
      mode: "realtime",
      alertUrgencyThreshold: 4,
      alertIntents: ["complaint", "purchase_intent"],
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
      mode: "historical",
      status: "completed",
      totalResults: 3,
      positiveCount: 1,
      negativeCount: 1,
      neutralCount: 1,
      peakDate: yesterday,
      peakCount: 2,
      insightsSummary:
        "Positive product love is strong, but refund complaints need immediate support follow-up.",
      completedAt: now,
    },
  });

  await prisma.searchResult.createMany({
    data: [
      {
        runId: searchRun.runId,
        brandId: brand.brandId,
        groupId: keywordGroup.groupId,
        matchedKeyword: "best coffee",
        platform: Platform.instagram,
        text: "The new oat latte is the best coffee I have had this month.",
        authorHandle: "mariaeatsnyc",
        authorIdExt: "demo-author-1",
        url: "https://instagram.com/p/demo-ig-001",
        postedAt: twoDaysAgo,
        sentiment: Sentiment.positive,
        intent: Intent.praise,
        urgencyScore: 2,
        topics: ["product love", "coffee"],
        likes: 124,
        repliesCount: 8,
        shares: 3,
        views: 4200,
      },
      {
        runId: searchRun.runId,
        brandId: brand.brandId,
        groupId: keywordGroup.groupId,
        matchedKeyword: "refund",
        platform: Platform.x,
        text: "Still waiting on my refund from Emblue Demo Cafe. Support said 24 hours and it has been three days.",
        authorHandle: "jayneedshelp",
        authorIdExt: "demo-author-2",
        url: "https://x.com/jayneedshelp/status/demo-x-001",
        postedAt: yesterday,
        sentiment: Sentiment.negative,
        intent: Intent.complaint,
        urgencyScore: 5,
        topics: ["refund", "support"],
        likes: 19,
        repliesCount: 6,
        shares: 4,
        views: 2100,
      },
      {
        runId: searchRun.runId,
        brandId: brand.brandId,
        groupId: keywordGroup.groupId,
        matchedKeyword: "cold brew",
        platform: Platform.tiktok,
        text: "Do you ship cold brew packs outside Lagos?",
        authorHandle: "nifemidrinks",
        authorIdExt: "demo-author-3",
        url: "https://tiktok.com/@embluedemo/video/demo-tt-001",
        postedAt: now,
        sentiment: Sentiment.neutral,
        intent: Intent.inquiry,
        urgencyScore: 3,
        topics: ["shipping", "cold brew"],
        likes: 44,
        repliesCount: 2,
        shares: 1,
        views: 9800,
      },
    ],
  });

  await prisma.searchVolume.createMany({
    data: [
      {
        runId: searchRun.runId,
        periodStart: twoDaysAgo,
        periodEnd: twoDaysAgo,
        mentionCount: 18,
        positiveCount: 12,
        negativeCount: 2,
        neutralCount: 4,
      },
      {
        runId: searchRun.runId,
        periodStart: yesterday,
        periodEnd: yesterday,
        mentionCount: 31,
        positiveCount: 16,
        negativeCount: 9,
        neutralCount: 6,
      },
      {
        runId: searchRun.runId,
        periodStart: now,
        periodEnd: now,
        mentionCount: 24,
        positiveCount: 13,
        negativeCount: 3,
        neutralCount: 8,
      },
    ],
  });

  const cluster = await prisma.cluster.create({
    data: {
      brandId: brand.brandId,
      label: "Refund support and delivery timing",
      opportunityScore: 88,
      messageCount: 14,
      topPhrases: ["refund delay", "support response", "delivery timing"],
      recommendations: [
        "Pin a refund timeline post for the next 72 hours.",
        "Create a saved reply for late refund complaints.",
        "Route refund comments to a human approver.",
      ],
    },
  });

  await prisma.contentRecommendation.createMany({
    data: [
      {
        brandId: brand.brandId,
        clusterId: cluster.clusterId,
        platform: Platform.instagram,
        format: "carousel",
        headline: "How refunds work at Emblue Demo Cafe",
        brief: "Clarify timelines, support channels, and escalation steps.",
        status: "idea",
      },
      {
        brandId: brand.brandId,
        clusterId: cluster.clusterId,
        platform: Platform.tiktok,
        format: "short_video",
        headline: "Cold brew delivery FAQ",
        brief:
          "Answer shipping and storage questions with a concise founder-led clip.",
        status: "idea",
      },
    ],
  });

  await prisma.replySuggestion.createMany({
    data: [
      {
        brandId: brand.brandId,
        text: "Thanks for flagging this. Please DM your order number and we will check the refund status right away.",
        tone: "calm",
        confidence: 91,
        riskFlags: ["needs_human_review"],
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        text: "Yes, we ship cold brew packs nationwide. Delivery estimates depend on your city.",
        tone: "helpful",
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
      keywords: ["cold brew", "ship", "delivery"],
      maxPerHour: 20,
      delaySec: 45,
      destUrl: "https://demo.socialemblue.ai/cold-brew",
      isActive: true,
    },
  });

  const trackedLink = await prisma.trackedLink.create({
    data: {
      brandId: brand.brandId,
      shortCode: "demo-coldbrew",
      destUrl: "https://demo.socialemblue.ai/cold-brew",
      campaign: "Cold Brew Demo Launch",
      platform: Platform.instagram,
      contentType: "dm_cta",
      clicks: 126,
      conversions: 18,
    },
  });

  await prisma.linkEvent.createMany({
    data: [
      {
        brandId: brand.brandId,
        linkId: trackedLink.linkId,
        eventType: "click",
        ipHash: hash("127.0.0.1"),
        userAgent: "Demo Browser",
      },
      {
        brandId: brand.brandId,
        linkId: trackedLink.linkId,
        eventType: "conversion",
        ipHash: hash("127.0.0.2"),
        userAgent: "Demo Browser",
      },
    ],
  });

  await prisma.dmEvent.createMany({
    data: [
      {
        brandId: brand.brandId,
        funnelId: funnel.funnelId,
        authorHandle: "nifemidrinks",
        dmSentAt: yesterday,
        openedAt: yesterday,
        clickedAt: now,
        converted: true,
      },
      {
        brandId: brand.brandId,
        funnelId: funnel.funnelId,
        authorHandle: "coffeehunter",
        dmSentAt: now,
        openedAt: now,
        converted: false,
      },
    ],
  });

  const kpiTrend = [
    { listening: 71.0, reply: 78.5, funnel: 60.2, risk: 4 },
    { listening: 73.6, reply: 80.1, funnel: 62.8, risk: 3 },
    { listening: 76.2, reply: 83.4, funnel: 65.1, risk: 3 },
    { listening: 78.9, reply: 85.7, funnel: 68.4, risk: 2 },
    { listening: 80.1, reply: 88.0, funnel: 70.9, risk: 2 },
    { listening: 81.3, reply: 89.6, funnel: 73.0, risk: 1 },
    { listening: 82.4, reply: 91.2, funnel: 74.8, risk: 2 },
  ];
  await prisma.kpiSnapshot.createMany({
    data: kpiTrend.map((point, index) => {
      const day = daysAgo(kpiTrend.length - 1 - index);
      return {
        brandId: brand.brandId,
        periodStart: day,
        periodEnd: day,
        listeningKpi: point.listening,
        replyKpi: point.reply,
        funnelKpi: point.funnel,
        riskEvents: point.risk,
        kpis: [
          { label: "Mentions", value: 58 + index * 5, delta: 8 + index },
          {
            label: "Avg response time",
            value: `${14 - index}m`,
            delta: -6 - index,
          },
          {
            label: "Conversion rate",
            value: `${(11 + index * 0.6).toFixed(1)}%`,
            delta: Number((2 + index * 0.3).toFixed(1)),
          },
        ],
        alerts: [
          {
            severity: "high",
            message: "Refund complaints need a visible response playbook.",
          },
          {
            severity: "medium",
            message: "Cold brew shipping questions are trending.",
          },
        ],
        createdAt: day,
      };
    }),
  });

  await prisma.insightRun.create({
    data: {
      brandId: brand.brandId,
      messagesProcessed: 73,
      faqsFound: 6,
      painPoints: 3,
      summary:
        "Customers love the product quality but need clearer refund and delivery communication.",
    },
  });

  await prisma.faqItem.createMany({
    data: [
      {
        brandId: brand.brandId,
        question: "Do you ship cold brew packs outside Lagos?",
        frequency: 17,
        platforms: ["instagram", "tiktok"],
      },
      {
        brandId: brand.brandId,
        question: "How long do refunds take?",
        frequency: 9,
        platforms: ["x", "instagram"],
      },
    ],
  });

  await prisma.painPoint.createMany({
    data: [
      {
        brandId: brand.brandId,
        text: "Refund expectations are unclear after support handoff.",
        severity: "high",
        frequency: 9,
      },
      {
        brandId: brand.brandId,
        text: "Delivery time estimates vary by platform response.",
        severity: "medium",
        frequency: 6,
      },
    ],
  });

  await prisma.warRoom.create({
    data: {
      brandId: brand.brandId,
      health: "amber",
      summary:
        "Product sentiment is strong, but refund complaints need a visible response playbook.",
      alerts: [
        {
          severity: "high",
          channel: "x",
          message: "Refund thread gaining traction.",
        },
        {
          severity: "medium",
          channel: "instagram",
          message: "Shipping questions increasing.",
        },
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
        caption:
          "Cold brew that survives Lagos traffic and still tastes like a good morning.",
        grade: "A-",
        score: 88,
        analysis: { hook: 91, clarity: 86, cta: 78 },
      },
      {
        brandId: brand.brandId,
        platform: Platform.tiktok,
        caption: "POV: your coffee arrives before your standup starts.",
        grade: "B+",
        score: 82,
        analysis: { hook: 84, clarity: 80, cta: 76 },
      },
    ],
  });

  await prisma.campaignMetric.createMany({
    data: [
      {
        brandId: brand.brandId,
        campaign: "Cold Brew Demo Launch",
        platform: Platform.instagram,
        metric: "replies_sent",
        value: 64,
      },
      {
        brandId: brand.brandId,
        campaign: "Cold Brew Demo Launch",
        platform: Platform.instagram,
        metric: "clicks",
        value: 126,
      },
      {
        brandId: brand.brandId,
        campaign: "Cold Brew Demo Launch",
        platform: Platform.instagram,
        metric: "conversions",
        value: 18,
      },
    ],
  });

  await prisma.triggerRule.createMany({
    data: [
      {
        brandId: brand.brandId,
        keyword: "refund",
        action: "escalate_to_support",
        confidence: 90,
        isActive: true,
      },
      {
        brandId: brand.brandId,
        keyword: "cold brew",
        action: "send_dm_link",
        confidence: 85,
        isActive: true,
      },
    ],
  });

  await prisma.approvalQueue.createMany({
    data: [
      {
        brandId: brand.brandId,
        platform: Platform.x,
        authorHandle: "@jayneedshelp",
        originalText:
          "Still waiting on my refund from Emblue Demo Cafe. Support said 24 hours and it has been three days.",
        replyText:
          "We are checking this now. Please DM your order number so support can resolve it today.",
        confidence: 71,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.instagram,
        authorHandle: "@kemiwears",
        originalText:
          "I have been trying to reach your team for 3 days and no one is responding. Really frustrating.",
        replyText:
          "Hi Kemi — that wait is on us and it should never take this long. Could you DM your account details so we can fix this personally?",
        confidence: 58,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.facebook,
        authorHandle: "@adunni.so",
        originalText: "My discount code is not applying at checkout.",
        replyText:
          "Sorry about that! We have reset your code — try again and let us know if it still does not apply.",
        confidence: 84,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.tiktok,
        authorHandle: "@oluwa.fin",
        originalText: "Why does the app keep crashing on iOS?",
        replyText:
          "We are shipping a fix this week — DM us your device info and we will keep you posted.",
        confidence: 62,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.x,
        authorHandle: "@tunde_lagos",
        originalText: "Hey team, any update on my order? It has been 5 days.",
        replyText:
          "Checking your order right now — we will get back to you with a delivery update within the hour.",
        confidence: 77,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.instagram,
        authorHandle: "@nene_pr",
        originalText: "Second time my order was late this week.",
        replyText:
          "That is twice too many — we are crediting your account and reviewing the delivery route today.",
        confidence: 69,
        status: ApprovalStatus.pending,
      },
      {
        brandId: brand.brandId,
        platform: Platform.instagram,
        authorHandle: "@mariaeatsnyc",
        originalText:
          "The new oat latte is the best coffee I have had this month.",
        replyText:
          "Thanks for the love, Maria! The oat latte is available all week.",
        confidence: 96,
        status: ApprovalStatus.approved,
      },
    ],
  });

  await prisma.replyTemplate.createMany({
    data: [
      {
        brandId: brand.brandId,
        name: "Refund escalation",
        platform: Platform.x,
        triggerKeywords: ["refund", "late", "support"],
        templateText:
          "Please DM your order number. We will check the refund status and update you today.",
        isActive: true,
        useCount: 12,
      },
      {
        brandId: brand.brandId,
        name: "Cold brew shipping",
        platform: Platform.instagram,
        triggerKeywords: ["cold brew", "ship", "delivery"],
        templateText:
          "Yes, we ship cold brew packs nationwide. Tap the link for current delivery windows.",
        isActive: true,
        useCount: 31,
      },
    ],
  });

  const campaign = await prisma.engageCampaign.create({
    data: {
      brandId: brand.brandId,
      name: "Cold Brew Demo Launch",
      platform: Platform.instagram,
      postIds: ["demo-ig-001", "demo-ig-002"],
      keywords: ["cold brew", "ship", "coffee"],
      engageAll: true,
      engageNegative: false,
      tone: "friendly and direct",
      replyTemplate: "Thanks for asking. We ship cold brew packs nationwide.",
      fallbackTemplate: "Thanks for reaching out. Our team can help in DM.",
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

  const engagementSeed: {
    platform: Platform;
    handle: string;
    original: string;
    reply: string;
    status: string;
    day: number;
  }[] = [
    {
      platform: Platform.instagram,
      handle: "nifemidrinks",
      original: "Do you ship cold brew packs outside Lagos?",
      reply: "Yes, we ship nationwide. Check the link for delivery windows.",
      status: "sent",
      day: 0,
    },
    {
      platform: Platform.instagram,
      handle: "coffeehunter",
      original: "Need this for my office fridge.",
      reply: "We can help with office packs. Sending details by DM.",
      status: "queued",
      day: 0,
    },
    {
      platform: Platform.instagram,
      handle: "bimbowears",
      original: "Is the oat latte available all week?",
      reply: "Yes! The oat latte is on all week — come through.",
      status: "sent",
      day: 1,
    },
    {
      platform: Platform.facebook,
      handle: "adunni.so",
      original: "My discount code is not applying.",
      reply: "We reset your code — try again and tell us if it sticks.",
      status: "sent",
      day: 1,
    },
    {
      platform: Platform.facebook,
      handle: "lagosfoodie",
      original: "Do you cater for events?",
      reply: "We do! Share your date and headcount and we will quote you.",
      status: "manual_copy",
      day: 2,
    },
    {
      platform: Platform.x,
      handle: "jayneedshelp",
      original: "Still waiting on my refund.",
      reply:
        "Apologies for the wait — DM your order number and we will resolve it today.",
      status: "sent",
      day: 2,
    },
    {
      platform: Platform.x,
      handle: "tunde_lagos",
      original: "Any update on my order? 5 days now.",
      reply: "Checking your order now — we will update you within the hour.",
      status: "queued",
      day: 3,
    },
    {
      platform: Platform.tiktok,
      handle: "oluwa.fin",
      original: "Why does the app keep crashing on iOS?",
      reply:
        "A fix ships this week — DM your device info and we will keep you posted.",
      status: "manual_copy",
      day: 3,
    },
    {
      platform: Platform.tiktok,
      handle: "streetbrew",
      original: "Do you have a student discount?",
      reply: "Yes — 10% off with a student email. Tap the link to claim it.",
      status: "sent",
      day: 4,
    },
    {
      platform: Platform.instagram,
      handle: "kemiwears",
      original: "Loved the launch event!",
      reply: "Thank you, Kemi! So glad you came through.",
      status: "sent",
      day: 5,
    },
  ];

  await prisma.autoEngagement.createMany({
    data: engagementSeed.map((engagement) => ({
      brandId: brand.brandId,
      campaignId: campaign.campaignId,
      platform: engagement.platform,
      authorHandle: engagement.handle,
      originalText: engagement.original,
      replyText: engagement.reply,
      trackedLink: trackedLink.shortCode,
      status: engagement.status,
      firedAt: daysAgo(engagement.day),
    })),
  });

  await prisma.campaignAsset.create({
    data: {
      brandId: brand.brandId,
      campaignId: String(campaign.campaignId),
      imageUrl: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735",
      isActive: true,
    },
  });

  await prisma.campaignPostUrl.create({
    data: {
      brandId: brand.brandId,
      campaignId: campaign.campaignId,
      platform: Platform.instagram,
      postUrl: "https://instagram.com/p/demo-ig-001",
      postIdExt: "demo-ig-001",
      includeCommenters: true,
      includeLikers: true,
      status: "completed",
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
        action: "comment",
        authorId: "demo-author-3",
        authorHandle: "nifemidrinks",
        originalText: "Do you ship cold brew packs outside Lagos?",
        externalEventId: "demo-event-3",
        status: "processed",
        processedAt: now,
      },
      {
        brandId: brand.brandId,
        campaignId: String(campaign.campaignId),
        platform: Platform.instagram,
        action: "like",
        authorId: "demo-author-4",
        authorHandle: "coffeehunter",
        externalEventId: "demo-event-4",
        status: "pending",
      },
    ],
  });

  console.log("[Seed] Demo database is ready");
  console.log(`email=${demo.email}`);
  console.log("password=[redacted]");
  console.log(`user_id=${userId}`);
  console.log(`brand_id=${brand.brandId}`);
  console.log(`brand_slug=${brand.slug}`);
  console.log(`tools=${ALL_TOOL_IDS.join(",")}`);
}

main()
  .catch((error) => {
    console.error("[Seed] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
