ALTER TABLE "engage_campaigns"
  ADD COLUMN "source_mode" TEXT NOT NULL DEFAULT 'existing',
  ADD COLUMN "post_caption" TEXT,
  ADD COLUMN "public_reply_template" TEXT,
  ADD COLUMN "private_followup_template" TEXT,
  ADD COLUMN "event_settings" JSONB NOT NULL DEFAULT '{"comments":true,"likes":true,"reposts":true,"mentions":true,"dms":true}',
  ADD COLUMN "activation_status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "last_activated_at" TIMESTAMPTZ(6);

ALTER TABLE "campaign_assets"
  ADD COLUMN "public_id" TEXT,
  ADD COLUMN "media_type" TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN "mime_type" TEXT,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "campaign_post_urls"
  ADD COLUMN "source_mode" TEXT NOT NULL DEFAULT 'existing',
  ADD COLUMN "binding_status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "delete_status" TEXT,
  ADD COLUMN "superseded_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_post_urls_campaign_binding"
  ON "campaign_post_urls" ("brand_id", "campaign_id", "binding_status");
