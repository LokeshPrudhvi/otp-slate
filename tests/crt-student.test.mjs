// Run: node --test tests/crt-student.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://student.example.test/crt",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
  "sessionStorage",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(
  `../.crt-student-tests-${process.pid}.mjs`,
  import.meta.url,
);
const selectPath = fileURLToPath(
  new URL("../packages/ui/src/select.tsx", import.meta.url),
);
await build({
  entryPoints: [
    fileURLToPath(new URL("../apps/student/src/crt.tsx", import.meta.url)),
  ],
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
  ],
  plugins: [
    {
      name: "student-crt-boundaries",
      setup(context) {
        context.onResolve(
          { filter: /^(@slate\/ui|\.\/access|\.\/design)$/ },
          ({ path }) => ({ path, namespace: "test-crt" }),
        );
        context.onLoad({ filter: /.*/, namespace: "test-crt" }, ({ path }) => ({
          loader: "jsx",
          resolveDir: fileURLToPath(new URL("../", import.meta.url)),
          contents:
            path === "@slate/ui"
              ? `
        import React from "react";
        export { Select } from ${JSON.stringify(selectPath)};
        export function api(...args) { return globalThis.__crtApi(...args); }
        export function useMe() { return { data: { id: "student-a" } }; }
        export function QuestionImageView({ image, source }) { return <span role="img" aria-label={image.alt} data-image-source={source} />; }
      `
              : path === "./access"
                ? `
        import { useQuery } from "@tanstack/react-query";
        export function useStudentData(key, path, enabled = true) {
          return useQuery({ queryKey: ["student", key], queryFn: () => globalThis.__crtRead(path), enabled });
        }
      `
                : `
        import React from "react";
        export function Status({ pending, error }) { return error ? <p role="alert">{error.message}</p> : pending ? <p role="status">Loading</p> : null; }
        export function StudentIcon({ name }) { return <svg aria-hidden="true" data-icon={name} />; }
      `,
        }));
      },
    },
  ],
});
const { CrtPage, TopicLibrary, allAnswered } = await import(bundle.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
let root, query;
let read = () => {
  throw new Error("Unexpected read");
};
let send = () => {
  throw new Error("Unexpected mutation");
};
let calls = [];
let reads = [];
globalThis.__crtRead = async (path) => {
  reads.push(path);
  return structuredClone(await read(path));
};
globalThis.__crtApi = async (path, method, body) => {
  calls.push({ path, method, body: structuredClone(body) });
  return structuredClone(await send(path, method, body));
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  query?.clear();
  sessionStorage.clear();
  calls = [];
  reads = [];
  read = () => {
    throw new Error("Unexpected read");
  };
  send = () => {
    throw new Error("Unexpected mutation");
  };
});
after(async () => {
  await rm(bundle, { force: true });
  dom.window.close();
});
function Location() {
  const location = useLocation();
  return h(
    "output",
    { "data-location": true },
    location.pathname + location.search,
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function mount(component, url = "/crt") {
  query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client: query },
        h(MemoryRouter, { initialEntries: [url] }, component, h(Location)),
      ),
    ),
  );
  await settle();
}
const button = (text) =>
  [...document.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === text,
  );
