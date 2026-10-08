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
import type { Lesson, Resume } from "@slate/contracts";

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
export const organizations = pgTable("slate_organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").default("active").notNull(),
  ...dates(),
});
export const members = pgTable("slate_members", {
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
  phone: text("phone"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  features: jsonb("features").$type<string[]>().default([]).notNull(),
  ...dates(),
});
export const courses = pgTable("slate_courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  track: text("track").notNull(),
  status: text("status").default("draft").notNull(),
  ...dates(),
});
export const versions = pgTable(
  "slate_course_versions",
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
  "slate_grants",
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
  "slate_progress",
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
export const jobs = pgTable("slate_jobs", {
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
export const resumes = pgTable("slate_resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  memberId: uuid("member_id").notNull().unique(),
  data: jsonb("data").$type<Resume>().notNull(),
  revision: integer("revision").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const phoneChallenges = pgTable("slate_phone_challenges", {
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
export const outbox = pgTable("slate_outbox", {
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
export const audit = pgTable("slate_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id"),
  organizationId: uuid("org_id"),
  action: text("action").notNull(),
  resourceId: text("resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const messages = pgTable("slate_messages", {
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
export const deliveries = pgTable("slate_message_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  messageId: uuid("message_id").notNull(),
  senderId: uuid("sender_id").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  starred: boolean("starred").default(false).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
