// Run: node --test tests/resume-student.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://student.example.test/resume",
  pretendToBeVisual: true,
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
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(
  `../.resume-student-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  entryPoints: [
    fileURLToPath(new URL("../apps/student/src/resume.tsx", import.meta.url)),
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
    "@tanstack/react-query",
  ],
  plugins: [
    {
      name: "student-resume-boundaries",
      setup(context) {
        context.onResolve(
          { filter: /^(@slate\/ui|\.\/design)$/ },
          ({ path }) => ({ path, namespace: "test-resume" }),
        );
        context.onLoad(
          { filter: /.*/, namespace: "test-resume" },
          ({ path }) => ({
            loader: "jsx",
            contents:
              path === "@slate/ui"
                ? `
          import { useQuery } from "@tanstack/react-query";
          const me = { data: { name: "Student Tester", email: "student@example.test" } };
          export function useMe() { return me; }
          export function useData(key, path) {
            return useQuery({ queryKey: ["student", key], queryFn: () => globalThis.__resumeRead(path) });
          }
          export function api(...args) { return globalThis.__resumeSend(...args); }
        `
                : `
          import React from "react";
          export function Heading({ title, children }) { return <header><h1>{title}</h1>{children}</header>; }
          export function Status({ pending, error }) {
            return error ? <p role="alert">{error.message}</p> : pending ? <p role="status">Loading</p> : null;
          }
        `,
          }),
        );
      },
    },
  ],
});
const { ResumePage } = await import(bundle.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
let root, query;
let stored = { data: null, revision: 0 };
let calls = [];
let send;
globalThis.__resumeRead = async (path) => {
  assert.equal(path, "student/resume");
  return structuredClone(stored);
};
globalThis.__resumeSend = async (path, method, body) => {
  const input = structuredClone(body);
  calls.push({ path, method, body: input });
  assert.equal(path, "student/resume");
  assert.equal(method, "PUT");
  if (send) return send(input);
  assert.equal(input.revision, stored.revision);
  stored = { data: input.data, revision: stored.revision + 1 };
  return { revision: stored.revision };
};
async function settle(ms = 5) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
  query?.clear();
}
afterEach(async () => {
  await unmount();
  stored = { data: null, revision: 0 };
  calls = [];
  send = undefined;
});
after(async () => {
  await rm(bundle, { force: true });
  dom.window.close();
});
async function mount() {
  query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(h(QueryClientProvider, { client: query }, h(ResumePage))),
  );
  await settle();
}
const section = (name) =>
  document.querySelector(`.resume-form section[aria-label="${name}"]`);
const entry = (name) =>
  [...document.querySelectorAll("fieldset")].find(
    (node) => node.querySelector("legend").textContent === name,
  );
const preview = () =>
  document.querySelector('[aria-label="Live resume preview"]');
const button = (name, scope = document) =>
  [...scope.querySelectorAll("button")].find(
    (node) =>
      (node.getAttribute("aria-label") ||
        node.textContent.replace(/^＋/, "").trim()) === name,
  );
function field(label, scope = document) {
  const node = [...scope.querySelectorAll("label")].find(
    (node) => node.textContent.trim() === label,
  );
  assert.ok(node, `Expected field labeled ${label}`);
  return node.htmlFor
    ? document.getElementById(node.htmlFor)
    : node.querySelector("input");
}
async function click(node) {
  assert.ok(node, "Expected interactive element");
  await act(async () => node.click());
  await settle();
}
async function fill(node, value) {
  const prototype =
    node.tagName === "TEXTAREA"
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function enter(node) {
  await act(async () =>
    node.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await settle();
}
const previewEntries = (heading) =>
  [...preview().querySelectorAll("section")]
    .find((node) => node.querySelector("h2").textContent === heading)
    ?.querySelectorAll(".resume-entry") || [];

test("projects and their individual bullet points update independently in the live preview", async () => {
  await mount();
  await click(button("Add project"));
  await fill(field("Project title", entry("Project 1")), "Campus app");
  await fill(
    field("Project description", entry("Project 1")),
    "A placement portal.",
  );
  for (const point of [
    "Built the API",
    "Temporary point",
    "Reduced load time",
  ]) {
    await click(button("Add point", entry("Project 1")));
    const fields = entry("Project 1").querySelectorAll(
      ".resume-point-row textarea",
    );
    await fill(fields[fields.length - 1], point);
  }
  await click(button("Remove project 1 point 2"));
  await click(button("Add project"));
  await fill(field("Project title", entry("Project 2")), "Weather app");
  assert.equal(previewEntries("Projects").length, 2);
  assert.deepEqual(
    [...previewEntries("Projects")[0].querySelectorAll("li")].map(
      (node) => node.textContent,
    ),
    ["Built the API", "Reduced load time"],
  );
  assert.match(previewEntries("Projects")[0].textContent, /A placement portal/);
  await click(button("Remove project 1"));
  assert.equal(field("Project title", entry("Project 1")).value, "Weather app");
  assert.equal(previewEntries("Projects").length, 1);
  assert.doesNotMatch(preview().textContent, /Campus app|Built the API/);
});

test("experience supports date ranges, current roles and separate education and certificate entries", async () => {
  await mount();
  await click(button("Add experience"));
  await fill(
    field("Role / internship title", entry("Experience 1")),
    "Engineering Intern",
  );
  await fill(
    field("Company / organization", entry("Experience 1")),
    "Example Labs",
  );
  await fill(field("Start date", entry("Experience 1")), "2025-01");
  await fill(field("End date", entry("Experience 1")), "2025-06");
  assert.match(
    previewEntries("Experience")[0].textContent,
    /Jan 2025 – Jun 2025/,
  );
  await click(field("I currently work here", entry("Experience 1")));
  assert.equal(field("End date", entry("Experience 1")).disabled, true);
  assert.match(
    previewEntries("Experience")[0].textContent,
    /Jan 2025 – Present/,
  );
  await click(field("I currently work here", entry("Experience 1")));
  assert.equal(field("End date", entry("Experience 1")).disabled, false);
  assert.equal(field("End date", entry("Experience 1")).value, "2025-06");
  await click(button("Add point", entry("Experience 1")));
  await fill(field("Experience 1 point 1"), "Shipped a reporting feature");
  assert.equal(
    previewEntries("Experience")[0].querySelector("li").textContent,
    "Shipped a reporting feature",
  );
  for (const name of ["Example University", "Example School"]) {
    await click(button("Add education"));
    const number = section("Education").querySelectorAll("fieldset").length;
    await fill(
      field("School / college / university", entry(`Education ${number}`)),
      name,
    );
  }
  for (const name of ["Cloud Foundations", "Data Analysis"]) {
    await click(button("Add certificate"));
    const number =
      section("Certifications").querySelectorAll("fieldset").length;
    await fill(
      field("Certificate name", entry(`Certification ${number}`)),
      name,
    );
  }
  assert.equal(previewEntries("Education").length, 2);
  assert.equal(previewEntries("Certifications").length, 2);
  await click(button("Remove education 1"));
  await click(button("Remove certification 1"));
  assert.equal(
    field("School / college / university", entry("Education 1")).value,
    "Example School",
  );
  assert.equal(
    field("Certificate name", entry("Certification 1")).value,
    "Data Analysis",
  );
  assert.match(preview().textContent, /Engineering Intern|Example Labs/);
});

test("skills can be added with Enter or plus, prevent case-insensitive duplicates, and remove individually", async () => {
  await mount();
  await fill(field("New skill"), "  Python  ");
  await enter(field("New skill"));
  assert.equal(field("New skill").value, "");
  await fill(field("New skill"), "SQL");
  await click(button("Add skill"));
  await fill(field("New skill"), "python");
  await click(button("Add skill"));
  assert.match(section("Skills").textContent, /already on your resume/);
  assert.deepEqual(
    [...preview().querySelectorAll(".resume-skills li")].map(
      (node) => node.textContent,
    ),
    ["Python", "SQL"],
  );
  await click(button("Remove skill Python"));
  assert.deepEqual(
    [...preview().querySelectorAll(".resume-skills li")].map(
      (node) => node.textContent,
    ),
    ["SQL"],
  );
});

test("autosave persists structured entries and revision, then reloads the same values", async () => {
  stored.revision = 6;
  await mount();
  await click(button("Add project"));
  await fill(field("Project title", entry("Project 1")), "Saved project");
  await click(button("Add point", entry("Project 1")));
  await fill(field("Project 1 point 1"), "A saved achievement");
  await fill(field("New skill"), "TypeScript");
  await enter(field("New skill"));
  await settle(1000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.revision, 6);
  assert.deepEqual(calls[0].body.data.skills, ["TypeScript"]);
  assert.deepEqual(calls[0].body.data.projects[0].bullets, [
    "A saved achievement",
  ]);
  const savedId = calls[0].body.data.projects[0].id;
  assert.ok(savedId);
  assert.equal(stored.revision, 7);
  await unmount();
  await mount();
  assert.equal(
    field("Project title", entry("Project 1")).value,
    "Saved project",
  );
  assert.equal(field("Project 1 point 1").value, "A saved achievement");
  assert.match(preview().textContent, /TypeScript/);
  await fill(field("Project title", entry("Project 1")), "Updated project");
  await settle(1000);
  assert.equal(calls[1].body.revision, 7);
  assert.equal(calls[1].body.data.projects[0].id, savedId);
});

test("legacy resumes are displayed without an automatic write and retained when a detail is edited", async () => {
  const legacy = {
    name: "Existing Student",
    template: "serif",
    summary: "Existing summary",
    skills: "Python, SQL\nReact",
    projects: "First project\n• Existing detail\nSecond project",
    experience: "Internship\nExample company, 2024",
    education: "B.Tech\nExample College",
    certifications: "Cloud Certificate\nIssued in 2024",
  };
  stored = { data: legacy, revision: 11 };
  await mount();
  for (const [name, label] of [
    ["projects", "Project description"],
    ["experience", "Experience description"],
    ["education", "Education details (optional)"],
    ["certifications", "Certificate details (optional)"],
  ])
    assert.equal(field(label).value, legacy[name]);
  assert.deepEqual(
    [...preview().querySelectorAll(".resume-skills li")].map(
      (node) => node.textContent,
    ),
    ["Python", "SQL", "React"],
  );
  assert.ok(preview().classList.contains("template-serif"));
  await settle(1000);
  assert.equal(
    calls.length,
    0,
    "Mounting a legacy resume must not rewrite saved data",
  );
  await fill(field("Professional summary"), "Updated summary");
  await settle(1000);
  assert.equal(calls.length, 1);
  for (const name of ["projects", "experience", "education", "certifications"])
    assert.equal(calls[0].body.data[name][0].description, legacy[name]);
  assert.equal(calls[0].body.revision, 11);
});

test("edits made while a save is in flight are saved afterwards using the new revision", async () => {
  stored.revision = 3;
  let finishFirst;
  send = async (input) => {
    if (calls.length === 1)
      return new Promise((resolve) => {
        finishFirst = resolve;
      });
    return { revision: input.revision + 1 };
  };
  await mount();
  await fill(field("Full name"), "First edit");
  await settle(1000);
  assert.equal(calls.length, 1);
  await fill(field("Full name"), "Newer edit");
  await act(async () => finishFirst({ revision: 4 }));
  await settle();
  assert.equal(field("Full name").value, "Newer edit");
  await settle(1000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.data.name, "Newer edit");
  assert.equal(calls[1].body.revision, 4);
});

test("failed saves retain entered data and retry the same unsaved revision", async () => {
  stored.revision = 8;
  send = async () => {
    if (calls.length === 1) throw new Error("Connection unavailable");
    return { revision: 9 };
  };
  await mount();
  await fill(field("Full name"), "Keep my edits");
  await settle(1000);
  assert.match(
    document.querySelector(".resume-save-actions").textContent,
    /Connection unavailable/,
  );
  assert.equal(field("Full name").value, "Keep my edits");
  await click(button("Retry save"));
  await settle(1000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.revision, 8);
  assert.equal(calls[1].body.data.name, "Keep my edits");
  assert.equal(document.querySelector(".resume-save-actions"), null);
  assert.match(
    document.querySelector(".resume-save-note").textContent,
    /Saved to your account/,
  );
});