const topicsOnScreen = () => [...document.querySelectorAll(".crt-topic-link")];
const location = () => document.querySelector("[data-location]").textContent;
async function click(item) {
  assert.ok(item, "Expected interactive element");
  await act(async () => item.click());
  await settle();
}
async function choose(label, text) {
  await click(
    document.querySelector(`[role="combobox"][aria-label="${label}"]`),
  );
  await click(
    [...document.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent === text,
    ),
  );
}
async function inputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function topic(index, subjectId = "quantitative", patch = {}) {
  return {
    id: `topic-${subjectId}-${index}`,
    title: `Topic ${String(index).padStart(2, "0")}`,
    subjectId,
    description: `Reading ${String(index).padStart(2, "0")}`,
    versionId: `version-${subjectId}-${index}`,
    version: 1,
    passingScore: 80,
    questionCount: 2,
    completed: false,
    bestScore: null,
    ...patch,
  };
}
const questions = [
  { id: "q-1", prompt: "What is 2 + 2?", options: ["3", "4"] },
  { id: "q-2", prompt: "What is 3 + 3?", options: ["5", "6"] },
];
function detail(patch = {}) {
  return {
    ...topic(1),
    pdf: {
      id: "pdf-1",
      fileName: "numbers.pdf",
      contentType: "application/pdf",
      size: 100,
    },
    questions,
    ...patch,
  };
}
function result(passed = true) {
  return {
    id: "result-1",
    score: passed ? 100 : 50,
    correct: passed ? 2 : 1,
    total: 2,
    passed,
    submittedAt: "2026-10-14T10:00:00Z",
    questions: questions.map((question, index) => ({
      ...question,
      selectedOption: passed || index ? 1 : 0,
      correctOption: 1,
      correct: passed || index > 0,
      explanation: "Add both numbers.",
    })),
  };
}
function topicReads(value = detail()) {
  read = (path) =>
    path === "student/crt/topics"
      ? [value]
      : path === `student/crt/topics/${value.id}`
        ? value
        : path === `student/crt/topics/${value.id}/pdf`
          ? {
              url: "https://private-media.example.test/lesson.pdf",
              expiresIn: 3600,
            }
          : (() => {
              throw new Error(`Unexpected read ${path}`);
            })();
}
async function answerAll() {
  for (const fieldset of document.querySelectorAll(".crt-question"))
    await click(fieldset.querySelector('input[type="radio"][value="1"]'));
}

test("an assessment is ready only when every current question has an in-range integer answer", () => {
  assert.equal(allAnswered([], {}), false);
  for (const answers of [
    {},
    { "q-1": 1 },
    { "q-1": -1, "q-2": 1 },
    { "q-1": 2, "q-2": 1 },
    { "q-1": 0.5, "q-2": 1 },
    { "q-1": "1", "q-2": 1 },
  ])
    assert.equal(allAnswered(questions, answers), false);
  assert.equal(allAnswered(questions, { "q-1": 0, "q-2": 1 }), true);
});

test("topic links paginate in groups of 20 and keep completion markers and open the selected topic", async () => {
  const topics = Array.from({ length: 45 }, (_, i) =>
    topic(i + 1, "quantitative", { completed: i % 4 === 0 }),
  );
  let opened;
  await mount(
    h(TopicLibrary, {
      subject: "quantitative",
      topics,
      onOpen: (value) => {
        opened = value;
      },
    }),
  );
  assert.equal(topicsOnScreen().length, 20);
  assert.equal(button("← Previous").disabled, true);
  assert.match(
    document.querySelector(".crt-pagination").textContent,
    /1–20 of 45 topics/,
  );
  assert.match(topicsOnScreen()[0].getAttribute("aria-label"), /completed/);
  assert.ok(topicsOnScreen()[0].querySelector('[data-icon="check"]'));
  await click(button("Next →"));
  assert.equal(topicsOnScreen().length, 20);
  assert.match(topicsOnScreen()[0].textContent, /Topic 21/);
  await click(button("Next →"));
  assert.equal(topicsOnScreen().length, 5);
  assert.equal(button("Next →").disabled, true);
  await click(topicsOnScreen()[4]);
  assert.equal(opened.id, topics[44].id);
});

