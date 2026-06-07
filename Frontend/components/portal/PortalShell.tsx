"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  FileText,
  LogOut,
  PlugZap,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type PortalShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

const navItems = [
  { label: "Overview", href: "/client-portal", icon: BarChart3 },
  { label: "Audience insights", href: "/client-portal/audience-insights", icon: Users },
  { label: "Reply templates", href: "/client-portal/reply-templates", icon: FileText },
  { label: "Connected accounts", href: "/client-portal/connected-accounts", icon: PlugZap },
  { label: "Settings", href: "/client-portal/settings", icon: Settings },
];

export function PortalShell({ title, subtitle, children }: PortalShellProps) {
  return (
    <div className="portal-theme min-h-screen">
      <div className="flex min-h-screen">
        <PortalSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <PortalTopbar title={title} subtitle={subtitle} />
          <main id="portal-main" className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function PortalSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <aside className="relative hidden w-[200px] shrink-0 border-r border-[var(--portal-border)] bg-[var(--portal-surface)] lg:block">
      <div className="px-5 py-7">
        <div className="text-[34px] font-extrabold leading-none tracking-[-0.04em] text-[var(--portal-blue)]">emblue</div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--portal-text-muted)]">Client Portal</div>
      </div>
      <nav className="space-y-1 px-0 py-4" aria-label="Client portal navigation">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3 px-5 py-2.5 text-[13px] font-semibold transition ${
                active
                  ? "bg-[var(--portal-blue-soft)] text-[var(--portal-blue)] before:absolute before:left-0 before:top-0 before:h-full before:w-1.5 before:bg-[var(--portal-blue)]"
                  : "text-[var(--portal-text-body)] hover:bg-[var(--portal-surface-alt)] hover:text-[var(--portal-text)]"
              }`}
            >
              <item.icon className="size-4" strokeWidth={1.7} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="absolute bottom-0 hidden w-[200px] border-t border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 lg:block">
        <button
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
          className="flex w-full items-center gap-3 rounded-[var(--portal-radius-input)] px-3 py-2 text-[13px] font-semibold text-[var(--portal-text-muted)] transition hover:bg-[var(--portal-surface-alt)] hover:text-[var(--portal-text)]"
        >
          <LogOut className="size-4" strokeWidth={1.7} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function PortalTopbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { authContext } = useAuth();
  const brandName = authContext?.active_brand?.name ?? "Client workspace";
  const initials = brandName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "EM";

  return (
    <header className="border-b border-[var(--portal-border)] bg-[var(--portal-surface)]">
      <div className="mx-auto flex h-auto min-h-16 w-full max-w-[1240px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="text-xl font-extrabold tracking-[-0.04em] text-[var(--portal-blue)]">emblue</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--portal-text-muted)]">Client Portal</span>
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-[var(--portal-text)] sm:text-[34px] lg:mt-0">
            {title}
          </h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--portal-text-muted)]">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden rounded-[var(--portal-radius-input)] border border-[var(--portal-border-soft)] bg-[var(--portal-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--portal-text-body)] sm:flex sm:items-center sm:gap-2">
            <Sparkles className="size-3.5 text-[var(--portal-blue)]" strokeWidth={1.7} />
            Managed service
          </div>
          <div className="flex size-9 items-center justify-center rounded-full bg-[var(--portal-blue)] text-xs font-bold text-white">
            {initials}
          </div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-[var(--portal-border-soft)] bg-[var(--portal-surface)] px-4 py-2 lg:hidden" aria-label="Client portal mobile navigation">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex shrink-0 items-center gap-2 rounded-[var(--portal-radius-input)] px-3 py-2 text-xs font-semibold text-[var(--portal-text-body)] hover:bg-[var(--portal-blue-soft)] hover:text-[var(--portal-blue)]"
          >
            <item.icon className="size-3.5" strokeWidth={1.7} />
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
