// Additive access controls. Existing grants, progress and legacy feature assignments remain intact.
export const accessMigration = `
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS access_revision integer NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS portal_display jsonb;
CREATE TABLE IF NOT EXISTS access_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES organizations(id),
 scope text NOT NULL CHECK(scope IN ('organization','branch','student')),
 target_key text NOT NULL,
 branch_name text,
 policy jsonb NOT NULL,
 course_versions jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,scope,target_key)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON access_policies TO slate_runtime;
GRANT SELECT ON access_policies TO slate_reader;
ALTER TABLE access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS access_policy_read ON access_policies;
CREATE POLICY access_policy_read ON access_policies FOR SELECT USING (current_setting('slate.is_platform',true)='true' OR org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid);
DROP POLICY IF EXISTS access_policy_write ON access_policies;
CREATE POLICY access_policy_write ON access_policies FOR ALL USING (current_setting('slate.is_platform',true)='true') WITH CHECK (current_setting('slate.is_platform',true)='true');
INSERT INTO migrations(id) VALUES ('004-access-policies') ON CONFLICT DO NOTHING;
`;
