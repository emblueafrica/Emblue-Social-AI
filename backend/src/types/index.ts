// src/types/index.ts
// Central type definitions for the entire platform
// Every file imports from here — no scattered type definitions

// ── PLATFORM TYPES ────────────────────────────────────────────────────────────
export type Platform = 'instagram' | 'facebook' | 'x' | 'tiktok' | 'youtube' | 'reddit' | 'whatsapp';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type Intent    = 'inquiry' | 'complaint' | 'praise' | 'purchase_intent' | 'objection' | 'neutral';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'posted' | 'escalated';
export type UserRole  = 'owner' | 'admin' | 'member';
export type PlatformRole = 'super_admin' | 'platform_admin';
export type BrandRole = 'client_owner' | 'client_member' | 'client_viewer' | 'client_approver';
export type BrandAccountType = 'b2b_licensed' | 'b2c_managed' | 'internal';
export type AppUserStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type SignupStatus = 'pending' | 'approved' | 'rejected';
export type JobType   = 'platform_sync' | 'clustering' | 'content_strategy' | 'kpi_snapshot' | 'comment_mining' | 'war_room';
export type HealthStatus = 'green' | 'amber' | 'red' | 'crisis';

// ── JWT PAYLOAD ───────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub:      string;       // user UUID
  email:    string;
  role:     string;
  user_metadata?: {
    full_name?: string;
    name?:      string;
    phone?:     string;
  };
  iat?: number;
  exp?: number;
}

export interface AuthBrandMembership {
  brand_id:     number;
  role:         BrandRole;
  account_type: BrandAccountType;
  brand_name?:  string;
  brand_slug?:  string;
}

export interface AuthUser {
  id:                     string;
  email:                  string;
  app_role:               string;
  status:                 AppUserStatus;
  platform_role:          PlatformRole | null;
  brand_id:               number | null;
  brand_memberships:      AuthBrandMembership[];
  pending_signup_status?: SignupStatus | null;
}

// ── BRAND ─────────────────────────────────────────────────────────────────────
export interface Brand {
  brand_id:            number;
  name:                string;
  slug:                string;
  account_type:        BrandAccountType;
  campaign_objective?: string;
  tone?:               string;
  watchlist_keywords?: string[];
  owner_user_id?:      string;
  created_at:          Date;
  updated_at:          Date;
}

// ── RAW MESSAGE (from platform) ───────────────────────────────────────────────
export interface RawMessage {
  platform:      Platform;
  kind:          string;
  text:          string;
  author_handle: string | null;
  author_id?:    string | null;
  url?:          string | null;
  created_at?:   string;
  metrics?: {
    likes:   number;
    replies: number;
    shares:  number;
    views:   number;
  };
  raw?: Record<string, unknown>;
}

// ── CLASSIFIED MESSAGE (after Agent 1) ───────────────────────────────────────
export interface ClassifiedMessage extends RawMessage {
  message_id?:   number;
  brand_id:      number;
  sentiment?:    Sentiment;
  intent?:       Intent;
  urgency_score?: number;
  topics?:       string[];
  embedding?:    number[] | null;
  captured_at?:  Date;
  external_id?:  string;
}

// ── AGENT 1: LISTENING ────────────────────────────────────────────────────────
export interface Agent1Payload {
  brand_id:     number;
  platform:     Platform;
  payload_type: 'csv' | 'api_items';
  source_name:  string;
  items:        RawMessage[];
}

export interface Agent1Result {
  classified:   ClassifiedMessage[];
  total_items:  number;
  errors:       string[];
  platform:     Platform;
}

// ── AGENT 2: CLUSTERING ───────────────────────────────────────────────────────
export interface Agent2Payload {
  brand_id:             number;
  items:                Pick<ClassifiedMessage, 'text' | 'platform' | 'kind' | 'captured_at'>[];
  time_window_days:     number;
  min_items_per_cluster: number;
}

export interface Cluster {
  label:             string;
  opportunity_score: number;
  message_count:     number;
  top_phrases:       string[];
  recommendations:   string[];
}

export interface Agent2Result {
  clusters_created:  number;
  clusters:          Cluster[];
  insufficient_data?: boolean;
}

// ── AGENT 3: CONTENT STRATEGIST ──────────────────────────────────────────────
export interface Agent3Payload {
  brand_id:          number;
  clusters:          Cluster[];
  platforms_target:  Platform[];
  campaign_context:  { objective: string };
  ruleset:           { tone: string };
}

export interface ContentRecommendation {
  platform:  Platform;
  format:    string;
  headline:  string;
  brief:     string;
  status:    string;
}

export interface Agent3Result {
  recommendations: ContentRecommendation[];
  error?:          string;
}

