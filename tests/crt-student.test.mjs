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
const activityTab = (name) =>
  document.querySelector(`[role="tab"][aria-label="${name}"]`);
const activityPanel = (name) =>
  document.getElementById(activityTab(name).getAttribute("aria-controls"));
const topicsOnScreen = () => [...document.querySelectorAll(".crt-topic-link")];
const progressFilter = (label) =>
  [
    ...document.querySelectorAll(
      '[role="group"][aria-label="Filter topics by progress"] button',
    ),
  ].find((item) => item.textContent.trim().startsWith(label));
const location = () => document.querySelector("[data-location]").textContent;
async function click(item) {
  assert.ok(item, "Expected interactive element");
  await act(async () => item.click());
  await settle();
}
async function pressKey(item, key) {
  assert.ok(item, "Expected keyboard target");
  await act(async () => {
    item.focus();
    item.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
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

test("all topic links remain available in one continuous list and the final topic opens with completion intact", async () => {
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
  assert.equal(topicsOnScreen().length, 45);
  assert.deepEqual(
    topicsOnScreen().map((item) => item.getAttribute("aria-label")),
    topics.map((item) => `${item.title}${item.completed ? ", completed" : ""}`),
  );
  assert.equal(document.querySelector(".crt-pagination"), null);
  assert.equal(button("← Previous"), undefined);
  assert.equal(button("Next →"), undefined);
  assert.match(topicsOnScreen()[0].getAttribute("aria-label"), /completed/);
  assert.ok(topicsOnScreen()[0].querySelector('[data-icon="check"]'));
  await click(topicsOnScreen()[44]);
  assert.equal(opened.id, topics[44].id);
});

test("topic search and progress filters show every matching topic and combine without hiding later results", async () => {
  const topics = Array.from({ length: 45 }, (_, i) =>
    topic(i + 1, "quantitative", { completed: i % 4 === 0 }),
  );
  await mount(
    h(TopicLibrary, { subject: "quantitative", topics, onOpen() {} }),
  );
  assert.equal(progressFilter("All topics").getAttribute("aria-pressed"), "true");
  assert.match(progressFilter("All topics").textContent, /45/);
  assert.match(progressFilter("Completed").textContent, /12/);
  assert.match(progressFilter("To complete").textContent, /33/);
  await inputValue(
    document.querySelector('input[type="search"]'),
    "  READING 44  ",
  );
  assert.equal(topicsOnScreen().length, 1);
  assert.match(topicsOnScreen()[0].textContent, /Topic 44/);
  await click(progressFilter("Completed"));
  assert.equal(topicsOnScreen().length, 0);
  assert.match(document.body.textContent, /No matching topics/);
  assert.equal(progressFilter("Completed").getAttribute("aria-pressed"), "true");
  assert.equal(progressFilter("All topics").getAttribute("aria-pressed"), "false");
  await inputValue(document.querySelector('input[type="search"]'), "");
  assert.equal(topicsOnScreen().length, 12);
  assert.ok(
    topicsOnScreen().every((item) => item.classList.contains("is-complete")),
  );
  await click(progressFilter("To complete"));
  assert.equal(topicsOnScreen().length, 33);
  assert.equal(progressFilter("To complete").getAttribute("aria-pressed"), "true");
  assert.equal(progressFilter("Completed").getAttribute("aria-pressed"), "false");
  assert.ok(
    topicsOnScreen().every((item) => !item.classList.contains("is-complete")),
  );
  await inputValue(
    document.querySelector('input[type="search"]'),
    "No matching title",
  );
  assert.match(document.body.textContent, /No matching topics/);
  assert.equal(topicsOnScreen().length, 0);
  await inputValue(document.querySelector('input[type="search"]'), "");
  await click(progressFilter("All topics"));
  assert.equal(topicsOnScreen().length, 45);
});

test("CRT opens as four subject cards and a practice card, with progress from assigned topics only", async () => {
  const topics = [
    topic(1, "quantitative", { completed: true }),
    topic(2, "quantitative"),
    topic(3, "reasoning"),
  ];
  read = () => topics;
  await mount(h(CrtPage));
  const cards = [...document.querySelectorAll(".crt-subject-card")];
  assert.equal(cards.length, 4);
  assert.equal(document.querySelectorAll(".crt-practice-card").length, 1);
  assert.equal(document.querySelector(".crt-subjects"), null);
  assert.equal(topicsOnScreen().length, 0);
  assert.equal(cards[0].getAttribute("href"), "/crt?subject=quantitative");
  assert.match(cards[0].getAttribute("aria-label"), /2 topics, 1 completed/);
  assert.equal(
    cards[0].querySelector(".crt-subject-progress-track span").style.width,
    "50%",
  );
  assert.match(cards[2].textContent, /0 topicsAwaiting topics/);
  assert.equal(
    cards[2].querySelector(".crt-subject-progress-track span").style.width,
    "0%",
  );
  assert.equal(document.querySelector(".crt-hero"), null);
  assert.equal(calls.length, 0);
});

test("subject cards open their topics and provide a route back to all CRT subjects without a fixed tab header", async () => {
  const subjects = ["quantitative", "reasoning", "verbal", "soft-skills"];
  const topics = subjects.map((subject, i) =>
    topic(i + 1, subject, { title: `${subject} lesson` }),
  );
  read = (path) => (path === "student/crt/topics" ? topics : null);
  await mount(h(CrtPage), "/crt?subject=unknown");
  const cards = () => [...document.querySelectorAll(".crt-subject-card")];
  assert.equal(cards().length, 4);
  assert.equal(topicsOnScreen().length, 0);
  for (let i = 0; i < 4; i++) {
    await click(cards()[i]);
    assert.equal(location(), `/crt?subject=${subjects[i]}`);
    assert.equal(topicsOnScreen().length, 1);
    assert.match(
      topicsOnScreen()[0].textContent,
      new RegExp(`${subjects[i]} lesson`),
    );
    assert.equal(document.querySelector(".crt-hero"), null);
    assert.equal(cards().length, 0);
    await click(topicsOnScreen()[0]);
    assert.match(location(), /topic=/);
    await click(button("← All topics"));
    assert.equal(location(), `/crt?subject=${subjects[i]}`);
    await click(document.querySelector(".crt-home-link"));
    assert.equal(location(), "/crt");
    assert.equal(cards().length, 4);
  }
  await click(document.querySelector(".crt-practice-card"));
  assert.equal(location(), "/crt?subject=practice");
  assert.match(document.body.textContent, /Choose what to work on/);
  await click(document.querySelector(".crt-home-link"));
  assert.equal(location(), "/crt");
  assert.equal(cards().length, 4);
});

test("the card landing page handles loading, failure and a curriculum with no assigned topics", async () => {
  let finish;
  read = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await mount(h(CrtPage));
  assert.equal(document.querySelectorAll(".crt-subject-card").length, 0);
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Loading/,
  );
  await act(async () => finish([]));
  await settle();
  assert.equal(document.querySelectorAll(".crt-subject-card").length, 4);
  assert.ok(
    [...document.querySelectorAll(".crt-subject-card")].every((card) =>
      card.textContent.includes("Awaiting topics"),
    ),
  );
  await click(document.querySelector(".crt-subject-card"));
  assert.match(document.body.textContent, /Your topics will appear here/);
  read = () => {
    throw new Error("Could not load your assigned topics.");
  };
  await act(async () => {
    await query.resetQueries();
  });
  await settle();
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Could not load/,
  );
  assert.ok(button("Retry topics"));
  read = () => [];
  await click(button("Retry topics"));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.match(document.body.textContent, /Your topics will appear here/);
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
  await click(activityTab("Assessment"));
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

test("topic activity tabs expose one panel at a time with keyboard navigation and roving focus", async () => {
  const value = detail();
  topicReads(value);
  await mount(h(CrtPage), `/crt?subject=quantitative&topic=${value.id}`);
  const tablist = document.querySelector(
    '[role="tablist"][aria-label="Topic activity"]',
  );
  assert.ok(tablist);
  assert.equal(tablist.querySelectorAll('[role="tab"]').length, 2);
  const pdfTab = activityTab("PDF lesson");
  const assessmentTab = activityTab("Assessment");
  const pdfPanel = activityPanel("PDF lesson");
  const assessmentPanel = activityPanel("Assessment");
  const assertSelected = (selectedTab, visiblePanel, otherTab, hiddenPanel) => {
    assert.equal(selectedTab.getAttribute("aria-selected"), "true");
    assert.equal(selectedTab.tabIndex, 0);
    assert.equal(otherTab.getAttribute("aria-selected"), "false");
    assert.equal(otherTab.tabIndex, -1);
    assert.equal(visiblePanel.getAttribute("role"), "tabpanel");
    assert.equal(visiblePanel.getAttribute("aria-labelledby"), selectedTab.id);
    assert.equal(visiblePanel.hidden, false);
    assert.equal(hiddenPanel.hidden, true);
  };
  assertSelected(pdfTab, pdfPanel, assessmentTab, assessmentPanel);
  await pressKey(pdfTab, "ArrowRight");
  assertSelected(assessmentTab, assessmentPanel, pdfTab, pdfPanel);
  assert.equal(document.activeElement, assessmentTab);
  await pressKey(assessmentTab, "ArrowRight");
  assertSelected(pdfTab, pdfPanel, assessmentTab, assessmentPanel);
  await pressKey(pdfTab, "ArrowLeft");
  assertSelected(assessmentTab, assessmentPanel, pdfTab, pdfPanel);
  await pressKey(assessmentTab, "Home");
  assertSelected(pdfTab, pdfPanel, assessmentTab, assessmentPanel);
  assert.equal(document.activeElement, pdfTab);
  await pressKey(pdfTab, "End");
  assertSelected(assessmentTab, assessmentPanel, pdfTab, pdfPanel);
  assert.equal(document.activeElement, assessmentTab);
  assert.equal(calls.length, 0);
});

test("switching topic tabs preserves the PDF, answer draft, reading acknowledgement and submitted result", async () => {
  const value = detail();
  topicReads(value);
  send = () => result();
  await mount(h(CrtPage), `/crt?subject=quantitative&topic=${value.id}`);
  const pdfFrame = document.querySelector("iframe");
  assert.ok(pdfFrame);
  await click(button("Continue to assessment →"));
  assert.equal(activityTab("Assessment").getAttribute("aria-selected"), "true");
  await answerAll();
  const acknowledgement = document.querySelector(".crt-read-ack input");
  await click(acknowledgement);
  assert.equal(button("Submit assessment").disabled, false);
  await click(activityTab("PDF lesson"));
  assert.equal(document.querySelector("iframe"), pdfFrame);
  assert.equal(activityPanel("Assessment").hidden, true);
  await click(activityTab("Assessment"));
  assert.equal(
    document.querySelectorAll('input[type="radio"]:checked').length,
    2,
  );
  assert.equal(document.querySelector(".crt-read-ack input"), acknowledgement);
  assert.equal(acknowledgement.checked, true);
  assert.equal(button("Submit assessment").disabled, false);
  await click(button("Submit assessment"));
  const outcome = document.querySelector(".crt-result-banner");
  assert.match(outcome.textContent, /Topic completed/);
  await click(activityTab("PDF lesson"));
  assert.equal(document.querySelector("iframe"), pdfFrame);
  await click(activityTab("Assessment"));
  assert.equal(document.querySelector(".crt-result-banner"), outcome);
  assert.equal(calls.length, 1);
  assert.equal(
    reads.filter((path) => path === `student/crt/topics/${value.id}/pdf`)
      .length,
    1,
  );
});

test("draft answers survive revisiting the same immutable version and stay separate from a replacement version", async () => {
  let value = detail();
  topicReads(value);
  const url = `/crt?subject=quantitative&topic=${value.id}`;
  await mount(h(CrtPage), url);
  await click(activityTab("Assessment"));
  await click(document.querySelector('input[type="radio"][value="1"]'));
  await act(async () => root.unmount());
  query.clear();
  root = undefined;
  await mount(h(CrtPage), url);
  await click(activityTab("Assessment"));
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
  await click(activityTab("Assessment"));
  assert.equal(
    document.querySelectorAll('input[type="radio"]:checked').length,
    0,
  );
  assert.equal(button("Submit assessment").disabled, true);
});
