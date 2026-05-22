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

export type ToolAccessResponse = {
  enabled: string[];
  account_type?: string;
  plan?: unknown;
  brand?: {
    brand_id: number;
    name: string;
    slug: string;
  };
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
  created_at?: string;
  updated_at?: string;
};

export type CampaignPayload = {
  campaign_id?: number;
  brand_id: number;
  name: string;
  platform: Platform;
  keywords?: string[];
  tone?: string;
  reply_template?: string;
  cta_link?: string;
  image_url?: string;
  auto_fire_threshold?: number;
  max_per_hour?: number;
  is_active?: boolean;
  platform_allocation?: PlatformAllocation;
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

export type ApprovalQueueItem = {
  brand_id: number;
  platform: Platform;
  author: string;
  original: string;
  reply: string;
  image_url?: string | null;
  tracked_link?: string | null;
  meta?: {
    comment_id?: string | null;
    post_id?: string | null;
    tweet_id?: string | null;
    author_id?: string | null;
  };
  manual_copy_required?: boolean;
  manual_copy_instructions?: string | Record<string, string>;
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

export function getAuthMe() {
  return apiRequest<AuthMeResponse>("/api/v1/auth/me");
}

export function getToolAccess() {
  return apiRequest<ToolAccessResponse>("/api/v1/tools/my-access");
}

export function getDashboardSummary(brandId: number) {
  return apiRequest<DashboardSummary>(`/api/v1/dashboard/summary?brand_id=${brandId}`);
}

export function getCampaigns(brandId: number) {
  return apiRequest<{ campaigns: CampaignRecord[] }>(`/api/v1/campaigns/${brandId}`);
}

export function saveCampaign(payload: CampaignPayload) {
  return apiRequest<{ ok: true; campaign: CampaignRecord }>("/api/v1/campaigns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function toggleCampaign(campaignId: number) {
  return apiRequest<{ ok: true; campaign_id: number; is_active: boolean }>(
    `/api/v1/campaigns/${campaignId}/toggle`,
    { method: "POST" },
  );
}

export function runPostUrlCampaign(payload: PostUrlCampaignPayload) {
  return apiRequest<{ ok: true; message: string; post_count: number }>(
    "/api/v1/campaigns/post-urls/run",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getApprovalQueue(brandId: number) {
  return apiRequest<{ queue: ApprovalQueueItem[] }>(`/api/v1/rt/queue/${brandId}`);
}

export function approveQueueItem(brandId: number, index: number, replyText?: string) {
  return apiRequest<{
    ok: true;
    item: ApprovalQueueItem;
    publish?: { success: boolean; platform: Platform; message_id?: string; error?: string };
  }>("/api/v1/rt/queue/approve", {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, index, reply_text: replyText }),
  });
}
