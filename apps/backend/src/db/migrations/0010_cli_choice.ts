import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // CLI das novas solicitações e um modelo para cada CLI; sem modelo, a CLI ainda não pode ser
  // usada. O claude continua com o modelo que já tinha.
  await db.schema
    .alterTable("settings")
    .addColumn("cli", "text", (col) => col.notNull().defaultTo("claude").check(sql`cli in ('claude', 'codex', 'grok', 'agy')`))
    .addColumn("codex_model", "text")
    .addColumn("grok_model", "text")
    .addColumn("agy_model", "text")
    .execute();
  await db.schema.alterTable("settings").alterColumn("claude_model", (col) => col.dropNotNull()).execute();
  await db.schema
    .alterTable("settings")
    .addCheckConstraint(
      "settings_cli_model",
      sql`case cli when 'claude' then claude_model when 'codex' then codex_model when 'grok' then grok_model else agy_model end is not null`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("settings").dropConstraint("settings_cli_model").execute();
  await sql`update settings set claude_model = coalesce(claude_model, 'sonnet')`.execute(db);
  await db.schema.alterTable("settings").alterColumn("claude_model", (col) => col.setNotNull()).execute();
  await db.schema
    .alterTable("settings")
    .dropColumn("agy_model")
    .dropColumn("grok_model")
    .dropColumn("codex_model")
    .dropColumn("cli")
    .execute();
}
