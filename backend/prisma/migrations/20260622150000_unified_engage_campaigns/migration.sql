CREATE TYPE "campaign_mode" AS ENUM ('live', 'post_url', 'keyword');
CREATE TYPE "campaign_scope_type" AS ENUM ('all_owned_posts', 'selected_posts');
CREATE TYPE "campaign_reply_mode" AS ENUM ('public', 'dm_with_public_fallback', 'dm_only');

ALTER TABLE "engage_campaigns"
  ADD COLUMN "mode" "campaign_mode" NOT NULL DEFAULT 'post_url',
  ADD COLUMN "platforms" "platform_enum"[] NOT NULL DEFAULT ARRAY[]::"platform_enum"[],
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scope_type" "campaign_scope_type" NOT NULL DEFAULT 'selected_posts',
  ADD COLUMN "reply_mode" "campaign_reply_mode" NOT NULL DEFAULT 'public',
  ADD COLUMN "max_dm_per_day" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "spacing_minutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "mode_config" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "preview_fetched_at" TIMESTAMPTZ,
  ADD COLUMN "preview_expires_at" TIMESTAMPTZ;

UPDATE "engage_campaigns"
SET "mode" = CASE
  WHEN source_mode = 'keyword' THEN 'keyword'::"campaign_mode"
  ELSE 'post_url'::"campaign_mode"
END;

UPDATE "engage_campaigns" AS campaign
SET "platforms" = COALESCE(
  (
    SELECT ARRAY_AGG(entry.key::"platform_enum" ORDER BY entry.key)
    FROM JSONB_EACH_TEXT(campaign."platform_allocation"::JSONB) AS entry
    WHERE entry.key IN ('instagram', 'facebook', 'tiktok', 'x')
      AND entry.value::NUMERIC > 0
  ),
  CASE
    WHEN campaign."platform" IS NOT NULL THEN ARRAY[campaign."platform"]::"platform_enum"[]
    ELSE ARRAY[]::"platform_enum"[]
  END
);

ALTER TABLE "campaign_post_engagers"
  ADD COLUMN "profile_classification" TEXT,
  ADD COLUMN "profile_follower_count" INTEGER,
  ADD COLUMN "profile_verified" BOOLEAN,
  ADD COLUMN "profile_account_created_at" TIMESTAMPTZ,
  ADD COLUMN "profile_status" TEXT;

ALTER TABLE "campaign_delivery_attempts"
  ADD COLUMN "bull_job_id" TEXT,
  ADD COLUMN "scheduled_at" TIMESTAMPTZ,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ;

CREATE INDEX "idx_engage_campaigns_mode"
  ON "engage_campaigns" ("brand_id", "mode", "is_active", "priority");

CREATE INDEX "idx_campaign_delivery_schedule"
  ON "campaign_delivery_attempts" ("brand_id", "status", "next_attempt_at");
