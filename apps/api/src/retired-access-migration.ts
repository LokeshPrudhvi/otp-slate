// Remove retired portal preferences only. Course pins, enrollments, progress and
// CRT/practice records remain untouched. Runtime readers also ignore these keys
// so rolling deployments are safe before this owner-only migration runs.
export const retiredAccessMigration = `
DO $$
DECLARE old_platform text := current_setting('slate.is_platform',true);
BEGIN
 IF NOT EXISTS (SELECT 1 FROM migrations WHERE id='014-retired-access-preferences') THEN
  PERFORM set_config('slate.is_platform','true',true);
  WITH changed_policies AS (
   UPDATE access_policies SET
    policy = CASE WHEN jsonb_typeof(policy->'features')='array'
     THEN jsonb_set(policy - 'toolkitTrackIds','{features}',(policy->'features') - 'toolkit')
     ELSE policy - 'toolkitTrackIds' END,
    updated_at = now()
   WHERE policy ? 'toolkitTrackIds' OR (policy->'features') ? 'toolkit'
   RETURNING org_id
  ), changed_members AS (
   UPDATE members SET features = features - 'toolkit', updated_at = now()
   WHERE jsonb_typeof(features)='array' AND features ? 'toolkit'
   RETURNING org_id
  )
  UPDATE organizations SET
   portal_display = portal_display - 'toolkitTitle',
   access_revision = access_revision + 1,
   updated_at = now()
  WHERE portal_display ? 'toolkitTitle'
   OR id IN (SELECT org_id FROM changed_policies UNION SELECT org_id FROM changed_members);
  INSERT INTO migrations(id) VALUES ('014-retired-access-preferences');
  PERFORM set_config('slate.is_platform',coalesce(old_platform,''),true);
 END IF;
END $$;
`;
