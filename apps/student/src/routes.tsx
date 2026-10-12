import { useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Announcement,
  Course,
  Job,
  Lesson,
  LiveExam,
  Ranking,
  PracticeAssessment,
} from "@slate/contracts";
import { api, Protected, useMe } from "@slate/ui";
import {
  Artwork,
  Banner,
  Heading,
  NoResults,
  Status,
  StudentIcon,
  StudentShell,
  courseAppearance,
  heroBackground,
  shade,
  tracks,
} from "./design";
import { StudentLogin, StudentOnboarding, StudentResetPassword } from "./auth";
import { StudentRegistration } from "./registration";
import { ResumePage } from "./resume";
import {
  AssessmentPlayer,
  LiveExamList,
  PracticeCatalogue,
} from "./assessments";
import { CodingLibrary } from "./coding";
import { CompilerPage } from "./compiler";
import { SelfAssessment } from "./self-assessment";
import {
  AccessRoute,
  hasAccess,
  hasToolkitTrack,
  useStudentData as useData,
} from "./access";

type LearningCourse = Course & {
  lessons: Lesson[];
  completedLessonIds: string[];
};
function CourseCard({ course, index }: { course: Course; index: number }) {
  const appearance = courseAppearance(course),
    [menu, setMenu] = useState(false);
  return (
    <article className="a-card">
      <Link
        to={`/courses/${course.id}`}
        className="course-card-link"
        aria-label={`Open ${course.title}`}
      >
        <div
          className="a-hero"
          style={{ background: heroBackground(appearance.color, index) }}
        >
          <span className="a-glyph">{appearance.glyph}</span>
        </div>
        <div className="a-cbody">
          <div
            className="a-ctitle"
            style={{ color: shade(appearance.color, -12) }}
          >
            {course.title}
          </div>
          <div className="a-ccode">
            {tracks.find((track) => track.id === course.track)?.name ||
              (course.track === "foundation"
                ? "Foundation courses"
                : "Learning courses")}
          </div>
          <div className="a-cterm">Assigned version {course.version}</div>
        </div>
        <div className="a-cicons" aria-hidden="true">
          <span>
            <StudentIcon name="ann" />
          </span>
          <span>
            <StudentIcon name="assign" />
          </span>
          <span>
            <StudentIcon name="discussion" />
          </span>
        </div>
      </Link>
      <button
        className="a-kebab"
        aria-label={`Options for ${course.title}`}
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        ⋮
      </button>
      {menu && (
        <div className="course-card-menu">
          <Link to={`/courses/${course.id}`}>Open course →</Link>
          <Link to="/courses">All courses</Link>
        </div>
      )}
    </article>
  );
}
function CourseRow({ course }: { course: Course }) {
  const appearance = courseAppearance(course);
  return (
    <Link className="a-row" to={`/courses/${course.id}`}>
      <span className="a-sw" style={{ background: appearance.color }}>
        {appearance.glyph}
      </span>
      <span>
        <b>{course.title}</b>
        <small>{course.description}</small>
        <span className="a-tags">
          <span className="a-tag ide">Self-paced learning</span>
          <span className="a-tag en">Enrolled · version {course.version}</span>
        </span>
      </span>
    </Link>
  );
}
function ToolkitShortcuts() {
  const me = useMe();
  const available = tracks.filter((track) =>
    hasToolkitTrack(me.data, track.id),
  );
  if (!available.length) return null;
  return (
    <section aria-label="Explore learning paths">
      <p className="hub-eyebrow">
        {me.data?.access?.display.toolkitTitle || "Your Placement Toolkit"}
      </p>
      <div className="hub-shortcuts">
        {available.map((track) => (
          <Link key={track.id} to={`/toolkit/${track.id}`}>
            <span>{track.glyph}</span>
            <b>{track.name}</b>
            <span aria-hidden="true">↗</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
function LiveExamShortcut() {
  const me = useMe();
  const exams = useData<LiveExam[]>("exams", "student/exams"),
    live = exams.data?.find((exam) => exam.state === "live");
  if (live)
    return (
      <section className="live-dash" aria-label="Live exams">
        <div>
          <span className="hub-eyebrow">LIVE EXAMS · SAMPLE</span>
          <h2>{live.title}</h2>
          <p>
            {live.durationMinutes} minutes · {live.questionCount} questions ·
            Available now
          </p>
        </div>
        <Link className="a-btn" to="/live-exams">
          View exam →
        </Link>
      </section>
    );
  return (
    <section className="live-dash" aria-label="Live exams">
      <div>
        <span className="hub-eyebrow">LIVE EXAMS</span>
        <h2>No live exams right now</h2>
        <p>Your next exam will appear here when your institute releases it.</p>
      </div>
      {hasAccess(me.data, "practice") && (
        <Link className="a-btn" to="/practice">
          Explore practice →
        </Link>
      )}
    </section>
  );
}
function Rankings() {
  const me = useMe(),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const visibilityKey = `slate:rankings-visibility:${me.data?.id}`;
  const [visible, setVisible] = useState(() => {
    try {
      return !me.data?.id || localStorage.getItem(visibilityKey) !== "hidden";
    } catch {
      return true;
    }
  });
  const people = useData<Ranking[]>("rankings", "student/rankings", visible);
  function toggleVisibility() {
    const next = !visible;
    setVisible(next);
    if (me.data?.id) {
      try {
        localStorage.setItem(visibilityKey, next ? "visible" : "hidden");
      } catch {
        // The toggle still works when browser storage is unavailable.
      }
    }
  }
  const filtered =
    people.data?.filter((person) =>
      person.name.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  return (
    <aside className="a-aside rankings-panel" aria-label="Student rankings">
      <div className="rankings-head">
        <span className="hub-eyebrow">LEARN · PRACTISE · CLIMB</span>
        <div className="rankings-title-row">
          <h2>Student rankings</h2>
          <button
            type="button"
            className="rankings-visibility-toggle"
            aria-label={
              visible ? "Hide student rankings" : "Show student rankings"
            }
            title={visible ? "Hide student rankings" : "Show student rankings"}
            aria-expanded={visible}
            aria-controls="student-rankings-content"
            onClick={toggleVisibility}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {!visible && <path d="m3 3 18 18" />}
            </svg>
          </button>
        </div>
      </div>
      <div id="student-rankings-content" hidden={!visible}>
        <p className="ranking-note">
          All {people.data?.length ?? "—"} students · Your organization
        </p>
        <div className="ranking-you">
          <b>
            {people.data?.find((person) => person.id === me.data?.id)?.rank ??
              "—"}
          </b>
          <span>
            Your rank<small>{me.data?.name}</small>
          </span>
        </div>
        <p className="ranking-note">
          {people.data?.some((person) => person.sample)
            ? "Sample placement results · Local preview"
            : "Rankings appear when assessment results are published."}
        </p>
        <Status pending={people.isPending} error={people.error} />
        {people.data && (
          <>
            <input
              className="a-search ranking-search"
              type="search"
              aria-label="Search student rankings"
              placeholder="Search students"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
            <div className="ranking-scroll">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(page * 10, page * 10 + 10).map((person) => (
                    <tr
                      key={person.id}
                      className={person.id === me.data?.id ? "is-you" : ""}
                    >
                      <td>{person.rank ?? "—"}</td>
                      <td>
                        {person.name}
                        {person.id === me.data?.id && <small>You</small>}
                      </td>
                      <td>{person.points?.toLocaleString("en-IN") ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <p className="ranking-note">No students match your search.</p>
              )}
            </div>
            {filtered.length > 10 && (
              <div className="ranking-pagination">
                <button
                  className="a-btn"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span>
                  {page + 1} / {Math.ceil(filtered.length / 10)}
                </span>
                <button
                  className="a-btn"
                  disabled={(page + 1) * 10 >= filtered.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
function Dashboard() {
  const me = useMe(),
    courses = useData<Course[]>("courses", "student/courses"),
    [options, setOptions] = useState(false);
  const allowed = (feature: string) => hasAccess(me.data, feature);
  const insights = allowed("rankings") || allowed("self-assessment");
  const display = me.data?.access?.display;
  return (
    <div className="a-page">
      <div className={`a-dash${insights ? "" : " dashboard-wide"}`}>
        <div>
          <Heading title={display?.portalTitle || "Dashboard"}>
            {me.data?.demo && <span className="a-tag">Sample data</span>}
            {allowed("courses") && (
              <Link className="a-btn" to="/courses">
                All courses
              </Link>
            )}
            {(allowed("toolkit") || allowed("live-exams")) && (
              <button
                className="a-btn"
                aria-label="Dashboard options"
                aria-expanded={options}
                onClick={() => setOptions(!options)}
              >
                ⋮
              </button>
            )}
          </Heading>
          {display?.welcomeText && (
            <p className="hub-note">{display.welcomeText}</p>
          )}
          {options && (
            <div className="dashboard-options">
              {allowed("toolkit") && (
                <Link className="a-btn" to="/toolkit">
                  {display?.toolkitTitle || "Placement toolkit"} →
                </Link>
              )}
              {allowed("live-exams") && (
                <Link className="a-btn" to="/live-exams">
                  Live exams →
                </Link>
              )}
            </div>
          )}
          {allowed("toolkit") && <ToolkitShortcuts />}
          {allowed("live-exams") && <LiveExamShortcut />}
          {allowed("courses") && (
            <>
              <h2
                style={{ fontSize: 20, fontWeight: 400, margin: "24px 0 16px" }}
              >
                Continue learning
              </h2>
              <Status pending={courses.isPending} error={courses.error} />
              {courses.data?.length ? (
                <div className="a-cards">
                  {courses.data.map((course, index) => (
                    <CourseCard key={course.id} course={course} index={index} />
                  ))}
                </div>
              ) : (
                !courses.isPending &&
                !courses.error && (
                  <NoResults title="Your courses will appear here">
                    Your organization will assign courses to your account.
                  </NoResults>
                )
              )}
            </>
          )}
          {!me.data?.features.length && (
            <NoResults title="Your workspace is ready">
              Your organization will assign the learning and tools available to
              you.
            </NoResults>
          )}
        </div>
        {insights && (
          <div className="dashboard-insights">
            {allowed("self-assessment") && <SelfAssessment />}
            {allowed("rankings") && <Rankings key={me.data?.id} />}
          </div>
        )}
      </div>
    </div>
  );
}
function Courses() {
  const me = useMe(),
    data = useData<Course[]>("courses", "student/courses"),
    practice = useData<PracticeAssessment[]>("practice", "student/practice"),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("tracks");
  const assigned = data.data || [],
    items = assigned.filter((course) =>
      `${course.title} ${course.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const papers = (practice.data || []).filter(
    (item) =>
      item.kind === "quiz" &&
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="a-page">
      <Heading title="Courses">
        <span style={{ fontSize: 14, color: "#6b7780" }}>
          {assigned.length} courses you can open
        </span>
      </Heading>
      <div className="a-filters">
        {[
          ["tracks", "All courses"],
          ["pyq", "Company PYQs"],
        ]
          .filter(([id]) => id !== "pyq" || hasAccess(me.data, "practice"))
          .map(([id, label]) => (
            <button
              key={id}
              className={`a-pill${category === id ? " on" : ""}`}
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {label}
            </button>
          ))}
        <input
          className="a-search"
          type="search"
          placeholder="Search courses or topics"
          aria-label="Search courses"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Status pending={data.isPending} error={data.error} />
      {data.data && (
        <div id="catalog">
          <section className="a-cat">
            <h2>{category === "pyq" ? "Company PYQs" : "Courses"}</h2>
            <p>
              {category === "pyq"
                ? papers.length
                  ? "Sample company-style practice sets. These are illustrative questions, not actual previous-year company papers."
                  : "Previous-year papers shared by your placement team."
                : "Explore the courses and learning paths assigned to you."}
            </p>
            {category === "pyq" && papers.length ? (
              <div className="a-cgrid">
                {papers.map((paper, index) => (
                  <Link
                    key={paper.id}
                    className="a-row"
                    to={`/practice/${paper.id}`}
                  >
                    <span
                      className="a-sw"
                      style={{
                        background: ["#315f98", "#2f8f72", "#8059a4"][
                          index % 3
                        ],
                      }}
                    >
                      Q
                    </span>
                    <span>
                      <b>{paper.title}</b>
                      <small>
                        {paper.questions?.length} questions · Sample placement
                        paper
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : category === "tracks" && items.length ? (
              <div className="a-cgrid">
                {items.map((course) => (
                  <CourseRow key={course.id} course={course} />
                ))}
              </div>
            ) : (
              <NoResults
                title={
                  category === "pyq"
                    ? "No company papers assigned"
                    : search
                      ? "No matching courses"
                      : "No courses assigned"
                }
              >
                {category === "pyq"
                  ? "Your placement team will publish and assign papers when they are available."
                  : search
                    ? "Try a course name or topic, or clear your search."
                    : "Your assigned courses will appear here."}
              </NoResults>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function useCourse() {
  const { id } = useParams();
  return useData<LearningCourse>(`course-${id}`, `student/courses/${id}`);
}
function CoursePage() {
  const data = useCourse(),
    me = useMe(),
    [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (data.isPending || data.error)
    return (
      <div className="a-page">
        <Status pending={data.isPending} error={data.error} />
      </div>
    );
  const course = data.data!,
    completed = course.lessons.filter((lesson) =>
      course.completedLessonIds.includes(lesson.id),
    ).length,
    percent = course.lessons.length
      ? Math.round((completed / course.lessons.length) * 100)
      : 0,
    next = course.lessons.find(
      (lesson) => !course.completedLessonIds.includes(lesson.id),
    );
  const track = tracks.find(
      (item) => item.id === course.track && hasToolkitTrack(me.data, item.id),
    ),
    nextIndex = next ? course.lessons.indexOf(next) : 0;
  return (
    <div className="a-page learn-page">
      <div className="a-crumbs">
        <Link to="/">Dashboard</Link>
        <span>›</span>
        <Link to={track ? `/toolkit/${track.id}` : "/courses"}>
          {track?.name || "Courses"}
        </Link>
        <span>›</span>
        <span>{course.title}</span>
      </div>
      <header className="learn-heading">
        <span className="hub-eyebrow">OTP SLATE · YOUR LEARNING JOURNEY</span>
        <h1>{course.title}</h1>
        <p>{course.description}</p>
        <div className="learn-meta">
          <span className="instructor-avatar" aria-hidden="true">
            {me
              .data!.organizationName?.split(" ")
              .map((name) => name[0])
              .slice(0, 2)
              .join("")}
          </span>
          <span>
            Learning access <b>{me.data?.organizationName}</b>
          </span>
          <span className="learn-divider" />
          <span>{course.lessons.length} modules</span>
          <span>Self-paced learning</span>
          <span>Assigned version {course.version}</span>
        </div>
      </header>
      <div className="learn-layout">
        <section className="learn-content">
          <section className="learn-resume">
            <div>
              <span className="hub-eyebrow">
                {next ? "YOUR NEXT STEP" : "WELL DONE"}
              </span>
              <h2>{next?.title || "You have completed this course"}</h2>
              <p>
                {next
                  ? `Module ${nextIndex + 1} · Guided lesson`
                  : "Revisit any module to keep your skills sharp."}
              </p>
            </div>
            {next && (
              <Link
                className="a-btn pri"
                to={`/courses/${course.id}/lessons/${next.id}`}
              >
                {completed ? "Resume learning" : "Start learning"}{" "}
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </section>
          <div className="learn-section-heading">
            <h2>Course content</h2>
            <span>
              {completed} of {course.lessons.length} modules complete
            </span>
          </div>
          {course.lessons.map((lesson, index) => {
            const done = course.completedLessonIds.includes(lesson.id),
              open = expanded[lesson.id] ?? index === nextIndex;
            return (
              <section key={lesson.id} className="a-mod learn-module">
                <button
                  className="a-mod-h"
                  aria-expanded={open}
                  aria-controls={`module-${lesson.id}`}
                  onClick={() =>
                    setExpanded((items) => ({ ...items, [lesson.id]: !open }))
                  }
                >
                  <span className={`module-number${done ? " complete" : ""}`}>
                    {done ? "✓" : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="module-title">
                    <small>MODULE {index + 1}</small>
                    <b>{lesson.title}</b>
                    <span>1 activity · {done ? 1 : 0} completed</span>
                  </span>
                  <span className="module-status">
                    {done ? "Completed" : "Ready to start"}
                  </span>
                  <span className="module-chevron" aria-hidden="true">
                    {open ? "−" : "+"}
                  </span>
                </button>
                <div id={`module-${lesson.id}`} hidden={!open}>
                  <p className="module-intro">
                    Learn the concepts, then revisit the lesson to keep your
                    skills sharp.
                  </p>
                  <Link
                    to={`/courses/${course.id}/lessons/${lesson.id}`}
                    className={`a-item${done ? " done" : ""}${next?.id === lesson.id ? " next" : ""}`}
                  >
                    <span className="ic">
                      <StudentIcon name="page" />
                    </span>
                    <span className="nm">
                      <b>{lesson.title}</b>
                      <small>Guided lesson</small>
                    </span>
                    <span
                      className="st"
                      aria-label={done ? "Completed" : "Not completed"}
                    >
                      {done && <StudentIcon name="check" />}
                    </span>
                  </Link>
                </div>
              </section>
            );
          })}
        </section>
        <aside className="learn-sidebar">
          <section className="learn-progress">
            <h2>Your progress</h2>
            <div className="learn-percent">
              {percent}
              <span>%</span>
            </div>
            <div
              className="learn-progress-track"
              role="progressbar"
              aria-label="Course completion"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <p>
              {completed} of {course.lessons.length} activities completed
            </p>
            <div className="learn-progress-detail">
              <b>
                {completed} / {course.lessons.length}
              </b>
              <span>Modules completed</span>
            </div>
          </section>
          <section className="learn-support">
            <h2>Learn by doing</h2>
            <p>
              Follow guided lessons, then put your skills to work in your
              assigned practice.
            </p>
            <p>Your progress is saved as you complete each lesson.</p>
            {course.lessons[0] && (
              <Link
                className="a-btn"
                to={`/courses/${course.id}/lessons/${course.lessons[0].id}`}
              >
                Revisit the first lesson
              </Link>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
function LessonPage() {
  const { id, lessonId } = useParams(),
    data = useCourse(),
    query = useQueryClient();
  const complete = useMutation({
    mutationFn: () =>
      api(`student/courses/${id}/lessons/${lessonId}/complete`, "POST"),
    onSuccess: () =>
      query.invalidateQueries({ queryKey: ["student", `course-${id}`] }),
  });
  if (data.isPending || data.error)
    return (
      <div className="a-page">
        <Status pending={data.isPending} error={data.error} />
      </div>
    );
  const course = data.data!,
    index = course.lessons.findIndex((lesson) => lesson.id === lessonId),
    lesson = course.lessons[index];
  if (!lesson) return <Unavailable />;
  const done = course.completedLessonIds.includes(lesson.id),
    previous = course.lessons[index - 1],
    next = course.lessons[index + 1];
  return (
    <div className="a-page">
      <div className="a-crumbs">
        <Link to="/courses">Courses</Link>
        <span>›</span>
        <Link to={`/courses/${id}`}>{course.title}</Link>
        <span>›</span>
        <span>Module {index + 1}</span>
      </div>
      <section className="a-lesson">
        <h1>{lesson.title}</h1>
        <p className="a-meta">
          Module {index + 1} · Guided lesson · Assigned version {course.version}
        </p>
        <div className="lesson-copy">{lesson.body}</div>
        <div className="lesson-completion">
          <button
            className={`a-btn${done ? "" : " pri"}`}
            disabled={done || complete.isPending}
            onClick={() => complete.mutate()}
          >
            {done && <StudentIcon name="check" />}
            {done
              ? "Completed"
              : complete.isPending
                ? "Saving…"
                : "Mark as complete"}
          </button>
          <Status error={complete.error} />
        </div>
      </section>
      <div className="a-seq" style={{ maxWidth: 860 }}>
        {previous ? (
          <Link className="a-btn" to={`/courses/${id}/lessons/${previous.id}`}>
            ‹ Previous
          </Link>
        ) : (
          <Link className="a-btn" to={`/courses/${id}`}>
            Back to modules
          </Link>
        )}
        {next ? (
          <Link className="a-btn pri" to={`/courses/${id}/lessons/${next.id}`}>
            Next: {next.title} ›
          </Link>
        ) : (
          <Link className="a-btn pri" to={`/courses/${id}`}>
            Return to course →
          </Link>
        )}
      </div>
    </div>
  );
}
function Toolkit() {
  const { track } = useParams(),
    me = useMe(),
    data = useData<Course[]>("courses", "student/courses"),
    available = tracks.filter((item) => hasToolkitTrack(me.data, item.id)),
    selected = available.find((item) => item.id === track),
    toolkitTitle =
      me.data?.access?.display.toolkitTitle || "Your Placement Toolkit";
  if (track && !selected) return <Unavailable />;
  const courses = data.data?.filter((course) => course.track === track) || [];
  return (
    <div className="a-page">
      {selected && (
        <div className="a-crumbs">
          <Link to="/toolkit">{toolkitTitle}</Link>
          <span>›</span>
          <span>{selected.name}</span>
        </div>
      )}
      <Heading title={selected?.name || toolkitTitle}>
        <span className="a-tag">
          {selected
            ? `${courses.length} learning paths`
            : `${available.length} learning tracks`}
        </span>
      </Heading>
      <Banner
        title={selected?.intro || "Get ready for your next opportunity."}
        description={
          selected?.description ||
          "Explore the learning tracks selected for you by your organization."
        }
        glyph={selected?.glyph || "⌘"}
      />
      {!available.length && (
        <NoResults title="Your toolkit is ready">
          Your organization will choose the learning tracks available to you.
        </NoResults>
      )}
      {!selected ? (
        <div className="hub-grid" style={{ marginTop: 24 }}>
          {available.map((item) => (
            <article className="hub-card" key={item.id}>
              <div className="hub-card-top">
                <span className="rail-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                <span className="a-tag">
                  {data.data?.filter((course) => course.track === item.id)
                    .length ?? "—"}{" "}
                  learning paths
                </span>
              </div>
              <h2>{item.name}</h2>
              <p>{item.description}</p>
              <div className="hub-actions">
                <Link className="a-btn pri" to={`/toolkit/${item.id}`}>
                  Explore {item.name} <span aria-hidden="true">→</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <>
          <p className="hub-note">{selected.note}</p>
          {hasAccess(me.data, "courses") && (
            <Status pending={data.isPending} error={data.error} />
          )}
          {!hasAccess(me.data, "courses") && (
            <NoResults title="No courses assigned to this track">
              Your organization controls the courses available in your learning
              tracks.
            </NoResults>
          )}
          {data.data &&
            (courses.length ? (
              <div className="hub-grid">
                {courses.map((course) => {
                  const appearance = courseAppearance(course);
                  return (
                    <article className="hub-card" key={course.id}>
                      <div className="hub-card-top">
                        <span
                          className="a-sw"
                          style={{ background: appearance.color }}
                        >
                          {appearance.glyph}
                        </span>
                        <span className="a-tag">Version {course.version}</span>
                      </div>
                      <h2>{course.title}</h2>
                      <p>{course.description}</p>
                      <small>Learning assigned by your placement team</small>
                      <div className="hub-actions">
                        <Link
                          className="a-btn pri"
                          to={`/courses/${course.id}`}
                        >
                          Explore modules <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <NoResults
                title="No assigned learning in this track"
                action={
                  <Link className="a-btn" to="/toolkit">
                    Back to toolkit
                  </Link>
                }
              >
                Your placement team will add the courses and practice assigned
                to you.
              </NoResults>
            ))}
        </>
      )}
    </div>
  );
}
function Practice() {
  return <PracticeCatalogue />;
}
function LiveExams() {
  const me = useMe();
  const data = useData<LiveExam[]>("exams", "student/exams");
  if (data.data?.length)
    return (
      <div className="a-page">
        <Heading title="Live Exams" />
        <LiveExamList exams={data.data} />
      </div>
    );
  return (
    <div className="a-page">
      <Heading title="Live Exams" />
      <Status pending={data.isPending} error={data.error} />
      {data.data && (
        <>
          <section className="exam-empty">
            <div className="exam-empty-art" aria-hidden="true">
              <Artwork name="exam" />
            </div>
            <p className="hub-eyebrow">YOU’RE ALL CAUGHT UP</p>
            <h2>No live exams available</h2>
            <p>
              When your institute releases a new exam, you’ll find it here with
              the schedule and instructions.
            </p>
            {hasAccess(me.data, "practice") && (
              <>
                <Link className="a-btn pri" to="/practice">
                  Keep learning with practice <span aria-hidden="true">→</span>
                </Link>
                <small>
                  Build confidence while you wait for your next assessment.
                </small>
              </>
            )}
          </section>
          {hasAccess(me.data, "practice") && (
            <div className="empty-followup">
              <b>A little practice goes a long way.</b>
              <span>
                Explore your assigned practice activities at your own pace.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function Jobs() {
  const data = useData<Job[]>("jobs", "student/jobs"),
    me = useMe(),
    [search, setSearch] = useState("");
  const jobs =
    data.data?.filter((job) =>
      `${job.title} ${job.company} ${job.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ) || [];
  return (
    <div className="a-page">
      <Heading title="Jobs">
        {me.data?.features.includes("resume") && (
          <Link className="a-btn" to="/resume">
            Build your resume →
          </Link>
        )}
      </Heading>
      <Banner
        eyebrow="YOUR NEXT CHAPTER"
        title="Find your next opportunity."
        description="Discover roles shared by your placement team. Open a posting to apply directly on the employer’s website."
        glyph="↗"
      />
      <p className="hub-note">
        Opportunities published by Platform Admin. Applications open on the
        original posting.
      </p>
      <input
        className="a-search jobs-search"
        type="search"
        aria-label="Search jobs"
        placeholder="Search role, company or location"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Status pending={data.isPending} error={data.error} />
      {data.data && (
        <div id="jobCatalog">
          <p className="hub-note" role="status">
            {jobs.length} {jobs.length === 1 ? "opportunity" : "opportunities"}
          </p>
          {jobs.length ? (
            <div className="hub-grid">
              {jobs.map((job) => (
                <a
                  key={job.id}
                  className="hub-card job-card"
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${job.title} at ${job.company}`}
                >
                  <div className="hub-card-top">
                    <span className="a-tag">Job opportunity</span>
                    <time dateTime={job.postedAt}>
                      {new Date(job.postedAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  </div>
                  <h2>{job.title}</h2>
                  <b>{job.company}</b>
                  <p>{job.description}</p>
                  <div className="job-link">
                    View original posting <span aria-hidden="true">↗</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <NoResults title="No jobs available">
              New opportunities will appear when your placement team publishes
              them. Try clearing the search if you entered a filter.
            </NoResults>
          )}
        </div>
      )}
    </div>
  );
}
function Inbox({ announcementsOnly = false }: { announcementsOnly?: boolean }) {
  const me = useMe();
  const data = useData<Announcement[]>(
    "announcements",
    "student/announcements",
  );
  const title = announcementsOnly ? "Announcements" : "Inbox";
  if (!hasAccess(me.data, "announcements"))
    return (
      <div className="a-page">
        <Heading title={title} />
        <NoResults title="No updates available">
          Announcements are not enabled for your account. Contact your
          organization for support.
        </NoResults>
      </div>
    );
  return (
    <div className="a-page">
      <Heading title={title} />
      <Status pending={data.isPending} error={data.error} />
      {data.data?.length ? (
        <>
          <p className="hub-note">
            Organization announcements · Sample notices
          </p>
          <div className="hub-grid">
            {data.data.map((message) => (
              <article className="hub-card" key={message.id}>
                <div className="hub-card-top">
                  <span className="a-tag">{message.from}</span>
                  <small>
                    {new Date(message.date).toLocaleDateString("en-IN")}
                  </small>
                </div>
                <h2>{message.title}</h2>
                <p>{message.body}</p>
                <small>Sample announcement</small>
              </article>
            ))}
          </div>
        </>
      ) : (
        data.data && (
          <NoResults title="No announcements yet">
            Announcements shared with your account will appear here.
          </NoResults>
        )
      )}
    </div>
  );
}
function Help() {
  const me = useMe();
  return (
    <div className="a-page">
      <Heading title="Help" />
      <Banner
        title="A little help to keep you moving."
        description="Find your courses, understand learning access and prepare for your next assessment."
        glyph="?"
      />
      <section className="help-section" id="access">
        <h2>Courses and learning access</h2>
        <p>
          Your placement team assigns courses and practice. Contact your
          organization if a course is missing. Organization viewers track
          progress; Platform Admin manages access.
        </p>
        {hasAccess(me.data, "courses") && (
          <Link className="a-btn" to="/courses">
            Open my courses →
          </Link>
        )}
      </section>
      {hasAccess(me.data, "resume") && (
        <section className="help-section">
          <h2>Your progress and resume</h2>
          <p>
            Open a course module, read the lesson and mark it complete. Your
            resume updates as you type and saves to your account; check the save
            status before leaving.
          </p>
        </section>
      )}
      {hasAccess(me.data, "live-exams") && (
        <section className="help-section" id="exams">
          <h2>Live exams and browser monitoring</h2>
          <p>
            Released exams will display their schedule and instructions. Read
            the monitoring notice before starting an exam. Browser events
            support review; a tab change alone does not establish cheating.
          </p>
          <Link className="a-btn" to="/live-exams">
            Check live exams →
          </Link>
        </section>
      )}
    </div>
  );
}
function Unavailable() {
  return (
    <div className="a-page">
      <Heading title="Page unavailable" />
      <NoResults
        title="This page is not available"
        action={
          <Link className="a-btn" to="/">
            Return to dashboard
          </Link>
        }
      >
        Open your dashboard to continue with your assigned learning.
      </NoResults>
    </div>
  );
}
export function StudentRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<StudentLogin />} />
      <Route path="/register" element={<StudentRegistration />} />
      <Route path="/reset-password" element={<StudentResetPassword />} />
      <Route element={<Protected />}>
        <Route path="/onboarding" element={<StudentOnboarding />} />
        <Route element={<StudentShell />}>
          <Route index element={<Dashboard />} />
          <Route
            path="courses"
            element={
              <AccessRoute feature="courses">
                <Courses />
              </AccessRoute>
            }
          />
          <Route
            path="courses/:id"
            element={
              <AccessRoute feature="courses">
                <CoursePage />
              </AccessRoute>
            }
          />
          <Route
            path="courses/:id/lessons/:lessonId"
            element={
              <AccessRoute feature="courses">
                <LessonPage />
              </AccessRoute>
            }
          />
          <Route
            path="toolkit"
            element={
              <AccessRoute feature="toolkit">
                <Toolkit />
              </AccessRoute>
            }
          />
          <Route
            path="toolkit/:track"
            element={
              <AccessRoute feature="toolkit">
                <Toolkit />
              </AccessRoute>
            }
          />
          <Route
            path="compiler"
            element={
              <AccessRoute feature="compiler">
                <CompilerPage />
              </AccessRoute>
            }
          />
          <Route
            path="practice"
            element={
              <AccessRoute feature="practice">
                <Practice />
              </AccessRoute>
            }
          />
          <Route
            path="practice/coding"
            element={
              <AccessRoute feature="practice" coding>
                <CodingLibrary />
              </AccessRoute>
            }
          />
          <Route
            path="practice/:id"
            element={
              <AccessRoute feature="practice">
                <AssessmentPlayer />
              </AccessRoute>
            }
          />
          <Route
            path="live-exams"
            element={
              <AccessRoute feature="live-exams">
                <LiveExams />
              </AccessRoute>
            }
          />
          <Route
            path="jobs"
            element={
              <AccessRoute feature="jobs">
                <Jobs />
              </AccessRoute>
            }
          />
          <Route
            path="resume"
            element={
              <AccessRoute feature="resume">
                <ResumePage />
              </AccessRoute>
            }
          />
          <Route
            path="inbox"
            element={
              <AccessRoute feature="inbox">
                <Inbox />
              </AccessRoute>
            }
          />
          <Route
            path="announcements"
            element={
              <AccessRoute feature="announcements">
                <Inbox announcementsOnly />
              </AccessRoute>
            }
          />
          <Route path="help" element={<Help />} />
          <Route path="*" element={<Unavailable />} />
        </Route>
      </Route>
    </Routes>
  );
}
