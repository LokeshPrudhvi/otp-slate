export * from "./access.js";
export * from "./lesson-media.js";
import type { EffectiveAccess } from "./access.js";
export type Portal = "student" | "platform" | "organization";
export type Role = "student" | "platform_admin" | "organization_viewer";
export type OnboardingStep = "password" | "phone" | "mfa" | null;
export interface Identity {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string | null;
  organizationName: string | null;
  onboardingStep: OnboardingStep;
  features: string[];
  access?: EffectiveAccess;
  demo?: boolean;
}
export interface Organization {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  organizationId: string;
  passwordSetupComplete: boolean;
  phoneVerifiedAt: string | null;
  phone?: string | null;
  features: string[];
  studentId?: string | null;
  cohort?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
}
export interface Lesson {
  id: string;
  title: string;
  body: string;
  kind?: "text" | "video" | "assignment" | "quiz";
  format?: "plain" | "markdown";
  video?: { url?: string; uploadId?: string };
  assignment?: { acceptText: boolean; acceptLink: boolean; acceptFiles: boolean };
  quiz?: { passingScore: number; questions: LessonQuestion[] };
}
export interface LessonQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Only returned to Platform Admin; students receive answers after submitting. */
  correctOption?: number;
  explanation?: string;
}
export interface LessonFile {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}
export interface LessonSubmission {
  id: string;
  memberId: string;
  courseId: string;
  versionId: string;
  lessonId: string;
  kind: "assignment" | "quiz";
  answer: string;
  url: string;
  files: LessonFile[];
  score: number | null;
  passed: boolean | null;
  quizResults: { questionId: string; selectedOption: number; correctOption: number; explanation?: string }[];
  submittedAt: string;
  studentName?: string;
  studentEmail?: string;
  organizationName?: string;
  lessonTitle?: string;
  versionNumber?: number;
  quizQuestions?: { id: string; prompt: string; options: string[] }[];
}
export interface Course {
  id: string;
  title: string;
  description: string;
  track: string;
  status: string;
  versionId?: string;
  version?: number;
  lessons?: Lesson[];
}
export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  postedAt: string;
}
export interface Resume {
  name: string;
  title: string;
  email: string;
  phone: string;
  location?: string;
  links?: string;
  summary: string;
  education: string;
  experience: string;
  skills: string;
  projects: string;
  certifications?: string;
  template: "classic" | "compact" | "modern" | "serif";
}
export interface Analytics {
  demo?: boolean;
  performance?: DemoPerformance;
  organization: Organization;
  students: {
    id: string;
    name: string;
    email: string;
    status: string;
    assignedCourses: number;
    completedLessons: number;
    totalLessons: number;
    completion: number | null;
  }[];
  totals: {
    students: number;
    active: number;
    assignedCourses: number;
    completedLessons: number;
  };
  generatedAt: string;
}
export interface Ranking {
  id: string;
  name: string;
  rank?: number;
  points?: number;
  sample?: boolean;
}
export interface DemoQuestion {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}
export interface PracticeAssessment {
  id: string;
  title: string;
  description: string;
  category: "aptitude" | "coding" | "web" | "skills";
  kind: "quiz" | "coding" | "typing" | "project" | "interview";
  difficulty: "Easy" | "Medium" | "Hard";
  durationMinutes: number;
  sample: true;
  number?: number;
  topics?: string[];
  questions?: DemoQuestion[];
  problem?: {
    statement: string;
    examples: { input: string; output: string; explanation: string }[];
    constraints: string[];
    starterCode: Record<string, string>;
    hints?: string[];
    approach?: string;
  };
  passage?: string;
  checklist?: string[];
}
export interface LiveExam {
  id: string;
  title: string;
  state: "live" | "upcoming" | "completed";
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  assessmentId: string;
  questionCount: number;
  score?: number;
  sample: true;
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
  date: string;
  from: string;
  sample: true;
}
export interface MailContact {
  id: string;
  name: string;
  email: string;
  role: "student" | "organization_viewer";
}
export type MailFolder = "inbox" | "unread" | "starred" | "sent" | "archived";
export interface MailMessage {
  id: string;
  subject: string;
  body: string;
  sender: MailContact;
  recipients: MailContact[];
  recipientCount: number;
  broadcast: boolean;
  sentAt: string;
  incoming: boolean;
  readAt: string | null;
  starred: boolean;
  archivedAt: string | null;
  replyToId: string | null;
}
export interface MailPage {
  items: MailMessage[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}
export interface SendMail {
  clientId: string;
  subject: string;
  body: string;
  recipientIds: string[];
  broadcast: boolean;
  replyToId?: string;
}
export interface DemoPerformance {
  skills: { name: string; score: number }[];
  trend: { week: string; activeStudents: number; averageScore: number }[];
  results: {
    studentId: string;
    name: string;
    aptitude: number;
    coding: number;
    interview: number;
    average: number;
    attempts: number;
  }[];
}
export interface IntegrationStatus {
  database: "local-postgres" | "neon-compatible-postgres";
  email: boolean;
  whatsapp: boolean;
  storage: boolean;
  execution: string;
  environment: string;
}
