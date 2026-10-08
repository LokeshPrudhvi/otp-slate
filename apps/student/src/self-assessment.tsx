import { useState } from "react";
import { Link } from "react-router-dom";
import { ScoreTrend, useMe } from "@slate/ui";
import { readPracticeHistory } from "./practice-history";

const sampleHistory = [
  { label: "01", score: 48, detail: "Sample aptitude fundamentals" },
  { label: "02", score: 62, detail: "Sample percentages quiz" },
  { label: "03", score: 58, detail: "Sample logical reasoning sprint" },
  { label: "04", score: 74, detail: "Sample interview essentials" },
  { label: "05", score: 82, detail: "Sample placement readiness mock" },
];

export function SelfAssessment() {
  const me = useMe();
  const [limit, setLimit] = useState(5);
  const history = readPracticeHistory(me.data!.id);
  const sample = !history.length && me.data?.demo;
  const points = (
    sample
      ? sampleHistory
      : history.map((result, index) => ({
          label: String(index + 1).padStart(2, "0"),
          score: result.score,
          detail: `${result.title} · ${new Date(result.completedAt).toLocaleDateString("en-IN")}`,
        }))
  ).slice(-limit);
  const latest = points.at(-1);
  const change = points.length > 1 ? latest!.score - points[0].score : null;
  return (
    <section
      className="self-assessment-card"
      aria-labelledby="self-assessment-title"
    >
      <span className="hub-eyebrow">YOUR LEARNING SNAPSHOT</span>
      <h2 id="self-assessment-title">Self-assessment</h2>
      <p className="self-assessment-subtitle">
        See how your practice is progressing.
      </p>
      {latest ? (
        <>
          <div className="self-assessment-score">
            <div>
              <strong>
                {latest.score}
                <span>%</span>
              </strong>
              <small>Latest score</small>
            </div>
            {change !== null && (
              <span
                className={`self-assessment-change${change < 0 ? " declining" : ""}`}
              >
                {change > 0 ? "+" : ""}
                {change} pts
              </span>
            )}
          </div>
          <div className="self-assessment-chart-head">
            <span>Quiz scores · %</span>
            <select
              aria-label="Self-assessment history"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              <option value={5}>Last 5</option>
              <option value={3}>Last 3</option>
            </select>
          </div>
          <ScoreTrend
            compact
            points={points}
            label="Your self-assessment quiz scores by attempt"
          />
          <p className="self-assessment-caption">
            {sample
              ? "Sample history · Complete a quiz to start your own graph."
              : `${history.length} completed ${history.length === 1 ? "quiz" : "quizzes"} · Saved in this browser.`}
          </p>
          {!sample && (
            <p className="self-assessment-latest">Latest: {latest.detail}</p>
          )}
        </>
      ) : (
        <div className="self-assessment-empty">
          <span aria-hidden="true">↗</span>
          <b>Your progress starts here</b>
          <p>Complete a practice quiz to see your scores over time.</p>
        </div>
      )}
      <Link className="self-assessment-link" to="/practice">
        Take a self-assessment <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
