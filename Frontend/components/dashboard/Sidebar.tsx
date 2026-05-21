"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
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
} from "lucide-react";
import { EmblueLogo } from "@/components/EmblueLogo";

type NavItem = { icon: typeof Activity; label: string; to?: string };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "DASHBOARD",
    items: [
      { icon: Activity, label: "Performance", to: "/dashboard" },
      { icon: Gauge, label: "Social Response", to: "/social-response" },
    ],
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
    items: [
      { icon: MessageCircle, label: "AI Reply Engine", to: "/ai-reply-engine" },
      { icon: MessageSquare, label: "Approval Queue", to: "/approval-queue" },
    ],
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
      { icon: Users, label: "Engage the Engager", to: "/engage-the-engager" },
    ],
  },
  { label: "OTHERS", items: [{ icon: Settings, label: "Settings" }] },
];

export function Sidebar({ activeLabel }: { activeLabel: string }) {
  const router = useRouter();
  return (
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
                const active = item.label === activeLabel;
                const cls = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm"
                    : "hover:bg-white/5"
                }`;
                return (
                  <li key={item.label}>
                    {item.to ? (
                      <Link href={item.to} className={cls}>
                        <item.icon className="size-5" />
                        <span>{item.label}</span>
                      </Link>
                    ) : (
                      <button className={cls}>
                        <item.icon className="size-5" />
                        <span>{item.label}</span>
                      </button>
                    )}
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
  );
}

export function DashHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between px-6 md:px-10 py-6 bg-card border-b">
      <h1 className="text-xl md:text-2xl font-bold">{title}</h1>
      <div className="flex items-center gap-6">
        {action}
        <button className="size-10 rounded-full hover:bg-muted flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        </button>
        <div className="flex items-center gap-3 pl-6 border-l">
          <div className="size-10 rounded-full bg-accent text-primary flex items-center justify-center font-bold text-sm">BC</div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-tight">Bola Cunha</p>
            <p className="text-xs text-muted-foreground">Super Admin</p>
          </div>
        </div>
      </div>
    </header>
  );
}
