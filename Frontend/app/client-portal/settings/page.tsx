"use client";

import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalCard, PortalSection } from "@/components/portal/PortalPrimitives";
import { getToolAccess } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export default function PortalSettingsPage() {
  const { activeBrandId, authContext } = useAuth();
  const accessQuery = useQuery({
    queryKey: ["tool-access", activeBrandId],
    queryFn: getToolAccess,
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  return (
    <PortalShell title="Settings" subtitle="Read-only account details for your managed-service workspace.">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <PortalSection title="Workspace details">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Info label="Brand" value={authContext?.active_brand?.name ?? "Workspace"} />
            <Info label="Account type" value={authContext?.active_brand?.account_type?.replace(/_/g, " ") ?? "Managed client"} />
            <Info label="Role" value={authContext?.active_brand?.role?.replace(/_/g, " ") ?? "Client viewer"} />
            <Info label="Brand ID" value={String(authContext?.active_brand?.brand_id ?? activeBrandId ?? "N/A")} />
          </dl>
        </PortalSection>

        <PortalCard className="p-5">
          <h2 className="text-base font-bold text-[var(--portal-text)]">Access model</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--portal-text-muted)]">
            B2C clients use this portal to review campaign progress. Tool access is handled by the emblue managed-service team.
          </p>
          <div className="mt-5 rounded-[var(--portal-radius-input)] bg-[var(--portal-blue-soft)] p-4">
            <p className="text-xs font-semibold text-[var(--portal-text-muted)]">Current plan</p>
            <p className="mt-1 text-lg font-extrabold tracking-[-0.03em] text-[var(--portal-blue)]">
              {accessQuery.data?.account_type === "b2c_managed" ? "Managed service" : accessQuery.data?.plan ?? "Client portal"}
            </p>
          </div>
        </PortalCard>
      </div>
    </PortalShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--portal-radius-input)] border border-[var(--portal-border-soft)] bg-[var(--portal-surface-alt)] p-4">
      <dt className="text-xs font-semibold text-[var(--portal-text-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-bold capitalize text-[var(--portal-text)]">{value}</dd>
    </div>
  );
}
