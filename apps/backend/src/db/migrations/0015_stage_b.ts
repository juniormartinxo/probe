import { sql, type Kysely } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

const filled = (column: string) => sql`btrim(${sql.ref(column)}) <> ''`;

const operations = (list: string[]) => sql.join(list.map((operation) => sql.lit(operation)));

const before = ["refine_problem_statement", "generate_block", "synthesize_block", "formulate_resolution_question", "propose_options"];

export async function up(db: Kysely<unknown>): Promise<void> {
  // A Recomendação que a IA faz na Etapa B.
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in (${operations([...before, "recommend_option"])}))`.execute(db);

  // Linha da matriz qualitativa de uma Opção, escrita pelo usuário (do zero ou a partir da linha que
  // uma Recomendação sugeriu). Sem pontuação: só texto. Reescrever grava uma linha nova; a mais
  // recente vale e as anteriores ficam no histórico.
  await db.schema
    .createTable("option_comparisons")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("option_id", "uuid", (col) => col.notNull().references("options.id").onDelete("cascade"))
    .addColumn("gains", "text", (col) => col.notNull().check(filled("gains")))
    .addColumn("losses", "text", (col) => col.notNull().check(filled("losses")))
    .addColumn("effort", "text", (col) => col.notNull().check(filled("effort")))
    .addColumn("scalability", "text", (col) => col.notNull().check(filled("scalability")))
    .addColumn("maintenance", "text", (col) => col.notNull().check(filled("maintenance")))
    .addColumn("reversibility", "text", (col) => col.notNull().check(filled("reversibility")))
    .addColumn("recommendation_id", "uuid", (col) => col.references("ai_requests.id").onDelete("cascade"))
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await sql`create index option_comparisons_option on option_comparisons (option_id, recorded_at)`.execute(db);
  await forbidUpdate("option_comparisons").execute(db);

  // Escolha: a Opção que o usuário selecionou na Etapa B. Trocar de Escolha grava uma nova; a mais
  // recente vale e as anteriores ficam no histórico.
  await db.schema
    .createTable("chosen_options")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("option_id", "uuid", (col) => col.notNull().references("options.id").onDelete("cascade"))
    .addColumn("chosen_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await sql`create index chosen_options_process on chosen_options (process_id, chosen_at)`.execute(db);
  await forbidUpdate("chosen_options").execute(db);

  // O motivo com que a Escolha descarta cada outra Opção viável.
  await db.schema
    .createTable("choice_discards")
    .addColumn("chosen_option_id", "uuid", (col) => col.notNull().references("chosen_options.id").onDelete("cascade"))
    .addColumn("option_id", "uuid", (col) => col.notNull().references("options.id").onDelete("cascade"))
    .addColumn("reason", "text", (col) => col.notNull().check(filled("reason")))
    .addPrimaryKeyConstraint("choice_discards_pk", ["chosen_option_id", "option_id"])
    .execute();
  await forbidUpdate("choice_discards").execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("choice_discards").execute();
  await db.schema.dropTable("chosen_options").execute();
  await db.schema.dropTable("option_comparisons").execute();
  await sql`delete from ai_requests where operation = 'recommend_option'`.execute(db);
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in (${operations(before)}))`.execute(db);
}
