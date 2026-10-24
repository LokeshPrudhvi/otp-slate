import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeInput } from "./resume-input.js";

const legacy = {
  name: "Test Student",
  title: "Developer",
  email: "student@example.test",
  phone: "",
  summary: "A short profile.",
  skills: "TypeScript, SQL",
  projects: "Project title\nAn existing paragraph.\n• Existing achievement",
  experience: "Intern\nExisting work experience.",
  education: "B.Tech\nCollege name",
  template: "classic",
};
const project = {
  id: "project-1",
  title: "Placement portal",
  description: "An accessible student portal.",
  url: "https://example.test/portal",
  bullets: ["Designed the dashboard", "Added keyboard navigation"],
};
const experience = {
  id: "experience-1",
  title: "Software intern",
  company: "Example",
  startDate: "2025-06",
  endDate: "",
  current: true,
  description: "Worked with the product team.",
  bullets: ["Built a course search interface"],
};
const education = {
  id: "education-1",
  institution: "Example College",
  degree: "B.Tech",
  fieldOfStudy: "Computer Science",
  startDate: "2022-08",
  endDate: "2026-06",
  current: false,
  grade: "8.8 CGPA",
  description: "Student developer club volunteer.",
};
const certificate = {
  id: "certificate-1",
  name: "Cloud fundamentals",
  issuer: "Example Academy",
  issuedDate: "2025-12",
  credentialId: "CERT-001",
  url: "https://example.test/credential/CERT-001",
  description: "Cloud computing foundations.",
};
const structured = {
  ...legacy,
  location: "Hyderabad",
  links: "https://example.test/profile",
  skills: ["TypeScript", "SQL", "Communication"],
  projects: [project, { ...project, id: "project-2", title: "Second project" }],
  experience: [experience],
  education: [education],
  certifications: [certificate],
};

test("existing text resumes retain content and optional-field defaults", () => {
  assert.deepEqual(resumeInput.parse(legacy), {
    ...legacy,
    location: "",
    links: "",
    certifications: "",
  });
});

test("structured resumes retain multiple entries, individual bullets and skills", () => {
  assert.deepEqual(resumeInput.parse(structured), structured);
  const mixed = { ...structured, education: legacy.education };
  assert.deepEqual(resumeInput.parse(mixed), mixed);
  // A previous 2,000-character comma-separated field can contain 1,000 short skills.
  const manyLegacySkills = { ...structured, skills: Array(1000).fill("R") };
  assert.deepEqual(resumeInput.parse(manyLegacySkills), manyLegacySkills);
});

test("incomplete autosaved entries and emptied sections are valid drafts", () => {
  const incomplete = {
    ...structured,
    projects: [
      {
        id: "new-project",
        title: "",
        description: "",
        url: "https://",
        bullets: [""],
      },
    ],
    experience: [{ ...experience, title: "", startDate: "", endDate: "" }],
    education: [],
    certifications: [],
    skills: [],
  };
  assert.deepEqual(resumeInput.parse(incomplete), incomplete);
});

test("malformed and unexpected entry fields are rejected", () => {
  for (const data of [
    { ...structured, projects: [{ ...project, id: "" }] },
    { ...structured, projects: [project, project] },
    {
      ...structured,
      projects: [{ ...project, internalNote: "not supported" }],
    },
    { ...structured, projects: [{ ...project, bullets: "One bullet" }] },
    { ...structured, experience: [{ ...experience, current: "true" }] },
    { ...structured, education: [{ ...education, startDate: "2026-13" }] },
    { ...structured, education: [{ ...education, endDate: "2026-01-10" }] },
    {
      ...structured,
      certifications: [{ ...certificate, issuedDate: "2026-00" }],
    },
    { ...structured, skills: ["TypeScript", { label: "SQL" }] },
  ])
    assert.equal(resumeInput.safeParse(data).success, false);
});

test("entry, bullet and skill limits bound dynamically added input", () => {
  for (const data of [
    {
      ...structured,
      projects: Array.from({ length: 101 }, (_, index) => ({
        ...project,
        id: `p-${index}`,
      })),
    },
    {
      ...structured,
      projects: [{ ...project, bullets: Array(51).fill("Achievement") }],
    },
    { ...structured, skills: Array(1001).fill("TypeScript") },
    {
      ...structured,
      projects: [{ ...project, description: "x".repeat(6001) }],
    },
    { ...legacy, experience: "x".repeat(6001) },
  ])
    assert.equal(resumeInput.safeParse(data).success, false);
});
