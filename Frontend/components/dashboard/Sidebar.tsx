"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  // Search,
  // Layers,
  MessageSquare,
  MessageCircle,
  // Link2,
  // Palette,
  // Lightbulb,
  Gauge,
  Users,
  Settings,
  LogOut,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { EmblueLogo } from "@/components/EmblueLogo";
import { useAuth } from "@/hooks/use-auth";
import { getToolAccess } from "@/lib/api";
import { isB2CClient, isPlatformAdmin } from "@/lib/access";

type NavItem = { icon: typeof Activity; label: string; to?: string; toolId?: string };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "DASHBOARD",
    items: [
      { icon: Activity, label: "Performance", to: "/dashboard", toolId: "tool_5" },
      { icon: Gauge, label: "Social Response", to: "/social-response", toolId: "tool_5" },
    ],
  },
  // Hidden for TikTok approval: these tools currently use shared workspace pages.
  // {
  //   label: "LISTEN",
  //   items: [
  //     { icon: Search, label: "Advanced Listening", to: "/listening", toolId: "tool_1" },
  //     { icon: Layers, label: "Search & Clustering", to: "/search-clustering", toolId: "tool_2" },
  //   ],
  // },
  {
    label: "RESPOND",
    items: [
      { icon: MessageCircle, label: "AI Reply Engine", to: "/ai-reply-engine", toolId: "tool_3" },
      { icon: MessageSquare, label: "Approval Queue", to: "/approval-queue", toolId: "tool_3" },
    ],
  },
  // Hidden for TikTok approval: these tools currently use shared workspace pages.
  // {
  //   label: "CONVERT",
  //   items: [
  //     { icon: MessageSquare, label: "Comment to DM Funnel", to: "/funnels", toolId: "tool_4" },
  //     { icon: Link2, label: "Attribution & Links", to: "/attribution", toolId: "tool_6" },
  //   ],
  // },
  // {
  //   label: "CREATE & INSIGHTS",
  //   items: [
  //     { icon: Palette, label: "Creative Predictor", to: "/creative-predictor", toolId: "tool_7" },
  //     { icon: Lightbulb, label: "Comment Mining", to: "/comment-mining", toolId: "tool_8" },
  //   ],
  // },
  {
    label: "OPERATIONS",
    items: [
      // Hidden for TikTok approval: this tool currently uses a shared workspace page.
      // { icon: Gauge, label: "Campaign War Room", to: "/war-room", toolId: "tool_9" },
      { icon: Users, label: "Engage the Engager", to: "/engage-the-engager", toolId: "tool_10" },
    ],
  },
  { label: "OTHERS", items: [{ icon: Settings, label: "Settings", to: "/settings" }] },
];

export function Sidebar({ activeLabel }: { activeLabel: string }) {
  const router = useRouter();
  const { signOut, activeBrandId, authContext } = useAuth();
  const admin = isPlatformAdmin(authContext);
  const b2c = isB2CClient(authContext);
  const accessQuery = useQuery({
    queryKey: ["tool-access", activeBrandId],
    queryFn: getToolAccess,
    enabled: Boolean(activeBrandId) && !admin && !b2c,
    retry: false,
  });
  const enabled = accessQuery.data?.enabled ?? [];
  const groups: NavGroup[] = admin
    ? [{ label: "PLATFORM", items: [{ icon: ShieldCheck, label: "Admin Console", to: "/admin" }] }]
    : b2c
      ? [{ label: "CLIENT", items: [{ icon: Activity, label: "Campaign KPIs", to: "/client-portal" }] }]
      : navGroups;

  return (
    <aside className="hidden lg:flex w-72 bg-sidebar text-sidebar-foreground flex-col">
      <div className="px-6 py-8 border-b border-sidebar-border">
        <EmblueLogo variant="light" />
      </div>
      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-[0.7rem] font-semibold tracking-wider opacity-60 mb-2">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = item.label === activeLabel;
                const locked = Boolean(item.toolId && !enabled.includes(item.toolId));
                const cls = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm"
                    : locked
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-white/5"
                }`;
                return (
                  <li key={item.label}>
                    {item.to && !locked ? (
                      <Link href={item.to} className={cls}>
                        <item.icon className="size-5 shrink-0" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Link>
                    ) : (
                      <button className={cls} disabled={locked}>
                        <item.icon className="size-5 shrink-0" />
                        <span className="min-w-0 truncate">{item.label}</span>
                        {locked && <Lock className="ml-auto size-3.5" />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <button
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
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
  const { authContext } = useAuth();
  const displayName = authContext?.active_brand?.name ?? (authContext?.platform_role ? "Platform" : "Workspace");
  const role = authContext?.active_brand?.role ?? authContext?.platform_role ?? "Authenticated";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "SE";

  return (
    <header className="flex items-center justify-between px-6 md:px-10 py-6 bg-card border-b">
      <h1 className="min-w-0 text-xl md:text-2xl font-bold truncate">{title}</h1>
      <div className="flex shrink-0 items-center gap-6">
        {action}
        <div className="flex items-center gap-3 pl-6 border-l">
          <div className="size-10 rounded-full bg-accent text-primary flex items-center justify-center font-bold text-sm">{initials}</div>
          <div className="hidden sm:block">
            <p className="max-w-[180px] truncate text-sm font-semibold leading-tight">{displayName}</p>
            <p className="text-xs text-muted-foreground capitalize">{role.replace(/_/g, " ")}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
