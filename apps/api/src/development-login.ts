import type { Config } from "./config.js";

// Public local preview credentials. Each portal still signs into a distinct
// database account and uses the normal password, session and permission checks.
export const developmentPassword = "Slate-local-only!2026";
const accounts: Record<string, string> = {
  "http://student.localhost:5173": "student@slate.test",
  "http://localhost:5173": "student@slate.test",
  "http://127.0.0.1:5173": "student@slate.test",
  "http://admin.localhost:5174": "admin@slate.test",
  "http://localhost:5174": "admin@slate.test",
  "http://127.0.0.1:5174": "admin@slate.test",
  "http://organization.localhost:5175": "viewer@slate.test",
  "http://localhost:5175": "viewer@slate.test",
  "http://127.0.0.1:5175": "viewer@slate.test",
};

export function developmentLogin(
  config: Config,
  localDatabase: boolean,
  path: string | undefined,
  body: unknown,
  origin: string | null | undefined,
) {
  if (
    config.production ||
    !localDatabase ||
    !config.databaseUrl.startsWith("pglite://") ||
    path !== "/sign-in/email" ||
    !origin ||
    !config.origins.includes(origin)
  )
    return;
  const email = accounts[origin];
  const input = body as { email?: unknown; password?: unknown } | undefined;
  if (
    !email ||
    typeof input?.email !== "string" ||
    input.email.trim().toLowerCase() !== "test@gmail.com" ||
    input.password !== "1234"
  )
    return;
  return { email, password: developmentPassword };
}
