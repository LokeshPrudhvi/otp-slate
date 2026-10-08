import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Resume } from "@slate/contracts";
import { api, useData, useMe } from "@slate/ui";
import { Heading, Status } from "./design";

type Draft = Required<Resume>;
const blank: Draft = {
  template: "classic",
  name: "",
  title: "",
  email: "",
  phone: "",
  location: "",
  links: "",
  summary: "",
  skills: "",
  experience: "",
  projects: "",
  education: "",
  certifications: "",
};
const templates = {
  classic: "Classic",
  modern: "Modern",
  compact: "Compact",
  serif: "Editorial",
} as const;
const fields: {
  key: Exclude<keyof Draft, "template">;
  label: string;
  placeholder: string;
  multiline?: boolean;
  max: number;
}[] = [
  { key: "name", label: "Full name", placeholder: "Your name", max: 150 },
  {
    key: "title",
    label: "Target role",
    placeholder: "Software Engineer",
    max: 150,
  },
  { key: "email", label: "Email", placeholder: "you@example.com", max: 200 },
  { key: "phone", label: "Phone", placeholder: "+91 98765 43210", max: 30 },
  {
    key: "location",
    label: "Location",
    placeholder: "Bengaluru, India",
    max: 150,
  },
  {
    key: "links",
    label: "Portfolio / LinkedIn / GitHub",
    placeholder: "linkedin.com/in/yourname",
    max: 500,
  },
  {
    key: "summary",
    label: "Professional summary",
    placeholder: "Describe your strengths and the role you are looking for.",
    multiline: true,
    max: 2000,
  },
  {
    key: "skills",
    label: "Skills",
    placeholder: "Python, Java, SQL, React, Git",
    multiline: true,
    max: 2000,
  },
  {
    key: "experience",
    label: "Experience",
    placeholder:
      "Role — Company | Dates\n- Describe your contribution and measurable impact.",
    multiline: true,
    max: 6000,
  },
  {
    key: "projects",
    label: "Projects",
    placeholder:
      "Project name | Technologies\n- What you built and the result.",
    multiline: true,
    max: 6000,
  },
  {
    key: "education",
    label: "Education",
    placeholder:
      "Degree — Institution | Graduation year\nRelevant coursework or achievements",
    multiline: true,
    max: 4000,
  },
  {
    key: "certifications",
    label: "Certifications",
    placeholder: "Certification — Issuer | Year",
    multiline: true,
    max: 4000,
  },
];
const sections = [
  ["summary", "Professional Summary"],
  ["skills", "Skills"],
  ["experience", "Experience"],
  ["projects", "Projects"],
  ["education", "Education"],
  ["certifications", "Certifications"],
] as const;

