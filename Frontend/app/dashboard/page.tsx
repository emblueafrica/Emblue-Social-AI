"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  BarChart3,
  Gauge,
  Layers,
  Link2,
  Lock,
  MessageCircle,
  MessageSquare,
  Palette,
  Search,
  Users,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import { isB2CClient, isPlatformAdmin } from "@/lib/access";
import { ApiError, getCampaignStats, getToolAccess } from "@/lib/api";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

const TOOL_META = [
  { id: "tool_1", label: "Tool 1", title: "Advanced Listening", icon: Search, color: "bg-primary" },
  { id: "tool_2", label: "Tool 2", title: "Search & Clusters", icon: Layers, color: "bg-brand-pink" },
  { id: "tool_3", label: "Tool 3", title: "AI Reply Engine", icon: MessageCircle, color: "bg-foreground" },
  { id: "tool_4", label: "Tool 4", title: "Comment to DM Funnel", icon: MessageSquare, color: "bg-foreground" },
  { id: "tool_6", label: "Tool 6", title: "Attribution & Links", icon: Link2, color: "bg-primary" },
  { id: "tool_7", label: "Tool 7", title: "Creative Predictor", icon: Palette, color: "bg-brand-pink" },
  { id: "tool_8", label: "Tool 8", title: "Comment Mining", icon: BarChart3, color: "bg-brand-pink" },
  { id: "tool_9", label: "Tool 9", title: "Campaign War Room", icon: Gauge, color: "bg-foreground" },
  { id: "tool_10", label: "Tool 10", title: "Engage the Engager", icon: Users, color: "bg-primary" },
] as const;

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
};

