CREATE TABLE IF NOT EXISTS brand_tool_access (
  access_id    BIGSERIAL PRIMARY KEY,
  brand_id     INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
  tool_id      TEXT NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  plan_name    TEXT,
  activated_at TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  UNIQUE(brand_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_tool_access_brand
  ON brand_tool_access(brand_id, is_active);

INSERT INTO brand_tool_access (brand_id, tool_id, plan_name, is_active)
SELECT b.brand_id, tools.tool_id, 'legacy', TRUE
FROM brands b
CROSS JOIN (
  VALUES
    ('tool_1'),
    ('tool_2'),
    ('tool_3'),
    ('tool_4'),
    ('tool_5'),
    ('tool_6'),
    ('tool_7'),
    ('tool_8'),
    ('tool_9'),
    ('tool_10')
) AS tools(tool_id)
ON CONFLICT (brand_id, tool_id) DO NOTHING;

ALTER TABLE brand_tool_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_tool_access_own" ON brand_tool_access;
CREATE POLICY "brand_tool_access_own" ON brand_tool_access
  FOR SELECT USING (brand_id IN (SELECT brand_id FROM brands WHERE owner_user_id = auth.uid()));
