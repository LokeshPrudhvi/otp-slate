import { CompanyLogoField } from "./company-logo";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  PlacementResource,
  PlacementResourceInput,
} from "@slate/contracts";
import {
  api,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  Panel,
  useData,
} from "@slate/ui";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";
import "./placement.css";
const blank = (
  kind: PlacementResourceInput["kind"],
): PlacementResourceInput => ({
  kind,
  title: "",
  provider: "",
  description: "",
  logoUrl: "",
  logoId: null,
  url: "",
  hiringProcedure: "",
  papers: [],
  practiceQuestions: [],
  status: "draft",
});
export function PlacementAdmin({
  kind,
}: {
  kind: PlacementResourceInput["kind"];
}) {
  const query = useQueryClient(),
    data = useData<PlacementResource[]>(
      `placement:${kind}`,
      `platform/placement?kind=${kind}`,
    );
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(() => blank(kind)),
    [notice, setNotice] = useState(""),
    [logoPending, setLogoPending] = useState(false);
  const company = kind === "company";
  const save = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: PlacementResourceInput;
    }) =>
      api<PlacementResource>(
        `platform/placement${id ? "/" + id : ""}`,
        id ? "PUT" : "POST",
        input,
      ),
    onSuccess: () => {
      void query.invalidateQueries({
        queryKey: ["platform", `placement:${kind}`],
      });
      setEditing(null);
      setDraft(blank(kind));
      setNotice(
        "Resource saved. Published resources are available to eligible students across organizations.",
      );
    },
  });
  const change = <K extends keyof PlacementResourceInput>(
    key: K,
    value: PlacementResourceInput[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <AdminPage
      title={
        company ? "Company preparation · PYQ" : "Free certification courses"
      }
      description={
        company
          ? "Publish company hiring procedures, paper links and practice questions."
          : "Share third-party learning and certification links with all organizations."
      }
    >
      <div className="placement-admin-layout">
        <Panel
          title={
            editing
              ? "Edit resource"
              : company
                ? "Add company training"
                : "Add certification course"
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (logoPending || save.isPending) return;
              setNotice("");
              save.mutate({ id: editing, input: draft });
            }}
          >
            <Field label={company ? "Company name" : "Course title"}>
              <input
                required
                maxLength={180}
                value={draft.title}
                onChange={(event) => {
                  change("title", event.target.value);
                  if (company) {
                    change("provider", event.target.value);
                    change("logoId", null);
                    change("logoUrl", "");
                  }
                }}
              />
            </Field>
            {!company && (
              <Field label="Provider (for example Google or Cisco)">
                <input
                  required
                  maxLength={150}
                  value={draft.provider}
                  onChange={(event) => change("provider", event.target.value)}
                />
              </Field>
            )}
            {company ? (
              <>
                <CompanyLogoField
                  company={draft.title}
                  value={draft.logoId ?? null}
                  onChange={(id) =>
                    setDraft((current) => ({
                      ...current,
                      logoId: id,
                      logoUrl: id ? "" : current.logoUrl,
                    }))
                  }
                  onPending={setLogoPending}
                />
                {!draft.logoId && (
                  <details className="placement-logo-url">
                    <summary>Use an existing logo URL</summary>{" "}
                    <Field label="Logo URL">
                      <input
                        type="text"
                        inputMode="url"
                        placeholder="https://…"
                        required={company && draft.status === "published"}
                        value={draft.logoUrl}
                        onChange={(event) =>
                          change("logoUrl", event.target.value)
                        }
                      />
                    </Field>
                  </details>
                )}
              </>
            ) : (
              <>
                {" "}
                <Field label="Logo URL">
                  <input
                    type="text"
                    inputMode="url"
                    placeholder="https://…"
                    required={company && draft.status === "published"}
                    value={draft.logoUrl}
                    onChange={(event) => change("logoUrl", event.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Description">
              <textarea
                rows={3}
                maxLength={5000}
                value={draft.description}
                onChange={(event) => change("description", event.target.value)}
              />
            </Field>
            {!company ? (
              <Field label="Original course link">
                <input
                  type="url"
                  placeholder="https://…"
                  required={draft.status === "published"}
                  value={draft.url}
                  onChange={(event) => change("url", event.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="Hiring Procedure">
                  <textarea
                    rows={6}
                    maxLength={12000}
                    value={draft.hiringProcedure}
                    onChange={(event) =>
                      change("hiringProcedure", event.target.value)
                    }
                  />
                </Field>
                <h3>Previous year / Model question papers</h3>
                {draft.papers.map((paper, index) => (
                  <div className="placement-input-row" key={index}>
                    <Field label={`Paper ${index + 1} title`}>
                      <input
                        required
                        value={paper.title}
                        onChange={(event) =>
                          change(
                            "papers",
                            draft.papers.map((row, i) =>
                              i === index
                                ? { ...row, title: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Paper link">
                      <input
                        type="text"
                        inputMode="url"
                        placeholder="https://…"
                        required
                        value={paper.url}
                        onChange={(event) =>
                          change(
                            "papers",
                            draft.papers.map((row, i) =>
                              i === index
                                ? { ...row, url: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </Field>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={`Remove paper ${index + 1}`}
                      onClick={() =>
                        change(
                          "papers",
                          draft.papers.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  disabled={draft.papers.length >= 100}
                  onClick={() =>
                    change("papers", [...draft.papers, { title: "", url: "" }])
                  }
                >
                  ＋ Add paper link
                </button>
                <h3>Practice questions</h3>
                {draft.practiceQuestions.map((question, index) => (
                  <div className="placement-input-row" key={index}>
                    <Field label={`Question ${index + 1}`}>
                      <textarea
                        required
                        rows={3}
                        value={question.question}
                        onChange={(event) =>
                          change(
                            "practiceQuestions",
                            draft.practiceQuestions.map((row, i) =>
                              i === index
                                ? { ...row, question: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Answer / Explanation">
                      <textarea
                        rows={3}
                        value={question.answer}
                        onChange={(event) =>
                          change(
                            "practiceQuestions",
                            draft.practiceQuestions.map((row, i) =>
                              i === index
                                ? { ...row, answer: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </Field>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={`Remove question ${index + 1}`}
                      onClick={() =>
                        change(
                          "practiceQuestions",
                          draft.practiceQuestions.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  disabled={draft.practiceQuestions.length >= 100}
                  onClick={() =>
                    change("practiceQuestions", [
                      ...draft.practiceQuestions,
                      { question: "", answer: "" },
                    ])
                  }
                >
                  ＋ Add practice question
                </button>
              </>
            )}
            {company && (
              <div className="placement-readiness">
                <strong>Company guide checklist</strong>
                <ul>
                  {[
                    ["Company logo", Boolean(draft.logoUrl || draft.logoId)],
                    ["Hiring procedure", Boolean(draft.hiringProcedure.trim())],
                    ["Question papers", Boolean(draft.papers.length)],
                    [
                      "Practice questions",
                      Boolean(draft.practiceQuestions.length),
                    ],
                  ].map(([label, ready]) => (
                    <li key={String(label)} data-ready={ready}>
                      <span>{ready ? "✓" : "○"}</span>
                      {label}
                    </li>
                  ))}
                </ul>
                <p>
                  Publish a complete guide to make it visible in Student → PYQ.
                </p>
              </div>
            )}
            <Field label="Publication status">
              <AdminSelect
                value={draft.status}
                onChange={(value) =>
                  change("status", value as PlacementResourceInput["status"])
                }
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "published", label: "Published" },
                  { value: "archived", label: "Archived" },
                ]}
              />
            </Field>
            <p className="muted">
              Shared across all organizations. Students need{" "}
              {company ? "PYQ" : "Careers"} access to view
              published resources.
            </p>
            <ErrorMessage error={save.error} />
            {notice && (
              <p role="status" className="note">
                {notice}
              </p>
            )}
            <div className="placement-admin-actions">
              <button
                className="button primary"
                disabled={save.isPending || logoPending}
              >
                {save.isPending
                  ? "Saving…"
                  : draft.status === "published"
                    ? "Publish resource"
                    : "Save resource"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEditing(null);
                    setDraft(blank(kind));
                    save.reset();
                  }}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </Panel>
        <Panel title="Your resources">
          <DataState pending={data.isPending} error={data.error}>
            {null}
          </DataState>
          {data.data?.length
            ? data.data.map((item) => (
                <article className="placement-admin-card" key={item.id}>
                  <div className="placement-resource-brand">
                    {item.logoUrl && (
                      <img src={item.logoUrl} alt={`${item.title} logo`} />
                    )}
                    <span className="badge">{item.status}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                  {company && (
                    <div className="placement-resource-counts">
                      <span>
                        ◎ Hiring procedure{" "}
                        {item.hiringProcedure ? "✓" : "missing"}
                      </span>
                      <span>▤ {item.papers.length} papers</span>
                      <span>✦ {item.practiceQuestions.length} questions</span>
                    </div>
                  )}
                  <div className="placement-admin-actions">
                    <button
                      className="button secondary"
                      disabled={save.isPending}
                      onClick={() => {
                        setEditing(item.id);
                        const { id, updatedAt, ...input } = item;
                        setDraft({
                          ...input,
                          logoUrl: input.logoId ? "" : input.logoUrl,
                        });
                        save.reset();
                        setNotice("");
                      }}
                    >
                      Edit
                    </button>
                    {item.status !== "archived" && (
                      <button
                        className="button secondary"
                        disabled={save.isPending}
                        onClick={() => {
                          const { id, updatedAt, ...input } = item;
                          save.mutate({
                            id,
                            input: {
                              ...input,
                              logoUrl: input.logoId ? "" : input.logoUrl,
                              status: "archived",
                            },
                          });
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </article>
              ))
            : data.data && (
                <Empty title="No resources yet">
                  Create your first resource, then publish it when ready.
                </Empty>
              )}
        </Panel>
      </div>
    </AdminPage>
  );
}
