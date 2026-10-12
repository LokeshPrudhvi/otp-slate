# Application setup and implementation status

Updated 11 October 2026. The [production architecture](production-architecture.md) specifies the full product; this guide describes what the repository currently runs. The application connects to the supplied Neon PostgreSQL database using self-hosted Better Auth. Managed Neon Auth remains a separate, uncompleted migration. Student self-registration approval and direct admin provisioning with welcome emails are implemented; the selected Resend sender is `OTP Slate <noreply@resumeehub.in>`. Actual inbox delivery remains unverified.

## Verified baseline — 9 October 2026

The confirmed workspace is `/Users/lokeshprudhvi/Documents/LLMS`, linked to [LokeshPrudhvi/otp-slate](https://github.com/LokeshPrudhvi/otp-slate). Local and remote `main` matched commit `5b249e74614fb96b6a4347ac012a53073f2715ca`, with a clean working tree before this documentation update. Use `apps/student`, `apps/platform-admin`, `apps/organization-admin`, `apps/api` and `packages` as the source of current application behavior. The standalone HTML pages remain design references; older verification entries below describe their stated dates.

| Check | Verified result |
| --- | --- |
| Application build | `npm run build:app` passed for the API and all three portals |
| API integration | 19 subtests passed, 20 total TAP tests including their parent; isolated in-memory PostgreSQL |
| Standalone smoke tests | All three suites passed |
| Browser walkthrough | Common-credential sign-in passed independently for all portals; Student dashboard/courses, Platform Admin dashboard/organizations and Organization Admin dashboard/learning opened successfully. Organization session and learning data restored after reload |
| Running database | The API process held `.local/slate` files and its log identified local PostgreSQL. Configuration loads `.env` only; no `.env` was present |
| Linked Neon database | MCP access and a direct read-only PostgreSQL connection using `.env.local` succeeded against `production` branch `br-muddy-dust-b4s35l3m`, PostgreSQL 18.6. Catalog inspection found zero public `slate_*` tables, nine `neon_auth` tables and existing commerce tables such as products/orders; no application rows were read |

These checks confirm the local application and access to the linked cloud database. They do not establish a Neon application deployment, managed-auth cutover or working production execution provider. No cloud migration or seed was run. Do not automatically switch the API to `.env.local`: the linked database already contains a separate schema and needs an isolated migration rehearsal and an explicit cutover plan.

### Supplied LMS environment — later on 9 October 2026

The owner subsequently supplied the actual LMS connection for endpoint `ep-late-fire-b4tiab13`. It is now saved in root `.env`, ignored by Git with file mode `0600`. It contains the pooled runtime connection, direct migration connection, development origins and existing Better Auth configuration. Secrets are intentionally omitted from this document. Read-only checks successfully connected to PostgreSQL 18.6 and found one Platform Admin, one organization viewer and seven students.

The deployed database uses canonical domain names (`organizations`, `members`, `courses`, `course_versions`, `course_enrollments`, `lesson_progress`, `jobs`, `resumes`, `phone_challenges`, `outbox`, `audit_logs`, `messages`, `message_deliveries`, `migrations`). Application schema, raw SQL, migration and production ownership checks now use those same names. A guarded migration renames legacy local tables without losing data and refuses an ambiguous database containing both name sets.

The actual target was verified as project `small-shape-18661054` (`OTP-slate`), production branch `br-spring-silence-b4h3pczr`. Registration changes were rehearsed twice on an isolated expiring branch with actual PostgreSQL, including pending registration, idempotent approval, encrypted welcome mail and a fake transport. The migration was then applied to the supplied database: all 9 accounts, 9 memberships, 3 organizations and 24 enrollments were preserved. No sample accounts or emails were created on production. The four academic columns and empty registration queue were verified.

The `.neon` CLI/MCP context and `.env.local` still refer to the earlier `snowy-brook-88885961` project; use explicit project and branch IDs for infrastructure commands. Do not run a blind `neon deploy` against the old context. The supplied owner login has `BYPASSRLS`; the local development configuration works, but a public production deployment still requires a restricted runtime login, HTTPS portal origins and WhatsApp configuration.

### Student registration and welcome email — 9 October 2026

Students use `/register` to submit student ID, full name, email, phone, existing college/organization, academic branch name/code and optional cohort. They do not choose a password. Platform Admin reviews pending requests at `/registrations`; organization viewers cannot review or provision accounts. Selecting a college does not confer membership or learning access.

Platform Admin can also use **Registrations → Add student**, or **People → select organization → Add student**, to enter one student without a spreadsheet. The form collects the same required fields and derives the college name from the selected active organization. **Create student & send welcome email** creates the student identity immediately and queues the encrypted temporary-password welcome email through Resend; no second approval is required. The form never displays the password. Public self-registration still requires a separate approval. A duplicate account email, including an existing organization viewer, is rejected rather than converted.

Platform Admin can download an Excel template and import `.xlsx` or `.csv` rosters (2,000 rows / 5 MB per file). College name must match the selected organization. All rows are previewed and validated before the explicit **Create accounts & send emails** action. The new direct-provisioning API processes up to 25 rows per request. Duplicate IDs within an organization and duplicate account/request emails are rejected. New admin imports create accounts and welcome jobs immediately; public registration approvals also run in batches of 25. Interrupted creation/approval runs can be retried without duplicating accounts or welcome jobs. The legacy staging API and previously pending imports remain available for review; this change does not approve or send mail for historical requests automatically.

Approval atomically creates the Better Auth identity, student membership, audit event and encrypted welcome-email job. Temporary passwords are never returned to the admin/browser. Students must change the password and complete the existing WhatsApp phone verification; course and tool access follows the organization and academic branch settings, with optional Platform Admin overrides. Direct legacy student provisioning is disabled. Organization-viewer provisioning remains separate.

Resend sends text/HTML welcome messages with organization, student ID, email, temporary password and student login URL, plus existing password-reset messages. Set server-only `RESEND_API_KEY`, verified `EMAIL_FROM`, and `STUDENT_PORTAL_URL` (an exact trusted student origin, mandatory in production). No key belongs in a `VITE_*` variable. The supplied API key was privately saved and verified against the domain-list API; verified domains were `getitfigured.com` and `resumeehub.in`. The user selected `OTP Slate <noreply@resumeehub.in>` as the current `EMAIL_FROM` sender. No real test email was sent, and actual inbox delivery remains unverified.

The actual Resend account quota readback was 100 emails/day and 3,000/month. Daily/monthly quota refusals defer a queued job for 24 hours without consuming its retry allowance. Other failures retry with bounded backoff; the admin can retry failed, unexpired welcome emails. Unsent welcome payloads expire after 7 days (password reset remains available), so large batches need a suitable email plan or approvals paced within quota. Accepted payloads are erased. “Accepted by provider” is not inbox-delivery confirmation; delivery/bounce webhooks are not implemented.

Verification: 49 API tests passed using isolated PostgreSQL memory databases and fake transports, covering existing workflows plus registration authorization, validation, rollback, duplicate handling, forced onboarding, tenant isolation, mail leases/expiry/quota retries and legacy migration preservation. Real Neon rehearsal used a fake mail transport; live SMTP/inbox delivery remains unverified. Browser checks confirmed student registration, its pending queue entry, the Excel template download and a CSV import staged for approval. Full builds passed for all three portals. The dependency audit reported zero vulnerabilities after the ExcelJS UUID dependency was patched.

### Organization, branch and student access — 9 October 2026

Platform Admin manages the student experience at `/access`. Choose an organization, then edit its defaults, an academic branch, or an individual student. Controls cover Courses, Learning toolkit, Compiler, Practice, Live exams, Inbox, Announcements, Self-assessment, Jobs, Resume and Student rankings. Course, practice-module and toolkit-track selectors support multiple selections. Changes remain a draft until **Update access** is clicked; an organization revision prevents a stale browser from overwriting another administrator's update.

Organization settings are the upper limit for every branch and student in that organization. Within that limit, a student's explicit selection overrides the branch selection, which overrides the organization selection. Each category can inherit (`null`) or explicitly select nothing (`[]`); these are different states. Existing organizations retain their current grants and features until configured. Explicit course selections at organization level also limit the courses that branches and students can receive. To give branches different curricula, first allow the combined course catalog for the organization, then select each branch's subset.

For example, turn off Compiler for a medical-coding organization and select its published courses. For an engineering organization, allow its combined course catalog, add an `ME` branch, choose the mechanical courses, and assign students to that branch. New approved students inherit the policy for their academic branch code. An individual exception can add or remove selections within the organization limit. Portal title, toolkit heading and welcome text are also editable per organization; published courses support a General learning track for subjects outside the programming catalog.

Every authenticated student request resolves current access from the database. Disabled capabilities and unassigned content are rejected by API guards, and the student portal filters navigation, dashboard sections, course lists, practice and direct routes. Active student sessions refresh access periodically and on focus; passive access refreshes do not extend the idle timeout. Organization viewers remain analytics-only. Their course coverage includes inherited assignments.

Access changes preserve existing enrollment version pins and lesson progress. Newly selected courses pin a published version when the policy is saved. Publishing another version does not silently change a student's curriculum. Revocation removes current access without deleting historical completion records. All access updates write an audit event. The additive `004-access-policies` migration adds policies and organization revision/display fields without replacing existing accounts, memberships or enrollments.

The available practice selectors currently organize the existing **sample** activities: aptitude, reasoning, typing, interview, web development, full stack projects and DSA/coding questions. Explicit assignment makes those labeled samples available to an organization; this is not a production question-authoring, grading or exam-publishing system. Coding questions also require Compiler. Compiler visibility and actions are checked against server permissions, but the current public OneCompiler/preview code-runner implementation still needs the isolated execution work described below before production grading.

The design follows [OWASP's requirement to validate authorization on every request](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and the group-assignment pattern illustrated by [Moodle cohort enrollment](https://docs.moodle.org/503/en/Cohort_sync). Branches act as academic cohorts; organization ceilings prevent an individual exception from enabling a tool the organization has disabled.

Verification: all **59 API tests** and the API/three-portal production builds passed. Browser checks covered course search/multiple selection, explicit Update, unchanged student access while edits were still a draft, organization limits, branch creation and student reassignment, restricted course/practice lists, independent self-assessment visibility, direct compiler-route denial, and unsaved-draft navigation protection. Screenshots of the isolated demo are saved in `.local/previews/admin-learning-access.png` and `.local/previews/student-customized-access.png`. The local test student's original access was restored afterward.

The full migration was rehearsed on expiring Neon branch `br-frosty-dust-b4p24dxh`, including a second idempotency pass, inheritance/revocation, stale-update rejection and the read-only SQL role. It was then applied to the existing LMS database: all 9 accounts, 9 memberships, 3 organizations, 24 enrollments and 54 completion records were preserved. No real organization policy was changed and no test email was sent. The temporary branch was deleted and normal Neon-backed development servers were restored. These checks do not replace the production deployment prerequisites documented above.

### Login latency — 9 October 2026

The development API runs on the local machine while the supplied Neon database is in AWS `us-east-2` (Ohio). A measured warm database round trip took 226–293 ms. The original login flow validated `/me`, discarded the returned identity, and fetched it again when the protected page mounted; a newly mounted shell could also refetch the immediately stale query.

Successful shared and student logins now cancel/clear prior-account queries and retain the identity just verified by the server. Identity data has a five-second UI freshness window; focus refresh and student twenty-second passive polling remain active. API authorization still validates the live session and current permissions on every request. Recent session timestamps avoid an unnecessary activity-write request while retaining the SQL concurrency condition when an update is due. The platform dashboard obtains four numeric counts in one database query.

One before/after development measurement recorded sign-in plus the required account-check path at approximately 6.4 s before (including the duplicate check) and 4.0 s after. The separately loaded dashboard-summary request changed from 4.4 s to 3.4 s. These are single local-network observations, not a production latency guarantee; dashboard data loads after the authenticated shell opens. Sixty API tests passed, all three portal builds passed, and a real admin browser sign-in succeeded. For deployment, place the API and database in the same region to reduce per-query network latency, as described in [Neon's latency guidance](https://neon.com/faster).


### CRUD latency and connection recovery — 9 October 2026

The screenshot's 5–7 second student requests were reproduced with the local Node API talking to Neon in Ohio. Small JSON responses were waiting for sequential database round trips, rather than browser rendering. Transaction control and tenant initialization repeated across membership, organization, access resolution and the actual resource query. Access updates also opened a second transaction to rebuild their response; some admin mutations waited for unrelated refetches.

Changes keep current session validation, RLS, account/organization checks, access ceilings, audit writes, optimistic revisions and immutable course pins:

- Initialize the transaction-local role and tenant settings in one query. Resolve student membership, organization and effective access in one transaction, reading the organization once and only the student's relevant policies.
- Return access-save responses within the existing transaction, reuse updated organization/policy rows, select only the latest published version per course, index workspace data by student and skip unchanged branch writes.
- Populate admin caches from confirmed create/update/publish responses. Refetch only resources affected by the mutation instead of the entire platform namespace.
- Handle PostgreSQL pool errors without dumping connection objects or terminating the API. An idle socket reset is evicted by pg; the next request acquires a fresh connection. Active failed requests still report an error; writes are not automatically replayed.

A repeat comparison against the same organization on an expiring, isolated clone of the live Neon database recorded:

| Request | Before | After | SQL calls before → after |
| --- | ---: | ---: | ---: |
| Student identity | 5.34 s | 2.73 s | 20 → 11 |
| Student courses | 6.56 s | 3.96 s | 25 → 15 |
| Student course detail | 6.99 s | 4.43 s | 27 → 17 |
| Admin course catalog | 3.35 s | 2.88 s | 13 → 11 |
| Organization access update | 6.90 s | 4.61 s | 26 → 18 |

SQL call counts include transaction control statements. These are development observations, not load-test percentiles or production guarantees. The temporary branch was used for all benchmark writes; no student permissions, courses, or organizations were changed in the live database. Email/phone workers were not started in the benchmark. The read-only lock diagnostic found no blocking locks; historical query diagnostics were unavailable because pg_stat_statements is not installed, and no extension was installed.

All 66 API tests and all three portal builds passed. A real PostgreSQL socket-reset test confirmed the pool survived and the next query used a new connection. Production still needs the API placed close to Neon; the remaining multi-second local measurements reflect the cross-region network cost as well as request work. See [Neon's latency guidance](https://neon.com/faster).


### Second latency pass — 9 October 2026

The remaining multi-second requests triggered a deeper pass. Better Auth now uses supported native Drizzle relations (`advanced.database.joins`) for one fresh session/user query. The JWT plugin no longer generates an unused JWT response header on every identity read; explicit `/api/auth/token` issuance and bearer validation remain enabled. Cookie/session caching stays disabled, so revocation and account changes are checked against the database.

The PostgreSQL pool enables pg 8.23.1 pipelining. The scoped transaction implementation sends BEGIN, bound role/context settings and initial work on the same checked-out client without waiting for separate network acknowledgements. PostgreSQL executes them in order. It drains all work before COMMIT or ROLLBACK, awaits commit before returning a save, rejects a COMMIT response that actually rolled back, and discards the client if rollback fails. PGlite retains its ordinary transaction implementation. Queries that need earlier results still await those results.

Student policies/enrollments now share one query; the access workspace's five independent reads use one statement with scalar JSON aggregates, preventing cartesian row expansion and retaining Drizzle timestamp decoding. Course detail, assigned version and owned completion IDs are fetched together. No authorization cache, database function or schema migration was added.

A fresh isolated Neon branch comparison recorded these local development observations:

| Request | After first pass | After second pass |
| --- | ---: | ---: |
| Admin identity | 1.79 s | 0.78 s |
| Admin course catalog | 2.88 s | 1.33 s |
| Access workspace | 4.02 s | 1.28 s |
| Organization access save | 4.61 s | 2.65 s |
| Student identity | 2.73 s | 1.49 s |
| Student courses | 3.96 s | 2.17 s |
| Student course detail | 4.43 s | 2.05 s |

These runs are not load-test percentiles and network variability remains. All 68 API tests passed, including fresh one-query authentication, JWT issuance, immediate revocation and JSON expiration decoding. Real PostgreSQL checks additionally verified concurrent tenant isolation, reader/mailbox restrictions, nested rollback, failure draining and context cleanup on the pipelined path. All three portals build. Test writes were confined to the temporary branch.

The API still runs on the local computer and queries Ohio. The deployment target remains an always-on API host close to the database, ideally the same region, with HTTPS and the existing production safeguards. No hosting resource was provisioned or production domain configured in this pass; localhost measurements should not be presented as an acceptable production latency target.

### Student request latency — 11 October 2026

Student identity now loads the organization and applicable access policies/grants in one snapshot. The organization context is queued before that read on the same scoped PostgreSQL connection; both operations are drained before commit or rollback. Course-list and course-detail HTTP handlers authenticate, resolve permissions and read content in that same transaction, instead of opening a second scoped transaction. Session revocation, idle/absolute expiry, onboarding, organization status and pinned course versions are still checked on every request. Expired-session deletion happens after releasing the scoped connection.

Better Auth uses its supported `customStorage.consume` interface with an atomic database upsert. Accepted auth requests need one rate-limit SQL statement, preserving the existing sign-in/MFA limits and shared state across API instances. Rejected requests do not extend the inactivity window. Bounded expired-bucket cleanup shares a round trip, locks the consumed bucket first and skips buckets locked by concurrent requests; no migration or extra service is required.

The student route guard owns the single identity-poll timer. Shell course queries run only on course-detail routes, hidden rankings do not fetch, and query cancellation reaches `fetch`. Access-cache keys, focus revalidation and cache stale times are unchanged.

The following are medians of three local-computer-to-Neon samples per code version on an isolated Ohio branch with matching data. They are not production targets or a load test; identity samples still had network/connection outliers. The test branch is disposable and no live course/access records were changed.

| Student request | Before | After |
| --- | ---: | ---: |
| Sign in | 1.64 s | 1.09 s |
| Identity | 1.55 s | 1.33 s |
| Course list | 2.10 s | 1.29 s |
| Course detail | 2.10 s | 1.33 s |
| Sign out | 1.57 s | 1.29 s |

Verification: 85 standard API tests passed. The additional opt-in PostgreSQL concurrency test passed separately against the isolated Neon branch; it holds two opposing bucket locks to verify cleanup cannot deadlock. Real PostgreSQL RLS/rollback checks, all three portal builds and browser course navigation passed. The temporary Neon branch was deleted after testing; the local API and all three portals returned HTTP 200.

Course reads decreased from 12 to 8 SQL statements including transaction setup/commit; identity decreased from 8 to 7. PostgreSQL pipelining means statement count is not identical to network round-trip count. The remaining large deployment improvement is hosting the API in the database's region rather than querying Ohio from a local computer. No hosting changes were made.

### First-request spikes and cancelled development requests — 11 October 2026

React StrictMode replays query subscriptions during development. After forwarding cancellation signals, this appeared in DevTools as one immediately cancelled request followed by the successful identity/course request. The GET transport now yields one microtask and checks cancellation before calling `fetch`. This stops an already-cancelled development probe from opening an HTTP request, while preserving cancellation of a request that is genuinely in flight. A focused test using the installed React/TanStack versions and the actual transport verifies both behaviors; StrictMode remains enabled.

The PostgreSQL pool previously connected lazily, so API readiness could precede the first database handshake. A traced first account check spent 1.48 seconds acquiring a connection, compared with zero measurable checkout time on subsequent calls. The mail worker can also occupy the only warm connection while a spare is evicted after 30 seconds of inactivity.

Startup now opens and verifies two connections concurrently before reporting the API ready, with a 10-second timeout on each one-time probe. The pool retains two healthy idle connections within the existing maximum of eight. Failed initialization drains both attempts, discards failed clients and closes the pool before returning the error. No periodic keepalive, credentials, TLS settings, authentication cache or provider settings were changed. This moves connection initialization into startup; it does not eliminate database query/network latency or guarantee that a future network failure will never require reconnection.

In a controlled local API restart trace, the first account check changed from 2.506 seconds to 0.999 seconds. Startup itself took 1.739 seconds with the new checks. Subsequent checks took 1.042/1.052 seconds, and another after 35 seconds without traffic took 1.004 seconds, all with zero measurable connection-checkout delay. These are individual observations against the existing Neon endpoint, not production guarantees or a suspended-compute benchmark. All 89 standard API tests and three portal builds passed; the database-specific concurrency test from the previous pass remains opt-in. The API and all three running portals returned HTTP 200 after hot reload.

## What is implemented

| Area                   | Current behavior                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three portals          | Independent React/Vite/React Router applications. Organization analytics has its own navigation and bundle, with no management workspace                        |
| Shared design          | Lato, navy, yellow and slate tokens; responsive shell, forms, cards, course accordions, empty states, resume and analytics components                           |
| API                    | Node/NestJS REST endpoints, strict bounded input validation, sanitized errors, origin checks, noncached authenticated responses                                 |
| Database               | Drizzle schema, PostgreSQL constraints, transaction-scoped row security, separate read-only query role and append-only course versions/audit permissions        |
| Authentication         | Better Auth password hashing and database sessions; public signup/admin-auth routes unavailable; sign-in/out, reset, MFA setup, session-bound five-minute JWTs  |
| Account access         | Current role, organization, status and onboarding checked on every protected request. Organization limits, branch inheritance and student overrides govern features, courses and practice |
| Provisioning           | Platform creates individual/bulk students immediately and approves public self-registrations; both queue temporary credentials by email. Viewer accounts remain separate. Suspend/disable revokes sessions |
| Onboarding             | Required temporary-password change; student WhatsApp phone challenge. Verification consumes the challenge and revokes old sessions before fresh sign-in         |
| Course authoring       | Create a draft course, author text lessons and publish immutable versions at any time. Existing assignments retain their version until Platform Admin reassigns |
| Student learning       | Assigned courses and toolkit tracks, course-module accordions, idempotent lesson completion; populated local practice/exam previews and normal empty states     |
| Organization analytics | Fixed organization, actual student counts, assigned-course coverage, completion bars, student search/status filtering/pagination and individual progress        |
| Rankings               | Organization student names on the dashboard. Seeded local organizations show labeled sample rankings; other organizations remain unranked                       |
| Jobs                   | Platform manually publishes dated HTTPS job cards to an organization. Eligible students open the original external application page                             |
| Resume                 | Original form and four single-column templates, immediate preview, automatic PostgreSQL saves and browser Print/Save PDF. Conflicting revisions return 409      |
| Email                  | Encrypted durable welcome/reset-email outbox with leases, retries, quota handling and Resend idempotency. Sender: `OTP Slate <noreply@resumeehub.in>`; inbox delivery unverified |
| Storage                | Server-only R2 presigned-upload adapter. Upload UI, asset verification and authorized video delivery are not implemented yet                                    |

Local analytics measures recorded lesson completion, not skills, exam scores or cheating. Current roster endpoints are bounded to 2,000 records; server pagination must replace that limit before exceeding the initial population. The current SQL file is an initial foundation migration, not a complete future schema migration system.

The student application preserves the original `src/otp-slate.html` design: its navigation rail, dashboard course tiles and rankings panel, placement toolkit, course modules, empty exam screen, resume layout, login screen and SVG artwork. The generated `reference.css` and `reference-art.ts` contain only styles and static artwork; regenerate them with `npm run sync:student-design` when the reference changes. React controls, server authentication, assigned content and database saves remain active. Platform and Organization Admin keep their separate applications.

## Local development

Use Node.js 24 LTS for the deployment target. This initial slice was also checked on the available Node.js 22.21 runtime. Install dependencies from the lockfile:

```sh
npm ci
npm run seed:demo
npm run dev
```

No `.env` is needed to start locally. Optional configuration can be copied from `.env.example`; retain local defaults until connecting real providers. Without a configured secret, development creates a private `.local/auth-secret` file. `.local`, `.env` and build outputs are excluded from version control.

PGlite runs a real embedded PostgreSQL engine and persists data under `.local/slate`. It exercises SQL constraints, transactions and row security without Docker. It is a development tool: use Neon/PostgreSQL for hosted staging and production. Only one process may open the persistent local database at a time; stop `npm run dev` before seeding or bootstrapping against it. Tests use a separate in-memory PostgreSQL instance.

| Portal             | URL                                | Common test login |
| ------------------ | ---------------------------------- | ----------------- |
| Student            | http://student.localhost:5173      | test@gmail.com    |
| Platform Admin     | http://admin.localhost:5174        | test@gmail.com    |
| Organization Admin | http://organization.localhost:5175 | test@gmail.com    |

The common local test password is `1234`. Email matching is case-insensitive, so `test@GMAIL.COM` also works. On sign-in only, the API maps these credentials to `student@slate.test`, `admin@slate.test` or `viewer@slate.test` according to the trusted local portal origin, then runs normal fixture password verification and session creation. The alias requires an actual local PGlite connection, a development configuration and one of the configured local origins. It never creates a Gmail account, sends email, changes roles or changes production password requirements. Hosted PostgreSQL and production deployments do not accept this alias.

The underlying public fixture password remains `Slate-local-only!2026`. Seed creation is restricted to local PGlite development and is idempotent; it never resets an existing account. Fixtures have onboarding completed so the disconnected-provider preview is usable. Real newly provisioned students always pass through the password and phone gates. No emails or WhatsApp messages are sent by seeding.

Use the distinct `.localhost` hosts, rather than signing into different portal roles on one hostname with different ports: cookies are scoped by host, not port. The Vite servers proxy `/api` to the shared API at `127.0.0.1:3000`.

The development servers preserve the requested local portal hostname and correct its port, preserving the path and query. For example, `student.localhost:5175/login` redirects to `student.localhost:5173/login`. API requests are not redirected, and origin checks remain active. Exact common fixture credentials have a bounded allowance of 30 sign-ins per ten-second shared local IP/path window; ordinary credentials, wrong passwords, hosted databases and production retain the default three-attempt limit.

Suggested walkthrough:

1. Sign into Platform Admin and create an organization and viewer accounts. Students can self-register for approval, or Platform Admin can directly create individual accounts or import a reviewed roster. Direct creation and self-registration approval queue welcome credentials by email.
2. Create a course, add text lessons and publish. In Access, choose the organization, allow its course catalog and tools, and click Update access. Optionally create branch selections or individual overrides.
3. In the seeded student portal, open the assigned Python course and mark a lesson complete. Confirm that Organization Admin shows the completion.
4. Publish a revised version of that course. Existing student content stays pinned until explicitly reassigned.
5. Publish a job for the fixture organization, then open it from the student portal. Edit/save a resume and switch templates.
6. Sign out; protected routes require sign-in again.

New student onboarding stops with a clear service-unavailable message until the official WhatsApp sender is configured. It never accepts a demo OTP in the normal API.

## Populated local demo

`npm run seed:demo` first ensures the baseline accounts, then creates the following fixtures. Stop `npm run dev` before running it, because only one process can open persistent PGlite. It is restricted to local, nonproduction PGlite and never sends email or WhatsApp messages. `npm run seed:dev` still creates the smaller baseline.

| Data          | Sample experience                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizations | Northstar Institute of Technology · Demo, Vertex Engineering College · Demo, Horizon Skills Academy · Demo                                                                 |
| People        | 62 fictional students (32/18/12), six organization viewers and one platform account; varied account/onboarding/access states                                               |
| Learning      | 19 published paths covering foundations, hiring assessments, CRT, DSA, full stack and competitive coding; authored text lessons, varied assignments and completion records |
| Practice      | 12 aptitude/reasoning, typing, project and interview activities; 200 coding questions across 20 topics, with 16 language choices                                           |
| Live exams    | One live placement sample, one upcoming coding sample and one completed aptitude sample; filters, instructions, timer and local answer review                              |
| Career        | 18 fictional job cards, a filled resume with editable content and four existing printable templates                                                                        |
| Analytics     | Populated course-completion graphs and roster; separately labeled sample aptitude/coding/interview scores, trend graphs and rankings                                       |
| Announcements | Four sample placement, course, class and resume notices                                                                                                                    |

The shared login is `test@gmail.com` / `1234`. Student opens all 19 assigned paths; Platform Admin sees three populated organizations and a sample-only **Assessments & exams** page; Organization Admin stays scoped to Northstar and read-only. Company-style practice cards are explicitly illustrative rather than actual company previous-year papers.

Re-running the seed does not duplicate records, reset passwords, overwrite edited course versions, change pinned assignments, erase lesson completions or overwrite an edited resume. It does refresh the named fixture accounts' display names and the primary sample organization's name. Existing custom organizations and students are retained.

The coding library includes 60 Easy, 100 Medium and 40 Hard original sample prompts, each with a statement, JSON example, constraints and hints. Its filters combine difficulty, topic, status, title/number search, saved lists and study plans; sorting and pagination work together. Problems open directly in a split workspace with description, solution guidance, submission history, notes and a local discussion preview. Editor settings, code reset/restore, custom JSON validation, saved drafts, submission history and manually or automatically marked practice status are browser-local and scoped to the signed-in fixture member.

Quizzes and typing compute a result in the browser. A completed practice quiz is saved in the student's browser history (up to 30 recent attempts) and appears in the dashboard self-assessment graph above Student rankings. Demo accounts see labeled sample history until their first completed quiz; other accounts have an empty graph. Live exams, typing accuracy and manually marked coding statuses do not enter this quiz-score history. Storage is scoped to the signed-in student, with no official-grade write or organization synchronization.

Organization Admin has a dedicated analytics workspace with Overview, Student insights, Learning analytics and Student rankings. The overview includes assessment score trends, a lesson-completion donut, skill averages, weekly engagement, leading students and links to students needing course access or just getting started. Learning analytics retains the self-assessment graph above rankings and adds course-completion distribution and assignment coverage. Trend periods switch between three and six weeks; rankings support skill sorting, search and ten-row pagination. Student profiles compare individual skills with organization averages. The directory keeps search, account status, sort, focus and page in its URL. A CSV report includes the current organization's roster and clearly identifies sample assessment data. Mobile navigation supports keyboard dismissal and focus containment; tables scroll within their panels.

Organization trends, engagement and assessment rankings remain synthetic sample data, independent of student browser attempts. Lesson completion and account information come from the existing organization-scoped API. No new learner-management permissions are added. Empty organizations show empty performance panels, even when a demo payload contains placeholder trends.

The redesigned organization portal passed its production build and TypeScript checks. Browser verification covered login, chart period changes, student search/profile navigation, ranking sort/pagination and the 390px mobile layout, including navigation dismissal and containment of table scrolling. The CSV export control was exercised, but the browser automation did not confirm the downloaded file.

Current coding **Run** and **Submit** call `apps/student/src/code-runner.ts`. JavaScript and TypeScript selections execute through `new Function` in the portal page, without isolation, a time limit or TypeScript transpilation. Other languages call the public Judge0 CE endpoint directly from the browser; only Python and Java receive generated multi-case harnesses. A remote failure falls back to JavaScript evaluation regardless of the selected language. The separate `/compiler` page embeds OneCompiler; the coding workspace's OneCompiler label does not identify its actual execution endpoint.

These are preview execution paths, not production grading. Generic generated cases can retain an original expected answer after changing its input, repeated examples pad the suite, and local memory figures are synthetic. A passing submission marks browser-local status as Solved but creates no server submission or official result. The API's `POST student/submissions` still returns service-unavailable. The 9 October checks did not validate compiler execution or provider availability; this path needs isolated execution, verified problem drivers/cases, resource limits and durable server-side results before production use.

Project/checklist previews remain in the current page session. Live sample timers and focus-change counts are illustrative, without an official result or a misconduct decision. Job links point to `example.com`, and class notices do not contain a real meeting link. Unassigned sample practice, exams and announcements are disabled for production and ordinary organizations; Platform Admin can explicitly assign the labeled sample practice modules through Access. Real exam admission, durable attempts, browser-event ingestion, grading and publishing still require the phases below.

## Verification commands

```sh
npm run build:app
npm run test:app
npm test
```

The application build typechecks and bundles all three portals and compiles the API. Integration tests use actual PostgreSQL and HTTP requests for provisioning, tenant/role isolation, read-only SQL permissions, onboarding bypass denial, OTP delivery failure/reuse, course-version pinning, cross-organization foreign keys, feature grants, dangerous job links, resume conflicts, logout/JWT revocation, encrypted reset email, reset links, suspension, authentication rate limits, required admin MFA and idle/absolute expiry. The original standalone smoke suites remain separate.

Verified locally on 6 October 2026: all three portal builds and the API compile passed; all 14 application workflow checks passed; the three standalone smoke suites passed. Browser checks confirmed independent portal sessions, assigned course navigation, recorded completion reaching organization analytics, resume preview/template persistence after reload, and student logout/sign-in. Real provider delivery, hosted Neon permissions, load capacity and the GitHub CI run remain unverified.

After restoring the student design, builds and all 14 application workflows passed again. Browser checks confirmed the original dashboard, course modules and live-exam empty state, saved Editorial resume details after navigation and reload, practice filters, navigation collapse, and real logout/sign-in. The original styles and SVG artwork are copied directly from the HTML reference; this is not a pixel-diff certification.

Verified on 7 October 2026: all 17 application workflows passed after adding the common local login. The additional checks cover distinct portal roles and sessions, cross-role denial, independent logout, incorrect credentials, unrecognized origins, and rejection in production/nonlocal configurations. HTTP checks against each running portal also confirmed `test@GMAIL.COM` / `1234` reaches the correct student, platform and organization role.

The populated demo adds an eighteenth application workflow, passing against in-memory PostgreSQL and HTTP. It verifies fixture counts, every learning track, all practice kinds and exam states, 200 unique coding prompts with 20 topics and parseable JSON examples, sorted rankings, organization-scoped analytics, filled career content, repeatable seeding after a course edit, pinned assignments and exclusion of sample assessments from ordinary organizations and production.

All three portal builds and the API compile passed with the populated demo. Browser checks confirmed the roster and sample graphs, every exam state, six student job cards, the filled resume, local quiz scoring, combined coding filters and sorting, pagination, bookmarks and custom lists, saved code/notes after reload, language switching, editor theme/expanded layout, custom JSON validation and local draft submission history. Code execution and official assessment results remain unverified because those services are not connected.

After the local login fix on 7 October, all three portal builds, API compilation and 19 application workflows passed. New HTTP checks cover repeated common-credential sign-ins across all three portals, exhaustion of the bounded fixture allowance and unchanged strict limits for wrong passwords, production and hosted configurations. Running-server checks confirmed each local hostname correction, login page and API health; the Platform Admin common login also succeeded in the browser.

## Neon and deployment configuration

### Cloud setup completed on 7 October 2026

| Item | Verified state |
| --- | --- |
| Tooling | Neon CLI 8.0.11 installed and authenticated; Neon skills installed locally; MCP configured for project `snowy-brook-88885961` |
| Linked target | `production` branch `br-muddy-dust-b4s35l3m`, region `aws-us-east-2`, PostgreSQL 18 |
| Configuration | Root `neon.ts` declares `auth: true` and `preview.buckets.uploads.access: "private"` |
| Dependencies | `@neon/config` 1.8.4 and `@neon/env` 1.5.1 installed |
| Reconciliation | `neon config plan` and `neon deploy` succeeded with no changes: Auth and the private uploads bucket already matched the declaration |
| Signup | Email/password configuration readback confirms `disableSignUp: true`. No signup request was sent; application provisioning still needs integration |
| Environment | All nine required Neon environment variables are present in ignored `.env.local`, with file permissions `0600`; credentials are not reproduced here |
| Validation | Full application build and standalone `neon.ts` typecheck passed. Remote `GET /get-session` returned HTTP 200 with `null`; JWKS returned HTTP 200 with a valid keys array |

The API currently loads `.env`, not `.env.local`, and remains on the existing PGlite/Better Auth setup. No production database migration or demo seed was run. No Neon trusted domains have been configured, and managed sign-in, session restoration, logout and protected portal access have not been verified. The private Neon bucket is configured but is not connected to the application's upload flow.

### Managed Neon Auth migration checklist

1. **Identity and data boundary:** Rehearse on an isolated branch. Add a provider boundary while keeping the local demo path explicit. Map provisioned Neon identities to application-owned profiles and `slate_members`; preserve organization, role, status, onboarding and grant checks. Do not write to Neon-managed auth tables or auto-enroll successful sign-ins.
2. **Portal integration:** Use the supported Neon SDK and a verified same-origin server bridge for the three portals. Preserve the auth-route allowlist and exact origin checks, configure the correct trusted domains, and use live provider session validation for protected requests. A valid JWT alone must not bypass current membership or session restrictions.
3. **Session policy:** Maintain app-owned session state bound to the provider session and user, including idle/absolute expiry, revocation and second-factor completion. Preserve revocation records so an upstream cookie cannot recreate a revoked application session. Verify logout, password-reset and suspension behavior; do not assume an issued Neon JWT is immediately revoked by logout.
4. **Platform Admin MFA:** Native MFA remains on the [Neon Auth roadmap](https://neon.com/docs/auth/roadmap), checked 7 October 2026. Managed cutover requires a separately enforced application factor with encrypted secrets, atomic recovery-code consumption, replay/rate controls and verification for every new admin session. The existing Better Auth plugin depends on local sessions and passwords and cannot simply be attached to a Neon user. Preserve the current required factor until its replacement is verified.
5. **Admin-only provisioning:** Verify public signup rejection and keep other enrollment paths disabled. Provision users through an authenticated, application-authorized Platform Admin; retain temporary-password onboarding, audit records and retry/compensation for a remote identity created before membership storage fails. Organization viewers must not receive provider-admin privileges. Bootstrap must explicitly link a verified upstream identity to the platform role.
6. **Recovery and delivery:** Connect managed password reset and verify production email delivery, password changes and session invalidation. Keep mandatory WhatsApp verification in the application. Retain an application secret for OTP hashing, encrypted payloads and any app-owned MFA state even when the auth provider changes.
7. **Cutover verification:** Test sign-in, reload/session restoration, sign-out, reset, MFA enrollment/challenge, onboarding, role/organization isolation and provider outages in all portals. Only switch the application environment after these pass; cloud configuration and a successful build do not establish working managed login.

### Current self-hosted deployment procedure

The following commands and auth-table grants apply to the current self-hosted Better Auth implementation. They are not a managed Neon Auth migration and have not been applied to the linked production branch.

Create an owner connection for migrations and a separate login role for the application. Keep owner credentials out of the API deployment. Set `MIGRATION_DATABASE_URL` only for the CLI environment, then apply the initial migration:

```sh
npm run db:migrate
```

The migration creates `slate_runtime`, `slate_reader`, `slate_mailbox` and `slate_registration` as nonlogin roles. An owner must grant them to the restricted application login, with no table ownership, superuser or row-security bypass. For example, after creating the login privately through the database console:

```sql
ALTER ROLE slate_api NOINHERIT;
GRANT slate_runtime, slate_reader, slate_mailbox, slate_registration TO slate_api;
GRANT USAGE ON SCHEMA public TO slate_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  auth_user, auth_session, auth_account, auth_verification,
  auth_jwks, auth_two_factor, auth_rate_limit, outbox
TO slate_api;
```

`NOINHERIT` prevents global domain access outside the explicit transaction role. Auth tables/outbox are accessed by trusted authentication/mail code; organization data uses `SET LOCAL ROLE` and transaction-local server-derived context. Organization analytics uses `slate_reader`, which has no write grants and can read only approved identity columns. Row security is organization-level defense in depth; server guards still enforce each student's own resources. Confirm these permissions with Neon before production, not only in the embedded development engine.

Use the pooled Neon endpoint with required TLS for `DATABASE_URL`; the API pool is bounded to eight connections per process. The production startup rejects a superuser, bypass-RLS role or domain table owner. Set `NODE_ENV=production`, a random secret, an HTTPS `BETTER_AUTH_URL` and exact HTTPS `TRUSTED_ORIGINS`. Runtime does not apply migrations automatically against hosted PostgreSQL.

Bootstrap the first platform account through the protected CLI:

```sh
npm run db:bootstrap -- --email owner@your-domain.example --name "Platform Admin"
```

The generated temporary password is written to a private mode-0600 file under `.local`; it is not printed. Distribute it securely and remove the file afterwards. The production platform account must change its password and verify authenticator setup before management access. Deployment must not run the development seed.

Build and run the API with:

```sh
npm run build:app
npm run start -w @slate/api
```

Deploy each frontend's `dist` independently, with SPA fallback to `index.html` and same-host `/api/*` forwarding. Disable CDN caching for authentication/API responses. Lock the API origin to the trusted ingress, strip client-supplied forwarded headers and supply a validated single client IP for Better Auth rate limits. Its default login protection uses three attempts per ten-second IP/path window; test real college NAT login bursts before launch and add suitable per-account/edge controls before changing limits. A publicly reachable origin accepting arbitrary forwarded headers is not ready for release.

The CI workflow is configured to run builds, legacy tests and application integration tests on Node.js 24, using the official [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) actions. It has not been executed on GitHub. Infrastructure deployment, containers, backup schedules and staging URLs still need implementation under the production release gates.

## Provider setup

| Provider      | Server configuration                                                                                          | Further work                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Resend        | `RESEND_API_KEY`, verified `EMAIL_FROM`                                                                       | Test reset delivery and bounce/error behavior. Reserve daily quota for resets; no blanket onboarding email burst         |
| Meta WhatsApp | Access token, phone-number ID, authentication template name/language and a supported `WHATSAPP_GRAPH_VERSION` | Approve the sender/template and test actual OTP delivery. Add delivery webhooks and phone/IP abuse budgets before launch |
| R2            | Account ID, scoped access-key pair and private bucket                                                         | Configure upload CORS, asset validation, encoding/renditions, playback authorization and media delivery Worker           |
| Execution     | `EXECUTION_PROVIDER=unconfigured` until the benchmark                                                         | No compiler runs in the API. Submissions currently fail explicitly; choose and implement a provider only after the trial |

Do not put provider keys in frontend `VITE_*` variables. The Services page reports configuration presence, not a successful connection or verified production readiness. Local tests replace only message transport; they still test the real OTP state transitions.

## Next implementation phases

1. **Production foundation:** Neon role/migration rehearsal, ingress/IP validation, deployment/secret management, persistent logs, backups and staging browser tests.
2. **Provisioning at scale:** Registration/import/approval, organization/branch/student access policies, course/practice/toolkit selection, compiler controls, branch assignment and account suspension now work. Next add enrollment expiry controls, explicit course-version upgrades, student-ID/cohort corrections and server pagination beyond the initial 2,000-student roster.
3. **Learning media:** Course/module CMS beyond text lessons, R2 asset processing and protected video playback, authorized Zoom/Meet class links, project/repository submissions.
4. **Practice:** Connect the existing practice and coding UI to versioned question/problem banks, durable attempts, a runtime registry, managed external execution, quotas and authoritative grading.
5. **Live exams:** Admin release/audiences, admission, server deadlines, autosave/reconnect, browser-event monitoring, review and result-release policy.
6. **Analytics and career completion:** Durable learning events, assessment/skill/ranking definitions, aggregate graphs/exports, job editing/archiving, validated resume PDF generation.
7. **Pilot:** Measured 200-learner/300-exam cohort tests, provider cost trial, restore/rollback drills and actual ₹20,000 budget validation.

The initial conversion does not transplant browser-stored passwords or treat browser-local compiler verdicts as official grades. Local demo rosters and learning records are seeded through the database; synthetic assessment data is separately labeled and gated. Production live exams and code execution remain gated on these phases.

## Capability audit — 11 October 2026

This audit covers the current React portals and API, not the older standalone HTML prototypes. A database column or installed authentication plugin does not by itself establish a working product feature.

**Completed in this update:** Platform Admin → **Organizations** → **Archive** or **Restore** on an organization card → confirm the action. Active/Archived filters make either state available. Archiving preserves records and learning progress, revokes organization-member sessions and blocks organization access; restoring permits eligible members to sign in again without overriding individual account restrictions. Permanent deletion is not implemented. See [organization actions](../apps/platform-admin/src/routes.tsx) and [status service](../apps/api/src/service.ts).

**Student-first People page:** Select an organization in **People**, then use the default **Students** section to enter one student's name, student ID, email, phone, branch name/code and optional cohort. The college name comes from the selected organization. **Create student & send welcome email** creates the account and queues its temporary-password email immediately. Public self-registrations require approval in **Registrations**. **Organization viewers** is a separate secondary section with its own creation form and account list. Archived organizations retain their records but cannot receive new accounts. **Student accounts → Edit details** updates name, login email, phone and academic branch name/code. The student ID, memberships, learning records and explicit access selections are preserved; a branch change takes effect through existing inherited access rules. Email changes sign the student out and revoke old reset links. If password setup is incomplete, correcting the email queues a fresh welcome password and invalidates the previous temporary password; a welcome email currently being sent must finish before the address can change. Phone changes sign the student out, clear old OTP challenges and require verification of the new number.

**Course lifecycle:** In **Courses**, unused drafts offer **Delete draft**, published courses offer **Archive**, and archived courses offer **Restore**. Each action requires an explicit confirmation in the UI. Draft deletion is rejected if a version, enrollment, access-policy selection or historical version pin references it. Archiving preserves all versions, assignments and progress; existing students can continue learning and completing lessons. It blocks new explicit course selections and publishing until restored. Existing organization/branch inheritance continues, including students who later join an already assigned audience. Removing an archived selection and saving it does not permit re-adding it until restoration. Archived editors are view-only, and status filters include all three states. Migration `005-course-lifecycle` adds the archived state without rewriting learning records; it was rehearsed against an isolated Neon branch before application to the connected database.

| Priority | Capability | Current support and remaining work |
| --- | --- | --- |
| High · UI gap | MFA recovery-code sign-in | The `/api/auth/two-factor/verify-backup-code` endpoint is exposed through the enabled plugin, and onboarding provides recovery codes. Login exposes only authenticator codes. Add recovery-code input using the existing endpoint; see [auth allowlist](../apps/api/src/app.ts) and [login/onboarding](../packages/ui/src/kit.tsx). |
| High · partial backend | Upgrade an existing course assignment | Published versions and enrollment pins work. Access deliberately preserves prior pins, including after deselection/reselection; the legacy assignment endpoint rejects policy-managed organizations. Add an explicit audited upgrade operation and version selection/history. Rechecking a course does **not** upgrade it. See [access updates](../apps/api/src/access.ts). |
| Medium · stored data only | Audit history viewer | Management actions already create audit records. No read API, pagination/filtering or admin history page exists; see [audit schema](../apps/api/src/schema.ts) and [event writes](../apps/api/src/service.ts). |
| Medium · API without full workflow | Course media uploads | Private R2 upload signing exists when configured. No upload UI, lesson-asset association or authorized playback/download flow exists. Adding a file input alone would not complete media support; see [upload endpoint](../apps/api/src/controller.ts) and [R2 provider](../apps/api/src/providers.ts). |
| Medium · model/read support | Enrollment expiry | Enrollment expiry is stored and enforced on reads. No admin API/UI sets it. Add expiry management that respects access-policy inheritance; see [grant resolution](../apps/api/src/access.ts). |
| Medium · missing management workflows | Student-profile corrections and job maintenance | People supports account status and editing student names, login emails, phone numbers and branches. Student-ID/cohort corrections still need a management workflow. Academic branch assignment is also available in **Access → student → Academic branch**. Jobs supports creation/listing, but editing and closing/archiving postings need backend and UI work; see [controllers](../apps/api/src/controller.ts). |
| High · preview only | Official exams and announcements | Current admin assessment screens show sample data. Exam creation/release/audiences, server deadlines, persistent monitoring, grading and result release remain unimplemented; announcements are also fixtures. See [assessment preview](../apps/platform-admin/src/assessments.tsx) and [student feeds](../apps/api/src/service.ts). |
| High · preview only | Durable practice, projects and coding results | Quiz/coding history is browser-local; project submissions remain in-page previews. Browser execution and the compiler embed do not create authoritative server submissions. The submissions API remains unavailable. Add durable attempts, server-owned judging and reviewed project submissions before using these results in organization analytics; see [practice](../apps/student/src/assessments.tsx), [coding](../apps/student/src/coding.tsx) and [submission endpoint](../apps/api/src/controller.ts). |

Already available: direct individual/bulk student creation, student-profile editing, self-registration approval and welcome-email retry/status; organization-viewer creation; member suspend/disable/reactivate; organization/branch/student access controls; branch management; course creation/publication; job creation; password reset; MFA enrollment; WhatsApp onboarding; and provider-configuration status. Provider configuration indicators do not verify external delivery. Better Auth session-management/admin endpoints outside the application allowlist are not exposed product features.
