"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Pause, Play, Plus, Trash2, X as XClose } from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { NewCampaignModal, type CampaignDraft } from "@/components/dashboard/NewCampaignModal";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import {
  ApiError,
  deleteCampaign,
  getCampaigns,
  getPostUrlCampaignStatus,
  preflightXCampaign,
  publishXCampaignPost,
  runPostUrlCampaign,
  saveCampaign,
  syncXReplies,
  toggleCampaign,
  type CampaignPayload,
  type CampaignRecord,
} from "@/lib/api";

type Platform = "instagram" | "facebook" | "tiktok" | "x";

type PostRow = {
  id: number;
  platform: Platform;
  url: string;
};

type Campaign = {
  id: number;
  title: string;
  meta: string;
  platforms: Platform[];
  stat: string;
  state: "running" | "paused";
  draft: CampaignDraft;
};

let nextId = 1;

const seedDraft = (over: Partial<CampaignDraft>): CampaignDraft => ({
  name: "",
  platforms: [],
  keywords: [],
  tone: "",
  maxPerHour: 50,
  template: "Hey {{handle}}! Thanks for engaging with our post. Here's something special for you: {{link}}",
  ctaLink: "",
  imageUrl: "",
  threshold: 85,
  allocation: { instagram: 40, facebook: 25, tiktok: 20, x: 15 },
  ...over,
});

function mapCampaignRecord(record: CampaignRecord): Campaign {
  const allocation = record.platform_allocation ?? { instagram: 40, facebook: 25, tiktok: 20, x: 15 };
  const platforms = Array.from(
    new Set(
      [
        record.platform,
        ...Object.entries(allocation)
          .filter(([, value]) => Number(value) > 0)
          .map(([platform]) => platform as Platform),
      ].filter(Boolean),
    ),
  ) as Platform[];

  const draft = seedDraft({
    name: record.name,
    platforms: platforms.length ? platforms : record.platform ? [record.platform] : ["instagram"],
    keywords: record.keywords ?? [],
    tone: record.tone ?? "",
    maxPerHour: record.max_per_hour ?? 50,
    template: record.reply_template ?? "",
    ctaLink: record.cta_link ?? "",
    imageUrl: record.image_url ?? "",
    threshold: record.auto_fire_threshold ?? 85,
    allocation: {
      instagram: allocation.instagram ?? 0,
      facebook: allocation.facebook ?? 0,
      tiktok: allocation.tiktok ?? 0,
      x: allocation.x ?? 0,
    },
  });

  return {
    id: record.campaign_id,
    title: record.name,
    meta: buildCampaignMeta(draft),
    platforms: draft.platforms,
    stat: record.is_active === false ? "Paused" : `${record.total_sent ?? 0} sent total`,
    state: record.is_active === false ? "paused" : "running",
    draft,
  };
}

