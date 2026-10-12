// Run: node --test apps/student/tests/registration-branches.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
  url: "https://student.example.test/register",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Event",
  "MutationObserver",
])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? dom.window : dom.window[name],
  });
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(
  `../.registration-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  entryPoints: [
    fileURLToPath(new URL("../src/registration.tsx", import.meta.url)),
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
});
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { StudentRegistration } = await import(bundle.href);
const colleges = [
  { id: "alpha", name: "Alpha College" },
  { id: "beta", name: "Beta College" },
];
const alphaBranches = [
  { organizationId: "alpha", code: "CSE", name: "Computer Science" },
];
const betaBranches = [
  { organizationId: "beta", code: "ME", name: "Mechanical Engineering" },
];
const response = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const originalFetch = globalThis.fetch;
let root, client, requests;
async function mount(
  branchHandler = (id) =>
    response(200, id === "alpha" ? alphaBranches : betaBranches),
) {
  requests = [];
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (url === "/api/v1/registration/organizations")
      return response(200, colleges);
    if (url === "/api/v1/registration/requests")
      return response(201, { id: "request-test", status: "pending" });
    const match = String(url).match(
      /^\/api\/v1\/registration\/organizations\/(alpha|beta)\/branches$/,
    );
    assert.ok(match, `Unexpected request: ${url}`);
    return branchHandler(match[1]);
  };
  root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client },
        h(MemoryRouter, null, h(StudentRegistration)),
      ),
    ),
  );
  await waitFor(
    () => !document.querySelector("#registration-organizationId").disabled,
  );
}
async function waitFor(check) {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.fail("Expected UI state not reached: " + document.body.textContent);
}
async function select(id, label) {
  const button = document.getElementById(id);
  assert.equal(button.disabled, false);
  await act(async () => button.click());
  const option = [...document.querySelectorAll("[role='option']")].find(
    (node) => node.textContent === label,
  );
  assert.ok(option, `Missing option: ${label}`);
  await act(async () => option.click());
}
async function type(id, value) {
  const input = document.getElementById(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const branchControl = () => document.getElementById("registration-branchName");
const branchCode = () => document.getElementById("registration-branchCode");
const submitButton = () => document.querySelector("button[type='submit']");
async function chooseAlpha() {
  await select("registration-organizationId", "Alpha College");
  await waitFor(() => !branchControl().disabled);
  await select("registration-branchName", "Computer Science");
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

test("registration selects only canonical branches and submits their readonly code for approval", async () => {
  await mount();
  assert.equal(branchControl().tagName, "BUTTON");
  assert.equal(branchControl().disabled, true);
  assert.equal(submitButton().disabled, true);
  assert.equal(
    requests.filter((request) => request.url.endsWith("/branches")).length,
    0,
  );
  await chooseAlpha();
  assert.equal(branchCode().readOnly, true);
  assert.equal(branchCode().value, "CSE");
  assert.equal(document.querySelector("input[name='branchName']"), null);
  for (const [name, value] of Object.entries({
    name: "Student Example",
    studentId: "ROLL-42",
    email: "STUDENT@EXAMPLE.TEST",
    phone: "9876543210",
  }))
    await type(`registration-${name}`, value);
  await act(async () => submitButton().click());
  await waitFor(() => document.querySelector(".registration-success"));
  const posted = requests.find((request) => request.options.method === "POST");
  assert.deepEqual(JSON.parse(posted.options.body), {
    studentId: "ROLL-42",
    name: "Student Example",
    email: "student@example.test",
    phone: "+919876543210",
    organizationId: "alpha",
    branchName: "Computer Science",
    branchCode: "CSE",
  });
  assert.match(document.body.textContent, /Pending approval/);
  assert.match(document.body.textContent, /temporary password/);
});

test("changing the college clears the branch and code until a branch from the new college is chosen", async () => {
  const beta = deferred();
  await mount((id) =>
    id === "beta" ? beta.promise : response(200, alphaBranches),
  );
  await chooseAlpha();
  await select("registration-organizationId", "Beta College");
  assert.equal(branchCode().value, "");
  assert.equal(branchControl().disabled, true);
  assert.equal(submitButton().disabled, true);
  assert.doesNotMatch(branchControl().textContent, /Computer Science/);
  await act(async () => beta.resolve(response(200, betaBranches)));
  await waitFor(() => !branchControl().disabled);
  assert.equal(submitButton().disabled, true);
  await select("registration-branchName", "Mechanical Engineering");
  assert.equal(branchCode().value, "ME");
});

test("late results for the previous college never replace the currently selected college's branches", async () => {
  const alpha = deferred();
  await mount((id) =>
    id === "alpha" ? alpha.promise : response(200, betaBranches),
  );
  await select("registration-organizationId", "Alpha College");
  await waitFor(() =>
    requests.some((request) => request.url.includes("alpha/branches")),
  );
  await select("registration-organizationId", "Beta College");
  await waitFor(() => !branchControl().disabled);
  await act(async () => alpha.resolve(response(200, alphaBranches)));
  await select("registration-branchName", "Mechanical Engineering");
  assert.equal(branchCode().value, "ME");
  assert.equal(branchControl().textContent, "Mechanical Engineering");
});

test("an organization without branches cannot be submitted and explains who to contact", async () => {
  await mount(() => response(200, []));
  await select("registration-organizationId", "Alpha College");
  await waitFor(() =>
    document.body.textContent.includes("No branches have been set up"),
  );
  assert.equal(branchControl().disabled, true);
  assert.equal(submitButton().disabled, true);
  assert.match(
    document.body.textContent,
    /Contact your placement team before registering/,
  );
});

test("branch loading errors offer retry, retain other details and prevent registration until selection", async () => {
  let fail = true;
  await mount(() =>
    fail
      ? response(503, { message: "Unavailable" })
      : response(200, alphaBranches),
  );
  await type("registration-name", "Student Example");
  await select("registration-organizationId", "Alpha College");
  await waitFor(() =>
    document.body.textContent.includes("We could not load branches"),
  );
  assert.equal(submitButton().disabled, true);
  assert.equal(branchControl().disabled, true);
  fail = false;
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry loading branches")
      .click(),
  );
  await waitFor(() => !branchControl().disabled);
  assert.equal(
    document.getElementById("registration-name").value,
    "Student Example",
  );
  assert.equal(submitButton().disabled, true);
  await select("registration-branchName", "Computer Science");
  assert.equal(submitButton().disabled, false);
  assert.doesNotMatch(document.body.textContent, /We could not load branches/);
});

test("a malformed cross-organization branch response cannot populate the dropdown", async () => {
  await mount(() => response(200, betaBranches));
  await select("registration-organizationId", "Alpha College");
  await waitFor(() =>
    document.body.textContent.includes("No branches have been set up"),
  );
  assert.equal(branchControl().disabled, true);
  assert.equal(branchCode().value, "");
  assert.equal(submitButton().disabled, true);
});
