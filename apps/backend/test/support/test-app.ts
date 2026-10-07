import { sql } from "kysely";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { createDatabase, type Db } from "../../src/db/database.ts";
import { testDatabaseUrl } from "./database-url.ts";

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const db = createDatabase(testDatabaseUrl());
  const app = buildApp({ db });
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
  await sql`truncate table processes cascade`.execute(db);
}
