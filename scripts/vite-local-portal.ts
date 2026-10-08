import type { Plugin } from "vite";

const localPortals = new Map([
  ["student.localhost", 5173],
  ["admin.localhost", 5174],
  ["organization.localhost", 5175],
]);

/** Preserve the requested portal and correct its local development port. */
export function localPortal(hostname: string): Plugin {
  return {
    name: "slate-local-portal",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const suppliedHost = request.headers.host?.split(":")[0].toLowerCase();
        const targetPort = suppliedHost && localPortals.get(suppliedHost);
        if (
          request.method !== "GET" ||
          !suppliedHost ||
          !targetPort ||
          suppliedHost === hostname ||
          request.url?.startsWith("/api/")
        )
          return next();
        response.writeHead(302, {
          Location: `http://${suppliedHost}:${targetPort}${request.url || "/"}`,
          "Cache-Control": "no-store",
        });
        response.end();
      });
    },
  };
}
