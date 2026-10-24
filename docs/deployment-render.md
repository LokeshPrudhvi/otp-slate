# Render API deployment

The root `render.yaml` defines one **Free** Node web service in Ohio, close to the existing Neon database in AWS us-east-2. Cloudflare hosts the portals separately. The Blueprint does not create a database, paid worker or persistent disk. Automatic deploys and previews are disabled so releases are deliberate.

## Coordinated release — 16 October 2026

Source `a308e8c` is live on the existing Free / Ohio API as `dep-db8tuv0n74is73cqtt30`. Cloudflare releases from the same source are Admin `2da5d33f`, Student `d0073410` and Organization `fea1b234`. The API/portal builds and nine deployment-proxy checks passed. All three live portals served matching tested assets and deep links; direct API and portal health returned 200, protected anonymous requests returned 401, and no application error logs appeared during rollout.

No runtime configuration, plan, schema or assignment changes were needed. The 72-topic syllabus import was already verified in production; release commands did not rerun imports, seeds or migrations. The topics remain drafts until their actual reading PDFs and assessments are added, published and assigned.

## CRT assignments for all branches — 15 October 2026

Source `0fb4050` is live on the existing Free / Ohio API as `dep-db87pvou01pc73ero7fg`, with Admin Pages `33afe962`. Student `d57bebdd` and Organization `50c314db` are unchanged. No service, plan or secret was added.

In **Admin → CRT → Branch assignments**, choose an organization and **All branches** to assign published topics to its current and future valid branches. Branch-specific topics remain additional; an all-branches assignment takes precedence for the same topic and appears once. Removing it preserves any separate branch assignment. Students still require CRT access, and publishing alone does not assign a topic. Existing assignments, attempts and progress remain saved; live exams still require one branch.

Migration `013-crt-all-branches` was rehearsed twice on an auto-expiring Neon clone, including PostgreSQL role/isolation checks, before production. Counts and digests of all **37 existing tables** remained unchanged. Verification passed **217 API checks** (one existing optional check skipped), **18 focused CRT frontend checks**, and all three portal builds. One timing-sensitive Student test was rerun successfully with the full Student CRT suite in isolation. Browser checks confirmed both branches received the shared topic, a separate branch topic remained available, and another organization was excluded. The temporary preview was stopped.

Production Admin/Student deep links served the exact tested JavaScript/CSS bytes; health returned 200 and anonymous CRT reads/writes, including both assignment scopes, returned 401. No real topic assignments or student data were changed for testing.

## Portal wording cleanup — 14 October 2026

Source `2e7280d` removes visible content version labels and numbers from course catalogs, course/lesson pages, access selectors, submissions and CRT. Publishing controls use **Publish changes** and CRT assignment updates use **Apply update**. Internal publication history, assignment pins and student progress are unchanged. There is no database migration or plan change.

Matching releases: Render `dep-db7qdvid0e5s73eq30mg`, Admin Pages `de4c5f75`, Student Pages `d57bebdd`. The Organization UI had no version labels and is unchanged. All three portal builds, 30 focused frontend checks and 26 course/CRT API checks passed. Isolated browser checks verified the admin course editor and student course page without version metadata. Production course/CRT/exam deep links served the exact tested JavaScript/CSS bytes; both portal health endpoints returned 200 and anonymous CRT reads/writes returned 401. Render confirmed the release live. The isolated preview was stopped.

## CRT and single-branch exam release — 14 October 2026

Source `93a4896` is live on the existing Free / Ohio service as `dep-db7q41uisbdc73bm3j60`. Matching Cloudflare Pages releases are Admin `2b046378` and Student `2f609b9f`; Organization remains unchanged. No service, paid plan or secret was added.

Admin and Student now have a CRT section with four fixed subjects and separate practice. Admin authors PDF topics with image-capable MCQs and a passing percentage, publishes immutable versions, assigns versions to one organization and one stable branch identity, and manages extra practice-bank questions. Students read PDFs beside assessments, enlarge the PDF, retry assessments, earn completion checkmarks and practise from assigned topics plus extra questions. Existing assignments remain pinned when content is republished; practice completion does not mark topics complete. Custom portal access policies must explicitly enable CRT.

