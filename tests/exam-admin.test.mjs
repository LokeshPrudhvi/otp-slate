// Run: node --import tsx --test tests/exam-admin.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  examDraftFrom,
  newExamDraft,
  newExamQuestion,
  validateExamDraft,
  csvCell,
  examResultsCsv,
  isoDateTime,
  localDateTime,
} from "../apps/platform-admin/src/exam-utils.ts";
function draft() {
  const exam = newExamDraft(
    "organization-a",
    Date.parse("2027-01-01T09:00:00Z"),
  );
  exam.title = "Placement assessment";
  const question = newExamQuestion("mcq", "question-one");
  Object.assign(question, {
    title: "Choose a value",
    prompt: "What is 2 + 2?",
    options: ["3", "4"],
    correctOption: 1,
  });
  exam.questions = [question];
  return exam;
}
test("new exams use manual coding grading and consistent future schedule", () => {
  const exam = draft();
  assert.equal(exam.codingGrading, "manual");
  assert.equal(exam.startsAt, "2027-01-01T10:00:00.000Z");
  assert.deepEqual(validateExamDraft(exam), []);
});
test("update payload excludes server-managed metadata and does not alias saved questions", () => {
  const server = {
    ...draft(),
    id: "exam-id",
    revision: 7,
    status: "published",
    audienceCount: 55,
    resultsReleasedAt: "2027-01-02T00:00:00Z",
  };
  const payload = examDraftFrom(server);
  assert.equal("id" in payload, false);
  assert.equal("status" in payload, false);
  assert.equal("revision" in payload, false);
  assert.equal("audienceCount" in payload, false);
  payload.questions[0].title = "Changed draft";
  assert.equal(server.questions[0].title, "Choose a value");
});
test("selected branches/students must have an explicit audience", () => {
  for (const mode of ["branches", "students"]) {
    const exam = draft();
    exam.audience.mode = mode;
    assert.ok(
      validateExamDraft(exam).some((error) =>
        /Select at least one/.test(error),
      ),
    );
  }
});
test("invalid MCQ answer, empty options, fractional points and date window are rejected", () => {
  const exam = draft();
  exam.questions[0].correctOption = 8;
  exam.questions[0].options[0] = " ";
  exam.questions[0].points = 1.25;
  exam.endsAt = exam.startsAt;
  const errors = validateExamDraft(exam);
  assert.ok(errors.some((error) => /correct answer/.test(error)));
  assert.ok(errors.some((error) => /non-empty options/.test(error)));
  assert.ok(errors.some((error) => /points must/.test(error)));
  assert.ok(errors.some((error) => /exam window/.test(error)));
});
test("coding draft needs languages and bounded source, with no executable tests required", () => {
  const exam = draft(),
    coding = newExamQuestion("coding");
  Object.assign(coding, {
    title: "Echo input",
    prompt: "Read stdin and print it.",
    languages: [],
    starterCode: { Python: "x".repeat(30001) },
  });
  exam.questions = [coding];
  const errors = validateExamDraft(exam);
  assert.ok(errors.some((error) => /programming language/.test(error)));
  assert.ok(errors.some((error) => /starter code/.test(error)));
});
test("submission-only coding drafts can be saved with a prompt and no test cases", () => {
  const exam = draft();
  const coding = newExamQuestion("coding", "coding-prompt");
  coding.title = "Reverse a string";
  coding.prompt =
    "Write a function that reverses its input. Explain its complexity.";
  exam.questions = [coding];
  assert.deepEqual(coding.testCases, []);
  assert.deepEqual(validateExamDraft(exam), []);
  assert.equal(examDraftFrom(exam).codingGrading, "manual");
});
test("editing a historical draft uses manual review while preserving saved references", () => {
  const exam = draft();
  const coding = newExamQuestion("coding", "coding-old");
  coding.title = "Echo";
  coding.prompt = "Return the input";
  coding.testCases = [
    { id: "old-example", input: "hello", output: "hello", hidden: false },
  ];
  exam.questions = [coding];
  exam.codingGrading = "automatic";
  const payload = examDraftFrom(exam);
  assert.equal(payload.codingGrading, "manual");
  assert.deepEqual(payload.questions[0].testCases, coding.testCases);
  assert.deepEqual(validateExamDraft(payload), []);
  payload.questions[0].testCases[0].input = "Changed";
  assert.equal(coding.testCases[0].input, "hello");
});
test("test and question identities must be unique", () => {
  const exam = draft();
  exam.questions.push(structuredClone(exam.questions[0]));
  assert.ok(
    validateExamDraft(exam).some((error) => /Question IDs/.test(error)),
  );
  const question = newExamQuestion("coding");
  Object.assign(question, { title: "Program", prompt: "Print 1" });
  question.testCases = [
    { id: "duplicate", input: "a", output: "a", hidden: false },
    { id: "duplicate", input: "b", output: "b", hidden: true },
  ];
  exam.questions = [question];
  assert.ok(
    validateExamDraft(exam).some((error) => /test case IDs/.test(error)),
  );
});
test("datetime controls round-trip the same instant without changing timezone", () => {
  const value = "2027-04-05T08:30:00.000Z";
  assert.equal(isoDateTime(localDateTime(value)), value);
  assert.equal(isoDateTime(""), "");
});
test("CSV export neutralizes spreadsheet formulas and preserves escaped quotes/newlines", () => {
  for (const value of [
    '=HYPERLINK("https://example.test")',
    "+123",
    "-1+2",
    "@SUM(A1)",
    "  =1",
    "\tdata",
    "\rdata",
    "\ndata",
  ])
    assert.ok(csvCell(value).startsWith("\"'"));
  assert.equal(csvCell('Student "A"'), '"Student ""A"""');
  const csv = examResultsCsv([
    {
      name: "=1+1",
      email: "person@example.test",
      studentId: "@A1",
      branchName: "CSE",
      branchCode: "CSE",
      status: "graded",
      earnedPoints: 5,
      totalPoints: 10,
      percentage: 50,
      passed: true,
      eventCount: 0,
      startedAt: null,
      submittedAt: null,
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'@A1"'));
  assert.ok(csv.includes('"Passed"'));
});
