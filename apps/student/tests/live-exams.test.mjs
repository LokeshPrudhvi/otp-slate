// Run: node --test apps/student/tests/live-exams.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://student.example.test/live-exams/exam/attempt/attempt",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Event",
  "MouseEvent",
  "MessageEvent",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(
  `../.live-exam-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  stdin: {
    contents:
      'export * from "./live-exam-session.ts"; export * from "./exam-onecompiler.tsx"; export {ExamAttempt} from "./live-exams.tsx"; export {AccessRoute} from "./access.tsx"; export {StudentShell} from "./design.tsx";',
    resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
  },
  outfile: fileURLToPath(bundle),
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: [
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
    "react-router-dom",
    "@tanstack/react-query",
    "better-auth/*",
    "react-markdown",
    "remark-gfm",
  ],
});
const {
  ExamSession,
  ExamEventBuffer,
  compilerSourceMessage,
  ExamOneCompiler,
  ExamAttempt,
  AccessRoute,
  StudentShell,
} = await import(bundle.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const stamp = "2026-10-12T10:00:00.000Z";
function fixture(patch = {}) {
  return {
    id: "attempt",
    examId: "exam",
    status: "in_progress",
    revision: 1,
    serverNow: stamp,
    startedAt: stamp,
    deadlineAt: "2026-10-12T10:30:00.000Z",
    submittedAt: null,
    answers: [],
    eventCount: 0,
    result: null,
    exam: {
      id: "exam",
      title: "Assigned exam",
      description: "Exam description",
      instructions: "Read carefully",
      startsAt: stamp,
      endsAt: "2026-10-12T11:00:00.000Z",
      durationMinutes: 30,
      questionCount: 2,
      totalPoints: 10,
      state: "live",
      attemptId: "attempt",
      attemptStatus: "in_progress",
      resultsReleased: false,
      percentage: null,
      codingGrading: "manual",
      passingPercentage: 50,
      monitoring: {
        enabled: true,
        requireFullscreen: false,
        recordClipboard: true,
      },
      serverNow: stamp,
    },
    questions: [
      {
        id: "q1",
        kind: "mcq",
        title: "Choose a number",
        prompt: "Which number is even?",
        points: 5,
        options: ["Two", "Three"],
      },
      {
        id: "q2",
        kind: "coding",
        title: "Sum two numbers",
        prompt: "Print their sum.",
        points: 5,
        languages: ["Python", "JavaScript"],
        starterCode: { Python: "# start here", JavaScript: "// start here" },
        testCases: [{ id: "sample", input: "1 2", output: "3", hidden: false }],
      },
    ],
    ...patch,
  };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const answer = (value) => ({ questionId: "q1", selectedOption: value });

test("versioned autosaves serialize and retain changes entered during a pending write", async () => {
  const first = deferred(),
    calls = [];
  let current = fixture();
  const session = new ExamSession(
    current,
    async (path, method, body) => {
      calls.push({ path, method, body });
      if (calls.length === 1) await first.promise;
      current = {
        ...current,
        revision: current.revision + 1,
        answers: body.answers,
      };
      return current;
    },
    () => 0,
  );
  session.edit(answer(0));
  const save = session.save();
  session.edit(answer(1));
  assert.equal(session.save(), save);
  assert.equal(calls.length, 1);
  first.resolve();
  await save;
  assert.deepEqual(
    calls.map((c) => c.body.revision),
    [1, 2],
  );
  assert.deepEqual(
    calls.map((c) => c.body.answers[0].selectedOption),
    [0, 1],
  );
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.view.revision, 3);
  assert.equal(session.state.answers[0].selectedOption, 1);
});
test("manual submit waits for current autosave and atomically sends the latest answers", async () => {
  const gate = deferred(),
    calls = [];
  let current = fixture();
  const session = new ExamSession(
    current,
    async (path, method, body) => {
      calls.push({ path, body });
      if (path.endsWith("/answers")) await gate.promise;
      current = {
        ...current,
        revision: current.revision + 1,
        answers: body.answers,
        status: path.endsWith("/submit") ? "submitted" : "in_progress",
      };
      return current;
    },
    () => 0,
  );
  session.edit(answer(0));
  void session.save();
  session.edit(answer(1));
  const submit = session.submit();
  assert.equal(calls.length, 1);
  session.edit(answer(0));
  gate.resolve();
  await submit;
  assert.equal(calls.length, 2);
  assert.match(calls[1].path, /\/submit$/);
  assert.equal(calls[1].body.revision, 2);
  assert.deepEqual(calls[1].body.answers, [answer(1)]);
  assert.equal(session.state.view.status, "submitted");
  assert.equal(session.state.dirty, false);
});
test("conflict prevents edits and writes until the saved attempt is explicitly reloaded", async () => {
  let calls = 0,
    current = fixture({ revision: 8, answers: [answer(1)] });
  const session = new ExamSession(
    fixture(),
    async (path) => {
      calls++;
      if (path.endsWith("/answers"))
        throw Object.assign(new Error("Conflict"), { status: 409 });
      return current;
    },
    () => 0,
  );
  session.edit(answer(0));
  await session.save();
  assert.equal(session.state.conflict, true);
  session.edit(answer(1));
  await session.save();
  await session.submit();
  assert.equal(calls, 1);
  assert.equal(session.state.answers[0].selectedOption, 0);
  await session.reload();
  assert.equal(session.state.conflict, false);
  assert.equal(session.state.view.revision, 8);
  assert.deepEqual(session.state.answers, [answer(1)]);
  assert.equal(session.state.dirty, false);
});

test("reload blocks new editing and serializes a simultaneous deadline submit behind the fresh snapshot", async () => {
  const gate = deferred(),
    calls = [];
  const latest = fixture({ revision: 7, answers: [answer(1)] });
  const session = new ExamSession(
    fixture(),
    async (path, method, body) => {
      calls.push({ path, body });
      if (!method) {
        await gate.promise;
        return latest;
      }
      return { ...latest, status: "submitted", answers: body.answers };
    },
    () => 0,
  );
  const reloading = session.reload();
  assert.equal(session.state.reloading, true);
  session.edit(answer(0));
  assert.deepEqual(session.state.answers, []);
  const submit = session.submit(true);
  assert.equal(calls.length, 1);
  gate.resolve();
  await Promise.all([reloading, submit]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.revision, 7);
  assert.deepEqual(calls[1].body.answers, [answer(1)]);
  assert.equal(session.state.view.status, "submitted");
});
test("a failed reload cannot clear a known revision conflict", async () => {
  const session = new ExamSession(
    fixture(),
    async (path) => {
      throw Object.assign(new Error("error"), {
        status: path.endsWith("/answers") ? 409 : 0,
      });
    },
    () => 0,
  );
  session.edit(answer(0));
  await session.save();
  await session.reload();
  assert.equal(session.state.conflict, true);
  assert.equal(session.state.reloading, false);
  session.edit(answer(1));
  assert.deepEqual(session.state.answers, [answer(0)]);
});
test("network errors keep local unsaved work available for a deliberate retry", async () => {
  let fail = true;
  const session = new ExamSession(
    fixture(),
    async (path, method, body) => {
      if (fail) throw new Error("Offline");
      return fixture({ revision: 2, answers: body.answers });
    },
    () => 0,
  );
  session.edit(answer(1));
  await session.save();
  assert.equal(session.state.dirty, true);
  assert.equal(session.state.saving, false);
  assert.equal(session.state.conflict, false);
  assert.match(session.state.error, /Offline/);
  fail = false;
  await session.save();
  assert.equal(session.state.dirty, false);
});
test("server-adjusted monotonic deadline blocks edits and timeout submits persisted answers only", async () => {
  let clock = 0,
    submitted;
  const session = new ExamSession(
    fixture({ answers: [answer(0)] }),
    async (path, method, body) => {
      submitted = body;
      return fixture({
        status: "submitted",
        revision: 2,
        answers: body.answers,
      });
    },
    () => clock,
  );
  session.edit(answer(1));
  clock = 30 * 60_000 + 1;
  assert.equal(session.remaining(), 0);
  session.edit({ questionId: "q2", language: "Python", code: "too late" });
  assert.equal(session.state.answers.length, 1);
  await session.save();
  assert.equal(submitted, undefined);
  await session.submit(true);
  assert.deepEqual(submitted.answers, [answer(0)]);
  assert.equal(session.state.view.status, "submitted");
  session.edit(answer(1));
  assert.deepEqual(session.state.answers, [answer(0)]);
});
test("resume uses server answers and revision without resetting the supplied deadline", () => {
  const view = fixture({
    revision: 9,
    answers: [answer(1)],
    serverNow: "2026-10-12T10:10:00.000Z",
  });
  const session = new ExamSession(
    view,
    async () => {
      throw Error("unexpected");
    },
    () => 40,
  );
  assert.equal(session.remaining(), 20 * 60_000);
  assert.deepEqual(session.state.answers, [answer(1)]);
  assert.equal(session.state.view.revision, 9);
  assert.equal(session.state.dirty, false);
});
test("monitoring has bounded batches, stable retry IDs and no clipboard contents", async () => {
  const batches = [];
  let fails = true;
  const buffer = new ExamEventBuffer(
    async (events) => {
      batches.push(structuredClone(events));
      if (fails) throw Error("offline");
    },
    () => Date.parse(stamp),
  );
  for (let i = 0; i < 150; i++) buffer.add("paste");
  await buffer.flush();
  fails = false;
  await buffer.flush();
  assert.deepEqual(batches[0], batches[1]);
  for (let i = 0; i < 10; i++) await buffer.flush();
  assert.equal(batches.length, 6);
  assert.equal(batches.slice(1).flat().length, 100);
  for (const entry of batches.flat()) {
    assert.deepEqual(Object.keys(entry).sort(), ["id", "occurredAt", "type"]);
    assert.equal(entry.type, "paste");
    assert.equal(entry.occurredAt, stamp);
  }
});
test("OneCompiler sync requires exact origin, the current frame, mapped language/file and bounded source", () => {
  const source = {},
    other = {};
  const event = {
    origin: "https://onecompiler.com",
    source,
    data: {
      language: "python",
      files: [{ name: "main.py", content: "print(3)" }],
    },
  };
  assert.equal(compilerSourceMessage(event, source, "Python"), "print(3)");
  assert.equal(
    compilerSourceMessage(
      { ...event, origin: "https://onecompiler.com.attacker.test" },
      source,
      "Python",
    ),
    null,
  );
  assert.equal(compilerSourceMessage(event, other, "Python"), null);
  assert.equal(compilerSourceMessage(event, null, "Python"), null);
  assert.equal(compilerSourceMessage(event, source, "JavaScript"), null);
  for (const files of [
    [],
    [{ name: "evil.py", content: "bad" }],
    [{ name: "main.py", content: "a".repeat(30001) }],
    [{ name: "main.py", content: { secret: true } }],
    [
      { name: "main.py", content: "x" },
      { name: "main.py", content: "y" },
    ],
  ])
    assert.equal(
      compilerSourceMessage(
        { ...event, data: { language: "python", files } },
        source,
        "Python",
      ),
      null,
    );
});
let root, client;
const originalFetch = globalThis.fetch;
const response = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function mount(view, handler = () => response(200, view), guard = false) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  client.setQueryData(["me", "student"], {
    id: "student",
    role: "student",
    name: "Student",
    features: ["live-exams"],
  });
  globalThis.fetch = async (url, init) => handler(String(url), init);
  root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client },
        h(
          MemoryRouter,
          null,
          guard
            ? h(
                AccessRoute,
                { feature: "live-exams" },
                h(ExamAttempt, { initial: view }),
              )
            : h(ExamAttempt, { initial: view }),
        ),
      ),
    ),
  );
}
const text = () => document.body.textContent;
const button = (label) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === label,
  );
async function click(target) {
  assert.ok(target);
  await act(async () => target.click());
}
async function pause(ms) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
    root = undefined;
  }
  client?.clear();
  globalThis.fetch = originalFetch;
});
after(async () => {
  dom.window.close();
  await rm(bundle, { force: true });
});
test("student with live-exams only sees MCQ and coding, autosaves actual answers and optional manual runner", async () => {
  const calls = [];
  let view = fixture();
  await mount(
    view,
    (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/answers")) {
        const body = JSON.parse(init.body);
        view = { ...view, revision: body.revision + 1, answers: body.answers };
      }
      return response(200, view);
    },
    true,
  );
  assert.match(text(), /Assigned exam/);
  await click(document.querySelector("input[type=radio]"));
  assert.match(text(), /Unsaved changes/);
  await pause(750);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/answers$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    revision: 1,
    answers: [answer(0)],
  });
  assert.match(text(), /All answers saved/);
  await click(button("Next →"));
  assert.equal(document.getElementById("exam-source").value, "# start here");
  assert.ok(button("Run in OneCompiler"));
  assert.equal(button("Run examples"), undefined);
  assert.match(text(), /administrator reviews/);
  assert.equal(document.querySelector("iframe"), null);
});
test("autosave conflicts make answers read-only and expose a deliberate reload confirmation", async () => {
  await mount(fixture(), (url) =>
    url.endsWith("/answers")
      ? response(409, { message: "revision conflict" })
      : response(200, fixture({ revision: 8, answers: [answer(1)] })),
  );
  await click(document.querySelector("input[type=radio]"));
  await pause(750);
  assert.match(text(), /another tab/);
  assert.equal(document.querySelector("fieldset").disabled, true);
  await click(button("Reload saved attempt"));
  assert.ok(document.querySelector("[role=dialog]"));
  await click(button("Reload from server"));
  assert.equal(document.querySelectorAll("input[type=radio]")[1].checked, true);
  assert.equal(document.querySelector("fieldset").disabled, false);
});
test("submitted answers have no editing controls and results stay hidden until release", async () => {
  const result = {
    earnedPoints: 10,
    totalPoints: 10,
    percentage: 100,
    passed: true,
    questions: [
      {
        questionId: "q1",
        kind: "mcq",
        title: "Private result",
        points: 5,
        earnedPoints: 5,
        verdict: "correct",
        correctOption: 0,
        explanation: "Private explanation",
      },
    ],
  };
  await mount(fixture({ status: "graded", result }));
  assert.match(text(), /administrator releases/);
  assert.doesNotMatch(text(), /Private explanation|Private result|100%/);
  assert.equal(document.querySelector("input[type=radio]"), null);
  await act(async () => root.unmount());
  root = undefined;
  client.clear();
  const released = fixture({ status: "graded", result });
  released.exam.resultsReleased = true;
  await mount(released);
  assert.match(text(), /100%/);
  assert.match(text(), /Private explanation/);
});

test("Otto is hidden in exam attempts including Help tray, and remains available elsewhere", async () => {
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  await mount(fixture());
  async function shell(path) {
    await act(async () =>
      root.render(
        h(
          QueryClientProvider,
          { client },
          h(
            MemoryRouter,
            { key: path, initialEntries: [path] },
            h(StudentShell),
          ),
        ),
      ),
    );
  }
  await shell("/live-exams/exam/attempt/attempt");
  assert.equal(
    document.querySelector('[aria-label="Chat with Otto, your assistant"]'),
    null,
  );
  await click(document.querySelector('[aria-label="Help"]'));
  assert.doesNotMatch(text(), /Ask Otto/);
  await shell("/live-exams");
  assert.ok(
    document.querySelector('[aria-label="Chat with Otto, your assistant"]'),
  );
  await click(document.querySelector('[aria-label="Help"]'));
  assert.match(text(), /Ask Otto/);
});

test("autosave retries a short server throttle and includes edits made during the retry", async () => {
  let calls = 0;
  const session = new ExamSession(
    fixture(),
    async (path, method, body) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Wait"), { status: 429 });
      return fixture({ revision: 2, answers: body.answers });
    },
    () => 0,
  );
  session.edit(answer(0));
  const saving = session.save();
  await Promise.resolve();
  session.edit(answer(1));
  await saving;
  assert.equal(calls, 2);
  assert.equal(session.state.dirty, false);
  assert.deepEqual(session.state.view.answers, [answer(1)]);
  assert.equal(session.state.error, "");
});

test("manual submit interrupts a throttle delay and submits current draft without another PUT", async () => {
  const paths = [];
  const session = new ExamSession(
    fixture(),
    async (path, method, body) => {
      paths.push(path);
      if (path.endsWith("/answers"))
        throw Object.assign(new Error("Wait"), { status: 429 });
      return fixture({
        status: "submitted",
        revision: 2,
        answers: body.answers,
      });
    },
    () => 0,
  );
  session.edit(answer(0));
  void session.save();
  await Promise.resolve();
  session.edit(answer(1));
  await session.submit();
  assert.equal(paths.length, 2);
  assert.match(paths[1], /\/submit$/);
  assert.deepEqual(session.state.view.answers, [answer(1)]);
});

test("canceling browser back retains unsaved answers and restores history before router navigation", async () => {
  const originalConfirm = window.confirm;
  let delivered = 0;
  const onPop = () => delivered++;
  window.history.replaceState({ idx: 1 }, "", "/live-exams");
  window.history.pushState({ idx: 2 }, "", "/live-exams/exam/attempt/attempt");
  await mount(fixture());
  await click(document.querySelector("input[type=radio]"));
  window.addEventListener("popstate", onPop);
  try {
    window.confirm = () => false;
    window.history.back();
    await pause(50);
    assert.equal(window.history.state.idx, 2);
    assert.equal(delivered, 0);
    assert.match(text(), /Unsaved changes/);
    assert.equal(document.querySelector("input[type=radio]").checked, true);
    window.confirm = () => true;
    window.history.back();
    await pause(50);
    assert.equal(window.history.state.idx, 1);
    assert.equal(delivered, 1);
  } finally {
    window.removeEventListener("popstate", onPop);
    window.confirm = originalConfirm;
  }
});

test("account-menu navigation can cancel without losing unsaved exam answers", async () => {
  const prior = window.confirm;
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  try {
    await mount(fixture());
    await act(async () =>
      root.render(
        h(
          QueryClientProvider,
          { client },
          h(
            MemoryRouter,
            {
              key: "shell-exam",
              initialEntries: ["/live-exams/exam/attempt/attempt"],
            },
            h(
              Routes,
              null,
              h(
                Route,
                { element: h(StudentShell) },
                h(Route, {
                  path: "/live-exams/:id/attempt/:attemptId",
                  element: h(ExamAttempt, { initial: fixture() }),
                }),
                h(Route, {
                  path: "/",
                  element: h("h1", null, "Destination dashboard"),
                }),
              ),
            ),
          ),
        ),
      ),
    );
    await click(document.querySelector("input[type=radio]"));
    await click(document.querySelector('[aria-controls="student-tray"]'));
    const dashboard = [...document.querySelectorAll(".tray-l button")].find(
      (b) => b.textContent.startsWith("Dashboard"),
    );
    window.confirm = () => false;
    await click(dashboard);
    assert.match(text(), /Unsaved changes/);
    assert.equal(document.querySelector("input[type=radio]").checked, true);
    window.confirm = () => true;
    await click(dashboard);
    assert.match(text(), /Destination dashboard/);
  } finally {
    window.confirm = prior;
  }
});

test("runner executes only after echoing the latest primary-editor source and never overwrites it with stale events", async () => {
  const sent = [],
    edits = [];
  root = createRoot(document.getElementById("root"));
  async function render(code, editable = true) {
    await act(async () =>
      root.render(
        h(ExamOneCompiler, {
          language: "Python",
          code,
          input: "1 2",
          editable,
          onCode: (value) => edits.push(value),
        }),
      ),
    );
  }
  await render("print(1)");
  await click(button("Run in OneCompiler"));
  const frame = document.querySelector("iframe"),
    source = frame.contentWindow;
  source.postMessage = (message, target) => sent.push({ message, target });
  async function echo(content) {
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://onecompiler.com",
          source,
          data: { language: "python", files: [{ name: "main.py", content }] },
        }),
      ),
    );
  }
  await act(async () => frame.dispatchEvent(new Event("load")));
  await echo("print(1)");
  assert.equal(
    sent.filter((x) => x.message.eventType === "triggerRun").length,
    0,
  );
  await render("print(2)");
  assert.equal(sent.at(-1).message.files[0].content, "print(2)");
  await echo("print(1)");
  assert.deepEqual(edits, []);
  await click(button("Run code in runner"));
  assert.equal(sent.at(-1).message.eventType, "populateCode");
  assert.equal(sent.at(-1).message.files[0].content, "print(2)");
  assert.equal(
    sent.filter((x) => x.message.eventType === "triggerRun").length,
    0,
  );
  // A further answer edit while the Run handshake is pending must win too.
  await render("print(3)");
  await echo("print(2)");
  assert.equal(
    sent.filter((x) => x.message.eventType === "triggerRun").length,
    0,
  );
  assert.deepEqual(edits, []);
  await echo("print(3)");
  assert.equal(
    sent.filter((x) => x.message.eventType === "triggerRun").length,
    1,
  );
  assert.equal(sent.at(-1).target, "https://onecompiler.com");
  await echo("print(3)");
  assert.equal(
    sent.filter((x) => x.message.eventType === "triggerRun").length,
    1,
  );
  await echo("print(4)");
  assert.deepEqual(edits, ["print(4)"]);
  const before = sent.length;
  await render("print(4)");
  assert.equal(
    sent.length,
    before,
    "runner edits do not create a populate echo loop",
  );
  await click(button("Run code in runner"));
  await render("print(4)", false);
  await echo("print(4)");
  assert.equal(
    sent.filter((x) => x.message.eventType === "triggerRun").length,
    1,
    "expiry cancels a pending run",
  );
});
