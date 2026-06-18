ALTER TABLE "brands" ADD COLUMN "managed_by_user_id" UUID;

CREATE INDEX "idx_brands_managed_by" ON "brands"("managed_by_user_id");
