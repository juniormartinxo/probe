import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDatabase } from "./db/database.ts";
import { createExecutorAssistant } from "./modules/ai/executor-assistant.ts";
import { createJevAssessor, JEV_ENDPOINT } from "./modules/assessments/jev-assessor.ts";

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const assistant = createExecutorAssistant({
  url: config.executorUrl,
  token: config.executorToken,
  deadlineMs: config.executorDeadlineMs,
});
const assessor = createJevAssessor({
  url: JEV_ENDPOINT,
  apiKey: config.jevApiKey,
  model: config.jevModel,
  timeoutMs: config.jevTimeoutMs,
});
const app = buildApp({ db, assistant, assessor, defaultAiModel: config.aiModel }, { logger: true });

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
