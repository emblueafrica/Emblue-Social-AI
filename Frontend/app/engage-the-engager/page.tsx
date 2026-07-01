"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, ExternalLink, MoreVertical, Plus, RefreshCw, X as XClose } from "lucide-react";
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
  locationCountry: "",
  locationPlace: "",
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
    locationCountry: String(record.mode_config?.location_country ?? ""),
    locationPlace: String(record.mode_config?.location_place ?? ""),
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

function activitySortRank(status: string) {
  const normalized = status.toLowerCase();
  if (
    normalized === "sent" ||
    normalized === "dismissed" ||
    normalized === "already_sent" ||
    normalized.startsWith("ignored")
  ) {
    return 1;
  }
  return 0;
}

export default function EngageTheEngager() {
  const queryClient = useQueryClient();
  const { activeBrandId, authContext } = useAuth();
  const [selectedMode, setSelectedMode] = useState<"post_url" | "keyword">("post_url");
  const [posts, setPosts] = useState<PostRow[]>([{ id: nextId++, platform: "instagram", url: "" }]);
  const [allocation, setAllocation] = useState({ instagram: 50, facebook: 30, tiktok: 20, x: 0 });
  const [postTemplate, setPostTemplate] = useState("");
  const [postCtaLink, setPostCtaLink] = useState("");
  const [postUrlPreviewCampaignId, setPostUrlPreviewCampaignId] = useState<number | null>(null);
  const [postUrlPreview, setPostUrlPreview] = useState<PostUrlPreviewResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<CampaignDraft | null>(null);
  const [activityCampaignId, setActivityCampaignId] = useState<number | null>(null);
  const [activityStatusFilter, setActivityStatusFilter] = useState<string | null>(null);
  const [openCampaignMenuId, setOpenCampaignMenuId] = useState<number | null>(null);
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
    queryKey: ["campaign-activity", activeBrandId, activityCampaignId, selectedMode, activityStatusFilter],
    queryFn: () => getCampaignActivity({
      brandId: activeBrandId!,
      campaignId: activityCampaignId ?? undefined,
      mode: selectedMode,
      status: activityStatusFilter ?? undefined,
      limit: 100,
    }),
    enabled: Boolean(activeBrandId),
    retry: false,
    refetchInterval: 15000,
  });
  const activityRefreshing = activityQuery.isFetching && !activityQuery.isLoading;

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
  const existingPostAllocationPlatforms = ["instagram", "facebook", "tiktok", "x"] as Platform[];
  const existingPostAllocation = {
    instagram: allocation.instagram,
    facebook: allocation.facebook,
    tiktok: allocation.tiktok,
    x: allocation.x,
  };
  const canMutate = Boolean(
    authContext?.platform_role === "super_admin" ||
    authContext?.platform_role === "platform_admin" ||
    authContext?.active_brand?.role === "client_owner",
  );
  const runningCount = campaigns.filter((campaign) => campaign.state === "running").length;
  const pausedCount = campaigns.filter((campaign) => campaign.state === "paused").length;
  const activityItems = activityQuery.data?.items ?? [];
  const todayKey = new Date().toDateString();
  const sentToday = activityItems.reduce((sum, item) => (
    sum + item.deliveries.filter((delivery) => delivery.status === "sent" && delivery.delivered_at && new Date(delivery.delivered_at).toDateString() === todayKey).length
  ), 0);
  const queuedForReview = activityItems.filter((item) => (
    item.status === "needs_review" ||
    item.deliveries.some((delivery) => ["queued", "processing", "rate_limited", "failed"].includes(delivery.status))
  )).length;
  const manualCopyCount = activityItems.filter((item) => item.deliveries.some((delivery) => delivery.status === "manual_action_required" || delivery.status === "manual_copy")).length;
  const allocationTotal = existingPostAllocationPlatforms.reduce((sum, platform) => sum + allocation[platform], 0);

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
      location_country: campaign.locationCountry,
      location_place: campaign.locationPlace,
    },
    selected_posts:
      campaign.sourceMode === "existing" ||
      (campaign.sourceMode === "live" && campaign.liveScope === "selected_posts")
        ? campaign.platforms
            .map(platform => ({ platform, url: campaign.existingPosts[platform] ?? "" }))
            .filter(post => post.url.trim())
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
      if (status === "active" && campaign.sourceMode === "existing") {
        const hasPostUrl = campaign.platforms.some((platform) => campaign.existingPosts[platform]?.trim());
        if (!hasPostUrl) {
          throw new Error("Add at least one social post URL before activating a Post URL campaign.");
        }
      }
      if (campaign.sourceMode === "keyword") {
        const preflight = status === "active"
          ? await preflightKeywordCampaign(activeBrandId, campaign.platforms, {
              keywords: campaign.keywords,
              public_reply_enabled: campaign.publicReplyEnabled,
              direct_message_enabled: campaign.directMessageEnabled,
            })
          : null;
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
            location_country: campaign.locationCountry,
            location_place: campaign.locationPlace,
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

  const handleRefreshActivityFeed = async () => {
    try {
      if (activityCampaignId) {
        await handleSyncCampaign(activityCampaignId);
        return;
      }
      await activityQuery.refetch();
      setToast("Live activity feed refreshed.");
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const handleRetryEngagement = async (engagerId: number, replyText?: string) => {
    if (!activeBrandId) return;
    try {
      const result = await campaignRetryMutation.mutateAsync({ engagerId, replyText });
      await activityQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
      setActivityDrafts(current => {
        const next = { ...current };
        delete next[String(engagerId)];
        return next;
      });
      setToast(result.status === "sent" ? "Campaign reply sent." : `Campaign reply status: ${result.status.replaceAll("_", " ")}.`);
      if (result.error) setApiNotice(result.error);
    } catch (error) { setApiNotice(apiErrorMessage(error)); }
  };

  const handleDismissEngagement = async (engagerId: number) => {
    if (!activeBrandId) return;
    try {
      await campaignDismissMutation.mutateAsync({ engagerId });
      await activityQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["campaigns", activeBrandId] });
      setActivityDrafts(current => {
        const next = { ...current };
        delete next[String(engagerId)];
        return next;
      });
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
        platform_allocation: existingPostAllocation,
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
            canMutate ? <button onClick={() => {
              setEditingId(null);
              setEditingDraft(null);
              setModalOpen(true);
            }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90">
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

        <main className="flex-1 space-y-7 p-6 md:p-8 max-w-[1200px] w-full mx-auto text-safe layout-safe">
          {apiNotice && <Notice>{apiNotice}</Notice>}
          {campaignsQuery.isLoading && <Surface>Loading campaigns...</Surface>}
          {campaignsQuery.error && <Notice>{apiErrorMessage(campaignsQuery.error)}</Notice>}

          <div className="flex flex-wrap gap-2">
            {[
              { value: "post_url" as const, label: "Post URL Campaign" },
              { value: "keyword" as const, label: "Keyword Campaign" },
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => {
                  setSelectedMode(mode.value);
                  setActivityCampaignId(null);
                  setActivityStatusFilter(null);
                  setOpenCampaignMenuId(null);
                }}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  selectedMode === mode.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <InfoCard title="User Comments" body="Someone engages with your post on Instagram, Facebook, or X. The system detects every comment and like within minutes, automatically - 24/7, no monitoring needed." />
            <InfoCard title="AI Personalises" body="AI writes a unique reply using their @handle, your brand voice, campaign message, and a tracked CTA link. No two replies are ever identical." />
            <InfoCard title="Fires Instantly" body="IG/FB -> personal DM with branded image + tracked link. X -> thread reply with image embed. All within seconds, zero human intervention required." />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi color="bg-primary" label="Active Campaigns" value={String(runningCount)} sub="Running now" onClick={() => setActivityStatusFilter(null)} active={!activityStatusFilter} />
            <Kpi color="bg-brand-pink" label="Sent Today" value={String(sentToday)} sub="Across all platforms" onClick={() => setActivityStatusFilter("sent")} active={activityStatusFilter === "sent"} />
            <Kpi color="bg-brand-olive" label="Queued for Review" value={String(queuedForReview)} sub="Needs review or retry" onClick={() => setActivityStatusFilter("needs_review")} active={activityStatusFilter === "needs_review"} />
            <Kpi color="bg-neutral-600" label="Manual Copy" value={String(manualCopyCount)} sub="Manual-send records" onClick={() => setActivityStatusFilter("manual_action_required")} active={activityStatusFilter === "manual_action_required"} />
          </div>

          <Surface>
            <div className="flex items-center justify-between pb-4 border-b">
              <div>
                <h2 className="text-lg font-bold">Active Campaigns</h2>
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
                        <span className={`size-2 rounded-full ${campaign.state === "running" ? "bg-emerald-500" : "bg-slate-300"}`} />
                        <h3 className="font-semibold">{campaign.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 text-safe">{campaign.meta}</p>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        {campaign.platforms.map((platform) => (
                          <PlatformLogo key={`${campaign.id}-${platform}`} platform={platform} size={18} />
                        ))}
                      </div>
                      <span className="mx-2 whitespace-nowrap text-xs font-semibold">{campaign.stat}</span>
                      {canMutate && <button onClick={() => void handleEditCampaign(campaign)} className="shrink-0 whitespace-nowrap rounded-lg bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/15">Edit</button>}
                      {canMutate && <button onClick={() => void handleToggleCampaign(campaign.id, campaign.state)} className={`shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-semibold ${campaign.state === "paused" ? "border-emerald-500 text-emerald-600" : "border-red-500 text-red-500"}`}>
                        {campaign.state === "paused" ? "Resume" : "Pause"}
                      </button>}
                      <div className="relative">
                        <button
                          onClick={() => setOpenCampaignMenuId((current) => current === campaign.id ? null : campaign.id)}
                          className="shrink-0 rounded-lg px-2 py-2 text-muted-foreground hover:bg-muted"
                          title="Campaign actions"
                        >
                          <MoreVertical className="size-4 shrink-0" />
                        </button>
                        {openCampaignMenuId === campaign.id && (
                          <div className="absolute right-0 top-10 z-20 w-40 rounded-xl border bg-card p-1 text-sm shadow-lg">
                            {canMutate && (
                              <button
                                onClick={() => {
                                  setOpenCampaignMenuId(null);
                                  void handleEditCampaign(campaign);
                                }}
                                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-muted"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setOpenCampaignMenuId(null);
                                setActivityCampaignId((current) => current === campaign.id ? null : campaign.id);
                              }}
                              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-muted"
                            >
                              View Activity
                            </button>
                            {canMutate && (
                              <button
                                onClick={() => {
                                  setOpenCampaignMenuId(null);
                                  setConfirmDeleteId(campaign.id);
                                }}
                                className="block w-full rounded-lg px-3 py-2 text-left text-destructive hover:bg-destructive/10"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-12 text-sm text-muted-foreground">No backend campaigns found for this brand yet.</div>
            )}

          </Surface>

          <Surface>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold">Message Everyone on Existing Posts</h2>
              </div>
              <p className="hidden text-sm text-muted-foreground md:block">Retroactively engage everyone who liked or commented</p>
            </div>

            <div className="space-y-4">
              {posts.map((post) => (
                <div key={post.id} className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_auto_auto_auto]">
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
                  <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground"><input type="checkbox" defaultChecked={post.platform !== "tiktok"} />Comments</label>
                  <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground"><input type="checkbox" defaultChecked />Likes</label>
                  <button onClick={() => setPosts((current) => current.length > 1 ? current.filter((row) => row.id !== post.id) : current)} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted">...</button>
                </div>
              ))}
            </div>

            <button onClick={() => setPosts((current) => [...current, { id: nextId++, platform: "instagram", url: "" }])} className="mt-4 rounded-lg px-1 py-1 text-sm font-semibold text-primary hover:bg-primary/5">
              + Add Another Post
            </button>

            <div className={`mt-6 rounded-xl p-5 ${allocationTotal === 100 ? "bg-muted/30" : "bg-red-50"}`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Platform Send Allocation</h3>
                <span className={`text-sm font-semibold ${allocationTotal === 100 ? "text-emerald-600" : "text-destructive"}`}>
                  {allocationTotal}% {allocationTotal === 100 ? <span aria-hidden="true">&#10003;</span> : "must = 100%"}
                </span>
              </div>
              <div className="space-y-4">
                {existingPostAllocationPlatforms.map((platform) => (
                  <div key={platform} className="grid grid-cols-[120px_minmax(0,1fr)_52px] items-center gap-4">
                    <span className="flex items-center gap-2 text-sm capitalize"><PlatformLogo platform={platform} size={18} />{platform === "x" ? "X" : platform}</span>
                    <input type="range" min={0} max={100} value={allocation[platform]} onChange={(event) => setAllocation((current) => ({ ...current, [platform]: Number(event.target.value) }))} className="accent-primary" />
                    <span className={`text-right text-sm font-bold ${platform === "instagram" ? "text-pink-700" : platform === "facebook" ? "text-primary" : "text-muted-foreground"}`}>{allocation[platform]}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Controls % of engagers per platform who receive the message.</p>
            </div>

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

            <div className="mt-6">
              <button onClick={() => void handleFetchPostUrlPreview()} disabled={fetchPostUrlMutation.isPending || saveCampaignMutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {fetchPostUrlMutation.isPending || saveCampaignMutation.isPending ? "Fetching..." : <><CheckCircle2 className="size-4" /> Fetch & Message all Engagers</>}
              </button>
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
                            <span className="min-w-0 truncate font-semibold">{item.platform.toUpperCase()} - {item.url}</span>
                            <span className="text-muted-foreground">{item.status} - {item.total_fetched} fetched</span>
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
                            <span>{item.author_handle || "unknown"} - {item.action}</span>
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
          </Surface>

          <UnifiedActivityFeed
            data={activityQuery.data}
            loading={activityQuery.isLoading}
            error={activityQuery.error}
            canMutate={canMutate}
            selectedCampaignId={activityCampaignId}
            syncing={campaignSyncMutation.isPending || activityRefreshing}
            mutating={campaignRetryMutation.isPending || campaignDismissMutation.isPending}
            drafts={activityDrafts}
            onDraftChange={(id, value) => setActivityDrafts(current => ({ ...current, [id]: value }))}
            onSync={() => void handleRefreshActivityFeed()}
            onRetry={(id, reply) => void handleRetryEngagement(id, reply)}
            onDismiss={(id) => void handleDismissEngagement(id)}
            onExport={async () => {
              if (!activeBrandId) return;
              const blob = await downloadCampaignActivityCsv(activeBrandId, { mode: selectedMode, status: activityStatusFilter ?? undefined });
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
          initialMode={selectedMode === "keyword" ? "keyword" : "existing"}
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
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="relative flex w-full max-w-[680px] flex-col items-center rounded-[24px] bg-white px-8 py-20 shadow-2xl">
              <button onClick={() => setConfirmDeleteId(null)} className="absolute right-7 top-7 rounded-lg p-2 hover:bg-muted" title="Close">
                <XClose className="size-8" />
              </button>
              <h3 className="max-w-md text-center text-3xl font-bold leading-tight">Are you sure you want to delete this Campaign?</h3>
              <div className="mt-12 grid w-full max-w-[420px] gap-6">
                <button onClick={() => setConfirmDeleteId(null)} className="rounded-xl border-2 border-primary px-8 py-3.5 text-base font-semibold text-primary hover:bg-primary/5">No, Cancel</button>
                <button onClick={() => void handleDeleteConfirmed()} className="rounded-xl bg-destructive px-8 py-3.5 text-base font-semibold text-white hover:opacity-90 disabled:opacity-60" disabled={deleteCampaignMutation.isPending}>
                  {deleteCampaignMutation.isPending ? "Deleting..." : "Yes, Delete Campaign"}
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

function SourcePostLink({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
    >
      <ExternalLink className="size-3.5" /> Open post
    </a>
  );
}

function CopyReplyButton({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text)}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
    >
      <Copy className="size-3.5" /> Copy reply
    </button>
  );
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
            <div className="min-w-0"><p className="truncate text-sm font-medium">{item.author_handle || "Unknown"}</p><p className="text-xs capitalize text-muted-foreground">{item.platform} - {item.action}</p>{item.intent && <p className="mt-1 text-xs text-muted-foreground">{item.intent.replaceAll("_", " ")} - urgency {item.urgency_score ?? "-"} - confidence {item.reply_confidence ?? "-"}%</p>}</div>
            <span className="h-fit w-fit whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize">{(item.status || "pending").replaceAll("_", " ")}</span>
            <div className="min-w-0"><p className="break-words text-sm">{item.original_text || "No message text"}</p><div className="mt-2 flex flex-wrap gap-2"><SourcePostLink url={item.source_url} /><CopyReplyButton text={draft} /></div>{item.delivery_error && <p className="mt-1 break-words text-xs text-destructive">{item.delivery_error}</p>}{item.deliveries.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{item.deliveries.map(delivery => <span key={delivery.channel} title={delivery.error ?? undefined} className="whitespace-nowrap rounded-full border px-2 py-1 text-xs capitalize">{delivery.channel.replaceAll("_", " ")}: {delivery.status.replaceAll("_", " ")}</span>)}</div>}{actionable && <textarea value={draft} onChange={event => onDraftChange(item.id, event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border bg-background p-2 text-sm" placeholder="Edit the reply before retrying" />}</div>
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
  const pageSize = 5;
  const [page, setPage] = useState(0);
  const sortedItems = useMemo(() => {
    return [...(data?.items ?? [])].sort((a, b) => {
      const rank = activitySortRank(a.status) - activitySortRank(b.status);
      if (rank !== 0) return rank;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data?.items]);
  const totalItems = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedItems = sortedItems.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  useEffect(() => {
    setPage(0);
  }, [data?.items.length, selectedCampaignId]);

  return <Surface>
    <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-lg font-bold">Live Activity Feed</h2></div>
      <div className="flex flex-wrap gap-2">
        <span className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-emerald-600"><span className="size-2 rounded-full bg-emerald-500" />Updating Live</span>
        <button onClick={() => void onExport()} className="shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Export CSV</button>
        {canMutate && <button onClick={onSync} disabled={syncing} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing..." : selectedCampaignId ? "Sync now" : "Refresh feed"}</button>}
      </div>
    </div>
    {loading && <p className="py-6 text-sm text-muted-foreground">Loading activity...</p>}
    {Boolean(error) && <p className="py-4 text-sm text-destructive">{apiErrorMessage(error)}</p>}
    {data && <div className="divide-y">
      {pagedItems.length ? pagedItems.map(item => {
        const actionable = ["needs_review", "partial", "failed", "error", "generation_failed", "rate_limited", "manual_action_required", "manual_copy", "bot_blocked"].includes(item.status);
        const draft = drafts[String(item.id)] ?? item.reply_text ?? "";
        return <div key={item.id} className="grid min-w-0 gap-3 py-4 lg:grid-cols-[180px_120px_minmax(0,1fr)_170px]">
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.campaign_name}</p><p className="truncate text-xs text-muted-foreground">{item.author_handle || "Unknown"}</p><p className="text-xs capitalize text-muted-foreground">{item.platform} - {item.action}</p></div>
          <span className="h-fit w-fit whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize">{item.status.replaceAll("_", " ")}</span>
          <div className="min-w-0"><p className="break-words text-sm">{item.original_text || "No message text"}</p><div className="mt-2 flex flex-wrap gap-2"><SourcePostLink url={item.source_url} /><CopyReplyButton text={draft} /></div>{item.error && <p className="mt-1 break-words text-xs text-destructive">{item.error}</p>}<div className="mt-2 flex flex-wrap gap-2">{item.deliveries.map(delivery => <span key={`${item.id}-${delivery.channel}`} className="whitespace-nowrap rounded-full border px-2 py-1 text-xs capitalize">{delivery.channel.replaceAll("_", " ")}: {delivery.status.replaceAll("_", " ")}</span>)}</div>{canMutate && actionable && <textarea value={draft} onChange={event => onDraftChange(String(item.id), event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border bg-background p-2 text-sm" placeholder="Edit the reply before sending" />}</div>
          {canMutate && actionable ? <div className="flex flex-wrap items-start gap-2"><button disabled={mutating} onClick={() => onRetry(item.id, draft || undefined)} className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{draft ? "Edit & send" : "Retry"}</button><button disabled={mutating} onClick={() => onDismiss(item.id)} className="whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Dismiss</button></div> : <span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span>}
        </div>;
      }) : <p className="my-5 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No campaign activity has been captured for this view.</p>}
      {totalItems > pageSize && (
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, totalItems)} of {totalItems}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(value => Math.max(0, value - 1))}
              disabled={currentPage === 0}
              className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(value => Math.min(totalPages - 1, value + 1))}
              disabled={currentPage >= totalPages - 1}
              className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
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

function Kpi({
  color,
  label,
  value,
  sub,
  onClick,
  active,
}: {
  color: string;
  label: string;
  value: string;
  sub: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <>
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className="text-xs mt-2 text-muted-foreground">{sub}</p>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`relative w-full overflow-hidden rounded-2xl bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${active ? "ring-2 ring-primary/40" : ""}`}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      {content}
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