test("topic search and progress dropdown reset pagination and expose only matching completion states", async () => {
  const topics = Array.from({ length: 45 }, (_, i) =>
    topic(i + 1, "quantitative", { completed: i % 4 === 0 }),
  );
  await mount(
    h(TopicLibrary, { subject: "quantitative", topics, onOpen() {} }),
  );
  await click(button("Next →"));
  await inputValue(
    document.querySelector('input[type="search"]'),
    "  READING 04  ",
  );
  assert.equal(topicsOnScreen().length, 1);
  assert.match(topicsOnScreen()[0].textContent, /Topic 04/);
  assert.match(
    document.querySelector(".crt-pagination").textContent,
    /Page 1 of 1/,
  );
  await inputValue(document.querySelector('input[type="search"]'), "");
  await choose("Filter topics by progress", "Completed");
  assert.equal(topicsOnScreen().length, 12);
  assert.ok(
    topicsOnScreen().every((item) => item.classList.contains("is-complete")),
  );
  await choose("Filter topics by progress", "To complete");
  assert.equal(topicsOnScreen().length, 20);
  assert.ok(
    topicsOnScreen().every((item) => !item.classList.contains("is-complete")),
  );
  await inputValue(
    document.querySelector('input[type="search"]'),
    "No matching title",
  );
  assert.match(document.body.textContent, /No matching topics/);
  assert.equal(button("Next →").disabled, true);
});

test("the five fixed tabs switch subjects on the same page and clear a previously open topic", async () => {
  const subjects = ["quantitative", "reasoning", "verbal", "soft-skills"];
  const topics = subjects.map((subject, i) =>
    topic(i + 1, subject, { title: `${subject} lesson` }),
  );
  read = (path) => (path === "student/crt/topics" ? topics : null);
  await mount(h(CrtPage), "/crt?subject=unknown");
  const tabs = () => [...document.querySelectorAll(".crt-subjects button")];
  assert.equal(tabs().length, 5);
  assert.match(topicsOnScreen()[0].textContent, /quantitative lesson/);
  for (let i = 1; i < 4; i++) {
    await click(tabs()[i]);
    assert.equal(topicsOnScreen().length, 1);
    assert.match(
      topicsOnScreen()[0].textContent,
      new RegExp(`${subjects[i]} lesson`),
    );
    assert.equal(tabs()[i].getAttribute("aria-current"), "page");
  }
  await click(topicsOnScreen()[0]);
  assert.match(location(), /topic=/);
  await click(tabs()[4]);
  assert.equal(location(), "/crt?subject=practice");
  assert.match(document.body.textContent, /Choose what to work on/);
});

test("practice subject selection filters topics, clears the former topic, and sends the chosen count", async () => {
  const quantitative = topic(1),
    reasoning = topic(2, "reasoning");
  const session = {
    id: "session-a",
    questions: questions.map((item) => ({
      ...item,
      topicId: reasoning.id,
      topicTitle: reasoning.title,
      subjectId: "reasoning",
    })),
    createdAt: "2026-10-14T10:00:00Z",
    result: null,
  };
  read = (path) =>
    path === "student/crt/topics" ? [quantitative, reasoning] : session;
  send = () => session;
  await mount(h(CrtPage), "/crt?subject=practice");
  await choose("Practice subject", "Quantitative aptitude");
  await choose("Practice topic", quantitative.title);
  await choose("Practice subject", "Logical and analytical reasoning");
  assert.match(
    document.querySelector('[aria-label="Practice topic"]').textContent,
    /All assigned topics/,
  );
  await click(
    document.querySelector('[role="combobox"][aria-label="Practice topic"]'),
  );
  assert.ok(
    ![...document.querySelectorAll('[role="option"]')].some(
      (item) => item.textContent === quantitative.title,
    ),
  );
  await click(
    [...document.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent === reasoning.title,
    ),
  );
  await choose("Practice question count", "Up to 20 questions");
  await click(button("Start practising →"));
  assert.deepEqual(calls[0], {
    path: "student/crt/practice",
    method: "POST",
    body: { subjectId: "reasoning", topicIds: [reasoning.id], count: 20 },
  });
  assert.match(location(), /session=session-a/);
});

