import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, jwt, twoFactor } from "better-auth/plugins";
import type { Config } from "./config.js";
import type { Database } from "./database.js";
import * as schema from "./schema.js";
import { encryptPayload } from "./providers.js";
import { randomUUID } from "node:crypto";
import { developmentLogin } from "./development-login.js";

export function createAuth(
  db: Database,
  config: Config,
  localDatabase = false,
) {
  return betterAuth({
    appName: "OTP Slate",
    baseURL: config.authUrl,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: config.origins,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const login = developmentLogin(
          config,
          localDatabase,
          context.path,
          context.body,
          context.headers?.get("origin"),
        );
        if (login) return { context: { body: { ...context.body, ...login } } };
      }),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      async sendResetPassword({ user, url }) {
        await db.insert(schema.outbox).values({
          type: "password_reset",
          encryptedPayload: encryptPayload(config.secret, {
            email: user.email,
            url,
          }),
          expiresAt: new Date(Date.now() + 3600_000),
        });
      },
    },
    session: {
      expiresIn: 8 * 3600,
      updateAge: 5 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: config.production,
      crossSubDomainCookies: { enabled: false },
      database: { generateId: () => randomUUID() },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": async (request, currentRule) => {
          if (request.method !== "POST") return currentRule;
          try {
            const preview = developmentLogin(
              config,
              localDatabase,
              "/sign-in/email",
              await request.clone().json(),
              request.headers.get("origin"),
            );
            // Public fixture logins share one loopback bucket across the three
            // local portals. Ordinary passwords and hosted/production auth keep
            // the library's strict sign-in limit.
            return preview ? { window: 10, max: 30 } : currentRule;
          } catch {
            return currentRule;
          }
        },
      },
    },
    plugins: [
      admin(),
      twoFactor({ issuer: "OTP Slate" }),
      jwt({
        jwt: {
          issuer: config.authUrl,
          audience: "otp-slate-api",
          expirationTime: "5m",
          definePayload: ({ session }) => ({ sid: session.id }),
        },
      }),
    ],
    logger: { disabled: config.production, level: "error" },
  });
}
export type Auth = ReturnType<typeof createAuth>;
