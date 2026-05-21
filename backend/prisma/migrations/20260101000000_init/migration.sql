-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension (required for the social_messages.embedding vector(1536) column)
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "platform_enum" AS ENUM ('instagram', 'facebook', 'x', 'tiktok', 'youtube', 'reddit', 'whatsapp');

-- CreateEnum
CREATE TYPE "sentiment_enum" AS ENUM ('positive', 'neutral', 'negative');

-- CreateEnum
CREATE TYPE "intent_enum" AS ENUM ('inquiry', 'complaint', 'praise', 'purchase_intent', 'objection', 'neutral');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('pending', 'approved', 'rejected', 'posted', 'escalated');

-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('super_admin', 'platform_admin');

-- CreateEnum
CREATE TYPE "brand_role" AS ENUM ('client_owner', 'client_member', 'client_viewer', 'client_approver');

-- CreateEnum
CREATE TYPE "brand_account_type" AS ENUM ('b2b_licensed', 'b2c_managed', 'internal');

-- CreateEnum
CREATE TYPE "app_user_status" AS ENUM ('pending', 'active', 'suspended', 'rejected');

-- CreateEnum
CREATE TYPE "signup_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "team_invitation_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "brands" (
    "brand_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "account_type" "brand_account_type" NOT NULL DEFAULT 'b2b_licensed',
    "campaign_objective" TEXT,
    "tone" TEXT,
    "watchlist_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("brand_id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "status" "app_user_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "platform_user_id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "platform_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("platform_user_id")
);

