"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalEmptyState, PortalSection, PortalSkeleton } from "@/components/portal/PortalPrimitives";
import { getClientInsights } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const expectedPlatforms = ["facebook", "instagram", "tiktok", "x"];

export default function ConnectedAccountsPage() {
  const { activeBrandId } = useAuth();
  const insightsQuery = useQuery({
    queryKey: ["client-insights", activeBrandId],
    queryFn: () => getClientInsights(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });
  const connections = insightsQuery.data?.connections ?? [];

  return (
    <PortalShell title="Connected accounts" subtitle="The social accounts your account team uses for campaign monitoring and reporting.">
      <PortalSection title="Social connections">
        {insightsQuery.isLoading ? (
          <PortalSkeleton rows={4} />
        ) : connections.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {expectedPlatforms.map((platform) => {
              const connection = connections.find((item) => item.platform === platform);
              const connected = Boolean(connection?.is_active);
              return (
                <div key={platform} className="flex items-center justify-between gap-4 rounded-[var(--portal-radius-card)] border border-[var(--portal-border-soft)] bg-[var(--portal-surface-alt)] p-4">
                  <div>
                    <p className="text-sm font-bold capitalize text-[var(--portal-text)]">{platform}</p>
                    <p className="mt-1 text-xs text-[var(--portal-text-muted)]">{connection?.account_handle ?? "No account connected"}</p>
                  </div>
                  <div className={connected ? "text-[var(--portal-success)]" : "text-[var(--portal-text-faint)]"}>
                    {connected ? <CheckCircle2 className="size-5" /> : <CircleDashed className="size-5" />}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <PortalEmptyState title="No connected accounts returned" body="Once your account team connects social accounts, their status will appear here." />
        )}
      </PortalSection>
    </PortalShell>
  );
}
