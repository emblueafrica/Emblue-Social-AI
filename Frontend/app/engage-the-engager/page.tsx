"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, ChevronDown, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X as XClose } from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { NewCampaignModal, type CampaignDraft } from "@/components/dashboard/NewCampaignModal";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import {
  ApiError,
  actOnCampaignActivity,
  activateCampaign,
  deleteCampaign,
  downloadCampaignActivityCsv,
  fetchPostUrlPreview,
  getCampaignActivity,
  getCampaigns,
  getCampaignStatus,
  preflightCampaign,
  preflightKeywordCampaign,
  runPostUrlPreview,
  saveCampaign,
  saveKeywordCampaign,
  syncCampaignEngagements,
  setCampaignState,
  updateCampaign,
  type CampaignPayload,
  type CampaignActivationPayload,
  type CampaignActivityResponse,
  type CampaignEngagementResponse,
  type CampaignRecord,
  type PostUrlPreviewResponse,
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
  activationStatus: string;
  mode: "live" | "post_url" | "keyword";
  draft: CampaignDraft;
};

let nextId = 1;

const seedDraft = (over: Partial<CampaignDraft>): CampaignDraft => ({
  name: "",
  platforms: [],
  sourceMode: "existing",
  priority: 0,
  liveScope: "all_owned_posts",
  replyMode: "dm_with_public_fallback",
  postCaption: "",
  existingPosts: {},
  media: [],
  keywords: [],
  tone: "",
  maxPerHour: 50,
  maxPerDay: 50,
  maxDmPerDay: 25,
  spacingMinutes: 10,
  intentFilter: ["complaint", "purchase_intent"],
  urgencyThreshold: 3,
  replyTemplateId: null,
  publicReplyEnabled: true,
  directMessageEnabled: true,
  template: "Hey {{handle}}! Thanks for engaging with our post. Here's something special for you: {{link}}",
  privateTemplate: "Hey {{handle}}, here is the information you requested: {{link}}",
  ctaLink: "",
  imageUrl: "",
  threshold: 85,
  events: { comments: true, likes: true, reposts: true, mentions: true, dms: true },
  allocation: { instagram: 40, facebook: 25, tiktok: 20, x: 15 },
  campaignType: "brand_mention",
  minFollowers: 0,
  skipVerified: false,
  skipReposts: true,
  skipNewAccountsDays: 0,
  ...over,
});

