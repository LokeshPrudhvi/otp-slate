import { Link, useSearchParams } from "react-router-dom";
import type { Analytics } from "@slate/contracts";
import "./students.css";

type Student = Analytics["students"][number];
const pageSize = 10;
const score = (value: number) => Math.max(0, Math.min(100, value));
const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)}%`;
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
const statusLabel = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1);
const mean = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={back ? "M19 12H5m6-6-6 6 6 6" : "M5 12h14m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span
      className={`org-students-status ${value === "active" ? "is-active" : "is-inactive"}`}
    >
      <i />
      {statusLabel(value)}
    </span>
  );
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const tone =
    name.split("").reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  return (
    <span
      className={`org-students-avatar tone-${tone}${large ? " is-large" : ""}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string | number;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={`org-students-stat${accent ? " is-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="org-students-empty">
      <span aria-hidden="true">◎</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function Completion({ student }: { student: Student }) {
  return (
    <div className="org-students-completion">
      <div>
        <strong>{percent(student.completion)}</strong>
        <span>
          {student.totalLessons
            ? `${student.completedLessons}/${student.totalLessons} lessons`
            : "No assigned lessons"}
        </span>
      </div>
      <progress
        value={score(student.completion ?? 0)}
        max={100}
        aria-label={`${student.name}: ${percent(student.completion)} course completion`}
      />
    </div>
  );
}

export function OrganizationStudents({ data }: { data: Analytics }) {
  const [params, setParams] = useSearchParams();
  const search = params.get("q") || "";
  const status = params.get("status") || "all";
  const sort = params.get("sort") || "completion";
  const focus = params.get("focus") || "";
  const results = new Map(
    data.performance?.results.map((result) => [result.studentId, result]) || [],
  );
  const statuses = [
    ...new Set(data.students.map((student) => student.status)),
  ].sort();
  const measured = data.students.filter(
    (student) => student.completion !== null,
  );
  const averageCompletion = mean(
    measured.map((student) => student.completion!),
  );
  const averageScore = mean(
    [...results.values()]
      .filter((result) =>
        data.students.some((student) => student.id === result.studentId),
      )
      .map((result) => result.average),
  );
  const filtered = data.students
    .filter(
      (student) =>
        `${student.name} ${student.email}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (status === "all" || student.status === status) &&
        (focus === "unassigned"
          ? student.assignedCourses === 0
          : focus === "early"
            ? student.assignedCourses > 0 && (student.completion ?? 0) < 25
            : true),
    )
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "score")
        return (
          (results.get(b.id)?.average ?? -1) -
            (results.get(a.id)?.average ?? -1) || a.name.localeCompare(b.name)
        );
      return (
        (b.completion ?? -1) - (a.completion ?? -1) ||
        a.name.localeCompare(b.name)
      );
    });
  const pages = Math.ceil(filtered.length / pageSize);
  const requestedPage = Number(params.get("page") || 1);
  const page = Math.max(
    1,
    Math.min(
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1,
      pages || 1,
    ),
  );
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: key === "q" });
  };
  return (
    <div className="org-students-page">
      <header className="org-students-heading">
        <div>
          <span className="org-students-eyebrow">PEOPLE & PERFORMANCE</span>
          <h1>Student insights</h1>
          <p>A closer look at every learner, and where they can go next.</p>
        </div>
        <span className="org-students-count">
          {data.students.length} students
        </span>
      </header>
      <div className="org-students-stats">
        <Stat
          label="Total students"
          value={data.students.length}
          note="Across your organization"
        />
        <Stat
          label="Active accounts"
          value={
            data.students.filter((student) => student.status === "active")
              .length
          }
          note="Accounts currently enabled"
        />
        <Stat
          label="Average completion"
          value={percent(averageCompletion)}
          note={`${measured.length} students with assigned lessons`}
          accent
        />
        <Stat
          label="Practice score"
          value={percent(averageScore)}
          note={
            data.performance
              ? "Sample assessment average"
              : "Awaiting assessment results"
          }
        />
      </div>
      <section
        className="org-students-card"
        aria-labelledby="student-directory-title"
      >
        <div className="org-students-card-heading">
          <div>
            <h2 id="student-directory-title">Your students</h2>
            <p>Follow learning progress and explore individual performance.</p>
          </div>
          {data.performance && (
            <span className="org-students-sample">
              Sample assessment scores
            </span>
          )}
        </div>
        <div className="org-students-toolbar">
          <label className="org-students-search">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="10.8"
                cy="10.8"
                r="6.4"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="m16 16 4 4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              aria-label="Search students by name or email"
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => update("q", event.target.value)}
            />
          </label>
          <label className="org-students-select">
            <span>Account status</span>
            <select
              aria-label="Filter student account status"
              value={status}
              onChange={(event) => update("status", event.target.value)}
            >
              <option value="all">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="org-students-select">
            <span>Sort by</span>
            <select
              aria-label="Sort students"
              value={sort}
              onChange={(event) => update("sort", event.target.value)}
            >
              <option value="completion">Highest completion</option>
              <option value="name">Name A–Z</option>
              {data.performance && (
                <option value="score">Highest practice score</option>
              )}
            </select>
          </label>
        </div>
        {(search || status !== "all" || focus || sort !== "completion") && (
          <div className="org-students-active-filters">
            <span>
              {focus === "unassigned"
                ? "No assigned courses"
                : focus === "early"
                  ? "Early in their learning · below 25% completion"
                  : "Filtered student view"}
            </span>
            <button type="button" onClick={() => setParams({})}>
              Clear filters <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
        {visible.length ? (
          <div className="org-students-table-wrap">
            <table className="org-students-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Courses</th>
                  <th>Course completion</th>
                  <th>Practice score</th>
                  <th>Account status</th>
                  <th>
                    <span className="org-students-sr-only">View student</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <Link
                        className="org-students-identity"
                        to={`/students/${student.id}`}
                      >
                        <Avatar name={student.name} />
                        <span>
                          <strong>{student.name}</strong>
                          <small>{student.email}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="org-students-course-count">
                        {student.assignedCourses}
                      </span>
                    </td>
                    <td>
                      <Completion student={student} />
                    </td>
                    <td>
                      <span
                        className={`org-students-score${results.has(student.id) ? " has-score" : ""}`}
                      >
                        {percent(results.get(student.id)?.average ?? null)}
                      </span>
                    </td>
                    <td>
                      <Status value={student.status} />
                    </td>
                    <td>
                      <Link
                        className="org-students-row-link"
                        to={`/students/${student.id}`}
                        aria-label={`View ${student.name}'s insights`}
                      >
                        <Arrow />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              data.students.length
                ? "No students match your filters"
                : "Your students will appear here"
            }
            detail={
              data.students.length
                ? "Try another name, email address or account status."
                : "Student insights become available when Platform Admin adds students to your organization."
            }
          />
        )}
        <div className="org-students-pagination">
          <span>
            {filtered.length
              ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length} students`
              : "0 students"}
          </span>
          <div>
            <button
              type="button"
              aria-label="Previous student page"
              disabled={page <= 1}
              onClick={() => update("page", String(page - 1))}
            >
              <Arrow back />
              Previous
            </button>
            <span>
              {page} / {pages || 1}
            </span>
            <button
              type="button"
              aria-label="Next student page"
              disabled={page >= pages}
              onClick={() => update("page", String(page + 1))}
            >
              Next
              <Arrow />
            </button>
          </div>
        </div>
      </section>
      <p className="org-students-footnote">
        Course completion measures finished lessons. Practice scores measure
        assessment performance
        {data.performance
          ? " and are illustrative sample results in this preview"
          : " when results are available"}
        .
      </p>
    </div>
  );
}

export function OrganizationStudentDetail({
  data,
  id,
}: {
  data: Analytics;
  id: string;
}) {
  const student = data.students.find((item) => item.id === id);
  const assessment = data.performance?.results.find(
    (result) => result.studentId === id,
  );
  const cohortResults =
    data.performance?.results.filter((result) =>
      data.students.some((item) => item.id === result.studentId),
    ) || [];
  const skills = [
    {
      key: "aptitude",
      name: "Aptitude",
      description: "Quantitative & logical reasoning",
    },
    {
      key: "coding",
      name: "Coding",
      description: "Programming & problem solving",
    },
    {
      key: "interview",
      name: "Interview",
      description: "Communication & interview skills",
    },
  ] as const;
  if (!student)
    return (
      <div className="org-students-page">
        <Link className="org-students-back" to="/students">
          <Arrow back />
          Back to student insights
        </Link>
        <div className="org-students-card">
          <EmptyState
            title="Student not found"
            detail="This student is not available in your organization."
          />
        </div>
      </div>
    );
  const remaining = Math.max(
    0,
    student.totalLessons - student.completedLessons,
  );
  const averageCompletion = mean(
    data.students
      .filter((item) => item.completion !== null)
      .map((item) => item.completion!),
  );
  const completionDelta =
    student.completion !== null && averageCompletion !== null
      ? Math.round(student.completion - averageCompletion)
      : null;
  const strongest = assessment
    ? [...skills].sort((a, b) => assessment[b.key] - assessment[a.key])[0]
    : null;
  const development = assessment
    ? [...skills].sort((a, b) => assessment[a.key] - assessment[b.key])[0]
    : null;
  return (
    <div className="org-students-page">
      <Link className="org-students-back" to="/students">
        <Arrow back />
        Back to student insights
      </Link>
      <section className="org-students-profile">
        <div className="org-students-profile-identity">
          <Avatar name={student.name} large />
          <div>
            <span className="org-students-eyebrow">STUDENT PROFILE</span>
            <h1>{student.name}</h1>
            <p>{student.email}</p>
          </div>
        </div>
        <div className="org-students-profile-meta">
          <Status value={student.status} />
          <span>{data.organization.name}</span>
        </div>
      </section>
      <div className="org-students-stats">
        <Stat
          label="Assigned courses"
          value={student.assignedCourses}
          note="Current course enrollments"
        />
        <Stat
          label="Completed lessons"
          value={student.completedLessons}
          note={`Out of ${student.totalLessons} assigned lessons`}
        />
        <Stat
          label="Course completion"
          value={percent(student.completion)}
          note={
            completionDelta === null
              ? "No lessons assigned yet"
              : completionDelta === 0
                ? "Matches the organization average"
                : `${Math.abs(completionDelta)} pts ${completionDelta > 0 ? "above" : "below"} organization average`
          }
          accent
        />
        <Stat
          label="Practice score"
          value={percent(assessment?.average ?? null)}
          note={
            assessment
              ? `${assessment.attempts} sample practice attempts`
              : "No assessment results available"
          }
        />
      </div>
      <div className="org-students-detail-grid">
        <section
          className="org-students-card org-students-skills"
          aria-labelledby="student-skills-heading"
        >
          <div className="org-students-card-heading">
            <div>
              <h2 id="student-skills-heading">Skill performance</h2>
              <p>Understand strengths and areas for development.</p>
            </div>
            {assessment && (
              <span className="org-students-sample">Sample data</span>
            )}
          </div>
          {assessment ? (
            <>
              <div className="org-students-legend">
                <span>
                  <i />
                  {student.name.split(" ")[0]}
                </span>
                <span>
                  <i />
                  Organization average
                </span>
              </div>
              <div className="org-students-skills-list">
                {skills.map((skill) => {
                  const average = mean(
                    cohortResults.map((result) => result[skill.key]),
                  );
                  return (
                    <div className="org-students-skill" key={skill.key}>
                      <div className="org-students-skill-label">
                        <span>
                          <strong>{skill.name}</strong>
                          <small>{skill.description}</small>
                        </span>
                        <strong>{percent(assessment[skill.key])}</strong>
                      </div>
                      <div
                        className="org-students-comparison-bars"
                        role="img"
                        aria-label={`${skill.name}: student ${assessment[skill.key]}%, organization average ${average ?? 0}%`}
                      >
                        <div>
                          <span
                            style={{
                              width: `${score(assessment[skill.key])}%`,
                            }}
                          />
                        </div>
                        <div>
                          <span style={{ width: `${score(average ?? 0)}%` }} />
                        </div>
                      </div>
                      <span className="org-students-skill-average">
                        Organization average {percent(average)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="org-students-card-note">
                Illustrative practice results for this preview. These are
                separate from official exam scores.
              </p>
            </>
          ) : (
            <EmptyState
              title="No assessment results yet"
              detail="Skill comparisons appear when student assessment results are available."
            />
          )}
        </section>
        <section
          className="org-students-card org-students-learning"
          aria-labelledby="student-learning-heading"
        >
          <div className="org-students-card-heading">
            <div>
              <h2 id="student-learning-heading">Learning progress</h2>
              <p>Completion across assigned lessons.</p>
            </div>
          </div>
          {student.totalLessons ? (
            <>
              <div className="org-students-ring">
                <svg
                  viewBox="0 0 180 180"
                  role="img"
                  aria-label={`${percent(student.completion)} of lessons completed`}
                >
                  <circle
                    cx="90"
                    cy="90"
                    r="73"
                    fill="none"
                    stroke="#edf1ee"
                    strokeWidth="13"
                  />
                  <circle
                    cx="90"
                    cy="90"
                    r="73"
                    fill="none"
                    stroke="#318477"
                    strokeWidth="13"
                    strokeLinecap={student.completion ? "round" : "butt"}
                    pathLength="100"
                    strokeDasharray={`${score(student.completion ?? 0)} 100`}
                    transform="rotate(-90 90 90)"
                  />
                </svg>
                <div>
                  <strong>{percent(student.completion)}</strong>
                  <span>completed</span>
                </div>
              </div>
              <div className="org-students-learning-breakdown">
                <div>
                  <span>
                    <i />
                    Completed lessons
                  </span>
                  <strong>{student.completedLessons}</strong>
                </div>
                <div>
                  <span>
                    <i />
                    Remaining lessons
                  </span>
                  <strong>{remaining}</strong>
                </div>
                <div>
                  <span>Assigned courses</span>
                  <strong>{student.assignedCourses}</strong>
                </div>
              </div>
              <p className="org-students-card-note">
                Completion reflects recorded lesson progress, not a test score.
              </p>
            </>
          ) : (
            <EmptyState
              title="Ready to start learning"
              detail="Learning progress appears after courses with lessons are assigned."
            />
          )}
        </section>
      </div>
      {assessment && strongest && development && (
        <section
          className="org-students-insight-strip"
          aria-label="Assessment insights"
        >
          <div>
            <span className="org-students-insight-icon" aria-hidden="true">
              ↗
            </span>
            <div>
              <span>Strongest assessed skill</span>
              <strong>
                {strongest.name} <small>· {assessment[strongest.key]}%</small>
              </strong>
            </div>
          </div>
          <div>
            <span
              className="org-students-insight-icon is-amber"
              aria-hidden="true"
            >
              ◎
            </span>
            <div>
              <span>Lowest assessed skill</span>
              <strong>
                {development.name}{" "}
                <small>· {assessment[development.key]}%</small>
              </strong>
            </div>
          </div>
          <p>
            Based on sample practice scores. Use these comparisons as a starting
            point for a learning conversation.
          </p>
        </section>
      )}
    </div>
  );
}
