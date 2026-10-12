// Branch edits need narrowly scoped updates; public registration remains read-only
// on the catalog and organizations. Existing branch catalog data is unchanged.
export const branchEditMigration = `
ALTER TABLE organization_branches ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS organization_branch_identity ON organization_branches(id);
GRANT UPDATE(code,name) ON organization_branches TO slate_runtime;
DROP POLICY IF EXISTS branch_update ON organization_branches;
CREATE POLICY branch_update ON organization_branches FOR UPDATE TO slate_runtime
 USING(current_setting('slate.is_platform',true)='true')
 WITH CHECK(current_setting('slate.is_platform',true)='true');
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details jsonb;
INSERT INTO migrations(id) VALUES ('009-branch-editing') ON CONFLICT DO NOTHING;
`;
