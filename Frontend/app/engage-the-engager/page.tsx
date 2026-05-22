"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ChevronDown,
  Check,
  MoreVertical,
  Trash2,
  CheckCircle2,
  X as XClose,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { NewCampaignModal, type CampaignDraft } from "@/components/dashboard/NewCampaignModal";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import {
  ApiError,
  getCampaigns,
  runPostUrlCampaign,
  saveCampaign,
  toggleCampaign,
  type CampaignPayload,
  type CampaignRecord,
} from "@/lib/api";

type Platform = "instagram" | "facebook" | "tiktok" | "x";

const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: "instagram", label: "Instagram", icon: <PlatformLogo platform="instagram" size={16} /> },
  { id: "facebook", label: "Facebook", icon: <PlatformLogo platform="facebook" size={16} /> },
  { id: "tiktok", label: "TikTok", icon: <PlatformLogo platform="tiktok" size={16} /> },
  { id: "x", label: "X/Twitter", icon: <PlatformLogo platform="x" size={16} /> },
];

type PostRow = {
  id: number;
  platform: Platform;
  url: string;
  comments: boolean;
  likes: boolean;
};

let nextId = 1;

type Campaign = {
  id: number;
  title: string;
  meta: string;
  platforms: Platform[];
  stat: string;
  state: "running" | "paused";
  justActivated?: boolean;
  draft: CampaignDraft;
};

const seedDraft = (over: Partial<CampaignDraft>): CampaignDraft => ({
  name: "", platforms: [], keywords: [], tone: "", maxPerHour: 50,
  template: "Hey {{handle}}! Thanks for engaging with our post. Here's something special for you: {{link}}",
  ctaLink: "", imageUrl: "https://cdn.brand.com/lets-go-for-gold.jpg", threshold: 85,
  allocation: { instagram: 50, facebook: 30, tiktok: 20 }, ...over,
});

const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: -1,
    title: "MTN Super Eagles — November Drop",
    meta: "All commenters · DM with branded image · bit.ly/MTNxSUPEREAGLES · 50/hr limit",
    platforms: ["instagram", "facebook"],
    stat: "847 sent today · 85% auto-fire",
    state: "running",
    draft: seedDraft({ name: "MTN Super Eagles — November Drop", platforms: ["instagram", "facebook"], ctaLink: "https://bit.ly/MTNxSUPEREAGLES", maxPerHour: 50 }),
  },
  {
    id: -2,
    title: "Summer Drop — Engagement Blitz",
    meta: "Keywords: link, price, order · bit.ly/SummerDrop26 · 100/hr limit",
    platforms: ["instagram", "tiktok", "facebook"],
    stat: "312 sent today · 90% auto-fire",
    state: "running",
    draft: seedDraft({ name: "Summer Drop — Engagement Blitz", platforms: ["instagram", "tiktok", "facebook"], keywords: ["link", "price", "order"], ctaLink: "https://bit.ly/SummerDrop26", maxPerHour: 100, threshold: 90 }),
  },
  {
    id: -3,
    title: "Black Friday Early Access",
    meta: "All commenters · DM only · bit.ly/BFAccess · 75/hr limit",
    platforms: ["instagram", "facebook"],
    stat: "Paused",
    state: "paused",
    draft: seedDraft({ name: "Black Friday Early Access", platforms: ["instagram", "facebook"], ctaLink: "https://bit.ly/BFAccess", maxPerHour: 75 }),
  },
];

