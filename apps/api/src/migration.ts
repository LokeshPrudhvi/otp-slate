// Migration 001. Run explicitly with owner credentials against Neon; local development applies it automatically.
import { mailboxMigration } from "./mailbox-migration.js";
import { legacyTableMigration } from "./legacy-table-migration.js";
import { registrationMigration } from "./registration-migration.js";
import { accessMigration } from "./access-migration.js";
import { lessonMigration } from "./lesson-migration.js";
import { announcementMigration } from "./announcement-migration.js";
import { branchMigration } from "./branch-migration.js";
import { examMigration } from "./exam-migration.js";
import { branchEditMigration } from "./branch-edit-migration.js";
import { courseLifecycleMigration } from "./course-lifecycle-migration.js";
export const migration =
  legacyTableMigration +
  `
CREATE TABLE IF NOT EXISTS migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_user (id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,email_verified boolean NOT NULL DEFAULT false,image text,role text DEFAULT 'user',banned boolean DEFAULT false,ban_reason text,ban_expires timestamptz,two_factor_enabled boolean DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_session (id text PRIMARY KEY,token text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,ip_address text,user_agent text,impersonated_by text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS auth_session_user ON auth_session(user_id);
CREATE TABLE IF NOT EXISTS auth_account (id text PRIMARY KEY,account_id text NOT NULL,provider_id text NOT NULL,user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,access_token text,refresh_token text,id_token text,access_token_expires_at timestamptz,refresh_token_expires_at timestamptz,scope text,password text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS auth_credential_identity ON auth_account(provider_id,account_id);
CREATE TABLE IF NOT EXISTS auth_verification (id text PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS auth_verification_identifier ON auth_verification(identifier);
CREATE TABLE IF NOT EXISTS auth_jwks (id text PRIMARY KEY,public_key text NOT NULL,private_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,alg text,crv text);
CREATE TABLE IF NOT EXISTS auth_two_factor (id text PRIMARY KEY,secret text NOT NULL,backup_codes text NOT NULL,user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,verified boolean DEFAULT false,failed_verification_count integer DEFAULT 0,locked_until timestamptz);
CREATE TABLE IF NOT EXISTS auth_rate_limit (id text PRIMARY KEY,key text NOT NULL UNIQUE,count integer NOT NULL,last_request bigint NOT NULL);
CREATE TABLE IF NOT EXISTS organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id text NOT NULL UNIQUE REFERENCES auth_user(id),org_id uuid REFERENCES organizations(id),role text NOT NULL CHECK(role IN ('student','organization_viewer','platform_admin')),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','disabled')),password_setup_complete boolean NOT NULL DEFAULT false,phone text,phone_verified_at timestamptz,features jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,id),CHECK((role='platform_admin' AND org_id IS NULL) OR (role<>'platform_admin' AND org_id IS NOT NULL)));
CREATE INDEX IF NOT EXISTS slate_member_org ON members(org_id,role,status);
CREATE TABLE IF NOT EXISTS courses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,description text NOT NULL,track text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS course_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid NOT NULL REFERENCES courses(id),number integer NOT NULL,title text NOT NULL,description text NOT NULL,lessons jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(course_id,number),UNIQUE(course_id,id));
CREATE TABLE IF NOT EXISTS course_enrollments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,member_id uuid NOT NULL,course_id uuid NOT NULL,version_id uuid NOT NULL,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id),FOREIGN KEY(course_id,version_id) REFERENCES course_versions(course_id,id),UNIQUE(member_id,course_id));
CREATE TABLE IF NOT EXISTS lesson_progress (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,member_id uuid NOT NULL,version_id uuid NOT NULL REFERENCES course_versions(id),lesson_id text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id),UNIQUE(member_id,version_id,lesson_id));
CREATE TABLE IF NOT EXISTS jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id),title text NOT NULL,company text NOT NULL,description text NOT NULL,url text NOT NULL,posted_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS resumes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,member_id uuid NOT NULL UNIQUE,data jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id));
CREATE TABLE IF NOT EXISTS phone_challenges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,member_id uuid NOT NULL,phone text NOT NULL,code_hash text NOT NULL,attempts integer NOT NULL DEFAULT 0,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(org_id,member_id) REFERENCES members(org_id,id));
CREATE INDEX IF NOT EXISTS slate_phone_rate ON phone_challenges(member_id,created_at);
CREATE TABLE IF NOT EXISTS outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text NOT NULL,encrypted_payload text NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,org_id uuid,action text NOT NULL,resource_id text,created_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='slate_runtime') THEN CREATE ROLE slate_runtime NOLOGIN; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='slate_reader') THEN CREATE ROLE slate_reader NOLOGIN; END IF;
END $$;
GRANT slate_runtime, slate_reader TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO slate_runtime, slate_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_user,auth_session,auth_account,auth_verification,auth_jwks,auth_two_factor,auth_rate_limit,organizations,members,courses,course_versions,course_enrollments,lesson_progress,jobs,resumes,phone_challenges,outbox,audit_logs TO slate_runtime;
GRANT SELECT ON organizations,members,courses,course_versions,course_enrollments,lesson_progress,jobs TO slate_reader;
GRANT SELECT(id,name,email) ON auth_user TO slate_reader;
REVOKE UPDATE,DELETE ON course_versions,audit_logs FROM slate_runtime;
INSERT INTO migrations(id) VALUES ('001-foundation') ON CONFLICT DO NOTHING;
` +
  [
    "organizations",
    "members",
    "course_enrollments",
    "lesson_progress",
    "jobs",
    "resumes",
    "phone_challenges",
    "audit_logs",
  ]
    .map((table) => {
      const organizationColumn = table === "organizations" ? "id" : "org_id";
      const condition = `(current_setting('slate.is_platform',true)='true' OR ${organizationColumn}=NULLIF(current_setting('slate.org_id',true),'')::uuid${table === "members" ? " OR auth_user_id=current_setting('slate.auth_id',true)" : ""})`;
      return `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS tenant_boundary ON ${table}; CREATE POLICY tenant_boundary ON ${table} USING ${condition} WITH CHECK ${condition};`;
    })
    .join("\n") +
  "\n" +
  mailboxMigration +
  `
ALTER TABLE members ADD COLUMN IF NOT EXISTS student_id text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS cohort text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS branch_code text;
CREATE UNIQUE INDEX IF NOT EXISTS member_student_identity ON members(org_id, lower(student_id)) WHERE student_id IS NOT NULL;
` +
  registrationMigration +
  accessMigration +
  courseLifecycleMigration +
  lessonMigration +
  announcementMigration +
  branchMigration +
  branchEditMigration +
  examMigration;
