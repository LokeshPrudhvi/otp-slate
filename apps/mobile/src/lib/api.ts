import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

const origin = new URL(
  process.env.EXPO_PUBLIC_API_ORIGIN || "https://otp-slate-student.pages.dev",
);
if (
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/" ||
  (!__DEV__ && origin.protocol !== "https:")
)
  throw new Error(
    "Configure a plain HTTPS EXPO_PUBLIC_API_ORIGIN without credentials.",
  );
export const API_ORIGIN = origin.origin;
export const authClient = createAuthClient({
  baseURL: `${API_ORIGIN}/api/auth`,
  fetchOptions: { credentials: "omit", headers: { Origin: API_ORIGIN } },
  plugins: [
    expoClient({
      scheme: "slate",
      storagePrefix: `slate_${origin.host.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      storage: SecureStore,
      disableCache: true,
    }),
  ],
});
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!/^[a-zA-Z0-9]/.test(path) || path.includes("..") || path.includes("://"))
    throw new Error("Invalid API path.");
  // Using the SDK fetch keeps rotated cookies (including first-password changes)
  // in SecureStore. Never place credentials in URLs or send them to attachment hosts.
  const result = await authClient.$fetch<T>(`/api/v1/${path}`, {
    baseURL: API_ORIGIN,
    method,
    body,
    signal,
    credentials: "omit",
    headers: { Origin: API_ORIGIN },
  });
  if (result.error)
    throw new ApiError(
      result.error.status || 0,
      result.error.message ||
        "Could not connect. Check your connection and retry.",
    );
  return result.data as T;
}
export function absoluteUrl(value: string) {
  return new URL(value, API_ORIGIN).href;
}
export function safeExternalUrl(value: string) {
  const url = new URL(value, API_ORIGIN);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("This link is unavailable.");
  return url.href;
}
