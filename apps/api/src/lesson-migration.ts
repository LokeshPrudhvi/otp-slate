// Additive lesson assets and version-bound submissions; existing course history is unchanged.
export const lessonMigration = `
CREATE TABLE IF NOT EXISTS lesson_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES members(id),
 org_id uuid REFERENCES organizations(id), purpose text NOT NULL CHECK(purpose IN ('video','assignment')),
 file_name text NOT NULL, content_type text NOT NULL, size bigint NOT NULL CHECK(size>0),
 staging_key text NOT NULL UNIQUE, object_key text UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 course_id uuid, version_id uuid REFERENCES course_versions(id), lesson_id text,
 created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz,
 CHECK ((purpose='video' AND org_id IS NULL) OR (purpose='assignment' AND org_id IS NOT NULL AND course_id IS NOT NULL AND version_id IS NOT NULL AND lesson_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS lesson_upload_owner ON lesson_uploads(owner_id,created_at);
CREATE TABLE IF NOT EXISTS lesson_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, member_id uuid NOT NULL,
 course_id uuid NOT NULL, version_id uuid NOT NULL, lesson_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('assignment','quiz')), answer text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '',
 files jsonb NOT NULL DEFAULT '[]', score integer, passed boolean, quiz_results jsonb NOT NULL DEFAULT '[]', submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id), FOREIGN KEY(course_id,version_id) REFERENCES course_versions(course_id,id),
 UNIQUE(member_id,version_id,lesson_id)
);
CREATE INDEX IF NOT EXISTS lesson_submission_course ON lesson_submissions(course_id,submitted_at DESC);
GRANT SELECT,INSERT,UPDATE ON lesson_uploads,lesson_submissions TO slate_runtime;
REVOKE ALL ON lesson_uploads,lesson_submissions FROM slate_reader,slate_mailbox,slate_registration;
ALTER TABLE lesson_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_uploads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_upload_boundary ON lesson_uploads;
CREATE POLICY lesson_upload_boundary ON lesson_uploads USING (
 current_setting('slate.is_platform',true)='true' OR
 (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND owner_id IN (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
) WITH CHECK (
 current_setting('slate.is_platform',true)='true' OR
 (purpose='assignment' AND org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND owner_id IN (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
);
-- Student video retrieval is authorized against a pinned lesson before this narrowly scoped reader is used.
DROP POLICY IF EXISTS lesson_video_read ON lesson_uploads;
CREATE POLICY lesson_video_read ON lesson_uploads FOR SELECT USING (
 purpose='video' AND status='ready' AND id::text=current_setting('slate.lesson_upload_id',true) AND current_setting('slate.auth_id',true)<>''
);
ALTER TABLE lesson_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_submission_boundary ON lesson_submissions;
CREATE POLICY lesson_submission_boundary ON lesson_submissions USING (
 current_setting('slate.is_platform',true)='true' OR
 (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND member_id IN (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
) WITH CHECK (
 current_setting('slate.is_platform',true)='true' OR
 (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND member_id IN (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
);
INSERT INTO migrations(id) VALUES ('006-rich-lessons') ON CONFLICT DO NOTHING;
`;
