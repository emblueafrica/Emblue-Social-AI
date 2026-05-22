"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Plus,
  Download,
  ArrowRight,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo, type PlatformLogoName } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, apiRequest } from "@/lib/api";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
} from "recharts";

const RANGES = ["This week", "Last week", "Last 30 days", "This quarter", "Custom range…"];

type CampaignStatsRow = {
  platform: string;
  total: number;
  sent: number;
  manual: number;
  queued: number;
};

type CampaignStatsResponse = {
  stats: CampaignStatsRow[];
  summary?: {
    total_messages: number;
    replies_sent: number;
    manual_reviews: number;
    queued: number;
    listening_score: number | null;
    reply_score: number | null;
    funnel_score: number | null;
    risk_events: number;
    avg_response_time_minutes: number | null;
    revenue_attributed: number | null;
  };
  score_trend?: { d: string; listening: number | null; reply: number | null; funnel: number | null }[];
  message_volume?: { d: string; classified: number; total: number }[];
  sentiment?: { d: string; pos: number; neu: number; neg: number }[];
  risk_events?: {
    time: string;
    platform: string;
    tag: string;
    severity: string;
    text: string;
    sentiment: string | null;
    urgency_score: number | null;
    topics: string[];
  }[];
  attribution?: {
    clicks: number;
    conversions: number;
    revenue: number | null;
  };
};

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
  tiktok: { name: "Tiktok", color: "bg-green-500" },
  x: { name: "X / Twitter", color: "bg-yellow-400" },
  facebook: { name: "Facebook", color: "bg-green-500" },
};

const PLATFORM_ORDER: StatsPlatform[] = ["instagram", "tiktok", "x", "facebook"];

function getCampaignStats(brandId: number) {
  return apiRequest<CampaignStatsResponse>(`/api/v1/campaigns/${brandId}/stats`);
}

