// Run: node --test tests/course-admin-catalog.test.mjs
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://admin.example.test/inbox" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent", "File"])
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL(`../.course-admin-catalog-${process.pid}.mjs`, import.meta.url);
await build({
  stdin: { contents: 'export * from "./apps/platform-admin/src/course-cover.tsx"; export * from "./apps/platform-admin/src/enrollment-inbox.tsx";', resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  outfile: fileURLToPath(bundle), bundle: true, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  external: ["react", "react/*", "react-dom", "react-dom/*", "react-router-dom", "@tanstack/react-query", "better-auth/*", "react-markdown", "remark-gfm"],
  plugins: [{ name: "omit-unrelated-rich-text", setup(context) {
    context.onResolve({ filter: /^\.\/rich-text-editor$/ }, () => ({ path: "rich-text-editor", namespace: "test-rich-text" }));
    context.onLoad({ filter: /.*/, namespace: "test-rich-text" }, () => ({ contents: "export function RichTextEditor() { return null; }", loader: "js" }));
  } }],
});
const { CourseCoverField, courseCoverValidation, EnrollmentInbox } = await import(bundle.href);
const { createElement: h, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router-dom");
const originalFetch = globalThis.fetch, originalXHR = globalThis.XMLHttpRequest;
let root, client, cover;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; client?.clear(); globalThis.fetch = originalFetch; globalThis.XMLHttpRequest = originalXHR; });
after(async () => { await rm(bundle, { force: true }); dom.window.close(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
const button = text => [...document.querySelectorAll("button")].find(item => item.textContent.trim() === text);
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function mount(component) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, null, component))));
  await settle();
}
async function mountCover({ value = "", uploadId = null, readOnly = false, onPending = () => {} } = {}) {
  function Harness() {
    const [url, setUrl] = useState(value), [id, setId] = useState(uploadId);
    cover = { url, id };
    return h(CourseCoverField, { value: url, uploadId: id, onChange: setUrl, onUploadChange: setId, onPending, readOnly });
  }
  await mount(h(Harness));
}
async function change(input, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function uploadFile() {
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["image content"], "cover.webp", { type: "image/webp" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  return input;
}

test("course cover links are optional but reject insecure links and embedded credentials", () => {
  for (const url of ["", "   ", "https://images.example.test/cover.jpg", " https://images.example.test/cover.jpg "]) assert.equal(courseCoverValidation(url), null);
  for (const url of ["http://images.example.test/c.png", "javascript:alert(1)", "data:image/png;base64,abc", "https://name:password@example.test/c.png", "not a URL"]) assert.match(courseCoverValidation(url), /HTTPS/);
});

test("cover editing makes no preview requests and supports replacing or removing an uploaded image", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("The cover editor should not request a preview"); };
  await mountCover({ uploadId: "cover-1" });
  assert.equal(requests, 0);
  assert.equal(document.querySelector("figure"), null);
  assert.doesNotMatch(document.body.textContent, /STUDENT CARD PREVIEW|Retry image preview/);
  assert.match(document.body.textContent, /Uploaded cover image/);
  await change(document.querySelector('input[type="url"]'), "https://images.example.test/updated.jpg");
  assert.deepEqual(cover, { id: null, url: "https://images.example.test/updated.jpg" });
  await act(async () => button("Remove cover image").click());
  assert.deepEqual(cover, { id: null, url: "" });
  assert.equal(requests, 0);
});

test("a failed upload preserves the previous cover and releases form locking", async () => {
  let rejectUpload;
  const pending = [];
  globalThis.fetch = () => new Promise((_resolve, reject) => { rejectUpload = reject; });
  await mountCover({ value: "https://images.example.test/old.jpg", onPending: value => pending.push(value) });
  const file = await uploadFile();
  assert.equal(pending.at(-1), true);
  assert.equal(file.disabled, true);
  assert.equal(document.querySelector('input[type="url"]').disabled, true);
  await act(async () => rejectUpload(new Error("offline")));
  assert.equal(pending.at(-1), false);
  assert.equal(file.disabled, false);
  assert.equal(cover.url, "https://images.example.test/old.jpg");
  assert.match(document.querySelector('[role="alert"]').textContent, /connect|retry/i);
});

test("a completed cover upload uses the cover purpose and replaces the URL without downloading a preview", async () => {
  const writes = [];
  const reads = [];
  globalThis.XMLHttpRequest = class { upload = {}; status = 200; open() {} setRequestHeader() {} send() { queueMicrotask(() => this.onload()); } };
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith("/lesson-uploads")) { writes.push(JSON.parse(options.body)); return response({ upload: { id: "cover-2" }, uploadUrl: "https://storage.example.test/upload", headers: {} }); }
    if (url.endsWith("/complete")) return response({ id: "cover-2", fileName: "cover.webp" });
    reads.push(url);
    throw new Error(`Unexpected request ${url}`);
  };
  await mountCover({ value: "https://images.example.test/old.jpg" });
  await uploadFile();
  await settle();
  assert.equal(writes[0].purpose, "course_cover");
  assert.equal(writes[0].contentType, "image/webp");
  assert.deepEqual(cover, { url: "", id: "cover-2" });
  assert.equal(document.querySelector("figure"), null);
  assert.match(document.body.textContent, /cover\.webp/);
  assert.deepEqual(reads, []);
});

