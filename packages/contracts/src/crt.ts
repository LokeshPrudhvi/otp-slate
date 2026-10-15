import type { LessonFile, LessonQuestion } from "./index.js";
export const crtSubjects = [
  { id: "quantitative", name: "Quantitative aptitude" },
  { id: "reasoning", name: "Logical and analytical reasoning" },
  { id: "verbal", name: "Verbal ability and English" },
  { id: "soft-skills", name: "Soft skills and interview preparation" },
] as const;
export type CrtSubjectId = (typeof crtSubjects)[number]["id"];
export interface CrtTopicDraft {
  title: string;
  subjectId: CrtSubjectId;
  description: string;
  passingScore: number;
  pdfUploadId?: string;
  questions: LessonQuestion[];
}
export interface CrtTopic extends CrtTopicDraft {
  id: string;
  revision: number;
  status: "draft" | "published";
  pdf: LessonFile | null;
  versionId: string | null;
  version: number;
  updatedAt: string;
}
export interface CrtVersion {
  id: string;
  topicId: string;
  version: number;
  title: string;
  createdAt: string;
}
export interface CrtTopicDetail extends CrtTopic {
  versions: CrtVersion[];
}
export interface CrtAudience {
  organizationId: string;
  branches: { id: string; name: string; code: string; studentCount: number }[];
}
export interface CrtAssignments {
  organizationId: string;
  /** Null assigns content to every current and future branch in this organization. */
  branchId: string | null;
  topics: { topicId: string; versionId: string }[];
  /** Read-only organization assignments included when viewing one branch. */
  inheritedTopics?: { topicId: string; versionId: string }[];
}
export interface CrtBankQuestion {
  id: string;
  topicId: string;
  question: LessonQuestion;
  active: boolean;
  revision: number;
}
export interface CrtStudentTopic {
  id: string;
  title: string;
  subjectId: CrtSubjectId;
  description: string;
  versionId: string;
  version: number;
  passingScore: number;
  questionCount: number;
  completed: boolean;
  bestScore: number | null;
}
export interface CrtStudentTopicDetail extends CrtStudentTopic {
  pdf: LessonFile;
  questions: LessonQuestion[];
}
export interface CrtResult {
  id: string;
  score: number;
  correct: number;
  total: number;
  passed: boolean;
  submittedAt: string;
  questions: (LessonQuestion & { selectedOption: number; correct: boolean })[];
}
export interface CrtPracticeSession {
  id: string;
  questions: (LessonQuestion & {
    topicId: string;
    topicTitle: string;
    subjectId: CrtSubjectId;
  })[];
  createdAt: string;
  result: CrtResult | null;
}