export default function Dashboard() {
  const router = useRouter();
  const { activeBrandId, authContext } = useAuth();

  useEffect(() => {
    if (isPlatformAdmin(authContext)) router.replace("/admin");
    if (isB2CClient(authContext)) router.replace("/client-portal");
  }, [authContext, router]);

  const accessQuery = useQuery({
    queryKey: ["tool-access", activeBrandId],
    queryFn: getToolAccess,
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  const statsQuery = useQuery({
    queryKey: ["campaign-stats", activeBrandId],
    queryFn: () => getCampaignStats(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  const lockedError =
    (statsQuery.error instanceof ApiError && statsQuery.error.status === 403 ? statsQuery.error : null) ??
    (accessQuery.error instanceof ApiError && accessQuery.error.status === 403 ? accessQuery.error : null);

  const summary = statsQuery.data?.summary;
  const totalMessages = summary?.total_messages ?? 0;
  const totalReplies = summary?.replies_sent ?? 0;
  const revenueAttributed = statsQuery.data?.attribution?.revenue ?? summary?.revenue_attributed ?? null;
  const responseTime = summary?.avg_response_time_minutes;
  const messageVolume = statsQuery.data?.message_volume ?? [];
  const chartData = messageVolume.map((item) => ({
    name: item.d,
    total: item.total,
    classified: item.classified,
  }));

  const toolCards = useMemo(() => {
    const enabled = new Set(accessQuery.data?.enabled ?? []);
    return TOOL_META.map((tool) => ({
      ...tool,
      enabled: enabled.has(tool.id),
    }));
  }, [accessQuery.data?.enabled]);

  const topPlatforms = useMemo(() => {
    return [...(statsQuery.data?.stats ?? [])]
      .sort((a, b) => b.total - a.total)
      .slice(0, 4);
  }, [statsQuery.data?.stats]);

  const latestSentiment = useMemo(() => {
    const rows = statsQuery.data?.sentiment ?? [];
    return rows.at(-1) ?? null;
  }, [statsQuery.data?.sentiment]);

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Performance" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Overall Performance Dashboard" />

        <main className="flex-1 p-6 md:p-10 space-y-8 text-safe layout-safe">
          {!activeBrandId && (
            <DashboardNotice
              title="No active brand workspace"
              body="This account is authenticated, but it is not attached to an approved brand workspace yet."
            />
          )}

          {lockedError && (
            <DashboardNotice
              title="Dashboard access is locked"
              body={lockedError.message}
              action={lockedError.upgradeUrl ? "Open upgrade settings" : undefined}
            />
          )}

          {statsQuery.isError && !lockedError && (
            <DashboardNotice
              title="Dashboard data unavailable"
              body={statsQuery.error instanceof Error ? statsQuery.error.message : "Unable to load dashboard data."}
            />
          )}

          {accessQuery.isError && !lockedError && (
            <DashboardNotice
              title="Tool access unavailable"
              body={accessQuery.error instanceof Error ? accessQuery.error.message : "Unable to load tool access."}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard color="bg-primary" label="Total Messages Processed" value={formatCount(totalMessages)} delta="Last 30 days" />
            <KpiCard color="bg-brand-pink" label="Total Replies Sent" value={formatCount(totalReplies)} delta="Sent via live workflows" />
            <KpiCard color="bg-brand-olive" label="Revenue Attributed" value={formatMoney(revenueAttributed)} delta="Tracked attribution revenue" />
            <KpiCard color="bg-destructive" label="Avg Response Time" value={formatTime(responseTime)} delta="Live when timing data is available" />
          </div>

          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MiniScore label="Listening Score" value={formatScore(summary?.listening_score)} />
            <MiniScore label="Reply Score" value={formatScore(summary?.reply_score)} />
            <MiniScore label="Funnel Score" value={formatScore(summary?.funnel_score)} />
          </section>

          <section className="bg-card rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="text-lg font-bold mb-6">Tool Access</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {toolCards.map((tool) => (
                <div key={tool.id} className="border border-border rounded-2xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{tool.label}</p>
                      <p className="font-semibold mt-0.5 text-safe">{tool.title}</p>
                    </div>
                    <div className={`size-10 rounded-full ${tool.color} flex items-center justify-center text-white`}>
                      <tool.icon className="size-5" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold">{tool.enabled ? "Enabled" : "Locked"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tool.enabled ? "Available for this brand plan" : "Not included in this subscription"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-2xl p-6 md:p-8 shadow-sm">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold">Message volume - last 7 days</h2>
                  <p className="text-2xl font-bold mt-3">{formatCount(totalMessages)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Classified vs total captured conversations</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Replies sent</p>
                  <p className="text-sm font-semibold">{formatCount(totalReplies)}</p>
                </div>
              </div>
              {chartData.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0.01 265)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Bar dataKey="total" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="classified" fill="var(--brand-soft)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptySurface label="No message-volume data returned yet." />
              )}
            </div>

            <div className="bg-card rounded-2xl p-6 md:p-8 shadow-sm">
              <h2 className="text-lg font-bold mb-5">Top Platforms</h2>
              {topPlatforms.length ? (
                <ul className="space-y-4">
                  {topPlatforms.map((platform) => (
                    <li key={platform.platform} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <PlatformLogo platform={(platform.platform as "instagram" | "facebook" | "tiktok" | "x")} size={18} />
                        <span>{PLATFORM_LABELS[platform.platform] ?? platform.platform}</span>
                      </div>
                      <span className="font-semibold">{formatCount(platform.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptySurface label="No platform activity has been recorded yet." />
              )}
            </div>
          </section>

          <section className="bg-card rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="text-lg font-bold mb-6">Latest Sentiment Snapshot</h2>
            {latestSentiment ? (
              <div className="space-y-5">
                {[
                  { name: "Positive", value: latestSentiment.pos, className: "bg-success" },
                  { name: "Neutral", value: latestSentiment.neu, className: "bg-slate-400" },
                  { name: "Negative", value: latestSentiment.neg, className: "bg-yellow-500" },
                ].map((item) => {
                  const total = latestSentiment.pos + latestSentiment.neu + latestSentiment.neg;
                  const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                  return (
                    <div key={item.name}>
                      <div className="flex items-center justify-between mb-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`size-3 rounded-full ${item.className}`} />
                          <span className="font-medium">{item.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {formatCount(item.value)} messages - {pct}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${item.className} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptySurface label="No sentiment data returned yet." />
            )}
          </section>

          <div className="lg:hidden">
            <Link href="/" className="text-sm text-primary font-semibold">Back to login</Link>
          </div>
        </main>
      </div>
    </div>
  );
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "0";
}

function formatScore(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)}%` : "N/A";
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatTime(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return `${value.toFixed(value >= 10 ? 0 : 1)}m`;
}

function KpiCard({
  color,
  label,
  value,
  delta,
}: {
  color: string;
  label: string;
  value: string;
  delta: string;
}) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className="text-xs mt-2 text-muted-foreground">{delta}</p>
    </div>
  );
}

function MiniScore({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">Latest backend KPI snapshot</p>
    </div>
  );
}

function DashboardNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: string;
}) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-1 text-sm">{body}</p>
      {action && <p className="mt-3 text-xs font-semibold">{action}</p>}
    </section>
  );
}

function EmptySurface({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
