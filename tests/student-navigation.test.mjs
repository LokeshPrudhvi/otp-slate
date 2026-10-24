// Run: node --test tests/student-navigation.test.mjs
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
  "sessionStorage",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
dom.window.HTMLElement.prototype.scrollTo = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bundle = new URL(
  `../.student-navigation-tests-${process.pid}.mjs`,
  import.meta.url,
);
const leafExports = {
  "./auth": ["StudentLogin", "StudentOnboarding", "StudentResetPassword"],
  "./registration": ["StudentRegistration"],
  "./resume": ["ResumePage"],
  "./coding": ["CodingLibrary", "CodingProblemPage"],
  "./compiler": ["CompilerPage"],
  "./crt": ["CrtPage"],
  "./self-assessment": ["SelfAssessment"],
  "./lessons": ["StudentLessonActivity"],
  "./live-exams": [
    "LiveExamsPage",
    "LiveExamDetailPage",
    "LiveExamAttemptPage",
  ],
  "./announcements": ["AnnouncementsPage"],
};
await build({
  entryPoints: [
    fileURLToPath(new URL("../apps/student/src/routes.tsx", import.meta.url)),
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
  ],
  plugins: [
    {
      name: "student-navigation-boundaries",
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          path === "@slate/ui" || leafExports[path]
            ? { path, namespace: "test-navigation" }
            : undefined,
        );
        context.onLoad(
          { filter: /.*/, namespace: "test-navigation" },
          ({ path }) => ({
            loader: "jsx",
            resolveDir: fileURLToPath(new URL("../", import.meta.url)),
            contents:
              path === "@slate/ui"
                ? `
          import React from "react";
          import { Outlet } from "react-router-dom";
          export function Protected() { return <Outlet />; }
          export function useMe() { return { data: globalThis.__studentIdentity }; }
          export function api(...args) { return globalThis.__studentRead(...args); }
          export function Select() { return null; }
          export const authClient = { signOut: async () => ({}) };
        `
                : `import React from "react";\n${leafExports[path]
                    .map(
                      (name) =>
                        `export function ${name}() { return <h1 data-route-view="${name}">${name}</h1>; }`,
                    )
                    .join("\n")}
          ${path === "./lessons" ? 'export const lessonPresentation = { text: { label: "Reading", description: "Read the lesson", icon: "page" } };' : ""}`,
          }),
        );
      },
    },
  ],
});
const { StudentRoutes } = await import(bundle.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");

let root, query;
let reads = [];
let enrolledCourses;
let catalogCourses;
let exams = [];
let examError = false;
let enrollmentError = false;
let examPending = false;
const course = {
  id: "assigned-course",
  title: "Data Structures",
  description: "Study data structures",
  track: "dsa",
  version: 1,
  status: "published",
  lastOpenedAt: null,
  lessons: [
    { id: "reading-1", title: "Arrays", kind: "text", content: "Array basics" },
  ],
  completedLessonIds: [],
};
const availableCourse = {
  ...course,
  id: "available-course",
  title: "Python Foundations",
  description: "Learn Python",
  coverImageUrl: "https://images.example.test/python.jpg",
};
function resetData() {
  enrolledCourses = [structuredClone(course)];
  catalogCourses = [
    {
      ...structuredClone(course),
      enrolled: true,
      enrollmentRequestStatus: null,
    },
    {
      ...structuredClone(availableCourse),
      enrolled: false,
      enrollmentRequestStatus: null,
    },
  ];
  exams = [];
  examError = false;
  examPending = false;
  enrollmentError = false;
}
resetData();
function identity(
  features = ["courses", "crt", "practice", "compiler", "toolkit"],
) {
  return {
    id: "student-a",
    name: "Sample Student",
    email: "student@example.test",
    organizationId: "org-a",
    organizationName: "Example Academy",
    features,
    access: {
      revision: "r1",
      courseIds: enrolledCourses.map((course) => course.id),
      practiceModuleIds: ["competitive-coding"],
      display: {
        portalTitle: "Learning portal",
        welcomeText: "Continue learning",
      },
    },
  };
}
globalThis.__studentRead = async (path, method = "GET") => {
  reads.push({ path, method });
  if (path === "student/courses" && method === "GET")
    return structuredClone(enrolledCourses);
  if (path === "student/course-catalog" && method === "GET")
    return structuredClone(catalogCourses);
  if (path === "student/exams" && method === "GET") {
    if (examPending) return new Promise(() => {});
    if (examError) throw new Error("Exams could not load");
    return structuredClone(exams);
  }
  const detail = enrolledCourses.find(
    (course) => path === `student/courses/${course.id}`,
  );
  if (detail && method === "GET") return structuredClone(detail);
  const opened = enrolledCourses.find(
    (course) => path === `student/courses/${course.id}/opened`,
  );
  if (opened && method === "POST") {
    const lastOpenedAt = new Date().toISOString();
    enrolledCourses = enrolledCourses.map((item) =>
      item.id === opened.id ? { ...item, lastOpenedAt } : item,
    );
    catalogCourses = catalogCourses.map((item) =>
      item.id === opened.id ? { ...item, lastOpenedAt } : item,
    );
    return { lastOpenedAt };
  }
  if (
    path === `student/courses/${availableCourse.id}/enrollment-requests` &&
    method === "POST"
  ) {
    if (enrollmentError)
      throw new Error("Unable to send your request. Please retry.");
    catalogCourses = catalogCourses.map((item) =>
      item.id === availableCourse.id
        ? { ...item, enrollmentRequestStatus: "pending" }
        : item,
    );
    return { id: "request-a", status: "pending", emailStatus: "queued" };
  }
  if (path === "student/practice" && method === "GET") return [];
  throw new Error(`Unexpected request: ${method} ${path}`);
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  query?.clear();
  localStorage.clear();
  sessionStorage.clear();
  reads = [];
  resetData();
});
after(async () => {
  await rm(bundle, { force: true });
  dom.window.close();
});
function Location() {
  const value = useLocation();
  return h(
    "output",
    { "data-location": true, "data-search": value.search },
    value.pathname,
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function mount(url = "/", user = identity()) {
  globalThis.__studentIdentity = user;
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
          h(StudentRoutes),
          h(Location),
        ),
      ),
    ),
  );
  await settle();
}
async function click(element) {
  assert.ok(element, "Expected navigation target");
  await act(async () => element.click());
  await settle();
}
const nav = (name) => document.querySelector(`nav a[aria-label="${name}"]`);
const location = () => document.querySelector("[data-location]").textContent;
const button = (label) =>
  [...document.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === label,
  );
