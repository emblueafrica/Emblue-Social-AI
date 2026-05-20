ALTER TYPE brand_role ADD VALUE IF NOT EXISTS 'client_viewer';
ALTER TYPE brand_role ADD VALUE IF NOT EXISTS 'client_approver';

DO $$ BEGIN
  CREATE TYPE brand_account_type AS ENUM ('b2b_licensed','b2c_managed','internal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS account_type brand_account_type NOT NULL DEFAULT 'b2b_licensed';

ALTER TABLE client_signup_requests
  ADD COLUMN IF NOT EXISTS requested_account_type brand_account_type NOT NULL DEFAULT 'b2b_licensed';

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
