import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "@slate/ui";
import {
  crtSubjects,
  type CrtStudentTopic,
  type PracticeAssessment,
} from "@slate/contracts";
import { hasAccess, hasCodingAccess, useStudentData } from "./access";
import "./learning-progress.css";

export function learningProgress(
  topics: CrtStudentTopic[],
  problems: PracticeAssessment[],
  stored: unknown,
) {
  const progress =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, { status?: string }>)
      : {};
  const modules = crtSubjects.map((subject) => {
    const assigned = topics.filter((topic) => topic.subjectId === subject.id);
    return {
      ...subject,
      completed:
        assigned.length > 0 && assigned.every((topic) => topic.completed),
      done: assigned.filter((topic) => topic.completed).length,
      total: assigned.length,
    };
  });
  const coding = problems.filter((problem) => problem.kind === "coding");
  const difficulties = ["Easy", "Medium", "Hard"].map((name) => {
    const rows = coding.filter((problem) => problem.difficulty === name);
    return {
      name,
      total: rows.length,
      completed: rows.filter(
        (problem) => progress[problem.id]?.status === "Solved",
      ).length,
    };
  });
  return {
    modules,
    completedModules: modules.filter((module) => module.completed).length,
    difficulties,
    total: coding.length,
    attempting: coding.filter(
      (problem) => progress[problem.id]?.status === "Attempted",
    ).length,
    solved: difficulties.reduce((n, row) => n + row.completed, 0),
  };
}
export function SelfAssessment() {
  const me = useMe(),
    crtAllowed = hasAccess(me.data, "crt"),
    codingAllowed = hasCodingAccess(me.data);
  const topics = useStudentData<CrtStudentTopic[]>(
    "crt-topics",
    "student/crt/topics",
    crtAllowed,
  );
  const problems = useStudentData<PracticeAssessment[]>(
    "practice",
    "student/practice",
    codingAllowed,
  );
  const read = () => {
    try {
      return JSON.parse(
        localStorage.getItem(`slate-demo-coding:${me.data!.id}:progress`) ||
          "{}",
      );
    } catch {
      return {};
    }
  };
  const [stored, setStored] = useState<unknown>(read);
  useEffect(() => {
    const refresh = () => setStored(read());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [me.data?.id]);
  const progress = learningProgress(
    topics.data ?? [],
    problems.data ?? [],
    stored,
  );
  const ready = crtAllowed || codingAllowed;
  return (
    <section
      className="self-assessment-card learning-progress-card"
      aria-labelledby="learning-progress-title"
    >
      <span className="hub-eyebrow">YOUR LEARNING SNAPSHOT</span>
      <h2 id="learning-progress-title">Learning Progress</h2>
      <p className="self-assessment-subtitle">
        Your CRT modules and programming milestones.
      </p>
      <div className="learning-progress-panels">
        {crtAllowed && (
          <div className="learning-progress-section programming-progress-visual crt-progress-visual">
            <div className="programming-progress-title">
              <Link to="/crt">
                CRT <span aria-hidden="true">↗</span>
              </Link>
              <button
                type="button"
                aria-label="Refresh CRT progress"
                title="Refresh CRT progress"
                disabled={topics.isFetching}
                onClick={() => void topics.refetch()}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 8a8 8 0 1 1 0 9M4 3v5h5" />
                </svg>
              </button>
            </div>
            {topics.error ? (
              <p className="programming-progress-error" role="alert">
                Could not load CRT progress. Use refresh to retry.
              </p>
            ) : (
              <div className="crt-progress-layout" aria-busy={topics.isPending}>
                <div
                  className="programming-gauge crt-module-gauge"
                  role="progressbar"
                  aria-label="Completed CRT modules"
                  aria-valuemin={0}
                  aria-valuemax={4}
                  aria-valuenow={
                    topics.isPending ? undefined : progress.completedModules
                  }
                  aria-valuetext={
                    topics.isPending
                      ? "Loading CRT progress"
                      : `${progress.completedModules} of 4 modules completed`
                  }
                >
                  <svg viewBox="0 0 220 220" fill="none" aria-hidden="true">
                    <path
                      className="programming-gauge-track"
                      d="M52 168 A82 82 0 1 1 168 168"
                      pathLength="100"
                    />
                    {progress.completedModules > 0 && (
                      <path
                        className="programming-gauge-solved"
                        d="M52 168 A82 82 0 1 1 168 168"
                        pathLength="100"
                        strokeDasharray={`${progress.completedModules * 25} 100`}
                      />
                    )}
                  </svg>
                  <div className="programming-gauge-value">
                    <strong>
                      {topics.isPending ? "—" : progress.completedModules}
                      <small>/4</small>
                    </strong>
                    <span>
                      <i aria-hidden="true">✓</i> Completed
                    </span>
                  </div>
                  <p className="programming-gauge-caption">Modules</p>
                </div>
                <div className="crt-module-progress-list">
                  {progress.modules.map((module) => (
                    <Link
                      key={module.id}
                      to={`/crt?subject=${module.id}`}
                      className="crt-module-progress-item"
                      data-subject={module.id}
                      title={module.name}
                      aria-label={`${module.name}: ${topics.isPending ? "loading" : `${module.done} of ${module.total} topics completed`}`}
                    >
                      <div>
                        <span>
                          {
                            {
                              quantitative: "Quantitative",
                              reasoning: "Reasoning",
                              verbal: "Verbal & English",
                              "soft-skills": "Soft skills",
                            }[module.id]
                          }
                        </span>
                        <b>
                          {topics.isPending
                            ? "—"
                            : `${module.done}/${module.total}`}
                          {module.completed && <i aria-hidden="true"> ✓</i>}
                        </b>
                      </div>
                      <div
                        className="crt-module-progress-track"
                        role="progressbar"
                        aria-label={`${module.name} topic progress`}
                        aria-valuemin={0}
                        aria-valuemax={module.total || 1}
                        aria-valuenow={
                          topics.isPending ? undefined : module.done
                        }
                        aria-valuetext={
                          topics.isPending
                            ? "Loading"
                            : module.total
                              ? `${module.done} of ${module.total} topics completed`
                              : "Not assigned yet"
                        }
                      >
                        <span
                          style={{
                            width: `${module.total ? (module.done / module.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      {!topics.isPending && !module.total && (
                        <small>Not assigned</small>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {codingAllowed && (
          <div className="learning-progress-section programming-progress-visual">
            <div className="programming-progress-title">
              <Link to="/competitive-programming">
                Programming <span aria-hidden="true">↗</span>
              </Link>
              <button
                type="button"
                aria-label="Refresh programming progress"
                title="Refresh progress"
                disabled={problems.isFetching}
                onClick={() => {
                  setStored(read());
                  void problems.refetch();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 8a8 8 0 1 1 0 9M4 3v5h5" />
                </svg>
              </button>
            </div>
            {problems.error ? (
              <p role="alert" className="programming-progress-error">
                Could not load programming progress. Use refresh to retry.
              </p>
            ) : (
              <div
                className="programming-progress-layout"
                aria-busy={problems.isPending}
              >
                <div
                  className="programming-gauge"
                  role="progressbar"
                  aria-label="Solved programming questions"
                  aria-valuemin={0}
                  aria-valuemax={progress.total || 1}
                  aria-valuenow={
                    problems.isPending ? undefined : progress.solved
                  }
                  aria-valuetext={
                    problems.isPending
                      ? "Loading programming progress"
                      : `${progress.solved} of ${progress.total} solved, ${progress.attempting} attempting`
                  }
                >
                  <svg viewBox="0 0 220 220" fill="none" aria-hidden="true">
                    <path
                      className="programming-gauge-track"
                      d="M52 168 A82 82 0 1 1 168 168"
                      pathLength="100"
                    />
                    {progress.solved > 0 && (
                      <path
                        className="programming-gauge-solved"
                        d="M52 168 A82 82 0 1 1 168 168"
                        pathLength="100"
                        strokeDasharray={`${progress.total ? (progress.solved / progress.total) * 100 : 0} 100`}
                      />
                    )}
                    {progress.attempting > 0 && (
                      <path
                        className="programming-gauge-attempting"
                        d="M52 168 A82 82 0 1 1 168 168"
                        pathLength="100"
                        strokeDasharray={`${progress.total ? (progress.attempting / progress.total) * 100 : 0} 100`}
                        strokeDashoffset={
                          -(progress.total
                            ? (progress.solved / progress.total) * 100
                            : 0)
                        }
                      />
                    )}
                  </svg>
                  <div className="programming-gauge-value">
                    <strong>
                      {problems.isPending ? "—" : progress.solved}
                      <small>
                        /{problems.isPending ? "—" : progress.total}
                      </small>
                    </strong>
                    <span>
                      <i aria-hidden="true">✓</i> Solved
                    </span>
                  </div>
                  <p className="programming-gauge-caption">
                    <b>{problems.isPending ? "—" : progress.attempting}</b>{" "}
                    Attempting
                  </p>
                </div>
                <div className="learning-complexity-grid programming-difficulty-stack">
                  {progress.difficulties.map((row) => (
                    <div key={row.name} data-level={row.name.toLowerCase()}>
                      <span>{row.name}</span>
                      <b>
                        {problems.isPending ? "—" : row.completed}
                        <small> / {problems.isPending ? "—" : row.total}</small>
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {!ready && (
        <p>Your assigned CRT and programming learning will appear here.</p>
      )}
    </section>
  );
}
