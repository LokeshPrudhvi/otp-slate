// Run: node --test tests/crt-admin.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://admin.example.test/crt/new" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent", "File"])
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(`../.crt-admin-tests-${process.pid}.mjs`, import.meta.url);
await build({
  stdin: { contents: 'export * from "./apps/platform-admin/src/crt-questions.tsx"; export * from "./apps/platform-admin/src/crt-editor.tsx"; export * from "./apps/platform-admin/src/crt-assignments.tsx";', resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  outfile: fileURLToPath(bundle), bundle: true, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  external: ["react", "react/*", "react-dom", "react-dom/*", "react-router-dom", "@tanstack/react-query", "better-auth/*", "react-markdown", "remark-gfm"],
  plugins: [{ name: "omit-unrelated-rich-text", setup(context) {
    context.onResolve({ filter: /^\.\/rich-text-editor$/ }, () => ({ path: "rich-text-editor", namespace: "test-rich-text" }));
    context.onLoad({ filter: /.*/, namespace: "test-rich-text" }, () => ({ contents: "export function RichTextEditor() { return null; }", loader: "js" }));
  } }],
});
const { CrtQuestionEditor, validateCrtQuestion, validateCrtTopic, CrtTopicEditor, CrtAssignmentsPanel } = await import(bundle.href);
const { createElement: h, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const originalFetch = globalThis.fetch;
let root, query, current;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; query?.clear(); globalThis.fetch = originalFetch; });
after(async () => { await rm(bundle, { force: true }); dom.window.close(); });
const question = () => ({ id: "question-1", prompt: "What is 20% of 50?", options: ["5", "10", "20"], correctOption: 1, explanation: "Multiply 50 by 0.2." });
const topic = () => ({ title: "Percentages", subjectId: "quantitative", description: "Percentage basics", passingScore: 70, pdfUploadId: "pdf-1", questions: [question()] });

async function mountQuestion() {
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  function Harness() {
    const [value, setValue] = useState(question()), [pending, setPending] = useState(false);
    current = value;
    return h(CrtQuestionEditor, { question: value, index: 0, onChange: setValue, disabled: pending, onPending: setPending });
  }
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(QueryClientProvider, { client: query }, h(Harness))));
}

test("CRT drafts can be saved before content is complete, while publishing requires PDF, MCQs and an admin-selected passing score", () => {
  const value = topic();
  assert.equal(validateCrtTopic(value, true), null);
  value.pdfUploadId = undefined;
  value.questions[0].prompt = "";
  assert.equal(validateCrtTopic(value, false), null);
  assert.match(validateCrtTopic(value, true), /PDF/);
  value.pdfUploadId = "pdf-1";
  assert.match(validateCrtTopic(value, true), /question 1/);
  value.questions = [];
  assert.match(validateCrtTopic(value, true), /at least one assessment/);
  for (const passingScore of [0, 101, 2.5, NaN]) assert.match(validateCrtTopic({ ...topic(), passingScore }, true), /passing score/);
  assert.equal(validateCrtTopic({ ...topic(), passingScore: 100 }, true), null);
  assert.equal(validateCrtTopic({ ...topic(), passingScore: 50 }, true), null);
});

test("ambiguous duplicate answers and missing image descriptions are rejected", () => {
  const value = question();
  value.options = ["Answer", " answer "];
  assert.match(validateCrtQuestion(value), /different answer options/);
  value.options = ["A", "B"];
  value.image = { uploadId: "image-1", alt: " " };
  assert.match(validateCrtQuestion(value), /Describe the image/);
  value.image.alt = "A bar chart with labelled values";
  assert.equal(validateCrtQuestion(value), null);
});

test("removing an option retains the answer mapping and clears a removed correct answer", async () => {
  await mountQuestion();
  await act(async () => document.querySelector('[aria-label="Remove question 1 option A"]').click());
  assert.deepEqual(current.options, ["10", "20"]);
  assert.equal(current.correctOption, 0);
  const add = [...document.querySelectorAll("button")].find(button => button.textContent.includes("Add answer option"));
  await act(async () => add.click());
  await act(async () => document.querySelector('[aria-label="Remove question 1 option A"]').click());
  assert.equal(current.correctOption, undefined);
  assert.match(validateCrtQuestion(current), /Complete every answer/);
});