function mapCampaignRecord(record: CampaignRecord): Campaign {
  const allocation = record.platform_allocation ?? { instagram: 40, facebook: 25, tiktok: 20, x: 15 };
  const platforms = Array.from(
    new Set(
      [
        ...(record.platforms ?? []),
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
    maxPerDay: record.max_per_day ?? 50,
    maxDmPerDay: record.max_dm_per_day ?? 25,
    spacingMinutes: record.spacing_minutes ?? 10,
    priority: record.priority ?? 0,
    liveScope: record.scope_type ?? "all_owned_posts",
    replyMode: record.reply_mode ?? "dm_with_public_fallback",
    intentFilter: record.intent_filter ?? [],
    urgencyThreshold: record.urgency_threshold ?? 3,
    replyTemplateId: record.reply_template_id ?? null,
    publicReplyEnabled: record.public_reply_enabled ?? true,
    directMessageEnabled: record.direct_message_enabled ?? true,
    ctaLink: record.cta_link ?? "",
    imageUrl: record.image_url ?? "",
    threshold: record.auto_fire_threshold ?? 85,
    allocation: {
      instagram: allocation.instagram ?? 0,
      facebook: allocation.facebook ?? 0,
      tiktok: allocation.tiktok ?? 0,
      x: allocation.x ?? 0,
    },
    sourceMode: record.mode === "live" ? "live" : record.mode === "keyword" ? "keyword" : "existing",
    postCaption: record.post_caption ?? "",
    privateTemplate: record.private_followup_template ?? record.reply_template ?? "",
    template: record.public_reply_template ?? record.reply_template ?? "",
    events: record.event_settings ?? { comments: true, likes: true, reposts: true, mentions: true, dms: true },
    campaignType: (record.mode_config?.campaign_type as CampaignDraft["campaignType"]) ?? "brand_mention",
    minFollowers: Number(record.mode_config?.min_followers ?? 0),
    skipVerified: Boolean(record.mode_config?.skip_verified),
    skipReposts: record.mode_config?.skip_reposts !== false,
    skipNewAccountsDays: Number(record.mode_config?.skip_accounts_newer_than_days ?? 0),
  });

  return {
    id: record.campaign_id,
    title: record.name,
    meta: buildCampaignMeta(draft),
    platforms: draft.platforms,
    stat: record.is_active === false ? "Paused" : `${record.total_sent ?? 0} sent total`,
    state: record.is_active === false ? "paused" : "running",
    activationStatus: record.activation_status ?? (record.is_active === false ? "draft" : "active"),
    mode: record.mode ?? (record.source_mode === "keyword" ? "keyword" : "post_url"),
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
  const { activeBrandId, authContext } = useAuth();
  const [selectedMode, setSelectedMode] = useState<"live" | "post_url" | "keyword">("live");
  const [posts, setPosts] = useState<PostRow[]>([{ id: nextId++, platform: "instagram", url: "" }]);
  const [allocation, setAllocation] = useState({ instagram: 40, facebook: 25, tiktok: 20, x: 15 });
  const [postTemplate, setPostTemplate] = useState("");
  const [postCtaLink, setPostCtaLink] = useState("");
  const [postUrlPreviewCampaignId, setPostUrlPreviewCampaignId] = useState<number | null>(null);
  const [postUrlPreview, setPostUrlPreview] = useState<PostUrlPreviewResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<CampaignDraft | null>(null);
  const [activityCampaignId, setActivityCampaignId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [campaignActivating, setCampaignActivating] = useState(false);
  const [activityDrafts, setActivityDrafts] = useState<Record<string, string>>({});

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", activeBrandId, selectedMode],
    queryFn: () => getCampaigns(activeBrandId!, selectedMode),
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  const activityQuery = useQuery({
    queryKey: ["campaign-activity", activeBrandId, selectedMode, activityCampaignId],
    queryFn: () => getCampaignActivity({ brandId: activeBrandId!, mode: selectedMode, campaignId: activityCampaignId ?? undefined }),
    enabled: Boolean(activeBrandId),
    retry: false,
    refetchInterval: 15000,
  });

  const saveCampaignMutation = useMutation({
    mutationFn: saveCampaign,
    onSuccess: async () => {
      if (activeBrandId) await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
    },
  });
  const saveKeywordCampaignMutation = useMutation({ mutationFn: saveKeywordCampaign });

  const toggleCampaignMutation = useMutation({
    mutationFn: ({ campaignId, action }: { campaignId: number; action: "pause" | "resume" }) => setCampaignState(activeBrandId!, campaignId, action),
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

  const fetchPostUrlMutation = useMutation({
    mutationFn: ({ campaignId, postUrls }: { campaignId: number; postUrls: { platform: Platform; url: string }[] }) =>
      fetchPostUrlPreview(campaignId, activeBrandId!, postUrls),
  });
  const runPostUrlMutation = useMutation({
    mutationFn: (campaignId: number) => runPostUrlPreview(campaignId, activeBrandId!),
  });
  const campaignSyncMutation = useMutation({
    mutationFn: (campaignId: number) => syncCampaignEngagements(campaignId, activeBrandId!),
  });
  const campaignRetryMutation = useMutation({
    mutationFn: ({ engagerId, replyText }: { engagerId: number; replyText?: string }) => actOnCampaignActivity(engagerId, replyText ? "edit-and-send" : "retry", { brand_id: activeBrandId!, reply_text: replyText }),
  });
  const campaignDismissMutation = useMutation({
    mutationFn: ({ engagerId }: { engagerId: number }) => actOnCampaignActivity(engagerId, "dismiss", { brand_id: activeBrandId! }),
  });

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const campaigns = campaignsQuery.data?.campaigns.map(mapCampaignRecord) ?? [];
  const canMutate = Boolean(
    authContext?.platform_role === "super_admin" ||
    authContext?.platform_role === "platform_admin" ||
    authContext?.active_brand?.role === "client_owner",
  );
  const runningCount = campaigns.filter((campaign) => campaign.state === "running").length;
  const pausedCount = campaigns.filter((campaign) => campaign.state === "paused").length;
  const sentTotal = campaigns.reduce((sum, campaign) => {
    const match = campaign.stat.match(/^(\d+)/);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  const allocationTotal = allocation.instagram + allocation.facebook + allocation.tiktok + allocation.x;

  const selectedAllocation = (campaign: CampaignDraft) => ({
    instagram: campaign.platforms.includes("instagram") ? campaign.allocation.instagram : 0,
    facebook: campaign.platforms.includes("facebook") ? campaign.allocation.facebook : 0,
    tiktok: campaign.platforms.includes("tiktok") ? campaign.allocation.tiktok : 0,
    x: campaign.platforms.includes("x") ? campaign.allocation.x : 0,
  });

  const toPayload = (campaign: CampaignDraft): CampaignPayload => ({
    ...(editingId && editingId > 0 ? { campaign_id: editingId } : {}),
    brand_id: activeBrandId!,
    name: campaign.name,
    platform: campaign.platforms[0] ?? "instagram",
    mode: campaign.sourceMode === "live" ? "live" : campaign.sourceMode === "keyword" ? "keyword" : "post_url",
    platforms: campaign.platforms,
    priority: campaign.priority,
    scope_type: campaign.sourceMode === "live" ? campaign.liveScope : "selected_posts",
    reply_mode: campaign.replyMode,
    keywords: campaign.keywords,
    tone: campaign.tone,
    reply_template: campaign.template,
    public_reply_template: campaign.template,
    private_followup_template: campaign.privateTemplate,
    cta_link: campaign.ctaLink,
    image_url: campaign.imageUrl,
    auto_fire_threshold: campaign.threshold,
    max_per_hour: campaign.maxPerHour,
    max_per_day: campaign.maxPerDay,
    max_dm_per_day: campaign.maxDmPerDay,
    spacing_minutes: campaign.spacingMinutes,
    mode_config: {
      campaign_type: campaign.campaignType,
      min_followers: campaign.minFollowers,
      skip_verified: campaign.skipVerified,
      skip_reposts: campaign.skipReposts,
      skip_accounts_newer_than_days: campaign.skipNewAccountsDays,
    },
    selected_posts: campaign.sourceMode === "live" && campaign.liveScope === "selected_posts"
      ? campaign.platforms.map(platform => ({ platform, url: campaign.existingPosts[platform] ?? "" }))
      : undefined,
    is_active: false,
    platform_allocation: selectedAllocation(campaign),
    source_mode: campaign.sourceMode === "keyword" ? "keyword" : "existing",
    post_caption: campaign.postCaption,
    event_settings: campaign.events,
    activation_status: "draft",
  });

  const handleSaveCampaign = async (campaign: CampaignDraft, status: "draft" | "active") => {
    if (!activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before creating campaigns.");
      return;
    }

    setCampaignActivating(true);
    try {
      if (campaign.sourceMode === "keyword") {
        const preflight = status === "active" ? await preflightKeywordCampaign(activeBrandId, campaign.platforms) : null;
        const saved = await saveKeywordCampaignMutation.mutateAsync({
          brand_id: activeBrandId,
          ...(editingId && editingId > 0 ? { campaign_id: editingId } : {}),
          name: campaign.name,
          keywords: campaign.keywords,
          platforms: campaign.platforms,
          intent_filter: campaign.intentFilter,
          confidence_threshold: campaign.threshold,
          urgency_threshold: campaign.urgencyThreshold,
          reply_template_id: campaign.replyTemplateId,
          max_per_day: campaign.maxPerDay,
          max_dm_per_day: campaign.maxDmPerDay,
          spacing_minutes: campaign.spacingMinutes,
          priority: campaign.priority,
          reply_mode: campaign.replyMode,
          mode_config: {
            campaign_type: campaign.campaignType,
            min_followers: campaign.minFollowers,
            skip_verified: campaign.skipVerified,
            skip_reposts: campaign.skipReposts,
            skip_accounts_newer_than_days: campaign.skipNewAccountsDays,
          },
          public_reply_enabled: campaign.publicReplyEnabled,
          direct_message_enabled: campaign.directMessageEnabled,
          tone: campaign.tone,
          public_reply_template: campaign.template,
          private_followup_template: campaign.privateTemplate,
          cta_link: campaign.ctaLink,
          image_url: campaign.imageUrl,
          status,
        });
        const issues = (preflight?.capabilities ?? saved.capabilities).flatMap(capability => capability.issues.map(issue => `${capability.platform}: ${issue}`));
        setEditingId(null); setEditingDraft(null); setModalOpen(false);
        setApiNotice(issues.length ? issues.join(" ") : null);
        setToast(status === "draft" ? "Keyword campaign saved as draft." : "Keyword campaign launched.");
        await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
        return;
      }
      const saved = editingId
        ? await updateCampaign(editingId, toPayload(campaign))
        : await saveCampaignMutation.mutateAsync(toPayload(campaign));
      const campaignId = saved.campaign.campaign_id;
      const activationPayload: CampaignActivationPayload = {
        brand_id: activeBrandId,
        source_mode: "existing",
        platforms: campaign.platforms,
        existing_posts: campaign.sourceMode === "existing"
          ? campaign.platforms.map((platform) => ({ platform, url: campaign.existingPosts[platform] ?? "" }))
          : undefined,
        allocation: selectedAllocation(campaign),
        media: campaign.media,
        post_caption: campaign.postCaption,
      };
      if (status === "draft") {
        setEditingId(null); setEditingDraft(null); setModalOpen(false); setApiNotice(null); setToast("Campaign saved as draft.");
        await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
        return;
      }
      const preflight = campaign.sourceMode === "live" ? null : await preflightCampaign(campaignId, activationPayload);
      if (preflight && !preflight.platforms.some((platform) => platform.ready)) {
        throw new Error(preflight.platforms.flatMap((platform) => platform.issues).join(" ") || "No selected platform is ready to activate.");
      }
      const activation = await activateCampaign(campaignId, activationPayload);
      setEditingId(null);
      setEditingDraft(null);
      setModalOpen(false);
      setApiNotice(null);
      const failures = activation.platforms.filter((platform) => !platform.success);
      setToast(failures.length
        ? `Campaign partially active. ${failures.map((platform) => `${platform.platform}: ${platform.error}`).join(" ")}`
        : editingId !== null ? "Campaign updated and republished successfully." : "Campaign saved and activated successfully.");
      await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    } finally {
      setCampaignActivating(false);
    }
  };

  const handleEditCampaign = async (campaign: Campaign) => {
    if (!activeBrandId) return;
    setApiNotice(null);
    try {
      const status = await getCampaignStatus(campaign.id, activeBrandId);
      const existingPosts = Object.fromEntries(
        status.bindings
          .filter((binding) => binding.status !== "superseded" && binding.post_url)
          .map((binding) => [binding.platform, binding.post_url]),
      ) as Partial<Record<Platform, string>>;
      setEditingId(campaign.id);
      setEditingDraft({
        ...mapCampaignRecord(status.campaign).draft,
        existingPosts,
        media: status.media,
        imageUrl: status.media[0]?.url ?? status.campaign.image_url ?? "",
      });
      setModalOpen(true);
    } catch (error) {
      setApiNotice(`Could not load the saved campaign details. ${apiErrorMessage(error)}`);
    }
  };

  const handleSyncCampaign = async (campaignId: number) => {
    try {
      const result = await campaignSyncMutation.mutateAsync(campaignId);
      await activityQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
      setToast(`Sync complete: ${result.captured} new, ${result.sent} sent, ${result.ignored} ignored, ${result.failed} failed.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`);
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleRetryEngagement = async (engagerId: number, replyText?: string) => {
    if (!activityCampaignId) return;
    try {
      const result = await campaignRetryMutation.mutateAsync({ engagerId, replyText });
      await activityQuery.refetch();
      setToast(result.status === "sent" ? "Campaign reply sent." : `Campaign reply status: ${result.status.replaceAll("_", " ")}.`);
      if (result.error) setApiNotice(result.error);
    } catch (error) { setApiNotice(apiErrorMessage(error)); }
  };

  const handleDismissEngagement = async (engagerId: number) => {
    if (!activityCampaignId) return;
    try {
      await campaignDismissMutation.mutateAsync({ engagerId });
      await activityQuery.refetch();
      setToast("Campaign engagement dismissed.");
    } catch (error) { setApiNotice(apiErrorMessage(error)); }
  };

  const handleToggleCampaign = async (campaignId: number, currentState: "running" | "paused") => {
    if (!activeBrandId || campaignId <= 0) {
      setApiNotice("Campaign state changes require a saved backend campaign.");
      return;
    }

    try {
      await toggleCampaignMutation.mutateAsync({ campaignId, action: currentState === "paused" ? "resume" : "pause" });
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

  const handleFetchPostUrlPreview = async () => {
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
      const saved = await saveCampaignMutation.mutateAsync({
        brand_id: activeBrandId,
        name: `Post URL Campaign ${new Date().toLocaleDateString()}`,
        platform: validPosts[0]?.platform ?? "instagram",
        mode: "post_url",
        platforms: Array.from(new Set(validPosts.map((post) => post.platform))),
        scope_type: "selected_posts",
        reply_mode: "dm_with_public_fallback",
        selected_posts: validPosts,
        platform_allocation: allocation,
        reply_template: postTemplate.trim(),
        cta_link: postCtaLink.trim() || undefined,
        auto_fire_threshold: 85,
        max_per_hour: 50,
        max_per_day: 100,
        max_dm_per_day: 50,
        spacing_minutes: 10,
        source_mode: "existing",
      });
      const campaignId = saved.campaign.campaign_id ?? saved.campaign.id;
      const preview = await fetchPostUrlMutation.mutateAsync({ campaignId, postUrls: validPosts });
      setPostUrlPreviewCampaignId(campaignId);
      setPostUrlPreview(preview);
      setActivityCampaignId(campaignId);
      setApiNotice(null);
      setToast(`Preview ready: ${preview.counts.selected} selected, ${preview.counts.review} for review.`);
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleConfirmPostUrlRun = async () => {
    if (!activeBrandId || !postUrlPreviewCampaignId) {
      setApiNotice("Fetch engagers before confirming this post URL campaign.");
      return;
    }
    try {
      const result = await runPostUrlMutation.mutateAsync(postUrlPreviewCampaignId);
      await activityQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
      setToast(`Post URL campaign queued: ${result.queued} selected, ${result.review} needing review.`);
      setApiNotice(null);
    } catch (error) {
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
            canMutate ? <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90">
              <Plus className="size-4" /> New Campaign
            </button> : null
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
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border bg-card p-1" role="tablist" aria-label="Campaign modes">
            {([
              ["live", "Live Engagement"],
              ["post_url", "Post URL Campaign"],
              ["keyword", "Keyword Campaign"],
            ] as const).map(([mode, label]) => (
              <button key={mode} type="button" role="tab" aria-selected={selectedMode === mode} onClick={() => { setSelectedMode(mode); setActivityCampaignId(null); }} className={`shrink-0 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-semibold ${selectedMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {label}
              </button>
            ))}
          </div>
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
                  <li key={campaign.id} className="py-5">
                    <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{campaign.title}</h3>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${campaign.activationStatus === "active" ? "bg-emerald-100 text-emerald-700" : campaign.activationStatus === "partial" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>
                          {campaign.activationStatus === "active" ? campaign.state : campaign.activationStatus}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 text-safe">{campaign.meta}</p>
                      <div className="flex items-center gap-2 mt-3">
                        {campaign.platforms.map((platform) => (
                          <PlatformLogo key={`${campaign.id}-${platform}`} platform={platform} size={18} />
                        ))}
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="mr-1 whitespace-nowrap text-sm text-muted-foreground">{campaign.stat}</span>
                      {canMutate && <button onClick={() => void handleEditCampaign(campaign)} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"><Pencil className="size-4 shrink-0" />Edit</button>}
                      <button onClick={() => setActivityCampaignId(current => current === campaign.id ? null : campaign.id)} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"><Activity className="size-4 shrink-0" />Activity</button>
                      {canMutate && <button onClick={() => void handleToggleCampaign(campaign.id, campaign.state)} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                        {campaign.state === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
                        {campaign.state === "paused" ? "Resume" : "Pause"}
                      </button>}
                      {canMutate && <button onClick={() => setConfirmDeleteId(campaign.id)} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium text-destructive hover:bg-muted">
                        <Trash2 className="size-4" /> Delete
                      </button>}
                    </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-12 text-sm text-muted-foreground">No backend campaigns found for this brand yet.</div>
            )}

          </Surface>

          {selectedMode === "post_url" && <Surface>
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
              <button onClick={() => void handleFetchPostUrlPreview()} disabled={fetchPostUrlMutation.isPending || saveCampaignMutation.isPending} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {fetchPostUrlMutation.isPending || saveCampaignMutation.isPending ? "Fetching..." : "Fetch Engagers"}
              </button>
              <span className="text-sm text-muted-foreground">This previews the audience first. Nothing is sent until you confirm.</span>
            </div>

            {postUrlPreviewCampaignId && (
              <div className="mt-6 rounded-xl border bg-muted/30 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-bold">Preview campaign: {postUrlPreviewCampaignId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {postUrlPreview ? `Preview expires ${new Date(postUrlPreview.expires_at).toLocaleString()}` : "No preview fetched yet."}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleConfirmPostUrlRun()}
                    disabled={!postUrlPreview || runPostUrlMutation.isPending}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    {runPostUrlMutation.isPending ? "Queueing..." : "Confirm & Run"}
                  </button>
                </div>

                {postUrlPreview && (
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                      <MiniStat label="Fetched" value={postUrlPreview.counts.total} />
                      <MiniStat label="Selected" value={postUrlPreview.counts.selected} />
                      <MiniStat label="Review" value={postUrlPreview.counts.review} />
                      <MiniStat label="Ignored" value={postUrlPreview.counts.ignored} />
                      <MiniStat label="Commenters" value={postUrlPreview.counts.commenters} />
                    </div>
                    <div className="space-y-2">
                      {Object.entries(postUrlPreview.by_platform).map(([platform, item]) => ({
                        platform,
                        url: "preview",
                        status: `${item.selected} selected`,
                        total_fetched: item.total,
                        error: null,
                      })).map((item) => (
                        <div key={item.platform} className="rounded-lg border bg-background p-3 text-sm">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <span className="min-w-0 truncate font-semibold">{item.platform.toUpperCase()} · {item.url}</span>
                            <span className="text-muted-foreground">{item.status} · {item.total_fetched} fetched</span>
                          </div>
                          {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
                        </div>
                      ))}
                    </div>
                    {postUrlPreview.errors.length > 0 && (
                      <div className="space-y-2">
                        {postUrlPreview.errors.map((error) => ({
                          platform: "error",
                          author_handle: error,
                          created_at: error,
                          action: "",
                          status: "error",
                        })).map((item) => (
                          <div key={`${item.platform}-${item.author_handle}-${item.created_at}`} className="flex items-center justify-between rounded-lg border bg-background p-3 text-sm">
                            <span>{item.author_handle || "unknown"} · {item.action}</span>
                            <span className="text-muted-foreground">{item.status || "pending"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {fetchPostUrlMutation.error && (
                  <p className="mt-3 text-sm text-destructive">{apiErrorMessage(fetchPostUrlMutation.error)}</p>
                )}
              </div>
            )}
          </Surface>}

          <UnifiedActivityFeed
            data={activityQuery.data}
            loading={activityQuery.isLoading}
            error={activityQuery.error}
            canMutate={canMutate}
            selectedCampaignId={activityCampaignId}
            syncing={campaignSyncMutation.isPending}
            mutating={campaignRetryMutation.isPending || campaignDismissMutation.isPending}
            drafts={activityDrafts}
            onDraftChange={(id, value) => setActivityDrafts(current => ({ ...current, [id]: value }))}
            onSync={() => activityCampaignId && void handleSyncCampaign(activityCampaignId)}
            onRetry={(id, reply) => void handleRetryEngagement(id, reply)}
            onDismiss={(id) => void handleDismissEngagement(id)}
            onExport={async () => {
              if (!activeBrandId) return;
              const blob = await downloadCampaignActivityCsv(activeBrandId, { mode: selectedMode });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url; anchor.download = `campaign-activity-${selectedMode}.csv`; anchor.click();
              URL.revokeObjectURL(url);
            }}
          />
        </main>

        <NewCampaignModal
          open={modalOpen}
          brandId={activeBrandId}
          initial={editingDraft ?? undefined}
          initialMode={selectedMode === "post_url" ? "existing" : selectedMode}
          saving={saveCampaignMutation.isPending || saveKeywordCampaignMutation.isPending || campaignActivating}
          errorMessage={apiNotice}
          onClose={() => {
            setModalOpen(false);
            setEditingId(null);
            setEditingDraft(null);
          }}
          onSave={(campaign, status) => void handleSaveCampaign(campaign, status)}
          onDelete={editingId ? () => {
            setModalOpen(false);
            setConfirmDeleteId(editingId);
          } : undefined}
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

function CampaignActivityPanel({ data, loading, error, syncing, mutating, drafts, onDraftChange, onSync, onRetry, onDismiss }: {
  data?: CampaignEngagementResponse;
  loading: boolean;
  error: unknown;
  syncing: boolean;
  mutating: boolean;
  drafts: Record<string, string>;
  onDraftChange: (id: string, value: string) => void;
  onSync: () => void;
  onRetry: (id: number, reply?: string) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="mt-5 border-t pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 className="font-semibold">Campaign engagement activity</h3><p className="mt-1 text-xs text-muted-foreground">Auto-refreshes every 15 seconds. Campaign replies are handled here, not in the AI Reply Engine.</p></div>
        <button onClick={onSync} disabled={syncing} className="flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 shrink-0 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing..." : "Sync now"}</button>
      </div>
      {loading && <p className="py-6 text-sm text-muted-foreground">Loading campaign activity...</p>}
      {Boolean(error) && <p className="py-4 text-sm text-destructive">{apiErrorMessage(error)}</p>}
      {data && <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Object.entries(data.summary).map(([label, value]) => <MiniStat key={label} label={label} value={value} />)}</div>
        {data.bindings.map(binding => <div key={`${binding.platform}-${binding.url}`} className="border-l-2 border-primary pl-3 text-xs"><p className="break-all font-medium">{binding.platform.toUpperCase()} - {binding.url}</p><p className="mt-1 text-muted-foreground">{binding.status ?? "pending"} - {binding.total_fetched} fetched{binding.error ? ` - ${binding.error}` : ""}</p></div>)}
        {data.engagers.length ? <div className="space-y-3">{data.engagers.map(item => {
          const actionable = ["needs_review", "partial", "failed", "error", "generation_failed", "rate_limited", "manual_copy", "manual_action_required", "bot_blocked"].includes(item.status ?? "");
          const draft = drafts[item.id] ?? item.reply_text ?? "";
          return <div key={item.id} className="grid min-w-0 gap-3 border-t pt-3 lg:grid-cols-[140px_110px_minmax(0,1fr)_150px]">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{item.author_handle || "Unknown"}</p><p className="text-xs capitalize text-muted-foreground">{item.platform} - {item.action}</p>{item.intent && <p className="mt-1 text-xs text-muted-foreground">{item.intent.replaceAll("_", " ")} · urgency {item.urgency_score ?? "-"} · confidence {item.reply_confidence ?? "-"}%</p>}</div>
            <span className="h-fit w-fit whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize">{(item.status || "pending").replaceAll("_", " ")}</span>
            <div className="min-w-0"><p className="break-words text-sm">{item.original_text || "No message text"}</p>{item.delivery_error && <p className="mt-1 break-words text-xs text-destructive">{item.delivery_error}</p>}{item.deliveries.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{item.deliveries.map(delivery => <span key={delivery.channel} title={delivery.error ?? undefined} className="whitespace-nowrap rounded-full border px-2 py-1 text-xs capitalize">{delivery.channel.replaceAll("_", " ")}: {delivery.status.replaceAll("_", " ")}</span>)}</div>}{actionable && <textarea value={draft} onChange={event => onDraftChange(item.id, event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border bg-background p-2 text-sm" placeholder="Edit the reply before retrying" />}</div>
            {actionable && <div className="flex flex-wrap items-start gap-2"><button disabled={mutating} onClick={() => onRetry(Number(item.id), draft || undefined)} className="shrink-0 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Retry reply</button><button disabled={mutating} onClick={() => onDismiss(Number(item.id))} className="shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Dismiss</button></div>}
          </div>;
        })}</div> : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No engagement has been captured yet. Use Sync now after someone replies to the tracked post.</p>}
      </div>}
    </div>
  );
}

function UnifiedActivityFeed({ data, loading, error, canMutate, selectedCampaignId, syncing, mutating, drafts, onDraftChange, onSync, onRetry, onDismiss, onExport }: {
  data?: CampaignActivityResponse;
  loading: boolean;
  error: unknown;
  canMutate: boolean;
  selectedCampaignId: number | null;
  syncing: boolean;
  mutating: boolean;
  drafts: Record<string, string>;
  onDraftChange: (id: string, value: string) => void;
  onSync: () => void;
  onRetry: (id: number, reply?: string) => void;
  onDismiss: (id: number) => void;
  onExport: () => void | Promise<void>;
}) {
  return <Surface>
    <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-bold">Activity Feed</h2><p className="mt-1 text-xs text-muted-foreground">{selectedCampaignId ? "Filtered to the selected campaign." : "All delivery outcomes for this mode."} Auto-refreshes every 15 seconds.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void onExport()} className="shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Export CSV</button>
        {canMutate && selectedCampaignId && <button onClick={onSync} disabled={syncing} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing..." : "Sync now"}</button>}
      </div>
    </div>
    {loading && <p className="py-6 text-sm text-muted-foreground">Loading activity...</p>}
    {Boolean(error) && <p className="py-4 text-sm text-destructive">{apiErrorMessage(error)}</p>}
    {data && <div className="divide-y">
      {data.items.length ? data.items.map(item => {
        const actionable = ["needs_review", "partial", "failed", "error", "generation_failed", "rate_limited", "manual_action_required", "bot_blocked"].includes(item.status);
        const draft = drafts[String(item.id)] ?? item.reply_text ?? "";
        return <div key={item.id} className="grid min-w-0 gap-3 py-4 lg:grid-cols-[180px_120px_minmax(0,1fr)_170px]">
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.campaign_name}</p><p className="truncate text-xs text-muted-foreground">{item.author_handle || "Unknown"}</p><p className="text-xs capitalize text-muted-foreground">{item.platform} - {item.action}</p></div>
          <span className="h-fit w-fit whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize">{item.status.replaceAll("_", " ")}</span>
          <div className="min-w-0"><p className="break-words text-sm">{item.original_text || "No message text"}</p>{item.error && <p className="mt-1 break-words text-xs text-destructive">{item.error}</p>}<div className="mt-2 flex flex-wrap gap-2">{item.deliveries.map(delivery => <span key={`${item.id}-${delivery.channel}`} className="whitespace-nowrap rounded-full border px-2 py-1 text-xs capitalize">{delivery.channel.replaceAll("_", " ")}: {delivery.status.replaceAll("_", " ")}</span>)}</div>{canMutate && actionable && <textarea value={draft} onChange={event => onDraftChange(String(item.id), event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border bg-background p-2 text-sm" placeholder="Edit the reply before sending" />}</div>
          {canMutate && actionable ? <div className="flex flex-wrap items-start gap-2"><button disabled={mutating} onClick={() => onRetry(item.id, draft || undefined)} className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{draft ? "Edit & send" : "Retry"}</button><button disabled={mutating} onClick={() => onDismiss(item.id)} className="whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Dismiss</button></div> : <span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span>}
        </div>;
      }) : <p className="my-5 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No campaign activity has been captured for this view.</p>}
    </div>}
  </Surface>;
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
