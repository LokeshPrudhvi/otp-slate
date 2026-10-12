// Canonical academic branches. No student, enrollment or progress rows are deleted.
export const branchMigration = `
CREATE TABLE IF NOT EXISTS organization_branches (
 org_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT organization_branch_code PRIMARY KEY(org_id,code),
 CHECK(code=upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9 ._/-]{0,31}$')
);
GRANT SELECT,INSERT ON organization_branches TO slate_runtime;
GRANT SELECT ON organization_branches TO slate_reader,slate_registration;
ALTER TABLE organization_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_read ON organization_branches;
CREATE POLICY branch_read ON organization_branches FOR SELECT TO slate_runtime,slate_reader USING (
 current_setting('slate.is_platform',true)='true' OR org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
);
DROP POLICY IF EXISTS branch_create ON organization_branches;
CREATE POLICY branch_create ON organization_branches FOR INSERT TO slate_runtime WITH CHECK (
 current_setting('slate.is_platform',true)='true'
);
DROP POLICY IF EXISTS registration_branch_catalog ON organization_branches;
CREATE POLICY registration_branch_catalog ON organization_branches FOR SELECT TO slate_registration USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS (SELECT 1 FROM organizations o WHERE o.id=organization_branches.org_id AND o.status='active')
);
DO $$
DECLARE old_platform text := current_setting('slate.is_platform',true);
BEGIN
 IF NOT EXISTS (SELECT 1 FROM migrations WHERE id='008-organization-branches') THEN
  PERFORM set_config('slate.is_platform','true',true);
  IF EXISTS (SELECT 1 FROM access_policies WHERE scope='branch' GROUP BY org_id,upper(btrim(target_key)) HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Conflicting legacy branch policies require review before branch catalog migration';
  END IF;
  INSERT INTO organization_branches(org_id,code,name)
  SELECT DISTINCT ON (org_id,code) org_id,code,coalesce(name,code)
  FROM (
   SELECT org_id,upper(btrim(target_key)) code,nullif(regexp_replace(btrim(branch_name),'[[:space:]]+',' ','g'),'') name,0 priority,id::text stable FROM access_policies WHERE scope='branch'
   UNION ALL SELECT org_id,upper(btrim(branch_code)),nullif(regexp_replace(btrim(branch_name),'[[:space:]]+',' ','g'),''),CASE WHEN status='active' THEN 1 ELSE 2 END,id::text FROM members WHERE org_id IS NOT NULL AND role='student'
   UNION ALL SELECT org_id,upper(btrim(branch_code)),nullif(regexp_replace(btrim(branch_name),'[[:space:]]+',' ','g'),''),CASE WHEN status='pending' THEN 3 ELSE 4 END,id::text FROM registration_requests
   UNION ALL SELECT org_id,upper(btrim(branch_code)),nullif(regexp_replace(btrim(branch_name),'[[:space:]]+',' ','g'),''),5,id::text FROM announcements
  ) legacy WHERE code IS NOT NULL AND code<>''
  ORDER BY org_id,code,(name IS NULL),priority,stable
  ON CONFLICT(org_id,code) DO NOTHING;
  UPDATE members m SET branch_code=b.code,branch_name=b.name FROM organization_branches b
   WHERE m.org_id=b.org_id AND upper(btrim(m.branch_code))=b.code
   AND (m.branch_code IS DISTINCT FROM b.code OR m.branch_name IS DISTINCT FROM b.name);
  UPDATE registration_requests r SET branch_code=b.code,branch_name=b.name FROM organization_branches b
   WHERE r.org_id=b.org_id AND upper(btrim(r.branch_code))=b.code
   AND (r.branch_code IS DISTINCT FROM b.code OR r.branch_name IS DISTINCT FROM b.name);
  UPDATE access_policies p SET target_key=b.code,branch_name=b.name FROM organization_branches b
   WHERE p.org_id=b.org_id AND p.scope='branch' AND upper(btrim(p.target_key))=b.code
   AND (p.target_key IS DISTINCT FROM b.code OR p.branch_name IS DISTINCT FROM b.name);
  PERFORM set_config('slate.is_platform',coalesce(old_platform,''),true);
 END IF;
END $$;
-- Preserve distinct legacy codes even if their names match; new creation rejects
-- duplicate names while an administrator can review such pre-existing records.
CREATE INDEX IF NOT EXISTS organization_branch_name ON organization_branches(org_id,lower(name));
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_branch_code_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_branch_code_check CHECK (
 branch_code IS NULL OR (branch_code=upper(btrim(branch_code)) AND branch_code ~ '^[A-Z0-9][A-Z0-9 ._/-]{0,31}$')
);
DROP POLICY IF EXISTS registration_submit ON registration_requests;
CREATE POLICY registration_submit ON registration_requests FOR INSERT TO slate_registration WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND status='pending' AND source='registration'
 AND member_id IS NULL AND welcome_outbox_id IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL
 AND EXISTS (SELECT 1 FROM organization_branches b WHERE b.org_id=registration_requests.org_id AND b.code=registration_requests.branch_code AND b.name=registration_requests.branch_name)
);
INSERT INTO migrations(id) VALUES ('008-organization-branches') ON CONFLICT DO NOTHING;
`;
