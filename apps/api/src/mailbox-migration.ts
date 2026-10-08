// A separate role lets organization viewers send messages without write access to student data.
export const mailboxMigration = `
CREATE TABLE IF NOT EXISTS slate_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL,
 sender_id uuid NOT NULL, client_id uuid NOT NULL, subject text NOT NULL CHECK(char_length(subject) BETWEEN 1 AND 150),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000), requested_recipients jsonb NOT NULL,
 broadcast boolean NOT NULL DEFAULT false, recipient_count integer NOT NULL CHECK(recipient_count BETWEEN 1 AND 2000),
 reply_to_id uuid, sent_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,sender_id) REFERENCES slate_members(org_id,id),
 UNIQUE(sender_id,client_id), UNIQUE(org_id,id), UNIQUE(org_id,id,sender_id),
 FOREIGN KEY(org_id,reply_to_id) REFERENCES slate_messages(org_id,id)
);
CREATE TABLE IF NOT EXISTS slate_message_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, message_id uuid NOT NULL,
 sender_id uuid NOT NULL, recipient_id uuid NOT NULL, read_at timestamptz,
 starred boolean NOT NULL DEFAULT false, archived_at timestamptz,
 FOREIGN KEY(org_id,message_id,sender_id) REFERENCES slate_messages(org_id,id,sender_id),
 FOREIGN KEY(org_id,recipient_id) REFERENCES slate_members(org_id,id), UNIQUE(message_id,recipient_id)
);
CREATE INDEX IF NOT EXISTS mailbox_sent ON slate_messages(sender_id,sent_at DESC);
CREATE INDEX IF NOT EXISTS mailbox_received ON slate_message_deliveries(recipient_id,archived_at,read_at);
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='slate_mailbox') THEN CREATE ROLE slate_mailbox NOLOGIN; END IF;
END $$;
GRANT slate_mailbox TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO slate_mailbox;
GRANT SELECT(id,name,email) ON auth_user TO slate_mailbox;
GRANT SELECT(id,auth_user_id,org_id,role,status) ON slate_members TO slate_mailbox;
GRANT SELECT,INSERT ON slate_messages,slate_message_deliveries TO slate_mailbox;
GRANT UPDATE(read_at,starred,archived_at) ON slate_message_deliveries TO slate_mailbox;
CREATE OR REPLACE FUNCTION slate_mail_member() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM slate_members WHERE auth_user_id=current_setting('slate.auth_id',true)
 AND org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND status='active'
 AND role IN ('student','organization_viewer') LIMIT 1
$$;
REVOKE ALL ON FUNCTION slate_mail_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slate_mail_member() TO slate_mailbox;
ALTER TABLE slate_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE slate_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE slate_message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE slate_message_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mail_read ON slate_messages;
CREATE POLICY mail_read ON slate_messages FOR SELECT TO slate_mailbox USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND
 (sender_id=slate_mail_member() OR EXISTS(SELECT 1 FROM slate_message_deliveries d WHERE d.message_id=slate_messages.id AND d.recipient_id=slate_mail_member()))
);
DROP POLICY IF EXISTS mail_send ON slate_messages;
CREATE POLICY mail_send ON slate_messages FOR INSERT TO slate_mailbox WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND sender_id=slate_mail_member()
 AND (NOT broadcast OR EXISTS(SELECT 1 FROM slate_members WHERE id=sender_id AND role='organization_viewer'))
);
DROP POLICY IF EXISTS delivery_read ON slate_message_deliveries;
CREATE POLICY delivery_read ON slate_message_deliveries FOR SELECT TO slate_mailbox USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND (sender_id=slate_mail_member() OR recipient_id=slate_mail_member())
);
DROP POLICY IF EXISTS delivery_send ON slate_message_deliveries;
CREATE POLICY delivery_send ON slate_message_deliveries FOR INSERT TO slate_mailbox WITH CHECK (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND sender_id=slate_mail_member()
 AND EXISTS(SELECT 1 FROM slate_members WHERE id=recipient_id AND org_id=slate_message_deliveries.org_id AND status='active' AND role IN ('student','organization_viewer'))
);
DROP POLICY IF EXISTS delivery_update ON slate_message_deliveries;
CREATE POLICY delivery_update ON slate_message_deliveries FOR UPDATE TO slate_mailbox USING (
 org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND recipient_id=slate_mail_member()
) WITH CHECK (org_id=NULLIF(current_setting('slate.org_id',true),'')::uuid AND recipient_id=slate_mail_member());
INSERT INTO slate_migrations(id) VALUES ('002-organization-mailbox') ON CONFLICT DO NOTHING;
`;
