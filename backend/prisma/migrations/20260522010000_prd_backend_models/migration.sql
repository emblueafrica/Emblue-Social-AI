-- PRD backend completion: alerts engine, creative benchmarks, DM funnel templates.

-- AlterTable: funnels — funnel name + engagement-action triggers
ALTER TABLE "funnels" ADD COLUMN "name" TEXT,
ADD COLUMN "trigger_actions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: dm_events — delivery status + sent copy
ALTER TABLE "dm_events" ADD COLUMN "status" TEXT DEFAULT 'queued',
ADD COLUMN "dm_text" TEXT;

-- CreateTable: alerts
CREATE TABLE "alerts" (
    "alert_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_to_user_id" UUID,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("alert_id")
);

CREATE INDEX "idx_alerts_brand" ON "alerts"("brand_id", "status", "created_at");

-- CreateTable: creative_benchmarks
CREATE TABLE "creative_benchmarks" (
    "benchmark_id" BIGSERIAL NOT NULL,
    "platform" "platform_enum",
    "format" TEXT,
    "metric" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_benchmarks_pkey" PRIMARY KEY ("benchmark_id")
);

-- CreateTable: dm_templates
CREATE TABLE "dm_templates" (
    "template_id" BIGSERIAL NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "funnel_id" BIGINT,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta_link" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_templates_pkey" PRIMARY KEY ("template_id")
);

CREATE INDEX "idx_dm_templates_brand" ON "dm_templates"("brand_id", "funnel_id");
