"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Lock, PlugZap, Play, RefreshCw } from "lucide-react";
import { DashHeader, Sidebar } from "@/components/dashboard/Sidebar";
import {
  createAttributionLink,
  getFunnels,
  getKeywordGroups,
  getToolAccess,
  runClustering,
  runCommentMining,
  runStrategy,
  runWarRoomSnapshot,
  scoreCreative,
  type Platform,
  type ToolActionResult,
} from "@/lib/api";
import { hasTool, isB2CClient } from "@/lib/access";
import { useAuth } from "@/hooks/use-auth";

type ToolWorkspaceProps = {
  activeLabel: string;
  title: string;
  toolId: string;
  description: string;
  endpoint: string;
};

type ToolAction = {
  label: string;
  description: string;
  run: (brandId: number) => Promise<ToolActionResult>;
};

export function ToolWorkspacePage({
  activeLabel,
  title,
  toolId,
  description,
  endpoint,
}: ToolWorkspaceProps) {
  const router = useRouter();
  const { authContext, activeBrandId } = useAuth();
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [lastResult, setLastResult] = useState<unknown>(null);
  const accessQuery = useQuery({
    queryKey: ["tool-access"],
    queryFn: getToolAccess,
    retry: false,
  });
  const enabled = hasTool(accessQuery.data?.enabled, toolId);
  const summaryQuery = useToolSummary(toolId, activeBrandId, enabled);
  const actions = useMemo(() => getToolActions(toolId), [toolId]);

  const actionMutation = useMutation({
    mutationFn: (action: ToolAction) => {
      if (!activeBrandId) throw new Error("No active brand workspace.");
      return action.run(activeBrandId);
    },
    onSuccess: (data) => {
      setLastResult(data);
      void summaryQuery.refetch();
    },
  });

  const attributionMutation = useMutation({
    mutationFn: () => {
      if (!activeBrandId) throw new Error("No active brand workspace.");
      if (!url.trim()) throw new Error("Destination URL is required.");
      return createAttributionLink({
        brand_id: activeBrandId,
        dest_url: url.trim(),
        platform: platform as Platform,
        campaign: "Workspace test link",
        content_type: "social",
      });
    },
    onSuccess: setLastResult,
  });

  const creativeMutation = useMutation({
    mutationFn: () => {
      if (!activeBrandId) throw new Error("No active brand workspace.");
      if (!caption.trim()) throw new Error("Caption is required.");
      return scoreCreative({
        brand_id: activeBrandId,
        platform: platform as Platform,
        caption: caption.trim(),
        format: "post",
        objective: "brand awareness",
      });
    },
    onSuccess: setLastResult,
  });

  useEffect(() => {
    if (isB2CClient(authContext)) router.replace("/client-portal");
  }, [authContext, router]);

  if (isB2CClient(authContext)) return null;

  const activeMutation = actionMutation.isPending || attributionMutation.isPending || creativeMutation.isPending;
  const error = actionMutation.error ?? attributionMutation.error ?? creativeMutation.error;

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel={activeLabel} />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title={title} />
        <main className="flex-1 p-6 md:p-10 space-y-6">
          {!enabled && !accessQuery.isLoading && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950">
              <div className="flex items-center gap-2">
                <Lock className="size-5" />
                <h2 className="font-bold">Tool locked</h2>
              </div>
              <p className="mt-2 text-sm">This tool is not included in the current subscription plan.</p>
            </section>
          )}

          <section className="rounded-lg bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-md bg-muted p-3 text-primary">
                  <PlugZap className="size-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{toolId}</p>
                  <h2 className="mt-1 text-2xl font-bold">{title}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                {endpoint}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <section className="rounded-lg bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold">Workspace status</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Live access and data summary for this tool.</p>
                  </div>
                  <button
                    onClick={() => void summaryQuery.refetch()}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted"
                  >
                    <RefreshCw className="size-4" />
                    Refresh
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <StatusCard label="Access" value={enabled ? "Enabled" : "Locked"} positive={enabled} />
                  <StatusCard label="Plan" value={String(accessQuery.data?.plan ?? "Not assigned")} />
                  <StatusCard label="Data" value={summaryQuery.isLoading ? "Loading" : summarizeToolData(toolId, summaryQuery.data)} />
                </div>
              </section>

              {actions.length > 0 && (
                <section className="rounded-lg bg-card p-5 shadow-sm">
                  <h2 className="text-lg font-bold">Quick actions</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Run safe backend workflows for this workspace.</p>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {actions.map((action) => (
                      <button
                        key={action.label}
                        disabled={!enabled || !activeBrandId || activeMutation}
                        onClick={() => actionMutation.mutate(action)}
                        className="group rounded-lg border p-4 text-left transition hover:border-primary hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <h3 className="text-sm font-bold">{action.label}</h3>
                          <Play className="size-4 text-primary" />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{action.description}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {toolId === "tool_6" && (
                <ToolForm title="Create tracked link" description="Create a trackable attribution link for a campaign URL.">
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/landing-page"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <PlatformSelect value={platform} onChange={setPlatform} />
                  <RunButton disabled={!enabled || activeMutation} onClick={() => attributionMutation.mutate()} label="Create link" />
                </ToolForm>
              )}

              {toolId === "tool_7" && (
                <ToolForm title="Score creative caption" description="Send a draft caption to the creative predictor.">
                  <textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    placeholder="Paste the caption to score..."
                    className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <PlatformSelect value={platform} onChange={setPlatform} />
                  <RunButton disabled={!enabled || activeMutation} onClick={() => creativeMutation.mutate()} label="Score caption" />
                </ToolForm>
              )}
            </div>

            <aside className="space-y-6">
              {error && (
                <section className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                  {error instanceof Error ? error.message : "Action failed."}
                </section>
              )}

              <section className="rounded-lg bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-success" />
                  <h2 className="text-lg font-bold">Last result</h2>
                </div>
                {lastResult ? (
                  <pre className="mt-4 max-h-[420px] overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(lastResult, null, 2)}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Run an action to see the backend response here.</p>
                )}
              </section>

              <section className="rounded-lg bg-card p-5 shadow-sm">
                <h2 className="text-lg font-bold">Next workflow</h2>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {getWorkflowSteps(toolId).map((step) => (
                    <li key={step} className="flex gap-2">
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}

function useToolSummary(toolId: string, brandId: number | null, enabled: boolean) {
  return useQuery<unknown>({
    queryKey: ["tool-summary", toolId, brandId],
    queryFn: () => {
      if (!brandId) throw new Error("No active brand workspace.");
      if (toolId === "tool_1") return getKeywordGroups(brandId);
      if (toolId === "tool_4") return getFunnels(brandId);
      return Promise.resolve({ ok: true });
    },
    enabled: Boolean(brandId) && enabled && (toolId === "tool_1" || toolId === "tool_4"),
    retry: false,
  });
}

function getToolActions(toolId: string): ToolAction[] {
  if (toolId === "tool_2") {
    return [
      {
        label: "Run clustering",
        description: "Cluster recent messages into opportunity groups.",
        run: (brandId) => runClustering(brandId, 7),
      },
      {
        label: "Generate strategy",
        description: "Create content recommendations from top clusters.",
        run: runStrategy,
      },
    ];
  }
  if (toolId === "tool_8") {
    return [{ label: "Run comment mining", description: "Extract FAQs and pain points from recent comments.", run: runCommentMining }];
  }
  if (toolId === "tool_9") {
    return [{ label: "Create war room snapshot", description: "Generate a campaign health snapshot from current signals.", run: runWarRoomSnapshot }];
  }
  return [];
}

function summarizeToolData(toolId: string, data: unknown) {
  if (!data || typeof data !== "object") return toolId === "tool_1" || toolId === "tool_4" ? "No data" : "Ready";
  if ("keyword_groups" in data && Array.isArray((data as { keyword_groups?: unknown[] }).keyword_groups)) {
    return `${(data as { keyword_groups: unknown[] }).keyword_groups.length} groups`;
  }
  if ("funnels" in data && Array.isArray((data as { funnels?: unknown[] }).funnels)) {
    return `${(data as { funnels: unknown[] }).funnels.length} funnels`;
  }
  return "Ready";
}

function getWorkflowSteps(toolId: string) {
  const map: Record<string, string[]> = {
    tool_1: ["Create keyword groups from the Listening API.", "Review captured mentions and search runs.", "Use clusters or replies once enough data exists."],
    tool_2: ["Run clustering after listening has captured messages.", "Generate strategy from top clusters.", "Move approved ideas into campaigns."],
    tool_4: ["Create funnels from the Funnel API.", "Add DM templates and trigger keywords.", "Run or toggle funnels when ready."],
    tool_6: ["Create a tracked link.", "Use it in campaigns or replies.", "Review clicks and conversions in reports."],
    tool_7: ["Paste a draft caption.", "Score it for the target platform.", "Apply recommendations before publishing."],
    tool_8: ["Run mining on recent comments.", "Review FAQs and pain points.", "Feed findings into templates and strategy."],
    tool_9: ["Generate a snapshot.", "Review health, alerts and metrics.", "Escalate risks to the operations team."],
  };
  return map[toolId] ?? ["Review data.", "Run available actions.", "Use results in the workflow."];
}

function StatusCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-2 text-lg font-bold ${positive ? "text-success" : ""}`}>{value}</p>
    </div>
  );
}

function ToolForm({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function PlatformSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
      <option value="instagram">Instagram</option>
      <option value="facebook">Facebook</option>
      <option value="tiktok">TikTok</option>
      <option value="x">X</option>
    </select>
  );
}

function RunButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Play className="size-4" />
      {label}
    </button>
  );
}
