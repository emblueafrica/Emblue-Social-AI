// src/routes/dashboard.ts
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { resolveRequestBrandId, requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { getRequiredBrandId, sendServerError, sendValidationError } from '../utils/validation';

const router = Router();

router.get('/summary', requireBrandAccess, requireToolAccess('tool_5'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const [msgs, replies, kpi] = await Promise.all([
      prisma.socialMessage.count({
        where: { brandId, capturedAt: { gt: since } },
      }),
      prisma.replySuggestion.count({
        where: { brandId, status: 'posted', createdAt: { gt: since } },
      }),
      prisma.kpiSnapshot.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        select: { listeningKpi: true, replyKpi: true, funnelKpi: true },
      }),
    ]);
    res.json({
      total_messages: msgs,
      replies_sent: replies,
      listening_kpi: kpi?.listeningKpi === null || kpi?.listeningKpi === undefined ? null : Number(kpi.listeningKpi),
      reply_kpi: kpi?.replyKpi === null || kpi?.replyKpi === undefined ? null : Number(kpi.replyKpi),
      funnel_kpi: kpi?.funnelKpi === null || kpi?.funnelKpi === undefined ? null : Number(kpi.funnelKpi),
    });
  } catch (err) {
    sendServerError(res, 'Dashboard summary lookup failed', err);
  }
});

router.get('/client-summary', requireBrandAccess, async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']) ?? resolveRequestBrandId(req);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const brand = await prisma.brand.findUnique({
      where: { brandId },
      select: { brandId: true, name: true, slug: true, accountType: true, campaignObjective: true },
    });
    if (!brand) {
      res.status(404).json({ error: 'Brand not found' });
      return;
    }
    if (brand.accountType !== 'b2c_managed' && !req.user?.platform_role) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'This dashboard is only available for managed-service client accounts.',
      });
      return;
    }

    const since = new Date(Date.now() - 30 * 86400000);
    const [
      messages,
      replies,
      latestKpi,
      campaignMetrics,
      activeCampaigns,
      recentEngagements,
      openApprovals,
    ] = await Promise.all([
      prisma.socialMessage.count({ where: { brandId, capturedAt: { gt: since } } }),
      prisma.replySuggestion.count({ where: { brandId, createdAt: { gt: since }, status: 'posted' } }),
      prisma.kpiSnapshot.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        select: {
          listeningKpi: true,
          replyKpi: true,
          funnelKpi: true,
          riskEvents: true,
          kpis: true,
          alerts: true,
          createdAt: true,
        },
      }),
      prisma.campaignMetric.findMany({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { campaign: true, platform: true, metric: true, value: true, createdAt: true },
      }),
      prisma.engageCampaign.findMany({
        where: { brandId },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: { campaignId: true, name: true, platform: true, isActive: true, totalSent: true, updatedAt: true },
      }),
      prisma.autoEngagement.count({ where: { brandId, createdAt: { gt: since } } }),
      prisma.approvalQueue.count({ where: { brandId, status: 'pending' } }),
    ]);

    res.json({
      brand: {
        brand_id: brand.brandId,
        name: brand.name,
        slug: brand.slug,
        account_type: brand.accountType,
        campaign_objective: brand.campaignObjective,
      },
      period_days: 30,
      summary: {
        total_messages: messages,
        replies_sent: replies,
        engagements: recentEngagements,
        pending_approvals: openApprovals,
        listening_kpi: latestKpi?.listeningKpi === null || latestKpi?.listeningKpi === undefined ? null : Number(latestKpi.listeningKpi),
        reply_kpi: latestKpi?.replyKpi === null || latestKpi?.replyKpi === undefined ? null : Number(latestKpi.replyKpi),
        funnel_kpi: latestKpi?.funnelKpi === null || latestKpi?.funnelKpi === undefined ? null : Number(latestKpi.funnelKpi),
        risk_events: latestKpi?.riskEvents ?? 0,
      },
      kpis: latestKpi?.kpis ?? [],
      alerts: latestKpi?.alerts ?? [],
      campaign_metrics: campaignMetrics.map(metric => ({
        campaign: metric.campaign,
        platform: metric.platform,
        metric: metric.metric,
        value: metric.value === null || metric.value === undefined ? null : Number(metric.value),
        created_at: metric.createdAt,
      })),
      campaigns: activeCampaigns.map(campaign => ({
        campaign_id: Number(campaign.campaignId),
        name: campaign.name,
        platform: campaign.platform,
        is_active: campaign.isActive,
        total_sent: campaign.totalSent,
        updated_at: campaign.updatedAt,
      })),
      updated_at: latestKpi?.createdAt ?? new Date(),
    });
  } catch (err) {
    sendServerError(res, 'Client dashboard lookup failed', err);
  }
});

