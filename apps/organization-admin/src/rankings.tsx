import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Analytics } from "@slate/contracts";
import { OrgCard, OrgGlyph } from "./workspace";
import "./rankings.css";

const rankingMetrics = [
  { key: "average", label: "Overall score" },
  { key: "aptitude", label: "Aptitude" },
  { key: "coding", label: "Coding" },
  { key: "interview", label: "Interview" },
] as const;
type RankingMetric = (typeof rankingMetrics)[number]["key"];
const pageSize = 10;
const scoreText = (value: number) =>
  Number.isFinite(value)
    ? `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value)}%`
    : "—";
const sortValue = (value: number) =>
  Number.isFinite(value) ? value : -Infinity;
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export function RankingsTable({ data }: { data: Analytics }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [metric, setMetric] = useState<RankingMetric>("average");
  const [page, setPage] = useState(0);
  const roster = new Map(data.students.map((student) => [student.id, student]));
  const results = data.performance?.results ?? [];
  const ranked = [...results]
    .sort(
      (a, b) =>
        sortValue(b[metric]) - sortValue(a[metric]) ||
        b.attempts - a.attempts ||
        a.name.localeCompare(b.name),
    )
    .map((student, index) => ({
      ...student,
      rank: index + 1,
      email: roster.get(student.studentId)?.email ?? "",
    }));
  const query = search.trim().toLowerCase();
  const filtered = ranked.filter((student) =>
    `${student.name} ${student.email}`.toLowerCase().includes(query),
  );
  const pageCount = Math.ceil(filtered.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * pageSize;
  const visible = filtered.slice(start, start + pageSize);
  const reset = () => {
    setSearch("");
    setMetric("average");
    setPage(0);
  };

  return (
    <OrgCard
      title="Student rankings"
      description="See individual strengths and discover your top performers."
      className="org-ranking-card"
      action={
        data.performance && (
          <span className="org-ranking-sample">Sample results</span>
        )
      }
    >
      {results.length ? (
        <>
          <div className="org-ranking-toolbar">
            <label className="org-ranking-search">
              <OrgGlyph name="search" />
              <span className="org-ranking-sr-only">
                Search student rankings by name or email
              </span>
              <input
                type="search"
                placeholder="Search by name or email…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="org-ranking-controls">
              <label className="org-ranking-sort">
                <span>Rank by</span>
                <select
                  aria-label="Rank students by"
                  value={metric}
                  onChange={(event) => {
                    setMetric(event.target.value as RankingMetric);
                    setPage(0);
                  }}
                >
                  {rankingMetrics.map((item) => (
                    <option value={item.key} key={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {(search || metric !== "average") && (
                <button
                  type="button"
                  className="org-ranking-reset"
                  onClick={reset}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          <div
            className="org-ranking-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Student rankings table, scroll horizontally for all scores"
          >
            <table className="org-ranking-table">
              <caption className="org-ranking-sr-only">
                Student rankings, ordered by{" "}
                {rankingMetrics
                  .find((item) => item.key === metric)
                  ?.label.toLowerCase()}
                . Equal scores are ordered by practice attempts, then name.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Student</th>
                  <th
                    scope="col"
                    aria-sort={metric === "aptitude" ? "descending" : undefined}
                  >
                    Aptitude
                  </th>
                  <th
                    scope="col"
                    aria-sort={metric === "coding" ? "descending" : undefined}
                  >
                    Coding
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      metric === "interview" ? "descending" : undefined
                    }
                  >
                    Interview
                  </th>
                  <th
                    scope="col"
                    aria-sort={metric === "average" ? "descending" : undefined}
                  >
                    Overall
                  </th>
                  <th scope="col">Attempts</th>
                  <th scope="col">
                    <span className="org-ranking-sr-only">Student profile</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((student) => (
                  <tr
                    key={student.studentId}
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest("a, button"))
                        navigate(`/students/${student.studentId}`);
                    }}
                  >
                    <td>
                      <span
                        className={`org-ranking-position${student.rank <= 3 ? " org-ranking-position-leading" : ""}`}
                      >
                        {String(student.rank).padStart(2, "0")}
                      </span>
                    </td>
                    <td>
                      <div className="org-ranking-person">
                        <span
                          className={`org-ranking-avatar org-ranking-avatar-${student.name.charCodeAt(0) % 4}`}
                          aria-hidden="true"
                        >
                          {initials(student.name)}
                        </span>
                        <div>
                          <Link to={`/students/${student.studentId}`}>
                            {student.name}
                          </Link>
                          <span>{student.email || "Email unavailable"}</span>
                        </div>
                      </div>
                    </td>
                    <td
                      className={
                        metric === "aptitude"
                          ? "org-ranking-selected-score"
                          : undefined
                      }
                    >
                      {scoreText(student.aptitude)}
                    </td>
                    <td
                      className={
                        metric === "coding"
                          ? "org-ranking-selected-score"
                          : undefined
                      }
                    >
                      {scoreText(student.coding)}
                    </td>
                    <td
                      className={
                        metric === "interview"
                          ? "org-ranking-selected-score"
                          : undefined
                      }
                    >
                      {scoreText(student.interview)}
                    </td>
                    <td>
                      <span
                        className={`org-ranking-overall${metric === "average" ? " org-ranking-selected-score" : ""}`}
                      >
                        {scoreText(student.average)}
                      </span>
                    </td>
                    <td>
                      <span className="org-ranking-attempts">
                        {student.attempts}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="org-ranking-open"
                        to={`/students/${student.studentId}`}
                        aria-label={`View ${student.name}'s profile`}
                      >
                        <OrgGlyph name="arrow" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="org-ranking-empty">
                <span className="org-ranking-empty-icon">
                  <OrgGlyph name="search" />
                </span>
                <h3>No matching students</h3>
                <p>Try another name or email, or clear your search.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPage(0);
                  }}
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
          <div className="org-ranking-footer">
            <p>
              {filtered.length ? (
                <>
                  <strong>
                    {start + 1}–{Math.min(start + pageSize, filtered.length)}
                  </strong>{" "}
                  of {filtered.length} students
                </>
              ) : (
                "0 students"
              )}
              {query && filtered.length !== results.length
                ? ` · ${results.length} total`
                : ""}
            </p>
            <nav aria-label="Student rankings pagination">
              <button
                type="button"
                className="org-ranking-page-button org-ranking-previous"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <OrgGlyph name="arrow" />
                <span>Previous</span>
              </button>
              <span className="org-ranking-page-count">
                {pageCount ? `${currentPage + 1} / ${pageCount}` : "0 / 0"}
              </span>
              <button
                type="button"
                className="org-ranking-page-button"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <span>Next</span>
                <OrgGlyph name="arrow" />
              </button>
            </nav>
          </div>
          <p className="org-ranking-note">
            Sample practice results, separate from official exam results. Ties
            are ordered by practice attempts, then name.
          </p>
        </>
      ) : (
        <div className="org-ranking-empty">
          <span className="org-ranking-empty-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <h3>No ranked students yet</h3>
          <p>
            Student rankings will appear when assessment results are available.
          </p>
        </div>
      )}
    </OrgCard>
  );
}

export function OrganizationRankings({ data }: { data: Analytics }) {
  const count = data.performance?.results.length ?? 0;
  return (
    <div className="org-ranking-page">
      <header className="org-ranking-page-heading">
        <div>
          <p className="org-ranking-eyebrow">STUDENT PERFORMANCE</p>
          <h1>Student rankings</h1>
          <p>
            Recognize progress, compare skills, and explore every student’s
            potential.
          </p>
        </div>
        <div className="org-ranking-summary">
          <span className="org-ranking-summary-dot" />
          <strong>{count}</strong>
          <span>ranked {count === 1 ? "student" : "students"}</span>
        </div>
      </header>
      <RankingsTable data={data} />
    </div>
  );
}