// ── AGENT 4: REPLY ASSISTANT ──────────────────────────────────────────────────
export interface Agent4Payload {
  brand_id:         number;
  message:          string;
  platform:         Platform;
  tone:             string;
  campaign_context: {
    name?:      string;
    objective:  string;
    cta_link?:  string;
    action_type?: string;
  };
  ruleset: {
    tone:            string;
    required_words?: string[];
    do_not_say?:     string[];
  };
  author_handle?:  string;
  reply_channel?:  'dm' | 'thread_reply' | 'comment_reply';
}

export interface ReplySuggestion {
  text:          string;
  reply_text?:   string;
  tone:          string;
  confidence:    number;
  risk_flags?:   string[];
}

export interface Agent4Result {
  replies?:      ReplySuggestion[];
  suggestions?:  ReplySuggestion[];
  error?:        string;
}

// ── AGENT 6: KPI ──────────────────────────────────────────────────────────────
export interface Agent6Payload {
  brand_id:   number;
  date_from:  string;
  date_to:    string;
  platforms:  Platform[];
}

export interface KpiItem {
  metric:  string;
  value:   number | string;
  change?: string;
}

export interface Agent6Result {
  kpis?:         KpiItem[];
  alerts?:       string[];
  listening_kpi?: number;
  reply_kpi?:    number;
  funnel_kpi?:   number;
  risk_events?:  number;
  error?:        string;
}

// ── AGENT 9: CREATIVE PREDICTOR ───────────────────────────────────────────────
export interface Agent9Payload {
  brand_id:     number;
  platform:     Platform;
  caption:      string;
  format?:      string;
  objective?:   string;
  media_desc?:  string;
}

export interface NextAction {
  priority:  number;
  element:   string;
  impact:    string;
  effort:    string;
  before?:   string;
  after?:    string;
  why:       string;
}

export interface Agent9Result {
  grade:          string;
  overall_score:  number;
  verdict:        string;
  scores:         Record<string, number>;
  next_actions:   NextAction[];
  rewritten?:     string;
  alt_hooks?:     string[];
  best_time?:     string;
  error?:         string;
}

// ── AGENT 10: COMMENT MINER ───────────────────────────────────────────────────
export interface Agent10Payload {
  brand_id:      number;
  comments:      { platform: Platform; author: string; text: string }[];
  brand_context: string;
}

export interface FaqItem {
  question:   string;
  frequency:  number;
  platforms:  Platform[];
}

export interface PainPoint {
  text:      string;
  severity:  'low' | 'medium' | 'high' | 'critical';
  frequency: number;
}

export interface Agent10Result {
  faqs?:        FaqItem[];
  pain_points?: PainPoint[];
  summary?:     string;
  error?:       string;
}

// ── AGENT 11: WAR ROOM ────────────────────────────────────────────────────────
export interface Agent11Payload {
  brand_id:          number;
  war_room_id:       number;
  live_messages:     ClassifiedMessage[];
  watchlist_keywords: string[];
  current_metrics:   Record<string, unknown>;
}

export interface WarRoomAlert {
  severity:    'info' | 'warning' | 'critical';
  headline:    string;
  description: string;
  metrics?:    Record<string, string | number>;
}

export interface Agent11Result {
  campaign_health: HealthStatus;
  summary?:        string;
  alerts?:         WarRoomAlert[];
  metrics?:        Record<string, unknown>;
  error?:          string;
}

// ── AGENT 14: USER PROFILER ───────────────────────────────────────────────────
export interface Agent14Payload {
  brand_id: number;
  user: {
    handle:   string;
    id?:      string | null;
    platform: Platform;
    text?:    string;
  };
}

export interface Agent14Result {
  classification: 'influencer' | 'regular' | 'bot' | 'brand';
  tier?:          'micro' | 'macro' | 'mega';
  risk_level?:    'low' | 'medium' | 'high';
  engagement_rate?: number;
  follower_count?:  number;
}

// ── ENGAGE THE ENGAGERS ───────────────────────────────────────────────────────
export interface EngageEvent {
  platform:      Platform;
  author_handle: string;
  author_id?:    string | null;
  comment_id?:   string | null;
  post_id?:      string | null;
  tweet_id?:     string | null;
  text:          string;
  action?:       'commented' | 'liked';
  matched_keyword?: string;
}

export interface CampaignConfig {
  id?:                  string | number;
  campaign_id?:         string | number;
  brand_id?:            number;
  name?:                string;
  platform?:            Platform;
  keywords?:            string[];
  engage_all?:          boolean;
  engage_negative?:     boolean;
  tone?:                string;
  reply_template?:      string;
  fallback_template?:   string;
  cta_link?:            string;
  image_url?:           string;
  tracked_link_code?:   string;
  auto_fire_threshold?: number;
  max_per_hour?:        number;
  is_active?:           boolean;
  platform_allocation?: PlatformAllocation;
  include_likers?:      boolean;
  include_commenters?:  boolean;
  required_words?:      string[];
  do_not_say?:          string[];
  brand_name?:          string;
  objective?:           string;
}

