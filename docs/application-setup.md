# Application setup and implementation status

Updated 7 October 2026. This is the first working application slice following approval of the recommended stack. The [production architecture](production-architecture.md) specifies the full product; this guide describes what the repository currently runs. Neon tooling and the requested cloud configuration are now set up. The running application still uses local PGlite and self-hosted Better Auth; managed Neon Auth has not been connected to the portals.

## What is implemented

| Area                   | Current behavior                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three portals          | Independent React/Vite/React Router applications. Organization analytics has its own navigation and bundle, with no management workspace                        |
| Shared design          | Lato, navy, yellow and slate tokens; responsive shell, forms, cards, course accordions, empty states, resume and analytics components                           |
| API                    | Node/NestJS REST endpoints, strict bounded input validation, sanitized errors, origin checks, noncached authenticated responses                                 |
| Database               | Drizzle schema, PostgreSQL constraints, transaction-scoped row security, separate read-only query role and append-only course versions/audit permissions        |
| Authentication         | Better Auth password hashing and database sessions; public signup/admin-auth routes unavailable; sign-in/out, reset, MFA setup, session-bound five-minute JWTs  |
| Account access         | Current role, organization, status and onboarding checked on every protected request. Server-owned feature grants for jobs, resume and rankings                 |
| Provisioning           | Platform creates organizations and individual student/viewer accounts; generated temporary credentials displayed once. Suspend/disable revokes sessions         |
| Onboarding             | Required temporary-password change; student WhatsApp phone challenge. Verification consumes the challenge and revokes old sessions before fresh sign-in         |
| Course authoring       | Create a draft course, author text lessons and publish immutable versions at any time. Existing assignments retain their version until Platform Admin reassigns |
| Student learning       | Assigned courses and toolkit tracks, course-module accordions, idempotent lesson completion; populated local practice/exam previews and normal empty states     |
| Organization analytics | Fixed organization, actual student counts, assigned-course coverage, completion bars, student search/status filtering/pagination and individual progress        |
| Rankings               | Organization student names on the dashboard. Seeded local organizations show labeled sample rankings; other organizations remain unranked                       |
| Jobs                   | Platform manually publishes dated HTTPS job cards to an organization. Eligible students open the original external application page                             |
| Resume                 | Original form and four single-column templates, immediate preview, automatic PostgreSQL saves and browser Print/Save PDF. Conflicting revisions return 409      |
| Email                  | Encrypted durable reset-email outbox with leases, retries and Resend idempotency. Actual delivery requires a configured verified sender                         |
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

1. Sign into Platform Admin and create an organization and viewer/student accounts. Their temporary credentials appear once for secure distribution.
2. Create a course, add text lessons and publish. In People, select the organization/student and assign the course. Assign career features explicitly.
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

The coding library includes 60 Easy, 100 Medium and 40 Hard original sample prompts, each with a statement, JSON example, constraints and hints. Its filters combine difficulty, topic, status, title/number search, saved lists and study plans; sorting and pagination work together. Problems open directly in a split workspace with description, solution guidance, submission history, notes and a local discussion preview. Editor language/theme/font/tab-size settings, code reset/restore, custom JSON validation, saved drafts and self-assessed status are browser-local and scoped to the signed-in fixture member.

Quizzes and typing compute a result in the browser. A completed practice quiz is saved in the student's browser history (up to 30 recent attempts) and appears in the dashboard self-assessment graph above Student rankings. Demo accounts see labeled sample history until their first completed quiz; other accounts have an empty graph. Live exams, typing accuracy and manually marked coding statuses do not enter this quiz-score history. Storage is scoped to the signed-in student, with no official-grade write or organization synchronization.

Organization Admin has a dedicated analytics workspace with Overview, Student insights, Learning analytics and Student rankings. The overview includes assessment score trends, a lesson-completion donut, skill averages, weekly engagement, leading students and links to students needing course access or just getting started. Learning analytics retains the self-assessment graph above rankings and adds course-completion distribution and assignment coverage. Trend periods switch between three and six weeks; rankings support skill sorting, search and ten-row pagination. Student profiles compare individual skills with organization averages. The directory keeps search, account status, sort, focus and page in its URL. A CSV report includes the current organization's roster and clearly identifies sample assessment data. Mobile navigation supports keyboard dismissal and focus containment; tables scroll within their panels.

Organization trends, engagement and assessment rankings remain synthetic sample data, independent of student browser attempts. Lesson completion and account information come from the existing organization-scoped API. No new learner-management permissions are added. Empty organizations show empty performance panels, even when a demo payload contains placeholder trends.

The redesigned organization portal passed its production build and TypeScript checks. Browser verification covered login, chart period changes, student search/profile navigation, ranking sort/pagination and the 390px mobile layout, including navigation dismissal and containment of table scrolling. The CSV export control was exercised, but the browser automation did not confirm the downloaded file.

Coding **Run sample** shows reference expected outputs and explicitly states that entered code was not executed. Project/checklist previews remain in the current page session. Live sample timers and focus-change counts are illustrative, without an official result or a misconduct decision. Job links point to `example.com`, and class notices do not contain a real meeting link. These previews are disabled for production and ordinary organizations; real exam admission, durable attempts, browser-event ingestion, grading, publishing and code execution still require the phases below.

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

The migration creates `slate_runtime` and `slate_reader` as nonlogin roles. An owner must grant them to the restricted application login, with no table ownership, superuser or row-security bypass. For example, after creating the login privately through the database console:

```sql
ALTER ROLE slate_api NOINHERIT;
GRANT slate_runtime, slate_reader TO slate_api;
GRANT USAGE ON SCHEMA public TO slate_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  auth_user, auth_session, auth_account, auth_verification,
  auth_jwks, auth_two_factor, auth_rate_limit, slate_outbox
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
2. **Provisioning at scale:** Validated `.xlsx` upload/preview/confirmation, idempotent durable provisioning, cohort/access profiles, module/practice grants, expiry/revocation UI and server pagination.
3. **Learning media:** Course/module CMS beyond text lessons, R2 asset processing and protected video playback, authorized Zoom/Meet class links, project/repository submissions.
4. **Practice:** Versioned question/problem banks, typing/aptitude assessments, LeetCode-style editor/results UI, runtime registry, external execution, quotas and real grading.
5. **Live exams:** Admin release/audiences, admission, server deadlines, autosave/reconnect, browser-event monitoring, review and result-release policy.
6. **Analytics and career completion:** Durable learning events, assessment/skill/ranking definitions, aggregate graphs/exports, job editing/archiving, validated resume PDF generation.
7. **Pilot:** Measured 200-learner/300-exam cohort tests, provider cost trial, restore/rollback drills and actual ₹20,000 budget validation.

The initial conversion does not transplant browser-stored passwords or trust mock compiler verdicts. Local demo rosters and learning records are seeded through the database; synthetic assessment data is separately labeled and gated. Real live exams and code execution remain gated on these phases.
