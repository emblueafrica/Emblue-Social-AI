-- ═══════════════════════════════════════════════════════════════════════════
-- Social Emblue AI — Full Database Schema
-- Run this ONCE in Supabase SQL Editor to create all tables
-- Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EXTENSIONS ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- ── ENUMS ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE platform_enum AS ENUM ('instagram','facebook','x','tiktok','youtube','reddit','whatsapp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sentiment_enum AS ENUM ('positive','neutral','negative');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE intent_enum AS ENUM ('inquiry','complaint','praise','purchase_intent','objection','neutral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending','approved','rejected','posted','escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform_role AS ENUM ('super_admin','platform_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brand_role AS ENUM ('client_owner','client_member','client_viewer','client_approver');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE brand_role ADD VALUE IF NOT EXISTS 'client_member';
ALTER TYPE brand_role ADD VALUE IF NOT EXISTS 'client_viewer';
ALTER TYPE brand_role ADD VALUE IF NOT EXISTS 'client_approver';

DO $$ BEGIN
  CREATE TYPE brand_account_type AS ENUM ('b2b_licensed','b2c_managed','internal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app_user_status AS ENUM ('pending','active','suspended','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signup_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE team_invitation_status AS ENUM ('pending','accepted','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── BRANDS (multi-tenant root) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  brand_id          SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  account_type      brand_account_type NOT NULL DEFAULT 'b2b_licensed',
  campaign_objective TEXT DEFAULT 'brand awareness',
  tone              TEXT DEFAULT 'professional and friendly',
  watchlist_keywords TEXT[] DEFAULT '{}',
  owner_user_id     UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- RBAC, AUTHENTICATION, AND CLIENT ONBOARDING
CREATE TABLE IF NOT EXISTS app_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT,
  phone      TEXT,
  status     app_user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_users (
  platform_user_id BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  role             platform_role NOT NULL,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  created_by       UUID,
  UNIQUE(user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_platform_users_user ON platform_users(user_id, is_active);

CREATE TABLE IF NOT EXISTS brand_memberships (
  membership_id BIGSERIAL PRIMARY KEY,
  brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  role          brand_role NOT NULL DEFAULT 'client_owner',
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  created_by    UUID,
  UNIQUE(brand_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_brand_memberships_user ON brand_memberships(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_brand_memberships_brand ON brand_memberships(brand_id, is_active);

CREATE TABLE IF NOT EXISTS client_signup_requests (
  request_id          BIGSERIAL PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  company_name        TEXT NOT NULL,
  website             TEXT,
  industry            TEXT,
  team_size           TEXT,
  social_handles      JSONB DEFAULT '{}',
  goals               JSONB DEFAULT '[]',
  requested_plan      TEXT,
  requested_account_type brand_account_type NOT NULL DEFAULT 'b2b_licensed',
  requested_platforms TEXT[] DEFAULT '{}',
  billing_notes       TEXT,
  status              signup_status NOT NULL DEFAULT 'pending',
  reviewed_by         UUID,
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  brand_id            INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_signup_requests_status ON client_signup_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_signup_requests_user ON client_signup_requests(user_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id            BIGSERIAL PRIMARY KEY,
  actor_user_id       UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  actor_platform_role platform_role,
  action              TEXT NOT NULL,
  resource_type       TEXT NOT NULL,
  resource_id         TEXT,
  brand_id            INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL,
  target_user_id      UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  ip_address          TEXT,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_brand ON audit_logs(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);

CREATE TABLE IF NOT EXISTS team_invitations (
  invitation_id BIGSERIAL PRIMARY KEY,
  brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'client_member',
  token_hash    TEXT UNIQUE NOT NULL,
  status        team_invitation_status NOT NULL DEFAULT 'pending',
  invited_by    UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  accepted_by   UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  accepted_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_invitations_brand ON team_invitations(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email, status);

-- TOOL ACCESS & PACKAGING
CREATE TABLE IF NOT EXISTS brand_tool_access (
  access_id    BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  tool_id      TEXT NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  plan_name    TEXT,
  activated_at TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  UNIQUE(brand_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_brand_tool_access_brand ON brand_tool_access(brand_id, is_active);

-- ── TOOL 1: LISTENING ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_messages (
  message_id        BIGSERIAL PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  platform          platform_enum NOT NULL,
  kind              TEXT DEFAULT 'comment',
  external_id       TEXT,
  text              TEXT NOT NULL,
  author_handle     TEXT,
  author_id_hash    TEXT,
  url               TEXT,
  sentiment         sentiment_enum,
  intent            intent_enum,
  urgency_score     INTEGER CHECK (urgency_score BETWEEN 1 AND 5),
  topics            TEXT[] DEFAULT '{}',
  embedding         vector(1536),
  raw_metrics       JSONB DEFAULT '{}',
  raw               JSONB DEFAULT '{}',
  captured_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_msgs_brand ON social_messages(brand_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_sentiment ON social_messages(brand_id, sentiment);
CREATE INDEX IF NOT EXISTS idx_msgs_intent ON social_messages(brand_id, intent);

-- v3.1 SOCIAL LISTENING: keyword groups, search runs, results, and volume chart data
CREATE TABLE IF NOT EXISTS keyword_groups (
  group_id                 BIGSERIAL PRIMARY KEY,
  brand_id                 INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  keywords                 TEXT[] NOT NULL DEFAULT '{}',
  platforms                TEXT[] NOT NULL DEFAULT '{}',
  mode                     TEXT NOT NULL DEFAULT 'realtime' CHECK (mode IN ('realtime','historical','both')),
  date_from                DATE,
  date_to                  DATE,
  alert_urgency_threshold  INTEGER DEFAULT 4 CHECK (alert_urgency_threshold BETWEEN 1 AND 5),
  alert_intents            TEXT[] DEFAULT '{}',
  is_active                BOOLEAN DEFAULT TRUE,
  created_at               TIMESTAMPTZ DEFAULT now(),
  last_run_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_keyword_groups_brand ON keyword_groups(brand_id, is_active);

CREATE TABLE IF NOT EXISTS search_runs (
  run_id           BIGSERIAL PRIMARY KEY,
  brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  group_id         BIGINT REFERENCES keyword_groups(group_id) ON DELETE SET NULL,
  keywords         TEXT[] NOT NULL DEFAULT '{}',
  platforms        TEXT[] NOT NULL DEFAULT '{}',
  date_from        DATE,
  date_to          DATE,
  mode             TEXT NOT NULL DEFAULT 'historical' CHECK (mode IN ('realtime','historical')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed')),
  total_results    INTEGER DEFAULT 0,
  positive_count   INTEGER DEFAULT 0,
  negative_count   INTEGER DEFAULT 0,
  neutral_count    INTEGER DEFAULT 0,
  peak_date        DATE,
  peak_count       INTEGER DEFAULT 0,
  insights_summary TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  error_msg        TEXT
);
CREATE INDEX IF NOT EXISTS idx_search_runs_brand ON search_runs(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_runs_status ON search_runs(status);

CREATE TABLE IF NOT EXISTS search_results (
  result_id        BIGSERIAL PRIMARY KEY,
  run_id           BIGINT NOT NULL REFERENCES search_runs(run_id) ON DELETE CASCADE,
  brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  group_id         BIGINT REFERENCES keyword_groups(group_id) ON DELETE SET NULL,
  matched_keyword  TEXT,
  platform         platform_enum NOT NULL,
  text             TEXT NOT NULL,
  author_handle    TEXT,
  author_id_ext    TEXT,
  url              TEXT,
  posted_at        TIMESTAMPTZ,
  sentiment        sentiment_enum,
  intent           intent_enum,
  urgency_score    INTEGER CHECK (urgency_score BETWEEN 1 AND 5),
  topics           TEXT[] DEFAULT '{}',
  likes            INTEGER DEFAULT 0,
  replies_count    INTEGER DEFAULT 0,
  shares           INTEGER DEFAULT 0,
  views            INTEGER DEFAULT 0,
  engaged          BOOLEAN DEFAULT FALSE,
  raw              JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_results_run ON search_results(run_id, urgency_score DESC, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_results_brand ON search_results(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_results_feed ON search_results(brand_id, engaged, urgency_score DESC);

CREATE TABLE IF NOT EXISTS search_volume (
  volume_id      BIGSERIAL PRIMARY KEY,
  run_id         BIGINT NOT NULL REFERENCES search_runs(run_id) ON DELETE CASCADE,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  period_type    TEXT NOT NULL DEFAULT 'day' CHECK (period_type IN ('day','week','month')),
  mention_count  INTEGER DEFAULT 0,
  positive_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  neutral_count  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_volume_run ON search_volume(run_id, period_start);

-- ── TOOL 2: CLUSTERING ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clusters (
  cluster_id        BIGSERIAL PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  opportunity_score INTEGER DEFAULT 0,
  message_count     INTEGER DEFAULT 0,
  top_phrases       TEXT[] DEFAULT '{}',
  recommendations   JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cluster_items (
  id         BIGSERIAL PRIMARY KEY,
  cluster_id BIGINT REFERENCES clusters(cluster_id) ON DELETE CASCADE,
  message_id BIGINT REFERENCES social_messages(message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_recommendations (
  rec_id     BIGSERIAL PRIMARY KEY,
  brand_id   INTEGER REFERENCES brands(brand_id) ON DELETE CASCADE,
  cluster_id BIGINT REFERENCES clusters(cluster_id),
  platform   platform_enum,
  format     TEXT,
  headline   TEXT,
  brief      TEXT,
  status     TEXT DEFAULT 'idea',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── TOOL 3: REPLY ENGINE ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_suggestions (
  suggestion_id BIGSERIAL PRIMARY KEY,
  brand_id      INTEGER REFERENCES brands(brand_id) ON DELETE CASCADE,
  message_id    BIGINT REFERENCES social_messages(message_id),
  tone_variant  TEXT,
  reply_text    TEXT NOT NULL,
  confidence    NUMERIC(4,2),
  risk_flags    TEXT[] DEFAULT '{}',
  status        approval_status DEFAULT 'pending',
  approved_by   UUID,
  posted_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replies_status ON reply_suggestions(brand_id, status);

-- ── TOOL 4: DM FUNNELS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funnels (
  funnel_id   BIGSERIAL PRIMARY KEY,
  brand_id    INTEGER REFERENCES brands(brand_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  platform    platform_enum,
  trigger_type TEXT,
  keywords    TEXT[] DEFAULT '{}',
  max_per_hour INTEGER DEFAULT 20,
  delay_sec   INTEGER DEFAULT 30,
  dest_url    TEXT,
  is_active   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dm_events (
  event_id    BIGSERIAL PRIMARY KEY,
  brand_id    INTEGER REFERENCES brands(brand_id),
  funnel_id   BIGINT REFERENCES funnels(funnel_id),
  message_id  BIGINT REFERENCES social_messages(message_id),
  author_handle TEXT,
  dm_sent_at  TIMESTAMPTZ,
  opened_at   TIMESTAMPTZ,
  clicked_at  TIMESTAMPTZ,
  converted   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── TOOL 5: KPI SNAPSHOTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  snapshot_id    BIGSERIAL PRIMARY KEY,
  brand_id       INTEGER REFERENCES brands(brand_id),
  period_start   DATE,
  period_end     DATE,
  listening_kpi  NUMERIC(5,2),
  reply_kpi      NUMERIC(5,2),
  funnel_kpi     NUMERIC(5,2),
  risk_events    INTEGER DEFAULT 0,
  kpis           JSONB DEFAULT '[]',
  alerts         JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ── TOOL 6: ATTRIBUTION ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_links (
  link_id      BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER REFERENCES brands(brand_id),
  short_code   TEXT UNIQUE NOT NULL,
  dest_url     TEXT NOT NULL,
  campaign     TEXT,
  platform     platform_enum,
  content_type TEXT,
  clicks       INTEGER DEFAULT 0,
  conversions  INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS link_events (
  event_id   BIGSERIAL PRIMARY KEY,
  link_id    BIGINT REFERENCES tracked_links(link_id),
  brand_id   INTEGER,
  event_type TEXT DEFAULT 'click',
  ip_hash    TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── TOOL 7: CREATIVE SCORES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_scores (
  score_id       BIGSERIAL PRIMARY KEY,
  brand_id       INTEGER REFERENCES brands(brand_id),
  platform       platform_enum,
  caption        TEXT,
  grade          TEXT,
  overall_score  INTEGER,
  scores         JSONB DEFAULT '{}',
  next_actions   JSONB DEFAULT '[]',
  rewritten      TEXT,
  alt_hooks      TEXT[] DEFAULT '{}',
  best_time      TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ── TOOL 8: COMMENT INSIGHTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insight_runs (
  run_id       BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER REFERENCES brands(brand_id),
  messages_processed INTEGER DEFAULT 0,
  faqs_found   INTEGER DEFAULT 0,
  pain_points  INTEGER DEFAULT 0,
  summary      TEXT,
  ran_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faq_items (
  faq_id     BIGSERIAL PRIMARY KEY,
  brand_id   INTEGER REFERENCES brands(brand_id),
  run_id     BIGINT REFERENCES insight_runs(run_id),
  question   TEXT NOT NULL,
  frequency  INTEGER DEFAULT 1,
  platforms  platform_enum[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pain_points (
  pp_id      BIGSERIAL PRIMARY KEY,
  brand_id   INTEGER REFERENCES brands(brand_id),
  run_id     BIGINT REFERENCES insight_runs(run_id),
  text       TEXT NOT NULL,
  severity   TEXT DEFAULT 'medium',
  frequency  INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── TOOL 9: WAR ROOM ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS war_rooms (
  room_id    BIGSERIAL PRIMARY KEY,
  brand_id   INTEGER REFERENCES brands(brand_id),
  health     TEXT DEFAULT 'green',
  summary    TEXT,
  alerts     JSONB DEFAULT '[]',
  metrics    JSONB DEFAULT '{}',
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

-- ── PLATFORM CONNECTIONS (OAuth tokens) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS connected_accounts (
  account_id       BIGSERIAL PRIMARY KEY,
  brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  platform         platform_enum NOT NULL,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  account_handle   TEXT,
  account_id_ext   TEXT,
  scope            TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  connected_at     TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, platform)
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  metric_id     BIGSERIAL PRIMARY KEY,
  brand_id      INTEGER REFERENCES brands(brand_id),
  platform      platform_enum,
  period_start  DATE,
  period_end    DATE,
  impressions   BIGINT DEFAULT 0,
  reach         BIGINT DEFAULT 0,
  engagements   INTEGER DEFAULT 0,
  spend         NUMERIC(12,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, platform, period_start)
);

-- ── TRIGGER ENGINE (Layer 2) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trigger_rules (
  rule_id      BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER REFERENCES brands(brand_id),
  name         TEXT NOT NULL,
  rule_type    TEXT,
  trigger_val  TEXT,
  action       TEXT,
  confidence   INTEGER DEFAULT 80,
  is_active    BOOLEAN DEFAULT TRUE,
  fired_count  INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_queue (
  queue_id     BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER REFERENCES brands(brand_id),
  message_id   BIGINT REFERENCES social_messages(message_id),
  reply_text   TEXT,
  platform     platform_enum,
  confidence   NUMERIC(4,2),
  status       approval_status DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── REPLY TEMPLATES (client-supplied) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_templates (
  template_id      BIGSERIAL PRIMARY KEY,
  brand_id         INTEGER REFERENCES brands(brand_id),
  name             TEXT NOT NULL DEFAULT 'Default template',
  platform         platform_enum,
  trigger_keywords TEXT[] DEFAULT '{}',
  template_text    TEXT NOT NULL,
  is_active        BOOLEAN DEFAULT TRUE,
  use_count        INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE reply_templates
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Default template',
  ADD COLUMN IF NOT EXISTS trigger_keywords TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS template_text TEXT,
  ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
-- Enable RLS on all tables so each brand can only see its own data
ALTER TABLE brands              ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_tool_access   ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_volume       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_suggestions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnels             ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_scores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts  ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (backend uses service role key)
-- Client-facing queries use anon key with these policies:

CREATE POLICY "brands_own" ON brands
  FOR ALL USING (owner_user_id = auth.uid());

CREATE POLICY "brand_tool_access_own" ON brand_tool_access
  FOR SELECT USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "messages_own" ON social_messages
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "keyword_groups_own" ON keyword_groups
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "search_runs_own" ON search_runs
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "search_results_own" ON search_results
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "search_volume_own" ON search_volume
  FOR ALL USING (run_id IN (SELECT run_id FROM search_runs WHERE brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid())));

CREATE POLICY "clusters_own" ON clusters
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "replies_own" ON reply_suggestions
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "funnels_own" ON funnels
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

CREATE POLICY "kpi_own" ON kpi_snapshots
  FOR ALL USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));

-- ── SEED: INSERT A TEST BRAND ─────────────────────────────────────────────────
-- Remove this section after first real brand is created
INSERT INTO brands (name, slug, campaign_objective, tone)
VALUES ('Demo Brand', 'demo-brand', 'drive bookings', 'friendly and professional')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO brand_tool_access (brand_id, tool_id, plan_name, is_active)
SELECT b.brand_id, tools.tool_id, 'legacy', TRUE
FROM brands b
CROSS JOIN (
  VALUES
    ('tool_1'), ('tool_2'), ('tool_3'), ('tool_4'), ('tool_5'),
    ('tool_6'), ('tool_7'), ('tool_8'), ('tool_9'), ('tool_10')
) AS tools(tool_id)
ON CONFLICT (brand_id, tool_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Schema complete. All tables created with RLS enabled.
-- Next: Add SUPABASE_JWT_SECRET to your .env file
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ENGAGE THE ENGAGERS — Campaign Tables ────────────────────────────────────
CREATE TABLE IF NOT EXISTS engage_campaigns (
  campaign_id          BIGSERIAL PRIMARY KEY,
  brand_id             INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  platform             platform_enum,
  post_ids             TEXT[]    DEFAULT '{}',
  keywords             TEXT[]    DEFAULT '{}',
  engage_all           BOOLEAN   DEFAULT TRUE,
  engage_negative      BOOLEAN   DEFAULT FALSE,
  tone                 TEXT      DEFAULT 'warm and enthusiastic',
  reply_template       TEXT,
  fallback_template    TEXT,
  cta_link             TEXT,
  image_url            TEXT,
  tracked_link_code    TEXT,
  auto_fire_threshold  INTEGER   DEFAULT 85,
  max_per_hour         INTEGER   DEFAULT 50,
  is_active            BOOLEAN   DEFAULT TRUE,
  total_sent           INTEGER   DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auto_engagements (
  engagement_id  BIGSERIAL PRIMARY KEY,
  brand_id       INTEGER REFERENCES brands(brand_id),
  campaign_id    BIGINT  REFERENCES engage_campaigns(campaign_id),
  platform       platform_enum,
  author_handle  TEXT,
  original_text  TEXT,
  reply_text     TEXT,
  image_url      TEXT,
  tracked_link   TEXT,
  status         TEXT DEFAULT 'sent',  -- sent | manual_copy | queued | failed
  fired_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_assets (
  asset_id     BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER REFERENCES brands(brand_id),
  campaign_id  TEXT,
  image_url    TEXT NOT NULL,
  alt_text     TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_eng_brand ON auto_engagements(brand_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_engage_camp_brand ON engage_campaigns(brand_id, is_active);

-- ── POST URL CAMPAIGN TABLES (v2.0) ─────────────────────────────────────────
-- Stores submitted post URLs and every fetched engager for audit trail

CREATE TABLE IF NOT EXISTS campaign_post_urls (
  url_id        BIGSERIAL PRIMARY KEY,
  brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  campaign_id   BIGINT  REFERENCES engage_campaigns(campaign_id),
  platform      platform_enum NOT NULL,
  post_url      TEXT NOT NULL,
  post_id_ext   TEXT,                        -- extracted from URL
  include_commenters BOOLEAN DEFAULT TRUE,
  include_likers     BOOLEAN DEFAULT TRUE,
  status        TEXT DEFAULT 'pending',       -- pending | fetching | complete | error
  total_fetched INTEGER DEFAULT 0,
  error_msg     TEXT,
  submitted_at  TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS campaign_post_engagers (
  engager_id    BIGSERIAL PRIMARY KEY,
  brand_id      INTEGER REFERENCES brands(brand_id),
  campaign_id   TEXT NOT NULL,
  platform      platform_enum NOT NULL,
  action        TEXT NOT NULL,               -- 'commented' | 'liked'
  author_id     TEXT NOT NULL,
  author_handle TEXT,
  original_text TEXT,
  status        TEXT DEFAULT 'pending',       -- pending | sent | manual_copy | queued | skipped | bot_blocked
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, campaign_id, platform, author_id)
);

-- Add platform_allocation column to engage_campaigns
ALTER TABLE engage_campaigns
  ADD COLUMN IF NOT EXISTS platform_allocation JSONB DEFAULT '{"instagram":34,"facebook":33,"tiktok":33}',
  ADD COLUMN IF NOT EXISTS include_likers      BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS include_commenters  BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_post_engagers_campaign ON campaign_post_engagers(brand_id, campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_post_urls_brand ON campaign_post_urls(brand_id, status);
