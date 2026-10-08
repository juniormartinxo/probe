import { sql, type Kysely } from "kysely";

// Restrição e Preferência têm a mesma forma e tabelas próprias: são itens distintos do Processo, e o
// que mais adiante se avalia contra uma Restrição não pode apontar para uma Preferência.
async function createItems(db: Kysely<unknown>, table: "constraints" | "preferences"): Promise<void> {
  await db.schema
    .createTable(table)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("statement", "text", (col) => col.notNull().check(sql`btrim(statement) <> ''`))
    // A que a condição se aplica e em que unidade ela é medida, quando isso precisa ser dito.
    .addColumn("scope", "text", (col) => col.check(sql`scope is null or btrim(scope) <> ''`))
    .addColumn("unit", "text", (col) => col.check(sql`unit is null or btrim(unit) <> ''`))
    .addColumn("registered_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    // Retirada pelo usuário: deixa de valer e continua no histórico.
    .addColumn("withdrawn_at", "timestamptz")
    .execute();
  await db.schema.createIndex(`${table}_process`).on(table).column("process_id").execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await createItems(db, "constraints");
  await createItems(db, "preferences");

  // Ausência registrada: o usuário disse explicitamente que não há o que o Ponto pede (prazo,
  // sistemas). Conta como cobertura do Ponto, sem Bloco e sem justificativa.
  await sql`alter table stage_point_coverage drop constraint stage_point_coverage_status_check`.execute(db);
  await sql`alter table stage_point_coverage add constraint stage_point_coverage_status_check
    check (status in ('covered', 'inapplicable', 'absent'))`.execute(db);

  // As Restrições e Preferências que valiam quando o Jev avaliou a Etapa.
  await db.schema
    .alterTable("stage_assessments")
    .addColumn("analyzed_constraint_ids", sql`uuid[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn("analyzed_preference_ids", sql`uuid[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("stage_assessments").dropColumn("analyzed_preference_ids").dropColumn("analyzed_constraint_ids").execute();
  await sql`delete from stage_point_coverage where status = 'absent'`.execute(db);
  await sql`alter table stage_point_coverage drop constraint stage_point_coverage_status_check`.execute(db);
  await sql`alter table stage_point_coverage add constraint stage_point_coverage_status_check
    check (status in ('covered', 'inapplicable'))`.execute(db);
  await db.schema.dropTable("preferences").execute();
  await db.schema.dropTable("constraints").execute();
}
