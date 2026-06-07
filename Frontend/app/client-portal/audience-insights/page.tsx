"use client";

import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalEmptyState, PortalSection, PortalSkeleton, PortalStatCard } from "@/components/portal/PortalPrimitives";
import { getClientInsights } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export default function AudienceInsightsPage() {
  const { activeBrandId } = useAuth();
  const insightsQuery = useQuery({
    queryKey: ["client-insights", activeBrandId],
    queryFn: () => getClientInsights(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });
  const audience = insightsQuery.data?.audience;

  return (
    <PortalShell title="Audience insights" subtitle="A summarized view of audience signals found in campaign conversations.">
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <PortalStatCard label="Positive sentiment" value={formatPct(audience?.positive_sentiment_pct)} tone="green" />
          <PortalStatCard label="Purchase intent" value={formatPct(audience?.purchase_intent_pct)} tone="blue" />
          <PortalStatCard label="Questions raised" value={String(audience?.questions_count ?? 0)} tone="amber" />
        </section>

        <PortalSection title="Audience summary">
          {insightsQuery.isLoading ? (
            <PortalSkeleton rows={2} />
          ) : audience?.summary ? (
            <p className="text-sm leading-6 text-[var(--portal-text-body)]">{audience.summary}</p>
          ) : (
            <PortalEmptyState title="No audience summary yet" body="Run comment mining from the B2B workspace to populate audience insights for this client." />
          )}
        </PortalSection>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <PortalSection title="Frequent questions">
            {insightsQuery.isLoading ? (
              <PortalSkeleton rows={4} />
            ) : audience?.faqs?.length ? (
              <div className="space-y-3">
                {audience.faqs.map((item) => (
                  <InsightRow key={item.faq_id} title={item.question} meta={`${item.frequency ?? 0} mentions`} />
                ))}
              </div>
            ) : (
              <PortalEmptyState title="No FAQs found" body="Questions extracted from comments will appear here." />
            )}
          </PortalSection>

          <PortalSection title="Pain points">
            {insightsQuery.isLoading ? (
              <PortalSkeleton rows={4} />
            ) : audience?.pain_points?.length ? (
              <div className="space-y-3">
                {audience.pain_points.map((item) => (
                  <InsightRow key={item.pain_point_id} title={item.text} meta={`${item.severity ?? "unrated"} severity`} />
                ))}
              </div>
            ) : (
              <PortalEmptyState title="No pain points found" body="Pain points extracted from comments will appear here." />
            )}
          </PortalSection>
        </section>
      </div>
    </PortalShell>
  );
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" ? `${value}%` : "N/A";
}

function InsightRow({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="rounded-[var(--portal-radius-input)] border border-[var(--portal-border-soft)] bg-[var(--portal-surface-alt)] p-4">
      <p className="text-sm font-bold text-[var(--portal-text)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--portal-text-muted)]">{meta}</p>
    </div>
  );
}
