// Organization and branch notices are independent of mailbox messages and email.
export const announcementMigration = `
CREATE TABLE IF NOT EXISTS announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL UNIQUE,
 org_id uuid NOT NULL REFERENCES organizations(id), branch_code text, branch_name text,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 150),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),
 format text NOT NULL CHECK(format IN ('plain','markdown')),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','archived')),
 created_by uuid NOT NULL REFERENCES members(id), author_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(branch_code IS NULL OR (branch_code = upper(btrim(branch_code)) AND branch_code ~ '^[A-Z0-9_-]{1,20}$'))
);
CREATE INDEX IF NOT EXISTS announcement_org_feed ON announcements(org_id,status,created_at DESC,id DESC);
GRANT SELECT,INSERT,UPDATE ON announcements TO slate_runtime;
REVOKE ALL ON announcements FROM slate_reader,slate_mailbox,slate_registration;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS announcement_read ON announcements;
CREATE POLICY announcement_read ON announcements FOR SELECT USING (
 current_setting('slate.is_platform',true)='true' OR (
  org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND status='published'
  AND EXISTS (SELECT 1 FROM organizations o WHERE o.id=announcements.org_id AND o.status='active')
  AND EXISTS (SELECT 1 FROM members m WHERE m.auth_user_id=current_setting('slate.auth_id',true)
   AND m.org_id=announcements.org_id AND m.role='student' AND m.status='active'
   AND (announcements.branch_code IS NULL OR announcements.branch_code=upper(btrim(m.branch_code))))
 ));
DROP POLICY IF EXISTS announcement_insert ON announcements;
CREATE POLICY announcement_insert ON announcements FOR INSERT WITH CHECK (
 current_setting('slate.is_platform',true)='true'
);
DROP POLICY IF EXISTS announcement_update ON announcements;
CREATE POLICY announcement_update ON announcements FOR UPDATE USING (
 current_setting('slate.is_platform',true)='true'
) WITH CHECK (current_setting('slate.is_platform',true)='true');
INSERT INTO migrations(id) VALUES ('007-announcements') ON CONFLICT DO NOTHING;
`;
