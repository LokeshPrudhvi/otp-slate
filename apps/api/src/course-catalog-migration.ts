// Add only course presentation metadata, navigation history and review requests.
// Published lesson versions, assigned access and student progress stay unchanged.
export const courseCatalogMigration = `
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_upload_id uuid REFERENCES lesson_uploads(id);
CREATE TABLE IF NOT EXISTS course_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, member_id uuid NOT NULL,
 course_id uuid NOT NULL REFERENCES courses(id), last_opened_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id), UNIQUE(member_id,course_id)
);
CREATE INDEX IF NOT EXISTS course_activity_recent ON course_activity(member_id,last_opened_at DESC);
CREATE TABLE IF NOT EXISTS course_enrollment_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, student_member_id uuid NOT NULL,
 course_id uuid NOT NULL REFERENCES courses(id), student_name text NOT NULL, student_email text NOT NULL,
 student_id text, organization_name text NOT NULL, branch_name text, branch_code text, course_title text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed')),
 outbox_id uuid NOT NULL REFERENCES outbox(id), created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz, reviewed_at timestamptz, reviewed_by uuid REFERENCES members(id),
 FOREIGN KEY(org_id,student_member_id) REFERENCES members(org_id,id), UNIQUE(student_member_id,course_id)
);
CREATE INDEX IF NOT EXISTS course_request_inbox ON course_enrollment_requests(created_at DESC);
GRANT SELECT,INSERT,UPDATE ON course_activity,course_enrollment_requests TO slate_runtime;
REVOKE ALL ON course_activity,course_enrollment_requests FROM slate_reader,slate_mailbox,slate_registration;
ALTER TABLE course_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_activity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_activity_boundary ON course_activity;
CREATE POLICY course_activity_boundary ON course_activity USING (
 current_setting('slate.is_platform',true)='true' OR
 (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND member_id IN
  (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
) WITH CHECK (
 current_setting('slate.is_platform',true)='true' OR
 (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND member_id IN
  (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
);
ALTER TABLE course_enrollment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollment_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_request_select ON course_enrollment_requests;
CREATE POLICY course_request_select ON course_enrollment_requests FOR SELECT USING (
 current_setting('slate.is_platform',true)='true' OR
 (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND student_member_id IN
  (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student'))
);
DROP POLICY IF EXISTS course_request_insert ON course_enrollment_requests;
CREATE POLICY course_request_insert ON course_enrollment_requests FOR INSERT WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND student_member_id IN
  (SELECT id FROM members WHERE auth_user_id=current_setting('slate.auth_id',true) AND role='student')
 AND status='pending' AND read_at IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL
);
DROP POLICY IF EXISTS course_request_update ON course_enrollment_requests;
CREATE POLICY course_request_update ON course_enrollment_requests FOR UPDATE USING (
 current_setting('slate.is_platform',true)='true'
) WITH CHECK (current_setting('slate.is_platform',true)='true');
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_upload_purpose;
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_upload_scope;
ALTER TABLE lesson_uploads ADD CONSTRAINT lesson_upload_purpose CHECK(purpose IN ('video','assignment','question_image','crt_pdf','course_cover'));
ALTER TABLE lesson_uploads ADD CONSTRAINT lesson_upload_scope CHECK (
 (purpose IN ('video','question_image','crt_pdf','course_cover') AND org_id IS NULL) OR
 (purpose='assignment' AND org_id IS NOT NULL AND course_id IS NOT NULL AND version_id IS NOT NULL AND lesson_id IS NOT NULL)
);
DROP POLICY IF EXISTS lesson_course_cover_read ON lesson_uploads;
-- The catalog service sets these IDs only after authorizing metadata discovery or enrollment.
CREATE POLICY lesson_course_cover_read ON lesson_uploads FOR SELECT USING (
 purpose='course_cover' AND status='ready' AND id::text = ANY(string_to_array(current_setting('slate.course_cover_ids',true),','))
 AND current_setting('slate.auth_id',true)<>''
);
INSERT INTO migrations(id) VALUES ('015-course-catalog-requests') ON CONFLICT DO NOTHING;
`;
