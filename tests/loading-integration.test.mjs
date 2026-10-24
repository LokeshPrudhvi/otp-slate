// Run: node --test tests/loading-integration.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://student.example.test/",
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
  "localStorage",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const directory = fileURLToPath(new URL("../", import.meta.url));
const bundle = new URL(
  `../.loading-integration-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  stdin: {
    contents: `
      export { DataState, Protected } from "./packages/ui/src/kit";
      export { Status } from "./apps/student/src/design";
      export { StudentLogin } from "./apps/student/src/auth";
      export { CodingLibrary, CodingProblemPage } from "./apps/student/src/coding";
    `,
    resolveDir: directory,
    loader: "tsx",
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
  ],
  plugins: [
    {
      name: "loading-test-boundaries",
      setup(context) {
        context.onResolve({ filter: /^@slate\/ui$/ }, () => ({
          path: `${directory}packages/ui/src/kit.tsx`,
        }));
        context.onResolve(
          {
            filter:
              /^(better-auth\/react|better-auth\/client\/plugins|\.\/access)$/,
          },
          ({ path }) => ({ path, namespace: "loading-test" }),
        );
        context.onLoad(
          { filter: /.*/, namespace: "loading-test" },
          ({ path }) => ({
            loader: "tsx",
            resolveDir: directory,
            contents:
              path === "better-auth/react"
                ? "export function createAuthClient() { return {}; }"
                : path === "better-auth/client/plugins"
                  ? "export function twoFactorClient() { return {}; }"
                  : `
              export { useData as useStudentData } from "./packages/ui/src/kit";
              export function hasAccess() { return true; }
              export function hasCodingAccess() { return true; }
            `,
          }),
        );
      },
    },
  ],
});
const {
  Status,
  DataState,
  Protected,
  StudentLogin,
  CodingLibrary,
  CodingProblemPage,
} = await import(bundle.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Route, Routes, useLocation } =
  await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");

let root, query;
let response;
let requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(options.method, "GET", "Loading must not mutate student data");
  assert.ok(
    ["/api/v1/me?portal=student", "/api/v1/student/practice"].includes(url),
    `Unexpected request: ${url}`,
  );
  requests.push(url);
  return response;
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  query?.clear();
  query = undefined;
  requests = [];
  localStorage.clear();
});
after(async () => {
  await rm(bundle, { force: true });
  dom.window.close();
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function json(status, value) {
  return { status, ok: status >= 200 && status < 300, json: async () => value };
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
function Location() {
  const location = useLocation();
  return h("output", { "data-location": true }, location.pathname);
}
async function render(element) {
  root ??= createRoot(document.getElementById("root"));
  await act(async () => root.render(element));
}
async function mountRoute(
  element,
  { path = "/", initial = "/", identity } = {},
) {
  query = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  if (identity) query.setQueryData(["me", "student"], identity);
  await render(
    h(
      QueryClientProvider,
      { client: query },
      h(
        MemoryRouter,
        { initialEntries: [initial] },
        h(
          Routes,
          null,
          h(Route, { path, element }),
          h(Route, { path: "/login", element: h("h1", null, "Sign in") }),
          h(Route, {
            path: "/onboarding",
            element: h("h1", null, "First sign-in"),
          }),
        ),
        h(Location),
      ),
    ),
  );
}
const status = () => document.querySelector('[role="status"]');
const alert = () => document.querySelector('[role="alert"]');
const route = () => document.querySelector("[data-location]").textContent;

test("student Status displays the shared loader, then replaces it with errors or clears it", async () => {
  await render(
    h(Status, {
      pending: true,
      label: "Loading assigned courses",
      variant: "cards",
    }),
  );
  assert.equal(
    status()?.getAttribute("aria-label"),
    "Loading assigned courses",
  );
  assert.equal(status()?.getAttribute("aria-busy"), "true");
  assert.ok(document.querySelector(".slate-loading__skeleton"));
  await render(
    h(Status, {
      pending: false,
      error: new Error("Course service unavailable"),
    }),
  );
  assert.equal(status(), null);
  assert.equal(alert()?.textContent, "Course service unavailable");
  await render(h(Status, { pending: false }));
  assert.equal(document.getElementById("root").textContent, "");
});

test("shared DataState gates content until loaded and keeps failed reads visible", async () => {
  const content = h("button", null, "Edit course");
  await render(h(DataState, { pending: true }, content));
  assert.ok(status());
  assert.equal(document.querySelector("button"), null);
  await render(
    h(
      DataState,
      { pending: false, error: new Error("Access denied") },
      content,
    ),
  );
  assert.equal(status(), null);
  assert.equal(alert()?.textContent, "Access denied");
  assert.equal(document.querySelector("button"), null);
  await render(h(DataState, { pending: false }, content));
  assert.equal(alert(), null);
  assert.equal(document.querySelector("button")?.textContent, "Edit course");
});

test("protected routes show a full-screen loader while checking a session, then redirect guests", async () => {
  const pending = deferred();
  response = pending.promise;
  await mountRoute(h(Protected));
  assert.equal(status()?.getAttribute("aria-label"), "Opening your workspace");
  assert.ok(status()?.classList.contains("slate-loading--fullscreen"));
  assert.equal(route(), "/");
  assert.equal(document.querySelector("h1"), null);
  pending.resolve(json(401, { message: "Sign in required" }));
  await settle();
  await settle();
  assert.equal(status(), null);
  assert.equal(route(), "/login");
  assert.equal(document.querySelector("h1")?.textContent, "Sign in");
  assert.deepEqual(requests, ["/api/v1/me?portal=student"]);
});

test("protected route failures leave the loader and offer retry instead of a false guest redirect", async () => {
  response = json(503, { message: "Temporarily unavailable" });
  await mountRoute(h(Protected));
  await settle();
  assert.equal(status(), null);
  assert.equal(alert()?.textContent, "Temporarily unavailable");
  assert.equal(route(), "/");
  assert.equal(document.querySelector("button")?.textContent, "Retry");
});

test("student login keeps its form hidden during session validation and redirects signed-in students", async () => {
  const pending = deferred();
  response = pending.promise;
  await mountRoute(h(StudentLogin), { path: "/sign-in", initial: "/sign-in" });
  assert.equal(status()?.getAttribute("aria-label"), "Opening your workspace");
  assert.ok(status()?.classList.contains("slate-loading--fullscreen"));
  assert.equal(document.querySelector("form"), null);
  pending.resolve(
    json(200, { id: "student-a", onboardingStep: "change-password" }),
  );
  await settle();
  await settle();
  assert.equal(status(), null);
  assert.equal(route(), "/onboarding");
  assert.equal(document.querySelector("form"), null);
});

test("student login replaces its loader with the real form for a guest", async () => {
  response = json(401, { message: "Sign in required" });
  await mountRoute(h(StudentLogin), { path: "/sign-in", initial: "/sign-in" });
  await settle();
  assert.equal(status(), null);
  assert.ok(document.querySelector('input[type="email"]'));
  assert.ok(document.querySelector('input[type="password"]'));
  assert.equal(route(), "/sign-in");
});

test("coding library uses its loading scaffold without false empty or zero-problem states", async () => {
  response = new Promise(() => {});
  localStorage.setItem(
    "slate-demo-coding:student-a:settings",
    JSON.stringify({ theme: "dark", language: "Python", font: 14, tabSize: 4 }),
  );
  await mountRoute(h(CodingLibrary), { identity: { id: "student-a" } });
  assert.equal(status()?.getAttribute("aria-label"), "Loading coding problems");
  assert.equal(
    document.querySelector(".competitive-coding")?.dataset.theme,
    "dark",
  );
  assert.ok(document.querySelector(".slate-loading__skeleton"));
  assert.equal(document.querySelector(".coding-library-total"), null);
  assert.doesNotMatch(
    document.body.textContent,
    /No coding questions assigned|0 problems|0 \/ 0/,
  );
});

test("coding problems keep the selected theme and workspace scaffold while the assignment loads", async () => {
  response = new Promise(() => {});
  localStorage.setItem(
    "slate-demo-coding:student-a:settings",
    JSON.stringify({ theme: "dark", language: "Python", font: 14, tabSize: 4 }),
  );
  await mountRoute(h(CodingProblemPage), {
    path: "/competitive-programming/:id",
    initial: "/competitive-programming/problem-a",
    identity: { id: "student-a" },
  });
  assert.equal(
    status()?.getAttribute("aria-label"),
    "Preparing your coding workspace",
  );
  assert.equal(
    document.querySelector(".competitive-coding")?.dataset.theme,
    "dark",
  );
  assert.ok(document.querySelector(".slate-loading__skeleton"));
  assert.doesNotMatch(document.body.textContent, /Problem unavailable/);
});