router.get('/client-insights', requireBrandAccess, async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']) ?? resolveRequestBrandId(req);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const brand = await prisma.brand.findUnique({
      where: { brandId },
      select: { brandId: true, name: true, accountType: true },
    });
    if (!brand) {
      res.status(404).json({ error: 'Brand not found' });
      return;
    }
    if (brand.accountType !== 'b2c_managed' && !req.user?.platform_role) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'This dashboard is only available for managed-service client accounts.',
      });
      return;
    }

    const [
      templates,
      faqs,
      painPoints,
      connections,
      latestInsightRun,
      sentimentCounts,
    ] = await Promise.all([
      prisma.replyTemplate.findMany({
        where: { brandId },
        orderBy: { updatedAt: 'desc' },
        take: 12,
        select: {
          templateId: true,
          name: true,
          platform: true,
          triggerKeywords: true,
          templateText: true,
          isActive: true,
          useCount: true,
          updatedAt: true,
        },
      }),
      prisma.faqItem.findMany({
        where: { brandId },
        orderBy: { frequency: 'desc' },
        take: 12,
        select: { faqId: true, question: true, frequency: true, platforms: true, createdAt: true },
      }),
      prisma.painPoint.findMany({
        where: { brandId },
        orderBy: { frequency: 'desc' },
        take: 12,
        select: { ppId: true, text: true, severity: true, frequency: true, createdAt: true },
      }),
      prisma.connectedAccount.findMany({
        where: { brandId },
        orderBy: { connectedAt: 'desc' },
        select: { platform: true, accountHandle: true, isActive: true, connectedAt: true },
      }),
      prisma.insightRun.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        select: { summary: true, messagesProcessed: true, faqsFound: true, painPoints: true, createdAt: true },
      }),
      prisma.socialMessage.groupBy({
        by: ['sentiment'],
        where: { brandId },
        _count: { _all: true },
      }),
    ]);

    const totalSentiment = sentimentCounts.reduce((sum, row) => sum + row._count._all, 0);
    const positiveCount = sentimentCounts.find(row => row.sentiment === 'positive')?._count._all ?? 0;
    const purchaseIntentCount = await prisma.socialMessage.count({ where: { brandId, intent: 'purchase_intent' } });
    const totalMessages = await prisma.socialMessage.count({ where: { brandId } });

    res.json({
      brand: {
        brand_id: brand.brandId,
        name: brand.name,
        account_type: brand.accountType,
      },
      audience: {
        positive_sentiment_pct: totalSentiment ? Math.round((positiveCount / totalSentiment) * 100) : null,
        purchase_intent_pct: totalMessages ? Math.round((purchaseIntentCount / totalMessages) * 100) : null,
        questions_count: faqs.length,
        summary: latestInsightRun?.summary ?? null,
        messages_processed: latestInsightRun?.messagesProcessed ?? 0,
        last_run_at: latestInsightRun?.createdAt ?? null,
        faqs: faqs.map(item => ({
          faq_id: Number(item.faqId),
          question: item.question,
          frequency: item.frequency,
          platforms: item.platforms,
          created_at: item.createdAt,
        })),
        pain_points: painPoints.map(item => ({
          pain_point_id: Number(item.ppId),
          text: item.text,
          severity: item.severity,
          frequency: item.frequency,
          created_at: item.createdAt,
        })),
      },
      templates: templates.map(template => ({
        template_id: Number(template.templateId),
        name: template.name,
        platform: template.platform,
        trigger_keywords: template.triggerKeywords,
        template_text: template.templateText,
        is_active: template.isActive,
        use_count: template.useCount,
        updated_at: template.updatedAt,
      })),
      connections: connections.map(connection => ({
        platform: connection.platform,
        account_handle: connection.accountHandle,
        is_active: connection.isActive,
        connected_at: connection.connectedAt,
      })),
      updated_at: new Date(),
    });
  } catch (err) {
    sendServerError(res, 'Client insights lookup failed', err);
  }
});

export default router;
