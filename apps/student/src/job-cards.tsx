import { useEffect, useState } from "react";
import type { Job } from "@slate/contracts";
import { useMe } from "@slate/ui";
import "./job-cards.css";
function Bookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 20V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15l-6-4-6 4Z" />
    </svg>
  );
}
function JobCard({
  job,
  saved,
  onSave,
}: {
  job: Job;
  saved: boolean;
  onSave: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [job.companyLogoUrl]);
  const palette = [...job.company].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
  let host = "Original application page";
  try {
    host = new URL(job.url).hostname.replace(/^www\./, "");
  } catch {
    /* A legacy link can still display its original posting label. */
  }
  const initials = job.company
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <article className={`job-opportunity job-opportunity--${palette}`}>
      <div className="job-opportunity-body">
        <div className="job-opportunity-top">
          <time dateTime={job.postedAt}>
            {new Date(job.postedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </time>
          <button
            type="button"
            className={`job-save${saved ? " is-saved" : ""}`}
            aria-label={`${saved ? "Unsave" : "Save"} ${job.title} at ${job.company}`}
            title={saved ? "Remove saved job" : "Save job on this device"}
            aria-pressed={saved}
            onClick={onSave}
          >
            <Bookmark filled={saved} />
          </button>
        </div>
        <div className="job-opportunity-heading">
          <div>
            <p className="job-company-name">{job.company}</p>
            <h2>{job.title}</h2>
          </div>
          <span className="job-company-logo">
            {job.companyLogoUrl && !imageFailed ? (
              <img
                src={job.companyLogoUrl}
                alt={`${job.company} logo`}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span aria-label={job.company}>{initials}</span>
            )}
          </span>
        </div>
        <p className="job-opportunity-description" title={job.description}>
          {job.description}
        </p>
        <div className="job-opportunity-tags">
          <span>Job opportunity</span>
          <span>External application ↗</span>
        </div>
      </div>
      <footer className="job-opportunity-footer">
        <div>
          <b>View the original posting</b>
          <span title={host}>{host}</span>
        </div>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${job.title} at ${job.company}`}
        >
          View job <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </article>
  );
}
export function JobCards({ jobs }: { jobs: Job[] }) {
  const me = useMe(),
    key = `slate:saved-jobs:${me.data?.id ?? "guest"}`;
  const [stored, setStored] = useState<{ key: string; ids: string[] }>(() => ({
    key,
    ids: readSaved(key),
  }));
  const [onlySaved, setOnlySaved] = useState(false);
  useEffect(() => {
    setStored({ key, ids: readSaved(key) });
    setOnlySaved(false);
  }, [key]);
  const ids = stored.key === key ? stored.ids : [];
  function save(id: string) {
    setStored((current) => {
      const previous = current.key === key ? current.ids : readSaved(key),
        next = previous.includes(id)
          ? previous.filter((item) => item !== id)
          : [...previous, id];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* The active session can still use saved jobs if browser storage is unavailable. */
      }
      return { key, ids: next };
    });
  }
  const visible = onlySaved ? jobs.filter((job) => ids.includes(job.id)) : jobs;
  return (
    <section aria-label="Job opportunities">
      <div className="job-catalog-toolbar">
        <p role="status">
          {visible.length}{" "}
          {visible.length === 1 ? "opportunity" : "opportunities"}
        </p>
        <button
          className={`a-btn job-saved-filter${onlySaved ? " on" : ""}`}
          aria-pressed={onlySaved}
          onClick={() => setOnlySaved(!onlySaved)}
        >
          <Bookmark filled={onlySaved} />
          {onlySaved ? "Show all jobs" : "Saved jobs"}
        </button>
      </div>
      {visible.length ? (
        <div className="jobs-card-grid">
          {visible.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              saved={ids.includes(job.id)}
              onSave={() => save(job.id)}
            />
          ))}
        </div>
      ) : (
        <p className="job-empty-saved">
          No saved jobs match your search. Save an opportunity using its
          bookmark.
        </p>
      )}
    </section>
  );
}
function readSaved(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
