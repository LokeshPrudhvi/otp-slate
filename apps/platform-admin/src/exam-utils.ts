import type {
  AdminExam,
  ExamDraft,
  ExamQuestion,
  ExamResultsRow,
} from "@slate/contracts";

export const examLimits = { questions: 50, coding: 10, options: 8, tests: 10 };
export function newExamDraft(
  organizationId: string,
  now = Date.now(),
): ExamDraft {
  const start = new Date(now + 60 * 60_000);
  start.setSeconds(0, 0);
  return {
    organizationId,
    title: "",
    description: "",
    instructions: "",
    audience: { mode: "organization", branchCodes: [], studentIds: [] },
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 120 * 60_000).toISOString(),
    durationMinutes: 60,
    passingPercentage: 50,
    codingGrading: "manual",
    monitoring: {
      enabled: true,
      requireFullscreen: true,
      recordClipboard: true,
    },
    questions: [],
  };
}
export function examDraftFrom(exam: ExamDraft | AdminExam): ExamDraft {
  return structuredClone({
    organizationId: exam.organizationId,
    title: exam.title,
    description: exam.description,
    instructions: exam.instructions,
    audience: exam.audience,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMinutes: exam.durationMinutes,
    passingPercentage: exam.passingPercentage,
    codingGrading: "manual",
    monitoring: exam.monitoring,
    questions: exam.questions,
  });
}
export function newExamQuestion(
  kind: "mcq" | "coding",
  id = crypto.randomUUID(),
): ExamQuestion {
  const base = { id, kind, title: "", prompt: "", points: 10 };
  return kind === "mcq"
    ? {
        ...base,
        kind,
        options: ["", "", "", ""],
        correctOption: 0,
        explanation: "",
      }
    : {
        ...base,
        kind,
        languages: ["Python"],
        starterCode: { Python: "" },
        testCases: [],
      };
}
export function localDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function isoDateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
export function validateExamDraft(draft: ExamDraft): string[] {
  const issues: string[] = [];
  if (!draft.organizationId) issues.push("Choose an organization.");
  if (!draft.title.trim() || draft.title.length > 150)
    issues.push("Enter an exam title of up to 150 characters.");
  if (draft.description.length > 2000)
    issues.push("Keep the description below 2,000 characters.");
  if (draft.instructions.length > 10000)
    issues.push("Keep instructions below 10,000 characters.");
  if (
    !Number.isFinite(Date.parse(draft.startsAt)) ||
    !Number.isFinite(Date.parse(draft.endsAt)) ||
    Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)
  )
    issues.push("Choose a valid exam window ending after it starts.");
  if (
    !Number.isInteger(draft.durationMinutes) ||
    draft.durationMinutes < 1 ||
    draft.durationMinutes > 480
  )
    issues.push("Duration must be 1–480 whole minutes.");
  if (
    !Number.isInteger(draft.passingPercentage) ||
    draft.passingPercentage < 0 ||
    draft.passingPercentage > 100
  )
    issues.push("Passing score must be 0–100%.");
  if (draft.audience.mode === "branches" && !draft.audience.branchCodes.length)
    issues.push("Select at least one branch.");
  if (draft.audience.mode === "students" && !draft.audience.studentIds.length)
    issues.push("Select at least one student.");
  if (!draft.questions.length || draft.questions.length > examLimits.questions)
    issues.push("Add 1–50 questions.");
  if (
    draft.questions.filter((q) => q.kind === "coding").length >
    examLimits.coding
  )
    issues.push("Use at most 10 coding questions.");
  if (new Set(draft.questions.map((q) => q.id)).size !== draft.questions.length)
    issues.push("Question IDs must be unique.");
  draft.questions.forEach((q, index) => {
    const prefix = `Question ${index + 1}: `;
    if (!q.title.trim() || q.title.length > 200)
      issues.push(prefix + "enter a title of up to 200 characters.");
    if (!q.prompt.trim() || q.prompt.length > 20000)
      issues.push(prefix + "add a prompt of up to 20,000 characters.");
    if (!Number.isInteger(q.points) || q.points < 1 || q.points > 1000)
      issues.push(prefix + "points must be 1–1,000.");
    if (q.kind === "mcq") {
      if (
        q.options.length < 2 ||
        q.options.length > 8 ||
        q.options.some((option) => !option.trim() || option.length > 2000)
      )
        issues.push(
          prefix +
            "provide 2–8 non-empty options, up to 2,000 characters each.",
        );
      if (
        !Number.isInteger(q.correctOption) ||
        q.correctOption < 0 ||
        q.correctOption >= q.options.length
      )
        issues.push(prefix + "select the correct answer.");
      if (q.explanation.length > 5000)
        issues.push(prefix + "keep the explanation below 5,000 characters.");
    } else {
      if (!q.languages.length)
        issues.push(prefix + "select at least one programming language.");
      if (
        Object.values(q.starterCode).some(
          (source) => source && source.length > 30000,
        )
      )
        issues.push(
          prefix + "starter code must be under 30,000 characters per language.",
        );
      if (q.testCases.length > 10)
        issues.push(prefix + "keep at most 10 saved reference examples.");
      if (
        q.testCases.some(
          (test) => test.input.length > 10000 || test.output.length > 10000,
        )
      )
        issues.push(
          prefix + "test input/output must be under 10,000 characters.",
        );
      if (
        new Set(q.testCases.map((test) => test.id)).size !== q.testCases.length
      )
        issues.push(prefix + "test case IDs must be unique.");
    }
  });
  return issues;
}
export function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe =
    /^[\s\uFEFF]*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function examResultsCsv(rows: ExamResultsRow[]) {
  const headers = [
    "Student ID",
    "Name",
    "Email",
    "Branch",
    "Branch code",
    "Status",
    "Score",
    "Total points",
    "Percentage",
    "Outcome",
    "Monitoring events",
    "Started at",
    "Submitted at",
  ];
  return (
    "\uFEFF" +
    [
      headers,
      ...rows.map((row) => [
        row.studentId,
        row.name,
        row.email,
        row.branchName,
        row.branchCode,
        row.status,
        row.earnedPoints,
        row.totalPoints,
        row.percentage,
        row.passed === null ? "Pending" : row.passed ? "Passed" : "Not passed",
        row.eventCount,
        row.startedAt,
        row.submittedAt,
      ]),
    ]
      .map((cells) => cells.map(csvCell).join(","))
      .join("\r\n")
  );
}
