export type ExamLanguage =
  | "Python"
  | "Java"
  | "C++"
  | "C"
  | "JavaScript"
  | "TypeScript"
  | "C#"
  | "Go"
  | "Rust"
  | "Ruby"
  | "PHP"
  | "Kotlin";
export const examLanguages: ExamLanguage[] = [
  "Python",
  "Java",
  "C++",
  "C",
  "JavaScript",
  "TypeScript",
  "C#",
  "Go",
  "Rust",
  "Ruby",
  "PHP",
  "Kotlin",
];
export type ExamAudienceSelection = {
  mode: "organization" | "branches" | "students";
  branchCodes: string[];
  studentIds: string[];
};
export type ExamMonitoring = {
  enabled: boolean;
  requireFullscreen: boolean;
  recordClipboard: boolean;
};
export type ExamTestCase = {
  id: string;
  input: string;
  output: string;
  hidden: boolean;
};
export type ExamMcqQuestion = {
  id: string;
  kind: "mcq";
  title: string;
  prompt: string;
  points: number;
  options: string[];
  correctOption: number;
  explanation: string;
};
export type ExamCodingQuestion = {
  id: string;
  kind: "coding";
  title: string;
  prompt: string;
  points: number;
  languages: ExamLanguage[];
  starterCode: Partial<Record<ExamLanguage, string>>;
  testCases: ExamTestCase[];
};
export type ExamQuestion = ExamMcqQuestion | ExamCodingQuestion;
export type StudentExamQuestion =
  Omit<ExamMcqQuestion, "correctOption" | "explanation"> | ExamCodingQuestion;
export interface ExamDraft {
  organizationId: string;
  title: string;
  description: string;
  instructions: string;
  audience: ExamAudienceSelection;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  passingPercentage: number;
  codingGrading: "manual" | "automatic";
  monitoring: ExamMonitoring;
  questions: ExamQuestion[];
}
export interface ExamAdminSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  title: string;
  description: string;
  status: "draft" | "published" | "cancelled";
  phase: "upcoming" | "live" | "ended";
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  questionCount: number;
  codingGrading: "manual" | "automatic";
  totalPoints: number;
  audienceCount: number;
  attemptedCount: number;
  submittedCount: number;
  revision: number;
  resultsReleasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AdminExam
  extends
    ExamAdminSummary,
    Omit<
      ExamDraft,
      | "title"
      | "description"
      | "organizationId"
      | "startsAt"
      | "endsAt"
      | "durationMinutes"
    > {}
export interface ExamAudienceOptions {
  organizationId: string;
  organizationName: string;
  status: "active" | "archived";
  branches: { code: string; name: string; studentCount: number }[];
  students: {
    id: string;
    name: string;
    email: string;
    studentId: string | null;
    branchCode: string | null;
    branchName: string | null;
  }[];
}
export type ExamAnswer = {
  questionId: string;
  selectedOption?: number | null;
  language?: ExamLanguage;
  code?: string;
};
export type ExamAttemptStatus =
  "in_progress" | "submitted" | "grading" | "graded";
export type ExamEventType =
  | "tab_hidden"
  | "window_blur"
  | "fullscreen_exit"
  | "copy"
  | "paste"
  | "cut"
  | "offline"
  | "online";
export type ExamMonitorEvent = {
  id: string;
  type: ExamEventType;
  occurredAt: string;
};
export interface ExamQuestionResult {
  questionId: string;
  kind: "mcq" | "coding";
  title: string;
  points: number;
  earnedPoints: number | null;
  verdict: string;
  passedTests?: number;
  totalTests?: number;
  correctOption?: number;
  explanation?: string;
}
export interface ExamResult {
  earnedPoints: number | null;
  totalPoints: number;
  percentage: number | null;
  passed: boolean | null;
  questions: ExamQuestionResult[];
}
export interface StudentExamSummary {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  questionCount: number;
  totalPoints: number;
  state: "upcoming" | "live" | "ended" | "cancelled";
  attemptId: string | null;
  attemptStatus: ExamAttemptStatus | null;
  resultsReleased: boolean;
  percentage: number | null;
}
export interface StudentExamDetail extends StudentExamSummary {
  instructions: string;
  codingGrading: "manual" | "automatic";
  passingPercentage: number;
  monitoring: ExamMonitoring;
  serverNow: string;
}
export interface ExamAttemptView {
  id: string;
  examId: string;
  exam: StudentExamDetail;
  status: ExamAttemptStatus;
  revision: number;
  serverNow: string;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  answers: ExamAnswer[];
  questions: StudentExamQuestion[];
  eventCount: number;
  result: ExamResult | null;
}
export interface ExamResultsRow {
  memberId: string;
  name: string;
  email: string;
  studentId: string | null;
  branchName: string | null;
  branchCode: string | null;
  attemptId: string | null;
  status: ExamAttemptStatus | "not_started";
  startedAt: string | null;
  submittedAt: string | null;
  deadlineAt: string | null;
  eventCount: number;
  earnedPoints: number | null;
  totalPoints: number;
  percentage: number | null;
  passed: boolean | null;
}
export interface ExamResults {
  exam: ExamAdminSummary;
  rows: ExamResultsRow[];
}
export interface AdminExamAttempt {
  id: string;
  revision: number;
  memberId: string;
  status: ExamAttemptStatus;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  answers: ExamAnswer[];
  result: ExamResult;
  events: (ExamMonitorEvent & { receivedAt: string })[];
}
