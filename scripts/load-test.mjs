#!/usr/bin/env node
import { readFile, stat, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";

// Read-only authenticated student journeys. Fixtures contain sessions and must
// never be committed; response bodies and credentials never enter the report.
const usage = `Usage: node scripts/load-test.mjs --fixtures PRIVATE_JSON --users 25|50|100
  [--target https://otp-slate-student.pages.dev] [--duration 120]
  [--ramp 10] [--think 10] [--identity-interval 20] [--timeout 15]
  [--max-requests 5000] [--out-dir .local/load-tests] [--burst]

PRIVATE_JSON: [{ "id": "member-id", "cookie": "session-cookie", "courseId": "assigned-course-id" }]
The file must have mode 0600. Duration includes the ramp. --burst adds one
separately reported synchronized course-list request per user after the stage.
Create OUT_DIR/.stop to stop scheduling requests; in-flight requests drain.
`;

function parseArguments(argv) {
  const values = {};
  const supported = new Set(["fixtures", "users", "target", "duration", "ramp", "think", "identity-interval", "timeout", "max-requests", "out-dir"]);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (argv[i] === "--help") return { help: true };
    if (argv[i] === "--burst") { values.burst = true; continue; }
    if (!argv[i].startsWith("--") || !supported.has(name) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("Unknown option or missing argument. Use --help.");
    values[name] = argv[++i];
  }
  const number = (key, fallback, min, max, integer = false) => {
    const result = Number(values[key] ?? fallback);
    if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) throw new Error(`Invalid --${key}.`);
    return result;
  };
  if (!values.fixtures) throw new Error("--fixtures is required.");
  const target = new URL(values.target ?? "https://otp-slate-student.pages.dev");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if ((!local && (target.protocol !== "https:" || target.hostname !== "otp-slate-student.pages.dev")) || (local && !["http:", "https:"].includes(target.protocol)) || target.username || target.password || target.search || target.hash || target.pathname !== "/") throw new Error("Target must be the student Pages origin or a local test server, without a path or credentials.");
  const users = number("users", 25, 1, 100, true);
  if (!local && ![25, 50, 100].includes(users)) throw new Error("Hosted stages must use 25, 50, or 100 students.");
  const duration = number("duration", 120, 1, 600);
  return {
    fixtures: resolve(values.fixtures), users, target: target.origin, duration,
    ramp: number("ramp", 10, 0, duration),
    think: number("think", 10, local ? 0.01 : 5, 120),
    identityInterval: number("identity-interval", 20, local ? 0.01 : 10, 120),
    timeout: number("timeout", 15, 0.05, 30),
    maxRequests: number("max-requests", 5000, 1, 5000, true),
    outDir: resolve(values["out-dir"] ?? ".local/load-tests"), burst: Boolean(values.burst),
  };
}

const quantile = (values, q) => values.length ? Math.round([...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] * 100) / 100 : null;
function aggregate(records, wallSeconds) {
  const durations = records.map((r) => r.durationMs);
  const failures = records.filter((r) => !r.ok).length;
  const statuses = {};
  for (const row of records) statuses[row.status || "network-error"] = (statuses[row.status || "network-error"] ?? 0) + 1;
  return {
    requests: records.length, successes: records.length - failures, failures,
    errorRate: records.length ? failures / records.length : 0,
    requestsPerSecond: wallSeconds > 0 ? Number((records.length / wallSeconds).toFixed(3)) : 0,
    medianMs: quantile(durations, 0.5), p95Ms: quantile(durations, 0.95), p99Ms: quantile(durations, 0.99),
    maxMs: quantile(durations, 1), p95ScheduledLagMs: quantile(records.map((r) => r.scheduledLagMs), 0.95),
    statuses,
  };
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ms)));