test("question image uploads lock editing until the upload settles", async () => {
  let rejectPrepare;
  globalThis.fetch = () => new Promise((_resolve, reject) => { rejectPrepare = reject; });
  await mountQuestion();
  const fileInput = document.querySelector('input[type="file"]');
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["png"], "graph.png", { type: "image/png" })] });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  assert.equal(document.querySelector("fieldset").disabled, true);
  await act(async () => rejectPrepare(new Error("offline")));
  assert.equal(document.querySelector("fieldset").disabled, false);
  assert.match(document.querySelector('[role="alert"]').textContent, /connect|retry/i);
});

test("new topic form bypasses native required MCQ fields so partial drafts can be saved", async () => {
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(QueryClientProvider, { client: query }, h(MemoryRouter, { initialEntries: ["/crt/new"] }, h(Routes, null, h(Route, { path: "/crt/new", element: h(CrtTopicEditor) }))))));
  assert.equal(document.querySelector("form").noValidate, true);
  assert.match(document.body.textContent, /Passing score/);
  assert.match(document.body.textContent, /Save draft/);
});

test("branch switching protects unsaved selections and saves only to the exact selected organization and branch", async () => {
  let resolveWrite;
  const writes = [];
  const response = value => new Response(JSON.stringify(value), { status: 200 });
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url, "https://admin.example.test");
    if (target.pathname.endsWith("/organizations")) return response([{ id: "org-a", name: "College A", status: "active" }, { id: "org-b", name: "College B", status: "active" }]);
    const organizationId = target.searchParams.get("organizationId");
    if (target.pathname.endsWith("/audience")) return response({ organizationId, branches: [{ id: organizationId === "org-a" ? "branch-a" : "branch-b", name: "Computer Science", code: "CSE", studentCount: 10 }] });
    if (options.method === "PUT") {
      writes.push(JSON.parse(options.body));
      return new Promise(resolve => { resolveWrite = () => resolve(response(writes.at(-1))); });
    }
    if (target.pathname.endsWith("/assignments")) return response({ organizationId, branchId: target.searchParams.get("branchId"), topics: [] });
    throw new Error(`Unexpected request: ${url}`);
  };
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  root = createRoot(document.getElementById("root"));
  const topics = [{ ...topic(), id: "topic-1", revision: 1, status: "published", versionId: "version-1", version: 1, pdf: null }];
  await act(async () => root.render(h(QueryClientProvider, { client: query }, h(MemoryRouter, { initialEntries: ["/crt?tab=assignments&organizationId=org-a"] }, h(CrtAssignmentsPanel, { topics, topicsPending: false, topicsError: null })))));
  const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  await wait();
  const choose = async (label, value) => {
    const native = document.querySelector(`[aria-label="${label}"]`).closest(".admin-select").querySelector("select");
    await act(async () => { native.value = value; native.dispatchEvent(new Event("change", { bubbles: true })); });
    await wait();
  };
  await choose("CRT assignment branch", "branch-a");
  await act(async () => document.querySelector('.crt-assignment-topic input[type="checkbox"]').click());
  await choose("CRT assignment organization", "org-b");
  assert.match(document.querySelector(".crt-scope-confirm").textContent, /unsaved/);
  assert.match(document.querySelector(".crt-assignment-scope").textContent, /College A/);
  const button = text => [...document.querySelectorAll("button")].find(item => item.textContent.trim() === text);
  await act(async () => button("Discard and switch").click());
  await wait();
  assert.equal(document.querySelector(".crt-assignment-scope"), null);
  await choose("CRT assignment branch", "branch-b");
  assert.match(document.querySelector(".crt-assignment-scope").textContent, /College B/);
  assert.equal(document.querySelector('.crt-assignment-topic input[type="checkbox"]').checked, false);
  await act(async () => document.querySelector('.crt-assignment-topic input[type="checkbox"]').click());
  await act(async () => button("Update assignments").click());
  await act(async () => button("Confirm update").click());
  await wait();
  assert.deepEqual(writes, [{ organizationId: "org-b", branchId: "branch-b", topics: [{ topicId: "topic-1", versionId: "version-1" }] }]);
  assert.equal(document.querySelector('[aria-label="CRT assignment organization"]').disabled, true);
  assert.equal(document.querySelector('[aria-label="CRT assignment branch"]').disabled, true);
  await act(async () => resolveWrite());
});
