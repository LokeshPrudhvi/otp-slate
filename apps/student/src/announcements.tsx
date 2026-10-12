import { useState } from "react";
import type { Announcement } from "@slate/contracts";
import { LessonContent } from "@slate/ui";
import { useStudentData } from "./access";
import { Heading, NoResults, Status, StudentIcon } from "./design";

export function AnnouncementsPage() {
  const announcements = useStudentData<Announcement[]>(
    "announcements",
    "student/announcements",
  );
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const messages = [...(announcements.data ?? [])]
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .filter((message) =>
      [
        message.title,
        message.body,
        message.from,
        message.branchName,
        message.branchCode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );

  return (
    <div className="a-page student-announcements">
      <Heading title="Announcements">
        <button
          type="button"
          className="a-btn"
          onClick={() => void announcements.refetch()}
          disabled={announcements.isFetching}
        >
          {announcements.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </Heading>
      <div className="student-announcements-intro">
        <span className="student-announcements-icon">
          <StudentIcon name="ann" />
        </span>
        <div>
          <h2>Updates for your learning community</h2>
          <p>
            Notices shared with your organization and your branch, all in one
            place.
          </p>
        </div>
      </div>
      <div className="student-announcements-toolbar">
        <p className="hub-note" role="status">
          {announcements.data &&
            `${messages.length} ${messages.length === 1 ? "announcement" : "announcements"} · Newest first`}
        </p>
        <input
          type="search"
          className="a-search"
          aria-label="Search announcements"
          placeholder="Search announcements"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Status pending={announcements.isPending} error={announcements.error} />
      {announcements.data &&
        (messages.length ? (
          <div className="student-announcements-list">
            {messages.map((message) => (
              <article
                className="student-announcement"
                key={message.id}
                aria-labelledby={`announcement-${message.id}`}
              >
                <div className="student-announcement-meta">
                  <span className="a-tag student-announcement-audience">
                    {message.branchCode
                      ? `${message.branchName || message.branchCode}${message.branchName && message.branchName !== message.branchCode ? ` (${message.branchCode})` : ""}`
                      : "Entire organization"}
                  </span>
                  {message.sample && (
                    <span className="a-tag">Sample announcement</span>
                  )}
                  <time dateTime={message.date}>
                    {new Date(message.date).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <h2 id={`announcement-${message.id}`}>{message.title}</h2>
                <p className="student-announcement-sender">
                  {message.from}
                  {message.organizationName && ` · ${message.organizationName}`}
                </p>
                <LessonContent
                  body={message.body}
                  format={message.format ?? "plain"}
                />
              </article>
            ))}
          </div>
        ) : (
          <NoResults
            title={query ? "No matching announcements" : "No announcements yet"}
            action={
              query ? (
                <button
                  className="a-btn"
                  type="button"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              ) : undefined
            }
          >
            {query
              ? "Try a different title, keyword or branch."
              : "Updates will appear here when your administrator publishes a notice for your organization or branch."}
          </NoResults>
        ))}
    </div>
  );
}
