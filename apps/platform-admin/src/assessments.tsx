import { useEffect, useState } from "react";
import type {
  Announcement,
  LiveExam,
  Organization,
  PracticeAssessment,
} from "@slate/contracts";
import { DataState, Empty, Field, Panel, useData } from "@slate/ui";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";

export function DemoAssessments() {
  const organizations = useData<Organization[]>(
      "organizations",
      "platform/organizations",
    ),
    [organizationId, setOrganizationId] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    if (!organizationId && organizations.data?.length)
      setOrganizationId(
        (
          organizations.data.find(
            (item) => item.name === "Northstar Institute of Technology · Demo",
          ) || organizations.data[0]
        ).id,
      );
  }, [organizationId, organizations.data]);
  const data = useData<{
    sample: boolean;
    practice: PracticeAssessment[];
    exams: LiveExam[];
    announcements: Announcement[];
  }>(
    `demo-preview:${organizationId}`,
    `platform/demo-preview?organizationId=${organizationId}`,
    Boolean(organizationId),
  );
  const filtered = (data.data?.practice || []).filter((item) =>
    `${item.title} ${item.topics?.join(" ") || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  return (
    <AdminPage
      title="Assessments & live exams"
      description="Sample assessment content and schedules for the local product preview."
      action={
        <div className="admin-header-tools">
          <div className="admin-header-select">
            <Field label="Preview organization">
              <AdminSelect
                aria-label="Preview organization"
                value={organizationId}
                onChange={setOrganizationId}
                searchable
                placeholder="Select an organization"
                options={(organizations.data || []).map(organization => ({ value: organization.id, label: organization.name }))}
              />
            </Field>
          </div>
        </div>
      }
    >
      <DataState pending={data.isPending} error={data.error}>
        {data.data?.sample ? (
          <>
            <p className="success-note">
              Local sample data. These fixtures are visible to sample learners;
              this screen does not publish official assessments or configure
              invigilation.
            </p>
            <Panel title="Exam schedule">
              <div className="grid">
                {data.data.exams.map((exam) => (
                  <article className="card" key={exam.id}>
                    <span
                      className={`badge ${exam.state === "live" ? "green" : "amber"}`}
                    >
                      {exam.state}
                    </span>
                    <h2>{exam.title}</h2>
                    <p>
                      {exam.questionCount} questions · {exam.durationMinutes}{" "}
                      minutes
                    </p>
                    <p>
                      Starts {new Date(exam.startsAt).toLocaleString("en-IN")}
                    </p>
                    <small className="muted">
                      Sample audience: enrolled demo learners
                    </small>
                  </article>
                ))}
              </div>
            </Panel>
            <Panel
              title={`${data.data.practice.length} sample practice activities`}
            >
              <Field label="Search sample activities">
                <input
                  value={search}
                  placeholder="Title or topic"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <p className="muted">
                {filtered.length} matching activities · 200 coding problems
                across 20 topics
              </p>
              <div className="grid">
                {filtered
                  .slice((currentPage - 1) * 20, currentPage * 20)
                  .map((assessment) => (
                    <article className="card" key={assessment.id}>
                      <span className="badge">
                        {assessment.kind} · {assessment.difficulty}
                      </span>
                      <h2>{assessment.title}</h2>
                      <p>{assessment.description}</p>
                      <small>
                        {assessment.durationMinutes} minutes ·{" "}
                        {assessment.questions?.length || 1}{" "}
                        {assessment.questions ? "questions" : "activity"}
                      </small>
                      <details>
                        <summary>Preview content</summary>
                        {assessment.questions ? (
                          assessment.questions.map((question) => (
                            <p key={question.id}>
                              <b>{question.prompt}</b>
                              <br />
                              Answer: {question.options[question.answer]}
                            </p>
                          ))
                        ) : (
                          <p>
                            {assessment.problem?.statement ||
                              assessment.passage ||
                              assessment.checklist?.join(" · ")}
                          </p>
                        )}
                      </details>
                    </article>
                  ))}
              </div>
              <div className="actions">
                <button
                  className="btn"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="btn"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </Panel>
            <Panel title="Sample announcements">
              {data.data.announcements.map((message) => (
                <article className="integration-row" key={message.id}>
                  <div>
                    <h3>{message.title}</h3>
                    <p>{message.body}</p>
                    <small>
                      {message.from} ·{" "}
                      {new Date(message.date).toLocaleDateString("en-IN")}
                    </small>
                  </div>
                </article>
              ))}
            </Panel>
          </>
        ) : (
          data.data && (
            <Empty title="No demo suite for this organization">
              The sample suite is scoped to seeded demo organizations. Official
              question banks and exam administration remain separate
              implementation work.
            </Empty>
          )
        )}
      </DataState>
    </AdminPage>
  );
}
