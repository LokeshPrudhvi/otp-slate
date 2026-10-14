// Run: node --test tests/exam-audience.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://admin.example.test/exams/new",
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(
  `../.exam-audience-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  entryPoints: [
    fileURLToPath(
      new URL("../apps/platform-admin/src/exam-builder.tsx", import.meta.url),
    ),
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
    "better-auth/*",
    "react-markdown",
    "remark-gfm",
  ],
  plugins: [
    {
      name: "omit-unrelated-rich-text-editor",
      setup(context) {
        context.onResolve({ filter: /^\.\/rich-text-editor$/ }, () => ({
          path: "rich-text-editor",
          namespace: "test-rich-text",
        }));
        context.onLoad({ filter: /.*/, namespace: "test-rich-text" }, () => ({
          contents: "export function RichTextEditor() { return null; }",
          loader: "js",
        }));
      },
    },
  ],
});
const { ExamBuilder } = await import(bundle.href);
const { createElement: h, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
let root;
let current;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});
after(async () => {
  await rm(bundle, { force: true });
  dom.window.close();
});
const audience = {
  organizationId: "college-a",
  organizationName: "College A",
  status: "active",
  branches: [
    { code: "CSE", name: "Computer Science", studentCount: 2 },
    { code: "ME", name: "Mechanical", studentCount: 1 },
  ],
  students: [
    { id: "a-1", name: "Asha", email: "asha@example.test", branchCode: "CSE" },
    {
      id: "a-2",
      name: "Bhanu",
      email: "bhanu@example.test",
      branchCode: "CSE",
    },
    {
      id: "a-3",
      name: "Charan",
      email: "charan@example.test",
      branchCode: "ME",
    },
  ],
};
function draft(
  selection = { mode: "branches", branchCodes: [], studentIds: [] },
) {
  return {
    organizationId: "college-a",
    title: "Campus exam",
    description: "",
    instructions: "",
    audience: selection,
    startsAt: "2027-01-01T09:00:00Z",
    endsAt: "2027-01-01T10:00:00Z",
    durationMinutes: 60,
    passingPercentage: 50,
    codingGrading: "manual",
    monitoring: {
      enabled: true,
      requireFullscreen: false,
      recordClipboard: false,
    },
    questions: [],
  };
}
async function mount(value = draft(), options = audience) {
  function Harness() {
    const [exam, setExam] = useState(value);
    current = exam;
    return h(ExamBuilder, {
      value: exam,
      onChange: setExam,
      audience: options,
      onImagePending() {},
    });
  }
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(Harness)));
}
const control = (label) =>
  document.querySelector(`[role="combobox"][aria-label="${label}"]`);
async function choose(label, text) {
  await act(async () => control(label).click());
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent.startsWith(text),
  );
  assert.ok(option, `Missing option ${text}`);
  await act(async () => option.click());
}

test("branch selection only exposes that branch's students and switching branches clears selected IDs", async () => {
  await mount();
  assert.equal(control("Exam audience").disabled, true);
  await choose("Exam branch", "Computer Science");
  assert.deepEqual(current.audience, {
    mode: "branches",
    branchCodes: ["CSE"],
    studentIds: [],
  });
  await choose("Exam audience", "Selected students");
  const list = document.querySelector(".exam-audience-list");
  assert.match(list.textContent, /Asha/);
  assert.match(list.textContent, /Bhanu/);
  assert.doesNotMatch(list.textContent, /Charan/);
  await act(async () => list.querySelector('input[type="checkbox"]').click());
  assert.deepEqual(current.audience.studentIds, ["a-1"]);
  await choose("Exam branch", "Mechanical");
  assert.deepEqual(current.audience, {
    mode: "students",
    branchCodes: ["ME"],
    studentIds: [],
  });
  assert.match(
    document.querySelector(".exam-audience-list").textContent,
    /Charan/,
  );
  assert.doesNotMatch(
    document.querySelector(".exam-audience-list").textContent,
    /Asha|Bhanu/,
  );
});

test("stale audience data from another organization is not offered even when its branch code matches", async () => {
  await mount(
    draft({ mode: "students", branchCodes: ["CSE"], studentIds: [] }),
    { ...audience, organizationId: "college-b", organizationName: "College B" },
  );
  assert.equal(control("Exam branch").disabled, true);
  assert.equal(control("Exam audience").disabled, true);
  assert.equal(document.querySelector(".exam-audience-list"), null);
  assert.doesNotMatch(document.body.textContent, /Asha|Bhanu|College B/);
});

test("old organization-wide drafts ask for a branch without silently selecting all students", async () => {
  await mount(draft({ mode: "organization", branchCodes: [], studentIds: [] }));
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Choose one branch/,
  );
  assert.equal(control("Exam audience").disabled, true);
  await choose("Exam branch", "Computer Science");
  assert.equal(document.querySelector('[role="status"]'), null);
  assert.deepEqual(current.audience, {
    mode: "branches",
    branchCodes: ["CSE"],
    studentIds: [],
  });
  await act(async () => control("Exam audience").click());
  assert.ok(
    [...document.querySelectorAll('[role="option"]')].every(
      (option) =>
        !/Entire organization|Selected branches/.test(option.textContent),
    ),
  );
});