-- CreateTable
CREATE TABLE "brand_memberships" (
    "membership_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "brand_role" NOT NULL DEFAULT 'client_owner',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "brand_memberships_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "client_signup_requests" (
    "request_id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "team_size" TEXT,
    "social_handles" JSONB NOT NULL DEFAULT '{}',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "requested_plan" TEXT,
    "requested_account_type" "brand_account_type" NOT NULL DEFAULT 'b2b_licensed',
    "requested_platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "billing_notes" TEXT,
    "status" "signup_status" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "brand_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_signup_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_id" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "actor_platform_role" "platform_role",
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "brand_id" INTEGER,
    "target_user_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "invitation_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'client_member',
    "token_hash" TEXT NOT NULL,
    "status" "team_invitation_status" NOT NULL DEFAULT 'pending',
    "invited_by" UUID NOT NULL,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("invitation_id")
);

-- CreateTable
CREATE TABLE "brand_tool_access" (
    "access_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "tool_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "plan_name" TEXT,
    "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "brand_tool_access_pkey" PRIMARY KEY ("access_id")
);

-- CreateTable
CREATE TABLE "social_messages" (
    "message_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "platform" "platform_enum" NOT NULL,
    "kind" TEXT DEFAULT 'comment',
    "external_id" TEXT,
    "text" TEXT NOT NULL,
    "author_handle" TEXT,
    "author_id_hash" TEXT,
    "url" TEXT,
    "sentiment" "sentiment_enum",
    "intent" "intent_enum",
    "urgency_score" INTEGER,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" vector(1536),
    "raw_metrics" JSONB NOT NULL DEFAULT '{}',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "keyword_groups" (
    "group_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" TEXT NOT NULL DEFAULT 'realtime',
    "date_from" DATE,
    "date_to" DATE,
    "alert_urgency_threshold" INTEGER DEFAULT 4,
    "alert_intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMPTZ(6),

    CONSTRAINT "keyword_groups_pkey" PRIMARY KEY ("group_id")
);

-- CreateTable
CREATE TABLE "search_runs" (
    "run_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "group_id" BIGINT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "date_from" DATE,
    "date_to" DATE,
    "mode" TEXT NOT NULL DEFAULT 'historical',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_results" INTEGER DEFAULT 0,
    "positive_count" INTEGER DEFAULT 0,
    "negative_count" INTEGER DEFAULT 0,
    "neutral_count" INTEGER DEFAULT 0,
    "peak_date" DATE,
    "peak_count" INTEGER DEFAULT 0,
    "insights_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "error_msg" TEXT,

    CONSTRAINT "search_runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "search_results" (
    "result_id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "group_id" BIGINT,
    "matched_keyword" TEXT,
    "platform" "platform_enum" NOT NULL,
    "text" TEXT NOT NULL,
    "author_handle" TEXT,
    "author_id_ext" TEXT,
    "url" TEXT,
    "posted_at" TIMESTAMPTZ(6),
    "sentiment" "sentiment_enum",
    "intent" "intent_enum",
    "urgency_score" INTEGER,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likes" INTEGER DEFAULT 0,
    "replies_count" INTEGER DEFAULT 0,
    "shares" INTEGER DEFAULT 0,
    "views" INTEGER DEFAULT 0,
    "engaged" BOOLEAN DEFAULT false,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_results_pkey" PRIMARY KEY ("result_id")
);

-- CreateTable
CREATE TABLE "search_volume" (
    "volume_id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "period_type" TEXT NOT NULL DEFAULT 'day',
    "mention_count" INTEGER DEFAULT 0,
    "positive_count" INTEGER DEFAULT 0,
    "negative_count" INTEGER DEFAULT 0,
    "neutral_count" INTEGER DEFAULT 0,

    CONSTRAINT "search_volume_pkey" PRIMARY KEY ("volume_id")
);

-- CreateTable
CREATE TABLE "clusters" (
    "cluster_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "opportunity_score" INTEGER DEFAULT 0,
    "message_count" INTEGER DEFAULT 0,
    "top_phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clusters_pkey" PRIMARY KEY ("cluster_id")
);

-- CreateTable
CREATE TABLE "cluster_items" (
    "id" BIGSERIAL NOT NULL,
    "cluster_id" BIGINT,
    "message_id" BIGINT,

    CONSTRAINT "cluster_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_recommendations" (
    "rec_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "cluster_id" BIGINT,
    "platform" "platform_enum",
    "format" TEXT,
    "headline" TEXT,
    "brief" TEXT,
    "status" TEXT DEFAULT 'idea',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_recommendations_pkey" PRIMARY KEY ("rec_id")
);

-- CreateTable
CREATE TABLE "reply_suggestions" (
    "suggestion_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "message_id" BIGINT,
    "text" TEXT NOT NULL,
    "tone" TEXT,
    "confidence" INTEGER,
    "risk_flags" JSONB NOT NULL DEFAULT '[]',
    "status" "approval_status" DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_suggestions_pkey" PRIMARY KEY ("suggestion_id")
);

-- CreateTable
CREATE TABLE "funnels" (
    "funnel_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "platform" "platform_enum",
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_per_hour" INTEGER DEFAULT 20,
    "delay_sec" INTEGER DEFAULT 30,
    "dest_url" TEXT,
    "is_active" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("funnel_id")
);

-- CreateTable
CREATE TABLE "dm_events" (
    "event_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "funnel_id" BIGINT,
    "message_id" BIGINT,
    "author_handle" TEXT,
    "dm_sent_at" TIMESTAMPTZ(6),
    "opened_at" TIMESTAMPTZ(6),
    "clicked_at" TIMESTAMPTZ(6),
    "converted" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "kpi_snapshots" (
    "snapshot_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "period_start" DATE,
    "period_end" DATE,
    "listening_kpi" DECIMAL(5,2),
    "reply_kpi" DECIMAL(5,2),
    "funnel_kpi" DECIMAL(5,2),
    "risk_events" INTEGER DEFAULT 0,
    "kpis" JSONB NOT NULL DEFAULT '[]',
    "alerts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "tracked_links" (
    "link_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "short_code" TEXT NOT NULL,
    "dest_url" TEXT NOT NULL,
    "campaign" TEXT,
    "platform" "platform_enum",
    "content_type" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_links_pkey" PRIMARY KEY ("link_id")
);

-- CreateTable
CREATE TABLE "link_events" (
    "event_id" BIGSERIAL NOT NULL,
    "link_id" BIGINT,
    "brand_id" INTEGER,
    "event_type" TEXT DEFAULT 'click',
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "creative_scores" (
    "score_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "platform" "platform_enum",
    "caption" TEXT NOT NULL,
    "grade" TEXT,
    "score" INTEGER,
    "analysis" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_scores_pkey" PRIMARY KEY ("score_id")
);

-- CreateTable
CREATE TABLE "insight_runs" (
    "run_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "messages_processed" INTEGER DEFAULT 0,
    "faqs_found" INTEGER DEFAULT 0,
    "pain_points" INTEGER DEFAULT 0,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "faq_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "run_id" BIGINT,
    "question" TEXT NOT NULL,
    "frequency" INTEGER DEFAULT 1,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("faq_id")
);

-- CreateTable
CREATE TABLE "pain_points" (
    "pp_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "run_id" BIGINT,
    "text" TEXT NOT NULL,
    "severity" TEXT,
    "frequency" INTEGER DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pain_points_pkey" PRIMARY KEY ("pp_id")
);

-- CreateTable
CREATE TABLE "war_rooms" (
    "room_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "health" TEXT,
    "summary" TEXT,
    "alerts" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "war_rooms_pkey" PRIMARY KEY ("room_id")
);

-- CreateTable
CREATE TABLE "connected_accounts" (
    "account_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "platform" "platform_enum" NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMPTZ(6),
    "account_handle" TEXT,
    "account_id_ext" TEXT,
    "scope" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "campaign_metrics" (
    "metric_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "campaign" TEXT,
    "platform" "platform_enum",
    "metric" TEXT NOT NULL,
    "value" DECIMAL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_metrics_pkey" PRIMARY KEY ("metric_id")
);

-- CreateTable
CREATE TABLE "trigger_rules" (
    "rule_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "keyword" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" INTEGER DEFAULT 80,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trigger_rules_pkey" PRIMARY KEY ("rule_id")
);

-- CreateTable
CREATE TABLE "approval_queue" (
    "queue_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "platform" "platform_enum",
    "reply_text" TEXT,
    "confidence" INTEGER,
    "status" "approval_status" DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_queue_pkey" PRIMARY KEY ("queue_id")
);

-- CreateTable
CREATE TABLE "reply_templates" (
    "template_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "name" TEXT NOT NULL DEFAULT 'Default template',
    "platform" "platform_enum",
    "trigger_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "template_text" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "use_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_templates_pkey" PRIMARY KEY ("template_id")
);

-- CreateTable
CREATE TABLE "engage_campaigns" (
    "campaign_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "platform_enum",
    "post_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "engage_all" BOOLEAN DEFAULT true,
    "engage_negative" BOOLEAN DEFAULT false,
    "tone" TEXT DEFAULT 'warm and enthusiastic',
    "reply_template" TEXT,
    "fallback_template" TEXT,
    "cta_link" TEXT,
    "image_url" TEXT,
    "tracked_link_code" TEXT,
    "auto_fire_threshold" INTEGER DEFAULT 85,
    "max_per_hour" INTEGER DEFAULT 50,
    "is_active" BOOLEAN DEFAULT true,
    "total_sent" INTEGER DEFAULT 0,
    "platform_allocation" JSONB NOT NULL DEFAULT '{"instagram":34,"facebook":33,"tiktok":33}',
    "include_likers" BOOLEAN DEFAULT true,
    "include_commenters" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engage_campaigns_pkey" PRIMARY KEY ("campaign_id")
);

-- CreateTable
CREATE TABLE "auto_engagements" (
    "engagement_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "campaign_id" BIGINT,
    "platform" "platform_enum",
    "author_handle" TEXT,
    "original_text" TEXT,
    "reply_text" TEXT,
    "image_url" TEXT,
    "tracked_link" TEXT,
    "status" TEXT,
    "fired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_engagements_pkey" PRIMARY KEY ("engagement_id")
);

-- CreateTable
CREATE TABLE "campaign_assets" (
    "asset_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "campaign_id" TEXT,
    "image_url" TEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_assets_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "campaign_post_urls" (
    "url_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "campaign_id" BIGINT,
    "platform" "platform_enum" NOT NULL,
    "post_url" TEXT NOT NULL,
    "post_id_ext" TEXT,
    "include_commenters" BOOLEAN DEFAULT true,
    "include_likers" BOOLEAN DEFAULT true,
    "status" TEXT DEFAULT 'pending',
    "total_fetched" INTEGER DEFAULT 0,
    "error_msg" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "campaign_post_urls_pkey" PRIMARY KEY ("url_id")
);

-- CreateTable
CREATE TABLE "campaign_post_engagers" (
    "engager_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER,
    "campaign_id" TEXT NOT NULL,
    "platform" "platform_enum" NOT NULL,
    "action" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_handle" TEXT,
    "original_text" TEXT,
    "status" TEXT DEFAULT 'pending',
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_post_engagers_pkey" PRIMARY KEY ("engager_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE INDEX "idx_platform_users_user" ON "platform_users"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_user_id_role_key" ON "platform_users"("user_id", "role");

-- CreateIndex
CREATE INDEX "idx_brand_memberships_user" ON "brand_memberships"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_brand_memberships_brand" ON "brand_memberships"("brand_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "brand_memberships_brand_id_user_id_key" ON "brand_memberships"("brand_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_client_signup_requests_status" ON "client_signup_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_client_signup_requests_user" ON "client_signup_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_logs_brand" ON "audit_logs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_logs_target_user" ON "audit_logs"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_hash_key" ON "team_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "idx_team_invitations_brand" ON "team_invitations"("brand_id", "status");

-- CreateIndex
CREATE INDEX "idx_team_invitations_email" ON "team_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "idx_brand_tool_access_brand" ON "brand_tool_access"("brand_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "brand_tool_access_brand_id_tool_id_key" ON "brand_tool_access"("brand_id", "tool_id");

-- CreateIndex
CREATE INDEX "idx_msgs_brand" ON "social_messages"("brand_id", "captured_at");

-- CreateIndex
CREATE INDEX "idx_msgs_sentiment" ON "social_messages"("brand_id", "sentiment");

-- CreateIndex
CREATE INDEX "idx_msgs_intent" ON "social_messages"("brand_id", "intent");

-- CreateIndex
CREATE UNIQUE INDEX "social_messages_brand_id_platform_external_id_key" ON "social_messages"("brand_id", "platform", "external_id");

-- CreateIndex
CREATE INDEX "idx_keyword_groups_brand" ON "keyword_groups"("brand_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_search_runs_brand" ON "search_runs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_search_runs_status" ON "search_runs"("status");

-- CreateIndex
CREATE INDEX "idx_search_results_run" ON "search_results"("run_id", "urgency_score", "posted_at");

-- CreateIndex
CREATE INDEX "idx_search_results_brand" ON "search_results"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_search_results_feed" ON "search_results"("brand_id", "engaged", "urgency_score");

-- CreateIndex
CREATE INDEX "idx_search_volume_run" ON "search_volume"("run_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_links_short_code_key" ON "tracked_links"("short_code");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_brand_id_platform_key" ON "connected_accounts"("brand_id", "platform");

-- CreateIndex
CREATE INDEX "idx_post_urls_brand" ON "campaign_post_urls"("brand_id", "status");

-- CreateIndex
CREATE INDEX "idx_post_engagers_campaign" ON "campaign_post_engagers"("brand_id", "campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_post_engagers_brand_id_campaign_id_platform_author_key" ON "campaign_post_engagers"("brand_id", "campaign_id", "platform", "author_id");

