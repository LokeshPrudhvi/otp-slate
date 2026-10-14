import { useState } from "react";
import {
  examLanguages,
  type ExamAudienceOptions,
  type ExamDraft,
  type ExamLanguage,
  type ExamQuestion,
} from "@slate/contracts";
import { Field, QuestionImageEditor, RichTextEditor } from "@slate/ui";
import { AdminSelect } from "./select";
import {
  examLimits,
  isoDateTime,
  localDateTime,
  newExamQuestion,
} from "./exam-utils";

export function ExamBuilder({
  value,
  onChange,
  audience,
  disabled = false,
  onImagePending,
}: {
  value: ExamDraft;
  onChange: (draft: ExamDraft) => void;
  audience: ExamAudienceOptions | undefined;
  disabled?: boolean;
  onImagePending: (questionId: string, pending: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [openQuestion, setOpenQuestion] = useState<string | null>(
    value.questions[0]?.id || null,
  );
  const [starterLanguage, setStarterLanguage] =
    useState<ExamLanguage>("Python");
  const patch = (data: Partial<ExamDraft>) => onChange({ ...value, ...data });
  const editQuestion = (id: string, question: ExamQuestion) =>
    patch({
      questions: value.questions.map((item) =>
        item.id === id ? question : item,
      ),
    });
  const toggle = (items: string[], id: string) =>
    items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
  const scopedAudience =
    audience?.organizationId === value.organizationId ? audience : undefined;
  const branchCode =
    value.audience.branchCodes.length === 1
      ? value.audience.branchCodes[0]
      : "";
  const selectedBranch = scopedAudience?.branches.find(
    (branch) => branch.code === branchCode,
  );
  const students = (scopedAudience?.students || []).filter(
    (student) =>
      selectedBranch &&
      student.branchCode === selectedBranch.code &&
      `${student.name} ${student.email} ${student.studentId || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visibleStudents = students.slice(0, 100);
  const add = (kind: "mcq" | "coding") => {
    const question = newExamQuestion(kind);
    patch({ questions: [...value.questions, question] });
    setOpenQuestion(question.id);
  };
  function move(index: number, delta: number) {
    const questions = [...value.questions];
    [questions[index], questions[index + delta]] = [
      questions[index + delta],
      questions[index],
    ];
    patch({ questions });
  }
  return (
    <div className="exam-builder">
      <section className="exam-form-card">
        <header>
          <span className="eyebrow">01 / EXAM DETAILS</span>
          <h2>What are students taking?</h2>
        </header>
        <Field label="Exam title">
          <input
            required
            maxLength={150}
            value={value.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="Campus placement assessment"
          />
        </Field>
        <Field label="Short description">
          <textarea
            maxLength={2000}
            rows={3}
            value={value.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder="Help students understand what this exam covers."
          />
        </Field>
        <Field label="Instructions">
          <RichTextEditor
            disabled={disabled}
            format="markdown"
            label="Exam instructions"
            value={value.instructions}
            onChange={(instructions) => patch({ instructions })}
            maxLength={10000}
          />
        </Field>
        <div className="form-grid">
          <Field label="Opens at">
            <input
              required
              type="datetime-local"
              value={localDateTime(value.startsAt)}
              onChange={(event) =>
                patch({ startsAt: isoDateTime(event.target.value) })
              }
            />
          </Field>
          <Field label="Closes at">
            <input
              required
              type="datetime-local"
              value={localDateTime(value.endsAt)}
              onChange={(event) =>
                patch({ endsAt: isoDateTime(event.target.value) })
              }
            />
          </Field>
          <Field label="Time per student (minutes)">
            <input
              required
              type="number"
              min={1}
              max={480}
              value={value.durationMinutes}
              onChange={(event) =>
                patch({ durationMinutes: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Passing score (%)">
            <input
              required
              type="number"
              min={0}
              max={100}
              value={value.passingPercentage}
              onChange={(event) =>
                patch({ passingPercentage: Number(event.target.value) })
              }
            />
          </Field>
        </div>
        <p className="muted">
          Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Each
          attempt ends at its time limit or the exam closing time, whichever
          comes first.
        </p>
      </section>
      <section className="exam-form-card">
        <header>
          <span className="eyebrow">02 / AUDIENCE</span>
          <h2>Who should receive this exam?</h2>
        </header>
        <p className="exam-info">
          {scopedAudience?.organizationName || "Select an organization above"} ·
          one branch per exam. Students in other organizations or branches will
          not receive it.
        </p>
        {(value.audience.mode === "organization" ||
          value.audience.branchCodes.length > 1) && (
          <p className="exam-info" role="status">
            This draft uses an older audience selection. Choose one branch
            before saving or publishing.
          </p>
        )}
        <div className="form-grid">
          <Field label="Branch">
            <AdminSelect
              aria-label="Exam branch"
              searchable
              disabled={disabled || !scopedAudience}
              value={selectedBranch?.code || ""}
              onChange={(code) => {
                patch({
                  audience: {
                    mode:
                      value.audience.mode === "students"
                        ? "students"
                        : "branches",
                    branchCodes: code ? [code] : [],
                    studentIds: [],
                  },
                });
                setSearch("");
              }}
              options={[
                { value: "", label: "Choose a branch in this organization" },
                ...(scopedAudience?.branches || []).map((branch) => ({
                  value: branch.code,
                  label: `${branch.name} (${branch.code}) · ${branch.studentCount} students`,
                })),
              ]}
            />
          </Field>
          <Field label="Assign to">
            <AdminSelect
              aria-label="Exam audience"
              disabled={disabled || !selectedBranch}
              value={
                value.audience.mode === "students" ? "students" : "branches"
              }
              onChange={(mode) => {
                patch({
                  audience: {
                    mode: mode as "branches" | "students",
                    branchCodes: selectedBranch ? [selectedBranch.code] : [],
                    studentIds: [],
                  },
                });
                setSearch("");
              }}
              options={[
                {
                  value: "branches",
                  label: "All eligible students in this branch",
                },
                {
                  value: "students",
                  label: "Selected students in this branch",
                },
              ]}
            />
          </Field>
        </div>
        {scopedAudience && !scopedAudience.branches.length && (
          <p className="muted">
            Create a branch under this organization before scheduling an exam.
          </p>
        )}
        {selectedBranch && value.audience.mode !== "students" && (
          <p className="muted">
            {selectedBranch.studentCount} active students in{" "}
            {selectedBranch.name}. Only students with live-exam access are
            included when you publish.
          </p>
        )}
        {selectedBranch && value.audience.mode === "students" && (
          <>
            <input
              type="search"
              aria-label="Search exam audience"
              placeholder="Search this branch by student name, email or ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="exam-audience-tools">
              <span>{value.audience.studentIds.length} selected</span>
              <button
                type="button"
                className="link"
                onClick={() =>
                  patch({
                    audience: {
                      ...value.audience,
                      studentIds: [
                        ...new Set([
                          ...value.audience.studentIds,
                          ...visibleStudents.map((student) => student.id),
                        ]),
                      ],
                    },
                  })
                }
              >
                Select visible
              </button>
              <button
                type="button"
                className="link"
                onClick={() =>
                  patch({ audience: { ...value.audience, studentIds: [] } })
                }
              >
                Clear selection
              </button>
            </div>
            <div className="exam-audience-list">
              {visibleStudents.map((student) => (
                <label key={student.id}>
                  <input
                    type="checkbox"
                    checked={value.audience.studentIds.includes(student.id)}
                    onChange={() =>
                      patch({
                        audience: {
                          ...value.audience,
                          studentIds: toggle(
                            value.audience.studentIds,
                            student.id,
                          ),
                        },
                      })
                    }
                  />
                  <span>
                    <strong>{student.name}</strong>
                    <small>
                      {student.email} · {student.studentId || "No student ID"} ·{" "}
                      {student.branchCode}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            {!students.length && (
              <p className="muted">No matching students in this branch.</p>
            )}
            {students.length > 100 && (
              <p className="muted">
                Showing the first 100 matches. Refine your search to find more
                students.
              </p>
            )}
          </>
        )}
        <p className="muted">
          The eligible roster is fixed when you publish. Later branch changes or
          new students do not change a published exam’s audience.
        </p>
      </section>
      <section className="exam-form-card">
        <header>
          <span className="eyebrow">03 / BROWSER MONITORING</span>
          <h2>Exam environment</h2>
        </header>
        <label className="exam-check">
          <input
            type="checkbox"
            checked={value.monitoring.enabled}
            onChange={(event) =>
              patch({
                monitoring: {
                  enabled: event.target.checked,
                  requireFullscreen:
                    event.target.checked && value.monitoring.requireFullscreen,
                  recordClipboard:
                    event.target.checked && value.monitoring.recordClipboard,
                },
              })
            }
          />
          <span>
            <strong>Monitor browser events</strong>
            <small>
              Record tab switches, focus changes and connection changes during
              the attempt.
            </small>
          </span>
        </label>
        <label className="exam-check">
          <input
            type="checkbox"
            disabled={!value.monitoring.enabled}
            checked={value.monitoring.requireFullscreen}
            onChange={(event) =>
              patch({
                monitoring: {
                  ...value.monitoring,
                  requireFullscreen: event.target.checked,
                },
              })
            }
          />
          <span>Require full-screen mode</span>
        </label>
        <label className="exam-check">
          <input
            type="checkbox"
            disabled={!value.monitoring.enabled}
            checked={value.monitoring.recordClipboard}
            onChange={(event) =>
              patch({
                monitoring: {
                  ...value.monitoring,
                  recordClipboard: event.target.checked,
                },
              })
            }
          />
          <span>Record copy, paste and cut events</span>
        </label>
        <p className="muted">
          Monitoring records events for review. It does not capture the screen,
          webcam or clipboard contents, and an event alone is not evidence of
          misconduct.
        </p>
      </section>
      <section className="exam-form-card">
        <p className="exam-info">
          Multiple-choice answers are scored automatically. Students submit
          coding answers as text; an administrator reviews each answer and
          awards marks.
        </p>
        <header className="exam-question-header">
          <div>
            <span className="eyebrow">04 / QUESTIONS</span>
            <h2>
              {value.questions.length} questions ·{" "}
              {value.questions.reduce((sum, q) => sum + q.points, 0)} points
            </h2>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={value.questions.length >= examLimits.questions}
              onClick={() => add("mcq")}
            >
              + Multiple choice
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                value.questions.length >= examLimits.questions ||
                value.questions.filter((q) => q.kind === "coding").length >=
                  examLimits.coding
              }
              onClick={() => add("coding")}
            >
              + Coding
            </button>
          </div>
        </header>
        {!value.questions.length && (
          <p className="exam-info">
            Add your first question. Combine multiple-choice and coding
            questions in one exam.
          </p>
        )}
        {value.questions.map((q, index) => (
          <article className="exam-question" key={q.id}>
            <header>
              <button
                type="button"
                className="exam-question-toggle"
                aria-expanded={openQuestion === q.id}
                onClick={() =>
                  setOpenQuestion(openQuestion === q.id ? null : q.id)
                }
              >
                <span className="exam-question-number">{index + 1}</span>
                <span>
                  <strong>
                    {q.title ||
                      `Untitled ${q.kind === "mcq" ? "multiple-choice" : "coding"} question`}
                  </strong>
                  <small>
                    {q.kind === "mcq" ? "Multiple choice" : "Coding"} ·{" "}
                    {q.points} points
                  </small>
                </span>
                <span aria-hidden="true">
                  {openQuestion === q.id ? "−" : "+"}
                </span>
              </button>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move question ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move question ${index + 1} down`}
                  disabled={index === value.questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="link exam-danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove question ${index + 1}? This removes its draft content.`,
                      )
                    )
                      patch({
                        questions: value.questions.filter(
                          (item) => item.id !== q.id,
                        ),
                      });
                  }}
                >
                  Remove
                </button>
              </div>
            </header>
            {openQuestion === q.id && (
              <div className="exam-question-body">
                <div className="form-grid">
                  <Field label="Question title">
                    <input
                      required
                      maxLength={200}
                      value={q.title}
                      onChange={(event) =>
                        editQuestion(q.id, { ...q, title: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Points">
                    <input
                      required
                      type="number"
                      min={1}
                      max={1000}
                      value={q.points}
                      onChange={(event) =>
                        editQuestion(q.id, {
                          ...q,
                          points: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label="Question prompt">
                  <RichTextEditor
                    disabled={disabled}
                    format="markdown"
                    label={`Question ${index + 1} prompt`}
                    value={q.prompt}
                    maxLength={20000}
                    onChange={(prompt) => editQuestion(q.id, { ...q, prompt })}
                  />
                </Field>
                {q.kind === "mcq" ? (
                  <>
                    <QuestionImageEditor
                      image={q.image}
                      label={`Question ${index + 1} image`}
                      disabled={disabled}
                      onChange={(image) => editQuestion(q.id, { ...q, image })}
                      onPending={(pending) => onImagePending(q.id, pending)}
                    />
                    <div className="exam-options">
                      <p className="muted">
                        Select the radio button beside the correct answer.
                      </p>
                      {q.options.map((option, optionIndex) => (
                        <div className="exam-option" key={optionIndex}>
                          <input
                            type="radio"
                            aria-label={`Option ${optionIndex + 1} is correct`}
                            name={`answer-${q.id}`}
                            checked={q.correctOption === optionIndex}
                            onChange={() =>
                              editQuestion(q.id, {
                                ...q,
                                correctOption: optionIndex,
                              })
                            }
                          />
                          <input
                            aria-label={`Option ${optionIndex + 1}`}
                            required
                            maxLength={2000}
                            value={option}
                            onChange={(event) =>
                              editQuestion(q.id, {
                                ...q,
                                options: q.options.map((item, i) =>
                                  i === optionIndex ? event.target.value : item,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="link"
                            aria-label={`Remove option ${optionIndex + 1}`}
                            disabled={q.options.length <= 2}
                            onClick={() =>
                              editQuestion(q.id, {
                                ...q,
                                options: q.options.filter(
                                  (_, i) => i !== optionIndex,
                                ),
                                correctOption:
                                  q.correctOption === optionIndex
                                    ? 0
                                    : q.correctOption > optionIndex
                                      ? q.correctOption - 1
                                      : q.correctOption,
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn"
                        disabled={q.options.length >= 8}
                        onClick={() =>
                          editQuestion(q.id, {
                            ...q,
                            options: [...q.options, ""],
                          })
                        }
                      >
                        + Add option
                      </button>
                    </div>
                    <Field label="Answer explanation (shown with released results)">
                      <textarea
                        rows={3}
                        maxLength={5000}
                        value={q.explanation}
                        onChange={(event) =>
                          editQuestion(q.id, {
                            ...q,
                            explanation: event.target.value,
                          })
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <p className="exam-info">
                      Describe the problem and what a complete answer should
                      include. Students enter their code in a text box and
                      submit it for your review. Add examples or expected output
                      to the prompt when helpful.
                    </p>
                    <fieldset className="exam-language-list">
                      <legend>Allowed languages</legend>
                      {examLanguages.map((language) => (
                        <label key={language}>
                          <input
                            type="checkbox"
                            checked={q.languages.includes(language)}
                            onChange={() => {
                              const languages = toggle(
                                q.languages,
                                language,
                              ) as ExamLanguage[];
                              editQuestion(q.id, {
                                ...q,
                                languages,
                                starterCode: Object.fromEntries(
                                  Object.entries(q.starterCode).filter(
                                    ([key]) =>
                                      languages.includes(key as ExamLanguage),
                                  ),
                                ),
                              });
                            }}
                          />
                          {language}
                        </label>
                      ))}
                    </fieldset>
                    {q.languages.length > 0 && (
                      <>
                        <Field label="Starter code language">
                          <AdminSelect
                            aria-label="Starter code language"
                            value={
                              q.languages.includes(starterLanguage)
                                ? starterLanguage
                                : q.languages[0]
                            }
                            onChange={(language) =>
                              setStarterLanguage(language as ExamLanguage)
                            }
                            options={q.languages.map((language) => ({
                              value: language,
                              label: language,
                            }))}
                          />
                        </Field>
                        <Field label="Starter code (optional)">
                          <textarea
                            className="exam-code"
                            rows={8}
                            spellCheck={false}
                            maxLength={30000}
                            value={
                              q.starterCode[
                                q.languages.includes(starterLanguage)
                                  ? starterLanguage
                                  : q.languages[0]
                              ] || ""
                            }
                            onChange={(event) =>
                              editQuestion(q.id, {
                                ...q,
                                starterCode: {
                                  ...q.starterCode,
                                  [q.languages.includes(starterLanguage)
                                    ? starterLanguage
                                    : q.languages[0]]: event.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