Live-exam creation, editing and publication require one organization and exactly one branch. Optional selected students must belong to both. Existing published exams retain their frozen recipients, attempts and results; older broad drafts must choose a branch before saving or publishing. Regression checks verified that CSE in two different organizations remains isolated for exams, course/practice access and CRT assignments.

The additive `012-crt-curriculum` migration was rehearsed twice on an auto-expiring Neon clone with actual PostgreSQL role checks before application to production. Five new tables use forced row-level security. Counts and digests of all **32 pre-existing application/auth tables** were unchanged, including 5 organizations, 11 members, 24 enrollments, 21 course versions, 58 progress rows and the existing exam/attempt. The earlier image migration now tolerates `crt_pdf` during full local migration reruns.

Verification: **216 API checks passed**, one existing optional check skipped, **30 focused frontend checks passed**, **9 deployment-proxy checks passed**, and all three portals built. Real R2 PDF verification used synthetic identities and an isolated database: upload/finalization, exact bytes, inline PDF headers, HTTP range reads and denial for another organization's CSE student passed. Both generated objects were removed and absence verified. Isolated browser checks covered topic listing/pagination, failed/passing assessments, enlarged PDF reading, mixed practice-bank questions, persisted practice results, admin draft/version publication, and an excluded same-code branch. Browser file selection itself was blocked by the extension's file-URL permission; the real storage flow was tested separately.

