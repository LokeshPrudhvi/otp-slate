// Organization-wide CRT grants use a null branch, preserving all existing grants
// and immutable content/attempt records. Keep this after migration 012 on reruns.
export const crtAllBranchesMigration = `
ALTER TABLE crt_assignments ALTER COLUMN branch_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crt_assignment_organization_topic
 ON crt_assignments(org_id,topic_id) WHERE branch_id IS NULL;
DROP POLICY IF EXISTS crt_assignment_student ON crt_assignments;
CREATE POLICY crt_assignment_student ON crt_assignments FOR SELECT USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND EXISTS (
  SELECT 1 FROM members m JOIN organization_branches b ON b.org_id=m.org_id AND b.code=m.branch_code
  WHERE m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student' AND m.status='active'
   AND m.org_id=crt_assignments.org_id
   AND (crt_assignments.branch_id IS NULL OR b.id=crt_assignments.branch_id)
 )
);
INSERT INTO migrations(id) VALUES ('013-crt-all-branches') ON CONFLICT DO NOTHING;
`;
