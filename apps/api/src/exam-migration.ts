// Published exams retain their questions and recipient member IDs permanently.
// Answer keys are separated so a student-scoped database query cannot read them.
export const examMigration =
  `
CREATE TABLE IF NOT EXISTS live_exams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL UNIQUE,
 org_id uuid NOT NULL REFERENCES organizations(id), created_by uuid NOT NULL REFERENCES members(id),
 title text NOT NULL, description text NOT NULL DEFAULT '', instructions text NOT NULL DEFAULT '', passing_percentage integer NOT NULL DEFAULT 60 CHECK(passing_percentage BETWEEN 0 AND 100), monitoring jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
 opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL, coding_grading text NOT NULL DEFAULT 'manual' CHECK(coding_grading IN ('manual','automatic')), duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 480),
 audience jsonb NOT NULL, public_questions jsonb NOT NULL DEFAULT '[]',
 revision integer NOT NULL DEFAULT 1, published_at timestamptz, results_released_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(closes_at > opens_at), UNIQUE(org_id,id)
);
CREATE TABLE IF NOT EXISTS live_exam_questions (
 exam_id uuid PRIMARY KEY REFERENCES live_exams(id), org_id uuid NOT NULL REFERENCES organizations(id),
 questions jsonb NOT NULL, FOREIGN KEY(org_id,exam_id) REFERENCES live_exams(org_id,id)
);
CREATE TABLE IF NOT EXISTS live_exam_roster (
 exam_id uuid NOT NULL REFERENCES live_exams(id), org_id uuid NOT NULL, member_id uuid NOT NULL,
 name text NOT NULL, email text NOT NULL, student_id text, branch_code text, branch_name text,
 PRIMARY KEY(exam_id,member_id), FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id),
 FOREIGN KEY(org_id,exam_id) REFERENCES live_exams(org_id,id)
);
CREATE TABLE IF NOT EXISTS live_exam_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL, org_id uuid NOT NULL, member_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','submitted','grading','graded')),
 answers jsonb NOT NULL DEFAULT '[]', result jsonb, version integer NOT NULL DEFAULT 0,
 started_at timestamptz NOT NULL DEFAULT now(), deadline_at timestamptz NOT NULL, submitted_at timestamptz,
 grading_token uuid, grading_started_at timestamptz, code_runs integer NOT NULL DEFAULT 0,
 last_run_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(exam_id,member_id), FOREIGN KEY(exam_id,member_id) REFERENCES live_exam_roster(exam_id,member_id),
 FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id), FOREIGN KEY(org_id,exam_id) REFERENCES live_exams(org_id,id)
);
CREATE TABLE IF NOT EXISTS live_exam_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL REFERENCES live_exam_attempts(id),
 org_id uuid NOT NULL, member_id uuid NOT NULL, client_id uuid NOT NULL,
 kind text NOT NULL, client_occurred_at timestamptz NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(attempt_id,client_id), FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id)
);
CREATE INDEX IF NOT EXISTS live_exam_org_list ON live_exams(org_id,created_at DESC);
CREATE INDEX IF NOT EXISTS live_exam_roster_member ON live_exam_roster(member_id,exam_id);
CREATE INDEX IF NOT EXISTS live_exam_expiry ON live_exam_attempts(exam_id,status,deadline_at);
CREATE INDEX IF NOT EXISTS live_exam_events_attempt ON live_exam_events(attempt_id,occurred_at);
GRANT SELECT,INSERT,UPDATE ON live_exams,live_exam_questions,live_exam_attempts TO slate_runtime;
GRANT SELECT,INSERT ON live_exam_roster,live_exam_events TO slate_runtime;
REVOKE ALL ON live_exams,live_exam_questions,live_exam_roster,live_exam_attempts,live_exam_events FROM slate_reader,slate_registration,slate_mailbox;
` +
  [
    "live_exams",
    "live_exam_questions",
    "live_exam_roster",
    "live_exam_attempts",
    "live_exam_events",
  ]
    .map(
      (table) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_admin ON ${table};
CREATE POLICY exam_admin ON ${table} TO slate_runtime USING(current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
`,
    )
    .join("\n") +
  `
DROP POLICY IF EXISTS exam_student_read ON live_exams;
CREATE POLICY exam_student_read ON live_exams FOR SELECT TO slate_runtime USING (
 status IN ('published','cancelled') AND EXISTS(SELECT 1 FROM live_exam_roster r WHERE r.exam_id=live_exams.id)
);
` +
  ["live_exam_roster", "live_exam_attempts", "live_exam_events"]
    .map(
      (table) => `
DROP POLICY IF EXISTS exam_student_read ON ${table};
CREATE POLICY exam_student_read ON ${table} FOR SELECT TO slate_runtime USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM members m JOIN organizations o ON o.id=m.org_id
 WHERE m.id=${table}.member_id AND m.org_id=${table}.org_id
 AND m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student' AND m.status='active' AND o.status='active')
);
`,
    )
    .join("\n") +
  ["live_exam_attempts", "live_exam_events"]
    .map(
      (table) => `
DROP POLICY IF EXISTS exam_student_insert ON ${table};
CREATE POLICY exam_student_insert ON ${table} FOR INSERT TO slate_runtime WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM members m JOIN organizations o ON o.id=m.org_id
 WHERE m.id=${table}.member_id AND m.org_id=${table}.org_id
 AND m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student' AND m.status='active' AND o.status='active')
);
`,
    )
    .join("\n") +
  `
DROP POLICY IF EXISTS exam_student_update ON live_exam_attempts;
CREATE POLICY exam_student_update ON live_exam_attempts FOR UPDATE TO slate_runtime USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM members m JOIN organizations o ON o.id=m.org_id
 WHERE m.id=live_exam_attempts.member_id AND m.org_id=live_exam_attempts.org_id
 AND m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student' AND m.status='active' AND o.status='active')
) WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM members m JOIN organizations o ON o.id=m.org_id
 WHERE m.id=live_exam_attempts.member_id AND m.org_id=live_exam_attempts.org_id
 AND m.auth_user_id=current_setting('slate.auth_id',true) AND m.role='student' AND m.status='active' AND o.status='active')
);
INSERT INTO migrations(id) VALUES ('010-live-exams') ON CONFLICT DO NOTHING;
`;