function normalizePlatform(platform: string): StatsPlatform | null {
  if (platform === "instagram" || platform === "facebook" || platform === "tiktok" || platform === "x") {
    return platform;
  }
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

const fallbackScoreTrend = [
  { d: "Mon", listening: 55, reply: 55, funnel: 55 },
  { d: "Tue", listening: 60, reply: 58, funnel: 55 },
  { d: "Wed", listening: 68, reply: 60, funnel: 52 },
  { d: "Thu", listening: 70, reply: 62, funnel: 50 },
  { d: "Fri", listening: 74, reply: 63, funnel: 50 },
  { d: "Sat", listening: 78, reply: 63, funnel: 50 },
  { d: "Sun", listening: 80, reply: 64, funnel: 50 },
];

const fallbackMessageVolume = [
  { d: "Mon", classified: 1700, total: 2000 },
  { d: "Tue", classified: 2000, total: 2400 },
  { d: "Wed", classified: 2300, total: 2700 },
  { d: "Thu", classified: 2200, total: 2700 },
  { d: "Fri", classified: 2800, total: 3300 },
  { d: "Sat", classified: 1600, total: 1900 },
  { d: "Sun", classified: 1700, total: 2000 },
];

const fallbackSentimentData = [
  { d: "Mon", pos: 320, neu: 220, neg: 80 },
  { d: "Tue", pos: 320, neu: 220, neg: 80 },
  { d: "Wed", pos: 340, neu: 220, neg: 90 },
  { d: "Thu", pos: 430, neu: 250, neg: 100 },
  { d: "Fri", pos: 500, neu: 260, neg: 120 },
  { d: "Sat", pos: 270, neu: 200, neg: 90 },
  { d: "Sun", pos: 280, neu: 210, neg: 95 },
];

type RiskRow = {
  time: string;
  tag: string;
  tagClass: string;
  severity: string;
  sevClass: string;
  text: string;
};

const risks: RiskRow[] = [
  {
    time: "Wed 14:42",
    tag: "Keyword Surge",
    tagClass: "bg-pink-100 text-pink-700",
    severity: "CRITICAL",
    sevClass: "bg-red-500 text-white",
    text: '"refund" mentions up 340% on Instagram — concentrated around the @kemiwears Summer Drop campaign.',
  },
  {
    time: "Wed 14:42",
    tag: "Complaint Cluster",
    tagClass: "bg-amber-100 text-amber-700",
    severity: "HIGH",
    sevClass: "bg-amber-400 text-white",
    text: "12 separate users reported affiliate links 404ing — all routed via the same UTM source.",
  },
  {
    time: "Wed 14:42",
    tag: "Sentiment Spike",
    tagClass: "bg-amber-100 text-amber-700",
    severity: "HIGH",
    sevClass: "bg-amber-400 text-white",
    text: "Negative sentiment on X jumped from 8% to 27% in a 4-hour window — escalation rule did not fire.",
  },
  {
    time: "Wed 14:42",
    tag: "Response Delay",
    tagClass: "bg-indigo-100 text-indigo-700",
    severity: "MEDIUM",
    sevClass: "bg-slate-300 text-slate-800",
    text: "Avg response time on Facebook crossed 6m for 38 consecutive minutes — auto-routing fell back to manual.",
  },
];

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
    const byPlatform = new Map<StatsPlatform, CampaignStatsRow>();
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

  const lockedError =
    statsQuery.error instanceof ApiError && statsQuery.error.status === 403
      ? statsQuery.error
      : null;
  const isEmpty = Boolean(statsQuery.data) && totals.total === 0;
  const activePlatforms = platformStats.filter((row) => row.total > 0).length;
  const summary = statsQuery.data?.summary;
  const attribution = statsQuery.data?.attribution;
  const scoreTrend = statsQuery.data?.score_trend?.length
    ? statsQuery.data.score_trend.map((row) => ({
        d: row.d,
        listening: row.listening ?? 0,
        reply: row.reply ?? 0,
        funnel: row.funnel ?? 0,
      }))
    : fallbackScoreTrend;
  const messageVolume = statsQuery.data?.message_volume?.length
    ? statsQuery.data.message_volume
    : fallbackMessageVolume;
  const sentimentData = statsQuery.data?.sentiment?.length
    ? statsQuery.data.sentiment
    : fallbackSentimentData;
  const riskRows: RiskRow[] = statsQuery.data?.risk_events?.length
    ? statsQuery.data.risk_events.map((event) => ({
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
      }))
    : risks;

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Social Response" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Social Response Dashboard" />

        <main className="flex-1 p-6 md:p-8 space-y-6">
          {!activeBrandId && (
            <StatusNotice
              tone="warning"
              title="No active brand workspace"
              body="This account is authenticated, but it is not attached to an approved brand workspace yet."
            />
          )}

          {statsQuery.isLoading && (
            <StatusNotice title="Loading campaign stats" body="Fetching the last 30 days of social response activity." />
          )}

          {lockedError && (
            <StatusNotice tone="warning" title="Social response is locked" body={lockedError.message} />
          )}

          {statsQuery.isError && !lockedError && (
            <StatusNotice
              tone="danger"
              title="Campaign stats unavailable"
              body={statsQuery.error instanceof Error ? statsQuery.error.message : "Unable to load campaign stats."}
            />
          )}

          {isEmpty && (
            <StatusNotice
              title="No campaign activity yet"
              body="No auto-engagement stats were found for this brand in the last 30 days."
            />
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="relative">
              <button
                onClick={() => setRangeOpen((v) => !v)}
                className="flex items-center gap-2 bg-card border rounded-xl px-4 py-2.5 text-sm font-medium min-w-[170px] justify-between"
              >
                {range} <ChevronDown className="size-4" />
              </button>
              {rangeOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-card border rounded-xl shadow-lg overflow-hidden z-10">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        setRange(r);
                        setRangeOpen(false);
                      }}
                      className={`block w-full text-left px-4 py-2.5 text-sm hover:bg-muted ${
                        r === range ? "font-semibold" : ""
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 text-sm font-semibold">
              <Plus className="size-4" /> New Campaign
            </button>
            <button className="flex items-center gap-2 bg-card border rounded-xl px-4 py-2.5 text-sm font-semibold">
              <Download className="size-4" /> Export PDF
            </button>
          </div>

          {/* Score KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <ScoreKpi
              color="bg-primary"
              label="Listening Score"
              value={statsQuery.isLoading ? "..." : String(summary?.listening_score ?? "-")}
              delta={summary?.listening_score === null ? "Waiting for KPI snapshot" : "Latest KPI snapshot"}
            />
            <ScoreKpi
              color="bg-brand-pink"
              label="Reply Score"
              value={statsQuery.isLoading ? "..." : String(summary?.reply_score ?? formatPercent(totals.sent, totals.total))}
              delta={summary?.reply_score === null ? "Sent replies / total responses" : "Latest KPI snapshot"}
            />
            <ScoreKpi
              color="bg-brand-olive"
              label="Funnel Score"
              value={statsQuery.isLoading ? "..." : String(summary?.funnel_score ?? "-")}
              delta={summary?.funnel_score === null ? "Waiting for funnel KPI" : "Latest KPI snapshot"}
            />
            <ScoreKpi
              color="bg-destructive"
              label="Risk Events"
              value={statsQuery.isLoading ? "..." : String(summary?.risk_events ?? riskRows.length)}
              delta="This period"
              danger
              valueDanger
            />
          </div>

          {/* Mini KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MiniKpi label="Avg Response Time" value={statsQuery.isLoading ? "..." : formatTime(summary?.avg_response_time_minutes)} sub="Live when response timing is available" />
            <MiniKpi label="Messages Processed" value={statsQuery.isLoading ? "..." : formatCount(summary?.total_messages ?? totals.total)} sub="Last 30 days" />
            <MiniKpi label="Replies Sent" value={statsQuery.isLoading ? "..." : formatCount(summary?.replies_sent ?? totals.sent)} sub="Live from campaign stats" />
            <MiniKpi label="Auto-Fired" value={statsQuery.isLoading ? "..." : formatPercent(totals.sent, totals.total)} sub="Sent status share" />
            <MiniKpi label="Manual Review" value={statsQuery.isLoading ? "..." : formatPercent(summary?.manual_reviews ?? totals.manual, totals.total)} sub={`${formatCount(summary?.manual_reviews ?? totals.manual)} manual copy`} />
            <MiniKpi label="Queued" value={statsQuery.isLoading ? "..." : formatCount(summary?.queued ?? totals.queued)} sub="Waiting to send" />
            <MiniKpi label="Revenue" value={statsQuery.isLoading ? "..." : formatMoney(summary?.revenue_attributed ?? attribution?.revenue)} sub={`${formatCount(attribution?.conversions ?? 0)} conversions`} />
            <MiniKpi label="Active Platforms" value={statsQuery.isLoading ? "..." : `${activePlatforms}/4`} sub="IG - FB - X - TT" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-2xl p-6 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h2 className="font-bold">Score Trend</h2>
                  <p className="text-xs text-muted-foreground">Listening - Reply - Funnel</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <LegendDot color="bg-blue-500" label="Listening" />
                  <LegendDot color="bg-green-500" label="Reply" />
                  <LegendDot color="bg-yellow-400" label="Funnel" />
                </div>
              </div>
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
            </div>

            <div className="bg-card rounded-2xl p-6 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h2 className="font-bold">Message Volume</h2>
                  <p className="text-xs text-muted-foreground">Classified vs total received</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <LegendDot color="bg-blue-600" label="Classified" />
                  <LegendDot color="bg-slate-300" label="Unclassified" />
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={messageVolume} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0.01 265)" />
                    <XAxis dataKey="d" axisLine={false} tickLine={false} fontSize={12} />
                    <YAxis axisLine={false} tickLine={false} fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
                    <Tooltip />
                    <Bar dataKey="total" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="classified" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Platform breakdown bars */}
          <div className="bg-card rounded-2xl p-6 shadow-sm">
            <h2 className="font-bold">Platform Breakdown</h2>
            <p className="text-xs text-muted-foreground mb-5">Last 30 days by platform</p>
            <div className="space-y-5">
              {platformStats.map((p) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="size-5 inline-flex items-center justify-center"><PlatformLogo platform={p.platform} size={18} /></span>
                      {p.name}
                    </div>
                    <span className="font-semibold">{formatCount(p.total)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${p.color}`} style={{ width: `${totals.total > 0 ? Math.max(4, Math.min(100, (p.total / totals.total) * 100)) : 0}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCount(p.sent)} sent - {formatCount(p.manual)} manual - {formatCount(p.queued)} queued
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Sentiment chart */}
          <div className="bg-card rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-bold">Sentiment Breakdown</h2>
                <p className="text-xs text-muted-foreground">Positive - neutral - negative</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <LegendDot color="bg-green-500" label="Positive" />
                <LegendDot color="bg-slate-300" label="Neutral" />
                <LegendDot color="bg-red-500" label="Negative" />
              </div>
            </div>
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
          </div>

          {/* Risk events */}
          <div className="bg-card rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="font-bold">Risk Events</h2>
                <span className="bg-red-500 text-white text-xs font-semibold rounded-full px-2.5 py-0.5">4</span>
              </div>
              <button
                onClick={() => setCollapsed((v) => !v)}
                className="flex items-center gap-1 text-sm font-medium"
              >
                {collapsed ? "Expand" : "Collapse"}
                <ChevronDown className={`size-4 transition ${collapsed ? "" : "rotate-180"}`} />
              </button>
            </div>
            {!collapsed && (
              <ul className="divide-y">
                {riskRows.map((r, i) => (
                  <li key={i} className="flex items-center gap-4 py-4 text-sm">
                    <span className="text-muted-foreground w-20 shrink-0">{r.time}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${r.tagClass}`}>{r.tag}</span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded ${r.sevClass}`}>{r.severity}</span>
                    <span className="flex-1 text-muted-foreground">{r.text}</span>
                    <button className="text-primary font-semibold flex items-center gap-1">
                      Investigate <ArrowRight className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function StatusNotice({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "warning" | "danger";
}) {
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

function ScoreKpi({
  color,
  label,
  value,
  delta,
  danger,
  valueDanger,
}: {
  color: string;
  label: string;
  value: string;
  delta: string;
  danger?: boolean;
  valueDanger?: boolean;
}) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold mt-2 ${valueDanger ? "text-destructive" : ""}`}>{value}</p>
      <p className={`text-xs mt-2 ${danger ? "text-muted-foreground" : "text-muted-foreground"}`}>{delta}</p>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className={`size-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
