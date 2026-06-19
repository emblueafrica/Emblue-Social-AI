"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Download, Plus } from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo, type PlatformLogoName } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, getCampaignStats, type CampaignStatsResponse } from "@/lib/api";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const RANGES = ["This week", "Last week", "Last 30 days", "This quarter", "Custom range"];

type StatsPlatform = Extract<PlatformLogoName, "instagram" | "facebook" | "tiktok" | "x">;

type PlatformStats = {
  name: string;
  platform: StatsPlatform;
  total: number;
  sent: number;
  manual: number;
  queued: number;
  color: string;
};

const PLATFORM_META: Record<StatsPlatform, { name: string; color: string }> = {
  instagram: { name: "Instagram", color: "bg-green-500" },
  tiktok: { name: "TikTok", color: "bg-green-500" },
  x: { name: "X", color: "bg-yellow-400" },
  facebook: { name: "Facebook", color: "bg-green-500" },
};

const PLATFORM_ORDER: StatsPlatform[] = ["instagram", "tiktok", "x", "facebook"];

function normalizePlatform(platform: string): StatsPlatform | null {
  if (platform === "instagram" || platform === "facebook" || platform === "tiktok" || platform === "x") return platform;
  return null;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatPercent(part: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatTime(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(value >= 10 ? 0 : 1)}m`;
}

export default function SocialResponse() {
  const { activeBrandId } = useAuth();
  const [range, setRange] = useState("This week");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["campaign-stats", activeBrandId],
    queryFn: () => getCampaignStats(activeBrandId!),
    enabled: Boolean(activeBrandId),
    staleTime: 30_000,
    retry: false,
  });

  const platformStats = useMemo<PlatformStats[]>(() => {
    const byPlatform = new Map<StatsPlatform, CampaignStatsResponse["stats"][number]>();
    for (const row of statsQuery.data?.stats ?? []) {
      const platform = normalizePlatform(row.platform);
      if (platform) byPlatform.set(platform, row);
    }

    return PLATFORM_ORDER.map((platform) => {
      const row = byPlatform.get(platform);
      const meta = PLATFORM_META[platform];
      return {
        name: meta.name,
        platform,
        total: row?.total ?? 0,
        sent: row?.sent ?? 0,
        manual: row?.manual ?? 0,
        queued: row?.queued ?? 0,
        color: meta.color,
      };
    });
  }, [statsQuery.data?.stats]);

  const totals = useMemo(
    () =>
      platformStats.reduce(
        (acc, row) => ({
          total: acc.total + row.total,
          sent: acc.sent + row.sent,
          manual: acc.manual + row.manual,
          queued: acc.queued + row.queued,
        }),
        { total: 0, sent: 0, manual: 0, queued: 0 },
      ),
    [platformStats],
  );

  const lockedError = statsQuery.error instanceof ApiError && statsQuery.error.status === 403 ? statsQuery.error : null;
  const summary = statsQuery.data?.summary;
  const attribution = statsQuery.data?.attribution;
  const scoreTrend =
    statsQuery.data?.score_trend?.map((row) => ({
      d: row.d,
      listening: row.listening ?? 0,
      reply: row.reply ?? 0,
      funnel: row.funnel ?? 0,
    })) ?? [];
  const messageVolume = statsQuery.data?.message_volume ?? [];
  const sentimentData = statsQuery.data?.sentiment ?? [];
  const riskRows =
    statsQuery.data?.risk_events?.map((event) => ({
      time: new Date(event.time).toLocaleString("en-US", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
      tag: event.tag,
      tagClass: event.severity === "CRITICAL" ? "bg-pink-100 text-pink-700" : "bg-amber-100 text-amber-700",
      severity: event.severity,
      sevClass:
        event.severity === "CRITICAL"
          ? "bg-red-500 text-white"
          : event.severity === "HIGH"
            ? "bg-amber-400 text-white"
            : "bg-slate-300 text-slate-800",
      text: event.text,
    })) ?? [];
  const activePlatforms = platformStats.filter((row) => row.total > 0).length;
  const isEmpty = Boolean(statsQuery.data) && totals.total === 0;

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Social Response" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Social Response Dashboard" />

        <main className="flex-1 p-6 md:p-8 space-y-6 text-safe layout-safe">
          {!activeBrandId && <StatusNotice tone="warning" title="No active brand workspace" body="This account is not attached to an approved brand workspace yet." />}
          {statsQuery.isLoading && <StatusNotice title="Loading campaign stats" body="Fetching the last 30 days of social response activity." />}
          {lockedError && <StatusNotice tone="warning" title="Social response is locked" body={lockedError.message} />}
          {statsQuery.isError && !lockedError && (
            <StatusNotice tone="danger" title="Campaign stats unavailable" body={statsQuery.error instanceof Error ? statsQuery.error.message : "Unable to load campaign stats."} />
          )}
          {isEmpty && <StatusNotice title="No campaign activity yet" body="No auto-engagement stats were found for this brand in the last 30 days." />}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="relative">
              <button onClick={() => setRangeOpen((value) => !value)} className="flex items-center gap-2 bg-card border rounded-xl px-4 py-2.5 text-sm font-medium min-w-[170px] justify-between">
                {range} <ChevronDown className="size-4" />
              </button>
              {rangeOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-card border rounded-xl shadow-lg overflow-hidden z-10">
                  {RANGES.map((item) => (
                    <button key={item} onClick={() => { setRange(item); setRangeOpen(false); }} className={`block w-full text-left px-4 py-2.5 text-sm hover:bg-muted ${item === range ? "font-semibold" : ""}`}>
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 text-sm font-semibold"><Plus className="size-4" /> New Campaign</button>
            <button className="flex items-center gap-2 bg-card border rounded-xl px-4 py-2.5 text-sm font-semibold"><Download className="size-4" /> Export PDF</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <ScoreKpi color="bg-primary" label="Listening Score" value={statsQuery.isLoading ? "..." : String(summary?.listening_score ?? "-")} delta="Latest KPI snapshot" />
            <ScoreKpi color="bg-brand-pink" label="Reply Score" value={statsQuery.isLoading ? "..." : String(summary?.reply_score ?? formatPercent(totals.sent, totals.total))} delta="Latest KPI snapshot" />
            <ScoreKpi color="bg-brand-olive" label="Funnel Score" value={statsQuery.isLoading ? "..." : String(summary?.funnel_score ?? "-")} delta="Latest KPI snapshot" />
            <ScoreKpi color="bg-destructive" label="Risk Events" value={statsQuery.isLoading ? "..." : String(summary?.risk_events ?? riskRows.length)} delta="This period" valueDanger />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MiniKpi label="Avg Response Time" value={statsQuery.isLoading ? "..." : formatTime(summary?.avg_response_time_minutes)} sub="Live when timing is available" />
            <MiniKpi label="Messages Processed" value={statsQuery.isLoading ? "..." : formatCount(summary?.total_messages ?? totals.total)} sub="Last 30 days" />
            <MiniKpi label="Replies Sent" value={statsQuery.isLoading ? "..." : formatCount(summary?.replies_sent ?? totals.sent)} sub="Live campaign stats" />
            <MiniKpi label="Auto-Fired" value={statsQuery.isLoading ? "..." : formatPercent(totals.sent, totals.total)} sub="Sent share" />
            <MiniKpi label="Manual Review" value={statsQuery.isLoading ? "..." : formatPercent(summary?.manual_reviews ?? totals.manual, totals.total)} sub={`${formatCount(summary?.manual_reviews ?? totals.manual)} manual`} />
            <MiniKpi label="Queued" value={statsQuery.isLoading ? "..." : formatCount(summary?.queued ?? totals.queued)} sub="Waiting to send" />
            <MiniKpi label="Revenue" value={statsQuery.isLoading ? "..." : formatMoney(summary?.revenue_attributed ?? attribution?.revenue)} sub={`${formatCount(attribution?.conversions ?? 0)} conversions`} />
            <MiniKpi label="Active Platforms" value={statsQuery.isLoading ? "..." : `${activePlatforms}/4`} sub="IG, FB, X, TT" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Score Trend" description="Listening, reply, and funnel scores">
              {scoreTrend.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scoreTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0.01 265)" />
                      <XAxis dataKey="d" axisLine={false} tickLine={false} fontSize={12} />
                      <YAxis axisLine={false} tickLine={false} fontSize={12} domain={[0, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="listening" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="reply" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="funnel" stroke="#facc15" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState label="No score trend returned yet." />
              )}
            </ChartCard>

            <ChartCard title="Message Volume" description="Classified vs total received">
              {messageVolume.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={messageVolume} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0.01 265)" />
                      <XAxis dataKey="d" axisLine={false} tickLine={false} fontSize={12} />
                      <YAxis axisLine={false} tickLine={false} fontSize={12} tickFormatter={(value) => `${value / 1000}k`} />
                      <Tooltip />
                      <Bar dataKey="total" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="classified" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState label="No message volume returned yet." />
              )}
            </ChartCard>
          </div>

          <section className="bg-card rounded-2xl p-6 shadow-sm">
            <h2 className="font-bold">Platform Breakdown</h2>
            <p className="text-xs text-muted-foreground mb-5">Last 30 days by platform</p>
            <div className="space-y-5">
              {platformStats.map((platform) => (
                <div key={platform.name}>
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <PlatformLogo platform={platform.platform} size={18} />
                      {platform.name}
                    </div>
                    <span className="font-semibold">{formatCount(platform.total)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${platform.color}`} style={{ width: `${totals.total > 0 ? Math.max(4, Math.min(100, (platform.total / totals.total) * 100)) : 0}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCount(platform.sent)} sent | {formatCount(platform.manual)} manual | {formatCount(platform.queued)} queued
                  </p>
                </div>
              ))}
            </div>
          </section>

          <ChartCard title="Sentiment Breakdown" description="Positive, neutral, and negative">
            {sentimentData.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sentimentData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0.01 265)" />
                    <XAxis dataKey="d" axisLine={false} tickLine={false} fontSize={12} />
                    <YAxis axisLine={false} tickLine={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="pos" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="neu" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="neg" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState label="No sentiment data returned yet." />
            )}
          </ChartCard>

          <section className="bg-card rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="font-bold">Risk Events</h2>
                <span className="bg-red-500 text-white text-xs font-semibold rounded-full px-2.5 py-0.5">{riskRows.length}</span>
              </div>
              <button onClick={() => setCollapsed((value) => !value)} className="flex items-center gap-1 text-sm font-medium">
                {collapsed ? "Expand" : "Collapse"}
                <ChevronDown className={`size-4 transition ${collapsed ? "" : "rotate-180"}`} />
              </button>
            </div>
            {!collapsed && riskRows.length > 0 && (
              <ul className="divide-y">
                {riskRows.map((risk, index) => (
                  <li key={`${risk.time}-${index}`} className="flex items-center gap-4 py-4 text-sm">
                    <span className="text-muted-foreground w-20 shrink-0">{risk.time}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${risk.tagClass}`}>{risk.tag}</span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded ${risk.sevClass}`}>{risk.severity}</span>
                    <span className="flex-1 min-w-0 text-muted-foreground text-safe">{risk.text}</span>
                    <button className="text-primary font-semibold flex items-center gap-1">
                      Investigate <ArrowRight className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!collapsed && riskRows.length === 0 && <EmptyState label="No risk events returned for this period." />}
          </section>
        </main>
      </div>
    </div>
  );
}

function StatusNotice({ title, body, tone = "neutral" }: { title: string; body: string; tone?: "neutral" | "warning" | "danger" }) {
  const toneClass = {
    neutral: "border-border bg-card text-muted-foreground",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[tone];

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

function ScoreKpi({ color, label, value, delta, valueDanger }: { color: string; label: string; value: string; delta: string; valueDanger?: boolean }) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold mt-2 ${valueDanger ? "text-destructive" : ""}`}>{value}</p>
      <p className="text-xs mt-2 text-muted-foreground">{delta}</p>
    </div>
  );
}

function MiniKpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card rounded-2xl p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-2xl p-6 shadow-sm">
      <h2 className="font-bold">{title}</h2>
      <p className="text-xs text-muted-foreground mb-4">{description}</p>
      {children}
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">{label}</div>;
}
