import { loadConfig } from "./config.js";
import {
  checkProductionRole,
  connectDatabase,
  migrateDatabase,
} from "./database.js";
import { createAuth } from "./auth.js";
import { createApplication } from "./app.js";
import { SlateService } from "./service.js";
import { metaPhoneSender } from "./providers.js";
import { startMailWorker } from "./mail-worker.js";

const config = loadConfig();
const connection = await connectDatabase(config.databaseUrl);
if (connection.local) await migrateDatabase(connection.db);
if (config.production) await checkProductionRole(connection.db);
const service = new SlateService(
  connection.db,
  createAuth(connection.db, config, connection.local),
  config,
  metaPhoneSender(),
  connection.local,
);
const app = await createApplication(service);
const stopMail = startMailWorker(connection.db, config.secret);
await app.listen(config.port, config.production ? "0.0.0.0" : "127.0.0.1");
console.log(
  `OTP Slate API ready at http://127.0.0.1:${config.port} (${connection.local ? "local PostgreSQL development database" : "PostgreSQL"}).`,
);
async function stop() {
  stopMail();
  await app.close();
  await connection.close();
  process.exit(0);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
