"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Lock, PlugZap, Play, RefreshCw } from "lucide-react";
import { DashHeader, Sidebar } from "@/components/dashboard/Sidebar";
import {
  createFunnel,
  createFunnelTemplate,
  createKeywordGroup,
  createAttributionLink,
  getAttributionLinks,
  getFunnels,
  getKeywordGroups,
  getListeningFeed,
  getListeningRuns,
  getToolAccess,
  getToolSummary,
  runClustering,
  runCommentMining,
  runFunnel,
  runListeningSearch,
  runStrategy,
  runWarRoomSnapshot,
  scoreCreative,
  toggleFunnel,
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
  const queryClient = useQueryClient();
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
      if (activeBrandId) void queryClient.invalidateQueries({ queryKey: ["attribution-links", activeBrandId] });
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
        campaign: "workspace-link",
        content_type: "social",
      });
    },
    onSuccess: (data) => {
      setLastResult(data);
      void summaryQuery.refetch();
    },
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
        objective: "engagement",
      });
    },
    onSuccess: (data) => {
      setLastResult(data);
      void summaryQuery.refetch();
    },
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
                <>
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
                  <AttributionLinksPanel brandId={activeBrandId} enabled={enabled} />
                </>
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

              {toolId === "tool_1" && (
                <ListeningWorkspace
                  brandId={activeBrandId}
                  enabled={enabled}
                  onResult={(result) => {
                    setLastResult(result);
                    void summaryQuery.refetch();
                  }}
                />
              )}

              {toolId === "tool_4" && (
                <FunnelWorkspace
                  brandId={activeBrandId}
                  enabled={enabled}
                  onResult={(result) => {
                    setLastResult(result);
                    void summaryQuery.refetch();
                  }}
                />
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
      return getToolSummary(toolId, brandId);
    },
    enabled: Boolean(brandId) && enabled,
    retry: false,
  });
}