export interface PlatformAllocation {
  instagram?: number;
  facebook?:  number;
  tiktok?:    number;
  x?:         number;
}

export interface Credentials {
  META_PAGE_ACCESS_TOKEN?: string | null;
  TIKTOK_ACCESS_TOKEN?:    string | null;
  X_OAUTH_TOKEN?:          string | null;
}

export interface PostUrlItem {
  platform:            Platform;
  url:                 string;
  include_commenters?: boolean;
  include_likers?:     boolean;
  post_id_ext?:        string | null;
}

export interface Engager {
  platform:        Platform;
  action:          'commented' | 'liked';
  author_id:       string;
  author_handle:   string;
  text:            string;
  timestamp?:      string;
  raw_comment_id?: string;
  raw_video_id?:   string;
  raw_tweet_id?:   string;
}

export interface EngageResult {
  status:       'sent' | 'queued_for_approval' | 'manual_copy' | 'rate_limited' | 'already_sent' | 'bot_blocked' | 'generation_failed' | 'error';
  platform?:    Platform;
  author?:      string;
  reply?:       string;
  image_url?:   string | null;
  tracked_link?: string | null;
  error?:       string;
}

export interface PlatformSendResult {
  success?:     boolean;
  message_id?:  string;
  tweet_id?:    string;
  comment_id?:  string;
  manual_copy?: boolean;
  text?:        string;
  error?:       string;
  reason?:      string;
  rate_limited?: boolean;
}

export interface PostCampaignResults {
  total_fetched:    number;
  posts_processed:  number;
  errors:           string[];
  sent:             number;
  queued:           number;
  skipped:          number;
  manual:           number;
  total_errors:     number;
  total_engagers:   number;
}

// ── TRACKED LINK ──────────────────────────────────────────────────────────────
export interface TrackedLink {
  link_id:      number;
  brand_id:     number;
  short_code:   string;
  dest_url:     string;
  campaign?:    string;
  platform?:    Platform;
  content_type?: string;
  clicks:       number;
  conversions:  number;
  created_at:   Date;
}

// ── APPROVAL QUEUE ITEM ───────────────────────────────────────────────────────
export interface ApprovalQueueItem {
  brand_id:      number;
  platform:      Platform;
  author:        string;
  original:      string;
  reply:         string;
  image_url?:    string | null;
  tracked_link?: string | null;
  meta?: {
    comment_id?: string | null;
    post_id?:    string | null;
    tweet_id?:   string | null;
    author_id?:  string | null;
  };
  manual_copy_required?:     boolean;
  manual_copy_instructions?: string | Record<string, string>;
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────
export interface EmailPayload {
  to:       string;
  subject:  string;
  html:     string;
  text?:    string;
}

export interface KpiEmailData {
  listening?:       number;
  reply?:           number;
  funnel?:          number;
  risk_events?:     number;
  platform_breakdown?: { platform: string; value: number }[];
  top_clusters?:    { label: string; opportunity_score: number }[];
  alerts?:          string[];
}

// ── SSE ───────────────────────────────────────────────────────────────────────
export interface SseClient {
  brand_id: number;
  res:      import('express').Response;
}

// ── ENV VALIDATION ────────────────────────────────────────────────────────────
export interface Env {
  PORT:                  string;
  NODE_ENV:              string;
  FRONTEND_URL:          string;
  ANTHROPIC_API_KEY:     string;
  DATABASE_URL:          string;
  SUPABASE_URL:          string;
  SUPABASE_ANON_KEY:     string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET:   string;
  SUPERADMIN_EMAILS?:    string;
  SUPER_ADMIN_EMAIL?:    string;
  SUPER_ADMIN_PASSWORD?: string;
  OAUTH_STATE_SECRET?:   string;
  META_APP_ID?:          string;
  META_APP_SECRET?:      string;
  META_REDIRECT_URI?:    string;
  META_VERIFY_TOKEN?:    string;
  META_PAGE_ACCESS_TOKEN?: string;
  X_CLIENT_ID?:          string;
  X_CLIENT_SECRET?:      string;
  X_REDIRECT_URI?:       string;
  X_BEARER_TOKEN?:       string;
  X_OAUTH_TOKEN?:        string;
  TIKTOK_CLIENT_KEY?:    string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_REDIRECT_URI?:  string;
  TIKTOK_ACCESS_TOKEN?:  string;
  OPENAI_API_KEY?:       string;
  RESEND_API_KEY?:       string;
  EMAIL_FROM?:           string;
  CLOUDINARY_CLOUD_NAME?:string;
  CLOUDINARY_API_KEY?:   string;
  CLOUDINARY_API_SECRET?:string;
  REDIS_URL?:            string;
  APIFY_API_TOKEN?:      string;
  LINK_BASE_URL?:        string;
}
