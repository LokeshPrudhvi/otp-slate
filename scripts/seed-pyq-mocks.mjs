// Explicit, repeatable demo-content seed. Does not overwrite existing guides or change permissions.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadConfig } from "../apps/api/dist/config.js";
import { connectDatabase, scoped } from "../apps/api/dist/database.js";
import { placementInput } from "../apps/api/dist/placement.js";
import { placementResources } from "../apps/api/dist/schema.js";
const rows = JSON.parse(
  await readFile(new URL("./pyq-mock-data.json", import.meta.url), "utf8"),
);
const connection = await connectDatabase(loadConfig().databaseUrl);
try {
  const result = await scoped(connection.db, { platform: true }, async (tx) => {
    const saved = [];
    for (const raw of rows) {
      const input = placementInput.parse(raw);
      const hex = createHash("sha256")
        .update(`slate-pyq-mock:${input.title}`)
        .digest("hex");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      saved.push(
        ...(await tx
          .insert(placementResources)
          .values({ id, ...input })
          .onConflictDoNothing({ target: placementResources.id })
          .returning({ id: placementResources.id })),
      );
    }
    return saved;
  });
  console.log(
    `Created ${result.length} clearly labelled mock company guides. Existing resources and student permissions were preserved.`,
  );
} finally {
  await connection.close();
}
