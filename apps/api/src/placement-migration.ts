export const placementMigration = `
CREATE TABLE IF NOT EXISTS placement_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('certification','company')),
 title text NOT NULL, provider text NOT NULL, description text NOT NULL DEFAULT '', logo_url text NOT NULL DEFAULT '',
 url text NOT NULL DEFAULT '', hiring_procedure text NOT NULL DEFAULT '', papers jsonb NOT NULL DEFAULT '[]',
 practice_questions jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS placement_resource_catalog ON placement_resources(kind,status,updated_at DESC);
ALTER TABLE placement_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE placement_resources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS placement_read ON placement_resources;
CREATE POLICY placement_read ON placement_resources FOR SELECT USING (
 current_setting('slate.is_platform',true)='true' OR (status='published' AND current_setting('slate.auth_id',true)<>'')
);
DROP POLICY IF EXISTS placement_manage ON placement_resources;
CREATE POLICY placement_manage ON placement_resources FOR ALL USING (current_setting('slate.is_platform',true)='true') WITH CHECK (current_setting('slate.is_platform',true)='true');
GRANT SELECT,INSERT,UPDATE,DELETE ON placement_resources TO slate_runtime;
INSERT INTO migrations(id) VALUES ('022-placement-resources') ON CONFLICT DO NOTHING;
`;
