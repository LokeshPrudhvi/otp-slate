import type { ResumeDraft } from "./resume-model";

const hasText = (value: string) => Boolean(value.trim());

function monthLabel(value: string) {
  if (!value) return "";
  const [year, month] = value.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[Number(month) - 1]} ${year}`;
}

function DateRange({
  start,
  end,
  current,
  expected = false,
}: {
  start: string;
  end: string;
  current: boolean;
  expected?: boolean;
}) {
  const endLabel =
    current && expected && end
      ? `Expected ${monthLabel(end)}`
      : current
        ? "Present"
        : monthLabel(end);
  const label = [monthLabel(start), endLabel].filter(Boolean).join(" – ");
  return label ? <span className="resume-entry-dates">{label}</span> : null;
}

function Bullets({ items }: { items: string[] }) {
  const filled = items.filter(hasText);
  return filled.length ? (
    <ul className="resume-bullets">
      {filled.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  ) : null;
}

export function ResumePreview({ draft }: { draft: ResumeDraft }) {
  const skills = draft.skills.filter(hasText);
  const projects = draft.projects.filter(
    (entry) =>
      [entry.title, entry.description, entry.url].some(hasText) ||
      entry.bullets.some(hasText),
  );
  const experience = draft.experience.filter(
    (entry) =>
      [
        entry.title,
        entry.company,
        entry.startDate,
        entry.endDate,
        entry.description,
      ].some(hasText) || entry.bullets.some(hasText),
  );
  const education = draft.education.filter((entry) =>
    [
      entry.institution,
      entry.degree,
      entry.fieldOfStudy,
      entry.startDate,
      entry.endDate,
      entry.grade,
      entry.description,
    ].some(hasText),
  );
  const certifications = draft.certifications.filter((entry) =>
    [
      entry.name,
      entry.issuer,
      entry.issuedDate,
      entry.credentialId,
      entry.url,
      entry.description,
    ].some(hasText),
  );
  const populated =
    hasText(draft.summary) ||
    skills.length ||
    projects.length ||
    experience.length ||
    education.length ||
    certifications.length;

  return (
    <article
      className={`resume-paper template-${draft.template}`}
      aria-label="Live resume preview"
    >
      <header>
        <h1>{draft.name || "Your name"}</h1>
        {hasText(draft.title) && (
          <p className="resume-headline">{draft.title}</p>
        )}
        <p className="resume-contact">
          {[draft.email, draft.phone, draft.location, draft.links]
            .filter(hasText)
            .join(" | ") || "Email | Phone | Location | Portfolio"}
        </p>
      </header>
      {hasText(draft.summary) && (
        <section>
          <h2>Professional Summary</h2>
          <p>{draft.summary}</p>
        </section>
      )}
      {skills.length > 0 && (
        <section>
          <h2>Skills</h2>
          <ul className="resume-skills">
            {skills.map((skill, index) => (
              <li key={index}>{skill}</li>
            ))}
          </ul>
        </section>
      )}
      {experience.length > 0 && (
        <section>
          <h2>Experience</h2>
          {experience.map((entry) => (
            <div key={entry.id} className="resume-entry">
              <div className="resume-entry-heading">
                {hasText(entry.title) && (
                  <h3 className="resume-entry-title">{entry.title}</h3>
                )}
                <DateRange
                  start={entry.startDate}
                  end={entry.endDate}
                  current={entry.current}
                />
              </div>
              {hasText(entry.company) && (
                <p className="resume-entry-subtitle">{entry.company}</p>
              )}
              {hasText(entry.description) && (
                <p className="resume-entry-description">{entry.description}</p>
              )}
              <Bullets items={entry.bullets} />
            </div>
          ))}
        </section>
      )}
      {projects.length > 0 && (
        <section>
          <h2>Projects</h2>
          {projects.map((entry) => (
            <div key={entry.id} className="resume-entry">
              {hasText(entry.title) && (
                <h3 className="resume-entry-title">{entry.title}</h3>
              )}
              {hasText(entry.url) && (
                <p className="resume-entry-link">{entry.url}</p>
              )}
              {hasText(entry.description) && (
                <p className="resume-entry-description">{entry.description}</p>
              )}
              <Bullets items={entry.bullets} />
            </div>
          ))}
        </section>
      )}
      {education.length > 0 && (
        <section>
          <h2>Education</h2>
          {education.map((entry) => (
            <div key={entry.id} className="resume-entry">
              <div className="resume-entry-heading">
                {hasText(entry.institution) && (
                  <h3 className="resume-entry-title">{entry.institution}</h3>
                )}
                <DateRange
                  start={entry.startDate}
                  end={entry.endDate}
                  current={entry.current}
                  expected
                />
              </div>
              {(hasText(entry.degree) || hasText(entry.fieldOfStudy)) && (
                <p className="resume-entry-subtitle">
                  {[entry.degree, entry.fieldOfStudy]
                    .filter(hasText)
                    .join(" · ")}
                </p>
              )}
              {hasText(entry.grade) && <p>Grade: {entry.grade}</p>}
              {hasText(entry.description) && (
                <p className="resume-entry-description">{entry.description}</p>
              )}
            </div>
          ))}
        </section>
      )}
      {certifications.length > 0 && (
        <section>
          <h2>Certifications</h2>
          {certifications.map((entry) => (
            <div key={entry.id} className="resume-entry">
              <div className="resume-entry-heading">
                {hasText(entry.name) && (
                  <h3 className="resume-entry-title">{entry.name}</h3>
                )}
                {entry.issuedDate && (
                  <span className="resume-entry-dates">
                    {monthLabel(entry.issuedDate)}
                  </span>
                )}
              </div>
              {hasText(entry.issuer) && (
                <p className="resume-entry-subtitle">{entry.issuer}</p>
              )}
              {hasText(entry.credentialId) && (
                <p>Credential ID: {entry.credentialId}</p>
              )}
              {hasText(entry.url) && (
                <p className="resume-entry-link">{entry.url}</p>
              )}
              {hasText(entry.description) && (
                <p className="resume-entry-description">{entry.description}</p>
              )}
            </div>
          ))}
        </section>
      )}
      {!populated && (
        <div className="resume-placeholder">
          Fill in your details to build your resume.
          <br />
          Only completed sections appear here.
        </div>
      )}
    </article>
  );
}
