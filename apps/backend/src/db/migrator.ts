import { Migrator, type Migration, type MigrationResultSet } from "kysely/migration";
import type { Db } from "./database.ts";
import * as m0001 from "./migrations/0001_processes.ts";
import * as m0002 from "./migrations/0002_conversations.ts";

// Lista explícita, em ordem: o nome é a chave gravada na tabela de controle do Kysely.
const migrations: Record<string, Migration> = {
  "0001_processes": m0001,
  "0002_conversations": m0002,
};

function migrator(db: Db): Migrator {
  return new Migrator({ db, provider: { getMigrations: async () => migrations } });
}

function unwrap({ error, results }: MigrationResultSet): void {
  if (!error && results?.length === 0) console.log("Nenhuma migration a executar.");
  for (const result of results ?? []) {
    console.log(`${result.direction} ${result.migrationName}: ${result.status}`);
  }
  if (error) throw error;
}

export async function migrateToLatest(db: Db): Promise<void> {
  unwrap(await migrator(db).migrateToLatest());
}

export async function migrateDown(db: Db): Promise<void> {
  unwrap(await migrator(db).migrateDown());
}
