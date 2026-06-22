ALTER TABLE "keyword_groups"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'listening',
  ADD COLUMN "campaign_id" BIGINT;

CREATE UNIQUE INDEX "uq_keyword_groups_campaign" ON "keyword_groups" ("campaign_id");

ALTER TABLE "engage_campaigns"
  ADD COLUMN "max_per_day" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "intent_filter" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "urgency_threshold" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "reply_template_id" BIGINT,
  ADD COLUMN "public_reply_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "direct_message_enabled" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "campaign_post_engagers"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'post',
  ADD COLUMN "intent" "intent_enum",
  ADD COLUMN "urgency_score" INTEGER,
  ADD COLUMN "reply_confidence" INTEGER,
  ADD COLUMN "first_delivered_at" TIMESTAMPTZ(6);

UPDATE "campaign_post_engagers"
SET "external_event_id" = COALESCE(
  "external_event_id",
  "comment_id",
  md5(COALESCE("campaign_id", '') || ':' || "platform"::TEXT || ':' || COALESCE("author_id", '') || ':' || COALESCE("original_text", ''))
);

DELETE FROM "campaign_post_engagers" duplicate
USING "campaign_post_engagers" keeper
WHERE duplicate."engager_id" > keeper."engager_id"
  AND duplicate."brand_id" IS NOT DISTINCT FROM keeper."brand_id"
  AND duplicate."campaign_id" = keeper."campaign_id"
  AND duplicate."platform" = keeper."platform"
  AND duplicate."external_event_id" = keeper."external_event_id";

ALTER TABLE "campaign_post_engagers"
  ALTER COLUMN "external_event_id" SET NOT NULL;

ALTER TABLE "campaign_post_engagers"
  DROP CONSTRAINT IF EXISTS "campaign_post_engagers_brand_id_campaign_id_platform_author_id_key";

CREATE UNIQUE INDEX "uq_campaign_engagement_external_event"
  ON "campaign_post_engagers" ("brand_id", "campaign_id", "platform", "external_event_id");

CREATE TABLE "campaign_delivery_attempts" (
  "delivery_id" BIGSERIAL PRIMARY KEY,
  "engager_id" BIGINT NOT NULL,
  "brand_id" INTEGER NOT NULL,
  "campaign_id" BIGINT NOT NULL,
  "platform" "platform_enum" NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "external_message_id" TEXT,
  "error" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "delivered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "uq_campaign_delivery_channel" ON "campaign_delivery_attempts" ("engager_id", "channel");
CREATE INDEX "idx_campaign_delivery_status" ON "campaign_delivery_attempts" ("brand_id", "campaign_id", "status");

CREATE TABLE "scheduler_leases" (
  "lease_id" BIGSERIAL PRIMARY KEY,
  "brand_id" INTEGER NOT NULL,
  "job_type" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "lease_until" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "uq_scheduler_lease_brand_job" ON "scheduler_leases" ("brand_id", "job_type");
