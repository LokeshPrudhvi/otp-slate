import assert from "node:assert/strict";
import { test } from "node:test";
import { getIP } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import {
  portalClientIpHeader,
  portalPasswordResetUrl,
  portalProxyIngress,
  requestClientIp,
} from "./portal-proxy.js";

const secret = "portal-proxy-test-only-32-character-secret";
const ingress = portalProxyIngress(secret);
function run(options: {
  key?: string | string[];
  ip?: string | string[];
  method?: string;
  url?: string;
  direct?: boolean;
  headers?: Request["headers"];
} = {}) {
  const request = {
    method: options.method || "POST",
    originalUrl: options.url || "/api/auth/sign-in/email",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      ...(options.key === undefined ? {} : { "x-slate-proxy-key": options.key }),
      ...(options.ip === undefined ? {} : { [portalClientIpHeader]: options.ip }),
      ...options.headers,
    },
  } as Request;
  let status = 200;
  let body: unknown;
  let passed = false;
  const response = {
    status(value: number) { status = value; return response; },
    json(value: unknown) { body = value; return response; },
  } as Response;
  (options.direct ? portalProxyIngress() : ingress)(request, response, () => { passed = true; });
  return { request, status, body, passed };
}

test("portal ingress rejects missing, incorrect, or repeated secrets without leaking them", () => {
  for (const key of [undefined, "short", "x".repeat(secret.length), [secret, secret]]) {
    const result = run({ key, ip: "198.51.100.20" });
    assert.equal(result.status, 403);
    assert.equal(result.passed, false);
    assert.equal(result.request.headers["x-slate-proxy-key"], undefined);
    assert.equal(result.request.headers[portalClientIpHeader], undefined);
    assert.deepEqual(result.body, { message: "Use a trusted portal to access this API." });
  }
});

test("portal ingress accepts one valid IP only after secret verification", () => {
  for (const ip of [undefined, "localhost", "198.51.100.20, 203.0.113.4", "198.51.100.20:80", "fe80::1%eth0", ["198.51.100.20"]]) {
    const result = run({ key: secret, ip });
    assert.equal(result.status, 403);
    assert.equal(result.passed, false);
  }
  for (const ip of ["198.51.100.20", "2001:db8:1234:5678::4"]) {
    const result = run({ key: secret, ip });
    assert.equal(result.status, 200);
    assert.equal(result.passed, true);
    assert.equal(requestClientIp(result.request), ip);
    assert.equal(result.request.headers[portalClientIpHeader], ip);
    assert.equal(result.request.headers["x-slate-proxy-key"], undefined);
  }
});

test("trusted client IPs distinguish users for registration and Better Auth", () => {
  const observed: string[] = [];
  for (const ip of ["198.51.100.20", "203.0.113.40"]) {
    const result = run({
      key: secret, ip,
      headers: {
        "x-forwarded-for": "192.0.2.99",
        "cf-connecting-ip": "192.0.2.98",
        "x-real-ip": "192.0.2.97",
        "x-forwarded-host": "untrusted.example",
        "x-forwarded-proto": "http",
        forwarded: "for=192.0.2.96",
        origin: "https://student.example.com",
        cookie: "session=preserved",
      },
    });
    const headers = result.request.headers;
    const authIp = getIP(fromNodeHeaders(headers), {
      advanced: { ipAddress: { ipAddressHeaders: [portalClientIpHeader] } },
    });
    assert.equal(authIp, ip);
    assert.equal(requestClientIp(result.request), ip);
    observed.push(authIp!);
    for (const header of ["x-forwarded-for", "cf-connecting-ip", "x-real-ip", "x-forwarded-host", "forwarded"])
      assert.equal(headers[header], undefined);
    assert.equal(headers["x-forwarded-proto"], "https");
    assert.equal(headers.origin, "https://student.example.com");
    assert.equal(headers.cookie, "session=preserved");
    // The registration helper remains bound to the verified value even if a
    // later handler accidentally changes the public header collection.
    headers[portalClientIpHeader] = "192.0.2.55";
    assert.equal(requestClientIp(result.request), ip);
  }
  assert.equal(new Set(observed).size, 2);
});

test("only the exact GET/HEAD health endpoint bypasses the portal secret", () => {
  for (const method of ["GET", "HEAD"]) {
    const result = run({ method, url: "/api/health", key: "wrong", ip: "invalid" });
    assert.equal(result.passed, true);
    assert.equal(result.status, 200);
    assert.equal(requestClientIp(result.request), "127.0.0.1");
  }
  for (const [method, url] of [
    ["POST", "/api/health"], ["GET", "/api/health/"],
    ["GET", "/api/health/anything"], ["GET", "/api/v1/registration/organizations"],
    ["GET", "/api/auth/jwks"],
  ]) {
    assert.equal(run({ method, url }).status, 403);
  }
});

test("direct development requests ignore injected proxy headers and retain socket IP", () => {
  const result = run({
    direct: true, key: secret, ip: "198.51.100.20",
    headers: { "x-forwarded-for": "192.0.2.99", "x-forwarded-proto": "https" },
  });
  assert.equal(result.passed, true);
  assert.equal(requestClientIp(result.request), "127.0.0.1");
  assert.equal(result.request.headers[portalClientIpHeader], "127.0.0.1");
  assert.equal(result.request.headers["x-forwarded-for"], undefined);
  assert.equal(result.request.headers["x-forwarded-proto"], undefined);
  assert.equal(result.request.headers["x-slate-proxy-key"], undefined);
});

test("reset emails enter the requesting trusted portal while preserving token and callback", () => {
  const config = {
    production: true,
    portalProxySecret: secret,
    authUrl: "https://otp-slate-api.onrender.com",
    origins: ["https://student.example.test", "https://admin.example.test", "https://organization.example.test"],
  };
  for (const origin of config.origins) {
    const source = new URL("/api/auth/reset-password/test-token", config.authUrl);
    source.searchParams.set("callbackURL", `${origin}/reset-password`);
    const result = new URL(portalPasswordResetUrl(source.href, config));
    assert.equal(result.origin, origin);
    assert.equal(result.pathname, source.pathname);
    assert.equal(result.search, source.search);
  }
  for (const callback of [
    "https://attacker.example.test/reset-password",
    "https://student.example.test.attacker.example/reset-password",
    "https://user:password@student.example.test/reset-password",
    "http://student.example.test/reset-password",
    "/reset-password",
    "",
  ]) {
    const source = new URL("/api/auth/reset-password/test-token", config.authUrl);
    source.searchParams.set("callbackURL", callback);
    assert.throws(() => portalPasswordResetUrl(source.href, config), /trusted portal/);
  }
  const foreign = "https://other.example.test/api/auth/reset-password/token?callbackURL=https%3A%2F%2Fstudent.example.test%2Freset-password";
  assert.throws(() => portalPasswordResetUrl(foreign, config), /trusted portal/);
  assert.equal(portalPasswordResetUrl(foreign, { ...config, portalProxySecret: undefined }), foreign);
});
