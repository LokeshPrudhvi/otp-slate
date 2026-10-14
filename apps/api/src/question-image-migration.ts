// Add private MCQ assets without changing any published question or progress record.
export const questionImageMigration = `
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_uploads_purpose_check;
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_uploads_check;
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_upload_purpose;
ALTER TABLE lesson_uploads DROP CONSTRAINT IF EXISTS lesson_upload_scope;
ALTER TABLE lesson_uploads ADD CONSTRAINT lesson_upload_purpose CHECK(purpose IN ('video','assignment','question_image','crt_pdf'));
ALTER TABLE lesson_uploads ADD CONSTRAINT lesson_upload_scope CHECK (
 (purpose IN ('video','question_image','crt_pdf') AND org_id IS NULL) OR
 (purpose='assignment' AND org_id IS NOT NULL AND course_id IS NOT NULL AND version_id IS NOT NULL AND lesson_id IS NOT NULL)
);
DROP POLICY IF EXISTS lesson_question_image_read ON lesson_uploads;
-- Callers set this ID only after checking the student's exact assigned lesson/attempt.
CREATE POLICY lesson_question_image_read ON lesson_uploads FOR SELECT USING (
 purpose='question_image' AND status='ready' AND id::text=current_setting('slate.question_image_id',true)
 AND current_setting('slate.auth_id',true)<>''
);
INSERT INTO migrations(id) VALUES ('011-mcq-images') ON CONFLICT DO NOTHING;
`;
