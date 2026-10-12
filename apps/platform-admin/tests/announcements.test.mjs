// Component interactions use mock HTTP responses and a lightweight editor input;
// shared rich-text formatting is covered separately by rich-text-formatting.test.mjs.
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='root'></div>", { url: "https://admin.example.test/announcements" });
for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent", "MutationObserver"])
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const bundle = new URL(`../.announcement-tests-${process.pid}.mjs`, import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL("../src/announcements.tsx", import.meta.url))],
  outfile: fileURLToPath(bundle), bundle: true, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  external: ["react", "react/*", "react-dom", "react-dom/*", "react-router-dom", "@tanstack/react-query", "better-auth/*", "react-markdown", "remark-gfm"],
  plugins: [{ name: "editor-input", setup(build) { build.onLoad({ filter: /[/\\]rich-text-editor\.tsx$/ }, () => ({ contents: 'import { createElement } from "react"; export function RichTextEditor({ label, value, onChange, disabled }) { return createElement("textarea", { "aria-label": label, value, disabled, onChange: event => onChange(event.target.value) }); }', loader: "js" })); } }],
});
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Announcements } = await import(bundle.href);
const orgs = [{ id: "org-a", name: "Alpha College", status: "active" }, { id: "org-b", name: "Beta College", status: "active" }, { id: "org-c", name: "Closed College", status: "archived" }];
const originalFetch = globalThis.fetch;
let root, client, requests;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function announcement(input = {}) { return { id: "announcement-1", clientId: "client-1", organizationId: "org-a", organizationName: "Alpha College", branchCode: null, branchName: null, title: "Orientation", body: "Welcome students", format: "markdown", date: "2026-10-12T10:00:00Z", from: "Admin", status: "published", ...input }; }
async function mount(handler = () => undefined, id = "org-a") {
  requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    const override = await handler(request);
    if (override) return override;
    const parsed = new URL(request.url, "https://admin.example.test");
    if (parsed.pathname.endsWith("/organizations")) return json(orgs);
    const org = orgs.find(item => item.id === parsed.searchParams.get("organizationId")) ?? orgs[0];
    if (parsed.pathname.endsWith("/audience")) return json({ organizationId: org.id, organizationName: org.name, status: org.status, studentCount: 25, branches: [{ code: org.id === "org-b" ? "MECH" : "CSE", name: org.id === "org-b" ? "Mechanical Engineering" : "Computer Science", studentCount: 12 }] });
    if (request.method === "POST") return json(announcement(request.body));
    return json({ items: [], total: 0, page: 1, pageSize: 20 });
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  root = createRoot(document.querySelector("#root"));
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: [`/announcements?organizationId=${id}`] }, h(Announcements)))));
  await waitFor(() => document.querySelector('[aria-label="Announcement message"]'));
}
async function waitFor(check) { for (let i = 0; i < 100; i++) { if (check()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.fail(document.body.textContent); }
function button(text) { return [...document.querySelectorAll("button")].find(item => item.textContent.trim() === text); }
async function click(element) { assert.ok(element); await act(async () => element.click()); }
async function input(element, value) { assert.ok(element); await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function choose(label, option) { await click(document.querySelector(`button[aria-label="${label}"]`)); await click([...document.querySelectorAll('[role="option"]')].find(item => item.textContent.trim() === option)); }
async function fill() { await input(document.querySelector('input[maxlength="150"]'), "Orientation"); await input(document.querySelector('[aria-label="Announcement message"]'), "# Welcome\n\nPlacement orientation is tomorrow."); }
afterEach(async () => { await act(async () => { root?.unmount(); client?.clear(); }); globalThis.fetch = originalFetch; root = undefined; client = undefined; });
after(async () => { dom.window.close(); await rm(bundle, { force: true }); });

test("defaults to the entire selected organization and sends a null branch", async () => {
  await mount(); await fill();
  assert.match(document.querySelector('.announcement-audience-count').textContent, /25 active students/);
  await click(button("Publish announcement"));
  await waitFor(() => requests.some(item => item.method === "POST"));
  const post = requests.find(item => item.method === "POST");
  assert.equal(post.body.organizationId, "org-a"); assert.equal(post.body.branchCode, null); assert.equal(post.body.format, "markdown"); assert.match(post.body.clientId, /^[0-9a-f-]{36}$/);
});
test("choosing a branch updates the audience and publishes only that branch", async () => {
  await mount(); await fill(); await choose("Announcement branch", "Computer Science (CSE)");
  assert.match(document.querySelector('.announcement-audience-count').textContent, /12 active students/);
  await click(button("Publish announcement")); await waitFor(() => requests.some(item => item.method === "POST"));
  assert.equal(requests.find(item => item.method === "POST").body.branchCode, "CSE");
});
test("organization switching retains its own draft and never carries a stale branch", async () => {
  await mount(); await fill(); await choose("Announcement branch", "Computer Science (CSE)"); await choose("Organization", "Beta College");
  await waitFor(() => document.querySelector('.announcement-audience-heading')?.textContent.includes("Beta College"));
  assert.equal(document.querySelector('input[maxlength="150"]').value, "");
  assert.match(document.querySelector('button[aria-label="Announcement branch"]').textContent, /All branches/);
  await choose("Organization", "Alpha College"); await waitFor(() => document.querySelector('.announcement-audience-heading')?.textContent.includes("Alpha College"));
  assert.equal(document.querySelector('input[maxlength="150"]').value, "Orientation");
  assert.match(document.querySelector('button[aria-label="Announcement branch"]').textContent, /All branches/);
});
test("failed publication keeps inputs and reuses the idempotency key on retry", async () => {
  await mount(request => request.method === "POST" ? json({ message: "Please retry the request." }, 503) : undefined); await fill();
  await click(button("Publish announcement")); await waitFor(() => document.querySelector('[role="alert"]'));
  assert.equal(document.querySelector('input[maxlength="150"]').value, "Orientation");
  await click(button("Publish announcement")); await waitFor(() => requests.filter(item => item.method === "POST").length === 2);
  const posts = requests.filter(item => item.method === "POST"); assert.equal(posts[0].body.clientId, posts[1].body.clientId);
});
test("messages over 10,000 characters cannot be published", async () => {
  await mount(); await fill(); await input(document.querySelector('[aria-label="Announcement message"]'), "x".repeat(10_001));
  assert.equal(button("Publish announcement").disabled, true); assert.equal(requests.filter(item => item.method === "POST").length, 0);
});
test("archived organizations cannot publish", async () => {
  await mount(undefined, "org-c"); assert.equal(document.querySelector('fieldset').disabled, true); assert.equal(button("Publish announcement").disabled, true);
  assert.match(document.body.textContent, /Restore it before publishing/);
});
test("preview renders Markdown with its selected audience", async () => {
  await mount(); await fill(); await choose("Announcement branch", "Computer Science (CSE)"); await click(button("Preview announcement"));
  assert.equal(document.querySelector('#announcement-preview h1').textContent, "Welcome"); assert.match(document.querySelector('.announcement-preview-audience').textContent, /Computer Science/);
});
test("archiving is a status update to the selected announcement", async () => {
  await mount(request => request.method === "GET" && request.url.includes("/announcements?") ? json({ items: [announcement()], total: 1, page: 1, pageSize: 20 }) : request.method === "PATCH" ? json(announcement({ status: "archived" })) : undefined);
  await click(document.querySelector('button[aria-label="Archive Orientation"]')); await waitFor(() => requests.some(item => item.method === "PATCH"));
  const patch = requests.find(item => item.method === "PATCH"); assert.equal(patch.url, "/api/v1/platform/announcements/announcement-1"); assert.deepEqual(patch.body, { status: "archived" });
});
