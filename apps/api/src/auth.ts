import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, jwt, twoFactor } from "better-auth/plugins";
import type { Config } from "./config.js";
import type { Database } from "./database.js";
import * as schema from "./schema.js";
import { encryptPayload } from "./providers.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { developmentLogin } from "./development-login.js";
import { portalClientIpHeader, portalPasswordResetUrl } from "./portal-proxy.js";
import {
  authRateLimitMaxWindowSeconds,
  createAuthRateLimitStorage,
} from "./auth-rate-limit.js";

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
      async sendResetPassword({ user, url, token }) {
        await db.transaction(async (tx) => {
          // Serialize the enqueue with an admin email correction. Better Auth
          // may have looked up the previous email before that edit committed.
          const [current] = await tx.select({ email: schema.user.email })
            .from(schema.user).where(eq(schema.user.id, user.id)).for("update");
          if (!current || current.email.toLowerCase() !== user.email.toLowerCase()) {
            await tx.delete(schema.verification).where(and(
              eq(schema.verification.value, user.id),
              eq(schema.verification.identifier, `reset-password:${token}`),
            ));
            return;
          }
          await tx.insert(schema.outbox).values({
            type: "password_reset",
            encryptedPayload: encryptPayload(config.secret, {
              userId: user.id,
              email: current.email,
              url: portalPasswordResetUrl(url, config),
            }),
            expiresAt: new Date(Date.now() + 3600_000),
          });
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
      // The ingress verifies the portal address, or supplies the direct socket
      // address in development. Never trust an arbitrary X-Forwarded-For chain.
      ipAddress: { ipAddressHeaders: [portalClientIpHeader] },
      crossSubDomainCookies: { enabled: false },
      database: { generateId: () => randomUUID(), joins: true },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customStorage: createAuthRateLimitStorage(db),
      window: authRateLimitMaxWindowSeconds,
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
        // Portals use the session cookie; bearer clients request /token explicitly.
        // Do not load signing keys and mint an unused JWT on every session read.
        disableSettingJwtHeader: true,
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
