import { Migrator, type Migration, type MigrationResultSet } from "kysely/migration";
import type { Db } from "./database.ts";
import * as m0001 from "./migrations/0001_processes.ts";
import * as m0002 from "./migrations/0002_conversations.ts";
import * as m0003 from "./migrations/0003_ai_requests.ts";
import * as m0004 from "./migrations/0004_problem_statements.ts";
import * as m0005 from "./migrations/0005_blocks.ts";
import * as m0006 from "./migrations/0006_settings.ts";
import * as m0007 from "./migrations/0007_block_syntheses.ts";

// Lista explícita, em ordem: o nome é a chave gravada na tabela de controle do Kysely.
const migrations: Record<string, Migration> = {
  "0001_processes": m0001,
  "0002_conversations": m0002,
  "0003_ai_requests": m0003,
  "0004_problem_statements": m0004,
  "0005_blocks": m0005,
  "0006_settings": m0006,
  "0007_block_syntheses": m0007,
};

function migrator(db: Db): Migrator {
  return new Migrator({ db, provider: { getMigrations: async () => migrations } });
}

function reportResults({ error, results }: MigrationResultSet): void {
  if (!error && results?.length === 0) console.log("Nenhuma migration a executar.");
  for (const result of results ?? []) {
    console.log(`${result.direction} ${result.migrationName}: ${result.status}`);
  }
  if (error) throw error;
}

export async function migrateToLatest(db: Db): Promise<void> {
  reportResults(await migrator(db).migrateToLatest());
}

export async function migrateDown(db: Db): Promise<void> {
  reportResults(await migrator(db).migrateDown());
}