function assertNoRemovedEntry() {
  assert.doesNotMatch(
    document.querySelector(".student-app").textContent,
    /tool\s?kit/i,
  );
  assert.equal(document.querySelectorAll('a[href^="/toolkit"]').length, 0);
}

test("dashboard, navigation and assistant omit removed entry even for a stale identity", async () => {
  await mount();
  assertNoRemovedEntry();
  assert.ok(nav("Courses"));
  assert.ok(nav("CRT"));
  assert.ok(nav("Coding"));
  assert.ok(
    document.querySelector(`main a[href="/courses/${course.id}"]`),
    "Assigned course stays on dashboard",
  );
  assert.equal(
    document.querySelector('main a[href="/crt"]'),
    null,
    "CRT stays in navigation without a dashboard promotion",
  );
  await click(
    document.querySelector(
      'button[aria-label="Chat with Otto, your assistant"]',
    ),
  );
  assertNoRemovedEntry();
  assert.ok(
    document.querySelector('[role="dialog"][aria-label="Chat with Otto"]'),
  );
  await click(button("Solve coding problems →"));
  assert.equal(location(), "/competitive-programming");
  assert.equal(
    nav("Coding").getAttribute("aria-current"),
    "page",
  );
  assert.ok(document.querySelector('[data-route-view="CodingLibrary"]'));
  await click(nav("CRT"));
  assert.equal(location(), "/crt");
  assert.equal(nav("CRT").getAttribute("aria-current"), "page");
  assert.ok(document.querySelector('[data-route-view="CrtPage"]'));
});

for (const obsoletePath of ["/toolkit", "/toolkit/dsa"]) {
  test(`obsolete path ${obsoletePath} is unavailable with no catalogue request`, async () => {
    await mount(obsoletePath);
    assert.match(
      document.querySelector("main").textContent,
      /Page unavailable/,
    );
    assertNoRemovedEntry();
    assert.deepEqual(
      reads,
      [],
      "Shell must not fetch the catalogue to build navigation",
    );
    await click(nav("Dashboard"));
    assert.equal(location(), "/");
    assert.ok(document.querySelector(`main a[href="/courses/${course.id}"]`));
  });
}

