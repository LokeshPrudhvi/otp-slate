// Preserve existing local databases while adopting the deployed Neon table names.
export const legacyTableMigration = `
DO $$ BEGIN
 IF to_regclass('public.slate_organizations') IS NOT NULL THEN
  IF to_regclass('public.organizations') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical organizations tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_organizations RENAME TO organizations;
 END IF;
 IF to_regclass('public.slate_members') IS NOT NULL THEN
  IF to_regclass('public.members') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical members tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_members RENAME TO members;
 END IF;
 IF to_regclass('public.slate_courses') IS NOT NULL THEN
  IF to_regclass('public.courses') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical courses tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_courses RENAME TO courses;
 END IF;
 IF to_regclass('public.slate_course_versions') IS NOT NULL THEN
  IF to_regclass('public.course_versions') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical course_versions tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_course_versions RENAME TO course_versions;
 END IF;
 IF to_regclass('public.slate_grants') IS NOT NULL THEN
  IF to_regclass('public.course_enrollments') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical course_enrollments tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_grants RENAME TO course_enrollments;
 END IF;
 IF to_regclass('public.slate_progress') IS NOT NULL THEN
  IF to_regclass('public.lesson_progress') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical lesson_progress tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_progress RENAME TO lesson_progress;
 END IF;
 IF to_regclass('public.slate_jobs') IS NOT NULL THEN
  IF to_regclass('public.jobs') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical jobs tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_jobs RENAME TO jobs;
 END IF;
 IF to_regclass('public.slate_resumes') IS NOT NULL THEN
  IF to_regclass('public.resumes') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical resumes tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_resumes RENAME TO resumes;
 END IF;
 IF to_regclass('public.slate_phone_challenges') IS NOT NULL THEN
  IF to_regclass('public.phone_challenges') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical phone_challenges tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_phone_challenges RENAME TO phone_challenges;
 END IF;
 IF to_regclass('public.slate_outbox') IS NOT NULL THEN
  IF to_regclass('public.outbox') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical outbox tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_outbox RENAME TO outbox;
 END IF;
 IF to_regclass('public.slate_audit') IS NOT NULL THEN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical audit_logs tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_audit RENAME TO audit_logs;
 END IF;
 IF to_regclass('public.slate_messages') IS NOT NULL THEN
  IF to_regclass('public.messages') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical messages tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_messages RENAME TO messages;
 END IF;
 IF to_regclass('public.slate_message_deliveries') IS NOT NULL THEN
  IF to_regclass('public.message_deliveries') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical message_deliveries tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_message_deliveries RENAME TO message_deliveries;
 END IF;
 IF to_regclass('public.slate_migrations') IS NOT NULL THEN
  IF to_regclass('public.migrations') IS NOT NULL THEN RAISE EXCEPTION 'Both legacy and canonical migrations tables exist; reconcile before migrating.'; END IF;
  ALTER TABLE slate_migrations RENAME TO migrations;
 END IF;
END $$;
`;
