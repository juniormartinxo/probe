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

  // Sem limite, uma porta sem serviço pode deixar a conexão pendurada (acontece no WSL).
  const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  await admin.connect().catch((error: unknown) => {
    throw new Error(`Banco de teste inacessível em ${url.host}. O serviço db está no ar (make test sobe ele)?`, {
      cause: error,
    });
  });
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
