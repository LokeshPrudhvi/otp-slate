// Run: node --test tests/resume-model.test.mjs
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = new URL(
  `../.resume-model-tests-${process.pid}.mjs`,
  import.meta.url,
);
await build({
  stdin: {
    contents: `
      export * from "./apps/student/src/resume-model";
      export * from "./apps/student/src/resume-preview";
    `,
    resolveDir: root,
    loader: "ts",
  },
  outfile: fileURLToPath(bundle),
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react/*"],
});
const {
  normalizeResume,
  newProject,
  newExperience,
  newEducation,
  newCertification,
  ResumePreview,
} = await import(bundle.href);
after(() => rm(bundle, { force: true }));

function render(draft) {
  const markup = renderToStaticMarkup(createElement(ResumePreview, { draft }));
  return new JSDOM(markup).window.document;
}

test("new resume starts with independent empty collections and profile details", () => {
  const first = normalizeResume(null, {
    name: "Student",
    email: "student@example.com",
  });
  const second = normalizeResume(undefined);
  assert.equal(first.name, "Student");
  assert.equal(first.email, "student@example.com");
  for (const key of [
    "projects",
    "experience",
    "education",
    "certifications",
    "skills",
  ])
    assert.deepEqual(first[key], []);
  first.skills.push("Python");
  assert.deepEqual(second.skills, []);
  assert.equal(second.template, "classic");
});

test("entry constructors supply unique IDs and separate editable fields", () => {
  const entries = [
    newProject(),
    newProject(),
    newExperience(),
    newEducation(),
    newCertification(),
  ];
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  for (const entry of entries) {
    assert.equal(entry.description, "");
    assert.match(entry.id, /^[a-f0-9-]{36}$/);
  }
  assert.deepEqual(entries[0].bullets, []);
  assert.equal(entries[2].current, false);
  assert.equal(entries[3].current, false);
});

test("legacy descriptions retain exact text while comma and newline skills become items", () => {
  const values = {
    projects:
      "  Portfolio — React\n- Built three pages\n- Added accessible navigation  ",
    experience: "Intern at Example\nJun 2025 - Jul 2025\nImproved build times.",
    education: "B.Tech — Example College\nGrade: 8.7/10",
    certifications:
      "Developer certificate — Example Academy | 2025\nCredential ABC123",
  };
  const draft = normalizeResume({
    ...normalizeResume(null),
    ...values,
    skills: " JavaScript, React\r\nTypeScript, \nGit ",
  });
  for (const [section, text] of Object.entries(values)) {
    assert.equal(draft[section].length, 1);
    assert.equal(draft[section][0].description, text);
    assert.equal(
      draft[section][0].title ||
        draft[section][0].name ||
        draft[section][0].institution ||
        "",
      "",
    );
  }
  assert.deepEqual(draft.skills, ["JavaScript", "React", "TypeScript", "Git"]);
  const doc = render(draft);
  for (const text of Object.values(values))
    assert.ok(doc.body.textContent.includes(text));
});

test("normalizing structured entries preserves IDs and does not share mutable arrays", () => {
  const saved = {
    ...normalizeResume(null),
    skills: ["C++"],
    projects: [
      { ...newProject(), title: "Compiler", bullets: ["Created a parser"] },
    ],
    experience: [
      { ...newExperience(), title: "Intern", bullets: ["Wrote tests"] },
    ],
  };
  const copy = normalizeResume(saved);
  assert.deepEqual(copy, saved);
  copy.projects[0].title = "Edited";
  copy.projects[0].bullets.push("New point");
  copy.experience[0].bullets.push("Another point");
  copy.skills.push("SQL");
  assert.equal(saved.projects[0].title, "Compiler");
  assert.deepEqual(saved.projects[0].bullets, ["Created a parser"]);
  assert.deepEqual(saved.experience[0].bullets, ["Wrote tests"]);
  assert.deepEqual(saved.skills, ["C++"]);
});

test("empty entries and bullet placeholders do not appear in the printable resume", () => {
  const draft = {
    ...normalizeResume(null),
    projects: [{ ...newProject(), bullets: ["", "  "] }],
    experience: [newExperience()],
    education: [newEducation()],
    certifications: [newCertification()],
    skills: ["", " "],
  };
  const doc = render(draft);
  assert.equal(doc.querySelectorAll("section").length, 0);
  assert.ok(doc.querySelector(".resume-placeholder"));
  assert.equal(doc.querySelectorAll("li").length, 0);
});

test("experience renders separate bullet points and current date range", () => {
  const draft = {
    ...normalizeResume(null),
    experience: [
      {
        ...newExperience(),
        title: "Software Intern",
        company: "Example Labs",
        startDate: "2026-01",
        endDate: "2026-06",
        current: true,
        description: "Built internal tools.",
        bullets: ["Shipped three features", "", "Reduced build time by 20%"],
      },
    ],
  };
  const doc = render(draft);
  assert.equal(doc.querySelector("h3").textContent, "Software Intern");
  assert.equal(
    doc.querySelector(".resume-entry-subtitle").textContent,
    "Example Labs",
  );
  assert.equal(
    doc.querySelector(".resume-entry-dates").textContent,
    "Jan 2026 – Present",
  );
  assert.deepEqual(
    [...doc.querySelectorAll("li")].map((el) => el.textContent),
    ["Shipped three features", "Reduced build time by 20%"],
  );
  assert.ok(!doc.body.textContent.includes("Jun 2026"));
});

test("projects, education and credentials remain distinct in all four templates", () => {
  const draft = {
    ...normalizeResume(null),
    projects: [
      {
        ...newProject(),
        title: "Portfolio",
        url: "github.com/student/portfolio",
        description: "A personal website",
        bullets: ["Added keyboard navigation"],
      },
      {
        ...newProject(),
        title: "Inventory app",
        description: "A separate project",
      },
    ],
    education: [
      {
        ...newEducation(),
        institution: "Example College",
        degree: "B.Tech",
        fieldOfStudy: "Computer Science",
        startDate: "2022-08",
        endDate: "2026-05",
        grade: "8.8/10",
      },
    ],
    certifications: [
      {
        ...newCertification(),
        name: "Cloud Fundamentals",
        issuer: "Training Academy",
        issuedDate: "2025-04",
        credentialId: "CERT-42",
        url: "https://example.com/cert/42",
      },
      {
        ...newCertification(),
        name: "Web Development",
        issuer: "Another Academy",
      },
    ],
  };
  for (const template of ["classic", "compact", "modern", "serif"]) {
    const doc = render({ ...draft, template });
    assert.ok(doc.querySelector(`.template-${template}`));
    assert.equal(doc.querySelectorAll(".resume-entry").length, 5);
    assert.match(doc.body.textContent, /Aug 2022 – May 2026/);
    assert.match(doc.body.textContent, /B.Tech · Computer Science/);
    assert.match(doc.body.textContent, /Grade: 8.8\/10/);
    assert.match(doc.body.textContent, /Apr 2025/);
    assert.match(doc.body.textContent, /Credential ID: CERT-42/);
    assert.equal(doc.querySelectorAll("a").length, 0);
  }
});

test("current education shows expected graduation when provided and Present otherwise", () => {
  const draft = {
    ...normalizeResume(null),
    education: [
      {
        ...newEducation(),
        institution: "Example College",
        startDate: "2023-09",
        endDate: "2027-05",
        current: true,
      },
      {
        ...newEducation(),
        institution: "Evening Academy",
        startDate: "2026-01",
        current: true,
      },
    ],
  };
  const doc = render(draft);
  assert.deepEqual(
    [...doc.querySelectorAll(".resume-entry-dates")].map(
      (el) => el.textContent,
    ),
    ["Sep 2023 – Expected May 2027", "Jan 2026 – Present"],
  );
});

test("user content is plain selectable text rather than injected markup", () => {
  const text = '<script>alert("unsafe")</script>';
  const draft = {
    ...normalizeResume(null),
    name: text,
    projects: [
      {
        ...newProject(),
        title: "<img src=x>",
        description: text,
        bullets: ["<b>Keep as text</b>"],
      },
    ],
    skills: ["<i>React</i>"],
  };
  const doc = render(draft);
  assert.equal(doc.querySelectorAll("script,img,b,i").length, 0);
  assert.match(doc.body.textContent, /<script>/);
  assert.equal(
    doc.querySelector(".resume-skills li").textContent,
    "<i>React</i>",
  );
});
