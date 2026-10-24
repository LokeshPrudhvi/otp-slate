export const jobLogoMigration = `
CREATE TABLE IF NOT EXISTS company_logos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_name text NOT NULL, company_key text NOT NULL,
 sha256 text NOT NULL UNIQUE CHECK(length(sha256)=64), object_key text NOT NULL UNIQUE,
 file_name text NOT NULL, content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 size integer NOT NULL CHECK(size>0 AND size<=524288), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_logo_lookup ON company_logos(company_key,created_at DESC);
ALTER TABLE company_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_logos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_logo_read ON company_logos;
CREATE POLICY company_logo_read ON company_logos FOR SELECT USING (current_setting('slate.is_platform',true)='true' OR current_setting('slate.auth_id',true)<>'');
DROP POLICY IF EXISTS company_logo_manage ON company_logos;
CREATE POLICY company_logo_manage ON company_logos FOR ALL USING (current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
GRANT SELECT,INSERT ON company_logos TO slate_runtime;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS logo_id uuid REFERENCES company_logos(id);
INSERT INTO migrations(id) VALUES ('023-reusable-job-logos') ON CONFLICT DO NOTHING;
`;
