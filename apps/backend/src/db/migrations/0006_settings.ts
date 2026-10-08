import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Configurações não sensíveis, numa única linha. Segredos (credencial do executor, chave do Jev)
  // ficam no ambiente do backend, nunca aqui. Sem linha, valem os padrões do ambiente.
  await db.schema
    .createTable("settings")
    .addColumn("id", "boolean", (col) => col.primaryKey().defaultTo(true).check(sql`id`))
    .addColumn("claude_model", "text", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("settings").execute();
}
