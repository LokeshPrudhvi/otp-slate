# Render API deployment

The root `render.yaml` defines one **Free** Node web service in Ohio, close to the existing Neon database in AWS us-east-2. Cloudflare hosts the portals separately. The Blueprint does not create a database, paid worker or persistent disk. Automatic deploys and previews are disabled so releases are deliberate.

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

Render supplies `PORT`; production reads it before any `API_PORT` value. Local development retains `API_PORT` priority. HTTPS URLs and the authentication secret are checked at startup. The existing database-role check rejects domain-table owners, superusers and roles that bypass row security.

For the Cloudflare deployment, set `PORTAL_PROXY_SECRET` on both sides before exposing the portals. The configured API requires the matching proxy secret for `/api` requests other than `/api/health`, so requests must go through the portal proxy. The setting is optional only for installations that do not use this deployment architecture. Do not reuse `BETTER_AUTH_SECRET` as the proxy secret.

## Existing data and releases

Prepare the restricted login with `node scripts/provision-runtime-role.mjs`. This is a read-only preflight against the existing `.env` database. Once reviewed, `node scripts/provision-runtime-role.mjs --apply` creates `slate_api_render` and its explicit grants in a transaction. The random credential is saved only to ignored `.local/render-runtime.env` with mode `0600`; copy its `DATABASE_URL` privately into Render. The generated pooled URL verifies the server's TLS certificate and hostname. The script never changes the original `.env`, resets an existing password, runs migrations, or changes application rows. An existing login is reused only when the saved credentials authenticate successfully.

The login is `NOINHERIT` and can explicitly switch into the four existing application roles; it receives direct access only to the seven `auth_*` tables and the email outbox. After applying, the script runs the API's production-role check and read-only scope/denial probes. [PostgreSQL role membership](https://www.postgresql.org/docs/18/role-membership.html)

Do not migrate, bootstrap or seed the existing Neon database as part of building or starting the web service. The compiled start command is `node apps/api/dist/main.js`. Keep `MIGRATION_DATABASE_URL` off Render. If a future release needs a migration, rehearse it on an isolated database branch, then run it separately from an authorized workstation before deploying the compatible application version. Free Render services do not provide interactive shell/one-off jobs.

Email work stays in the API process and its durable queue stays in Neon. While the free service is asleep, pending emails wait until it wakes. No second local API with email sending enabled should compete against the same live queue during deployment verification.

## Keep the rollout free

Render Free sleeps after idle periods and can take about a minute to resume; its shared monthly hours and other quotas still apply. Free is suitable for this initial deployment, not a promise of capacity for 2,000 simultaneous students. Do not add keep-awake traffic. [Render Free limits](https://render.com/docs/free)

The Blueprint fixes the compute plan, but it cannot enforce account-wide billing controls. Check Render's Billing settings: avoid adding a payment method for this free rollout, or explicitly review usage limits and potential overages if one already exists. Also verify the existing Neon plan separately; this configuration does not change its billing plan. [Render usage billing](https://render.com/docs/free#monthly-usage-limits)

The Blueprint uses documented `plan`, `region`, manual-deploy, preview and secret-input settings. [Blueprint reference](https://render.com/docs/blueprint-spec) The API binds the platform-provided port on `0.0.0.0`. [Render port binding](https://render.com/docs/web-services#port-binding)
