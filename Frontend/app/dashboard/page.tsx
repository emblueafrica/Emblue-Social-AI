"use client";

import Link from "next/link";
import {
  Search,
  Layers,
  MessageSquare,
  MessageCircle,
  Link2,
  Palette,
  Lightbulb,
  Gauge,
  Users,
  AlertCircle,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo, type PlatformLogoName } from "@/components/PlatformLogo";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";



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
  { name: "Instagram", platform: "instagram", pct: 67, label: "67% Positive", positive: true },
  { name: "Tiktok", platform: "tiktok", pct: 71, label: "71% Positive", positive: true },
  { name: "X / Twitter", platform: "x", pct: 48, label: "48% Positive", positive: false },
  { name: "Facebook", platform: "facebook", pct: 67, label: "67% Positive", positive: true },
] satisfies { name: string; platform: PlatformLogoName; pct: number; label: string; positive: boolean }[];

export default function Dashboard() {
  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Performance" />

      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Overall Performance Dashboard" />

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
                      <span className="size-6 rounded-md flex items-center justify-center">
                        <PlatformLogo platform={s.platform} size={20} />
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