export function ResumePage() {
  const query = useQueryClient();
  const me = useMe(),
    saved = useData<{ data: Resume | null; revision: number }>(
      "resume",
      "student/resume",
    );
  const [draft, setDraft] = useState<Draft | null>(null),
    [revision, setRevision] = useState(0),
    [savedSignature, setSavedSignature] = useState(""),
    [hasSaved, setHasSaved] = useState(false),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    if (saved.data && draft === null) {
      const initial = {
        ...blank,
        ...(saved.data.data || { name: me.data!.name, email: me.data!.email }),
      };
      setDraft(initial);
      setRevision(saved.data.revision);
      setSavedSignature(JSON.stringify(initial));
      setHasSaved(Boolean(saved.data.data));
    }
  }, [saved.data, draft, me.data]);
  const save = useMutation({
    mutationFn: (input: { data: Draft; revision: number }) =>
      api<{ revision: number }>("student/resume", "PUT", input),
    onSuccess: (result, input) => {
      query.setQueryData(["student", "resume"], {
        data: input.data,
        revision: result.revision,
      });
      setRevision(result.revision);
      setSavedSignature(JSON.stringify(input.data));
      setHasSaved(true);
      setPaused(false);
    },
    onError: () => setPaused(true),
  });
  const signature = JSON.stringify(draft),
    dirty = Boolean(draft && signature !== savedSignature);
  useEffect(() => {
    if (!draft || !dirty || paused || save.isPending) return;
    const timer = window.setTimeout(
      () => save.mutate({ data: { ...draft }, revision }),
      900,
    );
    return () => window.clearTimeout(timer);
  }, [draft, dirty, paused, save.isPending, save.mutate, revision]);
  const edit = (key: keyof Draft, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setPaused(false);
  };
  return (
    <div className="a-page">
      <Heading title="Resume Builder">
        <span className="resume-save-note" role="status">
          {!draft
            ? "Loading your draft…"
            : save.isPending
              ? "Saving…"
              : paused
                ? "Changes are not saved"
                : dirty
                  ? "Unsaved changes"
                  : hasSaved
                    ? "Saved to your account"
                    : "Draft ready"}
        </span>
        <button
          className="a-btn pri"
          onClick={() => window.print()}
          disabled={!draft}
        >
          Print / Save PDF
        </button>
      </Heading>
      <p className="hub-note">
        Four ATS-friendly, single-column layouts with standard headings and
        selectable text. Review the exported PDF before applying; compatibility
        varies by applicant tracking system.
      </p>
      <Status pending={saved.isPending} error={saved.error} />
      {draft && (
        <div className="resume-layout">
          <section className="resume-form" aria-label="Resume details">
            <h2>Your details</h2>
            <p>Fill in the form. Your resume updates on the right.</p>
            {fields.map((field) => (
              <div key={field.key}>
                <label htmlFor={`resume-${field.key}`}>{field.label}</label>
                {field.multiline ? (
                  <textarea
                    id={`resume-${field.key}`}
                    rows={field.key === "skills" ? 2 : 4}
                    placeholder={field.placeholder}
                    maxLength={field.max}
                    value={draft[field.key]}
                    onChange={(event) => edit(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    id={`resume-${field.key}`}
                    type={
                      field.key === "email"
                        ? "email"
                        : field.key === "phone"
                          ? "tel"
                          : "text"
                    }
                    placeholder={field.placeholder}
                    maxLength={field.max}
                    value={draft[field.key]}
                    onChange={(event) => edit(field.key, event.target.value)}
                  />
                )}
              </div>
            ))}
            <Status error={save.error} />
            {paused && (
              <div className="resume-save-actions">
                <p className="hub-note">
                  Your edits remain here. If another tab saved a newer version,
                  copy your changes before reloading.
                </p>
                <button
                  className="a-btn"
                  onClick={() => {
                    save.reset();
                    setPaused(false);
                  }}
                >
                  Retry save
                </button>
              </div>
            )}
          </section>
          <section
            className="resume-preview-column"
            aria-label="Resume preview"
          >
            <div className="resume-templates" aria-label="Resume templates">
              {Object.entries(templates).map(([id, name]) => (
                <button
                  key={id}
                  className={`a-pill${draft.template === id ? " on" : ""}`}
                  aria-pressed={draft.template === id}
                  onClick={() => edit("template", id)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div id="resumePreview">
              <article
                className={`resume-paper template-${draft.template}`}
                aria-label="Live resume preview"
              >
                <header>
                  <h1>{draft.name || "Your name"}</h1>
                  {draft.title && (
                    <p className="resume-headline">{draft.title}</p>
                  )}
                  <p className="resume-contact">
                    {[draft.email, draft.phone, draft.location, draft.links]
                      .filter(Boolean)
                      .join(" | ") || "Email | Phone | Location | Portfolio"}
                  </p>
                </header>
                {sections
                  .filter(([key]) => draft[key].trim())
                  .map(([key, label]) => (
                    <section key={key}>
                      <h2>{label}</h2>
                      <p>{draft[key]}</p>
                    </section>
                  ))}
                {!sections.some(([key]) => draft[key].trim()) && (
                  <div className="resume-placeholder">
                    Fill in your details to build your resume.
                    <br />
                    Only completed sections appear here.
                  </div>
                )}
              </article>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
