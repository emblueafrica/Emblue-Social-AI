import { BarChart3 } from "lucide-react";

export function PortalCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[var(--portal-radius-card)] border border-[var(--portal-border)] bg-[var(--portal-surface)] shadow-[var(--portal-shadow-card)] ${className}`}
    >
      {children}
    </section>
  );
}

export function PortalSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <PortalCard className="p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold tracking-[-0.01em] text-[var(--portal-text)]">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--portal-text-muted)]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </PortalCard>
  );
}

export function PortalStatCard({
  label,
  value,
  tone = "blue",
  detail,
}: {
  label: string;
  value: string;
  tone?: "blue" | "green" | "amber" | "pink";
  detail?: string;
}) {
  const toneClass = {
    blue: "bg-[var(--portal-blue)]",
    green: "bg-[var(--portal-success)]",
    amber: "bg-[var(--portal-warning)]",
    pink: "bg-[var(--portal-danger)]",
  }[tone];

  return (
    <PortalCard className="relative overflow-hidden p-5">
      <div className={`absolute inset-y-0 left-0 w-1.5 ${toneClass}`} />
      <p className="text-xs font-semibold text-[var(--portal-text-muted)]">{label}</p>
      <p className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-[var(--portal-text)]">{value}</p>
      {detail && <p className="mt-2 text-xs leading-5 text-[var(--portal-text-muted)]">{detail}</p>}
    </PortalCard>
  );
}

export function PortalEmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[var(--portal-radius-card)] border border-dashed border-[var(--portal-border)] bg-[var(--portal-surface-alt)] p-6 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--portal-blue-soft)] text-[var(--portal-blue)]">
        <BarChart3 className="size-5" strokeWidth={1.7} />
      </div>
      <h3 className="mt-3 text-sm font-bold text-[var(--portal-text)]">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[var(--portal-text-muted)]">{body}</p>
    </div>
  );
}

export function PortalSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-[var(--portal-radius-input)] bg-[var(--portal-surface-alt)]" />
      ))}
    </div>
  );
}
