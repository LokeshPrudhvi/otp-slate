import assert from "node:assert/strict";
import { test, after, afterEach } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://student.example.test",
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
const outfile = new URL(
  `../.student-sections-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  stdin: {
    contents:
      'export {SelfAssessment,learningProgress} from "./apps/student/src/self-assessment"; export {JobCards} from "./apps/student/src/job-cards"; export {CareerOpportunities,CertificationsPage,PyqPage} from "./apps/student/src/career"; export {MailboxPage} from "./apps/student/src/mailbox"; export {LiveExamsPage} from "./apps/student/src/live-exams";',
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  outfile: fileURLToPath(outfile),
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: [
    "react",
    "react/*",
    "react-dom/*",
    "react-router-dom",
    "@tanstack/react-query",
  ],
  plugins: [
    {
      name: "sections",
      setup(ctx) {
        ctx.onResolve(
          { filter: /^(@slate\/ui|\.\/access|\.\/design)$/ },
          ({ path }) => ({ path, namespace: "boundary" }),
        );
        ctx.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({
          loader: "jsx",
          resolveDir: process.cwd(),
          contents:
            path === "@slate/ui"
              ? `import React from 'react';export const api=(...args)=>globalThis.__sectionApi(...args);export const useMe=()=>({data:globalThis.__sectionIdentity});export const LessonContent=()=>null;export const QuestionImageView=()=>null;export function Select({value,onChange,options,...props}){return <select aria-label={props['aria-label']} value={value} onChange={e=>onChange(e.target.value)}><option value="">Choose</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}`
              : path === "./access"
                ? `import {useQuery} from '@tanstack/react-query';export const hasAccess=(i,f)=>!!i?.features.includes(f);export const hasCodingAccess=i=>hasAccess(i,'practice')&&hasAccess(i,'compiler');export function useStudentData(key,path,enabled=true){return useQuery({queryKey:['student',key],queryFn:()=>globalThis.__sectionApi(path),enabled})}`
                : `import React from 'react';export function Heading({title,children}){return <header><h1>{title}</h1>{children}</header>}export function Status({pending,error}){return error?<p role="alert">{error.message}</p>:pending?<p role="status">Loading</p>:null}export function NoResults({title,children}){return <section><h2>{title}</h2>{children}</section>}`,
        }));
      },
    },
  ],
});
const views = await import(outfile.href),
  { createElement: h, act } = await import("react"),
  { createRoot } = await import("react-dom/client"),
  { MemoryRouter } = await import("react-router-dom"),
  { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
let root, query;
let calls = [];
let handler;
globalThis.__sectionIdentity = {
  id: "student",
  features: ["jobs", "resume", "pyq"],
};
globalThis.__sectionApi = async (...args) => {
  calls.push(args);
  return handler(...args);
};
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 8));
  });
}
async function mount(component, route = "/") {
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
        h(MemoryRouter, { initialEntries: [route] }, component),
      ),
    ),
  );
  await settle();
}
async function click(el) {
  assert.ok(el);
  await act(async () => el.click());
  await settle();
}
function button(text) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === text,
  );
}
async function fill(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? dom.window.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
  await settle();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  query?.clear();
  calls = [];
  localStorage.clear();
  globalThis.__sectionIdentity.id = "student";
  globalThis.__sectionIdentity.features = ["jobs", "resume", "pyq"];
});
after(async () => {
  await rm(outfile, { force: true });
  dom.window.close();
});
const exam = (id, state, extra = {}) => ({
  id,
  state,
  title: id,
  description: "Exam details",
  startsAt: "2026-10-25T09:00:00Z",
  endsAt: "2026-10-25T10:00:00Z",
  durationMinutes: 30,
  questionCount: 2,
  totalPoints: 20,
  attemptId: null,
  attemptStatus: null,
  resultsReleased: false,
  percentage: null,
  ...extra,
});
test("exam library exposes only Live, Upcoming and Results; upcoming and ended actions are disabled", async () => {
  handler = () => [
    exam("Live exam", "live"),
    exam("Future exam", "upcoming"),
    exam("Missed exam", "ended"),
    exam("Finished exam", "ended", {
      attemptId: "attempt",
      attemptStatus: "graded",
      resultsReleased: true,
      percentage: 85,
    }),
  ];
  await mount(h(views.LiveExamsPage));
  assert.deepEqual(
    [...document.querySelectorAll('[aria-label="Exam status"] button')].map(
      (e) => e.textContent,
    ),
    ["Live", "Upcoming", "Results"],
  );
  assert.equal(document.querySelectorAll(".exam-catalog-card").length, 1);
  assert.ok(document.querySelector('a[href="/live-exams/Live exam"]'));
  await click(button("Upcoming"));
  assert.equal(button("View exam →").disabled, true);
  assert.equal(document.querySelector(".exam-catalog-card a"), null);
  await click(button("Results"));
  assert.equal(document.querySelectorAll(".exam-catalog-card").length, 2);
  assert.equal(button("View exam →").disabled, true);
  assert.ok(document.querySelector('a[href="/live-exams/Finished exam"]'));
});
test("career tabs include jobs, certifications and resume with independent resume permission", async () => {
  handler = () => [];
  await mount(
    h(views.CareerOpportunities, { children: h("p", null, "Content") }),
    "/career-opportunities/resume",
  );
  const tabs = document.querySelector('[aria-label="Careers"]');
  assert.equal(tabs.querySelectorAll("a").length, 3);
  assert.equal(
    tabs.querySelector('[aria-current="page"]').textContent,
    "Resume builder",
  );
  globalThis.__sectionIdentity.features = ["jobs"];
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client: query },
        h(MemoryRouter, null, h(views.CareerOpportunities, { children: null })),
      ),
    ),
  );
  assert.equal(
    document.querySelector('a[href="/career-opportunities/resume"]'),
    null,
  );
});
test("company cards open hiring procedure, paper links and practice explanations", async () => {
  handler = () => [
    {
      id: "company",
      title: "Acme",
      description: "Prepare for Acme",
      logoUrl: "https://example.com/logo.png",
      hiringProcedure: "Screening, interview",
      papers: [{ title: "Model paper", url: "https://example.com/paper" }],
      practiceQuestions: [
        { question: "Find a repeated value", answer: "Use a set" },
      ],
    },
  ];
  await mount(h(views.PyqPage));
  assert.equal(document.querySelector(".company-card img").alt, "Acme logo");
  await click(document.querySelector(".company-card"));
  assert.match(
    document.querySelector(".company-training").textContent,
    /Screening, interview/,
  );
  await click(
    [...document.querySelectorAll(".pyq-section-tabs button")].find((el) =>
      el.textContent.includes("Question papers"),
    ),
  );
  assert.equal(
    document.querySelector(".company-paper").href,
    "https://example.com/paper",
  );
  await click(
    [...document.querySelectorAll(".pyq-section-tabs button")].find((el) =>
      el.textContent.includes("Practice questions"),
    ),
  );
  assert.match(document.querySelector("details").textContent, /Use a set/);
  assert.ok(
    document.querySelector('textarea[aria-label="Your answer to question 1"]'),
  );
  await click(document.querySelector(".pyq-back"));
  assert.ok(document.querySelector(".company-card"));
});
test("company training opens a shared paper-tab URL directly and handles unavailable guides", async () => {
  handler = () => [
    {
      id: "guide",
      title: "Sample Company",
      description: "Mock guide",
      logoUrl: "",
      hiringProcedure: "Sample stages",
      papers: [
        {
          title: "Sample model paper",
          url: "/api/v1/placement-samples/northstar-tech-model-paper.pdf",
        },
      ],
      practiceQuestions: [],
    },
  ];
  await mount(h(views.PyqPage), "/pyq?company=guide&section=papers");
  assert.equal(
    document.querySelector(".pyq-section-tabs button[aria-current]")
      .textContent,
    "▤Question papers1",
  );
  assert.match(
    document.querySelector(".company-paper").href,
    /placement-samples\/northstar-tech-model-paper.pdf$/,
  );
  await click(document.querySelector(".pyq-back"));
  assert.ok(document.querySelector(".company-card"));
});
const fullMessage = {
  id: "message",
  subject: "Placement orientation",
  body: "Full content ".repeat(45) + "Final instruction at the end",
  sender: { id: "sender", name: "Placement team", email: "team@example.com" },
  recipients: [{ id: "student", name: "Student" }],
  sentAt: "2026-10-25T10:00:00Z",
  incoming: true,
  readAt: null,
  starred: false,
  archivedAt: null,
  broadcast: false,
};
test("mailbox uses a preview list and fetches the full message in the reading pane", async () => {
  handler = (path, method) =>
    path.startsWith("mailbox?")
      ? {
          items: [{ ...fullMessage, body: fullMessage.body.slice(0, 180) }],
          total: 1,
          page: 1,
          pageSize: 20,
          unreadCount: 1,
        }
      : method === "PATCH"
        ? {}
        : fullMessage;
  await mount(h(views.MailboxPage));
  assert.ok(
    !document
      .querySelector(".mailbox-list")
      .textContent.includes("Final instruction"),
  );
  await click(document.querySelector(".mailbox-preview"));
  assert.match(
    document.querySelector(".mailbox-message-body").textContent,
    /Final instruction at the end/,
  );
  assert.ok(
    calls.some(
      ([path, method, value]) =>
        path === "mailbox/message" && method === "PATCH" && value.read === true,
    ),
  );
});
test("mailbox compose sends selected organization contact and full content through messaging API", async () => {
  handler = (path, method) =>
    path === "mailbox/contacts"
      ? [{ id: "contact", name: "Aarav", email: "aarav@example.com" }]
      : method === "POST"
        ? { id: "sent" }
        : { items: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 };
  await mount(h(views.MailboxPage));
  await click(button("＋ Compose"));
  await fill(
    document.querySelector('[aria-label="Message recipient"]'),
    "contact",
  );
  await fill(document.querySelector(".mailbox-compose input"), "Meeting");
  await fill(
    document.querySelector(".mailbox-compose textarea"),
    "Join at 10 AM",
  );
  await act(async () =>
    document
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
  await settle();
  const post = calls.find(([p, m]) => p === "mailbox" && m === "POST");
  assert.deepEqual(post[2].recipientIds, ["contact"]);
  assert.equal(post[2].body, "Join at 10 AM");
  assert.equal(post[2].broadcast, false);
  assert.match(document.body.textContent, /Message sent/);
});

const jobFixture = {
  id: "job",
  title: "Graduate software engineer",
  company: "Example Company",
  description: "Build and maintain web applications with our engineering team.",
  postedAt: "2026-10-25T12:00:00Z",
  url: "https://example.test/apply",
  companyLogoUrl: "https://storage.example.test/logo.png",
};
test("job cards show actual posting fields, company logo and original application link", async () => {
  handler = () => [];
  await mount(h(views.JobCards, { jobs: [jobFixture] }));
  assert.equal(
    document.querySelector(".job-opportunity h2").textContent,
    jobFixture.title,
  );
  assert.equal(
    document.querySelector(".job-company-logo img").alt,
    "Example Company logo",
  );
  assert.match(
    document.querySelector(".job-opportunity time").textContent,
    /25 Oct 2026/,
  );
  const link = document.querySelector(".job-opportunity-footer a");
  assert.equal(link.href, jobFixture.url);
  assert.equal(link.target, "_blank");
  assert.match(link.rel, /noopener/);
  assert.match(
    document.querySelector(".job-opportunity-description").textContent,
    /web applications/,
  );
  assert.ok(
    !document.querySelector(".job-opportunity").textContent.includes("$250"),
  );
  await act(async () =>
    document
      .querySelector(".job-company-logo img")
      .dispatchEvent(new Event("error")),
  );
  assert.equal(document.querySelector(".job-company-logo img"), null);
  assert.equal(document.querySelector(".job-company-logo").textContent, "EC");
});
test("job bookmarks filter saved posts and persist separately for each account", async () => {
  handler = () => [];
  const jobs = [
    jobFixture,
    { ...jobFixture, id: "another-job", title: "Application developer" },
  ];
  await mount(h(views.JobCards, { jobs }));
  await click(document.querySelector(".job-save"));
  assert.deepEqual(
    JSON.parse(localStorage.getItem("slate:saved-jobs:student")),
    ["job"],
  );
  await click(document.querySelector(".job-saved-filter"));
  assert.equal(document.querySelectorAll(".job-opportunity").length, 1);
  await act(async () => root.unmount());
  query.clear();
  await mount(h(views.JobCards, { jobs }));
  assert.equal(
    document.querySelector(".job-save").getAttribute("aria-pressed"),
    "true",
  );
  globalThis.__sectionIdentity.id = "another-student";
  await act(async () =>
    root.render(
      h(
        QueryClientProvider,
        { client: query },
        h(MemoryRouter, null, h(views.JobCards, { jobs })),
      ),
    ),
  );
  assert.equal(
    document.querySelector(".job-save").getAttribute("aria-pressed"),
    "false",
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("slate:saved-jobs:student")),
    ["job"],
  );
});

test("Learning Progress requires every assigned CRT topic and counts only solved catalogue problems by difficulty", () => {
  const topics = [
    { id: "q1", subjectId: "quantitative", completed: true },
    { id: "q2", subjectId: "quantitative", completed: false },
    { id: "r1", subjectId: "reasoning", completed: true },
  ];
  const coding = [
    { id: "easy", kind: "coding", difficulty: "Easy" },
    { id: "medium", kind: "coding", difficulty: "Medium" },
    { id: "hard", kind: "coding", difficulty: "Hard" },
  ];
  const progress = views.learningProgress(topics, coding, {
    easy: { status: "Solved" },
    medium: { status: "Attempted" },
    hard: { status: "Solved" },
    removed: { status: "Solved" },
  });
  assert.equal(progress.modules.length, 4);
  assert.equal(progress.completedModules, 1);
  assert.equal(progress.total, 3);
  assert.equal(progress.solved, 2);
    assert.equal(progress.attempting, 1);
  assert.deepEqual(
    progress.difficulties.map((r) => [r.name, r.completed, r.total]),
    [
      ["Easy", 1, 1],
      ["Medium", 0, 1],
      ["Hard", 1, 1],
    ],
  );
  assert.equal(views.learningProgress([], [], null).completedModules, 0);
});

test("Learning Progress displays live CRT completion and browser-local coding counts", async () => {
  globalThis.__sectionIdentity.features = ["crt", "practice", "compiler"];
  localStorage.setItem(
    "slate-demo-coding:student:progress",
    JSON.stringify({ p1: { status: "Solved" } }),
  );
  handler = (path) =>
    path === "student/crt/topics"
      ? [{ id: "q", subjectId: "quantitative", completed: true }]
      : [
          { id: "p1", kind: "coding", difficulty: "Easy" },
          { id: "p2", kind: "coding", difficulty: "Hard" },
        ];
  await mount(h(views.SelfAssessment));
  assert.equal(document.querySelector("h2").textContent, "Learning Progress");
  assert.equal(
    document
      .querySelector('[role="progressbar"]')
      .getAttribute("aria-valuenow"),
    "1",
  );
  assert.match(
    document.querySelector(".learning-complexity-grid").textContent,
    /Easy1 \/ 1/,
  );
  assert.ok(calls.some(([path]) => path === "student/crt/topics"));
  assert.ok(calls.some(([path]) => path === "student/practice"));
  localStorage.setItem('slate-demo-coding:student:progress',JSON.stringify({p1:{status:'Solved'},p2:{status:'Attempted'}}));
  await click(document.querySelector('[aria-label="Refresh programming progress"]'));
  await settle();
  assert.equal(document.querySelector('.programming-gauge-caption b').textContent,'1');
  assert.match(document.querySelector('[aria-label="Solved programming questions"]').getAttribute('aria-valuetext'),/1 of 2 solved, 1 attempting/);

});
