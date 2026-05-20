"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Search,
  Layers,
  MessageSquare,
  MessageCircle,
  Link2,
  Palette,
  Lightbulb,
  Gauge,
  Users,
  Settings,
  LogOut,
  AlertCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { EmblueLogo } from "@/components/EmblueLogo";

const navGroups = [
  {
    label: "DASHBOARD",
    items: [{ icon: Activity, label: "Performance", active: true }],
  },
  {
    label: "LISTEN",
    items: [
      { icon: Search, label: "Advanced Listening" },
      { icon: Layers, label: "Search & Clustering" },
    ],
  },
  {
    label: "RESPOND",
    items: [{ icon: MessageCircle, label: "AI Reply Engine" }],
  },
  {
    label: "CONVERT",
    items: [
      { icon: MessageSquare, label: "Comment → DM Funnel" },
      { icon: Link2, label: "Attribution & Links" },
    ],
  },
  {
    label: "CREATE & INSIGHTS",
    items: [
      { icon: Palette, label: "Creative Predictor" },
      { icon: Lightbulb, label: "Comment Mining" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { icon: Gauge, label: "Campaign War Room" },
      { icon: Users, label: "Engage the Engager" },
    ],
  },
  {
    label: "OTHERS",
    items: [{ icon: Settings, label: "Settings" }],
  },
];

const tools = [
  { n: "Tool 1", title: "Advanced Listening", value: "124K", sub: "msgs processed", icon: Search, color: "bg-primary" },
  { n: "Tool 2", title: "Search & Clusters", value: "6", sub: "active clusters", icon: Layers, color: "bg-brand-pink" },
  { n: "Tool 3", title: "AI Reply Engine", value: "342", sub: "replies today", icon: MessageCircle, color: "bg-foreground" },
  { n: "Tool 4", title: "Comment → DM Funnel", value: "89", sub: "conversions", icon: MessageSquare, color: "bg-foreground" },
  { n: "Tool 5", title: "Attribution & Links", value: "$24.8K", sub: "revenue tracked", icon: Link2, color: "bg-primary" },
  { n: "Tool 6", title: "Creative Predictor", value: "B+", sub: "avg creative grade", icon: Palette, color: "bg-brand-pink" },
  { n: "Tool 7", title: "Comment Mining", value: "38", sub: "FAQs extracted", icon: Lightbulb, color: "bg-brand-pink" },
  { n: "Tool 8", title: "Campaign War Room", value: "80%", sub: "campaign health", icon: Gauge, color: "bg-foreground" },
  { n: "Tool 9", title: "Engage the Engager", value: "847", sub: "personalised replies", icon: Users, color: "bg-primary" },
];

const chartData = [
  { name: "Wk1", v: 12 },
  { name: "Wk2", v: 40 },
  { name: "Wk3", v: 55 },
  { name: "Wk4", v: 75 },
];

const topTools = [
  { name: "Engage the Engagers", value: "847 Fires" },
  { name: "Complaint Handler", value: "342 Replies" },
  { name: "DM Funnel - CTA", value: "89 Converts" },
  { name: "Purchase Intent", value: "$9.8K Rev" },
];

const sentiments = [
  { name: "Instagram", icon: "📷", color: "bg-pink-500", pct: 67, label: "67% Positive", positive: true },
  { name: "Tiktok", icon: "🎵", color: "bg-black", pct: 71, label: "71% Positive", positive: true },
  { name: "X / Twitter", icon: "𝕏", color: "bg-black", pct: 48, label: "48% Positive", positive: false },
  { name: "Facebook", icon: "f", color: "bg-blue-600", pct: 67, label: "67% Positive", positive: true },
];

export default function DashboardPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-72 bg-sidebar text-sidebar-foreground flex-col">
        <div className="px-6 py-8 border-b border-sidebar-border">
          <EmblueLogo variant="light" />
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 text-[0.7rem] font-semibold tracking-wider opacity-60 mb-2">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = "active" in item && item.active;
                  return (
                  <li key={item.label}>
                    <button
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <item.icon className="size-5" />
                      <span>{item.label}</span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <button
            onClick={() => router.push("/")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-white/5 transition"
          >
            <LogOut className="size-5" />
            <span className="font-semibold">Logout</span>
          </button>
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 md:px-10 py-6 bg-card border-b">
          <h1 className="text-xl md:text-2xl font-bold">Overall Performance Dashboard</h1>
          <div className="flex items-center gap-6">
            <button className="size-10 rounded-full hover:bg-muted flex items-center justify-center">
              <Bell className="size-5" />
            </button>
            <div className="flex items-center gap-3 pl-6 border-l">
              <div className="size-10 rounded-full bg-accent text-primary flex items-center justify-center font-bold text-sm">
                BC
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold leading-tight">Adeboye Toluwalogo</p>
                <p className="text-xs text-muted-foreground">Super Admin</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 md:p-10 space-y-8">
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard color="bg-primary" label="Total Messages Processed" value="124K" delta="↑ 18% vs last month" up />
            <KpiCard color="bg-brand-pink" label="Total Replies Sent" value="18,420" delta="↑ 34% vs last month" up />
            <KpiCard color="bg-brand-olive" label="Revenue Attributed" value="$24,810" delta="↑ 22% vs last month" up />
            <KpiCard color="bg-destructive" label="Avg Response Time" value="1.8m" delta="↓ from 38m manual" />
          </div>

          {/* Tools grid */}
          <section className="bg-card rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="text-lg font-bold mb-6">All Tools Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tools.map((t) => (
                <div key={t.n} className="border border-border rounded-2xl p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{t.n}</p>
                      <p className="font-semibold mt-0.5">{t.title}</p>
                    </div>
                    <div className={`size-10 rounded-full ${t.color} flex items-center justify-center text-white`}>
                      <t.icon className="size-5" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold">{t.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.sub}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Revenue + Top tools */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-2xl p-6 md:p-8 shadow-sm">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold">Revenue attributed — last 4 weeks</h2>
                  <p className="text-2xl font-bold mt-3">$24,810</p>
                  <p className="text-xs text-success mt-1">↑ 18% vs last month</p>
                </div>
                <div className="text-right">
                  <span className="inline-block bg-success/15 text-success text-xs font-semibold px-3 py-1 rounded-full">
                    +22% vs last month
                  </span>
                  <p className="text-xs text-muted-foreground mt-3">Best week</p>
                  <p className="text-sm font-semibold">Wk 4 - $24.8k</p>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0.01 265)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${v}k`} />
                    <Bar dataKey="v" fill="var(--brand-soft)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card rounded-2xl p-6 md:p-8 shadow-sm">
              <h2 className="text-lg font-bold mb-5">Top Performing Tools</h2>
              <ul className="space-y-4">
                {topTools.map((t) => (
                  <li key={t.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="size-5 text-primary" />
                      <span>{t.name}</span>
                    </div>
                    <span className="font-semibold">{t.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Sentiment */}
          <section className="bg-card rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="text-lg font-bold mb-6">Platform Sentiment Health</h2>
            <div className="space-y-5">
              {sentiments.map((s) => (
                <div key={s.name}>
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`size-6 rounded-md ${s.color} text-white text-xs flex items-center justify-center font-bold`}>
                        {s.icon}
                      </span>
                      <span className="font-medium">{s.name}</span>
                    </div>
                    <span className={`text-xs font-semibold ${s.positive ? "text-success" : "text-yellow-600"}`}>
                      {s.label}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${s.positive ? "bg-success" : "bg-yellow-500"} rounded-full`}
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="lg:hidden">
            <Link href="/" className="text-sm text-primary font-semibold">← Back to login</Link>
          </div>
        </main>
      </div>
    </div>
  );
}

function KpiCard({
  color,
  label,
  value,
  delta,
  up,
}: {
  color: string;
  label: string;
  value: string;
  delta: string;
  up?: boolean;
}) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className={`text-xs mt-2 ${up ? "text-success" : "text-destructive"}`}>{delta}</p>
    </div>
  );
}
