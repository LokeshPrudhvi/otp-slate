import { useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { PlacementResource } from "@slate/contracts";
import { useMe } from "@slate/ui";
import { useStudentData } from "./access";
import { Heading, NoResults, Status } from "./design";
import "./career.css";
export function CareerOpportunities({ children }: { children: ReactNode }) {
  const me = useMe(),
    location = useLocation();
  const links = [
    ...(me.data?.features.includes("jobs")
      ? [
          { path: "jobs", label: "Jobs" },
          { path: "certifications", label: "Free certification courses" },
        ]
      : []),
    ...(me.data?.features.includes("resume")
      ? [{ path: "resume", label: "Resume builder" }]
      : []),
  ];
  return (
    <div className="a-page career-page">
      <Heading title="Careers" />
      <nav className="career-tabs" aria-label="Careers">
        {links.map((item) => (
          <Link
            key={item.path}
            to={`/career-opportunities/${item.path}`}
            aria-current={
              location.pathname.endsWith("/" + item.path) ? "page" : undefined
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="career-content">{children}</div>
    </div>
  );
}
function CompanyLogo({ item }: { item: PlacementResource }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="company-logo">
      {item.logoUrl && !failed ? (
        <img
          src={item.logoUrl}
          alt={`${item.title} logo`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        item.title.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function CertificationsPage() {
  const data = useStudentData<PlacementResource[]>(
    "certifications",
    "student/placement?kind=certification",
  );
  return (
    <section>
      <div className="career-intro">
        <span className="hub-eyebrow">LEARN BEYOND THE CLASSROOM</span>
        <h2>Free certification courses</h2>
        <p>
          Explore third-party learning opportunities shared by your placement
          team. Open the provider’s page for course and certification details.
        </p>
      </div>
      <Status pending={data.isPending} error={data.error} />
      {data.data?.length ? (
        <div className="career-resource-grid">
          {data.data.map((item) => (
            <article className="career-resource-card" key={item.id}>
              <CompanyLogo item={item} />
              <span className="a-tag">{item.provider}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <a
                className="a-btn pri"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View course ↗
              </a>
            </article>
          ))}
        </div>
      ) : (
        data.data && (
          <NoResults title="No certification courses yet">
            Courses will appear when your placement team shares them.
          </NoResults>
        )
      )}
    </section>
  );
}
const preparationSections = [
  { id: "hiring", label: "Hiring Procedure", icon: "◎" },
  { id: "papers", label: "Question papers", icon: "▤" },
  { id: "practice", label: "Practice questions", icon: "✦" },
] as const;
export function PyqPage() {
  const data = useStudentData<PlacementResource[]>(
    "pyq",
    "student/placement?kind=company",
  );
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const selected = params.get("company");
  const item = data.data?.find((row) => row.id === selected);
  const section = preparationSections.some(
    (row) => row.id === params.get("section"),
  )
    ? params.get("section")!
    : "hiring";
  const items =
    data.data?.filter((row) =>
      `${row.title} ${row.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ) ?? [];
  const open = (id: string, tab = "hiring") =>
    setParams({ company: id, section: tab });
  return (
    <div className="a-page career-page pyq-page">
      <Status pending={data.isPending} error={data.error} />
      {item ? (
        <section className="company-training">
          <button className="pyq-back" onClick={() => setParams({})}>
            ← All companies
          </button>
          <header className="pyq-detail-hero">
            <CompanyLogo key={item.id} item={item} />
            <div>
              <span className="pyq-eyebrow">COMPANY PREPARATION</span>
              <h1>{item.title}</h1>
              <p>{item.description}</p>
            </div>
            <div className="pyq-detail-counts">
              <span>
                <b>{item.papers.length}</b> papers
              </span>
              <span>
                <b>{item.practiceQuestions.length}</b> practice questions
              </span>
            </div>
          </header>
          <nav
            className="pyq-section-tabs"
            aria-label="Company training sections"
          >
            {preparationSections.map((tab) => (
              <button
                key={tab.id}
                aria-current={section === tab.id ? "page" : undefined}
                onClick={() => open(item.id, tab.id)}
              >
                <span aria-hidden="true">{tab.icon}</span>
                {tab.label}
                {tab.id !== "hiring" && (
                  <small>
                    {tab.id === "papers"
                      ? item.papers.length
                      : item.practiceQuestions.length}
                  </small>
                )}
              </button>
            ))}
          </nav>
          <section
            className="company-section pyq-section-content"
            key={`${item.id}:${section}`}
          >
            {section === "hiring" && (
              <>
                <div className="pyq-section-heading">
                  <span className="pyq-section-icon" aria-hidden="true">
                    ◎
                  </span>
                  <div>
                    <h2>Hiring Procedure</h2>
                    <p>Understand the process before you prepare.</p>
                  </div>
                </div>
                <div className="preserve-lines pyq-hiring-copy">
                  {item.hiringProcedure}
                </div>
                <button
                  className="a-btn pri"
                  onClick={() => open(item.id, "papers")}
                >
                  Explore question papers →
                </button>
              </>
            )}
            {section === "papers" && (
              <>
                <div className="pyq-section-heading">
                  <span className="pyq-section-icon" aria-hidden="true">
                    ▤
                  </span>
                  <div>
                    <h2>Previous year / Model question papers</h2>
                    <p>Open a paper to study its questions and format.</p>
                  </div>
                </div>
                <div className="pyq-paper-grid">
                  {item.papers.map((paper, index) => (
                    <a
                      className="company-paper"
                      href={paper.url}
                      key={`${paper.url}:${index}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="pyq-paper-number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong>{paper.title}</strong>
                      <span>Open paper ↗</span>
                    </a>
                  ))}
                </div>
                {!item.papers.length && <p>No papers have been added yet.</p>}
              </>
            )}
            {section === "practice" && (
              <>
                <div className="pyq-section-heading">
                  <span className="pyq-section-icon" aria-hidden="true">
                    ✦
                  </span>
                  <div>
                    <h2>Practice questions</h2>
                    <p>Try each question, then reveal the explanation.</p>
                  </div>
                </div>
                {item.practiceQuestions.map((question, index) => (
                  <article className="company-question" key={index}>
                    <span className="pyq-question-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{question.question}</h3>
                      <textarea
                        aria-label={`Your answer to question ${index + 1}`}
                        placeholder="Work through your answer…"
                        rows={3}
                      />
                      {question.answer && (
                        <details>
                          <summary>Show explanation</summary>
                          <p className="preserve-lines">{question.answer}</p>
                        </details>
                      )}
                    </div>
                  </article>
                ))}
                <p className="pyq-practice-note">
                  Use this space for self-practice. Written answers are not
                  graded or saved.
                </p>
              </>
            )}
          </section>
        </section>
      ) : (
        <>
          <header className="pyq-hero">
            <div>
              <span className="pyq-eyebrow">PREPARE WITH PURPOSE</span>
              <h1>Company preparation &amp; PYQ</h1>
              <p>
                Know the hiring process. Explore question papers. Practise for
                your next opportunity.
              </p>
            </div>
            <span className="pyq-hero-art" aria-hidden="true">
              ▤<small>✦</small>
            </span>
          </header>
          <div className="pyq-library-toolbar">
            <div>
              <h2>Explore companies</h2>
              <p>
                {data.data
                  ? `${items.length} ${items.length === 1 ? "company" : "companies"} available`
                  : "Your company preparation library"}
              </p>
            </div>
            <input
              className="a-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search companies"
              placeholder="Search a company…"
            />
          </div>
          {selected && data.data && !item && (
            <p role="status" className="hub-note">
              This company training is no longer available. Choose another
              company below.
            </p>
          )}
          {items.length ? (
            <div className="pyq-company-grid">
              {items.map((company, index) => (
                <button
                  className="company-card pyq-company-card"
                  data-tone={index % 4}
                  key={company.id}
                  onClick={() => open(company.id)}
                >
                  <div className="pyq-card-brand">
                    <CompanyLogo item={company} />
                  </div>
                  <h2>{company.title}</h2>
                </button>
              ))}
            </div>
          ) : (
            data.data &&
            !data.error && (
              <NoResults
                title={
                  search
                    ? "No companies match your search"
                    : "Your company preparation library is on its way"
                }
              >
                {search ? (
                  <button className="a-btn" onClick={() => setSearch("")}>
                    Clear search
                  </button>
                ) : (
                  "Company guides will appear here after your platform admin publishes a logo, hiring procedure, question papers and practice questions."
                )}
              </NoResults>
            )
          )}
        </>
      )}
    </div>
  );
}
