import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Course, CourseCatalogItem } from "@slate/contracts";
import { api } from "@slate/ui";
import { courseAppearance, courseTrackNames, heroBackground } from "./design";
import "./course-cards.css";

/** Keep the same ordering for the dashboard and the enrolled catalogue. */
export function recentlyOpened<T extends Course>(courses: T[]): T[] {
  return [...courses].sort((left, right) => {
    const leftOpened = Date.parse(left.lastOpenedAt || "") || 0;
    const rightOpened = Date.parse(right.lastOpenedAt || "") || 0;
    return (
      rightOpened - leftOpened ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function CourseCard({
  course,
  enrolled = true,
}: {
  course: Course | CourseCatalogItem;
  enrolled?: boolean;
}) {
  const client = useQueryClient();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const appearance = courseAppearance(course);
  const category =
    courseTrackNames[course.track] ||
    (course.track === "foundation" ? "Foundation courses" : "Learning courses");
  const image =
    course.coverImageUrl && failedImage !== course.coverImageUrl
      ? course.coverImageUrl
      : null;
  const request = useMutation({
    mutationFn: () =>
      api<{ id: string; status: "pending" | "reviewed" }>(
        `student/courses/${course.id}/enrollment-requests`,
        "POST",
      ),
    onSuccess: (result) => {
      client.setQueriesData<CourseCatalogItem[]>(
        { queryKey: ["student", "course-catalog"] },
        (items) =>
          items?.map((item) =>
            item.id === course.id
              ? { ...item, enrollmentRequestStatus: result.status }
              : item,
          ),
      );
      void client.invalidateQueries({
        queryKey: ["student", "course-catalog"],
      });
    },
  });
  const requestStatus =
    request.data?.status ||
    ("enrollmentRequestStatus" in course
      ? course.enrollmentRequestStatus
      : null);
  const messageId = `course-request-${course.id}`;
  const pattern = [...course.id].reduce(
    (value, letter) => value + letter.charCodeAt(0),
    0,
  );
  return (
    <article
      className="learning-card"
      aria-labelledby={`course-title-${course.id}`}
    >
      <div
        className="learning-card-cover"
        style={{ background: heroBackground(appearance.color, pattern) }}
        aria-hidden="true"
      >
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedImage(image)}
          />
        ) : (
          <>
            <span className="learning-card-orbit" />
            <span className="learning-card-glyph">{appearance.glyph}</span>
            <span className="learning-card-cover-label">
              LEARN AT YOUR PACE
            </span>
          </>
        )}
      </div>
      <div className="learning-card-body">
        <div className="learning-card-meta">
          <span className="learning-card-category">{category}</span>
          <span
            className={`learning-card-status${enrolled ? " is-enrolled" : requestStatus ? " is-requested" : ""}`}
          >
            {enrolled
              ? "Enrolled"
              : requestStatus === "pending"
                ? "Requested"
                : requestStatus === "reviewed"
                  ? "Reviewed"
                  : "Available"}
          </span>
        </div>
        <h3 id={`course-title-${course.id}`}>{course.title}</h3>
        <p className="learning-card-description">
          {course.description ||
            "Build your knowledge with guided, self-paced lessons."}
        </p>
        <div className="learning-card-footer">
          {enrolled ? (
            <Link
              className="learning-card-action"
              to={`/courses/${course.id}`}
              aria-label={`${course.lastOpenedAt ? "Continue" : "Open"} ${course.title}`}
            >
              {course.lastOpenedAt ? "Continue learning" : "Open course"}
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <button
              type="button"
              className="learning-card-action"
              disabled={request.isPending || Boolean(requestStatus)}
              aria-describedby={
                requestStatus || request.isError ? messageId : undefined
              }
              onClick={() => request.mutate()}
            >
              {request.isPending
                ? "Sending request…"
                : requestStatus === "pending"
                  ? "Enrollment requested"
                  : requestStatus === "reviewed"
                    ? "Request reviewed"
                    : "Request enrollment"}
              <span aria-hidden="true">{requestStatus ? "✓" : "+"}</span>
            </button>
          )}
          {!enrolled && requestStatus && (
            <p
              className="learning-card-request-note"
              id={messageId}
              role="status"
            >
              {requestStatus === "pending"
                ? "Your request is with the admin. Access opens after approval."
                : "Your request has been reviewed. Contact your organization for access."}
            </p>
          )}
          {!enrolled && !requestStatus && request.isError && (
            <p
              className="learning-card-request-error"
              id={messageId}
              role="alert"
            >
              {request.error.message ||
                "Unable to send your request. Please try again."}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
