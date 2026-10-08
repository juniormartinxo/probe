import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDatabase } from "./db/database.ts";
import { createExecutorAssistant } from "./modules/ai/executor-assistant.ts";

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const assistant = createExecutorAssistant({ url: config.executorUrl, token: config.executorToken });
const app = buildApp({ db, assistant, aiModel: config.aiModel }, { logger: true });

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
