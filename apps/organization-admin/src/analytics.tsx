import { useState } from "react";
import { Link } from "react-router-dom";
import type { Analytics, DemoPerformance } from "@slate/contracts";
import { Empty, Icon } from "@slate/ui";
import { BarChart, DonutChart, SkillChart, TrendChart } from "./charts";
import { OrgCard, OrgGlyph } from "./workspace";
import { RankingsTable } from "./rankings";

const colors = {
  green: "#318477",
  gold: "#e8b84e",
  navy: "#536d93",
  gray: "#e9eef0",
};
const mean = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

function ExportReport({ data }: { data: Analytics }) {
  const [saved, setSaved] = useState(false);
  function download() {
    const results = new Map(
      data.performance?.results.map((result) => [result.studentId, result]),
    );
    const rows: (string | number)[][] = [
      ["Organization", data.organization.name],
      ["Generated", data.generatedAt],
      [
        "Assessment source",
        data.performance
          ? "Illustrative sample results"
          : "No published results",
      ],
      [],
      [
        "Student",
        "Email",
        "Account status",
        "Courses",
        "Completed lessons",
        "Total lessons",
        "Course completion %",
        "Assessment average %",
      ],
    ];
    data.students.forEach((student) =>
      rows.push([
        student.name,
        student.email,
        student.status,
        student.assignedCourses,
        student.completedLessons,
        student.totalLessons,
        student.completion ?? "",
        results.get(student.id)?.average ?? "",
      ]),
    );
    const cell = (value: string | number) => {
      const text = String(value);
      return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
    };
    const url = URL.createObjectURL(
      new Blob(
        ["\ufeff" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "organization-learning-report.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  }
  return (
    <div className="org-export">
      <button className="org-button" onClick={download}>
        <OrgGlyph name="download" />
        Export report
      </button>
      {saved && <span role="status">Report downloaded</span>}
    </div>
  );
}

function AnalyticsHeading({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: Analytics;
}) {
  return (
    <>
      <div className="org-page-heading">
        <div>
          <div className="org-eyebrow">YOUR ORGANIZATION, AT A GLANCE</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <ExportReport data={data} />
      </div>
      {data.demo && (
        <div className="org-demo-notice">
          <span className="org-dot" />
          <strong>Demo workspace</strong>
          <span>
            Explore with sample students and illustrative assessment results.
          </span>
          <span className="org-updated">
            Updated{" "}
            {new Date(data.generatedAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  note,
  icon,
  tone = "green",
}: {
  label: string;
  value: string | number;
  note: string;
  icon: string;
  tone?: string;
}) {
  return (
    <article className="org-stat">
      <div className="org-stat-top">
        <span>{label}</span>
        <span className={`org-stat-icon ${tone}`}>
          <Icon name={icon} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Period({
  weeks,
  change,
}: {
  weeks: number;
  change: (weeks: number) => void;
}) {
  return (
    <select
      className="org-select"
      aria-label="Analytics trend period"
      value={weeks}
      onChange={(event) => change(Number(event.target.value))}
    >
      <option value={6}>Last 6 weeks</option>
      <option value={3}>Last 3 weeks</option>
    </select>
  );
}

function PracticeTrend({
  data,
  weeks,
  setWeeks,
  title = "Practice performance",
}: {
  data?: DemoPerformance;
  weeks: number;
  setWeeks: (weeks: number) => void;
  title?: string;
}) {
  const trend = data?.results.length ? data.trend.slice(-weeks) : [],
    latest = trend.at(-1),
    change =
      latest && trend.length > 1
        ? latest.averageScore - trend[0].averageScore
        : null;
  return (
    <OrgCard
      title={title}
      description="Weekly average assessment score"
      action={<Period weeks={weeks} change={setWeeks} />}
      className="org-trend-card"
    >
      {latest ? (
        <>
          <div className="org-chart-summary">
            <strong>
              {latest.averageScore}
              <span>%</span>
            </strong>
            {change !== null && (
              <span className={`org-change ${change < 0 ? "negative" : ""}`}>
                {change >= 0 ? "↗" : "↘"} {Math.abs(change)} pts{" "}
                <small>over {trend.length} weeks</small>
              </span>
            )}
            <span className="org-chart-key">
              <i />
              Average score
            </span>
          </div>
          <TrendChart
            label="Weekly practice assessment scores"
            points={trend.map((week) => ({
              label: week.week.replace("Week ", "W"),
              value: week.averageScore,
            }))}
            suffix="%"
          />
          <p className="org-chart-footnote">
            Illustrative assessment results · Scores are separate from course
            completion.
          </p>
        </>
      ) : (
        <Empty title="A clearer picture with every assessment">
          Performance trends will appear when assessment results are available.
        </Empty>
      )}
    </OrgCard>
  );
}

function Skills({ data }: { data?: DemoPerformance }) {
  return (
    <OrgCard
      title="Skills snapshot"
      description="Average score across assessed skills"
      action={data && <span className="org-tag">Sample</span>}
    >
      {data?.results.length ? (
        <>
          <SkillChart
            items={data.skills.map((skill) => ({
              name: skill.name,
              average: skill.score,
            }))}
          />
          <div className="org-card-bottom-note">
            <span className="org-note-icon">↗</span>
            <span>
              <strong>
                {[...data.skills].sort((a, b) => b.score - a.score)[0]?.name ||
                  "Skills"}
              </strong>{" "}
              is the strongest skill in this sample.
            </span>
          </div>
        </>
      ) : (
        <Empty title="Skill insights are on their way">
          Published results will show strengths and areas for practice.
        </Empty>
      )}
    </OrgCard>
  );
}

function TopStudents({ data }: { data: Analytics }) {
  const leaders = [...(data.performance?.results || [])]
    .sort(
      (a, b) =>
        b.average - a.average ||
        b.attempts - a.attempts ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 5);
  return (
    <OrgCard
      title="Standout students"
      description="Leading by average assessment score"
      action={
        <Link className="org-text-link" to="/rankings">
          View rankings <OrgGlyph name="arrow" />
        </Link>
      }
    >
      {leaders.length ? (
        <div className="org-leaders">
          {leaders.map((student, index) => (
            <Link
              className="org-leader"
              key={student.studentId}
              to={`/students/${student.studentId}`}
            >
              <span className={`org-rank-number rank-${index}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={`org-person-avatar avatar-${index % 3}`}>
                {initials(student.name)}
              </span>
              <span className="org-leader-info">
                <strong>{student.name}</strong>
                <small>{student.attempts} practice attempts</small>
              </span>
              <strong className="org-leader-score">
                {student.average}
                <small>%</small>
              </strong>
              <OrgGlyph name="arrow" />
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="Every student has potential">
          Student rankings appear once assessment results are available.
        </Empty>
      )}
    </OrgCard>
  );
}

export function OrganizationOverview({ data }: { data: Analytics }) {
  const [weeks, setWeeks] = useState(6);
  const lessons = data.students.reduce(
      (sum, student) => sum + student.totalLessons,
      0,
    ),
    completed = data.totals.completedLessons;
  const completion = lessons ? Math.round((completed / lessons) * 100) : 0;
  const unassigned = data.students.filter(
    (student) => !student.assignedCourses,
  ).length;
  const early = data.students.filter(
    (student) => student.assignedCourses > 0 && (student.completion ?? 0) < 25,
  ).length;
  const trend = data.performance?.results.length
    ? data.performance.trend.slice(-weeks)
    : [];
  return (
    <>
      <AnalyticsHeading
        title="Your organization, in focus."
        description="Understand progress. Recognize potential. Guide what comes next."
        data={data}
      />
      <div className="org-stats-grid">
        <Stat
          label="Total students"
          value={data.totals.students}
          note="Across your organization"
          icon="users"
        />
        <Stat
          label="Active accounts"
          value={data.totals.active}
          note={`${data.totals.students ? Math.round((data.totals.active / data.totals.students) * 100) : 0}% of all student accounts`}
          icon="exam"
          tone="blue"
        />
        <Stat
          label="Course completion"
          value={lessons ? `${completion}%` : "—"}
          note={`${completed} of ${lessons} assigned lessons`}
          icon="book"
          tone="gold"
        />
        <Stat
          label="Avg. assessment score"
          value={
            data.performance?.results.length
              ? `${mean(data.performance.results.map((result) => result.average))}%`
              : "—"
          }
          note={
            data.performance
              ? "Across sample assessment results"
              : "No published results yet"
          }
          icon="chart"
          tone="purple"
        />
      </div>
      <div className="org-chart-grid org-chart-grid-main">
        <PracticeTrend
          data={data.performance}
          weeks={weeks}
          setWeeks={setWeeks}
        />
        <OrgCard
          title="Learning completion"
          description="Progress through assigned lessons"
        >
          {lessons ? (
            <>
              <DonutChart
                label="Assigned lesson completion"
                centerValue={`${completion}%`}
                centerLabel="completed"
                segments={[
                  {
                    label: "Completed lessons",
                    value: completed,
                    color: colors.green,
                  },
                  {
                    label: "Remaining lessons",
                    value: Math.max(0, lessons - completed),
                    color: colors.gray,
                  },
                ]}
              />
              <Link className="org-card-link" to="/learning">
                Explore learning analytics <OrgGlyph name="arrow" />
              </Link>
            </>
          ) : (
            <Empty title="Learning starts with access">
              Completion will appear when students receive course assignments.
            </Empty>
          )}
        </OrgCard>
      </div>
      <div className="org-chart-grid">
        <Skills data={data.performance} />
        <OrgCard
          title="Weekly engagement"
          description="Students active in practice each week"
          action={data.performance && <span className="org-tag">Sample</span>}
        >
          {trend.length ? (
            <>
              <BarChart
                label="Active practice learners by week"
                items={trend.map((week) => ({
                  label: week.week.replace("Week ", "W"),
                  value: week.activeStudents,
                  color: colors.navy,
                }))}
                max={Math.max(
                  data.students.length,
                  ...trend.map((week) => week.activeStudents),
                )}
              />
              <div className="org-engagement-note">
                <strong>
                  {trend.at(-1)?.activeStudents}
                  <span> / {data.students.length}</span>
                </strong>
                <span>learners active in the latest sample week</span>
              </div>
            </>
          ) : (
            <Empty title="Activity will build over time">
              Weekly engagement appears when practice activity is recorded.
            </Empty>
          )}
        </OrgCard>
      </div>
      <div className="org-chart-grid org-chart-grid-bottom">
        <TopStudents data={data} />
        <OrgCard
          title="Where to focus"
          description="A few useful signals from your learning data"
        >
          <Link className="org-focus-item" to="/students?focus=unassigned">
            <span className="org-focus-icon gold">
              <Icon name="book" />
            </span>
            <div>
              <strong>
                {unassigned}{" "}
                {unassigned === 1 ? "student needs" : "students need"} course
                access
              </strong>
              <p>
                {unassigned
                  ? "No courses assigned. Review with your platform admin."
                  : "Everyone has at least one course assigned."}
              </p>
            </div>
            <OrgGlyph name="arrow" />
          </Link>
          <Link className="org-focus-item" to="/students?focus=early">
            <span className="org-focus-icon blue">
              <Icon name="chart" />
            </span>
            <div>
              <strong>{early} students are getting started</strong>
              <p>Below 25% completion of their assigned lessons.</p>
            </div>
            <OrgGlyph name="arrow" />
          </Link>
          <div className="org-insight-callout">
            <span>THE BIG PICTURE</span>
            <strong>Small steps. Lasting progress.</strong>
            <p>
              Use learning completion alongside assessment scores for a fuller
              view of every student.
            </p>
            <Link to="/students">
              Explore student insights <OrgGlyph name="arrow" />
            </Link>
          </div>
        </OrgCard>
      </div>
    </>
  );
}

export function OrganizationLearning({ data }: { data: Analytics }) {
  const [weeks, setWeeks] = useState(6);
  const distribution = [
    {
      label: "Not started",
      value: data.students.filter((student) => student.completion === 0).length,
      color: "#cbd4dd",
    },
    {
      label: "1–24%",
      value: data.students.filter(
        (student) =>
          student.completion !== null &&
          student.completion > 0 &&
          student.completion < 25,
      ).length,
      color: colors.gold,
    },
    {
      label: "25–49%",
      value: data.students.filter(
        (student) =>
          student.completion !== null &&
          student.completion >= 25 &&
          student.completion < 50,
      ).length,
      color: "#92b8b0",
    },
    {
      label: "50–74%",
      value: data.students.filter(
        (student) =>
          student.completion !== null &&
          student.completion >= 50 &&
          student.completion < 75,
      ).length,
      color: colors.navy,
    },
    {
      label: "75–100%",
      value: data.students.filter(
        (student) => student.completion !== null && student.completion >= 75,
      ).length,
      color: colors.green,
    },
  ];
  return (
    <>
      <AnalyticsHeading
        title="Learning analytics"
        description="Follow the learning journey, from first lesson to growing confidence."
        data={data}
      />
      <div className="org-chart-grid org-chart-grid-main">
        <PracticeTrend
          title="Self-assessment"
          data={data.performance}
          weeks={weeks}
          setWeeks={setWeeks}
        />
        <Skills data={data.performance} />
      </div>
      <RankingsTable data={data} />
      <div className="org-chart-grid org-learning-bottom">
        <OrgCard
          title="Course progress distribution"
          description="Students grouped by assigned lesson completion"
        >
          <BarChart
            label="Students by course completion range"
            items={distribution}
          />
          <p className="org-chart-footnote">
            {
              data.students.filter((student) => student.completion === null)
                .length
            }{" "}
            unassigned students are excluded. Completion measures lessons, not
            assessment scores.
          </p>
        </OrgCard>
        <OrgCard
          title="Access & participation"
          description="Current course assignment coverage"
        >
          <DonutChart
            label="Students with course assignments"
            centerValue={String(
              data.students.filter((student) => student.assignedCourses > 0)
                .length,
            )}
            centerLabel="with course access"
            segments={[
              {
                label: "With assignments",
                value: data.students.filter(
                  (student) => student.assignedCourses > 0,
                ).length,
                color: colors.green,
              },
              {
                label: "No assignments",
                value: data.students.filter(
                  (student) => !student.assignedCourses,
                ).length,
                color: colors.gold,
              },
            ]}
          />
          <Link className="org-card-link" to="/students">
            View every student <OrgGlyph name="arrow" />
          </Link>
        </OrgCard>
      </div>
    </>
  );
}
