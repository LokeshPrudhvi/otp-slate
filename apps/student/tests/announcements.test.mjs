// Run: node --test apps/student/tests/announcements.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
  url: "https://student.example.test/announcements",
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Event"])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? dom.window : dom.window[name],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(
  `../.announcement-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  stdin: {
    contents:
      'export { AccessRoute } from "./access.tsx"; export { AnnouncementsPage } from "./announcements.tsx";',
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
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AccessRoute, AnnouncementsPage } = await import(bundle.href);

const identity = {
  id: "student-test",
  name: "Test Student",
  role: "student",
  features: ["announcements"],
};
const notices = [
  {
    id: "org",
    title: "Campus update",
    body: "Welcome\nto campus.",
    from: "Placement team",
    date: "2026-10-10T10:00:00.000Z",
    branchCode: null,
    organizationName: "Test College",
    format: "plain",
  },
  {
    id: "branch",
    title: "CSE workshop",
    body: "## Bring a laptop\n\n- **Install** the tools\n- Read the guide",
    from: "Platform Admin",
    date: "2026-10-11T10:00:00.000Z",
    branchCode: "CSE",
    branchName: "Computer Science",
    format: "markdown",
  },
];
let root, client, requests;
const originalFetch = globalThis.fetch;
const response = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function mount(handler, features = identity.features) {
  requests = [];
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  client.setQueryData(["me", "student"], { ...identity, features });
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/v1/me?"))
      return response(200, { ...identity, features });
    assert.equal(String(url), "/api/v1/student/announcements");
    requests.push(String(url));
    return handler();
  };
  root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client },
        h(
          MemoryRouter,
          null,
          h(AccessRoute, { feature: "announcements" }, h(AnnouncementsPage)),
        ),
      ),
    ),
  );
}
async function waitFor(check) {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.fail(
    "Expected UI state was not reached: " + document.body.textContent,
  );
}
async function search(value) {
  const input = document.querySelector("input[type='search']");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    client?.clear();
  });
  globalThis.fetch = originalFetch;
});
after(async () => {
  dom.window.close();
  await rm(bundle, { force: true });
});

test("real notices show newest first with branch scope and rich or literal content", async () => {
  await mount(() => response(200, notices));
  await waitFor(() => document.querySelectorAll("article").length === 2);
  const cards = [...document.querySelectorAll("article")];
  assert.match(cards[0].textContent, /CSE workshop/);
  assert.match(cards[0].textContent, /Computer Science \(CSE\)/);
  assert.equal(
    cards[0].querySelector(".lesson-rich-content h2").textContent,
    "Bring a laptop",
  );
  assert.equal(cards[0].querySelectorAll("li").length, 2);
  assert.equal(cards[0].querySelector("strong").textContent, "Install");
  assert.equal(cards[0].querySelector("time").dateTime, notices[1].date);
  assert.match(cards[1].textContent, /Entire organization/);
  assert.match(cards[1].textContent, /Placement team · Test College/);
  assert.equal(
    cards[1].querySelector(".lesson-plain").textContent,
    "Welcome\nto campus.",
  );
  assert.doesNotMatch(document.body.textContent, /Sample announcement/);
});

test("only explicitly marked fixtures receive a sample badge", async () => {
  await mount(() =>
    response(200, [...notices, { ...notices[0], id: "sample", sample: true }]),
  );
  await waitFor(() => document.querySelectorAll("article").length === 3);
  assert.equal(
    [...document.querySelectorAll(".a-tag")].filter(
      (node) => node.textContent === "Sample announcement",
    ).length,
    1,
  );
});

test("search matches branch names and clearing an unmatched search restores notices", async () => {
  await mount(() => response(200, notices));
  await waitFor(() => document.querySelectorAll("article").length === 2);
  await search("computer science");
  assert.equal(document.querySelectorAll("article").length, 1);
  await search("not present");
  assert.match(document.body.textContent, /No matching announcements/);
  const clear = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Clear search",
  );
  await act(async () => clear.click());
  assert.equal(document.querySelectorAll("article").length, 2);
});

test("failed requests offer refresh and recover without showing a misleading empty state", async () => {
  let failed = true;
  await mount(() =>
    failed
      ? response(503, { message: "Please try again shortly." })
      : response(200, []),
  );
  await waitFor(() => document.querySelector("[role='alert']"));
  assert.doesNotMatch(document.body.textContent, /No announcements yet/);
  failed = false;
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Refresh")
      .click(),
  );
  await waitFor(() =>
    document.body.textContent.includes("No announcements yet"),
  );
  assert.equal(document.querySelector("[role='alert']"), null);
  assert.equal(requests.length, 2);
});

test("students without announcement access do not request or see notices", async () => {
  await mount(() => assert.fail("Forbidden announcement request"), []);
  assert.equal(requests.length, 0);
  assert.match(
    document.body.textContent,
    /This section is not assigned to your account/,
  );
  assert.equal(document.querySelector("article"), null);
});
