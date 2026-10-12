// Run: TSX_TSCONFIG_PATH=apps/platform-admin/tsconfig.json node --import tsx --test tests/branch-editor.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://admin.example.test/access" });
for (const name of ["window", "document", "navigator", "HTMLElement", "Event"]) Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
globalThis.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { EditBranch } = await import("../apps/platform-admin/src/branch-editor.tsx");
const branch = { organizationId: "org-alpha", code: "CSE/AI", name: "Computer Science" };
const originalFetch = globalThis.fetch;
let root, client, calls, pending, dirty, canceled;
function response(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function button(text) { return [...document.querySelectorAll("button")].find(item => item.textContent === text); }
const nameInput = () => document.querySelector('input[aria-label="Branch name"]');
const codeInput = () => document.querySelector('input[aria-label="Branch code"]');
async function mount({ request = () => response(200, { ...branch, name: "Computer Science and AI", code: "CSAI" }), saved = async () => {}, latest = async () => ({ organization: { id: branch.organizationId, status: "active" }, revision: 9, branches: [branch] }) } = {}) {
  calls = []; pending = false; dirty = false; canceled = 0;
  globalThis.fetch = async (url, options) => { calls.push({ url, method: options.method, body: JSON.parse(options.body) }); return request(); };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(QueryClientProvider, { client }, h(EditBranch, { branch, revision: 4, studentCount: 12, onSaved: saved, loadWorkspace: latest, onPending: value => { pending = value; }, onDirty: value => { dirty = value; }, onCancel: () => { canceled++; } }))));
}
async function type(input, value) { await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); }
async function click(text) { await act(async () => { assert.ok(button(text), `Missing ${text}`); button(text).click(); }); }
async function waitFor(check) { for (let i = 0; i < 100; i++) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 10))); } assert.fail(document.body.textContent); }
afterEach(async () => { await act(async () => { root?.unmount(); client?.clear(); }); globalThis.fetch = originalFetch; root = undefined; client = undefined; });
after(() => dom.window.close());

test("editing is explicit, cancel makes no request, and unchanged details cannot submit", async () => {
  await mount();
  assert.equal(button("Save branch").disabled, true);
  await type(nameInput(), "Changed name");
  assert.equal(dirty, true);
  await click("Cancel");
  assert.equal(canceled, 1); assert.equal(calls.length, 0);
});

test("save canonicalizes name/code and sends original encoded code plus workspace revision", async () => {
  let savedBranch;
  await mount({ saved: async result => { savedBranch = result; } });
  await type(nameInput(), " Computer   Science and AI ");
  await type(codeInput(), " csai ");
  await click("Save branch");
  await waitFor(() => savedBranch);
  assert.equal(calls[0].url, "/api/v1/platform/organizations/org-alpha/branches/CSE%2FAI");
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(calls[0].body, { name: "Computer Science and AI", code: "CSAI", revision: 4 });
  assert.equal(savedBranch.code, "CSAI");
});

test("successful save followed by failed refresh blocks stale access and retries refresh without another PATCH", async () => {
  let refreshCalls = 0;
  await mount({ saved: async () => { refreshCalls++; if (refreshCalls === 1) throw new Error("Network unavailable"); } });
  await type(codeInput(), "CSAI");
  await click("Save branch");
  await waitFor(() => button("Retry loading access") && !button("Retry loading access").disabled);
  assert.equal(pending, true, "parent navigation/access must stay locked until refreshed");
  assert.equal(nameInput().closest("fieldset").disabled, true);
  assert.equal(button("Cancel"), undefined);
  assert.match(document.body.textContent, /Branch saved/);
  await click("Retry loading access");
  await waitFor(() => refreshCalls === 2);
  assert.equal(calls.length, 1);
});

test("stale revision preserves draft, requires review, and retries with latest revision", async () => {
  let requestCount = 0;
  await mount({ request: () => ++requestCount === 1 ? response(409, { message: "This organization changed in another session. Reload the branch before saving." }) : response(200, { ...branch, name: "My new branch name" }) });
  await type(nameInput(), "My new branch name");
  await click("Save branch");
  await waitFor(() => button("Review latest branch"));
  assert.equal(nameInput().value, "My new branch name");
  assert.equal(button("Save branch").disabled, true);
  await click("Review latest branch");
  await waitFor(() => !button("Save branch").disabled);
  assert.equal(nameInput().value, "My new branch name");
  await click("Save branch");
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.revision, 9);
});

test("a branch renamed elsewhere cannot be overwritten by stale draft", async () => {
  await mount({ request: () => response(409, { message: "This branch has changed or is no longer available. Reload the branch list." }), latest: async () => ({ organization: { status: "active" }, revision: 9, branches: [{ ...branch, code: "NEW" }] }) });
  await type(nameInput(), "Preserve this draft"); await click("Save branch");
  await waitFor(() => button("Review latest branch")); await click("Review latest branch");
  await waitFor(() => document.body.textContent.includes("code changed elsewhere"));
  assert.equal(nameInput().value, "Preserve this draft"); assert.equal(button("Save branch").disabled, true); assert.equal(calls.length, 1);
});

test("invalid branch code fails locally without changing any record", async () => {
  await mount(); await type(codeInput(), "INVALID?"); await click("Save branch");
  assert.match(document.body.textContent, /starting with a letter or number/); assert.equal(calls.length, 0);
});


test("duplicate branch conflict can be corrected and resubmitted without reloading", async () => {
  let requestCount = 0, reloads = 0;
  await mount({ request: () => ++requestCount === 1 ? response(409, { message: "A branch with this name or code already exists in this organization." }) : response(200, { ...branch, code: "UNIQUE" }), latest: async () => { reloads++; throw new Error("No reload should be needed"); } });
  await type(codeInput(), "TAKEN"); await click("Save branch");
  await waitFor(() => document.body.textContent.includes("already exists"));
  assert.equal(button("Review latest branch"), undefined);
  await type(codeInput(), "UNIQUE");
  assert.equal(button("Save branch").disabled, false);
  await click("Save branch"); await waitFor(() => calls.length === 2);
  assert.equal(reloads, 0); assert.equal(calls[1].body.code, "UNIQUE"); assert.equal(calls[1].body.revision, 4);
});
