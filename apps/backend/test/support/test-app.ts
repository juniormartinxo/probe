import { sql } from "kysely";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { createDatabase, type Db } from "../../src/db/database.ts";
import type { Assistant } from "../../src/modules/ai/assistant.ts";
import type { Assessor } from "../../src/modules/assessments/assessor.ts";
import { testDatabaseUrl } from "./database-url.ts";
import { FakeAssessor } from "./fake-assessor.ts";
import { FakeAssistant } from "./fake-assistant.ts";

export const TEST_MODEL = "modelo-de-teste";

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close(): Promise<void>;
}

export async function createTestApp(options: { assistant?: Assistant; assessor?: Assessor } = {}): Promise<TestApp> {
  const db = createDatabase(testDatabaseUrl());
  const app = buildApp({
    db,
    assistant: options.assistant ?? new FakeAssistant(),
    assessor: options.assessor ?? new FakeAssessor(),
    defaultAiModel: TEST_MODEL,
  });
  await app.ready();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

export async function resetDatabase(db: Db): Promise<void> {
  await sql`truncate table processes, settings cascade`.execute(db);
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Condição não atingida a tempo.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
