import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import type { Config } from "./config.js";

export const portalClientIpHeader = "x-slate-client-ip";
const proxyKeyHeader = "x-slate-proxy-key";
const clientIps = new WeakMap<Request, string>();

/** Use only addresses established by the ingress, never an arbitrary header. */
export function requestClientIp(request: Request): string {
  return clientIps.get(request) || request.socket.remoteAddress || "unknown";
}

/** An emailed link cannot authenticate directly to the private API origin. */
export function portalPasswordResetUrl(
  value: string,
  config: Pick<Config, "portalProxySecret" | "authUrl" | "origins" | "production">,
): string {
  if (!config.portalProxySecret) return value;
  try {
    const reset = new URL(value);
    const callback = new URL(reset.searchParams.get("callbackURL") || "");
    if (
      reset.origin !== new URL(config.authUrl).origin ||
      callback.username || callback.password ||
      !config.origins.includes(callback.origin) ||
      !["http:", "https:"].includes(callback.protocol) ||
      (config.production && callback.protocol !== "https:")
    ) throw new Error();
    return new URL(reset.pathname + reset.search, callback.origin).toString();
  } catch {
    throw new Error("Password reset requires a trusted portal callback URL.");
  }
}

/** Mount on /api before authentication and registration handlers. */
export function portalProxyIngress(secret?: string): RequestHandler {
  const expected = secret ? Buffer.from(secret) : undefined;
  return (request, response, next) => {
    const key = request.headers[proxyKeyHeader];
    const forwardedIp = request.headers[portalClientIpHeader];
    // Neither client-supplied forwarding headers nor the shared ingress key
    // should reach auth adapters, application handlers, or their logs.
    for (const header of Object.keys(request.headers)) {
      if (
        header.startsWith("x-forwarded-") ||
        ["forwarded", "x-real-ip", "x-client-ip", "cf-connecting-ip",
          "true-client-ip", proxyKeyHeader, portalClientIpHeader].includes(header)
      ) delete request.headers[header];
    }
    const health = (request.method === "GET" || request.method === "HEAD") &&
      request.originalUrl.split("?")[0] === "/api/health";
    if (expected && !health) {
      const supplied = typeof key === "string" ? Buffer.from(key) : undefined;
      if (
        !supplied || supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected) ||
        typeof forwardedIp !== "string" || !isIP(forwardedIp) ||
        forwardedIp.includes("%")
      ) {
        response.status(403).json({ message: "Use a trusted portal to access this API." });
        return;
      }
      clientIps.set(request, forwardedIp);
      request.headers[portalClientIpHeader] = forwardedIp;
      // A verified portal always calls the HTTPS origin. Ignore an incoming
      // protocol header rather than letting it control Better Auth's URL.
      request.headers["x-forwarded-proto"] = "https";
    } else {
      const address = request.socket.remoteAddress;
      if (address && isIP(address)) {
        clientIps.set(request, address);
        request.headers[portalClientIpHeader] = address;
      }
    }
    next();
  };
}