Production CRT/exam deep links, JavaScript/CSS hashes, health responses and anonymous CRT read/write denial were verified on both updated portals. No real test accounts, curriculum topics, assignments or emails were created. Test preview servers were stopped. See [CRT usage](application-setup.md#crt-curriculum-and-branch-specific-exams).

## MCQ image release — 13 October 2026

Release source `ad124a6` adds one optional private image to each question in the existing course MCQ and live-exam editors. Admins can upload, replace or remove PNG, JPEG or WebP images up to **5 MiB**, with a required accessible description. Students can enlarge images in place while answering and reviewing results. Practice test authoring is unchanged. Question text and answer options remain required.

Images reuse the existing private R2 bucket and direct-upload flow. The API checks file size, declared type and the immutable object's raster signature before accepting the upload. Student image URLs require access to the exact assigned course version/lesson or owned exam attempt. Generic upload downloads remain unavailable to students for question images. Published course versions, submitted answers and their image references remain intact when a newer version replaces an image. Signed image URLs expire after one hour; removing an image from a draft does not delete assets used by historical content.

Migration `011-mcq-images` was rehearsed twice on an auto-expiring Neon clone, including scoped row-security read/write checks. Production application verified counts and digests across **32 existing tables** without changing application rows: 5 organizations, 11 members, 24 enrollments, 21 course versions and 58 progress records were preserved.

Validation: **207 API tests passed**, one existing optional check skipped, and **51 frontend checks passed** across shared image components, Admin course/exam editors and Student workflows. Both affected portals built successfully. Real R2 integration exercised PNG/JPEG/WebP uploads, signed reads, spoof rejection, denied cross-organization access, grading and retained version history using an isolated database. Browser checks covered Admin save/preview, nested-dialog Escape and focus behavior, Student image enlargement, a passing course quiz with feedback, and an image-based timed exam with saved answers. All 12 temporary R2 test objects were removed and their absence verified. No production test accounts, assignments, exams or emails were created.

The API is live on the existing **Free / Ohio** service as `dep-db6u45bl550s73a4bge0` from source `ad124a6`. Matching Pages releases are Admin `8684478b` and Student `1a8db42e`; Organization remains unchanged. Production course/exam deep links and JavaScript/CSS hashes match the tested builds. Both portal health checks returned 200, and anonymous image reads/uploads returned 401. No new service, environment secret or paid plan was added. The previous live-exam rollout is recorded below.

## Live exams release — 13 October 2026

Release source `5edd008` adds **Admin → Learning → Live exams** and the Student live-exam workflow. Admins create MCQ/coding questions, select an organization and either its whole eligible audience, saved branches or individual students, set the schedule and duration, configure browser monitoring, and publish. Publication freezes questions, timing and recipient member IDs. Renaming a branch updates draft selections but retains published rosters. Each student has one resumable attempt; the server enforces the earlier of its personal deadline and the closing time. Answers are versioned and saved automatically. Admins can review answers and browser events, export results, grade coding answers and release results after the window closes and all started attempts have been graded.

**Coding questions are submission-only and manually reviewed.** Students choose an allowed language, write code in a plain source textbox, and submit it with their MCQ answers. Coding exam code is never run or sent to an external provider. MCQs are scored automatically. The standalone Student Compiler remains a separate optional practice feature using OneCompiler's public embed. No provider key, paid service or plan upgrade is required for these exams.

Browser monitoring records tab visibility, focus, fullscreen, connection and optional clipboard-event types. It does not record screen, camera, microphone or clipboard contents. These signals support review and do not establish misconduct. Otto is hidden in exam attempts, and unsaved edits have navigation/reload guards. The free Render service can still sleep; schedule real exams with this deployment limitation in mind.

The additive `010-live-exams` migration was applied twice on an auto-expiring Neon clone before production. It adds five tables with forced row-level security and separates answer keys/hidden tests from student-readable questions. Production counts and digests across **27 existing tables** remained unchanged, including 24 enrollments, 21 course versions and 58 lesson-progress records. Clone checks verified student/tenant/role isolation and two-connection lock behavior. No real exams, attempts or emails were created for testing.

Validation: **198 API tests passed**, one existing optional check skipped; 29 Student checks (including 18 exam checks) and ten Admin helper checks passed. Browser checks with isolated synthetic accounts covered selecting a student, publishing, answering/resuming, submission, manual grading, withheld/released results and denial for an unselected student. A final submission-only browser check verified saving source, automatic MCQ marks, manual coding marks and student-visible feedback after release. Coding review assigns marks without executing submitted code; the removed execution routes return 404 to authenticated requests.

The earlier Free / Ohio API release was `dep-db6ilgbl550s73b38klg` from source `5edd008`; the MCQ image release above supersedes it. Matching Pages releases were Admin `53f3b26f` and Student `888ad46d`; Organization remained unchanged. Public deep links served the exact tested bundle bytes, both portal API health checks returned 200, and anonymous exam reads and mutations returned 401. Authenticated end-to-end tests used isolated sample accounts, not real production student attempts.

## Branch editing release — 12 October 2026

The earlier branch editing API source was `2c99cc7`, deployed on the existing Free / Ohio service as `dep-db6hmeg473hc739putqg`; the live exams release above supersedes it. In **Admin → Access → select organization → Branches → select branch → Edit branch**, Platform Admin can change the official name and code, then save. The transaction updates assigned students, registration records, branch access-rule keys and announcement audiences together. Course enrollments, pinned course versions, individual overrides and lesson progress retain their identities and values. Organization viewers remain read-only.

The additive `009-branch-editing` migration was rehearsed twice before production. It adds an internal stable branch identity, audit details and narrowly scoped platform-only update permissions. Production verification confirmed that existing values across ten tables were unchanged, including 11 members, 24 enrollments, 21 course versions and 58 lesson-progress records. No production branch was renamed during release checks.

Verification: 186 API tests passed (one existing optional check skipped), and 33 frontend/import regression checks passed. Browser checks on isolated sample data covered editing, student-list propagation and the guard against overlapping unsaved access changes. An isolated Neon production clone verified exact learning/email data preservation through rename and restore, duplicate rejection with rollback, and both concurrent registration/rename orderings. No real emails were sent. The Admin Pages release is `fc39000a`; Student and Organization bundles are unchanged. Production checks confirmed matching Admin bundle bytes, healthy API/proxy responses, public branch-list reads and unauthenticated branch-edit denial.

## Organization branch catalog release — 12 October 2026

The earlier branch catalog API source was `54ae644`, deployed as `dep-db6fpr67bikc73cnjiv0`; the branch editing release above supersedes it. Platform Admin creates branches with a name and code under **Access → Organization → Branches → Add branch**, or opens **Manage branches** from an organization. Organization viewers remain read-only. Student creation, editing and public registration select from that organization's saved branches; the code fills automatically. The Excel template includes an organization-specific branch dropdown and code lookup, with server validation against the saved catalog. Creating a student as admin still activates it immediately; public registrations still require approval.

The additive `008-organization-branches` migration was rehearsed twice on an auto-expiring production clone and then applied separately to production. It backfilled existing branch assignments and policy names without renaming their spelling. Counts remained at 4 organizations, 11 members, 21 course versions, 58 lesson-progress rows, 1 announcement and 1 registration. All existing non-empty student, registration and policy branches resolve to catalog entries. The table uses forced row-level security; public registration can only read an active organization's branch names and codes. Unknown branches, mismatched names/codes and cross-organization selections are rejected before provisioning or email queuing.

Verification: 177 API tests passed (one existing optional integration check skipped), 26 frontend/import tests passed, and all three portals built. Isolated browser checks verified branch creation, create/edit student dropdowns, code auto-fill, organization switching, and safe refresh/retry after a saved branch. No real student accounts or emails were created during these tests. Production health, scoped public branch reads, unauthenticated admin denial and exact frontend bundle hashes passed. Pages releases are admin `5c58f53d` and student `d63c5064`; the organization portal remains unchanged.

## Announcements release — 12 October 2026

The earlier announcements API source was `5fceb85`, deployed to the existing Free / Ohio service as `dep-db6f7jad0e5s73ahcsvg`; the branch catalog release above supersedes it. Platform Admin can publish a rich-text announcement to one organization, choosing either **All branches** or a specific branch. Published and archived history supports archive/restore. Students see published notices for their current organization and branch when their Announcements section is enabled. Publishing does not send email, and Organization Admin remains read-only.

The additive `007-announcements` migration was rehearsed twice on an auto-expiring Neon branch before production. Forced row-level security restricts tenant and branch reads and platform-only writes. Production verification preserved 4 organizations, 11 members, 21 course versions and 58 lesson-progress rows. No real notices were published during testing.

Verification: 169 API checks passed (one optional integration check skipped), 13 announcement component checks passed, and 38 rich-text/rendering checks passed. Isolated browser checks covered branch publishing, student visibility, archive and restore. Render health and both portal proxies returned 200. The affected Pages releases are admin `e615ddd2` and student `d72027f9`; the organization bundle remains `50c314db`. Production source hashes and unauthenticated access checks were verified; authenticated publish tests used synthetic local accounts only.

## Current API and lesson storage — 12 October 2026

The earlier lesson-storage release used API commit `05b5a0a` on the existing **Free / Ohio** service; the announcements release above supersedes it. Private lesson storage is configured in Cloudflare R2: bucket **`otp-slate-lessons`**, **Standard** storage with the **APAC** location hint. It is not a public media bucket. Pages releases are independent of the API.

The additive `006-rich-lessons` migration has been applied separately to the existing Neon database. Its new `lesson_uploads` and `lesson_submissions` tables use scoped row security. Verification preserved all **21 course versions** and **58 lesson-progress rows**; no existing lessons or progress were reset.

The real R2 service integration passed with an isolated in-memory PGlite database, synthetic identities, a generated 1,854-byte MP4 and a 99-byte text attachment. It exercised admin upload/finalization/publication, assigned-student private playback, assignment upload/submission/download, admin review, completion tracking and MCQ grading. Signed playback matched the source bytes; unassigned access and unsigned object access were denied. All synthetic R2 objects were removed and their absence verified. No production student data or emails were used. Provider checks also verified production-origin CORS, PUT, HEAD, server-side copy and signed GET; this does not substitute for a published-frontend browser acceptance test.

## Historical initial rollout — 12 October 2026

This section records the original rollout before the lesson-storage release above; its commit and verification scope are historical.

The API is live at [otp-slate-api.onrender.com](https://otp-slate-api.onrender.com), with `/api/health` configured as its health check. The **Slate** workspace (`tea-db6a5ll9fdbs73fdgmh0`) contains service `srv-db6a8jdckfvc73cnigm0`, named `otp-slate-api`, on **Free / Ohio**. Its initial deployed source was commit `82bff362c2a2726504093ecf29e737c80f0b580f` on `codex/free-cloud-deployment`. Automatic deploys are off.

The existing Neon project `small-shape-18661054` retains its schema and application data. Its organization Free plan was confirmed using the Neon CLI. The new restricted `slate_api_render` login was created and verified; the owner credential is not used by the deployed API. Existing Resend settings were carried over. WhatsApp, R2 and code-execution providers were unconfigured during this initial rollout. R2 was subsequently connected as recorded above; WhatsApp and code execution remain separate setup work.

Health and unauthenticated access checks passed for the API and [three deployed portals](deployment-cloudflare.md#live-portals--13-october-2026). At that point, real-account sign-in, email delivery and load testing had **not** been performed. These statements describe the initial verification only, not subsequent work or current acceptance status.

For subsequent releases, push reviewed changes to `codex/free-cloud-deployment`, then manually deploy the chosen commit from the Render service's **Manual Deploy** menu. A push alone does not release the API. Cloudflare Direct Upload releases are separate; use the portal commands in its deployment guide and verify API compatibility before uploading new frontend bundles.

## Connect the service

1. Push the reviewed deployment changes to the chosen Git branch. In Render, create a Blueprint from this repository and branch using `render.yaml`.
2. Choose the existing free/Hobby workspace and confirm the service instance type is **Free** before creation. Do not upgrade the workspace, add a paid resource or configure autoscaling.
3. Supply the required environment values below. The build runs from the repository root; do not set `rootDir` to `apps/api` because shared workspace dependencies are needed.
4. Deploy and check `/api/health`. Test all three portals, including a fresh browser session, logout, and password reset. A successful health response establishes process readiness, not authorization or email delivery.

| Render environment value       | What to use                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | The existing Neon's pooled TLS connection for the restricted production runtime login. Do not use the owner/migration account.                                       |
| `BETTER_AUTH_SECRET`           | Preserve the current private value. Replacing it invalidates sessions and prevents queued email payloads from being decrypted.                                       |
| `PORTAL_PROXY_SECRET`          | A separate random secret of at least 32 characters, identical in Render and the Cloudflare portal proxy. Required for this deployment; never send it to the browser. |
| `BETTER_AUTH_URL`              | The HTTPS public authentication URL selected for the deployed portal/API routing.                                                                                    |
| `TRUSTED_ORIGINS`              | Exact HTTPS portal origins, comma separated, with no paths, trailing slashes, wildcards or preview domains.                                                          |
| `STUDENT_PORTAL_URL`           | The exact deployed student origin, also listed in `TRUSTED_ORIGINS`; welcome emails link here.                                                                       |
| `RESEND_API_KEY`, `EMAIL_FROM` | Add the existing private Resend key and verified sender to enable welcome/password-reset emails. Omit both until ready to send. Never put them in a `VITE_*` value.  |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Server-only R2 account ID, bucket-scoped access-key pair and `otp-slate-lessons`. Keep these on Render; never copy them into Pages bindings or browser builds. |

Render supplies `PORT`; production reads it before any `API_PORT` value. Local development retains `API_PORT` priority. HTTPS URLs and the authentication secret are checked at startup. The existing database-role check rejects domain-table owners, superusers and roles that bypass row security.

For the Cloudflare deployment, set `PORTAL_PROXY_SECRET` on both sides before exposing the portals. The configured API requires the matching proxy secret for `/api` requests other than `/api/health`, so requests must go through the portal proxy. The setting is optional only for installations that do not use this deployment architecture. Do not reuse `BETTER_AUTH_SECRET` as the proxy secret.

## Existing data and releases

Prepare the restricted login with `node scripts/provision-runtime-role.mjs`. This is a read-only preflight against the existing `.env` database. Once reviewed, `node scripts/provision-runtime-role.mjs --apply` creates `slate_api_render` and its explicit grants in a transaction. The random credential is saved only to ignored `.local/render-runtime.env` with mode `0600`; copy its `DATABASE_URL` privately into Render. The generated pooled URL verifies the server's TLS certificate and hostname. The script never changes the original `.env`, resets an existing password, runs migrations, or changes application rows. An existing login is reused only when the saved credentials authenticate successfully.

The login is `NOINHERIT` and can explicitly switch into the four existing application roles; it receives direct access only to the seven `auth_*` tables and the email outbox. After applying, the script runs the API's production-role check and read-only scope/denial probes. [PostgreSQL role membership](https://www.postgresql.org/docs/18/role-membership.html)

Do not migrate, bootstrap or seed the existing Neon database as part of building or starting the web service. The compiled start command is `node apps/api/dist/main.js`. Keep `MIGRATION_DATABASE_URL` off Render. If a future release needs a migration, rehearse it on an isolated database branch, then run it separately from an authorized workstation before deploying the compatible application version. Free Render services do not provide interactive shell/one-off jobs.

Email work stays in the API process and its durable queue stays in Neon. While the free service is asleep, pending emails wait until it wakes. No second local API with email sending enabled should compete against the same live queue during deployment verification.

## Private lesson storage operations

- Keep all four `R2_*` values server-only. The scoped key must support reading, writing, copying and deleting objects in `otp-slate-lessons`; it does not need access to unrelated buckets.
- Bucket CORS allows `https://otp-slate-admin.pages.dev`, `https://otp-slate-student.pages.dev`, and the exact local Student/Admin origins: `student.localhost:5173`, `admin.localhost:5174`, plus `localhost` and `127.0.0.1` on ports 5173/5174 over HTTP. Keep the allowlist in `deployment/cloudflare/lesson-cors.json` synchronized with the bucket. Organization viewers, preview domains and arbitrary origins are excluded. CORS is separate from authorization: the API checks the current account, assigned course version, lesson and file ownership before issuing a signed URL. A missing local origin causes browser uploads to fail with a connection error even when the signed URL is valid.
- On 21 October, the live bucket allowlist was corrected after local upload preflights returned 403. Local origins now receive 204 with the matching allow-origin header, while an unrelated origin still receives 403. A real synthetic PNG passed signed upload, course-cover validation/finalization and byte-matching private download using an isolated in-memory database. Unsigned access remained denied; both temporary storage keys were deleted and absence verified. No production course or student data was changed by the test.
- The browser uploads directly to a signed `lesson-staging/` key. Completion checks the stored size/type, copies the object to an immutable `lesson-assets/` key, and then records it as ready. File bytes do not pass through Render.
- A lifecycle rule expires **`lesson-staging/` after one day** to clear abandoned uploads. **Never apply that expiration rule to `lesson-assets/`**: published lessons and submitted attachments depend on those retained objects.
- Video files are MP4 or WebM, at most **250 MiB** each. Assignment attachments are PDF, TXT, ZIP, PNG, JPG/JPEG or DOCX, at most **10 MiB** each and **three files per submission**. Video links remain available without uploading a file.
- Signed video GETs expire after one hour; assignment downloads expire after five minutes and use attachment disposition. The bucket remains private and unsigned object access is denied. A signed URL can remain usable until its expiry, so do not treat it as a permanent public link or include it in documentation/logs.

R2 is a separate storage service from the Render compute plan. Retained lesson assets are intentional; staging cleanup must not delete published learning or submission history.

## Keep the rollout free

Render Free sleeps after idle periods and can take about a minute to resume; its shared monthly hours and other quotas still apply. Free is suitable for this initial deployment, not a promise of capacity for 2,000 simultaneous students. Do not add keep-awake traffic. [Render Free limits](https://render.com/docs/free)

The Blueprint fixes the compute plan, but it cannot enforce account-wide billing controls. Check Render's Billing settings: avoid adding a payment method for this free rollout, or explicitly review usage limits and potential overages if one already exists. Also verify the existing Neon plan separately; this configuration does not change its billing plan. [Render usage billing](https://render.com/docs/free#monthly-usage-limits)

The Blueprint uses documented `plan`, `region`, manual-deploy, preview and secret-input settings. [Blueprint reference](https://render.com/docs/blueprint-spec) The API binds the platform-provided port on `0.0.0.0`. [Render port binding](https://render.com/docs/web-services#port-binding)
