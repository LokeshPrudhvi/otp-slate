import { copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const portals = {
  student: { workspace: "@slate/student", folder: "student" },
  admin: { workspace: "@slate/platform-admin", folder: "platform-admin" },
  organization: { workspace: "@slate/organization-admin", folder: "organization-admin" },
};
const [selection = "all", ...flags] = process.argv.slice(2);
if ((selection !== "all" && !Object.hasOwn(portals, selection)) ||
    flags.some(flag => flag !== "--skip-build")) {
  console.error("Usage: node scripts/cloudflare-build.mjs [all|student|admin|organization] [--skip-build]");
  process.exit(1);
}
const selected = selection === "all" ? Object.values(portals) : [portals[selection]];
function run(args) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: root, stdio: "inherit", env: process.env,
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
if (!flags.includes("--skip-build")) {
  run(["run", "build:packages"]);
  for (const portal of selected) run(["run", "build", "-w", portal.workspace]);
}
for (const portal of selected) {
  const output = resolve(root, "apps", portal.folder, "dist");
  await access(resolve(output, "index.html"));
  await copyFile(resolve(root, "deployment/cloudflare/proxy.mjs"), resolve(output, "_worker.js"));
  await copyFile(resolve(root, "deployment/cloudflare/_routes.json"), resolve(output, "_routes.json"));
  console.log(`Cloudflare Pages output ready: apps/${portal.folder}/dist`);
}
