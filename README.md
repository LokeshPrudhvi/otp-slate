# OTP Slate

Application conversion is underway: three separate React/TypeScript portals share a Node/NestJS API, Drizzle PostgreSQL persistence and Better Auth. The existing standalone HTML previews remain design references.

## Run the application

```sh
npm ci
npm run seed:demo
npm run dev
```

Run the seed command before starting the API. Local development uses persistent PGlite PostgreSQL in `.local/slate`; production requires a restricted Neon/PostgreSQL connection.

`seed:demo` fills the local database with three sample organizations, 62 students, six organization viewers, 19 published learning paths, varied assignments and lesson progress, 18 fictional job cards and a complete student resume. It also enables 12 noncoding practice activities, a 200-problem coding library, live/upcoming/completed exam previews, four announcements, sample rankings and assessment graphs. The test student has every learning path. Stop the dev servers before seeding again; repeated runs preserve edited content and existing progress. `seed:dev` remains available for the smaller baseline fixture set.

Open **Practice → DSA / Coding Questions** for the LeetCode-style library: 200 original sample prompts across 20 topics (60 Easy, 100 Medium, 40 Hard), combined filters, search/sorting, pagination, study plans, a daily pick, bookmarks and personal lists. Each problem opens directly in a split description/code workspace with 16 language options, hints, solution guidance, notes, local discussion drafts, custom JSON test-case validation, editor settings, code restore and draft submission history. Drafts and self-assessed statuses persist in the browser per fixture account; there is no execution verdict or official accepted status.

Both the student dashboard and Organization Admin's **Learning progress** page show a self-assessment graph above **Student rankings**. The student graph starts with labeled sample history for demo accounts; completing a practice quiz replaces it with browser-local scores for that student (up to 30 recent attempts). Live exams, typing accuracy and manually marked coding statuses do not enter this quiz-score graph. Organization Admin shows illustrative weekly cohort trends and skill averages, with searchable rankings, score-based sorting and pagination; course completion remains available in an expandable section. Student browser history does not feed the organization sample analytics or official grades.

| Portal             | Local URL                          | Test login     |
| ------------------ | ---------------------------------- | -------------- |
| Student            | http://student.localhost:5173      | test@gmail.com |
| Platform Admin     | http://admin.localhost:5174        | test@gmail.com |
| Organization Admin | http://organization.localhost:5175 | test@gmail.com |

Use password `1234` for all three local test portals. This local alias signs into the existing fixture account for the portal you opened; the student, platform and read-only organization roles stay separate. The alias is unavailable in production or with a hosted database. Distinct hostnames keep the portals' cookies separate. The underlying fixture accounts still use `Slate-local-only!2026` and must not be provisioned in a hosted environment.

The initial application supports organization and account provisioning, first-login password/phone gates, assigned versioned text lessons, completion analytics, manual jobs and a live resume preview with four printable templates. The React student UI uses the original HTML's design, rail, cards, course modules and artwork. Local sample quizzes and typing activities calculate a browser-only result; coding previews show reference outputs without executing code, and project forms preview submitted links. Sample assessment results and rankings are labeled and do not write official grades. Production grading, server-enforced timed exams, spreadsheet imports and private video playback remain subsequent implementation work. Provider credentials are not configured.

See [application setup and implementation status](docs/application-setup.md) for provider configuration, database roles, verification and the remaining milestones.

```sh
npm run build:app
npm run test:app
```

## Standalone UI reference

Three standalone pages share the same LMS design family:

- `otp-slate.html`: student portal.
- `otp-slate-platform-admin.html`: organization setup, student management, learning access, imports, exams, jobs and organization-member provisioning.
- `otp-slate-organization-admin.html`: a separate read-only analytics portal. The signed-in member's account determines the organization; there is no organization setup, management navigation or organization switcher.

`otp-slate-admin.html` remains an alias for Platform Admin so existing links still work. It no longer offers role switching.

## Preview

Enter Platform Admin's local preview and select an organization. Open **Members** to create any number of individual email/password accounts, reset a password, or disable a member. Open Organization Admin to sign in using that assigned account.

Sample Organization Admin logins:

| Organization | Email                    | Preview password |
| ------------ | ------------------------ | ---------------- |
| Northstar    | meera@northstar.example  | SlateDemo2026!   |
| Northstar    | ananya@northstar.example | SlateDemo2026!   |
| Vertex       | priya@vertex.example     | SlateDemo2026!   |

Existing custom staff entries migrate to disabled viewer accounts; assign a password and activate them in Platform Admin. Student rosters and learning assignments are preserved.

The organization portal includes activity and score trends, participation and skill graphs, course progress, student rankings, student detail views and exam availability. Period, cohort, search and learning-signal filters work locally. It never writes student or organization data. New learners have empty activity and scores; illustrative learning records are clearly labeled **Sample analytics**.

This remains a UI prototype. Platform sign-in is a preview button; organization passwords use local salted PBKDF2 hashes. Real account authentication, organization authorization, analytics ingestion and database persistence require a backend. Shared local preview data works when pages use the same browser origin; file URL storage behavior varies between browsers.

## Production plan

[Production architecture](docs/production-architecture.md) describes the confirmed requirements for 2,000 registered students and a ₹20,000 monthly operating target: three separate portals, platform-owned provisioning, required password change, server-enforced access, external code execution, timed monitored exams, recorded courses, existing Zoom/Meet classes, analytics and rollout gates. It includes a proposed cost allocation and the usage assumptions that must be verified before launch.

[Production stack review](docs/stack-options-review.md) evaluates Neon, JWT authentication, Resend and Cloudflare Workers, Sandboxes and R2. It records the accepted choices and leaves queue procurement undecided.

## Standalone development

Edit `src/otp-slate.html`, `src/admin/`, or `src/organization/`, then run:

```sh
npm install
npm run build
npm test
```

The build produces all standalone HTMLs and embeds the student Excel template in Platform Admin. Tests cover the existing student workflows, organization management and a 2,000-student import, plus member provisioning, organization scoping, read-only analytics, filters, large-roster pagination and session revocation.
