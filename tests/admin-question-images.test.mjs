// Run: node --test tests/admin-question-images.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://admin.example.test/courses/course-1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent", "File"])
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(`../.admin-question-images-tests-${process.pid}.mjs`, import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL("../apps/platform-admin/src/lesson-editor.tsx", import.meta.url))],
  outfile: fileURLToPath(bundle), bundle: true, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  external: ["react", "react/*", "react-dom", "react-dom/*", "react-router-dom", "@tanstack/react-query", "better-auth/*", "react-markdown", "remark-gfm"],
  plugins: [{ name: "omit-unrelated-rich-text-editor", setup(context) {
    context.onResolve({ filter: /^\.\/rich-text-editor$/ }, () => ({ path: "rich-text-editor", namespace: "test-rich-text" }));
    context.onLoad({ filter: /.*/, namespace: "test-rich-text" }, () => ({ contents: "export function RichTextEditor() { return null; }", loader: "js" }));
  } }],
});
const { CourseLessonBuilder, lessonValidation } = await import(bundle.href);
const { createElement: h, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const originalFetch = globalThis.fetch;
let root;
let query;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  query?.clear();
  globalThis.fetch = originalFetch;
});
after(async () => { await rm(bundle, { force: true }); dom.window.close(); });

function quiz(image) {
  return {
    id: "quiz-lesson", title: "Graphs", body: "Choose the best answer.", kind: "quiz", format: "plain",
    quiz: { passingScore: 70, questions: [{ id: "graph-question", prompt: "Which node has the highest degree?", options: ["A", "B"], correctOption: 1, explanation: "Count its edges.", ...(image ? { image } : {}) }] },
  };
}
async function mount(lessons, onPending = () => {}, readOnly = false) {
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Harness() {
    const [value, setValue] = useState(lessons);
    return h(CourseLessonBuilder, { courseId: "course-1", lessons: value, onChange: setValue, disabled: false, readOnly, onUploadStateChange: onPending });
  }
  root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(h(QueryClientProvider, { client: query }, h(Harness))); });
}
const button = (text) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);

test("course MCQs retain text requirements and require image descriptions only when an image exists", () => {
  assert.equal(lessonValidation(quiz()), null);
  const lesson = quiz({ uploadId: "image-1", alt: " " });
  assert.match(lessonValidation(lesson), /image description/);
  lesson.quiz.questions[0].image.alt = "A graph with labelled nodes A and B";
  assert.equal(lessonValidation(lesson), null);
  lesson.quiz.questions[0].prompt = "";
  assert.match(lessonValidation(lesson), /question text/);
});

test("pending course question uploads block lesson switches and reset cleanly after an error", async () => {
  let rejectPrepare;
  const pending = [];
  globalThis.fetch = () => new Promise((_resolve, reject) => { rejectPrepare = reject; });
  await mount([quiz(), { id: "reading", title: "Second lesson", body: "Read this", format: "plain", kind: "text" }], (value) => pending.push(value));
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["png content"], "graph.png", { type: "image/png" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  assert.equal(pending.at(-1), true);
  assert.ok([...document.querySelectorAll(".course-outline-item")].every((item) => item.disabled));
  assert.equal(button("Preview").disabled, true);
  assert.equal(button("+ Add lesson").disabled, true);
  assert.equal(input.disabled, true);
  await act(async () => rejectPrepare(new Error("offline")));
  assert.equal(pending.at(-1), false);
  assert.equal(button("Preview").disabled, false);
  assert.equal(button("+ Add lesson").disabled, false);
  assert.match(document.querySelector('[role="alert"]').textContent, /connect|retry/i);
});

test("published course MCQ previews render the saved image with its accessible description", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ url: "https://private-media.example.test/signed-diagram.png", expiresIn: 300 }), { status: 200 });
  };
  await mount([quiz({ uploadId: "image-1", alt: "A graph with labelled nodes A and B" })], undefined, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const image = document.querySelector(".course-preview-question img");
  assert.equal(image?.alt, "A graph with labelled nodes A and B");
  assert.equal(image?.src, "https://private-media.example.test/signed-diagram.png");
  assert.ok(calls.includes("/api/v1/lesson-uploads/image-1/download"));
  assert.equal(document.querySelector('input[type="file"]'), null);
  assert.match(document.querySelector(".course-preview-question").textContent, /Correct answer/);
});
