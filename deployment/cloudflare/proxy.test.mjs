import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import worker, { proxyRequest, renderOrigin } from "./proxy.mjs";

const origin = "https://otp-slate-student.pages.dev";
const apiOrigin = "https://otp-slate-api.onrender.com";
const proxySecret = "test-only-proxy-secret-not-for-deployment";
const env = { API_ORIGIN: apiOrigin, PORTAL_PROXY_SECRET: proxySecret };

test("deployment invokes Functions only for API paths; page and asset requests stay static", async () => {
  const routes = JSON.parse(await readFile(new URL("./_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes, { version: 1, include: ["/api", "/api/*"], exclude: [] });
  for (const path of ["/", "/login", "/courses/specific-course", "/assets/main.js", "/apiary"]) {
    const request = new Request(origin + path);
    const response = await worker.fetch(request, {
      ASSETS: { fetch: input => {
        assert.equal(input, request);
        return new Response("asset");
      } },
    }, { waitUntil() {} });
    assert.equal(await response.text(), "asset");
  }
});

test("only a bare HTTPS Render service origin can be configured", () => {
  assert.equal(renderOrigin(apiOrigin), apiOrigin);
  assert.equal(renderOrigin(apiOrigin + "/"), apiOrigin);
  for (const invalid of [undefined, "", " https://app.onrender.com", "http://app.onrender.com",
    "https://app.onrender.com.evil.test", "https://evil.test", "https://127.0.0.1",
    "https://app.onrender.com:8443", "https://user:secret@app.onrender.com",
    "https://app.onrender.com/api", "https://app.onrender.com?target=evil", "https://app.onrender.com#x"]) {
    assert.equal(renderOrigin(invalid), null);
  }
});

test("missing configuration and foreign browser origins fail before sending any credentials", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(); };
  assert.equal((await proxyRequest(new Request(origin + "/api/v1/me"), {}, fetcher)).status, 503);
  for (const secret of [undefined, "", "a".repeat(31), "\n" + "a".repeat(32), " " + "a".repeat(32)]) {
    const response = await proxyRequest(new Request(origin + "/api/v1/me"),
      { ...env, PORTAL_PROXY_SECRET: secret }, fetcher);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), '{"message":"The API connection is not configured."}');
  }
  for (const requestOrigin of ["https://evil.test", "null", "https://otp-slate-admin.pages.dev"]) {
    const response = await proxyRequest(new Request(origin + "/api/auth/sign-in/email", {
      method: "POST", headers: { Origin: requestOrigin, Cookie: "session=private" },
    }), env, fetcher);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("POST streams the body, preserves auth and CSRF headers, and overwrites spoofed proxy headers", async () => {
  const body = JSON.stringify({ email: "student@example.test", password: "test-only-password" });
  const request = new Request(origin + "/api/auth/sign-in/email?portal=student", {
    method: "POST", body, headers: {
      Origin: origin, Referer: origin + "/login", Cookie: "session=test-cookie",
      Authorization: "Bearer test-only", "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.8", "X-Forwarded-For": "spoofed",
      "X-Forwarded-Host": "evil.test", "X-Forwarded-Proto": "http",
      "CF-Ray": "incoming-ray", "CF-Connecting-IPv6": "2001:db8::1",
      "X-Slate-Proxy-Key": "client-supplied-fake-key", "X-Slate-Client-IP": "198.51.100.10",
      "X-Real-IP": "198.51.100.11", "True-Client-IP": "198.51.100.12",
      Forwarded: "host=evil.test", Connection: "x-untrusted-hop", "x-untrusted-hop": "remove-me",
    },
  });
  const response = await proxyRequest(request, env, async (url, init) => {
    assert.equal(url, apiOrigin + "/api/auth/sign-in/email?portal=student");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("origin"), origin);
    assert.equal(init.headers.get("referer"), origin + "/login");
    assert.equal(init.headers.get("cookie"), "session=test-cookie");
    assert.equal(init.headers.get("authorization"), "Bearer test-only");
    assert.equal(init.headers.get("x-forwarded-for"), null);
    assert.equal(init.headers.get("x-slate-client-ip"), "203.0.113.8");
    assert.equal(init.headers.get("x-slate-proxy-key"), proxySecret);
    assert.equal(init.headers.get("x-forwarded-host"), "otp-slate-student.pages.dev");
    assert.equal(init.headers.get("x-forwarded-proto"), "https");
    assert.equal(init.headers.get("forwarded"), null);
    assert.equal(init.headers.get("x-real-ip"), null);
    assert.equal(init.headers.get("true-client-ip"), null);
    assert.equal([...init.headers.keys()].some(name => name.startsWith("cf-")), false);
    assert.equal(init.headers.get("x-untrusted-hop"), null);
    assert.equal(await new Response(init.body).text(), body);
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("never falls back to caller-supplied IP headers when Cloudflare has not supplied an address", async () => {
  const request = new Request(origin + "/api/v1/me", { headers: {
    "X-Slate-Client-IP": "198.51.100.10", "X-Forwarded-For": "198.51.100.11", "X-Real-IP": "198.51.100.12",
  } });
  await proxyRequest(request, env, async (_url, init) => {
    assert.equal(init.headers.get("x-slate-client-ip"), null);
    assert.equal(init.headers.get("x-forwarded-for"), null);
    assert.equal(init.headers.get("x-real-ip"), null);
    assert.equal(init.headers.get("x-slate-proxy-key"), proxySecret);
    return new Response(null, { status: 204 });
  });
});

test("keeps multiple auth cookies separate, host-only, and prevents intermediary caching", async () => {
  const cookies = [
    "__Secure-better-auth.session_token=test; Path=/; Domain=.example.test; Secure; HttpOnly; SameSite=Lax",
    "__Secure-better-auth.dont_remember=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly",
  ];
  const headers = new Headers({
    "Cache-Control": "public, max-age=3600",
    "X-Slate-Proxy-Key": proxySecret,
    "X-Slate-Client-IP": "203.0.113.8",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  const response = await proxyRequest(new Request(origin + "/api/auth/sign-in/email"), env,
    async () => new Response("ok", { headers }));
  assert.deepEqual(response.headers.getSetCookie(), [cookies[0].replace("; Domain=.example.test", ""), cookies[1]]);
  assert.equal(response.headers.get("x-slate-proxy-key"), null);
  assert.equal(response.headers.get("x-slate-client-ip"), null);
  for (const name of ["cache-control", "cdn-cache-control", "cloudflare-cdn-cache-control"]) {
    assert.equal(response.headers.get(name), "no-store");
  }
});

test("manual redirects stay on the current portal and never follow a credential-bearing request", async () => {
  for (const location of [apiOrigin + "/api/auth/callback?code=sample", "/reset-password?token=sample", origin + "/login"]) {
    let calls = 0;
    const response = await proxyRequest(new Request(origin + "/api/auth/reset-password", {
      headers: { Cookie: "session=secret" },
    }), env, async (_url, init) => {
      calls++;
      assert.equal(init.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: location } });
    });
    assert.equal(calls, 1);
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).origin, origin);
  }
  for (const location of ["https://evil.test", "//evil.test/path", "javascript:alert(1)",
    "https://user:password@otp-slate-api.onrender.com/private"]) {
    const response = await proxyRequest(new Request(origin + "/api/auth/callback"), env,
      async () => new Response(null, { status: 302, headers: { Location: location } }));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("location"), null);
  }
});

test("upstream failures are generic JSON without leaking environment or request credentials", async () => {
  const response = await proxyRequest(new Request(origin + "/api/v1/me"), env,
    async () => { throw new Error("private-token and private-infrastructure-name"); });
  assert.equal(response.status, 502);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const text = await response.text();
  assert.match(text, /temporarily unavailable/);
  assert.doesNotMatch(text, /private-token|private-infrastructure-name/);
});

test("preserves denied API responses and HEAD semantics instead of serving the SPA", async () => {
  for (const status of [401, 403, 429]) {
    const response = await proxyRequest(new Request(origin + "/api/v1/courses"), env,
      async () => Response.json({ message: "Not allowed" }, { status, headers: { "Retry-After": "60" } }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { message: "Not allowed" });
    assert.equal(response.headers.get("retry-after"), "60");
  }
  const response = await proxyRequest(new Request(origin + "/api", { method: "HEAD" }), env,
    async (_url, init) => { assert.equal(init.body, undefined); return new Response(null, { status: 204 }); });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});
