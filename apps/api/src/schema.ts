import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type {
  AccessPolicy,
  Lesson,
  LessonFile,
  LessonSubmission,
  PortalDisplay,
  Resume,
} from "@slate/contracts";
import type {
  ExamAnswer,
  ExamAudienceSelection,
  ExamMonitoring,
  ExamQuestion,
  ExamResult,
  StudentExamQuestion,
} from "@slate/contracts";

export const liveExams = pgTable("live_exams", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().unique(),
  organizationId: uuid("org_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  instructions: text("instructions").notNull(),
  passingPercentage: integer("passing_percentage").notNull(),
  monitoring: jsonb("monitoring").$type<ExamMonitoring>().notNull(),
  status: text("status").notNull().default("draft"),
  startsAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  codingGrading: text("coding_grading").notNull().default("manual"),
  durationMinutes: integer("duration_minutes").notNull(),
  audience: jsonb("audience").$type<ExamAudienceSelection>().notNull(),
  publicQuestions: jsonb("public_questions")
    .$type<StudentExamQuestion[]>()
    .notNull()
    .default([]),
  revision: integer("revision").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  resultsReleasedAt: timestamp("results_released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const liveExamQuestions = pgTable("live_exam_questions", {
  examId: uuid("exam_id").primaryKey(),
  organizationId: uuid("org_id").notNull(),
  questions: jsonb("questions").$type<ExamQuestion[]>().notNull(),
});
export const liveExamRoster = pgTable(
  "live_exam_roster",
  {
    examId: uuid("exam_id").notNull(),
    organizationId: uuid("org_id").notNull(),
    memberId: uuid("member_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    studentId: text("student_id"),
    branchCode: text("branch_code"),
    branchName: text("branch_name"),
  },
  (table) => [
    uniqueIndex("live_exam_roster_identity").on(table.examId, table.memberId),
  ],
);
export const liveExamAttempts = pgTable(
  "live_exam_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id").notNull(),
    organizationId: uuid("org_id").notNull(),
    memberId: uuid("member_id").notNull(),
    status: text("status").notNull().default("in_progress"),
    answers: jsonb("answers").$type<ExamAnswer[]>().notNull().default([]),
    result: jsonb("result").$type<ExamResult | null>(),
    version: integer("version").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    gradingToken: uuid("grading_token"),
    gradingStartedAt: timestamp("grading_started_at", { withTimezone: true }),
    codeRuns: integer("code_runs").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("live_exam_attempt_identity").on(table.examId, table.memberId),
  ],
);
export const liveExamEvents = pgTable("live_exam_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull(),
  organizationId: uuid("org_id").notNull(),
  memberId: uuid("member_id").notNull(),
  clientId: uuid("client_id").notNull(),
  kind: text("kind").notNull(),
  clientOccurredAt: timestamp("client_occurred_at", {
    withTimezone: true,
  }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const dates = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const user = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  ...dates(),
});
export const session = pgTable("auth_session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  ...dates(),
});
export const account = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  ...dates(),
});
export const verification = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...dates(),
});
export const jwks = pgTable("auth_jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  alg: text("alg"),
  crv: text("crv"),
});
export const twoFactor = pgTable("auth_two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(false),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
export const rateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// Better Auth's native joins fetch the session and its current user together.
// These relations only describe existing foreign keys; no SQL migration is needed.
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  twoFactors: many(twoFactor),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, { fields: [twoFactor.userId], references: [user.id] }),
}));
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").default("active").notNull(),
  accessRevision: integer("access_revision").default(0).notNull(),
  portalDisplay: jsonb("portal_display").$type<PortalDisplay | null>(),
  ...dates(),
});
export const organizationBranches = pgTable(
  "organization_branches",
  {
    id: uuid("id").notNull().defaultRandom().unique(),
    organizationId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_branch_code").on(
      table.organizationId,
      table.code,
    ),
  ],
);
export const accessPolicies = pgTable(
  "access_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    scope: text("scope").notNull(),
    targetKey: text("target_key").notNull(),
    branchName: text("branch_name"),
    policy: jsonb("policy").$type<AccessPolicy>().notNull(),
    courseVersions: jsonb("course_versions")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    ...dates(),
  },
  (table) => [
    uniqueIndex("access_policy_target").on(
      table.organizationId,
      table.scope,
      table.targetKey,
    ),
  ],
);
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: text("auth_user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  organizationId: uuid("org_id").references(() => organizations.id),
  role: text("role").notNull(),
  status: text("status").default("active").notNull(),
  passwordSetupComplete: boolean("password_setup_complete")
    .default(false)
    .notNull(),
  studentId: text("student_id"),
  cohort: text("cohort"),
  branchName: text("branch_name"),
  branchCode: text("branch_code"),
  phone: text("phone"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  features: jsonb("features").$type<string[]>().default([]).notNull(),
  ...dates(),
});
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  track: text("track").notNull(),
  status: text("status").default("draft").notNull(),
  ...dates(),
});
export const versions = pgTable(
  "course_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    lessons: jsonb("lessons").$type<Lesson[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("course_version_number").on(table.courseId, table.number),
  ],
);
export const grants = pgTable(
  "course_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("org_id").notNull(),
    memberId: uuid("member_id").notNull(),
    courseId: uuid("course_id").notNull(),
    versionId: uuid("version_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("member_course_grant").on(table.memberId, table.courseId),
  ],
);
export const progress = pgTable(
  "lesson_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("org_id").notNull(),
    memberId: uuid("member_id").notNull(),
    versionId: uuid("version_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("lesson_completion").on(
      table.memberId,
      table.versionId,
      table.lessonId,
    ),
  ],
);
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  title: text("title").notNull(),
  company: text("company").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().unique(),
  organizationId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  branchCode: text("branch_code"),
  branchName: text("branch_name"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  format: text("format").$type<"plain" | "markdown">().notNull(),
  status: text("status")
    .$type<"published" | "archived">()
    .default("published")
    .notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => members.id),
  authorName: text("author_name").notNull(),
  ...dates(),
});
export const resumes = pgTable("resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  memberId: uuid("member_id").notNull().unique(),
  data: jsonb("data").$type<Resume>().notNull(),
  revision: integer("revision").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const phoneChallenges = pgTable("phone_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  memberId: uuid("member_id").notNull(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  status: text("status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const audit = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id"),
  organizationId: uuid("org_id"),
  action: text("action").notNull(),
  resourceId: text("resource_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  senderId: uuid("sender_id").notNull(),
  clientId: uuid("client_id").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  requestedRecipients: jsonb("requested_recipients")
    .$type<string[]>()
    .notNull(),
  broadcast: boolean("broadcast").default(false).notNull(),
  recipientCount: integer("recipient_count").notNull(),
  replyToId: uuid("reply_to_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});
export const deliveries = pgTable("message_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  messageId: uuid("message_id").notNull(),
  senderId: uuid("sender_id").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  starred: boolean("starred").default(false).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const lessonUploads = pgTable("lesson_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  organizationId: uuid("org_id"),
  purpose: text("purpose").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  stagingKey: text("staging_key").notNull(),
  objectKey: text("object_key"),
  status: text("status").notNull().default("pending"),
  courseId: uuid("course_id"),
  versionId: uuid("version_id"),
  lessonId: text("lesson_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
});
export const lessonSubmissions = pgTable(
  "lesson_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("org_id").notNull(),
    memberId: uuid("member_id").notNull(),
    courseId: uuid("course_id").notNull(),
    versionId: uuid("version_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    kind: text("kind").$type<"assignment" | "quiz">().notNull(),
    answer: text("answer").notNull().default(""),
    url: text("url").notNull().default(""),
    files: jsonb("files").$type<LessonFile[]>().notNull().default([]),
    score: integer("score"),
    passed: boolean("passed"),
    quizResults: jsonb("quiz_results")
      .$type<LessonSubmission["quizResults"]>()
      .notNull()
      .default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("member_lesson_submission").on(
      table.memberId,
      table.versionId,
      table.lessonId,
    ),
  ],
);

// CRT versions and submitted attempts are retained when branch assignments change.
export const crtTopics = pgTable("crt_topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  draft: jsonb("draft")
    .$type<import("@slate/contracts").CrtTopicDraft>()
    .notNull(),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const crtVersions = pgTable("crt_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull(),
  number: integer("number").notNull(),
  content: jsonb("content")
    .$type<import("@slate/contracts").CrtTopicDraft & { pdf: LessonFile }>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const crtAssignments = pgTable("crt_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  topicId: uuid("topic_id").notNull(),
  versionId: uuid("version_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const crtBank = pgTable("crt_bank", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull(),
  question: jsonb("question")
    .$type<import("@slate/contracts").LessonQuestion>()
    .notNull(),
  active: boolean("active").notNull().default(true),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const crtAttempts = pgTable("crt_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull(),
  organizationId: uuid("org_id").notNull(),
  memberId: uuid("member_id").notNull(),
  kind: text("kind").notNull(),
  topicId: uuid("topic_id"),
  versionId: uuid("version_id"),
  questions: jsonb("questions")
    .$type<import("@slate/contracts").CrtPracticeSession["questions"]>()
    .notNull(),
  answers: jsonb("answers").$type<Record<string, number>>(),
  passingScore: integer("passing_score").notNull(),
  readAcknowledged: boolean("read_acknowledged").notNull().default(false),
  result: jsonb("result").$type<import("@slate/contracts").CrtResult>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});