function buildCampaignMeta(campaign: CampaignDraft) {
  const parts: string[] = [];
  if (campaign.keywords.length) parts.push(`Keywords: ${campaign.keywords.join(", ")}`);
  else parts.push("All commenters");
  if (campaign.imageUrl) parts.push("DM with branded image");
  if (campaign.ctaLink) parts.push(campaign.ctaLink.replace(/^https?:\/\//, ""));
  parts.push(`${campaign.maxPerHour}/hr limit`);
  return parts.join(" | ");
}

function apiErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed.";
}

export default function EngageTheEngager() {
  const queryClient = useQueryClient();
  const { activeBrandId } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([{ id: nextId++, platform: "instagram", url: "" }]);
  const [allocation, setAllocation] = useState({ instagram: 40, facebook: 25, tiktok: 20, x: 15 });
  const [postTemplate, setPostTemplate] = useState("");
  const [postCtaLink, setPostCtaLink] = useState("");
  const [xTweetUrl, setXTweetUrl] = useState("");
  const [xPostText, setXPostText] = useState("");
  const [xPreflightResult, setXPreflightResult] = useState<string | null>(null);
  const [xSyncResult, setXSyncResult] = useState<string | null>(null);
  const [lastPostUrlCampaignId, setLastPostUrlCampaignId] = useState<string | null>(null);
  const [xPublishResult, setXPublishResult] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", activeBrandId],
    queryFn: () => getCampaigns(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  const postUrlStatusQuery = useQuery({
    queryKey: ["post-url-campaign-status", activeBrandId, lastPostUrlCampaignId],
    queryFn: () => getPostUrlCampaignStatus(activeBrandId!, lastPostUrlCampaignId!),
    enabled: Boolean(activeBrandId && lastPostUrlCampaignId),
    retry: false,
    refetchInterval: (query) => query.state.data?.summary.complete ? false : 5000,
  });

  const saveCampaignMutation = useMutation({
    mutationFn: saveCampaign,
    onSuccess: async () => {
      if (activeBrandId) await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
    },
  });

  const toggleCampaignMutation = useMutation({
    mutationFn: toggleCampaign,
    onSuccess: async () => {
      if (activeBrandId) await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId: number) => deleteCampaign(activeBrandId!, campaignId),
    onSuccess: async () => {
      if (activeBrandId) await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
    },
  });

  const runPostUrlMutation = useMutation({ mutationFn: runPostUrlCampaign });
  const xPreflightMutation = useMutation({ mutationFn: preflightXCampaign });
  const xPublishMutation = useMutation({ mutationFn: publishXCampaignPost });
  const xSyncMutation = useMutation({ mutationFn: syncXReplies });

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const campaigns = campaignsQuery.data?.campaigns.map(mapCampaignRecord) ?? [];
  const editingCampaign = campaigns.find((campaign) => campaign.id === editingId) ?? null;
  const runningCount = campaigns.filter((campaign) => campaign.state === "running").length;
  const pausedCount = campaigns.filter((campaign) => campaign.state === "paused").length;
  const sentTotal = campaigns.reduce((sum, campaign) => {
    const match = campaign.stat.match(/^(\d+)/);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  const allocationTotal = allocation.instagram + allocation.facebook + allocation.tiktok + allocation.x;

  const toPayload = (campaign: CampaignDraft): CampaignPayload => ({
    ...(editingId && editingId > 0 ? { campaign_id: editingId } : {}),
    brand_id: activeBrandId!,
    name: campaign.name,
    platform: campaign.platforms[0] ?? "instagram",
    keywords: campaign.keywords,
    tone: campaign.tone,
    reply_template: campaign.template,
    cta_link: campaign.ctaLink,
    image_url: campaign.imageUrl,
    auto_fire_threshold: campaign.threshold,
    max_per_hour: campaign.maxPerHour,
    is_active: true,
    platform_allocation: campaign.allocation,
  });

  const handleSaveCampaign = async (campaign: CampaignDraft) => {
    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before creating campaigns.");
      return;
    }

    try {
      await saveCampaignMutation.mutateAsync(toPayload(campaign));
      setEditingId(null);
      setModalOpen(false);
      setApiNotice(null);
      setToast(editingId !== null ? "Campaign updated successfully." : "A new campaign has been set successfully.");
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleToggleCampaign = async (campaignId: number, currentState: "running" | "paused") => {
    if (!activeBrandId || campaignId <= 0) {
      setApiNotice("Campaign state changes require a saved backend campaign.");
      return;
    }

    try {
      await toggleCampaignMutation.mutateAsync(campaignId);
      setApiNotice(null);
      setToast(currentState === "paused" ? "Campaign resumed." : "Campaign paused.");
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleDeleteConfirmed = async () => {
    if (confirmDeleteId === null) return;
    if (!activeBrandId) {
      setApiNotice("Campaign deletion requires an active brand workspace.");
      return;
    }
    try {
      await deleteCampaignMutation.mutateAsync(confirmDeleteId);
      setConfirmDeleteId(null);
      setEditingId(null);
      setApiNotice(null);
      setToast("Campaign deleted.");
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleRunPostUrls = async () => {
    const validPosts = posts.filter((post) => post.url.trim()).map((post) => ({ platform: post.platform, url: post.url.trim() }));

    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before running post URL campaigns.");
      return;
    }
    if (!validPosts.length) {
      setApiNotice("Add at least one post URL before fetching engagers.");
      return;
    }
    if (allocationTotal !== 100) {
      setApiNotice("Platform allocation must equal 100% before running.");
      return;
    }
    if (!postTemplate.trim()) {
      setApiNotice("Add a reply template before running so the campaign can post automatically.");
      return;
    }
    if (/\{\{\s*link\s*\}\}/.test(postTemplate) && !postCtaLink.trim()) {
      setApiNotice("Add a CTA link or remove {{link}} from the reply template.");
      return;
    }

    try {
      const result = await runPostUrlMutation.mutateAsync({
        brand_id: activeBrandId,
        post_urls: validPosts,
        platform_allocation: allocation,
        reply_template: postTemplate.trim(),
        cta_link: postCtaLink.trim() || undefined,
      });
      setLastPostUrlCampaignId(result.campaign_id);
      setApiNotice(null);
      setToast(`${result.message}. Tracking run ${result.campaign_id}.`);
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleXPreflight = async () => {
    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before testing X.");
      return;
    }
    try {
      const result = await xPreflightMutation.mutateAsync({
        brand_id: activeBrandId,
        tweet_url: xTweetUrl.trim() || undefined,
      });
      const scopeSummary = Object.entries(result.scopes)
        .map(([key, ok]) => `${key.replace(/_/g, ".")}: ${ok ? "yes" : "no"}`)
        .join(" | ");
      const searchSummary = result.recent_search.checked
        ? result.recent_search.ok
          ? `Recent search OK (${result.recent_search.engager_count ?? 0} replies found).`
          : `Recent search failed: ${result.recent_search.error ?? "unknown error"}`
        : "Recent search not checked.";
      setXPreflightResult(`${result.connected ? `Connected as ${result.account_handle || "X account"}.` : "X is not connected."} ${scopeSummary}. ${searchSummary}${result.diagnostics.length ? ` Issues: ${result.diagnostics.join(" ")}` : ""}`);
      setApiNotice(null);
    } catch (error) {
      setXPreflightResult(null);
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleXPublish = async () => {
    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before publishing to X.");
      return;
    }
    const text = xPostText.trim();
    if (!text) {
      setApiNotice("Write the X post text before publishing.");
      return;
    }
    if (text.length > 280) {
      setApiNotice("X post text must be 280 characters or fewer.");
      return;
    }
    try {
      const result = await xPublishMutation.mutateAsync({
        brand_id: activeBrandId,
        text,
        reply_to_url: xTweetUrl.trim() || undefined,
      });
      if (!result.message_id) {
        setXPublishResult(null);
        setApiNotice("X accepted the request response but did not return a post ID. Treat this as not posted and check backend logs.");
        return;
      }
      const publishUrl = result.message_id ? `https://x.com/i/web/status/${result.message_id}` : null;
      setXPublishResult(`Published: ${publishUrl}`);
      if (publishUrl) setXTweetUrl(publishUrl);
      setXSyncResult(null);
      setApiNotice(null);
      setToast(result.reply_to_tweet_id ? "X reply published." : "X post published.");
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleXReplySync = async () => {
    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before syncing X replies.");
      return;
    }
    if (!xTweetUrl.trim()) {
      setApiNotice("Paste the published X post URL before syncing replies.");
      return;
    }

    try {
      const result = await xSyncMutation.mutateAsync({
        brand_id: activeBrandId,
        tweet_url: xTweetUrl.trim(),
      });
      setXSyncResult(`${result.message} Fetched: ${result.fetched}. New: ${result.captured}. Duplicates: ${result.duplicates}.`);
      setApiNotice(null);
      setToast(result.queued ? `${result.queued} replies are waiting in AI Reply Engine.` : "X replies synced.");
      await queryClient.invalidateQueries({ queryKey: ["ai-reply-queue", activeBrandId] });
      await queryClient.invalidateQueries({ queryKey: ["post-url-campaign-status", activeBrandId] });
      await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
    } catch (error) {
      setXSyncResult(null);
      setApiNotice(apiErrorMessage(error));
    }
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Engage the Engager" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader
          title="Engage the Engager"
          action={
            <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90">
              <Plus className="size-4" /> New Campaign
            </button>
          }
        />

        {toast && (
          <div className="fixed top-6 right-6 z-50 bg-emerald-500 text-white rounded-2xl shadow-lg px-5 py-4 flex items-start gap-3 max-w-sm">
            <CheckCircle2 className="size-6 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">Campaign update</p>
              <p className="text-sm opacity-95">{toast}</p>
            </div>
            <button onClick={() => setToast(null)} className="opacity-80 hover:opacity-100">
              <XClose className="size-4" />
            </button>
          </div>
        )}

        <main className="flex-1 p-6 md:p-8 space-y-6 max-w-[1200px] w-full mx-auto text-safe layout-safe">
          {apiNotice && <Notice>{apiNotice}</Notice>}
          {campaignsQuery.isLoading && <Surface>Loading campaigns...</Surface>}
          {campaignsQuery.error && <Notice>{apiErrorMessage(campaignsQuery.error)}</Notice>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoCard title="User comments" body="The system watches approved campaign surfaces and picks up inbound engagement automatically." />
            <InfoCard title="AI personalizes" body="Replies and follow-up messages use the saved campaign tone, CTA link, and keyword rules." />
            <InfoCard title="Fires instantly" body="Saved campaigns can route to backend workflows without requiring manual monitoring." />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi color="bg-primary" label="Active Campaigns" value={String(runningCount)} sub="Running now" />
            <Kpi color="bg-brand-pink" label="Replies Sent" value={String(sentTotal)} sub="Total across saved campaigns" />
            <Kpi color="bg-brand-olive" label="Paused Campaigns" value={String(pausedCount)} sub="Currently not running" />
            <Kpi color="bg-destructive" label="Total Campaigns" value={String(campaigns.length)} sub="Saved in this workspace" />
          </div>

          <Surface>
            <div className="flex items-center justify-between pb-4 border-b">
              <div>
                <h2 className="font-bold">Saved campaigns</h2>
                <p className="text-xs text-muted-foreground mt-1">{campaigns.length ? `${runningCount} running | ${pausedCount} paused` : "No campaigns saved yet"}</p>
              </div>
            </div>

            {campaigns.length ? (
              <ul className="divide-y">
                {campaigns.map((campaign) => (
                  <li key={campaign.id} className="py-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{campaign.title}</h3>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${campaign.state === "running" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                          {campaign.state}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 text-safe">{campaign.meta}</p>
                      <div className="flex items-center gap-2 mt-3">
                        {campaign.platforms.map((platform) => (
                          <PlatformLogo key={`${campaign.id}-${platform}`} platform={platform} size={18} />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{campaign.stat}</span>
                      <button onClick={() => { setEditingId(campaign.id); setModalOpen(true); }} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Edit</button>
                      <button onClick={() => void handleToggleCampaign(campaign.id, campaign.state)} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted flex items-center gap-2">
                        {campaign.state === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
                        {campaign.state === "paused" ? "Resume" : "Pause"}
                      </button>
                      <button onClick={() => setConfirmDeleteId(campaign.id)} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted text-destructive flex items-center gap-2">
                        <Trash2 className="size-4" /> Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-12 text-sm text-muted-foreground">No backend campaigns found for this brand yet.</div>
            )}
          </Surface>

          <Surface>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <PlatformLogo platform="x" size={20} />
                  <h2 className="font-bold">X campaign test</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check the connected X account, test recent-search access with a post URL, then publish a standalone X post or reply.
                </p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                {xPostText.length}/280
              </span>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <input
                  value={xTweetUrl}
                  onChange={(event) => setXTweetUrl(event.target.value)}
                  placeholder="Optional: https://x.com/brand/status/123..."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={() => void handleXPreflight()}
                  disabled={xPreflightMutation.isPending}
                  className="rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-60"
                >
                  {xPreflightMutation.isPending ? "Checking..." : "Check X readiness"}
                </button>
                <button
                  onClick={() => void handleXReplySync()}
                  disabled={xSyncMutation.isPending || !xTweetUrl.trim()}
                  className="ml-2 rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-60"
                >
                  {xSyncMutation.isPending ? "Syncing..." : "Sync X replies"}
                </button>
                {xPreflightResult && (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground text-safe">{xPreflightResult}</p>
                )}
                {xSyncResult && (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground text-safe">{xSyncResult}</p>
                )}
              </div>

              <div className="space-y-3">
                <textarea
                  value={xPostText}
                  onChange={(event) => setXPostText(event.target.value)}
                  maxLength={280}
                  placeholder="Write the X campaign post or reply..."
                  className="min-h-[110px] w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={() => void handleXPublish()}
                  disabled={xPublishMutation.isPending || !xPostText.trim()}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {xPublishMutation.isPending ? "Publishing..." : xTweetUrl.trim() ? "Publish X reply" : "Publish X post"}
                </button>
                {xPublishResult && (
                  <a
                    href={xPublishResult.replace(/^Published:\s*/, "")}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg bg-muted/50 p-3 text-sm font-medium text-primary hover:underline text-safe"
                  >
                    {xPublishResult}
                  </a>
                )}
              </div>
            </div>
          </Surface>

          <Surface>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bold">Message everyone on existing posts</h2>
                <p className="text-sm text-muted-foreground mt-1">Use live post URLs and current backend allocation rules.</p>
              </div>
              <button onClick={() => setPosts((current) => [...current, { id: nextId++, platform: "instagram", url: "" }])} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                Add post
              </button>
            </div>

            <div className="space-y-4">
              {posts.map((post) => (
                <div key={post.id} className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                  <select
                    value={post.platform}
                    onChange={(event) => setPosts((current) => current.map((row) => (row.id === post.id ? { ...row, platform: event.target.value as Platform } : row)))}
                    className="rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                    <option value="tiktok">TikTok</option>
                    <option value="x">X</option>
                  </select>
                  <input
                    value={post.url}
                    onChange={(event) => setPosts((current) => current.map((row) => (row.id === post.id ? { ...row, url: event.target.value } : row)))}
                    placeholder="https://..."
                    className="rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                  <button onClick={() => setPosts((current) => current.length > 1 ? current.filter((row) => row.id !== post.id) : current)} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-4 mt-6">
              <NumberField label="Instagram %" value={allocation.instagram} onChange={(value) => setAllocation((current) => ({ ...current, instagram: value }))} />
              <NumberField label="Facebook %" value={allocation.facebook} onChange={(value) => setAllocation((current) => ({ ...current, facebook: value }))} />
              <NumberField label="TikTok %" value={allocation.tiktok} onChange={(value) => setAllocation((current) => ({ ...current, tiktok: value }))} />
              <NumberField label="X %" value={allocation.x} onChange={(value) => setAllocation((current) => ({ ...current, x: value }))} />
            </div>

            <div className="mt-2 text-sm text-muted-foreground">Allocation total: {allocationTotal}%</div>

            <input
              value={postCtaLink}
              onChange={(event) => setPostCtaLink(event.target.value)}
              placeholder="CTA link used for {{link}}"
              className="mt-6 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />

            <textarea
              value={postTemplate}
              onChange={(event) => setPostTemplate(event.target.value)}
              placeholder="Reply template used when the backend runs this post URL campaign"
              className="mt-6 min-h-[120px] w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />

            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => void handleRunPostUrls()} disabled={runPostUrlMutation.isPending} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {runPostUrlMutation.isPending ? "Running..." : "Run post URL campaign"}
              </button>
              <span className="text-sm text-muted-foreground">The backend will reject runs until allocation equals 100%.</span>
            </div>

            {lastPostUrlCampaignId && (
              <div className="mt-6 rounded-xl border bg-muted/30 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-bold">Run status: {lastPostUrlCampaignId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {postUrlStatusQuery.isFetching ? "Refreshing status..." : postUrlStatusQuery.data?.summary.complete ? "Complete" : "Processing"}
                    </p>
                  </div>
                  <button onClick={() => void postUrlStatusQuery.refetch()} className="rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
                    Refresh status
                  </button>
                </div>

                {postUrlStatusQuery.data && (
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                      <MiniStat label="Fetched" value={postUrlStatusQuery.data.summary.fetched} />
                      <MiniStat label="Engagers" value={postUrlStatusQuery.data.summary.engagers} />
                      <MiniStat label="Sent" value={postUrlStatusQuery.data.summary.sent} />
                      <MiniStat label="Queued" value={postUrlStatusQuery.data.summary.queued} />
                      <MiniStat label="Manual" value={postUrlStatusQuery.data.summary.manual} />
                      <MiniStat label="Errors" value={postUrlStatusQuery.data.summary.errors} />
                    </div>
                    <div className="space-y-2">
                      {postUrlStatusQuery.data.post_urls.map((item) => (
                        <div key={`${item.platform}-${item.url}`} className="rounded-lg border bg-background p-3 text-sm">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <span className="min-w-0 truncate font-semibold">{item.platform.toUpperCase()} · {item.url}</span>
                            <span className="text-muted-foreground">{item.status} · {item.total_fetched} fetched</span>
                          </div>
                          {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
                        </div>
                      ))}
                    </div>
                    {postUrlStatusQuery.data.engagers.length > 0 && (
                      <div className="space-y-2">
                        {postUrlStatusQuery.data.engagers.slice(0, 5).map((item) => (
                          <div key={`${item.platform}-${item.author_handle}-${item.created_at}`} className="flex items-center justify-between rounded-lg border bg-background p-3 text-sm">
                            <span>{item.author_handle || "unknown"} · {item.action}</span>
                            <span className="text-muted-foreground">{item.status || "pending"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {postUrlStatusQuery.error && (
                  <p className="mt-3 text-sm text-destructive">{apiErrorMessage(postUrlStatusQuery.error)}</p>
                )}
              </div>
            )}
          </Surface>
        </main>

        <NewCampaignModal
          open={modalOpen}
          initial={editingCampaign?.draft ?? undefined}
          onClose={() => {
            setModalOpen(false);
            setEditingId(null);
          }}
          onSave={(campaign) => void handleSaveCampaign(campaign)}
        />

        {confirmDeleteId !== null && (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
              <h3 className="font-bold">Delete campaign</h3>
              <p className="mt-2 text-sm text-muted-foreground">This will permanently remove the campaign from the backend.</p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">Cancel</button>
                <button onClick={() => void handleDeleteConfirmed()} className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60" disabled={deleteCampaignMutation.isPending}>
                  {deleteCampaignMutation.isPending ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Surface({ children }: { children: React.ReactNode }) {
  return <section className="bg-card rounded-2xl shadow-sm p-6">{children}</section>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">{children}</section>;
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Kpi({ color, label, value, sub }: { color: string; label: string; value: string; sub: string }) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className="text-xs mt-2 text-muted-foreground">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}
