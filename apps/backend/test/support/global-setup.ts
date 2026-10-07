import pg from "pg";
import { createDatabase } from "../../src/db/database.ts";
import { migrateToLatest } from "../../src/db/migrator.ts";
import { testDatabaseUrl } from "./database-url.ts";

// Cria o banco de teste no mesmo serviço PostgreSQL, se faltar, e aplica as migrations.
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const testDatabase = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query("select 1 from pg_database where datname = $1", [testDatabase]);
    if (existing.rowCount === 0) {
      await admin.query(`create database "${testDatabase.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const db = createDatabase(url.toString());
  try {
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
}
