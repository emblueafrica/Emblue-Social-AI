"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalEmptyState, PortalSection, PortalSkeleton } from "@/components/portal/PortalPrimitives";
import { getClientInsights } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export default function ReplyTemplatesPage() {
  const { activeBrandId } = useAuth();
  const insightsQuery = useQuery({
    queryKey: ["client-insights", activeBrandId],
    queryFn: () => getClientInsights(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });
  const templates = insightsQuery.data?.templates ?? [];

  return (
    <PortalShell title="Reply templates" subtitle="Reference view of the response patterns managed for your campaigns.">
      <PortalSection title="Template library">
        {insightsQuery.isLoading ? (
          <PortalSkeleton rows={4} />
        ) : templates.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {templates.map((template) => (
              <article key={template.template_id} className="rounded-[var(--portal-radius-card)] border border-[var(--portal-border-soft)] bg-[var(--portal-surface-alt)] p-4">
                <FileText className="size-5 text-[var(--portal-blue)]" strokeWidth={1.7} />
                <h2 className="mt-3 text-sm font-bold text-[var(--portal-text)]">{template.name}</h2>
                <p className="mt-1 text-xs font-semibold capitalize text-[var(--portal-text-muted)]">
                  {template.platform ?? "All platforms"} · {template.is_active ? "Active" : "Paused"}
                </p>
                <p className="mt-3 line-clamp-4 text-xs leading-5 text-[var(--portal-text-muted)]">
                  {template.template_text ?? "Template copy is managed by the account team."}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <PortalEmptyState title="No templates available" body="Templates approved for your campaign will appear here." />
        )}
      </PortalSection>
    </PortalShell>
  );
}
