// Shared CRT curriculum is versioned; grants always name one organization and a stable branch identity.
export const crtMigration = `
CREATE UNIQUE INDEX IF NOT EXISTS organization_branch_tenant_identity ON organization_branches(org_id,id);
CREATE TABLE IF NOT EXISTS crt_topics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 revision integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES members(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crt_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic_id uuid NOT NULL REFERENCES crt_topics(id),
 number integer NOT NULL, content jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(topic_id,number), UNIQUE(topic_id,id)
);
CREATE TABLE IF NOT EXISTS crt_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id),
 branch_id uuid NOT NULL, topic_id uuid NOT NULL, version_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,branch_id) REFERENCES organization_branches(org_id,id),
 FOREIGN KEY(topic_id,version_id) REFERENCES crt_versions(topic_id,id), UNIQUE(org_id,branch_id,topic_id)
);
CREATE INDEX IF NOT EXISTS crt_assignment_version ON crt_assignments(version_id);
CREATE TABLE IF NOT EXISTS crt_bank (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic_id uuid NOT NULL REFERENCES crt_topics(id),
 question jsonb NOT NULL, active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crt_bank_topic ON crt_bank(topic_id,active);
CREATE TABLE IF NOT EXISTS crt_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, org_id uuid NOT NULL,
 member_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('topic','practice')),
 topic_id uuid, version_id uuid, questions jsonb NOT NULL, answers jsonb,
 passing_score integer NOT NULL CHECK(passing_score BETWEEN 1 AND 100),
 read_acknowledged boolean NOT NULL DEFAULT false, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz,
 FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id),
 FOREIGN KEY(topic_id,version_id) REFERENCES crt_versions(topic_id,id),
 CHECK((kind='topic' AND topic_id IS NOT NULL AND version_id IS NOT NULL) OR (kind='practice' AND topic_id IS NULL AND version_id IS NULL)),
 UNIQUE(member_id,client_id)
);
CREATE INDEX IF NOT EXISTS crt_attempt_progress ON crt_attempts(member_id,version_id,submitted_at);
GRANT SELECT,INSERT,UPDATE ON crt_topics,crt_bank TO slate_runtime;
GRANT SELECT,INSERT ON crt_versions TO slate_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON crt_assignments TO slate_runtime;
GRANT SELECT,INSERT,UPDATE ON crt_attempts TO slate_runtime;
ALTER TABLE crt_topics ENABLE ROW LEVEL SECURITY; ALTER TABLE crt_topics FORCE ROW LEVEL SECURITY;
ALTER TABLE crt_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE crt_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE crt_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE crt_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE crt_bank ENABLE ROW LEVEL SECURITY; ALTER TABLE crt_bank FORCE ROW LEVEL SECURITY;
ALTER TABLE crt_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE crt_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crt_topic_admin ON crt_topics;
CREATE POLICY crt_topic_admin ON crt_topics USING(current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
DROP POLICY IF EXISTS crt_assignment_admin ON crt_assignments;
CREATE POLICY crt_assignment_admin ON crt_assignments USING(current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
DROP POLICY IF EXISTS crt_assignment_student ON crt_assignments;
CREATE POLICY crt_assignment_student ON crt_assignments FOR SELECT USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND EXISTS (
  SELECT 1 FROM members m JOIN organization_branches b ON b.org_id=m.org_id AND b.code=m.branch_code
  WHERE m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student' AND m.status='active'
   AND m.org_id=crt_assignments.org_id AND b.id=crt_assignments.branch_id
 )
);
DROP POLICY IF EXISTS crt_version_admin ON crt_versions;
CREATE POLICY crt_version_admin ON crt_versions USING(current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
DROP POLICY IF EXISTS crt_version_student ON crt_versions;
CREATE POLICY crt_version_student ON crt_versions FOR SELECT USING(EXISTS(SELECT 1 FROM crt_assignments a WHERE a.version_id=crt_versions.id));
DROP POLICY IF EXISTS crt_bank_admin ON crt_bank;
CREATE POLICY crt_bank_admin ON crt_bank USING(current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
DROP POLICY IF EXISTS crt_bank_student ON crt_bank;
CREATE POLICY crt_bank_student ON crt_bank FOR SELECT USING(active AND EXISTS(SELECT 1 FROM crt_assignments a WHERE a.topic_id=crt_bank.topic_id));
DROP POLICY IF EXISTS crt_attempt_boundary ON crt_attempts;
CREATE POLICY crt_attempt_boundary ON crt_attempts USING (
 current_setting('slate.is_platform',true)='true' OR (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM members m WHERE m.id=crt_attempts.member_id AND m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student'))
) WITH CHECK (
 current_setting('slate.is_platform',true)='true' OR (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM members m WHERE m.id=crt_attempts.member_id AND m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student'))
);
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_upload_purpose;
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_upload_scope;
ALTER TABLE lesson_uploads ADD CONSTRAINT lesson_upload_purpose CHECK(purpose IN ('video','assignment','question_image','crt_pdf','course_cover'));
ALTER TABLE lesson_uploads ADD CONSTRAINT lesson_upload_scope CHECK (
 (purpose IN ('video','question_image','crt_pdf','course_cover') AND org_id IS NULL) OR
 (purpose='assignment' AND org_id IS NOT NULL AND course_id IS NOT NULL AND version_id IS NOT NULL AND lesson_id IS NOT NULL)
);
DROP POLICY IF EXISTS crt_pdf_read ON lesson_uploads;
CREATE POLICY crt_pdf_read ON lesson_uploads FOR SELECT USING(purpose='crt_pdf' AND status='ready'
 AND id::text=current_setting('slate.crt_pdf_id',true) AND current_setting('slate.auth_id',true)<>'');
INSERT INTO migrations(id) VALUES ('012-crt-curriculum') ON CONFLICT DO NOTHING;
`;
