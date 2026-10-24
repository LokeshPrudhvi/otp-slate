// Run: node --test tests/competitive-coding.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://student.example.test/competitive-programming",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "Window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
  "Range",
  "localStorage",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
  dom.window,
);
// JSDOM has no layout engine. CodeMirror still needs selection geometry when it
// schedules its normal cursor/viewport measurements.
const emptyRect = () => ({
  x: 0,
  y: 0,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  width: 0,
  height: 0,
});
dom.window.Range.prototype.getBoundingClientRect = emptyRect;
dom.window.Range.prototype.getClientRects = () => [];
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const domErrors = [];
dom.virtualConsole.on("jsdomError", (error) => domErrors.push(error.message));
const bundle = new URL(
  `../.competitive-coding-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  entryPoints: [
    fileURLToPath(new URL("../apps/student/src/coding.tsx", import.meta.url)),
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
    "@codemirror/*",
    "@lezer/*",
    "codemirror",
  ],
  plugins: [
    {
      name: "competitive-coding-boundaries",
      setup(context) {
        context.onResolve(
          {
            filter:
              /^(@slate\/ui|\.\/access|\.\/design|\.\/test-cases|\.\/code-runner)$/,
          },
          ({ path }) => ({ path, namespace: "test-coding" }),
        );
        context.onLoad(
          { filter: /.*/, namespace: "test-coding" },
          ({ path }) => ({
            loader: "jsx",
            resolveDir: fileURLToPath(new URL("../", import.meta.url)),
            contents:
              path === "@slate/ui"
                ? `
                  export function useMe() { return { data: globalThis.__codingStudent, refetch: async () => {} }; }
                  export function api(...args) { throw new Error("Unexpected mutation or execution access request: " + args[0]); }
                `
                : path === "./access"
                  ? `
                    import { useQuery } from "@tanstack/react-query";
                    export function useStudentData(key, path, enabled = true) {
                      return useQuery({ queryKey: ["student", key], queryFn: () => globalThis.__codingRead(path), enabled });
                    }
                  `
                  : path === "./test-cases"
                    ? `export function generateTestCasesForProblem() { return [{ input: "{}", output: "[]", description: "Example" }]; }`
                    : path === "./code-runner"
                      ? `export function executeViaOneCompiler() { throw new Error("Code execution is forbidden in these UI tests"); }`
                      : `
                        import React from "react";
                        export function Heading({ title, children }) { return <header><h1>{title}</h1>{children}</header>; }
                        export function NoResults({ title, children }) { return <section><h2>{title}</h2>{children}</section>; }
                        export function Status({ pending, error }) { return error ? <p role="alert">{error.message}</p> : pending ? <p role="status">Loading</p> : null; }
                        export function StudentIcon({ name }) { return <svg aria-hidden="true" data-icon={name} />; }
                      `,
          }),
        );
      },
    },
  ],
});
const { CodingLibrary, CodingProblemPage } = await import(bundle.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route, useLocation } =
  await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { EditorView } = await import("@codemirror/view");
const { EditorState } = await import("@codemirror/state");
const { undo } = await import("@codemirror/commands");
let root, query;
let catalog;
let readError;
let reads = [];
globalThis.__codingStudent = { id: "student-a" };
globalThis.__codingRead = async (path) => {
  assert.equal(path, "student/practice");
  reads.push(path);
  if (readError) throw new Error(readError);
  return structuredClone(catalog);
};
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
  query?.clear();
}
afterEach(async () => {
  await unmount();
  localStorage.clear();
  globalThis.__codingStudent = { id: "student-a" };
  reads = [];
  readError = undefined;
  assert.deepEqual(
    domErrors.splice(0),
    [],
    "Code editor should not throw during DOM updates",
  );
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
async function mount(url = "/competitive-programming") {
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
        h(
          MemoryRouter,
          { initialEntries: [url] },
          h(
            Routes,
            null,
            h(Route, {
              path: "/competitive-programming",
              element: h(CodingLibrary),
            }),
            h(Route, {
              path: "/competitive-programming/:id",
              element: h(CodingProblemPage),
            }),
          ),
          h(Location),
        ),
      ),
    ),
  );
  await settle();
}
async function click(item) {
  assert.ok(item, "Expected interactive element");
  await act(async () => item.click());
  await settle();
}
async function inputValue(input, value) {
  assert.ok(input, "Expected input");
  const prototype =
    input.tagName === "TEXTAREA"
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
async function choose(label, value) {
  const select = [...document.querySelectorAll("label")]
    .find((item) => item.textContent.trim().startsWith(label))
    ?.querySelector("select");
  assert.ok(select, `Expected ${label} selector`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
function editorView() {
  const editor = document.querySelector(".cm-editor");
  assert.ok(editor, "Expected the syntax-highlighted code editor");
  const view = EditorView.findFromDOM(editor);
  assert.ok(view, "Expected an active CodeMirror editor");
  return view;
}
async function editCode(value) {
  const view = editorView();
  await act(async () =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    }),
  );
  await settle();
}
async function waitForSyntax() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tokens = [
      ...document.querySelectorAll(".cm-content .cm-line span[class]"),
    ];
    if (tokens.length >= 2) return tokens;
    await settle();
  }
  assert.fail("Expected the selected language parser to highlight the code");
}
const buttonText = (label) =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === label,
  );
const labeledButton = (label) =>
  document.querySelector(`button[aria-label="${label}"]`);
const rows = () => [...document.querySelectorAll(".coding-table tbody tr")];
const rowLinks = () => rows().map((row) => row.querySelector("a"));
const settingsKey = (id = "student-a") => `slate-demo-coding:${id}:settings`;
const stored = (key) => JSON.parse(localStorage.getItem(key));
function problem(number, patch = {}) {
  return {
    id: `problem-${number}`,
    number,
    title: ["Array pair", "Binary search", "Graph route"][number - 1],
    description: "Original coding exercise",
    category: "coding",
    kind: "coding",
    difficulty: ["Easy", "Medium", "Hard"][number - 1],
    durationMinutes: 30,
    sample: true,
    topics: [["Arrays"], ["Binary Search"], ["Graph"]][number - 1],
    problem: {
      statement: "Write a solution to this problem.",
      examples: [{ input: "{}", output: "[]", explanation: "Example" }],
      constraints: ["Inputs are bounded."],
      starterCode: { Python: "# Start here", Java: "class Solution {}" },
      hints: ["Consider each input once."],
      approach: "Use the appropriate data structure.",
    },
    ...patch,
  };
}
function mixedCatalog() {
  return [
    problem(1),
    {
      id: "legacy-quiz",
      title: "Legacy aptitude quiz",
      kind: "quiz",
      category: "aptitude",
      difficulty: "Easy",
      questions: [],
    },
    problem(2),
    {
      id: "legacy-typing",
      title: "Legacy typing test",
      kind: "typing",
      category: "skills",
      difficulty: "Easy",
    },
    problem(3),
  ];
}

test("library presents only coding and opens daily progress by default, with a working collapse control", async () => {
  catalog = mixedCatalog();
  await mount();
  assert.equal(
    document.querySelector("h1").textContent,
    "Coding",
  );
  assert.equal(rows().length, 3);
  assert.ok(!document.body.textContent.includes("Legacy aptitude quiz"));
  assert.ok(!document.body.textContent.includes("Legacy typing test"));
  assert.ok(
    rowLinks().every((link) =>
      link.getAttribute("href").startsWith("/competitive-programming/"),
    ),
  );
  const progress = document.querySelector("details.coding-planning");
  assert.equal(progress.open, true);
  await click(progress.querySelector("summary"));
  assert.equal(progress.open, false);
  await click(progress.querySelector("summary"));
  assert.equal(progress.open, true);
});

test("difficulty, topic, search and ordering still filter the coding library", async () => {
  catalog = mixedCatalog();
  await mount();
  await choose("Sort by", "hardest");
  assert.deepEqual(
    rowLinks().map((link) => link.getAttribute("href")),
    [3, 2, 1].map((number) => `/competitive-programming/problem-${number}`),
  );
  await choose("Difficulty", "Medium");
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /Binary search/);
  await choose("Difficulty", "all");
  await choose("Topic", "Arrays");
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /Array pair/);
  await choose("Topic", "all");
  await inputValue(
    document.querySelector('[aria-label="Search coding problems"]'),
    "graph",
  );
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /Graph route/);
});

test("theme is scoped to Competitive Programming, persists across library and workspace, and keeps existing editor settings", async () => {
  catalog = mixedCatalog();
  localStorage.setItem(
    settingsKey(),
    JSON.stringify({ language: "Java", theme: "light", font: 18, tabSize: 2 }),
  );
  await mount();
  assert.equal(
    document.querySelector(".competitive-coding").dataset.theme,
    "light",
  );
  await click(labeledButton("Switch to dark mode"));
  assert.equal(
    document.querySelector(".competitive-coding").dataset.theme,
    "dark",
  );
  assert.equal(
    labeledButton("Switch to light mode").getAttribute("aria-pressed"),
    "true",
  );
  assert.deepEqual(stored(settingsKey()), {
    language: "Java",
    theme: "dark",
    font: 18,
    tabSize: 2,
  });
  assert.equal(document.documentElement.dataset.theme, undefined);
  assert.equal(document.body.dataset.theme, undefined);
  await unmount();
  await mount("/competitive-programming/problem-1");
  assert.equal(
    document.querySelector(".competitive-coding").dataset.theme,
    "dark",
  );
  assert.equal(editorView().state.doc.toString(), "class Solution {}");
  await unmount();
  globalThis.__codingStudent = { id: "student-b" };
  await mount();
  assert.equal(
    document.querySelector(".competitive-coding").dataset.theme,
    "light",
  );
  assert.equal(stored(settingsKey("student-a")).theme, "dark");
});

test("bookmark updates preserve prior solved progress and remain available after reopening", async () => {
  catalog = mixedCatalog();
  const key = "slate-demo-coding:student-a:progress";
  localStorage.setItem(
    key,
    JSON.stringify({ "problem-2": { status: "Solved", bookmarked: false } }),
  );
  await mount();
  await click(labeledButton("Bookmark Binary search"));
  assert.deepEqual(stored(key)["problem-2"], {
    status: "Solved",
    bookmarked: true,
  });
  await choose("My lists", "bookmarks");
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /Binary search/);
  await unmount();
  await mount("/competitive-programming?list=bookmarks");
  assert.equal(rows().length, 1);
  assert.equal(
    labeledButton("Remove bookmark for Binary search").getAttribute(
      "aria-pressed",
    ),
    "true",
  );
});

test("workspace preserves saved code in each language and navigates only to coding problems", async () => {
  catalog = mixedCatalog();
  const key = "slate-demo-coding:student-a:draft:problem-2";
  localStorage.setItem(
    key,
    JSON.stringify({
      Python: "print('existing draft')",
      Java: "// Existing Java",
    }),
  );
  await mount("/competitive-programming/problem-2");
  assert.equal(editorView().state.doc.toString(), "print('existing draft')");
  assert.equal(
    document
      .querySelector('[aria-label="Previous problem"]')
      .getAttribute("href"),
    "/competitive-programming/problem-1",
  );
  assert.equal(
    document.querySelector('[aria-label="Next problem"]').getAttribute("href"),
    "/competitive-programming/problem-3",
  );
  await editCode("print('updated draft')");
  await choose("Language", "Java");
  assert.equal(editorView().state.doc.toString(), "// Existing Java");
  await editCode("class Updated {}\n// Java draft");
  await choose("Language", "Python");
  assert.equal(editorView().state.doc.toString(), "print('updated draft')");
  await click(labeledButton("Switch to dark mode"));
  assert.deepEqual(stored(key), {
    Python: "print('updated draft')",
    Java: "class Updated {}\n// Java draft",
  });
  await unmount();
  await mount("/competitive-programming/problem-2");
  assert.equal(editorView().state.doc.toString(), "print('updated draft')");
});

test("workspace removes discussion and notes and renders editable syntax-highlighted code with line numbers", async () => {
  catalog = mixedCatalog();
  localStorage.setItem(
    "slate-demo-coding:student-a:draft:problem-1",
    JSON.stringify({
      Python: 'def solve(data):\n    text = "hello"\n    return 42\n',
    }),
  );
  await mount("/competitive-programming/problem-1");
  const tabs = [
    ...document.querySelectorAll('[aria-label="Problem content"] [role="tab"]'),
  ].map((item) => item.textContent.trim());
  assert.deepEqual(tabs, ["Description", "Solution guide", "Submissions"]);
  assert.equal(
    document.querySelector(".coding-notes, .coding-discussion"),
    null,
  );
  const content = document.querySelector(
    '.cm-content[aria-label="Solution code"]',
  );
  assert.ok(content);
  assert.equal(content.getAttribute("contenteditable"), "true");
  assert.ok(document.querySelector(".cm-lineNumbers"));
  const highlighted = await waitForSyntax();
  assert.ok(
    highlighted.length >= 3,
    "Keywords, strings and numbers should have syntax tokens",
  );
  assert.ok(new Set(highlighted.map((token) => token.className)).size >= 2);
  await editCode("def solve(data):\n    return 7\n");
  assert.equal(
    stored("slate-demo-coding:student-a:draft:problem-1").Python,
    "def solve(data):\n    return 7\n",
  );
});

test("theme, font and indentation settings preserve the active code, selection and undo history", async () => {
  catalog = mixedCatalog();
  await mount("/competitive-programming/problem-1");
  const view = editorView();
  await editCode("def solve(data):\n    return 42");
  await act(async () => view.dispatch({ selection: { anchor: 4, head: 9 } }));
  await click(labeledButton("Switch to dark mode"));
  await click(buttonText("Editor settings"));
  await choose("Font size", "18");
  await choose("Tab size", "2");
  assert.equal(
    editorView(),
    view,
    "Settings must reconfigure, not recreate, the editor",
  );
  assert.equal(view.state.doc.toString(), "def solve(data):\n    return 42");
  assert.equal(view.state.selection.main.anchor, 4);
  assert.equal(view.state.selection.main.head, 9);
  assert.equal(view.state.facet(EditorView.darkTheme), true);
  assert.equal(view.state.facet(EditorState.tabSize), 2);
  assert.equal(dom.window.getComputedStyle(view.dom).fontSize, "18px");
  await act(async () => assert.equal(undo(view), true));
  assert.equal(view.state.doc.toString(), "# Start here");
  assert.equal(
    stored("slate-demo-coding:student-a:draft:problem-1").Python,
    "# Start here",
  );
});

test("reset and restore last draft update the editor and keep other language drafts", async () => {
  catalog = mixedCatalog();
  const key = "slate-demo-coding:student-a:draft:problem-1";
  localStorage.setItem(
    key,
    JSON.stringify({ Python: "# unfinished", Java: "class Existing {}" }),
  );
  localStorage.setItem(
    "slate-demo-coding:student-a:submissions:problem-1",
    JSON.stringify([
      {
        id: "last",
        at: new Date().toISOString(),
        language: "Java",
        code: "class Submitted {}",
        status: "Accepted",
        runtime: "1 ms",
        memory: "1 MB",
      },
    ]),
  );
  await mount("/competitive-programming/problem-1");
  await click(buttonText("Reset code"));
  assert.equal(editorView().state.doc.toString(), "# Start here");
  assert.equal(stored(key).Java, "class Existing {}");
  await click(buttonText("Restore last draft"));
  assert.equal(editorView().state.doc.toString(), "class Submitted {}");
  assert.equal(
    document.querySelector('[aria-label="Programming language"]').value,
    "Java",
  );
  assert.deepEqual(stored(key), {
    Python: "# Start here",
    Java: "class Submitted {}",
  });
});

test("code editing supports Python auto-indentation and the selected tab size", async () => {
  catalog = mixedCatalog();
  localStorage.setItem(
    settingsKey(),
    JSON.stringify({
      language: "Python",
      theme: "light",
      font: 14,
      tabSize: 2,
    }),
  );
  await mount("/competitive-programming/problem-1");
  await editCode("def solve(data):");
  await waitForSyntax();
  const view = editorView();
  await act(async () => {
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    view.contentDOM.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(view.state.doc.toString(), "def solve(data):\n  ");
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        keyCode: 9,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(view.state.doc.toString(), "def solve(data):\n    ");
  assert.equal(
    stored("slate-demo-coding:student-a:draft:problem-1").Python,
    "def solve(data):\n    ",
  );
  const escape = new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    bubbles: true,
    cancelable: true,
  });
  const leave = new dom.window.KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    keyCode: 9,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    view.contentDOM.dispatchEvent(escape);
    view.contentDOM.dispatchEvent(leave);
  });
  assert.equal(
    leave.defaultPrevented,
    false,
    "Escape then Tab must leave native keyboard navigation available",
  );
  assert.equal(
    view.state.doc.toString(),
    "def solve(data):\n    ",
    "The navigation Tab must not insert indentation",
  );
});

test("all 16 programming languages load distinct syntax colors while retaining their own starter code", async () => {
  const starterCode = {
    Python: 'def solve():\n    count = 2\n    return "ok"',
    JavaScript: 'function solve() { const count = 2; return "ok"; }',
    TypeScript:
      'function solve(): string { const count: number = 2; return "ok"; }',
    C: 'int main(void) { printf("ok"); return 2; }',
    "C++": 'int main() { std::string message = "ok"; return 2; }',
    Java: 'class Solution { static String solve() { return "ok"; } }',
    "C#": 'class Solution { static string Solve() { return "ok"; } }',
    Go: 'package main\nfunc solve() string { count := 2; return "ok" }',
    Rust: 'fn solve() -> String { let count = 2; "ok".to_string() }',
    Ruby: 'def solve\n  count = 2\n  "ok"\nend',
    PHP: 'function solve() { $count = 2; return "ok"; }',
    Swift: 'func solve() -> String { let count = 2; return "ok" }',
    Kotlin: 'fun solve(): String { val count = 2; return "ok" }',
    Scala: 'def solve(): String = { val count = 2; "ok" }',
    R: 'solve <- function() { count <- 2; return("ok") }',
    Dart: 'String solve() { final count = 2; return "ok"; }',
  };
  const item = problem(1);
  item.problem.starterCode = starterCode;
  catalog = [item];
  await mount("/competitive-programming/problem-1");
  for (const [language, source] of Object.entries(starterCode)) {
    await choose("Language", language);
    const tokens = await waitForSyntax();
    assert.equal(
      editorView().state.doc.toString(),
      source,
      `${language} should keep its own starter code`,
    );
    const colors = new Set(
      tokens
        .map((token) => dom.window.getComputedStyle(token).color)
        .filter(Boolean),
    );
    assert.ok(
      colors.size > 1,
      `${language} should distinguish different syntax token colors`,
    );
  }
});

test("non-coding and unassigned IDs cannot open a coding workspace", async () => {
  catalog = mixedCatalog();
  for (const id of ["legacy-quiz", "unassigned-problem"]) {
    await mount(`/competitive-programming/${id}`);
    assert.equal(document.querySelector('[aria-label="Solution code"]'), null);
    assert.equal(document.querySelector(".coding-workspace"), null);
    assert.ok(document.querySelector('a[href="/competitive-programming"]'));
    await unmount();
  }
});

test("a catalog failure displays the error without opening a stale workspace", async () => {
  catalog = mixedCatalog();
  readError = "Unable to load assigned coding problems";
  await mount("/competitive-programming/problem-1");
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Unable to load assigned coding problems/,
  );
  assert.equal(document.querySelector('[aria-label="Solution code"]'), null);
});
