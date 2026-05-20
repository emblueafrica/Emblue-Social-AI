DO $$ BEGIN
  CREATE TYPE platform_role AS ENUM ('super_admin','platform_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brand_role AS ENUM ('client_owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signup_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT,
  phone      TEXT,
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

INSERT INTO app_users (user_id, email)
SELECT DISTINCT b.owner_user_id, COALESCE(au.email, CONCAT(b.owner_user_id::TEXT, '@legacy.local'))
FROM brands b
LEFT JOIN auth.users au ON au.id = b.owner_user_id
WHERE b.owner_user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO brand_memberships (brand_id, user_id, role, is_active)
SELECT b.brand_id, b.owner_user_id, 'client_owner', TRUE
FROM brands b
WHERE b.owner_user_id IS NOT NULL
ON CONFLICT (brand_id, user_id) DO NOTHING;
