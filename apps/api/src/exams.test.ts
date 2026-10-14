import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { AdminExam, ExamDraft } from "@slate/contracts";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { createAuth } from "./auth.js";
import { createApplication } from "./app.js";
import { SlateService, type Actor } from "./service.js";
import { ExamService, examDraftInput } from "./exams.js";
import { BranchService } from "./branches.js";
import * as s from "./schema.js";

test("live exams preserve audiences and answers, enforce deadlines and roles, and grade without leaking keys", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "exams-test-only-secret-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173", "http://localhost:5174"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(
    connection.db,
    auth,
    config,
    {
      configured: false,
      async send() {
        assert.fail("Exam operations must not send messages.");
      },
    },
    true,
  );
  const exams = new ExamService(service);
  const [org, other] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizations)
      .values([{ name: "Exam College" }, { name: "Other Exam College" }])
      .returning(),
  );
  await scoped(connection.db, { platform: true }, (tx) =>
    tx.insert(s.organizationBranches).values([
      { organizationId: org.id, code: "CSE", name: "Computer Science" },
      { organizationId: org.id, code: "ME", name: "Mechanical" },
      { organizationId: other.id, code: "CSE", name: "Computer Science" },
      { organizationId: other.id, code: "ECE", name: "Electronics" },
    ]),
  );
  async function person(
    name: string,
    role: Actor["role"],
    organizationId: string | null,
    branchCode = "CSE",
  ) {
    const u = await auth.api.createUser({
      body: {
        name,
        email: name + "@example.test",
        password: "Exam-test-password!2026",
        role: role === "platform_admin" ? "admin" : "user",
      },
    });
    const [m] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: u.user.id,
          role,
          organizationId,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
          branchCode,
          branchName: branchCode === "CSE" ? "Computer Science" : "Mechanical",
        })
        .returning(),
    );
    const actor: Actor = {
      id: m.id,
      authId: u.user.id,
      sessionId: "test-session",
      name,
      email: u.user.email,
      role,
      organizationId,
      organizationName: organizationId ? org.name : null,
      onboardingStep: null,
      features: ["live-exams"],
    };
    return actor;
  }
  const admin = await person("exam-admin", "platform_admin", null),
    student = await person("exam-student", "student", org.id),
    peer = await person("exam-peer", "student", org.id),
    mechanical = await person("exam-mech", "student", org.id, "ME"),
    outsider = await person("exam-outsider", "student", other.id),
    viewer = await person("exam-viewer", "organization_viewer", org.id);
  const draft = (changes: Partial<ExamDraft> = {}): ExamDraft => ({
    organizationId: org.id,
    title: "Placement test",
    description: "A real persisted assessment",
    instructions: "Answer all questions.",
    codingGrading: "manual",
    audience: { mode: "branches", branchCodes: ["CSE"], studentIds: [] },
    startsAt: new Date(Date.now() + 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    durationMinutes: 10,
    passingPercentage: 60,
    monitoring: {
      enabled: true,
      requireFullscreen: true,
      recordClipboard: false,
    },
    questions: [
      {
        id: "mcq-1",
        kind: "mcq",
        title: "Sum",
        prompt: "What is 1 + 1?",
        points: 10,
        options: ["1", "2", "3"],
        correctOption: 1,
        explanation: "Add both units.",
      },
    ],
    ...changes,
  });
  async function open(exam: AdminExam) {
    await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .update(s.liveExams)
        .set({ startsAt: new Date(Date.now() - 1000) })
        .where(eq(s.liveExams.id, exam.id)),
    );
  }
  async function close(exam: AdminExam) {
    await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .update(s.liveExams)
        .set({ endsAt: new Date(Date.now() - 100) })
        .where(eq(s.liveExams.id, exam.id)),
    );
  }
  let exam: AdminExam;
  let attemptId = "";
  try {
    await t.test(
      "validates question keys, audience scope and access, and retries create safely",
      async () => {
        assert.equal(
          examDraftInput.safeParse(
            draft({
              questions: [
                {
                  ...draft().questions[0],
                  kind: "mcq",
                  options: ["one", "two"],
                  correctOption: 7,
                  explanation: "",
                },
              ],
            }),
          ).success,
          false,
        );
        await assert.rejects(
          () =>
            exams.create(admin, {
              ...draft({
                audience: {
                  mode: "students",
                  branchCodes: ["CSE"],
                  studentIds: [outsider.id],
                },
              }),
              clientId: randomUUID(),
            }),
          /belonging/,
        );
        await assert.rejects(
          () => exams.create(viewer, { ...draft(), clientId: randomUUID() }),
          /Only Platform Admin/,
        );
        const input = { ...draft(), clientId: randomUUID() };
        exam = await exams.create(admin, input);
        const duplicate = await exams.create(admin, input);
        assert.equal(duplicate.id, exam.id);
        assert.equal((await exams.audience(admin, org.id)).students.length, 3);
        const orgAudience = await exams.audience(admin, org.id);
        assert.deepEqual(
          orgAudience.branches.map((branch) => branch.code).sort(),
          ["CSE", "ME"],
        );
        assert.ok(
          !orgAudience.students.some((person) => person.id === outsider.id),
        );
        const otherAudience = await exams.audience(admin, other.id);
        assert.deepEqual(
          otherAudience.students.map((person) => person.id),
          [outsider.id],
        );
        for (const selection of [
          { mode: "organization" as const, branchCodes: [], studentIds: [] },
          {
            mode: "branches" as const,
            branchCodes: ["CSE", "ME"],
            studentIds: [],
          },
          {
            mode: "students" as const,
            branchCodes: [],
            studentIds: [student.id],
          },
        ]) {
          assert.equal(
            examDraftInput.safeParse(draft({ audience: selection })).success,
            false,
          );
          await assert.rejects(() =>
            exams.create(admin, {
              ...draft({ audience: selection }),
              clientId: randomUUID(),
            }),
          );
        }
        await assert.rejects(
          () =>
            exams.create(admin, {
              ...draft({
                audience: {
                  mode: "branches",
                  branchCodes: ["ECE"],
                  studentIds: [],
                },
              }),
              clientId: randomUUID(),
            }),
          /belonging to this organization/,
        );
        await assert.rejects(
          () =>
            exams.create(admin, {
              ...draft({
                audience: {
                  mode: "students",
                  branchCodes: ["CSE"],
                  studentIds: [mechanical.id],
                },
              }),
              clientId: randomUUID(),
            }),
          /selected branch/,
        );
        const oldDraft = await exams.create(admin, {
          ...draft({ title: "Historical broad draft" }),
          clientId: randomUUID(),
        });
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExams)
            .set({
              audience: {
                mode: "organization",
                branchCodes: [],
                studentIds: [],
              },
            })
            .where(eq(s.liveExams.id, oldDraft.id)),
        );
        assert.equal(
          (await exams.detail(admin, oldDraft.id)).audience.mode,
          "organization",
        );
        await assert.rejects(
          () => exams.publish(admin, oldDraft.id, oldDraft.revision),
          /exactly one branch/,
        );
        await exams.update(admin, oldDraft.id, {
          ...draft(),
          revision: oldDraft.revision,
        });
        await assert.rejects(
          () => exams.update(admin, exam.id, { ...draft(), revision: 99 }),
          /another session/,
        );
      },
    );
    await t.test(
      "freezes branch roster, protects drafts, and prevents early starts",
      async () => {
        assert.deepEqual(await exams.studentList(student), []);
        exam = await exams.publish(admin, exam.id, exam.revision);
        assert.equal(exam.audienceCount, 2);
        const roster = await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .select()
            .from(s.liveExamRoster)
            .where(eq(s.liveExamRoster.examId, exam.id)),
        );
        assert.deepEqual(
          roster.map((person) => person.memberId).sort(),
          [student.id, peer.id].sort(),
        );
        assert.ok(
          roster.every(
            (person) =>
              person.organizationId === org.id && person.branchCode === "CSE",
          ),
        );
        await assert.rejects(
          () =>
            exams.update(admin, exam.id, {
              ...draft(),
              revision: exam.revision,
            }),
          /cannot be edited/,
        );
        await assert.rejects(() => exams.start(student, exam.id), /not open/);
        assert.equal((await exams.studentList(student)).length, 1);
        assert.deepEqual(await exams.studentList(mechanical), []);
        assert.deepEqual(await exams.studentList(outsider), []);
        await assert.rejects(
          () => exams.studentExam(outsider, exam.id),
          /not found/,
        );
        // Existing published exams are read from their immutable member roster,
        // even when their historical audience uses an older, broader shape.
        for (const legacy of [
          { mode: "organization" as const, branchCodes: [], studentIds: [] },
          {
            mode: "branches" as const,
            branchCodes: ["CSE", "ME"],
            studentIds: [],
          },
        ]) {
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.liveExams)
              .set({ audience: legacy })
              .where(eq(s.liveExams.id, exam.id)),
          );
          assert.deepEqual(
            (await exams.detail(admin, exam.id)).audience,
            legacy,
          );
          assert.equal((await exams.studentExam(student, exam.id)).id, exam.id);
          assert.deepEqual(await exams.studentList(mechanical), []);
          assert.deepEqual(await exams.studentList(outsider), []);
        }
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExams)
            .set({ audience: exam.audience })
            .where(eq(s.liveExams.id, exam.id)),
        );
      },
    );
    await t.test(
      "branch rename preserves frozen member audience and RLS hides answer keys",
      async () => {
        const waitingDraft = await exams.create(admin, {
          ...draft({ title: "Draft before branch rename" }),
          clientId: randomUUID(),
        });
        await new BranchService(service).update(admin, org.id, "CSE", {
          name: "Computer Engineering",
          code: "CSE-NEW",
          revision: 0,
        });
        const renamedDraft = await exams.detail(admin, waitingDraft.id);
        assert.deepEqual(renamedDraft.audience.branchCodes, ["CSE-NEW"]);
        assert.equal(renamedDraft.revision, waitingDraft.revision + 1);
        assert.deepEqual(
          (await exams.detail(admin, exam.id)).audience.branchCodes,
          ["CSE"],
        );
        await assert.rejects(
          () => exams.publish(admin, waitingDraft.id, waitingDraft.revision),
          /another session/,
        );
        assert.equal((await exams.studentList(student))[0].id, exam.id);
        const leaked = await scoped(
          connection.db,
          { authId: student.authId, organizationId: org.id },
          (tx) => tx.select().from(s.liveExamQuestions),
        );
        assert.deepEqual(leaked, []);
        const rows = await scoped(
          connection.db,
          { authId: outsider.authId, organizationId: other.id },
          (tx) => tx.select().from(s.liveExamRoster),
        );
        assert.deepEqual(rows, []);
        await open(exam);
        const attempt = await exams.start(student, exam.id);
        attemptId = attempt.id;
        assert.equal((await exams.start(student, exam.id)).id, attempt.id);
        assert.equal(attempt.questions[0].kind, "mcq");
        assert.equal("correctOption" in attempt.questions[0], false);
        assert.equal("explanation" in attempt.questions[0], false);
        assert.equal(attempt.result, null);
        assert.ok(
          new Date(attempt.deadlineAt).getTime() <=
            new Date(attempt.exam.endsAt).getTime(),
        );
      },
    );
    await t.test(
      "rejects other students and stale tabs; persists answers and idempotent monitoring",
      async () => {
        await assert.rejects(() => exams.attempt(peer, attemptId), /not found/);
        const saved = await exams.save(student, attemptId, {
          revision: 0,
          answers: [{ questionId: "mcq-1", selectedOption: 1 }],
        });
        assert.equal(saved.revision, 1);
        await assert.rejects(
          () => exams.save(student, attemptId, { revision: 0, answers: [] }),
          /another tab/,
        );
        const event = {
          id: randomUUID(),
          type: "tab_hidden" as const,
          occurredAt: new Date().toISOString(),
        };
        assert.deepEqual(
          await exams.events(student, attemptId, { events: [event] }),
          { accepted: 1 },
        );
        assert.deepEqual(
          await exams.events(student, attemptId, { events: [event] }),
          { accepted: 0 },
        );
        assert.deepEqual(
          await exams.events(student, attemptId, {
            events: [{ ...event, id: randomUUID(), type: "copy" }],
          }),
          { accepted: 0 },
        );
        assert.equal(
          (await exams.attempt(student, attemptId)).answers[0].selectedOption,
          1,
        );
      },
    );
    await t.test(
      "server grades MCQs once and withholds results until admin releases after close",
      async () => {
        const submitted = await exams.save(
          student,
          attemptId,
          {
            revision: 1,
            answers: [{ questionId: "mcq-1", selectedOption: 1 }],
          },
          true,
        );
        assert.equal(submitted.status, "graded");
        assert.equal(submitted.result, null);
        const finalEvent = {
          id: randomUUID(),
          type: "window_blur" as const,
          occurredAt: submitted.submittedAt!,
        };
        assert.deepEqual(
          await exams.events(student, attemptId, { events: [finalEvent] }),
          { accepted: 1 },
        );
        assert.deepEqual(
          await exams.events(student, attemptId, { events: [finalEvent] }),
          { accepted: 0 },
        );
        assert.deepEqual(
          await exams.events(student, attemptId, {
            events: [
              {
                ...finalEvent,
                id: randomUUID(),
                occurredAt: new Date(
                  new Date(submitted.submittedAt!).getTime() + 1,
                ).toISOString(),
              },
            ],
          }),
          { accepted: 0 },
        );
        assert.deepEqual(
          await exams.events(student, attemptId, {
            events: [
              {
                ...finalEvent,
                id: randomUUID(),
                occurredAt: new Date(
                  new Date(submitted.startedAt).getTime() - 1,
                ).toISOString(),
              },
            ],
          }),
          { accepted: 0 },
        );
        const retry = await exams.save(
          student,
          attemptId,
          {
            revision: 1,
            answers: [{ questionId: "mcq-1", selectedOption: 0 }],
          },
          true,
        );
        assert.equal(retry.answers[0].selectedOption, 1);
        const results = await exams.results(admin, exam.id);
        assert.equal(
          results.rows.find((r) => r.memberId === student.id)?.earnedPoints,
          10,
        );
        await assert.rejects(
          () => exams.release(admin, exam.id, exam.revision),
          /after.*closed/,
        );
        await close(exam);
        exam = await exams.release(admin, exam.id, exam.revision);
        const released = await exams.attempt(student, attemptId);
        assert.equal(released.result?.percentage, 100);
        assert.equal(released.result?.questions[0].correctOption, 1);
      },
    );
    await t.test(
      "late submission is frozen at server deadline and uses only previously saved answers",
      async () => {
        const input = draft({
          audience: {
            mode: "students",
            branchCodes: ["CSE-NEW"],
            studentIds: [student.id],
          },
          startsAt: new Date(Date.now() + 60000).toISOString(),
        });
        let timed = await exams.create(admin, {
          ...input,
          clientId: randomUUID(),
        });
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ branchCode: "ME", branchName: "Mechanical" })
            .where(eq(s.members.id, student.id)),
        );
        await assert.rejects(
          () => exams.publish(admin, timed.id, timed.revision),
          /selected branch/,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ branchCode: "CSE-NEW", branchName: "Computer Engineering" })
            .where(eq(s.members.id, student.id)),
        );
        timed = await exams.publish(admin, timed.id, timed.revision);
        assert.equal(timed.audienceCount, 1);
        const selectedRoster = await scoped(
          connection.db,
          { platform: true },
          (tx) =>
            tx
              .select()
              .from(s.liveExamRoster)
              .where(eq(s.liveExamRoster.examId, timed.id)),
        );
        assert.deepEqual(
          selectedRoster.map((person) => person.memberId),
          [student.id],
        );
        await open(timed);
        const attempt = await exams.start(student, timed.id);
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExamAttempts)
            .set({ deadlineAt: new Date(Date.now() - 1000) })
            .where(eq(s.liveExamAttempts.id, attempt.id)),
        );
        const late = await exams.save(
          student,
          attempt.id,
          {
            revision: 0,
            answers: [{ questionId: "mcq-1", selectedOption: 1 }],
          },
          true,
        );
        assert.deepEqual(late.answers, []);
        assert.equal(late.status, "graded");
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExamAttempts)
            .set({
              submittedAt: new Date(Date.now() - 61000),
              deadlineAt: new Date(Date.now() - 61000),
            })
            .where(eq(s.liveExamAttempts.id, attempt.id)),
        );
        assert.deepEqual(
          await exams.events(student, attempt.id, {
            events: [
              {
                id: randomUUID(),
                type: "window_blur",
                occurredAt: new Date(Date.now() - 62000).toISOString(),
              },
            ],
          }),
          { accepted: 0 },
        );
        assert.equal(
          (await exams.results(admin, timed.id)).rows[0].earnedPoints,
          0,
        );
      },
    );
    await t.test(
      "manual coding works without provider, hides cases and retains submitted source for review",
      async () => {
        const coding = {
          id: "code-1",
          kind: "coding" as const,
          title: "Echo",
          prompt: "Echo the input.",
          points: 20,
          languages: ["Python" as const],
          starterCode: { Python: "print(input())" },
          testCases: [
            { id: "sample", input: "hello", output: "hello", hidden: false },
            {
              id: "secret",
              input: "secret-input",
              output: "secret-output",
              hidden: true,
            },
          ],
        };
        const input = draft({
          audience: {
            mode: "students",
            branchCodes: ["CSE-NEW"],
            studentIds: [student.id],
          },
          questions: [...draft().questions, coding],
        });
        let manual = await exams.create(admin, {
          ...input,
          clientId: randomUUID(),
        });
        manual = await exams.publish(admin, manual.id, manual.revision);
        await open(manual);
        const a = await exams.start(student, manual.id);
        assert.equal(JSON.stringify(a).includes("secret-input"), false);
        assert.equal(JSON.stringify(a).includes("secret-output"), false);
        const submitted = await exams.save(
          student,
          a.id,
          {
            revision: 0,
            answers: [
              { questionId: "mcq-1", selectedOption: 1 },
              {
                questionId: "code-1",
                language: "Python",
                code: "print(input())",
              },
            ],
          },
          true,
        );
        assert.equal(submitted.status, "submitted");
        const review = await exams.adminAttempt(admin, manual.id, a.id);
        assert.equal(review.result.earnedPoints, null);
        assert.equal(review.answers[1].code, "print(input())");
        await assert.rejects(
          () =>
            exams.manualGrade(admin, manual.id, a.id, {
              revision: review.revision,
              scores: [{ questionId: "code-1", points: 21, feedback: "" }],
            }),
          /maximum points/,
        );
        const graded = await exams.manualGrade(admin, manual.id, a.id, {
          revision: review.revision,
          scores: [
            {
              questionId: "code-1",
              points: 15.5,
              feedback: "Check empty input.",
            },
          ],
        });
        assert.equal(graded.status, "graded");
        assert.equal(graded.result.earnedPoints, 25.5);
        await assert.rejects(
          () =>
            exams.manualGrade(admin, manual.id, a.id, {
              revision: review.revision,
              scores: [{ questionId: "code-1", points: 20, feedback: "" }],
            }),
          /another session/,
        );
        await close(manual);
        manual = await exams.release(admin, manual.id, manual.revision);
        assert.equal(
          (await exams.attempt(student, a.id)).result?.questions[1].explanation,
          "Check empty input.",
        );
        await assert.rejects(
          () =>
            exams.manualGrade(admin, manual.id, a.id, {
              revision: graded.revision,
              scores: [{ questionId: "code-1", points: 20, feedback: "" }],
            }),
          /unreleased/,
        );
      },
    );
    await t.test(
      "coding is submission-only, accepts a prompt without tests or a language answer, and requires manual review",
      async () => {
        const coding = {
          id: "text-code",
          kind: "coding" as const,
          title: "Write a function",
          prompt:
            "Write a function that reverses a string and explain your approach in comments.",
          points: 20,
          languages: ["Python" as const],
          starterCode: {},
          testCases: [],
        };
        assert.equal(
          examDraftInput.safeParse({ ...draft(), codingGrading: "automatic" })
            .success,
          false,
        );
        const input = draft({
          audience: {
            mode: "students",
            branchCodes: ["CSE-NEW"],
            studentIds: [student.id],
          },
          questions: [...draft().questions, coding],
        });
        let manual = await exams.create(admin, {
          ...input,
          clientId: randomUUID(),
        });
        // Historical drafts use the manual flow when published; no provider exists.
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExams)
            .set({ codingGrading: "automatic" })
            .where(eq(s.liveExams.id, manual.id)),
        );
        manual = await exams.publish(admin, manual.id, manual.revision);
        assert.equal(manual.codingGrading, "manual");
        await open(manual);
        const attempt = await exams.start(student, manual.id);
        const code =
          "function reverse(text) { return [...text].reverse().join(''); }";
        const submitted = await exams.save(
          student,
          attempt.id,
          {
            revision: attempt.revision,
            answers: [
              { questionId: "mcq-1", selectedOption: 1 },
              { questionId: coding.id, code },
            ],
          },
          true,
        );
        assert.equal(submitted.status, "submitted");
        assert.equal(submitted.answers[1].code, code);
        assert.equal(submitted.answers[1].language, undefined);
        const review = await exams.adminAttempt(admin, manual.id, attempt.id);
        assert.equal(review.result.questions[0].earnedPoints, 10);
        assert.equal(review.result.questions[1].earnedPoints, null);
        assert.equal(
          review.result.questions[1].verdict,
          "Awaiting manual review",
        );
        await close(manual);
        await assert.rejects(
          () => exams.release(admin, manual.id, manual.revision),
          /still need review/,
        );
        // A historical published record also permits human review without execution.
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExams)
            .set({ codingGrading: "automatic" })
            .where(eq(s.liveExams.id, manual.id)),
        );
        const graded = await exams.manualGrade(admin, manual.id, attempt.id, {
          revision: review.revision,
          scores: [
            { questionId: coding.id, points: 18, feedback: "Good approach." },
          ],
        });
        assert.equal(graded.result.earnedPoints, 28);
        assert.equal(graded.status, "graded");
      },
    );
    await t.test(
      "cancellation closes attempts; suspension and archived organizations deny student use",
      async () => {
        let cancel = await exams.create(admin, {
          ...draft({
            audience: {
              mode: "students",
              branchCodes: ["CSE-NEW"],
              studentIds: [student.id],
            },
          }),
          clientId: randomUUID(),
        });
        cancel = await exams.publish(admin, cancel.id, cancel.revision);
        await open(cancel);
        const a = await exams.start(student, cancel.id);
        cancel = await exams.cancel(admin, cancel.id, cancel.revision);
        assert.equal(
          (await exams.attempt(student, a.id)).exam.state,
          "cancelled",
        );
        await assert.rejects(
          () =>
            exams.save(student, a.id, { revision: a.revision, answers: [] }),
          /already been submitted/,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ status: "suspended" })
            .where(eq(s.members.id, student.id)),
        );
        await assert.rejects(() => exams.studentList(student), /active/);
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ status: "active" })
            .where(eq(s.members.id, student.id)),
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.organizations)
            .set({ status: "archived" })
            .where(eq(s.organizations.id, org.id)),
        );
        await assert.rejects(() => exams.studentList(student), /Activate/);
        await assert.rejects(
          () => exams.create(admin, { ...draft(), clientId: randomUUID() }),
          /Activate/,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.organizations)
            .set({ status: "active" })
            .where(eq(s.organizations.id, org.id)),
        );
      },
    );
    await t.test(
      "HTTP endpoints enforce authentication, portal roles, origin and payload shape",
      async () => {
        const app = await createApplication(service);
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        async function cookie(actor: Actor) {
          const response = await auth.api.signInEmail({
            body: { email: actor.email, password: "Exam-test-password!2026" },
            asResponse: true,
          });
          return response.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; ");
        }
        const adminCookie = await cookie(admin),
          studentCookie = await cookie(student);
        try {
          const request = (
            path: string,
            cookie = "",
            method = "GET",
            body?: unknown,
          ) =>
            fetch(base + "/api/v1/" + path, {
              method,
              headers: {
                Cookie: cookie,
                Origin: config.origins[1],
                "Content-Type": "application/json",
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            });
          assert.equal((await request("platform/exams")).status, 401);
          assert.equal(
            (await request("platform/exams", studentCookie)).status,
            403,
          );
          assert.equal(
            (await request("platform/exams/capabilities", adminCookie)).status,
            200,
          );
          const capabilities = await request(
            "platform/exams/capabilities",
            adminCookie,
          );
          assert.deepEqual(await capabilities.json(), {
            codingExecutionConfigured: false,
            codingGrading: "manual",
            provider: null,
          });
          const list = await request("student/exams", studentCookie);
          assert.equal(list.status, 200);
          assert.ok(Array.isArray(await list.json()));
          assert.equal(
            (
              await request("platform/exams", adminCookie, "POST", {
                ...draft(),
                clientId: randomUUID(),
                earnedPoints: 500,
              })
            ).status,
            400,
          );
          const questions = Array.from({ length: 10 }, (_, index) => ({
            id: `unicode-${index}`,
            kind: "coding" as const,
            title: "Unicode source",
            prompt: "Submit a program with comments.",
            points: 10,
            languages: ["Python" as const],
            starterCode: {},
            testCases: [
              { id: "sample", input: "a", output: "a", hidden: false },
              { id: "private", input: "b", output: "b", hidden: true },
            ],
          }));
          let unicodeExam = await exams.create(admin, {
            ...draft({
              audience: {
                mode: "students",
                branchCodes: ["CSE-NEW"],
                studentIds: [student.id],
              },
              questions,
            }),
            clientId: randomUUID(),
          });
          unicodeExam = await exams.publish(
            admin,
            unicodeExam.id,
            unicodeExam.revision,
          );
          await open(unicodeExam);
          const attempt = await exams.start(student, unicodeExam.id);
          const code = "# " + "字".repeat(29998);
          const payload = {
            revision: attempt.revision,
            answers: questions.map((question) => ({
              questionId: question.id,
              language: "Python",
              code,
            })),
          };
          assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 512 * 1024);
          assert.equal(
            (
              await request(
                `student/exam-attempts/${attempt.id}/run`,
                studentCookie,
                "POST",
                {
                  questionId: questions[0].id,
                  language: "Python",
                  code: "print(1)",
                },
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                `platform/exams/${unicodeExam.id}/regrade`,
                adminCookie,
                "POST",
                { revision: unicodeExam.revision },
              )
            ).status,
            404,
          );
          const saved = await request(
            `student/exam-attempts/${attempt.id}/answers`,
            studentCookie,
            "PUT",
            payload,
          );
          assert.equal(saved.status, 200);
          const returned = await saved.json();
          assert.equal(returned.answers.length, 10);
          assert.equal(returned.answers[9].code, code);
        } finally {
          await app.close();
        }
      },
    );
    await t.test(
      "migration grants neither question-key reads nor exam writes to organization readers",
      async () => {
        await assert.rejects(
          () =>
            scoped(
              connection.db,
              { authId: viewer.authId, organizationId: org.id, readonly: true },
              (tx) => tx.select().from(s.liveExams),
            ),
          (error: any) => error.cause?.code === "42501",
        );
        const result = await connection.db.execute(
          sql`select count(*)::integer as n from pg_class where relname in ('live_exams','live_exam_questions','live_exam_roster','live_exam_attempts','live_exam_events') and relrowsecurity and relforcerowsecurity`,
        );
        assert.equal(result.rows[0].n, 5);
      },
    );
  } finally {
    await connection.close();
  }
});
