import { z } from "zod";

const entryId = z.string().trim().min(1).max(100);
const month = z.union([
  z.literal(""),
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month in YYYY-MM format."),
]);
const bullets = z.array(z.string().max(1000)).max(50);
const entryTitle = z.string().max(200);
const url = z.string().max(2000);

const project = z
  .object({
    id: entryId,
    title: entryTitle,
    description: z.string().max(6000),
    url,
    bullets,
  })
  .strict();
const experience = z
  .object({
    id: entryId,
    title: entryTitle,
    company: entryTitle,
    startDate: month,
    endDate: month,
    current: z.boolean(),
    description: z.string().max(6000),
    bullets,
  })
  .strict();
const education = z
  .object({
    id: entryId,
    institution: entryTitle,
    degree: entryTitle,
    fieldOfStudy: entryTitle,
    startDate: month,
    endDate: month,
    current: z.boolean(),
    grade: z.string().max(100),
    description: z.string().max(4000),
  })
  .strict();
const certification = z
  .object({
    id: entryId,
    name: entryTitle,
    issuer: entryTitle,
    issuedDate: month,
    credentialId: entryTitle,
    url,
    description: z.string().max(4000),
  })
  .strict();

function entries<T extends z.ZodType<{ id: string }>>(entry: T) {
  return z
    .array(entry)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "Each resume entry must have a unique ID within its section.",
    );
}

// Keep text sections readable and writable for resumes saved before structured entries.
export const resumeInput = z
  .object({
    name: z.string().max(150),
    title: z.string().max(150),
    email: z.string().max(200),
    phone: z.string().max(30),
    location: z.string().max(150).default(""),
    links: z.string().max(500).default(""),
    summary: z.string().max(2000),
    education: z.union([z.string().max(4000), entries(education)]),
    experience: z.union([z.string().max(6000), entries(experience)]),
    skills: z.union([
      z.string().max(2000),
      z.array(z.string().max(2000)).max(1000),
    ]),
    projects: z.union([z.string().max(6000), entries(project)]),
    certifications: z
      .union([z.string().max(4000), entries(certification)])
      .default(""),
    template: z.enum(["classic", "compact", "modern", "serif"]),
  })
  .strict();
