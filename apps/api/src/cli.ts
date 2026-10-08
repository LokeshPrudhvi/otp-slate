import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { loadConfig, workspaceRoot } from "./config.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { createAuth } from "./auth.js";
import { members, audit } from "./schema.js";

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();
const connection = await connectDatabase(
  config.migrationUrl || config.databaseUrl,
);
try {
  if (command === "migrate") {
    await migrateDatabase(connection.db);
    console.log("Foundation migration applied.");
  } else if (command === "seed-development" || command === "seed-demo") {
    if (config.production || !connection.local)
      throw new Error(
        "Development fixtures are allowed only in local PGlite development.",
      );
    await migrateDatabase(connection.db);
    const auth = createAuth(connection.db, config, connection.local);
    if (command === "seed-demo") {
      const { seedDemo } = await import("./demo-seed.js");
      await seedDemo(connection.db, auth);
    } else {
      const { seedDevelopment } = await import("./dev-seed.js");
      await seedDevelopment(connection.db, auth);
    }
  } else if (command === "bootstrap") {
    if (connection.local) await migrateDatabase(connection.db);
    const email = z.email().parse(args[args.indexOf("--email") + 1]);
    const name = args.includes("--name")
      ? args[args.indexOf("--name") + 1]
      : "Platform Admin";
    const password = randomBytes(24).toString("base64url") + "!a1";
    const auth = createAuth(connection.db, config, connection.local);
    const identity = await auth.api.createUser({
      body: { email, name, password, role: "admin" },
    });
    await scoped(connection.db, { platform: true }, async (tx) => {
      const [member] = await tx
        .insert(members)
        .values({ authUserId: identity.user.id, role: "platform_admin" })
        .returning();
      await tx.insert(audit).values({
        actorId: member.id,
        action: "platform.bootstrap",
        resourceId: member.id,
      });
    });
    mkdirSync(resolve(workspaceRoot, ".local"), { recursive: true });
    const path = resolve(workspaceRoot, `.local/bootstrap-${Date.now()}.txt`);
    writeFileSync(
      path,
      `Platform Admin\nEmail: ${email}\nTemporary password: ${password}\nChange the password after first login. Delete this file after distribution.\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      `Platform account created. One-time credentials saved privately to ${path}`,
    );
  } else
    throw new Error(
      'Use migrate or bootstrap --email owner@example.com [--name "Platform Admin"].',
    );
} finally {
  await connection.close();
}