async function run(config) {
  const fixtureStat = await stat(config.fixtures);
  if (!fixtureStat.isFile() || (fixtureStat.mode & 0o777) !== 0o600) throw new Error("Fixture must be a regular file with permissions 0600.");
  const parsed = JSON.parse(await readFile(config.fixtures, "utf8"));
  const fixtures = Array.isArray(parsed) ? parsed : parsed.students;
  if (!Array.isArray(fixtures) || fixtures.length < config.users) throw new Error("Not enough student fixtures for this stage.");
  const students = fixtures.slice(0, config.users);
  if (students.some((s) => !s || typeof s.id !== "string" || !s.id || typeof s.cookie !== "string" || !s.cookie || /[\r\n]/.test(s.cookie) || (s.courseId !== undefined && (typeof s.courseId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(s.courseId))))) throw new Error("Fixture has an invalid student ID, cookie, or course ID.");
  if (new Set(students.map((s) => s.id)).size !== students.length || new Set(students.map((s) => s.cookie)).size !== students.length) throw new Error("Each virtual student must have a distinct identity and session cookie.");
  await mkdir(config.outDir, { recursive: true, mode: 0o700 });
  const stopFile = join(config.outDir, ".stop");
  try { await access(stopFile); throw new Error("Remove the existing .stop file before starting a stage."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  const startedAt = new Date().toISOString();
  const epoch = performance.now();
  const stageEnd = epoch + config.duration * 1000;
  const records = [];
  const rollingResults = [];
  let stopReason = null;
  let inFlight = 0;
  let peakInFlight = 0;
  let issued = 0;
  let missedSchedules = 0;
  let peakRssBytes = process.memoryUsage().rss;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const halt = (reason) => {
    if (!stopReason) {
      stopReason = reason;
      console.log(`Stopping: ${reason}; waiting for in-flight requests.`);
    }
  };
  const onSignal = () => halt("operator-signal");
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const watchdog = setInterval(async () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    try { await access(stopFile); halt("operator-stop-file"); }
    catch (error) { if (error.code !== "ENOENT") halt("stop-file-check-failed"); }
  }, 1000);
  const progress = setInterval(() => {
    const failures = records.filter((r) => !r.ok).length;
    console.log(`${Math.round((performance.now() - epoch) / 1000)}s: ${records.length} completed, ${failures} failed, ${inFlight} in flight, p95 ${quantile(records.map((r) => r.durationMs), 0.95) ?? 0} ms`);
  }, 20_000);
  const endpoint = (path) => path.replace(/(\/student\/courses)\/[^/?]+/, "$1/:courseId");

  async function request(student, user, path, scheduledAt, phase) {
    if (stopReason) return;
    if (issued >= config.maxRequests) { halt("request-budget-reached"); return; }
    issued++;
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const begun = performance.now();
    let status = 0;
    let bytes = 0;
    let error = null;
    try {
      const response = await fetch(`${config.target}${path}`, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(config.timeout * 1000),
        headers: { cookie: student.cookie, accept: "application/json", "user-agent": "Slate-Authorized-Load-Test/1.0" },
      });
      status = response.status;
      const content = await response.text();
      bytes = Buffer.byteLength(content);
      if (status < 200 || status >= 300) error = `http-${status}`;
      else if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) error = "non-json-content-type";
      else {
        let body;
        try { body = JSON.parse(content); } catch { error = "invalid-json"; }
        if (!error) {
          if (path.includes("/me?")) {
            if (!body || typeof body !== "object" || Array.isArray(body)) error = "invalid-identity-response";
            else if (body.id !== student.id || body.role !== "student") error = "identity-mismatch";
            else if (body.onboardingStep) error = "student-onboarding-incomplete";
          } else if (path === "/api/v1/student/courses" || path === "/api/v1/student/practice" || path === "/api/v1/student/jobs") {
            if (!Array.isArray(body)) error = "invalid-list-response";
          } else if (!body || typeof body !== "object" || Array.isArray(body)) error = "invalid-detail-response";
        }
      }
    } catch (caught) {
      error = ["TimeoutError", "AbortError"].includes(caught?.name) ? "request-timeout" : "network-error";
    } finally {
      inFlight--;
    }
    const finished = performance.now();
    const record = {
      phase, user: user + 1, path: endpoint(path), status, ok: error === null, error,
      startedMs: Number((begun - epoch).toFixed(2)), durationMs: Number((finished - begun).toFixed(2)),
      scheduledLagMs: Number(Math.max(0, begun - scheduledAt).toFixed(2)), bytes,
    };
    records.push(record);
    rollingResults.push(record.ok);
    if (rollingResults.length > 50) rollingResults.shift();
    if (rollingResults.length === 50 && rollingResults.filter((ok) => !ok).length / 50 > 0.05) halt("rolling-50-error-rate-above-5-percent");
  }

  async function journey(student, user) {
    const rampOffset = config.users > 1 ? (user / (config.users - 1)) * config.ramp * 1000 : 0;
    let identityAt = epoch + rampOffset;
    let actionAt = identityAt;
    let actionIndex = 0;
    const actions = ["/api/v1/student/courses", ...(student.courseId ? [`/api/v1/student/courses/${student.courseId}`] : []), "/api/v1/student/practice", "/api/v1/student/jobs"];
    while (!stopReason && performance.now() < stageEnd) {
      const identity = identityAt <= actionAt;
      const due = identity ? identityAt : actionAt;
      if (due >= stageEnd) break;
      const wait = due - performance.now();
      if (wait > 0) { await sleep(Math.min(wait, 250)); continue; }
      const path = identity ? "/api/v1/me?portal=student&passive=1" : actions[actionIndex++ % actions.length];
      await request(student, user, path, due, "steady");
      const period = (identity ? config.identityInterval : config.think) * 1000;
      let next = due + period;
      // Skip missed ticks instead of generating an artificial catch-up burst.
      if (next < performance.now()) {
        const skipped = Math.floor((performance.now() - next) / period) + 1;
        missedSchedules += skipped;
        next += skipped * period;
      }
      if (identity) identityAt = next; else actionAt = next;
    }
  }

  console.log(`Starting ${config.users} distinct students for ${config.duration}s (${config.ramp}s ramp); read-only requests to ${config.target}.`);
  let steadyEnded;
  let burstStarted;
  try {
    await Promise.all(students.map(journey));
    // Preserve the full observation window even if the last scheduled request
    // ends early, so throughput is not inflated by the remaining think time.
    while (!stopReason && performance.now() < stageEnd) await sleep(Math.min(250, stageEnd - performance.now()));
    steadyEnded = performance.now();
    if (config.burst && !stopReason) {
      burstStarted = performance.now();
      console.log(`Starting separate ${config.users}-request course-list burst.`);
      await Promise.all(students.map((student, user) => request(student, user, "/api/v1/student/courses", burstStarted, "burst")));
    }
  } finally {
    clearInterval(watchdog);
    clearInterval(progress);
    delay.disable();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
  const ended = performance.now();
  const steadySeconds = (steadyEnded - epoch) / 1000;
  const steady = records.filter((r) => r.phase === "steady");
  const burst = records.filter((r) => r.phase === "burst");
  const summary = {
    startedAt, endedAt: new Date().toISOString(), target: config.target, users: config.users,
    configuredDurationSeconds: config.duration, steadyDurationSeconds: Number(steadySeconds.toFixed(3)),
    rampSeconds: config.ramp, actionIntervalSeconds: config.think, identityIntervalSeconds: config.identityInterval,
    timeoutSeconds: config.timeout, maxRequests: config.maxRequests,
    completed: !stopReason, stopReason, peakInFlight, missedSchedules,
    workload: "Read-only courses, assigned course details, practice, jobs, and identity checks; excludes login bursts, writes, email, compiler, video, and browser rendering.",
    overall: aggregate(steady, steadySeconds),
    endpoints: Object.fromEntries([...new Set(steady.map((r) => r.path))].map((path) => [path, aggregate(steady.filter((r) => r.path === path), steadySeconds)])),
    burst: burst.length ? aggregate(burst, (ended - burstStarted) / 1000) : null,
    generator: { nodeVersion: process.version, transport: "Node built-in fetch", peakRssMB: Number((peakRssBytes / 1024 / 1024).toFixed(2)), eventLoopMeanMs: Number.isFinite(delay.mean) ? Number((delay.mean / 1e6).toFixed(3)) : null, eventLoopP95Ms: Number((delay.percentile(95) / 1e6).toFixed(3)), eventLoopMaxMs: Number((delay.max / 1e6).toFixed(3)) },
  };
  const resultPath = join(config.outDir, `stage-${config.users}-${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(resultPath, `${JSON.stringify({ summary, requests: records }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Private result: ${resultPath}`);
  if (stopReason) process.exitCode = 2;
}

try {
  const config = parseArguments(process.argv.slice(2));
  if (config.help) console.log(usage);
  else await run(config);
} catch (error) {
  // Configuration errors must not print file contents, cookies, or response bodies.
  console.error(`Load test failed: ${error instanceof SyntaxError ? "Invalid JSON or URL input." : error.message}`);
  process.exitCode = 1;
}