function ListeningWorkspace({
  brandId,
  enabled,
  onResult,
}: {
  brandId: number | null;
  enabled: boolean;
  onResult: (result: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const groupsQuery = useQuery({
    queryKey: ["keyword-groups", brandId],
    queryFn: () => getKeywordGroups(brandId!),
    enabled: Boolean(brandId) && enabled,
    retry: false,
  });
  const runsQuery = useQuery({
    queryKey: ["listening-runs", brandId],
    queryFn: () => getListeningRuns(brandId!),
    enabled: Boolean(brandId) && enabled,
    retry: false,
  });
  const feedQuery = useQuery({
    queryKey: ["listening-feed", brandId],
    queryFn: () => getListeningFeed(brandId!),
    enabled: Boolean(brandId) && enabled,
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: () => {
      if (!brandId) throw new Error("No active brand workspace.");
      return createKeywordGroup({
        brand_id: brandId,
        name: name.trim(),
        keywords: csv(keywords),
        platforms: [platform],
        mode: "realtime",
      });
    },
    onSuccess: (result) => {
      setName("");
      setKeywords("");
      onResult(result);
      void queryClient.invalidateQueries({ queryKey: ["keyword-groups", brandId] });
    },
  });
  const runMutation = useMutation({
    mutationFn: (groupId: number) => {
      if (!brandId) throw new Error("No active brand workspace.");
      return runListeningSearch({ brand_id: brandId, group_id: groupId });
    },
    onSuccess: (result) => {
      onResult(result);
      void queryClient.invalidateQueries({ queryKey: ["listening-runs", brandId] });
      void queryClient.invalidateQueries({ queryKey: ["listening-feed", brandId] });
    },
  });

  return (
    <section className="rounded-lg bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">Keyword listening</h2>
      <p className="mt-1 text-sm text-muted-foreground">Create keyword groups, start searches, and review the latest captured feed.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_180px_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Group name" className="rounded-md border bg-background px-3 py-2 text-sm" />
        <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="keywords, comma separated" className="rounded-md border bg-background px-3 py-2 text-sm" />
        <PlatformSelect value={platform} onChange={setPlatform} />
        <RunButton disabled={!enabled || createMutation.isPending || !name.trim() || !csv(keywords).length} onClick={() => createMutation.mutate()} label="Add group" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ListPanel title="Keyword groups" empty="No keyword groups yet.">
          {(groupsQuery.data?.keyword_groups ?? []).map((group) => (
            <div key={group.group_id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{group.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{group.keywords.join(", ")}</p>
                </div>
                <button disabled={runMutation.isPending} onClick={() => runMutation.mutate(group.group_id)} className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  Run
                </button>
              </div>
            </div>
          ))}
        </ListPanel>
        <ListPanel title="Recent runs" empty="No listening runs yet.">
          {(runsQuery.data?.runs ?? []).slice(0, 5).map((run) => (
            <div key={run.run_id} className="rounded-md border p-3">
              <p className="text-sm font-bold">Run #{run.run_id}</p>
              <p className="mt-1 text-xs text-muted-foreground">{run.status} · {run.platforms?.join(", ") || "platforms"} · {run.keywords?.join(", ") || "keywords"}</p>
            </div>
          ))}
        </ListPanel>
      </div>
      <ListPanel title="Listening feed" empty="No captured listening results yet.">
        {(feedQuery.data?.feed ?? []).slice(0, 6).map((item) => (
          <div key={item.result_id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold">{item.author_handle || item.platform}</p>
              <span className="text-xs font-semibold text-muted-foreground">{item.urgency_score ?? "N/A"}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.text || "No text captured"}</p>
          </div>
        ))}
      </ListPanel>
    </section>
  );
}

function FunnelWorkspace({
  brandId,
  enabled,
  onResult,
}: {
  brandId: number | null;
  enabled: boolean;
  onResult: (result: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [destUrl, setDestUrl] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [templateFunnelId, setTemplateFunnelId] = useState<number | null>(null);
  const [template, setTemplate] = useState("Hi {{handle}}, thanks for engaging. {{link}}");
  const funnelsQuery = useQuery({
    queryKey: ["funnels", brandId],
    queryFn: () => getFunnels(brandId!),
    enabled: Boolean(brandId) && enabled,
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: () => {
      if (!brandId) throw new Error("No active brand workspace.");
      return createFunnel({
        brand_id: brandId,
        name: name.trim(),
        platform,
        keywords: csv(keywords),
        trigger_actions: ["commented"],
        dest_url: destUrl.trim() || undefined,
        is_active: false,
      });
    },
    onSuccess: (result) => {
      setName("");
      setKeywords("");
      setDestUrl("");
      onResult(result);
      void queryClient.invalidateQueries({ queryKey: ["funnels", brandId] });
    },
  });
  const runMutation = useMutation({ mutationFn: runFunnel, onSuccess: onResult });
  const toggleMutation = useMutation({
    mutationFn: toggleFunnel,
    onSuccess: (result) => {
      onResult(result);
      void queryClient.invalidateQueries({ queryKey: ["funnels", brandId] });
    },
  });
  const templateMutation = useMutation({
    mutationFn: () => {
      if (!templateFunnelId) throw new Error("Choose a funnel first.");
      return createFunnelTemplate(templateFunnelId, { name: "Default DM", body: template, cta_link: destUrl.trim() || undefined });
    },
    onSuccess: onResult,
  });
  const funnels = funnelsQuery.data?.funnels ?? [];

  return (
    <section className="rounded-lg bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">Comment to DM funnels</h2>
      <p className="mt-1 text-sm text-muted-foreground">Create funnels, add templates, toggle runs, and inspect metrics from the backend.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_160px_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Funnel name" className="rounded-md border bg-background px-3 py-2 text-sm" />
        <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="trigger keywords" className="rounded-md border bg-background px-3 py-2 text-sm" />
        <input value={destUrl} onChange={(event) => setDestUrl(event.target.value)} placeholder="https://landing-page.com" className="rounded-md border bg-background px-3 py-2 text-sm" />
        <PlatformSelect value={platform} onChange={setPlatform} />
        <RunButton disabled={!enabled || createMutation.isPending || !name.trim()} onClick={() => createMutation.mutate()} label="Create" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto]">
        <select value={templateFunnelId ?? ""} onChange={(event) => setTemplateFunnelId(Number(event.target.value) || null)} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Choose funnel</option>
          {funnels.map((funnel) => <option key={funnel.funnel_id} value={funnel.funnel_id}>{funnel.name || `Funnel ${funnel.funnel_id}`}</option>)}
        </select>
        <input value={template} onChange={(event) => setTemplate(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
        <RunButton disabled={!enabled || templateMutation.isPending || !templateFunnelId || !template.trim()} onClick={() => templateMutation.mutate()} label="Save template" />
      </div>
      <ListPanel title="Funnels" empty="No funnels created yet.">
        {funnels.map((funnel) => (
          <div key={funnel.funnel_id} className="rounded-md border p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-bold">{funnel.name || `Funnel ${funnel.funnel_id}`}</p>
                <p className="mt-1 text-xs text-muted-foreground">{funnel.platform || "all platforms"} · {funnel.keywords.join(", ") || "all comments"} · {funnel.is_active ? "active" : "paused"}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleMutation.mutate(funnel.funnel_id)} className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                  {funnel.is_active ? "Pause" : "Activate"}
                </button>
                <button onClick={() => runMutation.mutate(funnel.funnel_id)} className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                  Run
                </button>
              </div>
            </div>
          </div>
        ))}
      </ListPanel>
    </section>
  );
}

function AttributionLinksPanel({ brandId, enabled }: { brandId: number | null; enabled: boolean }) {
  const linksQuery = useQuery({
    queryKey: ["attribution-links", brandId],
    queryFn: () => getAttributionLinks(brandId!),
    enabled: Boolean(brandId) && enabled,
    retry: false,
  });
  const links = linksQuery.data?.links ?? [];

  return (
    <ListPanel title="Tracked links" empty="No tracked links yet.">
      {links.map((link) => (
        <div key={link.link_id} className="rounded-md border p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{link.tracked_url}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{link.dest_url}</p>
            </div>
            <p className="text-xs font-semibold text-muted-foreground">{link.clicks} clicks · {link.conversions} conversions</p>
          </div>
        </div>
      ))}
    </ListPanel>
  );
}

function ListPanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const childArray = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="mt-5 rounded-lg border bg-background p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3 space-y-3">
        {childArray.length ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

function csv(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
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
  if (!data || typeof data !== "object") return toolId === "tool_1" || toolId === "tool_4" ? "No data" : "No linked summary";
  if ("keyword_groups" in data && typeof (data as { keyword_groups?: unknown }).keyword_groups === "number") {
    return `${(data as { keyword_groups: number }).keyword_groups} groups`;
  }
  if ("clusters" in data && typeof (data as { clusters?: unknown }).clusters === "number") {
    return `${(data as { clusters: number }).clusters} clusters`;
  }
  if ("pending_queue" in data && typeof (data as { pending_queue?: unknown }).pending_queue === "number") {
    return `${(data as { pending_queue: number }).pending_queue} pending`;
  }
  if ("funnels" in data && typeof (data as { funnels?: unknown }).funnels === "number") {
    return `${(data as { funnels: number }).funnels} funnels`;
  }
  if ("total_links" in data && typeof (data as { total_links?: unknown }).total_links === "number") {
    return `${(data as { total_links: number }).total_links} links`;
  }
  if ("total_scores" in data && typeof (data as { total_scores?: unknown }).total_scores === "number") {
    return `${(data as { total_scores: number }).total_scores} scores`;
  }
  if ("messages_processed" in data && typeof (data as { messages_processed?: unknown }).messages_processed === "number") {
    return `${(data as { messages_processed: number }).messages_processed} messages`;
  }
  if ("health" in data && typeof (data as { health?: unknown }).health === "string") {
    return String((data as { health: string }).health);
  }
  if ("campaigns" in data && typeof (data as { campaigns?: unknown }).campaigns === "number") {
    return `${(data as { campaigns: number }).campaigns} campaigns`;
  }
  return "No linked summary";
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
