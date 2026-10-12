// Shared Pages advanced-mode worker. Only /api routes invoke it; static assets
// and React Router navigation use Pages' built-in static/SPA handling.
const HOP_HEADERS = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
];

export function renderOrigin(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.pathname !== "/" || url.search || url.hash ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com$/.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function errorResponse(status, message) {
  return Response.json({ message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function removeHopHeaders(headers) {
  for (const name of (headers.get("connection") || "").split(",")) {
    if (name.trim()) headers.delete(name.trim());
  }
  for (const name of HOP_HEADERS) headers.delete(name);
}

function cookieValues(headers) {
  // Workers exposes getAll; Node's Fetch implementation exposes getSetCookie.
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  if (typeof headers.getAll === "function") return headers.getAll("Set-Cookie");
  throw new Error("Separate Set-Cookie headers are required.");
}

export async function proxyRequest(request, env, fetchUpstream = fetch) {
  const portal = new URL(request.url);
  if (portal.pathname !== "/api" && !portal.pathname.startsWith("/api/")) {
    return env.ASSETS.fetch(request);
  }
  const apiOrigin = renderOrigin(env.API_ORIGIN);
  const proxySecret = env.PORTAL_PROXY_SECRET;
  if (!apiOrigin || typeof proxySecret !== "string" ||
      !/^[\x21-\x7e]{32,}$/.test(proxySecret)) {
    return errorResponse(503, "The API connection is not configured.");
  }

  // Never turn an untrusted browser Origin into a trusted portal Origin. The
  // API also checks its explicit production TRUSTED_ORIGINS allowlist.
  const origin = request.headers.get("origin");
  if (origin && origin !== portal.origin) {
    return errorResponse(403, "This origin cannot use the portal API.");
  }

  const target = new URL(apiOrigin);
  target.pathname = portal.pathname;
  target.search = portal.search;
  const headers = new Headers(request.headers);
  removeHopHeaders(headers);
  headers.delete("host");
  headers.delete("forwarded");
  headers.delete("x-real-ip");
  headers.delete("true-client-ip");
  headers.delete("x-slate-proxy-key");
  headers.delete("x-slate-client-ip");
  for (const name of [...headers.keys()]) {
    if (name.startsWith("x-forwarded-") || name.startsWith("cf-")) headers.delete(name);
  }
  headers.set("x-forwarded-host", portal.host);
  headers.set("x-forwarded-proto", portal.protocol.slice(0, -1));
  // Cloudflare supplies this address at the edge. Never substitute a client
  // forwarding header; Render authenticates this proxy key before using it.
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.set("x-slate-client-ip", clientIp);
  headers.set("x-slate-proxy-key", proxySecret);
  headers.set("cache-control", "no-store");

  try {
    const upstream = await fetchUpstream(target.href, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      // Streaming bodies use half-duplex in Node tests; Workers ignores this
      // standard Fetch extension and streams the body without buffering it.
      duplex: "half",
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    removeHopHeaders(responseHeaders);
    responseHeaders.delete("x-slate-proxy-key");
    responseHeaders.delete("x-slate-client-ip");
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("cdn-cache-control", "no-store");
    responseHeaders.set("cloudflare-cdn-cache-control", "no-store");
    responseHeaders.delete("set-cookie");
    for (const cookie of cookieValues(upstream.headers)) {
      // A session belongs to the current portal, even if the upstream server
      // accidentally supplies a Domain attribute. Never share across portals.
      responseHeaders.append("set-cookie", cookie.replace(/;\s*Domain\s*=[^;]*/gi, ""));
    }

    const location = upstream.headers.get("location");
    if (location) {
      const destination = new URL(location, target);
      if (destination.username || destination.password ||
          ![apiOrigin, portal.origin].includes(destination.origin)) {
        return errorResponse(502, "The API returned an unsupported redirect.");
      }
      // Auth callbacks must return through this portal so its own host-only
      // session cookie is used. Never follow a redirect carrying credentials.
      destination.protocol = portal.protocol;
      destination.host = portal.host;
      responseHeaders.set("location", destination.href);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    // Do not expose Render responses, credentials, or infrastructure errors.
    return errorResponse(502, "The API is temporarily unavailable. Please retry shortly.");
  }
}

export default {
  fetch(request, env) {
    return proxyRequest(request, env);
  },
};