test("topic submissions require reading acknowledgement, preserve request identity after a network error, and create a fresh retry", async () => {
  const value = detail();
  topicReads(value);
  let failures = 1;
  send = () => {
    if (failures-- > 0) throw new Error("Connection interrupted. Try again.");
    return result();
  };
  await mount(h(CrtPage), `/crt?subject=quantitative&topic=${value.id}`);
  assert.equal(document.querySelector("iframe").title, `${value.title} PDF`);
  assert.equal(button("Submit assessment").disabled, true);
  await answerAll();
  assert.equal(button("Submit assessment").disabled, true);
  await click(document.querySelector(".crt-read-ack input"));
  await click(button("Submit assessment"));
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Connection interrupted/,
  );
  assert.deepEqual(calls[0].body.answers, { "q-1": 1, "q-2": 1 });
  assert.equal(calls[0].body.versionId, value.versionId);
  assert.equal(calls[0].body.readAcknowledged, true);
  const firstClientId = calls[0].body.clientId;
  await click(button("Submit assessment"));
  assert.equal(calls[1].body.clientId, firstClientId);
  assert.match(
    document.querySelector(".crt-result-banner").textContent,
    /Topic completed/,
  );
  await click(button("Try the assessment again"));
  assert.equal(
    document.querySelectorAll('input[type="radio"]:checked').length,
    0,
  );
  await answerAll();
  await click(button("Submit assessment"));
  assert.notEqual(calls[2].body.clientId, firstClientId);
});

test("practice submits answers without PDF acknowledgement and another set returns to setup without completing a topic", async () => {
  const value = topic(1);
  const session = {
    id: "session-a",
    questions: questions.map((item) => ({
      ...item,
      topicId: value.id,
      topicTitle: value.title,
      subjectId: value.subjectId,
    })),
    createdAt: "2026-10-14T10:00:00Z",
    result: null,
  };
  read = (path) => (path === "student/crt/topics" ? [value] : session);
  send = () => result();
  await mount(h(CrtPage), "/crt?subject=practice&session=session-a");
  assert.equal(document.querySelector(".crt-read-ack"), null);
  await answerAll();
  await click(button("Submit practice"));
  assert.deepEqual(calls[0], {
    path: "student/crt/practice/session-a/submit",
    method: "POST",
    body: { answers: { "q-1": 1, "q-2": 1 } },
  });
  assert.match(
    document.querySelector(".crt-result-banner").textContent,
    /Practice complete/,
  );
  assert.doesNotMatch(
    document.querySelector(".crt-result-banner").textContent,
    /Topic completed/,
  );
  await click(button("Build another practice set"));
  assert.equal(location(), "/crt?subject=practice");
  assert.match(document.body.textContent, /Choose what to work on/);
  assert.equal(calls.length, 1);
});

test("PDF enlargement keeps the assessment in place and restores focus after closing", async () => {
  const value = detail({
    questions: questions.map((question, index) => ({
      ...question,
      ...(index === 0
        ? {
            image: { uploadId: "question-image", alt: "A chart with two bars" },
          }
        : {}),
    })),
  });
  topicReads(value);
  await mount(h(CrtPage), `/crt?subject=quantitative&topic=${value.id}`);
  assert.equal(
    document.querySelector("[data-image-source]").dataset.imageSource,
    `student/crt/topics/${value.id}/images/question-image`,
  );
  const trigger = document.querySelector('[aria-label="Enlarge lesson PDF"]');
  await click(trigger);
  assert.equal(document.querySelector("dialog").open, true);
  assert.ok(document.querySelector('[aria-label="Topic assessment"]'));
  await click(button("Close ×"));
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(document.activeElement, trigger);
});

test("draft answers survive revisiting the same immutable version and stay separate from a replacement version", async () => {
  let value = detail();
  topicReads(value);
  const url = `/crt?subject=quantitative&topic=${value.id}`;
  await mount(h(CrtPage), url);
  await click(document.querySelector('input[type="radio"][value="1"]'));
  await act(async () => root.unmount());
  query.clear();
  root = undefined;
  await mount(h(CrtPage), url);
  assert.equal(
    document.querySelectorAll('input[type="radio"]:checked').length,
    1,
  );
  await act(async () => root.unmount());
  query.clear();
  root = undefined;
  value = { ...value, versionId: "replacement-version", version: 2 };
  topicReads(value);
  await mount(h(CrtPage), url);
  assert.equal(
    document.querySelectorAll('input[type="radio"]:checked').length,
    0,
  );
  assert.equal(button("Submit assessment").disabled, true);
});
