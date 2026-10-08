import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PracticeAssessment } from "@slate/contracts";
import { useData, useMe } from "@slate/ui";
import { Heading, NoResults, Status } from "./design";
import { generateTestCasesForProblem, type TestCase } from "./test-cases";
import { executeViaOneCompiler, type ExecutionVerdict } from "./code-runner";

type Progress = { bookmarked?: boolean; status?: "Attempted" | "Solved" };
type Submission = {
  date: string;
  language: string;
  code: string;
  verdict?: string;
  runtimeMs?: number;
  passedCount?: number;
  totalTests?: number;
};
function useLocalDemo<T>(name: string, fallback: T) {
  const me = useMe();
  const key = `slate-demo-coding:${me.data!.id}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  });
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [key, value]);
  return [value, setValue, saved] as const;
}
const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 };
const plans = [
  {
    id: "starter",
    title: "Start with 30",
    description: "Build your foundations with approachable exercises.",
    limit: 30,
    difficulty: "Easy",
  },
  {
    id: "interview",
    title: "Interview 75",
    description: "Practise a balanced mix of core interview patterns.",
    limit: 75,
    difficulty: "all",
  },
  {
    id: "advanced",
    title: "Advanced challenges",
    description: "Stretch your reasoning with the hard problem set.",
    limit: 40,
    difficulty: "Hard",
  },
];
function planItems(items: PracticeAssessment[], plan: string) {
  const config = plans.find((item) => item.id === plan);
  if (!config) return items;
  const matched = items.filter(
    (item) =>
      config.difficulty === "all" || item.difficulty === config.difficulty,
  );
  // Interleave topics to keep plans varied, rather than taking one topic at a time.
  return [...matched]
    .sort(
      (a, b) =>
        ((a.number! - 1) % 10) - ((b.number! - 1) % 10) ||
        a.number! - b.number!,
    )
    .slice(0, config.limit);
}
export function CodingLibrary() {
  const data = useData<PracticeAssessment[]>("practice", "student/practice"),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  const [progress, setProgress] = useLocalDemo<Record<string, Progress>>(
    "progress",
    {},
  );
  const [lists, setLists] = useLocalDemo<Record<string, string[]>>("lists", {});
  const [listName, setListName] = useState("");
  const items = (data.data || []).filter((item) => item.kind === "coding");
  const topics = [
    ...new Set(items.flatMap((item) => item.topics || [])),
  ].sort();
  const search = params.get("search") || "",
    difficulty = params.get("difficulty") || "all",
    topic = params.get("topic") || "all",
    status = params.get("status") || "all",
    list = params.get("list") || "all",
    plan = params.get("plan") || "all",
    sort = params.get("sort") || "number",
    page = Math.max(1, Number(params.get("page")) || 1);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(paramsRef.current);
    next.set(key, value);
    if (key !== "page") next.delete("page");
    paramsRef.current = next;
    setParams(next);
  };
  const filtered = planItems(items, plan)
    .filter(
      (item) =>
        `${item.number} ${item.title} ${(item.topics || []).join(" ")}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (difficulty === "all" || item.difficulty === difficulty) &&
        (topic === "all" || item.topics?.includes(topic)) &&
        (status === "all" ||
          (progress[item.id]?.status || "Not started") === status) &&
        (list === "all" ||
          (list === "bookmarks"
            ? progress[item.id]?.bookmarked
            : lists[list]?.includes(item.id))),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "difficulty"
          ? difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty] ||
            a.number! - b.number!
          : sort === "hardest"
            ? difficultyOrder[b.difficulty] - difficultyOrder[a.difficulty] ||
              a.number! - b.number!
            : a.number! - b.number!,
    );
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20)),
    currentPage = Math.min(page, totalPages),
    visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const solved = items.filter(
    (item) => progress[item.id]?.status === "Solved",
  ).length;
  const day = Math.floor(Date.now() / 86400000),
    daily = items[day % Math.max(items.length, 1)];
  return (
    <div className="a-page coding-library">
      <div className="a-crumbs">
        <Link to="/practice">Practice</Link>
        <span>›</span>
        <span>DSA / Coding Questions</span>
      </div>
      <Heading title="DSA / Coding Questions">
        <span className="a-tag">{items.length} sample problems</span>
      </Heading>
      <p className="hub-note">
        Build your problem-solving skills, one pattern at a time. Your drafts,
        lists and self-assessed progress are saved in this browser.
      </p>
      <Status pending={data.isPending} error={data.error} />
      {items.length > 0 && (
        <>
          <details className="coding-planning">
            <summary>
              Your progress, daily pick & study plans{" "}
              <span>
                {solved} / {items.length} self-assessed solved
              </span>
            </summary>
            <div className="coding-top-grid">
              <section className="coding-progress-card">
                <span className="hub-eyebrow">YOUR PRACTICE</span>
                <h2>
                  {solved}
                  <span> / {items.length}</span>
                </h2>
                <p>Self-assessed solved</p>
                <progress
                  aria-label="Self-assessed coding progress"
                  value={solved}
                  max={items.length}
                />
                <div className="coding-counts">
                  {["Easy", "Medium", "Hard"].map((level) => (
                    <span
                      key={level}
                      className={`difficulty ${level.toLowerCase()}`}
                    >
                      {level}{" "}
                      <b>
                        {
                          items.filter(
                            (item) =>
                              item.difficulty === level &&
                              progress[item.id]?.status === "Solved",
                          ).length
                        }
                        /
                        {
                          items.filter((item) => item.difficulty === level)
                            .length
                        }
                      </b>
                    </span>
                  ))}
                </div>
              </section>
              <section className="coding-daily-card">
                <span className="hub-eyebrow">TODAY'S PRACTICE PICK</span>
                <h2>{daily?.title}</h2>
                <p>
                  {daily?.topics?.join(" · ")} · {daily?.difficulty}
                </p>
                <Link className="a-btn pri" to={`/practice/${daily?.id}`}>
                  Solve today's problem →
                </Link>
              </section>
            </div>
            <div className="coding-plans">
              {plans.map((item) => (
                <button
                  key={item.id}
                  className={`coding-plan${plan === item.id ? " selected" : ""}`}
                  aria-pressed={plan === item.id}
                  onClick={() =>
                    update("plan", plan === item.id ? "all" : item.id)
                  }
                >
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                  <small>
                    {
                      planItems(items, item.id).filter(
                        (problem) => progress[problem.id]?.status === "Solved",
                      ).length
                    }{" "}
                    / {planItems(items, item.id).length} self-assessed
                  </small>
                </button>
              ))}
            </div>
          </details>
          <section className="coding-list-panel">
            <div className="coding-list-top">
              <h2>Problem library</h2>
              <button
                className="a-btn"
                disabled={!filtered.length}
                onClick={() =>
                  navigate(
                    `/practice/${filtered[Math.floor(Math.random() * filtered.length)].id}`,
                  )
                }
              >
                ↝ Pick a random problem
              </button>
            </div>
            <div className="coding-filter-row">
              <input
                className="a-search"
                aria-label="Search coding problems"
                type="search"
                placeholder="Search title, number or topic…"
                value={search}
                onChange={(event) => update("search", event.target.value)}
              />
              <label>
                Difficulty
                <select
                  value={difficulty}
                  onChange={(event) => update("difficulty", event.target.value)}
                >
                  <option value="all">All difficulties</option>
                  {["Easy", "Medium", "Hard"].map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
              </label>
              <label>
                Topic
                <select
                  value={topic}
                  onChange={(event) => update("topic", event.target.value)}
                >
                  <option value="all">All topics</option>
                  {topics.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={status}
                  onChange={(event) => update("status", event.target.value)}
                >
                  <option value="all">All statuses</option>
                  {["Not started", "Attempted", "Solved"].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Sort by
                <select
                  value={sort}
                  onChange={(event) => update("sort", event.target.value)}
                >
                  <option value="number">Problem number</option>
                  <option value="title">Title A–Z</option>
                  <option value="difficulty">Easy → Hard</option>
                  <option value="hardest">Hard → Easy</option>
                </select>
              </label>
            </div>
            <div className="coding-topic-chips">
              {[
                "Arrays",
                "Strings",
                "Binary Search",
                "Dynamic Programming",
                "Graph",
                "Binary Tree",
              ].map((name) => (
                <button
                  className={`a-pill${topic === name ? " on" : ""}`}
                  key={name}
                  aria-pressed={topic === name}
                  onClick={() => update("topic", topic === name ? "all" : name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="coding-list-tools">
              <label>
                My lists
                <select
                  value={list}
                  onChange={(event) => update("list", event.target.value)}
                >
                  <option value="all">All problems</option>
                  <option value="bookmarks">★ Bookmarks</option>
                  {Object.keys(lists).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = listName.trim();
                  if (
                    !name ||
                    name === "all" ||
                    name === "bookmarks" ||
                    lists[name]
                  )
                    return;
                  setLists((current) => ({ ...current, [name]: [] }));
                  setListName("");
                  update("list", name);
                }}
              >
                <input
                  aria-label="New coding list name"
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  maxLength={40}
                  placeholder="Create a practice list"
                />
                <button
                  className="a-btn"
                  disabled={!listName.trim() || !!lists[listName.trim()]}
                >
                  Create list
                </button>
              </form>
              <button className="a-btn" onClick={() => setParams({})}>
                Clear filters
              </button>
            </div>
            <p className="hub-note" role="status">
              {filtered.length} matching problems
              {plan !== "all"
                ? ` · ${plans.find((item) => item.id === plan)?.title || "Study plan"}`
                : ""}
            </p>
            {visible.length ? (
              <div className="coding-table-scroll">
                <table className="coding-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Problem</th>
                      <th>Difficulty</th>
                      <th>Topic</th>
                      <th>Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span
                            className={`coding-status ${(progress[item.id]?.status || "").toLowerCase()}`}
                            title={progress[item.id]?.status || "Not started"}
                          >
                            {progress[item.id]?.status === "Solved"
                              ? "✓"
                              : progress[item.id]?.status === "Attempted"
                                ? "◐"
                                : "○"}
                            <span className="student-skip">
                              {progress[item.id]?.status || "Not started"}
                            </span>
                          </span>
                        </td>
                        <td>
                          <Link to={`/practice/${item.id}`}>
                            <span className="coding-number">
                              {item.number}.
                            </span>
                            {item.title}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={`difficulty ${item.difficulty.toLowerCase()}`}
                          >
                            {item.difficulty}
                          </span>
                        </td>
                        <td>{item.topics?.join(" · ")}</td>
                        <td>
                          <button
                            className="coding-star"
                            aria-label={`${progress[item.id]?.bookmarked ? "Remove bookmark for" : "Bookmark"} ${item.title}`}
                            aria-pressed={!!progress[item.id]?.bookmarked}
                            onClick={() =>
                              setProgress((current) => ({
                                ...current,
                                [item.id]: {
                                  ...current[item.id],
                                  bookmarked: !current[item.id]?.bookmarked,
                                },
                              }))
                            }
                          >
                            {progress[item.id]?.bookmarked ? "★" : "☆"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <NoResults title="No matching problems">
                Try another topic, switch lists or clear filters. Add problems
                to a custom list from their workspace.
              </NoResults>
            )}
            <div className="coding-pagination">
              <label>
                Page
                <select
                  value={currentPage}
                  onChange={(event) => update("page", event.target.value)}
                >
                  {Array.from({ length: totalPages }, (_, index) => (
                    <option key={index} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>{" "}
                of {totalPages}
              </label>
              <span>20 problems per page</span>
              <button
                className="a-btn"
                disabled={currentPage === 1}
                onClick={() => update("page", String(currentPage - 1))}
              >
                Previous page
              </button>
              <button
                className="a-btn"
                disabled={currentPage === totalPages}
                onClick={() => update("page", String(currentPage + 1))}
              >
                Next page
              </button>
            </div>
          </section>
        </>
      )}
      {!data.isPending && !data.error && !items.length && (
        <NoResults title="No coding questions assigned">
          Your assigned coding problem library will appear here.
        </NoResults>
      )}
    </div>
  );
}

export function CodingWorkspace({
  assessment,
  items,
}: {
  assessment: PracticeAssessment;
  items: PracticeAssessment[];
}) {
  const problem = assessment.problem!;
  const testSuite = useMemo(
    () =>
      generateTestCasesForProblem(
        assessment.title,
        problem.examples[0]?.input || "{}",
        problem.examples[0]?.output || "{}",
        assessment.topics?.[0] || "",
      ),
    [assessment.title, problem.examples, assessment.topics],
  );

  const [progress, setProgress] = useLocalDemo<Record<string, Progress>>(
    "progress",
    {},
  );
  const [lists, setLists] = useLocalDemo<Record<string, string[]>>("lists", {});
  const [draft, setDraft, draftSaved] = useLocalDemo<Record<string, string>>(
    `draft:${assessment.id}`,
    problem.starterCode,
  );
  const [notes, setNotes] = useLocalDemo<string>(`notes:${assessment.id}`, "");
  const [history, setHistory] = useLocalDemo<Submission[]>(
    `submissions:${assessment.id}`,
    [],
  );
  const [settings, setSettings] = useLocalDemo("settings", {
    language: "Python",
    theme: "light",
    font: 14,
    tabSize: 4,
  });
  const [tab, setTab] = useState("Description"),
    [consoleTab, setConsoleTab] = useState("Test cases"),
    [testCase, setTestCase] = useState(0),
    [custom, setCustom] = useState(""),
    [verdict, setVerdict] = useState<ExecutionVerdict | null>(null),
    [selectedTestIdx, setSelectedTestIdx] = useState(0),
    [isRunning, setIsRunning] = useState(false),
    [wide, setWide] = useState(false),
    [options, setOptions] = useState(false),
    [chosenList, setChosenList] = useState(""),
    [reply, setReply] = useState(""),
    [savedReply, setSavedReply] = useLocalDemo<string>(
      `discussion:${assessment.id}`,
      "",
    );

  const language = settings.language,
    source = draft[language] ?? problem.starterCode[language] ?? "";
  const currentIndex = items.findIndex((item) => item.id === assessment.id),
    previous = items[currentIndex - 1],
    next = items[currentIndex + 1];
  const state = progress[assessment.id] || {};
  const setStatus = (status: Progress["status"]) =>
    setProgress((current) => ({
      ...current,
      [assessment.id]: { ...current[assessment.id], status },
    }));

  const run = async () => {
    setIsRunning(true);
    setConsoleTab("Result");
    let casesToRun: TestCase[];

    if (custom.trim()) {
      try {
        JSON.parse(custom);
        casesToRun = [
          {
            input: custom.trim(),
            output: "",
            description: "Custom Test Case",
          },
        ];
      } catch {
        setVerdict({
          status: "Compilation Error",
          totalTests: 1,
          passedCount: 0,
          runtimeMs: 0,
          results: [
            {
              testIndex: 0,
              input: custom,
              expected: "",
              passed: false,
              error: "Invalid JSON format in custom test case.",
            },
          ],
          errorSummary:
            "Invalid JSON format. Check quotes, commas, and braces before running.",
        });
        setIsRunning(false);
        return;
      }
    } else {
      const activeCase = testSuite[testCase] || {
        input: problem.examples[testCase]?.input || "{}",
        output: problem.examples[testCase]?.output || "{}",
        description: `Example ${testCase + 1}`,
      };
      casesToRun = [activeCase];
    }

    try {
      const res = await executeViaOneCompiler(language, source, casesToRun);
      setVerdict(res);
      setSelectedTestIdx(0);
    } catch (err: any) {
      setVerdict({
        status: "Runtime Error",
        totalTests: casesToRun.length,
        passedCount: 0,
        runtimeMs: 0,
        results: [],
        errorSummary: err?.message || "Execution failed",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const submit = async () => {
    setIsRunning(true);
    setConsoleTab("Result");

    try {
      const res = await executeViaOneCompiler(language, source, testSuite);
      setVerdict(res);
      setSelectedTestIdx(0);

      if (res.status === "Accepted") {
        setStatus("Solved");
      } else {
        setStatus(state.status === "Solved" ? "Solved" : "Attempted");
      }

      setHistory((current) =>
        [
          {
            date: new Date().toISOString(),
            language,
            code: source,
            verdict: res.status,
            runtimeMs: res.runtimeMs,
            passedCount: res.passedCount,
            totalTests: res.totalTests,
          },
          ...current,
        ].slice(0, 20),
      );
    } catch (err: any) {
      setVerdict({
        status: "Runtime Error",
        totalTests: testSuite.length,
        passedCount: 0,
        runtimeMs: 0,
        results: [],
        errorSummary: err?.message || "Execution failed",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className={`coding-workspace${wide ? " editor-wide" : ""}`}>
      <div className="coding-workspace-top">
        <Link className="a-btn" to="/practice/coding">
          ☷ Problem list
        </Link>
        <div className="coding-problem-nav">
          {previous ? (
            <Link
              className="a-btn"
              aria-label="Previous problem"
              to={`/practice/${previous.id}`}
            >
              ←
            </Link>
          ) : (
            <button className="a-btn" disabled aria-label="Previous problem">
              ←
            </button>
          )}
          <span>
            {assessment.number} / {items.length}
          </span>
          {next ? (
            <Link
              className="a-btn"
              aria-label="Next problem"
              to={`/practice/${next.id}`}
            >
              →
            </Link>
          ) : (
            <button className="a-btn" disabled aria-label="Next problem">
              →
            </button>
          )}
        </div>
        <span className="a-tag">DSA Practice</span>
        <button className="a-btn" onClick={() => setWide(!wide)}>
          {wide ? "Restore split view" : "Expand code panel"}
        </button>
      </div>
      <div className="coding-workspace-note">
        OneCompiler Multi-Case Execution Active · Run test cases or submit solution to validate against comprehensive test suites.
      </div>
      <div className="coding-split">
        <section className="coding-description-panel">
          <div
            className="coding-panel-tabs"
            role="tablist"
            aria-label="Problem content"
          >
            {[
              "Description",
              "Solution guide",
              "Submissions",
              "Discussion",
              "Notes",
            ].map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div
            className="coding-description-body"
            role="tabpanel"
            aria-label={tab}
          >
            <h1>
              {assessment.number}. {assessment.title}
            </h1>
            <div className="coding-problem-meta">
              <span
                className={`difficulty ${assessment.difficulty.toLowerCase()}`}
              >
                {assessment.difficulty}
              </span>
              {assessment.topics?.map((topic) => (
                <Link
                  className="a-tag"
                  key={topic}
                  to={`/practice/coding?topic=${encodeURIComponent(topic)}`}
                >
                  {topic}
                </Link>
              ))}
              <button
                className="coding-star"
                aria-pressed={!!state.bookmarked}
                aria-label={
                  state.bookmarked
                    ? "Remove problem bookmark"
                    : "Bookmark problem"
                }
                onClick={() =>
                  setProgress((current) => ({
                    ...current,
                    [assessment.id]: {
                      ...current[assessment.id],
                      bookmarked: !current[assessment.id]?.bookmarked,
                    },
                  }))
                }
              >
                {state.bookmarked ? "★ Saved" : "☆ Save"}
              </button>
            </div>
            {tab === "Description" && (
              <>
                <p>{problem.statement}</p>
                {problem.examples.map((example, index) => (
                  <div className="demo-example" key={index}>
                    <b>Example {index + 1}</b>
                    <pre>
                      Input: {example.input}
                      {"\n"}Output: {example.output}
                    </pre>
                    <p>{example.explanation}</p>
                  </div>
                ))}
                <h3>Constraints</h3>
                <ul>
                  {problem.constraints.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <h3>Hints</h3>
                {problem.hints?.map((hint, index) => (
                  <details className="coding-hint" key={hint}>
                    <summary>Hint {index + 1}</summary>
                    <p>{hint}</p>
                  </details>
                ))}
                <div className="coding-self-progress">
                  <label>
                    Practice status
                    <select
                      value={state.status || "Not started"}
                      onChange={(event) =>
                        setStatus(
                          event.target.value === "Not started"
                            ? undefined
                            : (event.target.value as Progress["status"]),
                        )
                      }
                    >
                      {["Not started", "Attempted", "Solved"].map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <small>Updated automatically upon passing test suite on submit.</small>
                </div>
                <form
                  className="coding-add-list"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!chosenList) return;
                    setLists((current) => ({
                      ...current,
                      [chosenList]: [
                        ...new Set([
                          ...(current[chosenList] || []),
                          assessment.id,
                        ]),
                      ],
                    }));
                  }}
                >
                  <label>
                    Add to my list
                    <select
                      value={chosenList}
                      onChange={(event) => setChosenList(event.target.value)}
                    >
                      <option value="">Choose a list</option>
                      {Object.keys(lists).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="a-btn"
                    disabled={
                      !chosenList || lists[chosenList]?.includes(assessment.id)
                    }
                  >
                    {lists[chosenList]?.includes(assessment.id)
                      ? "Added"
                      : "Add problem"}
                  </button>
                  <Link to="/practice/coding">Create a list</Link>
                </form>
              </>
            )}
            {tab === "Solution guide" && (
              <>
                <h2>Approach</h2>
                <p>{problem.approach}</p>
                <h3>Before you finish</h3>
                <ul>
                  <li>Explain why your invariant remains true.</li>
                  <li>State your time and auxiliary-space complexity.</li>
                  <li>Try boundary cases and the tie-breaking rules.</li>
                </ul>
                <p className="hub-note">
                  Original reference learning guide for problem analysis.
                </p>
              </>
            )}
            {tab === "Submissions" && (
              <>
                <h2>Your Submissions</h2>
                <p className="hub-note">
                  Evaluation history with execution verdicts and pass rates.
                </p>
                {history.length ? (
                  history.map((item, index) => (
                    <details
                      className="coding-hint"
                      key={`${item.date}:${index}`}
                    >
                      <summary>
                        <strong>{item.verdict || "Submitted"}</strong> · {item.language} · {new Date(item.date).toLocaleString()}
                        {item.totalTests ? ` (${item.passedCount}/${item.totalTests} passed, ${item.runtimeMs}ms)` : ""}
                      </summary>
                      <pre>{item.code}</pre>
                      <button
                        className="a-btn"
                        onClick={() => {
                          setSettings((current) => ({
                            ...current,
                            language: item.language,
                          }));
                          setDraft((current) => ({
                            ...current,
                            [item.language]: item.code,
                          }));
                        }}
                      >
                        Restore submitted code
                      </button>
                    </details>
                  ))
                ) : (
                  <p>
                    No submissions yet. Write a solution and click Submit solution to evaluate against all test cases.
                  </p>
                )}
              </>
            )}
            {tab === "Notes" && (
              <>
                <h2>Your solution notes</h2>
                <label htmlFor="coding-notes">
                  Approach, complexity and edge cases
                </label>
                <textarea
                  id="coding-notes"
                  className="demo-textarea"
                  placeholder="What did you learn from this problem?"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <small>Saved in this browser for your account.</small>
              </>
            )}
            {tab === "Discussion" && (
              <>
                <h2>Discuss the approach</h2>
                <article className="coding-discussion">
                  <strong>Practice mentor · Sample discussion</strong>
                  <p>{problem.hints?.[0]}</p>
                  <p>
                    Which edge case would distinguish your approach from a
                    brute-force solution?
                  </p>
                </article>
                {savedReply && (
                  <article className="coding-discussion">
                    <strong>Your local reply</strong>
                    <p>{savedReply}</p>
                  </article>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSavedReply(reply);
                    setReply("");
                  }}
                >
                  <label htmlFor="coding-reply">Your reflection</label>
                  <textarea
                    className="demo-textarea"
                    id="coding-reply"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    required
                  />
                  <button className="a-btn" disabled={!reply.trim()}>
                    Save local reply
                  </button>
                  <p className="hub-note">
                    Replies stay in this browser; there is no public discussion
                    service yet.
                  </p>
                </form>
              </>
            )}
          </div>
        </section>
        <section
          className={`coding-editor-panel ${settings.theme === "dark" ? "coding-dark" : ""}`}
        >
          <div className="coding-editor-top">
            <strong>⌘ Code</strong>
            <span>
              {draftSaved
                ? "Draft saved locally"
                : "Browser storage unavailable"}
            </span>
            <button
              className="a-btn"
              aria-expanded={options}
              onClick={() => setOptions(!options)}
            >
              Editor settings
            </button>
          </div>
          <div className="coding-editor-tools">
            <label>
              Language
              <select
                aria-label="Programming language"
                value={language}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    language: event.target.value,
                  }))
                }
              >
                {Object.keys(problem.starterCode).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              className="a-btn"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  [language]: problem.starterCode[language],
                }))
              }
            >
              Reset code
            </button>
            <button
              className="a-btn"
              disabled={!history.length}
              onClick={() => {
                const last = history[0];
                setSettings((current) => ({
                  ...current,
                  language: last.language,
                }));
                setDraft((current) => ({
                  ...current,
                  [last.language]: last.code,
                }));
              }}
            >
              Restore last draft
            </button>
          </div>
          {options && (
            <div className="coding-settings">
              <label>
                Theme
                <select
                  value={settings.theme}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      theme: event.target.value,
                    }))
                  }
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                Font size
                <select
                  value={settings.font}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      font: Number(event.target.value),
                    }))
                  }
                >
                  {[12, 14, 16, 18].map((size) => (
                    <option key={size} value={size}>
                      {size} px
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tab size
                <select
                  value={settings.tabSize}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      tabSize: Number(event.target.value),
                    }))
                  }
                >
                  <option value={2}>2 spaces</option>
                  <option value={4}>4 spaces</option>
                </select>
              </label>
            </div>
          )}
          <div className="coding-code-container">
            <div
              className="coding-line-numbers"
              aria-hidden="true"
              style={{ fontSize: settings.font }}
            >
              {source.split("\n").map((_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
            <textarea
              className="coding-code-input"
              aria-label="Solution code"
              spellCheck={false}
              style={{ fontSize: settings.font, tabSize: settings.tabSize }}
              value={source}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [language]: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  event.preventDefault();
                  const { selectionStart: start, selectionEnd: end } =
                    event.currentTarget;
                  const spaces = " ".repeat(settings.tabSize);
                  setDraft((current) => ({
                    ...current,
                    [language]:
                      source.slice(0, start) + spaces + source.slice(end),
                  }));
                  const area = event.currentTarget;
                  requestAnimationFrame(() =>
                    area.setSelectionRange(
                      start + spaces.length,
                      start + spaces.length,
                    ),
                  );
                }
              }}
            />
          </div>
          <div className="coding-run-row">
            <span className="coding-engine-status">
              <span
                className={`coding-engine-dot${isRunning ? " running" : ""}`}
              ></span>
              {isRunning ? "Executing on OneCompiler..." : "OneCompiler Engine Active"}
            </span>
            <button className="a-btn" disabled={isRunning} onClick={run}>
              ▷ Run
            </button>
            <button
              className="a-btn pri"
              disabled={!source.trim() || isRunning}
              onClick={submit}
            >
              {isRunning ? "Running tests..." : "Submit solution ↑"}
            </button>
          </div>
          <div className="coding-console">
            <div
              className="coding-panel-tabs"
              role="tablist"
              aria-label="Test console"
            >
              {["Test cases", "Result"].map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={consoleTab === name}
                  onClick={() => setConsoleTab(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div
              className="coding-console-body"
              role="tabpanel"
              aria-label={consoleTab}
            >
              {consoleTab === "Test cases" ? (
                <>
                  <div className="coding-test-buttons">
                    {problem.examples.map((_, index) => (
                      <button
                        key={index}
                        className={`a-pill${testCase === index && !custom ? " on" : ""}`}
                        onClick={() => {
                          setTestCase(index);
                          setCustom("");
                        }}
                      >
                        Case {index + 1}
                      </button>
                    ))}
                  </div>
                  <pre>{problem.examples[testCase]?.input}</pre>
                  <label htmlFor="coding-custom-test">
                    Custom test case (JSON)
                  </label>
                  <textarea
                    id="coding-custom-test"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    placeholder='{"nums": [1, 2, 3]}'
                    rows={3}
                  />
                </>
              ) : isRunning ? (
                <div className="coding-executing-box">
                  <span className="coding-engine-dot running"></span>
                  <span>Executing solution against test suite on OneCompiler engine...</span>
                </div>
              ) : verdict ? (
                <div className="coding-verdict-card">
                  <div className="coding-verdict-header">
                    <div
                      className={`coding-verdict-title ${
                        verdict.status === "Accepted"
                          ? "accepted"
                          : verdict.status.includes("Error")
                            ? "error"
                            : "rejected"
                      }`}
                    >
                      {verdict.status === "Accepted"
                        ? "✓ Accepted"
                        : verdict.status === "Wrong Answer"
                          ? "✗ Wrong Answer"
                          : `⚠ ${verdict.status}`}
                    </div>
                    <div className="coding-verdict-metrics">
                      <span>
                        Passed: <strong>{verdict.passedCount} / {verdict.totalTests}</strong>
                      </span>
                      <span>
                        Runtime: <strong>{verdict.runtimeMs} ms</strong>
                      </span>
                      {verdict.memoryMb && (
                        <span>
                          Memory: <strong>{verdict.memoryMb} MB</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {verdict.errorSummary && (
                    <div className="coding-io-box io-error" style={{ marginBottom: 12 }}>
                      <label>Error Details</label>
                      <pre>{verdict.errorSummary}</pre>
                    </div>
                  )}

                  {verdict.results.length > 0 && (
                    <>
                      <div className="coding-test-selector">
                        {verdict.results.map((r, idx) => (
                          <button
                            key={idx}
                            className={`coding-test-pill${
                              selectedTestIdx === idx ? " selected" : ""
                            }`}
                            onClick={() => setSelectedTestIdx(idx)}
                          >
                            <span>Test {idx + 1}</span>
                            <span
                              className={`pill-badge ${r.passed ? "pass" : "fail"}`}
                            >
                              {r.passed ? "✓" : "✗"}
                            </span>
                          </button>
                        ))}
                      </div>

                      {verdict.results[selectedTestIdx] && (() => {
                        const activeResult = verdict.results[selectedTestIdx];
                        return (
                          <div className="coding-io-grid">
                            <div className="coding-io-box">
                              <label>
                                Input {activeResult.description ? `(${activeResult.description})` : ""}
                              </label>
                              <pre>{activeResult.input}</pre>
                            </div>
                            {activeResult.expected ? (
                              <div className="coding-io-box">
                                <label>Expected Output</label>
                                <pre>{activeResult.expected}</pre>
                              </div>
                            ) : null}
                            <div
                              className={`coding-io-box${
                                !activeResult.passed ? " io-error" : ""
                              }`}
                            >
                              <label>Your Output</label>
                              <pre>
                                {activeResult.actual ||
                                  activeResult.error ||
                                  "(no output)"}
                              </pre>
                            </div>
                            {activeResult.stdout ? (
                              <div
                                className="coding-io-box"
                                style={{ gridColumn: "1 / -1" }}
                              >
                                <label>Standard Output (Logs)</label>
                                <pre>{activeResult.stdout}</pre>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              ) : (
                <div className="coding-empty-result">
                  Run your code against sample cases or click Submit solution to validate against the comprehensive test suite.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
