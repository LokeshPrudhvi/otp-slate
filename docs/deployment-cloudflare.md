# Cloudflare Pages: three free portals

Each React portal is a separate Pages project. The browser keeps using its existing same-origin `/api` paths; a small Pages Function proxies them to the Render API. Pages receives only the API origin and a dedicated server-to-server proxy secret. The separate private R2 bucket is accessed through short-lived URLs signed by Render; the four R2 credentials/settings remain server-only on Render. No database URL, email key, or Better Auth secret belongs in Cloudflare. No secret belongs in a `VITE_*` variable or browser build.

## Live portals — 12 October 2026

The organization branch catalog update is deployed to Platform Admin (`5c58f53d`) and Student (`d63c5064`), built from source `54ae644`. Create branches using **Admin → Access → select organization → Branches → Add branch**, entering the official name and code. Student create/edit/registration forms then show that organization's branches in a searchable dropdown and fill the code automatically. Existing branches and student progress were preserved. See the [release verification](deployment-render.md#organization-branch-catalog-release--12-october-2026).

Announcements remain available under **Admin → Announcements**. Choose an organization and **All branches** or a saved branch, enter a title and message, then preview and publish. Notices appear in the student's Announcements section; they are not emails.

| Portal         | Production URL                                                               | Pages project            |
| -------------- | ---------------------------------------------------------------------------- | ------------------------ |
| Student        | [otp-slate-student.pages.dev](https://otp-slate-student.pages.dev)           | `otp-slate-student`      |
| Platform Admin | [otp-slate-admin.pages.dev](https://otp-slate-admin.pages.dev)               | `otp-slate-admin`        |
| Organization   | [otp-slate-organization.pages.dev](https://otp-slate-organization.pages.dev) | `otp-slate-organization` |

All three are live on the free setup and proxy API requests to `https://otp-slate-api.onrender.com`. Portal loading, health and unauthenticated API checks passed. The [current Render record](deployment-render.md#organization-branch-catalog-release--12-october-2026) identifies the latest backend commit and database migration; the same document records private R2 setup. The earlier lesson UI bundles were Platform Admin `7603acfb`, Student `ed483d0a` and Organization `50c314db`; the admin and student releases above supersede those bundles. Existing projects should be updated using the build/deploy commands below; do not create duplicate projects.

## Build configuration

| Portal         | Build command (repository root)                  | Upload directory               | Suggested project        |
| -------------- | ------------------------------------------------ | ------------------------------ | ------------------------ |
| Student        | `node scripts/cloudflare-build.mjs student`      | `apps/student/dist`            | `otp-slate-student`      |
| Platform Admin | `node scripts/cloudflare-build.mjs admin`        | `apps/platform-admin/dist`     | `otp-slate-admin`        |
| Organization   | `node scripts/cloudflare-build.mjs organization` | `apps/organization-admin/dist` | `otp-slate-organization` |

Project names must be available in the account; use the actual resulting domains in Render's configuration. Use Node 24 for production/CI builds, matching Render, and set `NODE_VERSION=24` for Pages Git builds. Local builds also support Node 22. Run `npm ci` at the repository root first. Build all portals with `node scripts/cloudflare-build.mjs all`. The script builds shared contracts and each selected portal, then stages `_worker.js` and `_routes.json` into its output. `--skip-build` only stages those files into an already-built output.

## Runtime configuration

Create the three Pages projects on the **Free** plan. Choose Direct Upload when deploying local work through Wrangler, or connect Git for automatic builds; Cloudflare treats these as separate setup choices. Do not upload the repository root. [Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/)

For each project's production environment:

1. Under **Settings → Variables and Secrets**, set `API_ORIGIN` to the actual Render origin, for example `https://otp-slate-api.onrender.com`. This is a runtime binding; it is not compiled into the browser. The proxy accepts only a bare HTTPS `*.onrender.com` service URL, without credentials, a port, path, query, or fragment. [Environment bindings](https://developers.cloudflare.com/pages/functions/bindings/#environment-variables)
2. Add **secret** `PORTAL_PROXY_SECRET` with the same dedicated random value configured on Render (at least 32 printable characters, without spaces). Use the same value for all three portals. Keep it separate from `BETTER_AUTH_SECRET`; never commit it or include it in the build command. The API uses it to authenticate the proxy before trusting Cloudflare's client IP.
3. Under **Settings → Runtime → Fail open / closed**, select **Fail closed** so exhausted Function quota does not return SPA HTML from API routes. The Pages API requires `fail_open` to match in production and preview, so set it to `false` for both; preview still receives no production API binding or secret. [Invocation routing](https://developers.cloudflare.com/pages/functions/routing/#fail-open--closed)
4. Set the Pages Functions compatibility date to **2026-10-12** in production. The proxy's `fetch(..., { cache: "no-store" })` requires `cache_option_enabled`, enabled by default from **2024-11-11**; do not add `cache_option_disabled`. Current Workers Fetch supports this option and bypasses its cache for external origins. [Compatibility requirement](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-cache-no-store-http-standard-api), [Fetch options](https://developers.cloudflare.com/workers/runtime-apis/fetch/#parameters)
5. Add the three exact production portal origins to Render's `TRUSTED_ORIGINS`, comma-separated. Keep `BETTER_AUTH_URL` on the Render HTTPS API origin. Keep production secure, host-only cookies (`crossSubDomainCookies.enabled: false`). In proxy mode, the API rewrites password-reset email links to the exact trusted callback portal origin, preserving the token and callback query, so the email opens that portal's `/api/auth` proxy rather than bypassing it through Render.
6. Do not connect arbitrary preview deployment domains to the production database. A preview requires its own API environment, proxy secret, and explicit trusted origin. Missing `API_ORIGIN` or missing/invalid `PORTAL_PROXY_SECRET` makes API requests fail closed with a generic 503 response.

The proxy forwards the browser's original Origin rather than replacing it with a trusted value. It removes incoming proxy credentials and forwarding/IP headers, then injects `x-slate-proxy-key` from its secret binding and `x-slate-client-ip` only from Cloudflare's edge-supplied `CF-Connecting-IP`. It rejects a different browser Origin, never follows upstream redirects carrying credentials, keeps cookies host-only, and makes all API responses non-cacheable. A student session therefore stays on the student portal and is not shared with either admin portal. Existing role checks remain enforced by the API.

## Direct deployment

The live projects use **Direct Upload**, with `main` configured as the Pages production-branch label. Keep `--branch main` in release commands so uploads update the production URLs. This label does not pull from Git's `main` branch: build the reviewed local checkout of `codex/free-cloud-deployment`, which is also the branch tracked by Render, then upload its compiled portal output. Git pushes do not automatically release these Pages projects.

After Wrangler is installed in the repository and signed into the intended Cloudflare account, run the create commands **only for projects that do not exist yet**. Wrangler 4.149 delegates new Pages project creation to Workers unless `--force` is supplied; here `--force` explicitly keeps creation on Pages. Existing projects only need the build/deploy commands.

```sh
npx wrangler pages project create otp-slate-student --production-branch main --force
npx wrangler pages project create otp-slate-admin --production-branch main --force
npx wrangler pages project create otp-slate-organization --production-branch main --force
node scripts/cloudflare-build.mjs all
npx wrangler pages deploy apps/student/dist --project-name otp-slate-student --branch main
npx wrangler pages deploy apps/platform-admin/dist --project-name otp-slate-admin --branch main
npx wrangler pages deploy apps/organization-admin/dist --project-name otp-slate-organization --branch main
```

Set both runtime bindings in each project's dashboard before deploying. Alternatively, `npx wrangler pages secret put API_ORIGIN --project-name <project-name>` prompts for the API origin, and `npx wrangler pages secret put PORTAL_PROXY_SECRET --project-name <project-name>` prompts for the shared proxy secret. The URL is not confidential, but this command can store either binding without a checked-in configuration. Verify both bindings are present in **production** and redeploy after changing them. For an existing project, skip `pages project create`.

Run proxy checks with `node --test deployment/cloudflare/proxy.test.mjs`. After deployment, check each portal's `/login` deep link, `/api/v1/me` (unauthenticated must be an API 401, not HTML), sign-in, sign-out, and a reload of a protected route. Confirm the session cookie has `Secure` and `HttpOnly`, and no `Domain` attribute. Check that signing into one portal does not sign another portal in.

## Free-tier behavior

Only `/api` and `/api/*` invoke the Function. Static assets and React navigation stay on Pages' free static hosting. Pages supplies SPA fallback when no top-level `404.html` exists. [SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering)

Pages Functions share the account's Workers Free allowance of **100,000 requests per day**, resetting at midnight UTC; static requests that bypass Functions are unlimited. All three portals and other Workers in the account share that allowance. This is a free pilot setup, not a guarantee for 2,000 simultaneously active students or a scheduled live exam. The Pages projects remain on Free, with no paid Worker subscription or automatic plan upgrade. The separately configured private R2 bucket uses Standard storage; Pages being free does not remove storage usage from R2. [Free pricing](https://developers.cloudflare.com/pages/functions/pricing/)

Render's free API can sleep, so the first API call after inactivity may be slow. Existing Neon data stays in Neon; the Pages build and proxy never migrate or seed a database.
