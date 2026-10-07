import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = buildApp(
  { token: config.token, defaultTimeoutMs: config.timeoutMs, cliEnv: config.cliEnv },
  { logger: true },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: config.host, port: config.port });
