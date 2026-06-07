"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PortalShell } from "@/components/portal/PortalShell";
import {
  PortalCard,
  PortalEmptyState,
  PortalSection,
  PortalSkeleton,
  PortalStatCard,
} from "@/components/portal/PortalPrimitives";
import { getClientSummary } from "@/lib/api";
import { isB2CClient, isPlatformAdmin } from "@/lib/access";
import { useAuth } from "@/hooks/use-auth";

const trendData = [
  { label: "Wk 1", replies: 18, conversions: 3 },
  { label: "Wk 2", replies: 31, conversions: 7 },
  { label: "Wk 3", replies: 46, conversions: 11 },
  { label: "Wk 4", replies: 67, conversions: 16 },
];

const platformBreakdown = [
  { platform: "Instagram", value: 42 },
  { platform: "Facebook", value: 24 },
  { platform: "TikTok", value: 18 },
  { platform: "X", value: 14 },
];

export default function ClientPortalPage() {
  const router = useRouter();
  const { activeBrandId, authContext } = useAuth();
  const allowed = isB2CClient(authContext) || isPlatformAdmin(authContext);
  const summaryQuery = useQuery({
    queryKey: ["client-summary", activeBrandId],
    queryFn: () => getClientSummary(activeBrandId!),
    enabled: Boolean(activeBrandId) && allowed,
    retry: false,
  });

  useEffect(() => {
    if (authContext && !allowed) router.replace("/dashboard");
  }, [allowed, authContext, router]);

  if (!allowed) return null;

  const data = summaryQuery.data;
  const summary = data?.summary;

  return (
    <PortalShell
      title="Overview"
      subtitle={data?.brand.campaign_objective ?? "A read-only view of campaign progress, responses, engagement and KPI movement."}
    >
      <div className="space-y-6">
        {summaryQuery.isError && (
          <div className="rounded-[var(--portal-radius-card)] border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Unable to load client dashboard."}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <PortalStatCard label="Messages tracked" value={formatNumber(summary?.total_messages)} tone="blue" detail="Captured in the last 30 days" />
          <PortalStatCard label="Replies sent" value={formatNumber(summary?.replies_sent)} tone="green" detail="Approved and published responses" />
          <PortalStatCard label="Engagement actions" value={formatNumber(summary?.engagements)} tone="amber" detail="Campaign activity handled by the team" />
          <PortalStatCard label="Pending approvals" value={formatNumber(summary?.pending_approvals)} tone="pink" detail="Items waiting for review" />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_350px]">
          <PortalSection
            title="Campaign trend"
            description="Response and conversion movement for the current reporting window."
          >
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid var(--portal-border)",
                      borderRadius: "var(--portal-radius-input)",
                      boxShadow: "var(--portal-shadow-card)",
                    }}
                  />
                  <Line type="monotone" dataKey="replies" stroke="#1F40FF" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="conversions" stroke="#10B981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </PortalSection>

          <PortalCard className="p-6">
            <p className="text-sm font-bold text-[var(--portal-text)]">Sentiment health</p>
            <p className="mt-6 text-6xl font-extrabold tracking-[-0.06em] text-[var(--portal-success)]">
              {formatScore(summary?.listening_kpi)}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--portal-text-muted)]">
              Latest listening KPI from campaign monitoring.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <MiniKpi label="Reply KPI" value={formatScore(summary?.reply_kpi)} />
              <MiniKpi label="Funnel KPI" value={formatScore(summary?.funnel_kpi)} />
            </div>
          </PortalCard>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_350px]">
          <PortalSection title="Platform breakdown" description="Where campaign conversations are currently concentrated.">
            <div className="space-y-4">
              {platformBreakdown.map((item) => (
                <div key={item.platform}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold text-[var(--portal-text-body)]">{item.platform}</span>
                    <span className="text-xs font-semibold text-[var(--portal-text-muted)]">{item.value}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#F1F5F9]">
                    <div className="h-full rounded-full bg-[var(--portal-blue)]" style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </PortalSection>

          <PortalSection title="Active campaigns">
            {summaryQuery.isLoading ? (
              <PortalSkeleton rows={3} />
            ) : data?.campaigns?.length ? (
              <div className="space-y-3">
                {data.campaigns.slice(0, 4).map((campaign) => (
                  <div key={campaign.campaign_id} className="rounded-[var(--portal-radius-input)] border border-[var(--portal-border-soft)] bg-[var(--portal-surface-alt)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-[var(--portal-text)]">{campaign.name}</p>
                      <span className="text-xs font-semibold text-[var(--portal-blue)]">{campaign.is_active ? "Active" : "Paused"}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--portal-text-muted)]">
                      {formatNumber(campaign.total_sent)} engagement messages sent
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <PortalEmptyState title="No active campaigns yet" body="Campaign progress will appear here once the managed service team starts publishing activity." />
            )}
          </PortalSection>
        </section>
      </div>
    </PortalShell>
  );
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "0";
}

function formatScore(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)}%` : "N/A";
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--portal-radius-input)] bg-[var(--portal-surface-alt)] p-3">
      <p className="text-xs font-semibold text-[var(--portal-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-extrabold tracking-[-0.03em] text-[var(--portal-text)]">{value}</p>
    </div>
  );
}
