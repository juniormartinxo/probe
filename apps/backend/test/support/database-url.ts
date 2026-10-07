import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const localEnvFile = new URL("../../../../.env.local", import.meta.url);

// Mesma precedência do Makefile e do Vite: ambiente > .env.local da raiz > padrão.
function localEnv(): Record<string, string | undefined> {
  return existsSync(localEnvFile) ? parseEnv(readFileSync(localEnvFile, "utf8")) : {};
}

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const port = process.env.PROBE_DB_PORT ?? localEnv().PROBE_DB_PORT ?? "5434";
  return `postgres://probe:probe@localhost:${port}/probe_test`;
}
