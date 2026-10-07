import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDatabase } from "./db/database.ts";

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = buildApp({ db }, { logger: true });

async function shutdown(): Promise<void> {
  await app.close();
  await db.destroy();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: config.host, port: config.port });
