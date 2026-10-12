// Additive registration workflow, applied after the canonical domain migration.
export const registrationMigration = `
CREATE TABLE IF NOT EXISTS registration_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES organizations(id), student_id text NOT NULL,
 name text NOT NULL, email text NOT NULL, phone text NOT NULL,
 cohort text, branch_name text NOT NULL, branch_code text NOT NULL,
 source text NOT NULL CHECK(source IN ('registration','import')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 member_id uuid REFERENCES members(id), welcome_outbox_id uuid REFERENCES outbox(id),
 reviewed_by uuid REFERENCES members(id), reviewed_at timestamptz, rejection_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status <> 'approved' OR (member_id IS NOT NULL AND welcome_outbox_id IS NOT NULL AND reviewed_at IS NOT NULL)),
 CHECK(status <> 'rejected' OR (rejection_reason IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS registration_active_email ON registration_requests(lower(email)) WHERE status <> 'rejected';
CREATE UNIQUE INDEX IF NOT EXISTS registration_active_student ON registration_requests(org_id,lower(student_id)) WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS registration_review_queue ON registration_requests(org_id,status,created_at);
CREATE TABLE IF NOT EXISTS registration_rate_limits (key text PRIMARY KEY,count integer NOT NULL,reset_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS registration_rate_expiry ON registration_rate_limits(reset_at);
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='slate_registration') THEN CREATE ROLE slate_registration NOLOGIN; END IF;
END $$;
GRANT slate_registration TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO slate_registration;
GRANT SELECT(id,name,status) ON organizations TO slate_registration;
GRANT SELECT(email) ON auth_user TO slate_registration;
GRANT SELECT(org_id,student_id) ON members TO slate_registration;
GRANT SELECT(id,status),INSERT ON registration_requests TO slate_registration;
GRANT SELECT,INSERT,UPDATE,DELETE ON registration_rate_limits TO slate_registration;
GRANT SELECT,INSERT,UPDATE ON registration_requests TO slate_runtime;
ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registration_admin ON registration_requests;
CREATE POLICY registration_admin ON registration_requests TO slate_runtime
 USING(current_setting('slate.is_platform',true)='true') WITH CHECK(current_setting('slate.is_platform',true)='true');
DROP POLICY IF EXISTS registration_submit ON registration_requests;
CREATE POLICY registration_submit ON registration_requests FOR INSERT TO slate_registration WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND status='pending' AND source='registration'
 AND member_id IS NULL AND welcome_outbox_id IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL
);
DROP POLICY IF EXISTS registration_receipt ON registration_requests;
CREATE POLICY registration_receipt ON registration_requests FOR SELECT TO slate_registration
 USING(org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND status='pending');
DROP POLICY IF EXISTS registration_organization_catalog ON organizations;
CREATE POLICY registration_organization_catalog ON organizations FOR SELECT TO slate_registration USING(status='active');
INSERT INTO migrations(id) VALUES ('003-student-registration') ON CONFLICT DO NOTHING;
`;