test("assigned course and lesson keep Courses active and use course breadcrumbs", async () => {
  await mount(`/courses/${course.id}`);
  assert.equal(nav("Courses").getAttribute("aria-current"), "page");
  assert.equal(document.querySelector("main h1").textContent, course.title);
  assert.deepEqual(
    reads,
    [
      { path: `student/courses/${course.id}`, method: "GET" },
      { path: `student/courses/${course.id}/opened`, method: "POST" },
    ],
    "Course visits record recency without fetching the catalogue for the shell",
  );
  const breadcrumb = document.querySelector('.a-crumbs a[href="/courses"]');
  assert.equal(breadcrumb.textContent, "Courses");
  assertNoRemovedEntry();
  await click(
    document.querySelector(`a[href="/courses/${course.id}/lessons/reading-1"]`),
  );
  assert.equal(document.querySelector("main h1").textContent, "Arrays");
  assert.equal(nav("Courses").getAttribute("aria-current"), "page");
  assert.equal(
    document.querySelector('.a-crumbs a[href="/courses"]').textContent,
    "Courses",
  );
  assertNoRemovedEntry();
  await click(document.querySelector('.a-crumbs a[href="/courses"]'));
  assert.equal(location(), "/courses");
  assert.ok(document.querySelector(`main a[href="/courses/${course.id}"]`));
});

test("removing an entry does not bypass assignment guards or expose other sections", async () => {
  await mount("/courses/unassigned-course", identity(["courses"]));
  assert.match(
    document.querySelector("main").textContent,
    /This section is not assigned to your account/,
  );
  assert.equal(nav("CRT"), null);
  assert.equal(nav("Coding"), null);
  assert.deepEqual(reads, []);
  assertNoRemovedEntry();
});

test("dashboard has every enrolled course in recently opened order and no catalogue-only cards", async () => {
  const recent = {
    ...course,
    id: "recent-course",
    title: "Zebra Programming",
    lastOpenedAt: "2026-10-21T07:00:00.000Z",
  };
  const older = {
    ...course,
    id: "older-course",
    title: "Algorithms",
    lastOpenedAt: "2026-10-20T07:00:00.000Z",
  };
  enrolledCourses = [course, older, recent];
  await mount();
  const titles = [...document.querySelectorAll(".learning-card h3")].map(
    (node) => node.textContent,
  );
  assert.deepEqual(titles, [recent.title, older.title, course.title]);
  assert.equal(
    document.querySelector(`a[href="/courses/${availableCourse.id}"]`),
    null,
  );
  assert.ok(document.querySelector(`a[aria-label="Continue ${recent.title}"]`));
  assert.ok(document.querySelector(`a[aria-label="Open ${course.title}"]`));
  assert.equal(
    reads.filter(({ method }) => method !== "GET").length,
    0,
    "Viewing dashboard must not change recency",
  );
});

for (const scenario of ["empty", "upcoming", "error", "loading"]) {
  test(`dashboard omits live-exam section when ${scenario}`, async () => {
    exams =
      scenario === "upcoming"
        ? [{ id: "exam-a", title: "Next week", state: "upcoming" }]
        : [];
    examError = scenario === "error";
    examPending = scenario === "loading";
    await mount("/", identity(["courses", "crt", "live-exams"]));
    assert.equal(
      document.querySelector('main [aria-label="Live exams"]'),
      null,
    );
    assert.doesNotMatch(
      document.querySelector("main").textContent,
      /No live exam|Exams could not load|Live exams/,
    );
    assert.ok(nav("Live Exams"), "Exam navigation remains available");
  });
}

test("dashboard shows only an available live exam with a direct link", async () => {
  exams = [
    {
      id: "exam-a",
      title: "Aptitude assessment",
      durationMinutes: 30,
      questionCount: 20,
      state: "live",
    },
  ];
  await mount("/", identity(["courses", "live-exams"]));
  const shortcut = document.querySelector('main [aria-label="Live exams"]');
  assert.match(shortcut.textContent, /Aptitude assessment/);
  assert.equal(
    shortcut.querySelector("a").getAttribute("href"),
    "/live-exams/exam-a",
  );
});

test("course catalogue uses matching image cards and All Courses / Enrolled filters without practice requests", async () => {
  await mount("/courses");
  assert.ok(button("All Courses"));
  assert.ok(button("Enrolled"));
  assert.equal(button("All Courses").getAttribute("aria-pressed"), "true");
  assert.doesNotMatch(
    document.querySelector("main").textContent,
    /PYQ|previous.year/i,
  );
  assert.equal(
    reads.some(({ path }) => path === "student/practice"),
    false,
  );
  assert.equal(document.querySelectorAll(".learning-card").length, 2);
  const available = document.querySelector(
    `[aria-labelledby="course-title-${availableCourse.id}"]`,
  );
  assert.equal(
    available.querySelector("a"),
    null,
    "Unenrolled metadata must never link to lessons",
  );
  assert.equal(
    available.querySelector("img").getAttribute("src"),
    availableCourse.coverImageUrl,
  );
  await act(async () =>
    available.querySelector("img").dispatchEvent(new Event("error")),
  );
  assert.equal(available.querySelector("img"), null);
  assert.ok(
    available.querySelector(".learning-card-glyph"),
    "Broken cover image has a decorative fallback",
  );
  await click(button("Enrolled"));
  assert.equal(document.querySelectorAll(".learning-card").length, 1);
  assert.equal(
    document.querySelector(".learning-card h3").textContent,
    course.title,
  );
  assert.equal(button("Enrolled").getAttribute("aria-pressed"), "true");
});

