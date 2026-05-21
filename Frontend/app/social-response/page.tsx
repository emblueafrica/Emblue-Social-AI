"use client";

import { useState } from "react";
import {
  ChevronDown,
  Plus,
  Download,
  Bell,
  ArrowRight,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo, type PlatformLogoName } from "@/components/PlatformLogo";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Tooltip,
} from "recharts";

const RANGES = ["This week", "Last week", "Last 30 days", "This quarter", "Custom range…"];

const scoreTrend = [
  { d: "Mon", listening: 55, reply: 55, funnel: 55 },
  { d: "Tue", listening: 60, reply: 58, funnel: 55 },
  { d: "Wed", listening: 68, reply: 60, funnel: 52 },
  { d: "Thu", listening: 70, reply: 62, funnel: 50 },
  { d: "Fri", listening: 74, reply: 63, funnel: 50 },
  { d: "Sat", listening: 78, reply: 63, funnel: 50 },
  { d: "Sun", listening: 80, reply: 64, funnel: 50 },
];

const messageVolume = [
  { d: "Mon", classified: 1700, total: 2000 },
  { d: "Tue", classified: 2000, total: 2400 },
  { d: "Wed", classified: 2300, total: 2700 },
  { d: "Thu", classified: 2200, total: 2700 },
  { d: "Fri", classified: 2800, total: 3300 },
  { d: "Sat", classified: 1600, total: 1900 },
  { d: "Sun", classified: 1700, total: 2000 },
];

const sentimentData = [
  { d: "Mon", pos: 320, neu: 220, neg: 80 },
  { d: "Tue", pos: 320, neu: 220, neg: 80 },
  { d: "Wed", pos: 340, neu: 220, neg: 90 },
  { d: "Thu", pos: 430, neu: 250, neg: 100 },
  { d: "Fri", pos: 500, neu: 260, neg: 120 },
  { d: "Sat", pos: 270, neu: 200, neg: 90 },
  { d: "Sun", pos: 280, neu: 210, neg: 95 },
];

const platforms: { name: string; value: number; color: string; platform: PlatformLogoName }[] = [
  { name: "Instagram", value: 7842, color: "bg-green-500", platform: "instagram" },
  { name: "Tiktok", value: 4620, color: "bg-green-500", platform: "tiktok" },
  { name: "X / Twitter", value: 3210, color: "bg-yellow-400", platform: "x" },
  { name: "Facebook", value: 2748, color: "bg-green-500", platform: "facebook" },
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
  const [range, setRange] = useState("This week");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Performance" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Social Response Dashboard" />

        <main className="flex-1 p-6 md:p-8 space-y-6">
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
            <ScoreKpi color="bg-primary" label="Listening Score" value="87" delta="+12 vs last week" />
            <ScoreKpi color="bg-brand-pink" label="Reply Score" value="74" delta="+8 vs last week" />
            <ScoreKpi color="bg-brand-olive" label="Funnel Score" value="61" delta="-3 vs last week" />
            <ScoreKpi color="bg-destructive" label="Risk Events" value="4" delta="This period" danger valueDanger />
          </div>

          {/* Mini KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MiniKpi label="Avg Response Time" value="4.2m" sub="↓ 0.6m vs last week" />
            <MiniKpi label="Messages Processed" value="18,420" sub="+1,240 this week" />
            <MiniKpi label="Replies Sent" value="342" sub="+34 vs last week" />
            <MiniKpi label="Auto-Fired" value="78%" sub="within tolerance" />
            <MiniKpi label="Manual Review" value="22%" sub="operator-touched" />
            <MiniKpi label="Conversions" value="89" sub="+11 vs last week" />
            <MiniKpi label="Revenue" value="$24,810" sub="+$4.1K vs last week" />
            <MiniKpi label="Auto-Fired" value="4/4" sub="IG · FB · X · TT" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-2xl p-6 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h2 className="font-bold">Score Trend</h2>
                  <p className="text-xs text-muted-foreground">Listening · Reply · Funnel</p>
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
            <p className="text-xs text-muted-foreground mb-5">Classified vs total received</p>
            <div className="space-y-5">
              {platforms.map((p) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="size-5 inline-flex items-center justify-center"><PlatformLogo platform={p.platform} size={18} /></span>
                      {p.name}
                    </div>
                    <span className="font-semibold">{p.value.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${p.color}`} style={{ width: `${Math.min(100, (p.value / 8000) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sentiment chart */}
          <div className="bg-card rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-bold">Platform Breakdown</h2>
                <p className="text-xs text-muted-foreground">Classified vs total received</p>
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
                <h2 className="font-bold">Platform Breakdown</h2>
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
                {risks.map((r, i) => (
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
