// Preserve immutable versions and enrollment history while allowing catalog retirement.
// Run through the existing migration runner; rehearse on an isolated Neon branch first.
export const courseLifecycleMigration = `
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM migrations WHERE id = '005-course-lifecycle') THEN
  ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_status_check;
  ALTER TABLE courses DROP CONSTRAINT IF EXISTS slate_courses_status_check;
  ALTER TABLE courses ADD CONSTRAINT courses_status_check CHECK(status IN ('draft','published','archived'));
  INSERT INTO migrations(id) VALUES ('005-course-lifecycle');
 END IF;
END $$;
`;
