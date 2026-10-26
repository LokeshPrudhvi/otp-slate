import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Resume } from "@slate/contracts";
import { api, useData, useMe } from "@slate/ui";
import { Heading, Status } from "./design";
import {
  normalizeResume,
  newProject,
  newExperience,
  newEducation,
  newCertification,
  type ResumeDraft,
} from "./resume-model";
import { ResumePreview } from "./resume-preview";
import { printResume } from "./resume-print";
import "./resume.css";

const templates = {
  classic: "Classic",
  modern: "Modern",
  compact: "Compact",
  serif: "Editorial",
} as const;
const MAX_ENTRIES = 100,
  MAX_SKILLS = 200,
  MAX_POINTS = 50;
const profileFields = [
  { key: "name", label: "Full name", placeholder: "Your name", max: 150 },
  {
    key: "title",
    label: "Target role",
    placeholder: "Software Engineer",
    max: 150,
  },
  {
    key: "email",
    label: "Email",
    placeholder: "you@example.com",
    max: 200,
    type: "email",
  },
  {
    key: "phone",
    label: "Phone",
    placeholder: "+91 98765 43210",
    max: 30,
    type: "tel",
  },
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
] as const;

function focusField(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}
function Plus() {
  return <span aria-hidden="true">＋</span>;
}
function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="resume-remove"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
      </svg>
      <span>Remove</span>
    </button>
  );
}
function Field({
  id,
  label,
  value,
  onChange,
  max = 200,
  type = "text",
  multiline = false,
  placeholder,
  disabled = false,
  wide = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  type?: string;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`resume-field${wide ? " resume-field-wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={max}
          rows={3}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          maxLength={max}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );
}
function FormSection({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="resume-form-section" aria-label={title}>
      <header className="resume-section-header">
        <div>
          <h2>
            {title}
            {count !== undefined && (
              <span className="resume-section-count">{count}</span>
            )}
          </h2>
          <p>{hint}</p>
        </div>
      </header>
      <div className="resume-section-body">{children}</div>
    </section>
  );
}
function EntryCard({
  label,
  title,
  onRemove,
  children,
}: {
  label: string;
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <fieldset className="resume-entry-editor">
      <legend>{label}</legend>
      <div className="resume-entry-toolbar">
        <strong>{title || label}</strong>
        <RemoveButton
          label={`Remove ${label.toLowerCase()}`}
          onClick={onRemove}
        />
      </div>
      <div className="resume-field-grid">{children}</div>
    </fieldset>
  );
}
function AddEntry({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="resume-add-entry"
      onClick={onClick}
      disabled={count >= MAX_ENTRIES}
    >
      <Plus />
      {count >= MAX_ENTRIES ? "Entry limit reached" : label}
    </button>
  );
}
function BulletEditor({
  id,
  label,
  values,
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="resume-points resume-field-wide">
      <p className="resume-field-label">
        Key points <span>One achievement or contribution per point</span>
      </p>
      {values.map((value, index) => (
        <div className="resume-point-row" key={index}>
          <span aria-hidden="true">•</span>
          <label className="resume-sr-only" htmlFor={`${id}-point-${index}`}>
            {label} point {index + 1}
          </label>
          <textarea
            id={`${id}-point-${index}`}
            rows={2}
            maxLength={1000}
            placeholder="Describe what you did and the impact it made."
            value={value}
            onChange={(event) =>
              onChange(
                values.map((point, i) =>
                  i === index ? event.target.value : point,
                ),
              )
            }
          />
          <button
            type="button"
            className="resume-icon-remove"
            aria-label={`Remove ${label.toLowerCase()} point ${index + 1}`}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="resume-add-point"
        disabled={values.length >= MAX_POINTS}
        onClick={() => {
          onChange([...values, ""]);
          focusField(`${id}-point-${values.length}`);
        }}
      >
        <Plus />
        Add point
      </button>
    </div>
  );
}

export function ResumePage() {
  const [printError, setPrintError] = useState<Error | null>(null);
  const [printing, setPrinting] = useState(false);
  const query = useQueryClient();
  const me = useMe(),
    saved = useData<{ data: Resume | null; revision: number }>(
      "resume",
      "student/resume",
    );
  const [draft, setDraft] = useState<ResumeDraft | null>(null),
    [revision, setRevision] = useState(0),
    [savedSignature, setSavedSignature] = useState(""),
    [hasSaved, setHasSaved] = useState(false),
    [paused, setPaused] = useState(false);
  const [skillInput, setSkillInput] = useState(""),
    [skillNotice, setSkillNotice] = useState("");
  useEffect(() => {
    if (saved.data && draft === null && (saved.data.data || me.data)) {
      const initial = normalizeResume(saved.data.data, me.data);
      setDraft(initial);
      setRevision(saved.data.revision);
      setSavedSignature(JSON.stringify(initial));
      setHasSaved(Boolean(saved.data.data));
    }
  }, [saved.data, draft, me.data]);
  const save = useMutation({
    mutationFn: (input: { data: ResumeDraft; revision: number }) =>
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
      () => save.mutate({ data: draft, revision }),
      900,
    );
    return () => window.clearTimeout(timer);
  }, [draft, dirty, paused, save.isPending, save.mutate, revision]);
  function edit<K extends keyof ResumeDraft>(key: K, value: ResumeDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setPaused(false);
  }
  function addSkill() {
    const value = skillInput.trim();
    if (!draft || !value) return;
    if (
      draft.skills.some(
        (skill) => skill.toLocaleLowerCase() === value.toLocaleLowerCase(),
      )
    ) {
      setSkillNotice("This skill is already on your resume.");
      return;
    }
    if (draft.skills.length >= MAX_SKILLS) {
      setSkillNotice("You have reached the skill limit.");
      return;
    }
    edit("skills", [...draft.skills, value]);
    setSkillInput("");
    setSkillNotice("");
    focusField("resume-new-skill");
  }
  return (
    <div className="a-page resume-builder">
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
          onClick={async () => {
            const paper = document.querySelector<HTMLElement>(".resume-builder .resume-paper");
            if (!paper || !draft || printing) return;
            setPrintError(null); setPrinting(true);
            try { await printResume(paper, draft.name); }
            catch (error) { setPrintError(error instanceof Error ? error : new Error("The resume could not be exported. Please retry.")); }
            finally { setPrinting(false); }
          }}
          disabled={!draft || printing}
        >
          {printing ? "Preparing PDF…" : "Print / Save PDF"}
        </button>
      </Heading>
      <p className="hub-note">
        Build your resume one detail at a time. Changes save automatically, and
        your preview updates as you type.
      </p>
      <Status
        pending={saved.isPending}
        error={saved.error}
        label="Opening your resume"
        variant="workspace"
      />
      <Status error={printError} />
      {draft && (
        <div className="resume-layout">
          <div className="resume-form" aria-label="Resume details">
            {paused && (
              <div className="resume-save-actions" role="alert">
                <Status error={save.error} />
                <p>
                  Your edits remain here. If another tab saved more recent
                  changes, copy your changes before reloading.
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
            <FormSection
              title="Personal details"
              hint="Start with how employers can reach you."
            >
              <div className="resume-field-grid">
                {profileFields.map((field) => (
                  <Field
                    key={field.key}
                    id={`resume-${field.key}`}
                    label={field.label}
                    value={draft[field.key]}
                    placeholder={field.placeholder}
                    max={field.max}
                    type={"type" in field ? field.type : "text"}
                    onChange={(value) => edit(field.key, value)}
                  />
                ))}
                <Field
                  id="resume-summary"
                  label="Professional summary"
                  value={draft.summary}
                  onChange={(value) => edit("summary", value)}
                  max={2000}
                  multiline
                  wide
                  placeholder="A short introduction to your strengths and career goals."
                />
              </div>
            </FormSection>
            <FormSection
              title="Skills"
              hint="Add each skill separately. Press Enter or use the plus button."
              count={draft.skills.length}
            >
              <label htmlFor="resume-new-skill">New skill</label>
              <div className="resume-skill-input">
                <input
                  id="resume-new-skill"
                  value={skillInput}
                  maxLength={2000}
                  placeholder="e.g. Python"
                  onChange={(event) => {
                    setSkillInput(event.target.value);
                    setSkillNotice("");
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      addSkill();
                    }
                  }}
                />
                <button
                  type="button"
                  className="a-btn"
                  onClick={addSkill}
                  disabled={
                    !skillInput.trim() || draft.skills.length >= MAX_SKILLS
                  }
                >
                  <Plus />
                  Add skill
                </button>
              </div>
              {skillNotice && (
                <p className="resume-field-notice" role="status">
                  {skillNotice}
                </p>
              )}
              <ul className="resume-skill-chips" aria-label="Added skills">
                {draft.skills.map((skill, index) => (
                  <li key={index}>
                    <span>{skill}</span>
                    <button
                      type="button"
                      aria-label={`Remove skill ${skill}`}
                      onClick={() =>
                        edit(
                          "skills",
                          draft.skills.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </FormSection>
            <FormSection
              title="Experience"
              hint="Include internships, employment and relevant volunteer work."
              count={draft.experience.length}
            >
              {draft.experience.map((entry, index) => {
                const label = `Experience ${index + 1}`,
                  prefix = `resume-${entry.id}`;
                const update = (patch: Partial<typeof entry>) =>
                  edit(
                    "experience",
                    draft.experience.map((item) =>
                      item.id === entry.id ? { ...item, ...patch } : item,
                    ),
                  );
                return (
                  <EntryCard
                    key={entry.id}
                    label={label}
                    title={entry.title}
                    onRemove={() =>
                      edit(
                        "experience",
                        draft.experience.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    <Field
                      id={`${prefix}-title`}
                      label="Role / internship title"
                      value={entry.title}
                      onChange={(title) => update({ title })}
                      placeholder="Software Engineering Intern"
                      max={200}
                    />
                    <Field
                      id={`${prefix}-company`}
                      label="Company / organization"
                      value={entry.company}
                      onChange={(company) => update({ company })}
                      max={200}
                    />
                    <Field
                      id={`${prefix}-start`}
                      label="Start date"
                      type="month"
                      value={entry.startDate}
                      onChange={(startDate) => update({ startDate })}
                    />
                    <Field
                      id={`${prefix}-end`}
                      label="End date"
                      type="month"
                      value={entry.endDate}
                      disabled={entry.current}
                      onChange={(endDate) => update({ endDate })}
                    />
                    <label className="resume-check resume-field-wide">
                      <input
                        type="checkbox"
                        checked={entry.current}
                        onChange={(event) =>
                          update({ current: event.target.checked })
                        }
                      />
                      I currently work here
                    </label>
                    <Field
                      id={`${prefix}-description`}
                      label="Experience description"
                      value={entry.description}
                      onChange={(description) => update({ description })}
                      multiline
                      wide
                      max={6000}
                      placeholder="Describe your role and responsibilities."
                    />
                    <BulletEditor
                      id={prefix}
                      label={label}
                      values={entry.bullets}
                      onChange={(bullets) => update({ bullets })}
                    />
                  </EntryCard>
                );
              })}
              <AddEntry
                label="Add experience"
                count={draft.experience.length}
                onClick={() => {
                  const entry = newExperience();
                  edit("experience", [...draft.experience, entry]);
                  focusField(`resume-${entry.id}-title`);
                }}
              />
            </FormSection>
            <FormSection
              title="Projects"
              hint="Show what you built and highlight your contributions."
              count={draft.projects.length}
            >
              {draft.projects.map((entry, index) => {
                const label = `Project ${index + 1}`,
                  prefix = `resume-${entry.id}`;
                const update = (patch: Partial<typeof entry>) =>
                  edit(
                    "projects",
                    draft.projects.map((item) =>
                      item.id === entry.id ? { ...item, ...patch } : item,
                    ),
                  );
                return (
                  <EntryCard
                    key={entry.id}
                    label={label}
                    title={entry.title}
                    onRemove={() =>
                      edit(
                        "projects",
                        draft.projects.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    <Field
                      id={`${prefix}-title`}
                      label="Project title"
                      value={entry.title}
                      onChange={(title) => update({ title })}
                      max={200}
                    />
                    <Field
                      id={`${prefix}-url`}
                      label="Project / repository link"
                      value={entry.url}
                      onChange={(url) => update({ url })}
                      max={500}
                      placeholder="https://github.com/…"
                    />
                    <Field
                      id={`${prefix}-description`}
                      label="Project description"
                      value={entry.description}
                      onChange={(description) => update({ description })}
                      multiline
                      wide
                      max={6000}
                      placeholder="What does the project do?"
                    />
                    <BulletEditor
                      id={prefix}
                      label={label}
                      values={entry.bullets}
                      onChange={(bullets) => update({ bullets })}
                    />
                  </EntryCard>
                );
              })}
              <AddEntry
                label="Add project"
                count={draft.projects.length}
                onClick={() => {
                  const entry = newProject();
                  edit("projects", [...draft.projects, entry]);
                  focusField(`resume-${entry.id}-title`);
                }}
              />
            </FormSection>
            <FormSection
              title="Education"
              hint="Add a separate entry for each qualification."
              count={draft.education.length}
            >
              {draft.education.map((entry, index) => {
                const prefix = `resume-${entry.id}`;
                const update = (patch: Partial<typeof entry>) =>
                  edit(
                    "education",
                    draft.education.map((item) =>
                      item.id === entry.id ? { ...item, ...patch } : item,
                    ),
                  );
                return (
                  <EntryCard
                    key={entry.id}
                    label={`Education ${index + 1}`}
                    title={entry.institution}
                    onRemove={() =>
                      edit(
                        "education",
                        draft.education.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    <Field
                      id={`${prefix}-institution`}
                      label="School / college / university"
                      value={entry.institution}
                      onChange={(institution) => update({ institution })}
                      max={200}
                      wide
                    />
                    <Field
                      id={`${prefix}-degree`}
                      label="Degree / qualification"
                      value={entry.degree}
                      onChange={(degree) => update({ degree })}
                      max={200}
                      placeholder="B.Tech"
                    />
                    <Field
                      id={`${prefix}-field`}
                      label="Field of study"
                      value={entry.fieldOfStudy}
                      onChange={(fieldOfStudy) => update({ fieldOfStudy })}
                      max={200}
                      placeholder="Computer Science"
                    />
                    <Field
                      id={`${prefix}-start`}
                      label="Start date"
                      type="month"
                      value={entry.startDate}
                      onChange={(startDate) => update({ startDate })}
                    />
                    <Field
                      id={`${prefix}-end`}
                      label={entry.current ? "Expected graduation" : "End date"}
                      type="month"
                      value={entry.endDate}
                      onChange={(endDate) => update({ endDate })}
                    />
                    <label className="resume-check resume-field-wide">
                      <input
                        type="checkbox"
                        checked={entry.current}
                        onChange={(event) =>
                          update({ current: event.target.checked })
                        }
                      />
                      I am currently studying here
                    </label>
                    <Field
                      id={`${prefix}-grade`}
                      label="Grade / CGPA (optional)"
                      value={entry.grade}
                      onChange={(grade) => update({ grade })}
                      max={100}
                    />
                    <Field
                      id={`${prefix}-description`}
                      label="Education details (optional)"
                      value={entry.description}
                      onChange={(description) => update({ description })}
                      multiline
                      wide
                      max={4000}
                      placeholder="Relevant coursework, honors or achievements."
                    />
                  </EntryCard>
                );
              })}
              <AddEntry
                label="Add education"
                count={draft.education.length}
                onClick={() => {
                  const entry = newEducation();
                  edit("education", [...draft.education, entry]);
                  focusField(`resume-${entry.id}-institution`);
                }}
              />
            </FormSection>
            <FormSection
              title="Certifications"
              hint="Add certificates, licenses and professional credentials."
              count={draft.certifications.length}
            >
              {draft.certifications.map((entry, index) => {
                const prefix = `resume-${entry.id}`;
                const update = (patch: Partial<typeof entry>) =>
                  edit(
                    "certifications",
                    draft.certifications.map((item) =>
                      item.id === entry.id ? { ...item, ...patch } : item,
                    ),
                  );
                return (
                  <EntryCard
                    key={entry.id}
                    label={`Certification ${index + 1}`}
                    title={entry.name}
                    onRemove={() =>
                      edit(
                        "certifications",
                        draft.certifications.filter(
                          (item) => item.id !== entry.id,
                        ),
                      )
                    }
                  >
                    <Field
                      id={`${prefix}-name`}
                      label="Certificate name"
                      value={entry.name}
                      onChange={(name) => update({ name })}
                      max={200}
                    />
                    <Field
                      id={`${prefix}-issuer`}
                      label="Issuing organization"
                      value={entry.issuer}
                      onChange={(issuer) => update({ issuer })}
                      max={200}
                    />
                    <Field
                      id={`${prefix}-date`}
                      label="Issue date"
                      type="month"
                      value={entry.issuedDate}
                      onChange={(issuedDate) => update({ issuedDate })}
                    />
                    <Field
                      id={`${prefix}-credential`}
                      label="Credential ID (optional)"
                      value={entry.credentialId}
                      onChange={(credentialId) => update({ credentialId })}
                      max={200}
                    />
                    <Field
                      id={`${prefix}-url`}
                      label="Certificate link (optional)"
                      value={entry.url}
                      onChange={(url) => update({ url })}
                      max={500}
                      wide
                      placeholder="https://…"
                    />
                    <Field
                      id={`${prefix}-description`}
                      label="Certificate details (optional)"
                      value={entry.description}
                      onChange={(description) => update({ description })}
                      max={4000}
                      multiline
                      wide
                    />
                  </EntryCard>
                );
              })}
              <AddEntry
                label="Add certificate"
                count={draft.certifications.length}
                onClick={() => {
                  const entry = newCertification();
                  edit("certifications", [...draft.certifications, entry]);
                  focusField(`resume-${entry.id}-name`);
                }}
              />
            </FormSection>
          </div>
          <section
            className="resume-preview-column"
            aria-label="Resume preview"
          >
            <div className="resume-preview-toolbar">
              <div>
                <span className="resume-preview-eyebrow">LIVE PREVIEW</span>
                <p>Choose your layout</p>
              </div>
              <div className="resume-templates" aria-label="Resume templates">
                {Object.entries(templates).map(([id, name]) => (
                  <button
                    key={id}
                    className={`a-pill${draft.template === id ? " on" : ""}`}
                    aria-pressed={draft.template === id}
                    onClick={() =>
                      edit("template", id as ResumeDraft["template"])
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div id="resumePreview">
              <ResumePreview draft={draft} />
            </div>
            <p className="resume-preview-note">
              Single-column, text-based layouts for easy scanning. Review your
              PDF before applying.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