function mapCampaignRecord(record: CampaignRecord): Campaign {
  const allocation = record.platform_allocation ?? { instagram: 50, facebook: 30, tiktok: 20 };
  const platforms = uniquePlatforms([
    record.platform,
    ...(Object.entries(allocation)
      .filter(([, value]) => Number(value) > 0)
      .map(([platform]) => platform as Platform)),
  ]);
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

function uniquePlatforms(platforms: Array<Platform | undefined>) {
  return Array.from(new Set(platforms.filter(Boolean))) as Platform[];
}

function buildCampaignMeta(c: CampaignDraft) {
  const parts: string[] = [];
  if (c.keywords.length) parts.push(`Keywords: ${c.keywords.join(", ")}`);
  else parts.push("All commenters");
  if (c.imageUrl) parts.push("DM with branded image");
  if (c.ctaLink) parts.push(c.ctaLink.replace(/^https?:\/\//, ""));
  parts.push(`${c.maxPerHour}/hr limit`);
  return parts.join(" ? ");
}

function apiErrorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

export default function EngageTheEngager() {
  const queryClient = useQueryClient();
  const { activeBrandId } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([
    { id: nextId++, platform: "instagram", url: "", comments: false, likes: true },
  ]);
  const [allocation, setAllocation] = useState({ instagram: 50, facebook: 30, tiktok: 20 });
  const [postTemplate, setPostTemplate] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [fallbackCampaigns, setFallbackCampaigns] = useState<Campaign[]>(INITIAL_CAMPAIGNS);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [campaignMenuId, setCampaignMenuId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", activeBrandId],
    queryFn: () => getCampaigns(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  const apiCampaigns = campaignsQuery.data?.campaigns.map(mapCampaignRecord) ?? [];
  const campaigns = campaignsQuery.data ? apiCampaigns : fallbackCampaigns;

  const saveCampaignMutation = useMutation({
    mutationFn: saveCampaign,
    onSuccess: async () => {
      if (activeBrandId) {
        await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
      }
    },
  });

  const toggleCampaignMutation = useMutation({
    mutationFn: toggleCampaign,
    onSuccess: async () => {
      if (activeBrandId) {
        await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
      }
    },
  });

  const runPostUrlMutation = useMutation({
    mutationFn: runPostUrlCampaign,
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const total = allocation.instagram + allocation.facebook + allocation.tiktok;
  const allocOk = total === 100;

  const addPost = () =>
    setPosts((p) => [
      ...p,
      { id: nextId++, platform: "instagram", url: "", comments: false, likes: true },
    ]);

  const updatePost = (id: number, patch: Partial<PostRow>) =>
    setPosts((p) => p.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const deletePost = (id: number) => {
    setPosts((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p));
    setOpenMenuId(null);
  };

  const buildMeta = buildCampaignMeta;

  const toPayload = (c: CampaignDraft): CampaignPayload => ({
    ...(editingId && editingId > 0 ? { campaign_id: editingId } : {}),
    brand_id: activeBrandId!,
    name: c.name,
    platform: c.platforms[0] ?? "instagram",
    keywords: c.keywords,
    tone: c.tone,
    reply_template: c.template,
    cta_link: c.ctaLink,
    image_url: c.imageUrl,
    auto_fire_threshold: c.threshold,
    max_per_hour: c.maxPerHour,
    is_active: true,
    platform_allocation: c.allocation,
  });

  const handleSaveCampaign = async (c: CampaignDraft) => {
    if (activeBrandId) {
      try {
        await saveCampaignMutation.mutateAsync(toPayload(c));
        setEditingId(null);
        setModalOpen(false);
        setToast(editingId !== null ? "Campaign updated successfully." : "A new campaign has been set successfully.");
        setApiNotice(null);
        return;
      } catch (err) {
        setApiNotice(apiErrorMessage(err));
      }
    }

    if (editingId !== null) {
      setFallbackCampaigns((arr) =>
        arr.map((row) =>
          row.id === editingId
            ? { ...row, title: c.name, meta: buildMeta(c), platforms: c.platforms, draft: c }
            : row,
        ),
      );
      setEditingId(null);
      setToast("Campaign updated locally.");
    } else {
      setFallbackCampaigns((arr) => [
        {
          id: Date.now(),
          title: c.name,
          meta: buildMeta(c),
          platforms: c.platforms,
          stat: "Local draft",
          state: "running",
          justActivated: true,
          draft: c,
        },
        ...arr,
      ]);
      setToast("Campaign saved locally.");
    }
    setModalOpen(false);
  };

  const editingCampaign = campaigns.find((c) => c.id === editingId) ?? null;
  const runningCount = campaigns.filter((c) => c.state === "running").length;
  const pausedCount = campaigns.filter((c) => c.state === "paused").length;

  const handleDeleteConfirmed = () => {
    if (confirmDeleteId === null) return;
    setFallbackCampaigns((arr) => arr.filter((c) => c.id !== confirmDeleteId));
    setConfirmDeleteId(null);
    setEditingId(null);
    setToast("Campaign deleted locally.");
  };

  const handleToggleCampaign = async (campaign: Campaign) => {
    if (campaign.id > 0 && activeBrandId) {
      try {
        await toggleCampaignMutation.mutateAsync(campaign.id);
        setToast(campaign.state === "paused" ? "Campaign resumed." : "Campaign paused.");
        setApiNotice(null);
        return;
      } catch (err) {
        setApiNotice(apiErrorMessage(err));
      }
    }

    setFallbackCampaigns((arr) =>
      arr.map((row) =>
        row.id === campaign.id
          ? {
              ...row,
              state: row.state === "paused" ? "running" : "paused",
              stat: row.state === "paused" ? "Resumed" : "Paused",
            }
          : row,
      ),
    );
  };

  const handleRunPostUrls = async () => {
    const validPosts = posts
      .filter((post) => post.url.trim())
      .map((post) => ({ platform: post.platform, url: post.url.trim() }));

    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before running post URL campaigns.");
      return;
    }
    if (!validPosts.length) {
      setApiNotice("Add at least one post URL before fetching engagers.");
      return;
    }
    if (!allocOk) {
      setApiNotice("Platform allocation must equal 100% before running.");
      return;
    }

    try {
      const result = await runPostUrlMutation.mutateAsync({
        brand_id: activeBrandId,
        post_urls: validPosts,
        platform_allocation: allocation,
        reply_template: postTemplate,
      });
      setApiNotice(null);
      setToast(result.message);
    } catch (err) {
      setApiNotice(apiErrorMessage(err));
    }
  };


  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Engage the Engager" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader
          title="Engage the Engager"
          action={
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90"
            >
              <Plus className="size-4" /> New Campaign
            </button>
          }
        />

        {toast && (
          <div className="fixed top-6 right-6 z-50 bg-emerald-500 text-white rounded-2xl shadow-lg px-5 py-4 flex items-start gap-3 max-w-sm animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 className="size-6 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">New Campaign!</p>
              <p className="text-sm opacity-95">{toast}</p>
            </div>
            <button onClick={() => setToast(null)} className="opacity-80 hover:opacity-100">
              <XClose className="size-4" />
            </button>
          </div>
        )}

        <main className="flex-1 p-6 md:p-8 space-y-6 max-w-[1200px] w-full mx-auto">
          {apiNotice && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
              {apiNotice}
            </section>
          )}
          {campaignsQuery.isLoading && (
            <section className="rounded-2xl bg-card p-5 text-sm text-muted-foreground shadow-sm">
              Loading campaigns...
            </section>
          )}
          {campaignsQuery.error && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
              {apiErrorMessage(campaignsQuery.error)} Showing sample campaigns until the API is available.
            </section>
          )}

          {/* Top 3 explainer cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ExplainerCard
              title="User Comments"
              body={
                <>
                  Someone engages with your post on{" "}
                  <strong>Instagram, Facebook, or X</strong>. The system detects every
                  comment and like within minutes, automatically — 24/7, no monitoring needed.
                </>
              }
            />
            <ExplainerCard
              title="AI Personalises"
              body={
                <>
                  AI writes a unique reply using their <strong>@handle</strong>,{" "}
                  <strong>your brand voice, campaign message, and a tracked CTA link</strong>.
                  No two replies are ever identical.
                </>
              }
            />
            <ExplainerCard
              title="Fires Instantly"
              body={
                <>
                  IG/FB → personal DM with branded image + tracked link. X → thread reply
                  with image embed. All within seconds, zero human intervention required.
                </>
              }
            />
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi color="bg-primary" label="Active Campaigns" value={String(runningCount)} sub={runningCount ? "Running now" : "N/A"} subColor={runningCount ? "text-success" : "text-muted-foreground"} />
            <Kpi color="bg-brand-pink" label="Sent Today" value={runningCount ? "851" : "0"} sub={runningCount ? "Across all platforms" : "N/A"} subColor={runningCount ? "text-success" : "text-muted-foreground"} />
            <Kpi color="bg-brand-olive" label="Queued for Review" value={runningCount ? "16" : "0"} sub={runningCount ? "Below 85% confidence" : "N/A"} subColor="text-muted-foreground" />
            <Kpi color="bg-destructive" label="Manual Copy" value={runningCount ? "7" : "0"} sub={runningCount ? "TikTok / X pending" : "none pending"} subColor={runningCount ? "text-amber-600" : "text-muted-foreground"} />
          </div>

          {/* Active campaigns */}
          <div className="bg-card rounded-2xl shadow-sm">
            <div className="flex items-center justify-between px-6 py-5 border-b">
              <h2 className="font-bold">Active Campaigns</h2>
              <span className="text-xs text-muted-foreground">
                {campaigns.length === 0 ? "N/A" : `${runningCount} running · ${pausedCount} paused`}
              </span>
            </div>
            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <div className="size-16 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center mb-3">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                </div>
                <p className="text-sm">No Active Campaigns</p>
              </div>
            ) : (
              <ul>
                {campaigns.map((c) => (
                  <CampaignRow
                    key={c.id}
                    title={c.title}
                    meta={c.meta}
                    platforms={c.platforms}
                    stat={c.stat}
                    state={c.state}
                    justActivated={c.justActivated}
                    menuOpen={campaignMenuId === c.id}
                    onMenuToggle={() => setCampaignMenuId((id) => (id === c.id ? null : c.id))}
                    onEdit={() => { setEditingId(c.id); setModalOpen(true); setCampaignMenuId(null); }}
                    onRequestDelete={() => { setConfirmDeleteId(c.id); setCampaignMenuId(null); }}
                    onTogglePause={() => void handleToggleCampaign(c)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Message Everyone on Existing Posts */}
          <div className="bg-card rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold">Message Everyone on Existing Posts</h2>
              <p className="text-xs text-muted-foreground">
                Retroactively engage everyone who liked or commented
              </p>
            </div>

            <div className="space-y-3">
              {posts.map((row) => (
                <div key={row.id} className="flex items-center gap-3 relative">
                  <PlatformSelect
                    value={row.platform}
                    onChange={(v) => updatePost(row.id, { platform: v })}
                  />
                  <input
                    placeholder="https://..."
                    value={row.url}
                    onChange={(e) => updatePost(row.id, { url: e.target.value })}
                    className="flex-1 h-11 rounded-xl border border-border bg-card px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <CheckPill
                    label="Comments"
                    checked={row.comments}
                    onChange={() => updatePost(row.id, { comments: !row.comments })}
                  />
                  <CheckPill
                    label="Likes"
                    checked={row.likes}
                    onChange={() => updatePost(row.id, { likes: !row.likes })}
                  />
                  <div className="relative">
                    <button
                      onClick={() => setOpenMenuId((m) => (m === row.id ? null : row.id))}
                      className="size-8 rounded hover:bg-muted flex items-center justify-center"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                    {openMenuId === row.id && (
                      <div className="absolute right-0 top-9 z-10 bg-card border rounded-lg shadow-lg py-1 w-32">
                        <button
                          onClick={() => deletePost(row.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted"
                        >
                          <Trash2 className="size-4" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addPost}
              className="mt-4 flex items-center gap-1.5 text-primary font-semibold text-sm hover:underline"
            >
              <Plus className="size-4" /> Add Another Post
            </button>

            {/* Allocation */}
            <div
              className={`mt-6 rounded-2xl p-5 border ${
                allocOk ? "bg-muted/40 border-transparent" : "bg-red-50 border-red-100"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold">Platform Send Allocation</p>
                {allocOk ? (
                  <span className="text-success text-sm font-semibold">100% ✓</span>
                ) : (
                  <span className="text-destructive text-sm font-semibold">
                    {total}% ✗ must = 100%
                  </span>
                )}
              </div>

              <AllocSlider
                label="Instagram"
                icon={<PlatformLogo platform="instagram" size={16} />}
                value={allocation.instagram}
                onChange={(v) => setAllocation((a) => ({ ...a, instagram: v }))}
              />
              <AllocSlider
                label="Facebook"
                icon={<PlatformLogo platform="facebook" size={16} />}
                value={allocation.facebook}
                onChange={(v) => setAllocation((a) => ({ ...a, facebook: v }))}
              />
              <AllocSlider
                label="TikTok"
                icon={<PlatformLogo platform="tiktok" size={16} />}
                value={allocation.tiktok}
                onChange={(v) => setAllocation((a) => ({ ...a, tiktok: v }))}
              />

              <p className="text-xs text-muted-foreground mt-3">
                Controls % of engagers per platform who receive the message.
              </p>
            </div>

            {/* Reply Template */}
            <div className="mt-6">
              <p className="font-semibold mb-3">Reply Template</p>
              <div className="flex items-center gap-2 mb-3 text-xs">
                <span className="px-2.5 py-1 rounded-md bg-accent text-primary font-semibold">
                  {"{{handle}}"}
                </span>
                <span className="px-2.5 py-1 rounded-md bg-accent text-primary font-semibold">
                  {"{{link}}"}
                </span>
                <span className="text-muted-foreground">Click to insert variable</span>
              </div>
              <textarea
                rows={3}
                value={postTemplate}
                onChange={(e) => setPostTemplate(e.target.value)}
                placeholder="Hey {{handle}}! Thanks for engaging with our post. Here's something special for you: {{link}}"
                className="w-full rounded-xl border border-border bg-card p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex justify-between text-xs mt-1">
                <span className="text-muted-foreground">
                  This message will be personalised and sent to every engager fetched from the posts above.
                </span>
                <span className="text-muted-foreground">0 / 100</span>
              </div>
            </div>

            <button
              onClick={handleRunPostUrls}
              disabled={runPostUrlMutation.isPending}
              className="mt-5 w-full bg-primary text-primary-foreground rounded-xl py-3.5 font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60"
            >
              <Check className="size-4" /> {runPostUrlMutation.isPending ? "Starting..." : "Fetch & Message all Engagers"}
            </button>
          </div>

          {/* Live Activity Feed */}
          <div className="bg-card rounded-2xl shadow-sm">
            <div className="flex items-center justify-between px-6 py-5 border-b">
              <h2 className="font-bold">Live Activity Feed</h2>
              <span className="flex items-center gap-2 text-xs text-success font-semibold">
                <span className="size-2 rounded-full bg-success" /> Updating Live
              </span>
            </div>
            <ul className="divide-y">
              <FeedRow time="16:59" badge="IG DM" badgeClass="bg-pink-100 text-pink-700" body="@dayo99 commented → DM sent with image + link" status="Sent" statusClass="bg-emerald-100 text-emerald-700" dot="bg-success" />
              <FeedRow time="16:59" badge="Tiktok" badgeClass="bg-slate-900 text-white" body="@tobi_f commented → Queued (77% confidence)" status="Queue" statusClass="bg-amber-100 text-amber-700" dot="bg-amber-400" />
              <FeedRow time="16:59" badge="X reply" badgeClass="bg-slate-900 text-white" body="@femi_ng commented · Manual copy required (TikTok API limitation)" status="Sent" statusClass="bg-emerald-100 text-emerald-700" dot="bg-success" />
              <FeedRow time="16:59" badge="Tiktok" badgeClass="bg-slate-900 text-white" body="@femi_ng commented → Manual copy required (TikTok API limitation)" status="Manual" statusClass="bg-slate-200 text-slate-700" dot="bg-slate-400" />
              <FeedRow time="16:59" badge="FB DM" badgeClass="bg-blue-600 text-white" body="@dayo99 commented → DM sent with image + link" status="Sent" statusClass="bg-emerald-100 text-emerald-700" dot="bg-success" />
              <FeedRow time="16:59" badge="IG DM" badgeClass="bg-pink-100 text-pink-700" body="@ada_c — bot detected, skipped" status="Bot" statusClass="bg-red-100 text-red-600" dot="bg-destructive" />
            </ul>
          </div>
        </main>
      </div>
      <NewCampaignModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null); }}
        onSave={handleSaveCampaign}
        initial={editingCampaign?.draft ?? null}
        onDelete={editingId !== null ? () => setConfirmDeleteId(editingId) : undefined}
      />
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-md p-8 relative">
            <button
              onClick={() => setConfirmDeleteId(null)}
              className="absolute top-4 right-4 size-8 rounded-full hover:bg-muted flex items-center justify-center"
            >
              <XClose className="size-5" />
            </button>
            <h3 className="text-xl font-bold text-center mb-6 mt-2">
              Are you sure you want to delete this Campaign?
            </h3>
            <div className="space-y-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="w-full h-12 rounded-xl border-2 border-primary text-primary font-semibold hover:bg-accent"
              >
                No, Cancel
              </button>
              <button
                onClick={() => { handleDeleteConfirmed(); setModalOpen(false); }}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90"
              >
                Yes, Delete Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExplainerCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm">
      <p className="text-primary font-bold mb-2">{title}</p>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Kpi({
  color,
  label,
  value,
  sub,
  subColor,
}: {
  color: string;
  label: string;
  value: string;
  sub: string;
  subColor: string;
}) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className={`text-xs mt-2 ${subColor}`}>{sub}</p>
    </div>
  );
}

function CampaignRow({
  title,
  meta,
  platforms,
  stat,
  state,
  justActivated,
  menuOpen,
  onMenuToggle,
  onEdit,
  onRequestDelete,
  onTogglePause,
}: {
  title: string;
  meta: string;
  platforms: Platform[];
  stat: string;
  state: "running" | "paused";
  justActivated?: boolean;
  menuOpen?: boolean;
  onMenuToggle?: () => void;
  onEdit?: () => void;
  onRequestDelete?: () => void;
  onTogglePause?: () => void;
}) {
  const paused = state === "paused";
  return (
    <li className="flex items-center gap-4 px-6 py-4 border-b last:border-b-0">
      <span className={`size-2.5 rounded-full ${paused ? "bg-muted-foreground/40" : "bg-success"}`} />
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${paused ? "text-muted-foreground" : ""}`}>{title}</p>
        <p className="text-xs text-muted-foreground truncate">{meta}</p>
      </div>
      <div className="flex items-center gap-1">
        {platforms.map((p) => {
          const conf = PLATFORMS.find((pp) => pp.id === p)!;
          return <span key={p} className="size-7 rounded-md flex items-center justify-center bg-muted/60">{conf.icon}</span>;
        })}
      </div>
      <span className={`text-xs ${paused ? "text-muted-foreground" : justActivated ? "text-success font-semibold" : "text-foreground"} w-44 text-right`}>{stat}</span>
      <div className="flex items-center gap-2 relative">
        <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-md bg-accent text-primary font-semibold">Edit</button>
        {paused ? (
          <button onClick={onTogglePause} className="text-xs px-3 py-1.5 rounded-md border border-success text-success font-semibold">Resume</button>
        ) : (
          <button onClick={onTogglePause} className="text-xs px-3 py-1.5 rounded-md border border-destructive text-destructive font-semibold">Pause</button>
        )}
        <button onClick={onMenuToggle} className="size-7 rounded hover:bg-muted flex items-center justify-center">
          <MoreVertical className="size-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-10 bg-card border rounded-lg shadow-lg py-1 w-32">
            <button onClick={onRequestDelete} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted">
              <Trash2 className="size-4" /> Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function PlatformSelect({ value, onChange }: { value: Platform; onChange: (v: Platform) => void }) {
  const [open, setOpen] = useState(false);
  const current = PLATFORMS.find((p) => p.id === value)!;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-11 px-3 rounded-xl border border-border bg-card text-sm w-40"
      >
        {current.icon}
        <span className="flex-1 text-left">{current.label}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-20 bg-card border rounded-xl shadow-lg py-1 w-44">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
            >
              {p.icon}
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckPill({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <span
        onClick={onChange}
        className={`size-4 rounded border flex items-center justify-center ${
          checked ? "bg-primary border-primary text-white" : "border-border bg-card"
        }`}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

function AllocSlider({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-28 flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-primary"
      />
      <span className="w-12 text-right text-sm font-semibold">{value}%</span>
    </div>
  );
}

function FeedRow({
  time,
  badge,
  badgeClass,
  body,
  status,
  statusClass,
  dot,
}: {
  time: string;
  badge: string;
  badgeClass: string;
  body: string;
  status: string;
  statusClass: string;
  dot: string;
}) {
  return (
    <li className="flex items-center gap-4 px-6 py-3.5 text-sm">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="text-xs text-muted-foreground w-12">{time}</span>
      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded ${badgeClass}`}>{badge}</span>
      <span className="flex-1 truncate">{body}</span>
      <span className={`text-[11px] font-semibold px-3 py-1 rounded-full ${statusClass}`}>{status}</span>
    </li>
  );
}

