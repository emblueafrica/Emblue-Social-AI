ALTER TABLE "approval_queue"
  ADD COLUMN "campaign_id" BIGINT,
  ADD COLUMN "delivery_error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "idx_approval_queue_campaign"
  ON "approval_queue" ("brand_id", "campaign_id", "status");

ALTER TABLE "campaign_post_engagers"
  ADD COLUMN "platform_author_id" TEXT,
  ADD COLUMN "external_event_id" TEXT,
  ADD COLUMN "comment_id" TEXT,
  ADD COLUMN "post_id" TEXT,
  ADD COLUMN "reply_text" TEXT,
  ADD COLUMN "delivery_error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "approval_queue" aq
SET "campaign_id" = cpe."campaign_id"::BIGINT,
    "updated_at" = CURRENT_TIMESTAMP
FROM "campaign_post_engagers" cpe
WHERE aq."status" = 'pending'
  AND cpe."campaign_id" ~ '^[0-9]+$'
  AND aq."brand_id" = cpe."brand_id"
  AND aq."platform" = cpe."platform"
  AND (
    (aq."tweet_id" IS NOT NULL AND aq."tweet_id" = cpe."author_id") OR
    (aq."comment_id" IS NOT NULL AND aq."comment_id" = cpe."author_id")
  );

UPDATE "approval_queue"
SET "status" = 'rejected',
    "delivery_error" = 'Moved to Campaign Activity during campaign queue migration.',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'pending' AND "campaign_id" IS NOT NULL;
