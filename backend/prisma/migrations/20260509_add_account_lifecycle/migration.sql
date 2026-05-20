ALTER TYPE brand_role ADD VALUE IF NOT EXISTS 'client_member';

DO $$ BEGIN
  CREATE TYPE app_user_status AS ENUM ('pending','active','suspended','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE team_invitation_status AS ENUM ('pending','accepted','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS status app_user_status NOT NULL DEFAULT 'active';

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