test("a cover above the old 5 MB limit uploads only compressed bytes and matching metadata", async () => {
  const prototype = dom.window.HTMLCanvasElement.prototype;
  const originalContext = prototype.getContext, originalBlob = prototype.toBlob;
  const originalBitmap = globalThis.createImageBitmap;
  let metadata, uploaded, closed = false;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 2000, close() { closed = true; } });
  prototype.getContext = () => ({ clearRect() {}, drawImage() {} });
  prototype.toBlob = function(callback, type) { callback(new dom.window.Blob([new Uint8Array(500000)], { type })); };
  globalThis.XMLHttpRequest = class { upload = {}; status = 200; open() {} setRequestHeader() {} send(file) { uploaded = file; queueMicrotask(() => this.onload()); } };
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/lesson-uploads')) { metadata = JSON.parse(options.body); return response({ upload: { id: 'compressed' }, uploadUrl: 'https://storage.example.test/upload', headers: {} }); }
    if (url.endsWith('/complete')) return response({ id: 'compressed', fileName: 'large.webp' });
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await mountCover();
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(6 * 1024 * 1024)], 'large.png', { type: 'image/png' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await settle();
    assert.equal(metadata.size, 500000); assert.equal(metadata.contentType, 'image/webp'); assert.equal(metadata.fileName, 'large.webp');
    assert.equal(uploaded.size, metadata.size); assert.equal(uploaded.type, metadata.contentType); assert.equal(closed, true);
    assert.deepEqual(cover, { url: '', id: 'compressed' });
  } finally { prototype.getContext = originalContext; prototype.toBlob = originalBlob; globalThis.createImageBitmap = originalBitmap; }
});

const originalRequest = () => ({ id: "request-1", studentMemberId: "student-1", studentName: "Asha Rao", studentEmail: "asha@example.test", studentId: "CSE-101", organizationId: "org-1", organizationName: "Example College", branchName: "Computer Science", branchCode: "CSE", courseId: "course-1", courseTitle: "Advanced Algorithms", status: "pending", createdAt: "2026-10-21T05:00:00Z", readAt: null, reviewedAt: null, emailStatus: "accepted", enrolled: false });
function inboxMock({ failPatch = false } = {}) {
  let request = originalRequest();
  const reads = [], writes = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url, "https://admin.example.test");
    if (target.pathname.endsWith("/organizations")) return response([{ id: "org-1", name: "Example College", status: "active" }]);
    if (options.method === "PATCH") {
      writes.push({ path: target.pathname, body: JSON.parse(options.body) });
      if (failPatch) return response({ message: "Could not update this request. Please retry." }, 500);
      const body = writes.at(-1).body;
      request = { ...request, ...(body.read ? { readAt: "2026-10-21T06:00:00Z" } : {}), ...(body.status ? { status: body.status } : {}) };
      return response(request);
    }
    if (target.pathname.endsWith("/enrollment-requests")) {
      reads.push(Object.fromEntries(target.searchParams));
      const matches = !(target.searchParams.get("unread") === "1" && request.readAt) && (!target.searchParams.get("status") || request.status === target.searchParams.get("status"));
      return response({ items: matches ? [request] : [], unreadCount: request.readAt ? 0 : 1, total: matches ? 1 : 0, page: Number(target.searchParams.get("page") || 1), pageSize: 12 });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return { reads, writes };
}

test("opening an unread request keeps its detail visible and reviewing it never grants course access", async () => {
  const requests = inboxMock();
  await mount(h(EnrollmentInbox));
  await act(async () => [...document.querySelectorAll(".enrollment-folder-tabs button")].find(item => item.textContent.startsWith("Unread")).click());
  await settle();
  await act(async () => document.querySelector(".enrollment-request-item").click());
  await settle();
  assert.ok(document.querySelector('[aria-label="Enrollment request from Asha Rao"]'));
  assert.match(document.body.textContent, /No more requests in this view/);
  const access = [...document.querySelectorAll("a")].find(item => item.textContent.includes("Manage student access"));
  assert.equal(access.getAttribute("href"), "/access?organizationId=org-1&studentId=student-1");
  await act(async () => button("Mark reviewed").click());
  await settle();
  assert.match(document.body.textContent, /Request marked as reviewed/);
  assert.deepEqual(requests.writes.map(item => item.body), [{ read: true }, { read: true, status: "reviewed" }]);
  assert.ok(requests.writes.every(item => item.path === "/api/v1/platform/enrollment-requests/request-1"));
  assert.match(document.body.textContent, /does not enroll/);
});

test("inbox filters are sent to the server and changing scope clears the selected request", async () => {
  const requests = inboxMock();
  await mount(h(EnrollmentInbox));
  await act(async () => document.querySelector(".enrollment-request-item").click());
  await settle();
  const select = document.querySelector('[aria-label="Inbox organization"]').closest(".admin-select").querySelector("select");
  await act(async () => { select.value = "org-1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
  assert.equal(requests.reads.at(-1).organizationId, "org-1");
  assert.equal(document.querySelector('[aria-label="Enrollment request from Asha Rao"]'), null);
  await act(async () => button("Pending review").click());
  await settle();
  assert.equal(requests.reads.at(-1).status, "pending");
  await change(document.querySelector('[aria-label="Search enrollment requests"]'), "Asha");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  await settle();
  assert.equal(requests.reads.at(-1).q, "Asha");
  assert.equal(requests.reads.at(-1).page, "1");
});

test("inbox update errors remain visible without pretending the request was reviewed", async () => {
  inboxMock({ failPatch: true });
  await mount(h(EnrollmentInbox));
  await act(async () => document.querySelector(".enrollment-request-item").click());
  await settle();
  assert.match(document.querySelector('[role="alert"]').textContent, /Could not update/);
  assert.ok(button("Mark reviewed"));
  assert.match(document.querySelector(".enrollment-detail-status").textContent, /Pending review/);
});
