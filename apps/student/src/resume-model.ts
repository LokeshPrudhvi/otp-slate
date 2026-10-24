import type {
  Resume,
  ResumeCertification,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
} from "@slate/contracts";

export type ResumeDraft = Omit<
  Required<Resume>,
  "skills" | "experience" | "projects" | "education" | "certifications"
> & {
  skills: string[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  certifications: ResumeCertification[];
};

export function newProject(): ResumeProject {
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    url: "",
    bullets: [],
  };
}

export function newExperience(): ResumeExperience {
  return {
    id: crypto.randomUUID(),
    title: "",
    company: "",
    startDate: "",
    endDate: "",
    current: false,
    description: "",
    bullets: [],
  };
}

export function newEducation(): ResumeEducation {
  return {
    id: crypto.randomUUID(),
    institution: "",
    degree: "",
    fieldOfStudy: "",
    startDate: "",
    endDate: "",
    current: false,
    grade: "",
    description: "",
  };
}

export function newCertification(): ResumeCertification {
  return {
    id: crypto.randomUUID(),
    name: "",
    issuer: "",
    issuedDate: "",
    credentialId: "",
    url: "",
    description: "",
  };
}

function normalizeEntries<T extends { id: string; description: string }>(
  value: string | T[] | undefined,
  create: () => T,
): T[] {
  if (typeof value === "string") {
    return value.trim() ? [{ ...create(), description: value }] : [];
  }
  return (value || []).map((entry) => ({ ...entry }));
}

export function normalizeResume(
  value: Resume | null | undefined,
  profile?: { name?: string; email?: string },
): ResumeDraft {
  return {
    template: value?.template || "classic",
    name: value?.name ?? profile?.name ?? "",
    title: value?.title ?? "",
    email: value?.email ?? profile?.email ?? "",
    phone: value?.phone ?? "",
    location: value?.location ?? "",
    links: value?.links ?? "",
    summary: value?.summary ?? "",
    skills:
      typeof value?.skills === "string"
        ? value.skills
            .split(/[,\r\n]+/)
            .map((skill) => skill.trim())
            .filter(Boolean)
        : [...(value?.skills || [])],
    experience: normalizeEntries(value?.experience, newExperience).map(
      (entry) => ({ ...entry, bullets: [...entry.bullets] }),
    ),
    projects: normalizeEntries(value?.projects, newProject).map((entry) => ({
      ...entry,
      bullets: [...entry.bullets],
    })),
    education: normalizeEntries(value?.education, newEducation),
    certifications: normalizeEntries(value?.certifications, newCertification),
  };
}
