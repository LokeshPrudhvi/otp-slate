import { JobCards } from "./job-cards";
import { CareerOpportunities, CertificationsPage, PyqPage } from "./career";
import { MailboxPage } from "./mailbox";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import type {
  Course,
  CourseCatalogItem,
  Job,
  Lesson,
  StudentExamSummary,
  Ranking,
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
} from "./design";
import { CourseCard, recentlyOpened } from "./course-cards";
import { StudentLogin, StudentOnboarding, StudentResetPassword } from "./auth";
import { StudentRegistration } from "./registration";
import { ResumePage } from "./resume";
import { CodingLibrary, CodingProblemPage } from "./coding";
import { CompilerPage } from "./compiler";
import { CrtPage } from "./crt";
import { SelfAssessment } from "./self-assessment";
import { StudentLessonActivity, lessonPresentation } from "./lessons";
import {
  LiveExamsPage,
  LiveExamDetailPage,
  LiveExamAttemptPage,
} from "./live-exams";
import { AnnouncementsPage } from "./announcements";
import { AccessRoute, hasAccess, useStudentData as useData } from "./access";

type LearningCourse = Course & {
  lessons: Lesson[];
  completedLessonIds: string[];
};
function LiveExamShortcut() {
  const exams = useData<StudentExamSummary[]>("exams", "student/exams");
  useEffect(() => {
    const timer = window.setInterval(() => void exams.refetch(), 30_000);
    return () => window.clearInterval(timer);
  }, [exams.refetch]);
  const live = exams.data?.find((exam) => exam.state === "live");
  if (exams.isPending || exams.isError || !live) return null;
  return (
    <section className="live-dash" aria-label="Live exams">
      <div>
        <span className="hub-eyebrow">LIVE NOW</span>
        <h2>{live.title}</h2>
        <p>
          {live.durationMinutes} minutes · {live.questionCount} questions ·
          Available now
        </p>
      </div>
      <Link className="a-btn" to={`/live-exams/${live.id}`}>
        View exam →
      </Link>
    </section>
  );
}
function Rankings() {
  const me = useMe(),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [rankingMode, setRankingMode] = useState<"latest" | "overall">("overall");
  const visibilityKey = `slate:rankings-visibility:${me.data?.id}`;
  const [visible, setVisible] = useState(() => {
    try {
      return !me.data?.id || localStorage.getItem(visibilityKey) !== "hidden";
    } catch {
      return true;
    }
  });
  const people = useData<Ranking[]>(
    `crt-rankings:${rankingMode}`,
    `student/rankings?kind=crt&mode=${rankingMode}`,
    visible,
  );
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
    <aside className="a-aside rankings-panel" aria-label="CRT ranking">
      <div className="rankings-head">
        <span className="hub-eyebrow">LEARN · PRACTISE · CLIMB</span>
        <div className="rankings-title-row">
          <h2>CRT – Ranking</h2>
          <button
            type="button"
            className="rankings-visibility-toggle"
            aria-label={visible ? "Hide CRT ranking" : "Show CRT ranking"}
            title={visible ? "Hide CRT ranking" : "Show CRT ranking"}
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
        <div
          className="crt-ranking-tabs"
          role="group"
          aria-label="CRT ranking period"
        >
          {(["latest", "overall"] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={rankingMode === mode}
              onClick={() => {
                setRankingMode(mode);
                setPage(0);
              }}
            >
              {mode === "latest" ? "Latest" : "Overall"}
            </button>
          ))}
        </div>
        <p className="ranking-note">
          {rankingMode === "latest"
            ? "Latest completed topic assessment per student."
            : "Average of each student’s best score per CRT topic."}
        </p>
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
          Scores are percentages. Students without completed CRT assessments
          remain unranked.
        </p>
        <Status
          pending={people.isPending}
          error={people.error}
          label="Loading rankings"
          variant="inline"
        />
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
                    <th>Score %</th>
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
    courses = useData<Course[]>("courses", "student/courses");
  const allowed = (feature: string) => hasAccess(me.data, feature);
  const showRankings = allowed("rankings") && allowed("crt");
  const insights = showRankings;
  const display = me.data?.access?.display;
  return (
    <div className="a-page">
      <Heading title={display?.portalTitle || "Dashboard"}>
        {me.data?.demo && <span className="a-tag">Sample data</span>}
        {allowed("courses") && (
          <Link className="a-btn" to="/courses">
            All courses
          </Link>
        )}
      </Heading>
      {display?.welcomeText && (
        <p className="hub-note">{display.welcomeText}</p>
      )}
      {allowed("self-assessment") && <SelfAssessment />}
      <div className={`a-dash${insights ? "" : " dashboard-wide"}`}>
        <div>
          {allowed("live-exams") && <LiveExamShortcut />}
          {allowed("courses") && (
            <>
              <div className="learning-section-heading">
                <h2>Continue learning</h2>
                <p>All your enrolled courses · Recently opened first</p>
              </div>
              <Status
                pending={courses.isPending}
                error={courses.error}
                label="Loading your courses"
                variant="cards"
              />
              {courses.data?.length ? (
                <div className="learning-cards">
                  {recentlyOpened(courses.data).map((course) => (
                    <CourseCard key={course.id} course={course} />
                  ))}
                </div>
              ) : (
                !courses.isPending &&
                !courses.error && (
                  <NoResults title="Your courses will appear here">
                    Explore the course catalog to request enrollment, or ask
                    your organization to assign a course.
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
            {showRankings && <Rankings key={me.data?.id} />}
          </div>
        )}
      </div>
    </div>
  );
}
function Courses() {
  const data = useData<CourseCatalogItem[]>(
      "course-catalog",
      "student/course-catalog",
    ),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<"all" | "enrolled">("all");
  const courses = data.data || [],
    enrolled = courses.filter((course) => course.enrolled),
    selected = filter === "enrolled" ? recentlyOpened(enrolled) : courses,
    items = selected.filter((course) =>
      `${course.title} ${course.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    );
  return (
    <div className="a-page course-catalog-page">
      <Heading title="Courses" />
      <p className="course-catalog-intro">
        Your next skill starts here. Continue an enrolled course, or request
        access to something new.
      </p>
      <div
        className="a-filters course-catalog-filters"
        aria-label="Course filters"
      >
        {(
          [
            ["all", "All Courses"],
            ["enrolled", "Enrolled"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`a-pill${filter === id ? " on" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <input
          className="a-search"
          type="search"
          placeholder="Search courses"
          aria-label="Search courses"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Status
        pending={data.isPending}
        error={data.error}
        label="Loading courses"
        variant="cards"
      />
      {data.data && (
        <section
          id="catalog"
          aria-label={filter === "all" ? "All courses" : "Enrolled courses"}
        >
          <p className="course-catalog-count">
            {items.length} {items.length === 1 ? "course" : "courses"}
            {filter === "enrolled"
              ? " · Recently opened first"
              : ` · ${enrolled.length} enrolled`}
          </p>
          {items.length ? (
            <div className="learning-cards">
              {items.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  enrolled={course.enrolled}
                />
              ))}
            </div>
          ) : (
            <NoResults
              title={
                search
                  ? "No matching courses"
                  : filter === "enrolled"
                    ? "Your learning journey starts here"
                    : "No courses available yet"
              }
            >
              {search
                ? "Try a course name or topic, or clear your search."
                : filter === "enrolled"
                  ? "Browse All Courses and request enrollment in a course you would like to study."
                  : "Your organization will make courses available here."}
            </NoResults>
          )}
        </section>
      )}
    </div>
  );
}
function useCourse() {
  const { id } = useParams();
  const data = useData<LearningCourse>(`course-${id}`, `student/courses/${id}`);
  const client = useQueryClient();
  const recorded = useRef<string | null>(null);
  const opened = useMutation({
    mutationFn: (courseId: string) =>
      api<{ lastOpenedAt: string }>(
        `student/courses/${courseId}/opened`,
        "POST",
      ),
    onSuccess: (result, courseId) => {
      const update = <T extends Course>(items: T[] | undefined) =>
        items?.map((course) =>
          course.id === courseId
            ? { ...course, lastOpenedAt: result.lastOpenedAt }
            : course,
        );
      client.setQueriesData<Course[]>(
        { queryKey: ["student", "courses"] },
        (items) => (items ? recentlyOpened(update(items)!) : items),
      );
      client.setQueriesData<CourseCatalogItem[]>(
        { queryKey: ["student", "course-catalog"] },
        update,
      );
      void client.invalidateQueries({ queryKey: ["student", "courses"] });
      void client.invalidateQueries({
        queryKey: ["student", "course-catalog"],
      });
    },
  });
  useEffect(() => {
    // A deliberate course/lesson visit records recency; query refreshes and
    // Strict Mode's repeated effects must not create additional writes.
    if (!data.data?.id || data.data.id !== id || recorded.current === id)
      return;
    recorded.current = id;
    opened.mutate(id);
  }, [id, data.data?.id, opened.mutate]);
  return data;
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
  const nextIndex = next ? course.lessons.indexOf(next) : 0;
  return (
    <div className="a-page learn-page">
      <div className="a-crumbs">
        <Link to="/">Dashboard</Link>
        <span>›</span>
        <Link to="/courses">Courses</Link>
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
                  ? `Module ${nextIndex + 1} · ${lessonPresentation[next.kind ?? "text"].label}`
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
                    {lessonPresentation[lesson.kind ?? "text"].description}
                  </p>
                  <Link
                    to={`/courses/${course.id}/lessons/${lesson.id}`}
                    className={`a-item${done ? " done" : ""}${next?.id === lesson.id ? " next" : ""}`}
                  >
                    <span className="ic">
                      <StudentIcon
                        name={lessonPresentation[lesson.kind ?? "text"].icon}
                      />
                    </span>
                    <span className="nm">
                      <b>{lesson.title}</b>
                      <small>
                        {lessonPresentation[lesson.kind ?? "text"].label}
                      </small>
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
    data = useCourse();
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
    <div className="a-page lesson-page">
      <div className="a-crumbs">
        <Link to="/courses">Courses</Link>
        <span>›</span>
        <Link to={`/courses/${id}`}>{course.title}</Link>
        <span>›</span>
        <span>Module {index + 1}</span>
      </div>
      <section className="a-lesson lesson-activity">
        <span className="lesson-kind">
          <StudentIcon name={lessonPresentation[lesson.kind ?? "text"].icon} />
          {lessonPresentation[lesson.kind ?? "text"].label}
        </span>
        <h1>{lesson.title}</h1>
        <p className="a-meta">
          Module {index + 1} of {course.lessons.length}
        </p>
        <StudentLessonActivity
          key={`${course.versionId ?? course.version}-${lesson.id}`}
          courseId={course.id}
          versionId={course.versionId}
          lesson={lesson}
          done={done}
        />
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
function LegacyPracticeRedirect() {
  const { id } = useParams();
  const location = useLocation();
  return (
    <Navigate
      replace
      to={`${id && id !== "coding" ? `/competitive-programming/${encodeURIComponent(id)}` : "/competitive-programming"}${location.search}${location.hash}`}
    />
  );
}
function CareerLanding() {
  const me = useMe();
  return (
    <Navigate
      replace
      to={
        hasAccess(me.data, "jobs")
          ? "/career-opportunities/jobs"
          : hasAccess(me.data, "resume")
            ? "/career-opportunities/resume"
            : "/"
      }
    />
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
      <Heading title="Job opportunities">
        {me.data?.features.includes("resume") && (
          <Link className="a-btn" to="/career-opportunities/resume">
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
        placeholder="Search role, company or description"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Status pending={data.isPending} error={data.error} />
      {data.data && (
        <div id="jobCatalog">
          {jobs.length ? (
            <JobCards jobs={jobs} />
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
          Your placement team assigns courses and coding. Contact your
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
            path="crt"
            element={
              <AccessRoute feature="crt">
                <CrtPage />
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
            path="competitive-programming"
            element={
              <AccessRoute feature="practice" coding>
                <CodingLibrary />
              </AccessRoute>
            }
          />
          <Route
            path="competitive-programming/:id"
            element={
              <AccessRoute feature="practice" coding>
                <CodingProblemPage />
              </AccessRoute>
            }
          />
          <Route path="practice" element={<LegacyPracticeRedirect />} />
          <Route path="practice/:id" element={<LegacyPracticeRedirect />} />
          <Route
            path="live-exams"
            element={
              <AccessRoute feature="live-exams">
                <LiveExamsPage />
              </AccessRoute>
            }
          />
          <Route
            path="live-exams/:id"
            element={
              <AccessRoute feature="live-exams">
                <LiveExamDetailPage />
              </AccessRoute>
            }
          />
          <Route
            path="live-exams/:id/attempt/:attemptId"
            element={
              <AccessRoute feature="live-exams">
                <LiveExamAttemptPage />
              </AccessRoute>
            }
          />
          <Route
            path="jobs"
            element={<Navigate replace to="/career-opportunities/jobs" />}
          />
          <Route
            path="resume"
            element={<Navigate replace to="/career-opportunities/resume" />}
          />
          <Route path="career-opportunities" element={<CareerLanding />} />
          <Route
            path="career-opportunities/jobs"
            element={
              <AccessRoute feature="jobs">
                <CareerOpportunities>
                  <Jobs />
                </CareerOpportunities>
              </AccessRoute>
            }
          />
          <Route
            path="career-opportunities/certifications"
            element={
              <AccessRoute feature="jobs">
                <CareerOpportunities>
                  <CertificationsPage />
                </CareerOpportunities>
              </AccessRoute>
            }
          />
          <Route
            path="career-opportunities/resume"
            element={
              <AccessRoute feature="resume">
                <CareerOpportunities>
                  <ResumePage />
                </CareerOpportunities>
              </AccessRoute>
            }
          />
          <Route
            path="pyq"
            element={
              <AccessRoute feature="pyq">
                <PyqPage />
              </AccessRoute>
            }
          />
          <Route
            path="inbox"
            element={
              <AccessRoute feature="inbox">
                <MailboxPage />
              </AccessRoute>
            }
          />
          <Route
            path="announcements"
            element={
              <AccessRoute feature="announcements">
                <AnnouncementsPage />
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
