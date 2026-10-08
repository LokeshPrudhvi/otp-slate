# Production stack review

Reviewed on 6 October 2026 for 2,000 registered students and the ₹20,000 monthly target. The user approved the recommended direction and authorized application conversion. This records the accepted choices and their tradeoffs; no paid subscriptions or production deployments have been created. The [production architecture](production-architecture.md) is the current baseline, and the [application setup guide](application-setup.md) records the initial implementation.

## Accepted direction

| Layer                     | Recommendation                                                                | Tradeoff or remaining decision                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                  | React, TypeScript, Vite and React Router                                      | Share components across three separately deployed portals; keep organization analytics read-only                                   |
| Backend                   | Node.js with NestJS                                                           | Familiar server runtime and structured domain modules; application hosting has a recurring cost                                    |
| Database                  | Neon PostgreSQL                                                               | Use Free for development and budget Launch for production; measure exam writes, analytics queries and idle behavior                |
| Database access           | Drizzle with SQL migrations                                                   | Preserve transaction-scoped organization isolation; Prisma ORM is an alternative library that can also use Neon                    |
| Authentication            | Better Auth with revocable cookie sessions and short-lived session-bound JWTs | Implemented in the initial Node API; verify MFA and provider-connected onboarding in staging. Neon Auth is not a launch dependency |
| Email                     | Resend                                                                        | Free allowance may suit routine resets; onboarding email bursts can require an upgrade                                             |
| WhatsApp                  | Official Meta Cloud API directly                                              | Avoid a provider subscription where possible, but authentication delivery still has Meta charges                                   |
| Documents and media files | Private Cloudflare R2                                                         | Video uploads need pre-encoding or a separate encoding service, a player and authorized playback                                   |
| Code execution            | Trial Cloudflare Sandboxes/Containers against managed Judge0                  | Decide after testing languages, exam bursts, isolation, recovery and actual cost per submission                                    |
| Background processing     | Provider undecided                                                            | Keep durable job records, retries and idempotency in the architecture; queue technology can be selected later                      |

The earlier recommendation was **NestJS**, a framework running on Node.js. **Next.js** is a React framework and is optional for these authenticated portals. [NestJS documentation](https://docs.nestjs.com/), [Next.js documentation](https://nextjs.org/docs)

Neon hosts PostgreSQL. Prisma ORM and Drizzle are libraries used by the backend to query it; neither replaces the database. Neon Free currently includes 1 GB/project and 100 CU-hours/project/month, with mandatory scale-to-zero after five idle minutes. Launch charges for usage and can disable idle suspension. Use pooled connections, bounded autoscaling and tested organization isolation. [Neon plan documentation](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md), [Prisma ORM](https://www.prisma.io/docs/orm), [Drizzle with Neon](https://orm.drizzle.team/docs/connect-neon)

JWT represents signed claims. Password hashing, reset-token expiry, first-login requirements and revocable sessions remain authentication responsibilities. Better Auth's JWT plugin complements its session system; it does not replace it. [Better Auth passwords](https://better-auth.com/docs/authentication/email-password), [JWT plugin](https://better-auth.com/docs/plugins/jwt)

Resend Free includes 3,000 emails/month with a 100/day cap. Its Pro plan is $20/month for 50,000 emails. Do not rely on the monthly allowance to send 2,000 invitations in one day. [Resend pricing](https://resend.com/pricing)

Official WhatsApp authentication templates are charged when delivered. Free trials and free unofficial client libraries do not establish a dependable zero-cost production OTP channel; whatsapp-web.js itself warns about possible blocking. [Meta pricing](https://whatsappbusiness.com/products/platform-pricing/), [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js)

## Cloudflare boundaries

Workers Free has 100,000 requests/day and 10 ms CPU per invocation. Workers Paid starts at $5/month with 10 million requests and 30 million CPU milliseconds included monthly. Matched static assets are served free. Hosting the API in Workers is a separate implementation option using a framework such as Hono, rather than assuming the Node/Nest application runs unchanged. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)

Ordinary Workers lack functional Node child processes for native compilation. Cloudflare Sandboxes offer Linux Containers for installed C/C++/Java/Python runtimes, and Dynamic Workers for JavaScript, Python and WebAssembly. Container scheduling is in public beta. Execution requires a paid plan and separate resource accounting; request allowances do not represent compiler capacity. [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [Sandboxes](https://developers.cloudflare.com/sandbox/), [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)

For either execution provider, the LMS still owns language drivers, test orchestration and grading policy. Bound CPU, memory and output; isolate submissions; keep credentials outside student execution; destroy or securely reset execution environments. Benchmark cold starts and retry behavior before using it for timed exams. [Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)

The storage product is **R2**. Standard storage includes 10 GB free and charges $0.015/GB-month above that; direct egress is free, while operations can cost extra. It does not automatically create adaptive video renditions. Cloudflare Stream provides managed video, with separate stored-minute and delivered-minute charges. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Stream pricing](https://developers.cloudflare.com/stream/pricing/)

Manually published job listings require normal admin CRUD and links. Background work instead covers imports, account provisioning, grading, email delivery and analytics; it does not mean automatic job discovery. Start with modest durable processing and choose the queue implementation after measuring the work.

The production architecture now replaces the earlier Cognito, BullMQ/Valkey and Bunny assumptions with Better Auth, a durable PostgreSQL outbox and private R2. DigitalOcean remains the API-hosting budget reference. Its revised ₹20,000 allocation reserves execution, messaging and overage costs; procurement still requires measured usage and current quotes. Free tiers alone cannot establish production capacity from the registered-student count.
