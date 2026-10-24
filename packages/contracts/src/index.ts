export * from "./crt.js";
export * from "./access.js";
export * from "./lesson-media.js";
export * from "./exams.js";
export * from "./question-image.js";
import type { EffectiveAccess } from "./access.js";
import type { QuestionImage } from "./question-image.js";
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
export interface OrganizationBranch {
  organizationId: string;
  code: string;
  name: string;
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
  image?: QuestionImage;
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
  quizQuestions?: { id: string; prompt: string; options: string[]; image?: QuestionImage }[];
}
export interface Course {
  id: string;
  title: string;
  description: string;
  track: string;
  status: string;
  versionId?: string;
  version?: number;
  coverImageUrl?: string | null;
  coverUploadId?: string | null;
  lastOpenedAt?: string | null;
  lessons?: Lesson[];
}
export interface CompanyLogo { id:string; companyName:string; sha256:string; fileName:string; url:string|null; }
export interface Job {
  id: string;
  title: string;
  company: string;
  logoId?:string|null;
  companyLogoUrl?:string|null;
  description: string;
  url: string;
  postedAt: string;
}
export interface ResumeProject {
  id: string;
  title: string;
  description: string;
  url: string;
  bullets: string[];
}
export interface ResumeExperience {
  id: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  bullets: string[];
}
export interface ResumeEducation {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
  current: boolean;
  grade: string;
  description: string;
}
export interface ResumeCertification {
  id: string;
  name: string;
  issuer: string;
  issuedDate: string;
  credentialId: string;
  url: string;
  description: string;
}
export interface Resume {
  name: string;
  title: string;
  email: string;
  phone: string;
  location?: string;
  links?: string;
  summary: string;
  education: string | ResumeEducation[];
  experience: string | ResumeExperience[];
  skills: string | string[];
  projects: string | ResumeProject[];
  certifications?: string | ResumeCertification[];
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
    testCases?: { input: string; output: string; description: string }[];
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
  sample?: boolean;
  format?: "plain" | "markdown";
  organizationId?: string;
  organizationName?: string;
  branchCode?: string | null;
  branchName?: string | null;
}
export interface OrganizationAnnouncement extends Announcement {
  clientId: string;
  organizationId: string;
  organizationName: string;
  branchCode: string | null;
  branchName: string | null;
  format: "plain" | "markdown";
  status: "published" | "archived";
  createdAt: string;
  updatedAt: string;
}
export interface AnnouncementAudience {
  organizationId: string;
  organizationName: string;
  status: "active" | "archived";
  studentCount: number;
  branches: { code: string; name: string; studentCount: number }[];
}
export interface AnnouncementPage {
  items: OrganizationAnnouncement[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PublishAnnouncement {
  clientId: string;
  organizationId: string;
  branchCode: string | null;
  title: string;
  body: string;
  format: "plain" | "markdown";
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

export interface CourseCatalogItem extends Course {
  enrolled: boolean;
  enrollmentRequestStatus: "pending" | "reviewed" | null;
}
export interface CourseEnrollmentRequest {
  id: string;
  studentMemberId: string;
  studentName: string;
  studentEmail: string;
  studentId: string | null;
  organizationId: string;
  organizationName: string;
  branchName: string | null;
  branchCode: string | null;
  courseId: string;
  courseTitle: string;
  status: "pending" | "reviewed";
  createdAt: string;
  readAt: string | null;
  reviewedAt: string | null;
  emailStatus: string;
  enrolled: boolean;
}
export interface CourseEnrollmentInbox {
  items: CourseEnrollmentRequest[];
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
}

export type { PlacementLink, PlacementResource, PlacementResourceInput } from "./placement.js";
