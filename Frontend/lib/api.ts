import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";

export class ApiError extends Error {
  status: number;
  toolId?: string;
  upgradeUrl?: string;

  constructor({
    status,
    message,
    toolId,
    upgradeUrl,
  }: {
    status: number;
    message: string;
    toolId?: string;
    upgradeUrl?: string;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.toolId = toolId;
    this.upgradeUrl = upgradeUrl;
  }
}

export type BrandMembership = {
  brand_id: number;
  brand_name: string;
  brand_slug: string;
  account_type: string;
  role: string;
};

export type AuthMeResponse = {
  user: {
    id: string;
    email: string | null;
    app_role: string;
    status: string;
  };
  platform_role: string | null;
  brand_memberships: BrandMembership[];
  active_brand: {
    brand_id: number;
    account_type: string;
    name: string;
    slug: string;
    role: string;
    managed_by_user_id?: string | null;
    managed_by?: {
      user_id: string;
      email: string;
      full_name?: string | null;
    } | null;
  } | null;
  pending_signup_status: string | null;
};

export type DashboardSummary = {
  total_messages: number;
  replies_sent: number;
  listening_kpi: number | null;
  reply_kpi: number | null;
  funnel_kpi: number | null;
};

export type CampaignStatsResponse = {
  stats: {
    platform: string;
    total: number;
    sent: number;
    manual: number;
    queued: number;
  }[];
  summary?: {
    total_messages: number;
    replies_sent: number;
    manual_reviews: number;
    queued: number;
    listening_score: number | null;
    reply_score: number | null;
    funnel_score: number | null;
    risk_events: number;
    avg_response_time_minutes: number | null;
    revenue_attributed: number | null;
  };
  score_trend?: { d: string; listening: number | null; reply: number | null; funnel: number | null }[];
  message_volume?: { d: string; classified: number; total: number }[];
  sentiment?: { d: string; pos: number; neu: number; neg: number }[];
  risk_events?: {
    time: string;
    platform: string;
    tag: string;
    severity: string;
    text: string;
    sentiment: string | null;
    urgency_score: number | null;
    topics: string[];
  }[];
  attribution?: {
    clicks: number;
    conversions: number;
    revenue: number | null;
  };
};

export type ToolAccessResponse = {
  enabled: string[];
  account_type?: string;
  plan?: string | null;
  plans?: ToolPlan[];
  tools?: ToolAccessTool[];
  brand?: {
    brand_id: number;
    name: string;
    slug: string;
    managed_by_user_id?: string | null;
    managed_by?: {
      user_id: string;
      email: string;
      full_name?: string | null;
    } | null;
  };
};

export type ToolAccessTool = {
  id: string;
  name: string;
  route_group: string;
  dependencies: string[];
  enabled: boolean;
};

export type ToolPlan = {
  id: "starter" | "growth" | "enterprise";
  name: string;
  description: string;
  tool_ids: string[];
};

export type AdminUser = {
  user_id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  status: string;
  platform_roles: string[];
  brand_memberships: { brand_id: number; role: string }[];
  created_at: string;
  updated_at: string;
};

export type SignupRequest = {
  request_id: number;
  user_id: string;
  email: string;
  contact_name: string;
  company_name: string;
  requested_plan?: string | null;
  requested_account_type: "b2b_licensed" | "b2c_managed" | "internal";
  status: "pending" | "approved" | "rejected";
  brand_id?: number | null;
  created_at: string;
};

export type AdminBrand = {
  brand_id: number;
  name: string;
  slug: string;
  account_type: "b2b_licensed" | "b2c_managed" | "internal";
  campaign_objective?: string | null;
  tone?: string | null;
  owner_user_id?: string | null;
  managed_by_user_id?: string | null;
  managed_by?: {
    user_id: string;
    email: string;
    full_name?: string | null;
  } | null;
  members: { user_id: string; role: string }[];
  enabled_tools: string[];
  plan: string | null;
  connection_status?: {
    meta: {
      connected: boolean;
      facebook_connected: boolean;
      instagram_connected: boolean;
      account_handle?: string | null;
      diagnostics: string[];
    };
    x: {
      connected: boolean;
      account_handle?: string | null;
      refreshable: boolean;
      diagnostics: string[];
    };
  };
  created_at: string;
  updated_at: string;
};

export type AuditLog = {
  audit_id: number;
  actor_user_id?: string | null;
  actor_platform_role?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  brand_id?: number | null;
  target_user_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ClientSummary = {
  brand: {
    brand_id: number;
    name: string;
    slug: string;
    account_type: string;
    campaign_objective?: string | null;
  };
  period_days: number;
  summary: {
    total_messages: number;
    replies_sent: number;
    engagements: number;
    pending_approvals: number;
    listening_kpi: number | null;
    reply_kpi: number | null;
    funnel_kpi: number | null;
    risk_events: number;
  };
  kpis: unknown[];
  alerts: unknown[];
  campaign_metrics: {
    campaign?: string | null;
    platform?: string | null;
    metric: string;
    value: number | null;
    created_at: string;
  }[];
  campaigns: {
    campaign_id: number;
    name: string;
    platform?: string | null;
    is_active?: boolean | null;
    total_sent?: number | null;
    updated_at: string;
  }[];
  updated_at: string;
};

export type ClientInsights = {
  brand: {
    brand_id: number;
    name: string;
    account_type: string;
  };
  audience: {
    positive_sentiment_pct: number | null;
    purchase_intent_pct: number | null;
    questions_count: number;
    summary?: string | null;
    messages_processed: number;
    last_run_at?: string | null;
    faqs: {
      faq_id: number;
      question: string;
      frequency?: number | null;
      platforms: string[];
      created_at: string;
    }[];
    pain_points: {
      pain_point_id: number;
      text: string;
      severity?: string | null;
      frequency?: number | null;
      created_at: string;
    }[];
  };
  templates: {
    template_id: number;
    name: string;
    platform?: string | null;
    trigger_keywords: string[];
    template_text?: string | null;
    is_active?: boolean | null;
    use_count?: number | null;
    updated_at: string;
  }[];
  connections: ConnectionRecord[];
  updated_at: string;
};

export type ConnectionRecord = {
  platform: string;
  account_handle?: string | null;
  is_active: boolean;
  connected_at: string;
};

export type Platform = "instagram" | "facebook" | "tiktok" | "x";

export type PlatformAllocation = {
  instagram?: number;
  facebook?: number;
  tiktok?: number;
  x?: number;
};

export type CampaignRecord = {
  id: number;
  campaign_id: number;
  brand_id: number;
  name: string;
  platform?: Platform;
  mode?: "live" | "post_url" | "keyword";
  platforms?: Platform[];
  priority?: number;
  scope_type?: "all_owned_posts" | "selected_posts";
  reply_mode?: "public" | "dm_with_public_fallback" | "dm_only";
  post_ids: string[];
  keywords: string[];
  engage_all?: boolean;
  engage_negative?: boolean;
  tone?: string;
  reply_template?: string;
  fallback_template?: string;
  cta_link?: string;
  image_url?: string;
  tracked_link_code?: string;
  auto_fire_threshold?: number;
  max_per_hour?: number;
  is_active?: boolean;
  total_sent?: number;
  platform_allocation?: PlatformAllocation;
  include_likers?: boolean;
  include_commenters?: boolean;
  source_mode?: "publish_new" | "existing" | "keyword";
  intent_filter?: string[];
  urgency_threshold?: number;
  reply_template_id?: number | null;
  max_per_day?: number;
  max_dm_per_day?: number;
  spacing_minutes?: number;
  mode_config?: Record<string, unknown>;
  selected_posts?: { platform: Platform; url: string }[];
  preview_fetched_at?: string | null;
  preview_expires_at?: string | null;
  public_reply_enabled?: boolean;
  direct_message_enabled?: boolean;
  post_caption?: string;
  public_reply_template?: string;
  private_followup_template?: string;
  event_settings?: CampaignEventSettings;
  activation_status?: string;
  last_activated_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CampaignPayload = {
  campaign_id?: number;
  brand_id: number;
  name: string;
  platform: Platform;
  mode?: "live" | "post_url" | "keyword";
  platforms?: Platform[];
  priority?: number;
  scope_type?: "all_owned_posts" | "selected_posts";
  reply_mode?: "public" | "dm_with_public_fallback" | "dm_only";
  keywords?: string[];
  tone?: string;
  reply_template?: string;
  cta_link?: string;
  image_url?: string;
  auto_fire_threshold?: number;
  max_per_hour?: number;
  max_per_day?: number;
  max_dm_per_day?: number;
  spacing_minutes?: number;
  mode_config?: Record<string, unknown>;
  selected_posts?: { platform: Platform; url: string }[];
  is_active?: boolean;
  platform_allocation?: PlatformAllocation;
  source_mode?: "publish_new" | "existing" | "keyword";
  post_caption?: string;
  public_reply_template?: string;
  private_followup_template?: string;
  event_settings?: CampaignEventSettings;
  activation_status?: string;
};

export type CampaignEventSettings = {
  comments: boolean;
  likes: boolean;
  reposts: boolean;
  mentions: boolean;
  dms: boolean;
};

export type CampaignMedia = {
  url: string;
  public_id: string;
  media_type: "image" | "video";
  mime_type: string;
  size_bytes: number;
};

export type QueueAttachmentPayload = {
  image_url?: string;
  media?: CampaignMedia[];
};

export type CampaignActivationPayload = {
  brand_id: number;
  source_mode: "publish_new" | "existing";
  platforms: Platform[];
  existing_posts?: { platform: Platform; url: string }[];
  allocation: PlatformAllocation;
  media?: CampaignMedia[];
  post_caption?: string;
};

export type CampaignActivationResult = {
  ok: boolean;
  campaign_id: number;
  activation_status: "active" | "partial" | "failed";
  platforms: { platform: Platform; success: boolean; post_url?: string; post_id?: string; warning?: string; error?: string }[];
};

export type CampaignStatusResponse = {
  campaign: CampaignRecord;
  bindings: { platform: Platform; post_url: string; post_id?: string | null; status?: string | null; source_mode?: string; error?: string | null }[];
  media: CampaignMedia[];
};

export type CampaignEngagementResponse = {
  campaign_id: number;
  summary: { captured: number; comments: number; likes: number; reposts: number; sent: number; queued: number; manual: number; failed: number; ignored: number };
  platform_capabilities: Record<Platform, string>;
  bindings: { platform: Platform; url: string; status?: string | null; total_fetched: number; error?: string | null; last_synced_at?: string | null }[];
  engagers: { id: string; platform: Platform; action: string; author_handle?: string | null; original_text?: string | null; reply_text?: string | null; delivery_error?: string | null; external_event_id: string; source: string; intent?: string | null; urgency_score?: number | null; reply_confidence?: number | null; status?: string | null; created_at: string; processed_at?: string | null; deliveries: { channel: string; status: string; external_message_id?: string | null; error?: string | null; attempt_count: number; delivered_at?: string | null }[] }[];
};

export type CampaignActivityItem = {
  id: number;
  campaign_id: number;
  campaign_name: string;
  mode: "live" | "post_url" | "keyword";
  platform: Platform;
  action: string;
  author_handle?: string | null;
  original_text?: string | null;
  reply_text?: string | null;
  status: string;
  confidence?: number | null;
  error?: string | null;
  created_at: string;
  deliveries: { channel: string; status: string; error?: string | null; delivered_at?: string | null }[];
};

export type CampaignActivityResponse = {
  items: CampaignActivityItem[];
  next_cursor: number | null;
};

export type PostUrlPreviewResponse = {
  campaign_id: number;
  counts: { total: number; commenters: number; likers: number; selected: number; review: number; ignored: number };
  by_platform: Record<string, { total: number; selected: number }>;
  errors: string[];
  fetched_at: string;
  expires_at: string;
};

export type KeywordCampaignPayload = {
  brand_id: number;
  campaign_id?: number;
  name: string;
  keywords: string[];
  platforms: Platform[];
  intent_filter: string[];
  confidence_threshold: number;
  urgency_threshold: number;
  reply_template_id?: number | null;
  max_per_day: number;
  max_dm_per_day?: number;
  spacing_minutes?: number;
  priority?: number;
  reply_mode?: "public" | "dm_with_public_fallback" | "dm_only";
  mode_config?: Record<string, unknown>;
  public_reply_enabled: boolean;
  direct_message_enabled: boolean;
  tone?: string;
  public_reply_template?: string;
  private_followup_template?: string;
  cta_link?: string;
  image_url?: string;
  status: "draft" | "active";
};

export type CampaignChannelStatus = "automatic" | "setup_required" | "connection_required";
export type CampaignCapability = {
  platform: Platform;
  keyword_discovery: CampaignChannelStatus;
  public_reply: CampaignChannelStatus;
  direct_message: CampaignChannelStatus;
  issues: string[];
};

export type PostUrlCampaignPayload = {
  brand_id: number;
  campaign_id?: string;
  post_urls: { platform: Platform; url: string }[];
  platform_allocation?: PlatformAllocation;
  tone?: string;
  reply_template?: string;
  cta_link?: string;
  image_url?: string;
  auto_fire_threshold?: number;
  max_per_hour?: number;
};

export type XCampaignPreflightResponse = {
  ok: boolean;
  connected: boolean;
  account_handle?: string | null;
  refreshable: boolean;
  scopes: {
    tweet_read: boolean;
    tweet_write: boolean;
    users_read: boolean;
    media_write: boolean;
    offline_access: boolean;
  };
  recent_search: {
    checked: boolean;
    ok: boolean;
    engager_count?: number;
    error?: string;
  };
  diagnostics: string[];
};

export type XReplySyncResponse = {
  ok: true;
  tweet_id: string;
  fetched: number;
  captured: number;
  queued: number;
  duplicates: number;
  message: string;
};

export type PostUrlCampaignStatus = {
  campaign_id: string;
  summary: {
    post_urls: number;
    fetched: number;
    engagers: number;
    sent: number;
    manual: number;
    queued: number;
    errors: number;
    complete: boolean;
  };
  post_urls: {
    platform: Platform;
    url: string;
    status?: string | null;
    total_fetched: number;
    error?: string | null;
    submitted_at: string;
    completed_at?: string | null;
  }[];
  engagers: {
    platform: Platform;
    action: string;
    author_handle?: string | null;
    status?: string | null;
    created_at: string;
    processed_at?: string | null;
  }[];
};

export type ApprovalQueueItem = {
  queue_key?: string;
  queue_id?: number;
  brand_id: number;
  campaign_id?: number | null;
  campaign_name?: string | null;
  source?: "approval" | "campaign";
  channel?: "public_reply" | "direct_message" | null;
  status?: string | null;
  platform: Platform;
  author: string;
  original: string;
  reply: string;
  image_url?: string | null;
  tracked_link?: string | null;
  delivery_error?: string | null;
  meta?: {
    comment_id?: string | null;
    post_id?: string | null;
    tweet_id?: string | null;
    author_id?: string | null;
  };
  manual_copy_required?: boolean;
  manual_copy_instructions?: string | Record<string, string>;
};

export type KeywordGroup = {
  group_id: number;
  brand_id: number;
  name: string;
  keywords: string[];
  platforms: string[];
  mode: string;
  is_active?: boolean | null;
  created_at: string;
  last_run_at?: string | null;
};

export type FunnelRecord = {
  funnel_id: number;
  brand_id?: number | null;
  name?: string | null;
  platform?: string | null;
  keywords: string[];
  trigger_actions: string[];
  max_per_hour?: number | null;
  delay_sec?: number | null;
  dest_url?: string | null;
  is_active?: boolean | null;
  created_at: string;
};

export type ListeningRun = {
  run_id: number;
  brand_id: number;
  group_id?: number | null;
  status: string;
  mode: string;
  keywords: string[];
  platforms: string[];
  result_count?: number | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type ListeningFeedItem = {
  result_id: number;
  platform: string;
  author_handle?: string | null;
  text?: string | null;
  url?: string | null;
  sentiment?: string | null;
  intent?: string | null;
  urgency_score?: number | null;
  matched_keyword?: string | null;
  created_at: string;
};

export type TrackedLinkRecord = {
  link_id: number;
  brand_id?: number | null;
  short_code: string;
  tracked_url: string;
  dest_url: string;
  campaign?: string | null;
  platform?: Platform | null;
  content_type?: string | null;
  clicks: number;
  conversions: number;
  created_at: string;
};

export type ToolActionResult = Record<string, unknown>;
export type ToolSummaryResponse = Record<string, unknown>;

export type AttributionLinkPayload = {
  brand_id: number;
  dest_url: string;
  platform: Platform;
  campaign?: string;
  content_type?: string;
};

export type CreativeScorePayload = {
  brand_id: number;
  platform: Platform;
  caption: string;
  format?: string;
  objective?: string;
};

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError({ status: 401, message: error.message });
  const token = data.session?.access_token;
  if (!token) throw new ApiError({ status: 401, message: "Please log in again." });
  return token;
}

async function parseError(response: Response) {
  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return new ApiError({
    status: response.status,
    message:
      String(body.message ?? body.error ?? response.statusText) ||
      "Request failed.",
    toolId: typeof body.tool_id === "string" ? body.tool_id : undefined,
    upgradeUrl: typeof body.upgrade_url === "string" ? body.upgrade_url : undefined,
  });
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!env.apiUrl) {
    throw new ApiError({
      status: 500,
      message: "NEXT_PUBLIC_API_URL is not configured.",
    });
  }

  const token = await getAccessToken();
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

async function apiUploadRequest<T>(path: string, body: FormData): Promise<T> {
  if (!env.apiUrl) throw new ApiError({ status: 500, message: "NEXT_PUBLIC_API_URL is not configured." });
  const token = await getAccessToken();
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

export function getAuthMe() {
  return apiRequest<AuthMeResponse>("/api/v1/auth/me");
}

export function getToolAccess() {
  return apiRequest<ToolAccessResponse>("/api/v1/tools/my-access");
}

export function getAdminPlans() {
  return apiRequest<{ plans: ToolPlan[] }>("/api/v1/admin/plans");
}

export function getAdminUsers() {
  return apiRequest<{ users: AdminUser[] }>("/api/v1/admin/users");
}

export function getAdminBrands() {
  return apiRequest<{ brands: AdminBrand[] }>("/api/v1/admin/brands");
}

export function getSignupRequests(status = "pending") {
  return apiRequest<{ requests: SignupRequest[] }>(`/api/v1/admin/signup-requests?status=${encodeURIComponent(status)}`);
}

export function getAuditLogs() {
  return apiRequest<{ audit_logs: AuditLog[] }>("/api/v1/admin/audit-logs?limit=50");
}

export function approveSignupRequest(
  requestId: number,
  payload: {
    account_type: "b2b_licensed" | "b2c_managed";
    plan_id: "starter" | "growth" | "enterprise";
    managed_by_user_id?: string | null;
  },
) {
  return apiRequest<{ ok: true; brand_id: number; managed_by_user_id?: string | null; enabled: string[] }>(
    `/api/v1/admin/signup-requests/${requestId}/approve`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function rejectSignupRequest(requestId: number, reason: string) {
  return apiRequest<{ ok: true }>(`/api/v1/admin/signup-requests/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function updateBrandAccess(
  brandId: number,
  payload: {
    account_type: "b2b_licensed" | "b2c_managed" | "internal";
    plan_id: "starter" | "growth" | "enterprise";
    managed_by_user_id?: string | null;
  },
) {
  return apiRequest<{ ok: true; brand_id: number; account_type: string; managed_by_user_id?: string | null; plan: string; enabled: string[] }>(
    `/api/v1/admin/brands/${brandId}/access`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}

export function suspendUser(userId: string) {
  return apiRequest<{ ok: true; user_id: string; status: string }>(`/api/v1/admin/users/${userId}/suspend`, {
    method: "POST",
  });
}

export function activateUser(userId: string) {
  return apiRequest<{ ok: true; user_id: string; status: string }>(`/api/v1/admin/users/${userId}/activate`, {
    method: "POST",
  });
}

export function getDashboardSummary(brandId: number) {
  return apiRequest<DashboardSummary>(`/api/v1/dashboard/summary?brand_id=${brandId}`);
}

export function getClientSummary(brandId: number) {
  return apiRequest<ClientSummary>(`/api/v1/dashboard/client-summary?brand_id=${brandId}`);
}

export function getClientInsights(brandId: number) {
  return apiRequest<ClientInsights>(`/api/v1/dashboard/client-insights?brand_id=${brandId}`);
}

export function getConnections(brandId: number) {
  return apiRequest<{ connections: ConnectionRecord[] }>(`/api/v1/auth/connections/${brandId}`);
}

export function getPlatformConnectUrl(platform: "meta" | "x" | "tiktok", brandId: number) {
  return apiRequest<{ url: string }>(
    `/api/v1/auth/${platform}/connect?brand_id=${brandId}&redirect=false`,
  );
}

export function disconnectPlatform(brandId: number, platform: "facebook" | "instagram" | "x" | "tiktok") {
  return apiRequest<{ ok: true }>(`/api/v1/auth/disconnect/${brandId}/${platform}`, {
    method: "DELETE",
  });
}

export function getCampaigns(brandId: number, mode?: "live" | "post_url" | "keyword") {
  const query = new URLSearchParams({ brand_id: String(brandId) });
  if (mode) query.set("mode", mode);
  return apiRequest<{ campaigns: CampaignRecord[] }>(`/api/v1/campaigns?${query.toString()}`);
}

export function getCampaignStats(brandId: number) {
  return apiRequest<CampaignStatsResponse>(`/api/v1/campaigns/${brandId}/stats`);
}

export function deleteCampaign(brandId: number, campaignId: number) {
  return apiRequest<{ ok: true; campaign_id: number }>(`/api/v1/campaigns/${campaignId}`, {
    method: "DELETE",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function saveCampaign(payload: CampaignPayload) {
  return apiRequest<{ ok: true; campaign: CampaignRecord }>("/api/v1/campaigns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCampaign(campaignId: number, payload: Partial<CampaignPayload> & { brand_id: number }) {
  return apiRequest<{ ok: true; campaign: CampaignRecord }>(`/api/v1/campaigns/${campaignId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function setCampaignState(brandId: number, campaignId: number, action: "pause" | "resume") {
  return apiRequest<{ ok: true; campaign_id: number; status: string }>(`/api/v1/campaigns/${campaignId}/${action}`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function getCampaignCapabilities(brandId: number, platforms: Platform[]) {
  const query = new URLSearchParams({ brand_id: String(brandId), platforms: platforms.join(",") });
  return apiRequest<{ capabilities: CampaignCapability[]; queue_available: boolean }>(`/api/v1/campaigns/capabilities?${query.toString()}`);
}

export function fetchPostUrlPreview(campaignId: number, brandId: number, postUrls: { platform: Platform; url: string }[]) {
  return apiRequest<PostUrlPreviewResponse>(`/api/v1/campaigns/${campaignId}/post-urls/fetch`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, post_urls: postUrls }),
  });
}

export function runPostUrlPreview(campaignId: number, brandId: number) {
  return apiRequest<{ ok: true; campaign_id: number; queued: number; review: number }>(`/api/v1/campaigns/${campaignId}/post-urls/run`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function getCampaignActivity(params: {
  brandId: number;
  mode?: "live" | "post_url" | "keyword";
  campaignId?: number;
  platform?: Platform;
  status?: string;
  cursor?: number;
  limit?: number;
}) {
  const query = new URLSearchParams({ brand_id: String(params.brandId), limit: String(params.limit ?? 25) });
  if (params.mode) query.set("mode", params.mode);
  if (params.campaignId) query.set("campaign_id", String(params.campaignId));
  if (params.platform) query.set("platform", params.platform);
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", String(params.cursor));
  return apiRequest<CampaignActivityResponse>(`/api/v1/campaigns/activity?${query.toString()}`);
}

export function actOnCampaignActivity(
  engagerId: number,
  action: "approve" | "edit-and-send" | "retry" | "dismiss",
  payload: { brand_id: number; reply_text?: string; channel?: "public_reply" | "direct_message" },
) {
  return apiRequest<{ ok: true; id: number; status: string; error?: string | null }>(`/api/v1/campaigns/activity/${engagerId}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function downloadCampaignActivityCsv(brandId: number, filters: { mode?: string; platform?: Platform; status?: string } = {}) {
  if (!env.apiUrl) throw new ApiError({ status: 500, message: "NEXT_PUBLIC_API_URL is not configured." });
  const query = new URLSearchParams({ brand_id: String(brandId), format: "csv", limit: "100" });
  if (filters.mode) query.set("mode", filters.mode);
  if (filters.platform) query.set("platform", filters.platform);
  if (filters.status) query.set("status", filters.status);
  const response = await fetch(`${env.apiUrl}/api/v1/campaigns/activity?${query.toString()}`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

export function saveKeywordCampaign(payload: KeywordCampaignPayload) {
  return apiRequest<{ ok: true; campaign: CampaignRecord; capabilities: CampaignCapability[] }>("/api/v1/campaigns/keyword", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function preflightKeywordCampaign(
  brandId: number,
  platforms: Platform[],
  options: { keywords?: string[]; public_reply_enabled?: boolean; direct_message_enabled?: boolean } = {},
) {
  return apiRequest<{ ok: true; capabilities: CampaignCapability[] }>("/api/v1/campaigns/keyword/preflight", {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, platforms, ...options }),
  });
}

export function uploadCampaignMedia(brandId: number, files: File[]) {
  const body = new FormData();
  body.append("brand_id", String(brandId));
  files.forEach((file) => body.append("files", file));
  return apiUploadRequest<{ ok: true; media: CampaignMedia[] }>("/api/v1/campaigns/media/upload", body);
}

export function uploadQueueMedia(brandId: number, files: File[]) {
  const body = new FormData();
  body.append("brand_id", String(brandId));
  files.forEach((file) => body.append("files", file));
  return apiUploadRequest<{ ok: true; media: CampaignMedia[] }>("/api/v1/rt/media/upload", body);
}

export function preflightCampaign(campaignId: number, payload: CampaignActivationPayload) {
  return apiRequest<{ ok: boolean; platforms: { platform: Platform; ready: boolean; issues: string[] }[] }>(`/api/v1/campaigns/${campaignId}/preflight`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function activateCampaign(campaignId: number, payload: CampaignActivationPayload) {
  return apiRequest<CampaignActivationResult>(`/api/v1/campaigns/${campaignId}/activate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCampaignStatus(campaignId: number, brandId: number) {
  return apiRequest<CampaignStatusResponse>(`/api/v1/campaigns/${campaignId}/status?brand_id=${brandId}`);
}

export function getCampaignEngagements(campaignId: number, brandId: number) {
  return apiRequest<CampaignEngagementResponse>(`/api/v1/campaigns/${campaignId}/engagements?brand_id=${brandId}`);
}

export function syncCampaignEngagements(campaignId: number, brandId: number) {
  return apiRequest<{ ok: true; campaign_id: number; checked: number; fetched: number; captured: number; sent: number; queued?: number; review?: number; manual: number; ignored: number; failed: number; skipped?: number; errors: string[]; posts?: { platform: Platform; post_url: string; fetched: number; captured: number; sent: number; ignored: number; failed: number; error?: string; synced_at: string }[]; platforms?: { platform: Platform; checked: number; fetched: number; new: number; sent: number; review: number; ignored: number; failed: number; manual: number; last_sync_time: string; error?: string }[] }>(`/api/v1/campaigns/${campaignId}/sync`, {
    method: 'POST',
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function retryCampaignEngagement(campaignId: number, engagerId: number, brandId: number, replyText?: string) {
  return apiRequest<{ ok: true; status: string; reply?: string; error?: string }>(`/api/v1/campaigns/${campaignId}/engagements/${engagerId}/retry`, {
    method: 'POST',
    body: JSON.stringify({ brand_id: brandId, reply_text: replyText }),
  });
}

export function dismissCampaignEngagement(campaignId: number, engagerId: number, brandId: number) {
  return apiRequest<{ ok: true; status: string }>(`/api/v1/campaigns/${campaignId}/engagements/${engagerId}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function toggleCampaign(campaignId: number) {
  return apiRequest<{ ok: true; campaign_id: number; is_active: boolean }>(
    `/api/v1/campaigns/${campaignId}/toggle`,
    { method: "POST" },
  );
}

export function runPostUrlCampaign(payload: PostUrlCampaignPayload) {
  return apiRequest<{ ok: true; message: string; campaign_id: string; post_count: number }>(
    "/api/v1/campaigns/post-urls/run",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getPostUrlCampaignStatus(brandId: number, campaignId: string) {
  return apiRequest<PostUrlCampaignStatus>(`/api/v1/campaigns/post-urls/status/${brandId}/${campaignId}`);
}

export function preflightXCampaign(payload: { brand_id: number; tweet_url?: string }) {
  return apiRequest<XCampaignPreflightResponse>("/api/v1/campaigns/x/preflight", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishXCampaignPost(payload: { brand_id: number; text: string; reply_to_url?: string }) {
  return apiRequest<{ ok: true; platform: "x"; message_id?: string; reply_to_tweet_id?: string | null }>("/api/v1/campaigns/x/post", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function syncXReplies(payload: { brand_id: number; tweet_url?: string; tweet_id?: string }) {
  return apiRequest<XReplySyncResponse>("/api/v1/campaigns/x/sync-replies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getApprovalQueue(brandId: number) {
  return apiRequest<{ queue: ApprovalQueueItem[] }>(`/api/v1/rt/queue/${brandId}`);
}

export function approveQueueItem(brandId: number, queueKey: string, replyText?: string, attachments: QueueAttachmentPayload = {}) {
  return apiRequest<{
    ok: true;
    item: ApprovalQueueItem;
    publish?: { success: boolean; platform: Platform; message_id?: string; error?: string };
  }>(`/api/v1/rt/queue/${encodeURIComponent(queueKey)}/approve`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, reply_text: replyText, ...attachments }),
  });
}

export function editAndSendQueueItem(brandId: number, queueKey: string, replyText: string, attachments: QueueAttachmentPayload = {}) {
  return apiRequest<{ ok: true; item: ApprovalQueueItem }>(`/api/v1/rt/queue/${encodeURIComponent(queueKey)}/edit-and-send`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, reply_text: replyText, ...attachments }),
  });
}

export function markQueueItemSent(brandId: number, queueKey: string) {
  return apiRequest<{ ok: true; item: ApprovalQueueItem }>(`/api/v1/rt/queue/${encodeURIComponent(queueKey)}/mark-sent`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function retryQueueItem(brandId: number, queueKey: string, attachments: QueueAttachmentPayload = {}) {
  return apiRequest<{ ok: true; item: ApprovalQueueItem }>(`/api/v1/rt/queue/${encodeURIComponent(queueKey)}/retry`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, ...attachments }),
  });
}

export function skipQueueItem(brandId: number, queueKey: string) {
  return apiRequest<{ ok: true; item: ApprovalQueueItem }>(`/api/v1/rt/queue/${encodeURIComponent(queueKey)}/skip`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function getKeywordGroups(brandId: number) {
  return apiRequest<{ keyword_groups: KeywordGroup[] }>(`/api/v1/listening/keyword-groups/${brandId}`);
}

export function createKeywordGroup(payload: {
  brand_id: number;
  name: string;
  keywords: string[];
  platforms: string[];
  mode?: "realtime" | "historical" | "both";
}) {
  return apiRequest<{ ok: true; keyword_group: KeywordGroup }>("/api/v1/listening/keyword-groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runListeningSearch(payload: {
  brand_id: number;
  group_id?: number;
  keywords?: string[];
  platforms?: string[];
  mode?: "realtime" | "historical";
}) {
  return apiRequest<{ ok: true; run_id: number; status: string }>("/api/v1/listening/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getListeningRuns(brandId: number) {
  return apiRequest<{ runs: ListeningRun[] }>(`/api/v1/listening/runs/${brandId}`);
}

export function getListeningFeed(brandId: number) {
  return apiRequest<{ feed: ListeningFeedItem[] }>(`/api/v1/listening/feed/${brandId}`);
}

export function getFunnels(brandId: number) {
  return apiRequest<{ funnels: FunnelRecord[] }>(`/api/v1/funnels/${brandId}`);
}

export function createFunnel(payload: {
  brand_id: number;
  name: string;
  platform?: string;
  keywords: string[];
  trigger_actions: string[];
  max_per_hour?: number;
  delay_sec?: number;
  dest_url?: string;
  is_active?: boolean;
}) {
  return apiRequest<{ ok: true; funnel: FunnelRecord }>("/api/v1/funnels", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createFunnelTemplate(funnelId: number, payload: { name: string; body: string; cta_link?: string }) {
  return apiRequest<ToolActionResult>(`/api/v1/funnels/${funnelId}/templates`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runFunnel(funnelId: number) {
  return apiRequest<ToolActionResult>(`/api/v1/funnels/${funnelId}/run`, { method: "POST" });
}

export function toggleFunnel(funnelId: number) {
  return apiRequest<{ ok: true; funnel_id: number; is_active: boolean }>(`/api/v1/funnels/${funnelId}/toggle`, { method: "POST" });
}

export function runClustering(brandId: number, timeWindowDays = 7) {
  return apiRequest<ToolActionResult>("/api/v1/cluster", {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, time_window_days: timeWindowDays }),
  });
}

export function runStrategy(brandId: number) {
  return apiRequest<ToolActionResult>("/api/v1/strategize", {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function runCommentMining(brandId: number) {
  return apiRequest<ToolActionResult>("/api/v1/insights/run", {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function runWarRoomSnapshot(brandId: number) {
  return apiRequest<ToolActionResult>("/api/v1/warroom/snapshot", {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}

export function createAttributionLink(payload: AttributionLinkPayload) {
  return apiRequest<ToolActionResult>("/api/v1/attribution/links", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAttributionLinks(brandId: number) {
  return apiRequest<{ links: TrackedLinkRecord[] }>(`/api/v1/attribution/links/${brandId}`);
}

export function scoreCreative(payload: CreativeScorePayload) {
  return apiRequest<ToolActionResult>("/api/v1/creative/score", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getToolSummary(toolId: string, brandId: number) {
  return apiRequest<ToolSummaryResponse>(`/api/v1/tools/${toolId}/summary?brand_id=${brandId}`);
}