test("requesting enrollment records a pending request without granting course access or claiming email delivery", async () => {
  await mount("/courses");
  const available = document.querySelector(
    `[aria-labelledby="course-title-${availableCourse.id}"]`,
  );
  await click(available.querySelector("button"));
  assert.equal(available.querySelector("button").disabled, true);
  assert.match(available.textContent, /Enrollment requested/);
  assert.match(
    available.querySelector('[role="status"]').textContent,
    /Access opens after approval/,
  );
  assert.doesNotMatch(available.textContent, /email.*(sent|delivered)/i);
  assert.equal(available.querySelector("a"), null);
  assert.deepEqual(
    reads.filter(({ method }) => method === "POST"),
    [
      {
        path: `student/courses/${availableCourse.id}/enrollment-requests`,
        method: "POST",
      },
    ],
  );
  await click(button("Enrolled"));
  assert.equal(document.querySelectorAll(".learning-card").length, 1);
});

test("failed enrollment request stays actionable and does not show success", async () => {
  enrollmentError = true;
  await mount("/courses");
  const available = document.querySelector(
    `[aria-labelledby="course-title-${availableCourse.id}"]`,
  );
  await click(available.querySelector("button"));
  assert.match(
    available.querySelector('[role="alert"]').textContent,
    /Unable to send your request/,
  );
  assert.equal(available.querySelector("button").disabled, false);
  assert.equal(available.querySelector('[role="status"]'), null);
  enrollmentError = false;
  await click(available.querySelector("button"));
  assert.match(
    available.querySelector('[role="status"]').textContent,
    /Access opens after approval/,
  );
});

test("opening a course updates recency once despite query refreshes, and dashboard reflects it", async () => {
  const recent = {
    ...course,
    id: "recent-course",
    title: "Python",
    lastOpenedAt: "2026-10-20T07:00:00.000Z",
  };
  enrolledCourses = [course, recent];
  await mount();
  assert.equal(
    document.querySelector(".learning-card h3").textContent,
    recent.title,
  );
  await click(document.querySelector(`main a[href="/courses/${course.id}"]`));
  await act(async () =>
    query.invalidateQueries({ queryKey: ["student", `course-${course.id}`] }),
  );
  await settle();
  assert.equal(
    reads.filter(
      ({ path, method }) =>
        path === `student/courses/${course.id}/opened` && method === "POST",
    ).length,
    1,
  );
  await click(nav("Dashboard"));
  assert.equal(
    document.querySelector(".learning-card h3").textContent,
    course.title,
  );
});

for (const [oldPath, newPath, view] of [
  ["/practice", "/competitive-programming", "CodingLibrary"],
  [
    "/practice/coding?topic=Arrays",
    "/competitive-programming",
    "CodingLibrary",
  ],
  [
    "/practice/coding-arrays-1",
    "/competitive-programming/coding-arrays-1",
    "CodingProblemPage",
  ],
]) {
  test(`legacy coding entry ${oldPath} redirects without losing access guards`, async () => {
    await mount(oldPath);
    assert.equal(location(), newPath);
    assert.ok(document.querySelector(`[data-route-view="${view}"]`));
    assert.equal(
      nav("Coding").getAttribute("aria-current"),
      "page",
    );
    if (oldPath.includes("?"))
      assert.equal(
        document.querySelector("[data-location]").getAttribute("data-search"),
        "?topic=Arrays",
      );
    assert.equal(nav("Practice"), null);
  });
}
for (const scenario of ["compiler disabled", "coding unassigned"]) {
  test(`Coding remains inaccessible when ${scenario}`, async () => {
    const user = identity(
      scenario === "compiler disabled"
        ? ["practice"]
        : ["practice", "compiler"],
    );
    if (scenario === "coding unassigned")
      user.access.practiceModuleIds = ["aptitude"];
    await mount("/competitive-programming", user);
    assert.equal(nav("Coding"), null);
    assert.match(
      document.querySelector("main").textContent,
      /This section is not assigned/,
    );
    assert.deepEqual(reads, []);
  });
}
