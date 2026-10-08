import { sql, type Kysely } from "kysely";

// Recusa qualquer alteração: Bloco e Pergunta ficam como foram apresentados, e uma Versão de
// resposta, como foi registrada.
const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Cada Processo segue a versão da lista de Pontos da etapa com que foi criado.
  await db.schema
    .alterTable("processes")
    .addColumn("stage_points_version", "integer", (col) => col.notNull().defaultTo(1).check(sql`stage_points_version > 0`))
    .execute();
  await db.schema.alterTable("processes").alterColumn("stage_points_version", (col) => col.dropDefault()).execute();

  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block'))`.execute(db);

  await sql`create function probe_forbid_update() returns trigger language plpgsql as $$
    begin raise exception '% não pode ser alterado depois de gravado', tg_table_name; end $$`.execute(db);

  // Um Bloco nasce da tentativa concluída que o gerou.
  await db.schema
    .createTable("blocks")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("number", "integer", (col) => col.notNull())
    .addColumn("stage", "text", (col) => col.notNull().check(sql`stage in ('P', 'R', 'O', 'B', 'E')`))
    .addColumn("attempt_id", "uuid", (col) => col.notNull().unique().references("ai_request_attempts.id"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addUniqueConstraint("blocks_number", ["process_id", "number"])
    .execute();
  await forbidUpdate("blocks").execute(db);

  await db.schema
    .createTable("questions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("block_id", "uuid", (col) => col.notNull().references("blocks.id").onDelete("cascade"))
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("wording", "text", (col) => col.notNull())
    .addColumn("subject", "text", (col) => col.notNull())
    .addColumn("context_relation", "text", (col) => col.notNull())
    .addColumn("rationale", "text")
    // Chaves dos Pontos da etapa que a Pergunta serve, na versão da lista do Processo.
    .addColumn("stage_points", sql`text[]`, (col) => col.notNull().check(sql`cardinality(stage_points) > 0`))
    .addColumn("answer_type", "text", (col) =>
      col.notNull().check(sql`answer_type in ('single_choice', 'multiple_choice', 'free_text')`),
    )
    .addColumn("choices", sql`text[]`, (col) => col.notNull())
    .addCheckConstraint(
      "questions_choices",
      sql`(answer_type = 'free_text' and cardinality(choices) = 0) or (answer_type <> 'free_text' and cardinality(choices) >= 2)`,
    )
    .addUniqueConstraint("questions_position", ["block_id", "position"])
    .execute();
  await forbidUpdate("questions").execute(db);

  // Uma resposta é o conjunto das Versões da sua Pergunta; a de maior número é a que vale.
  await db.schema
    .createTable("answer_versions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("question_id", "uuid", (col) => col.notNull().references("questions.id").onDelete("cascade"))
    .addColumn("number", "integer", (col) => col.notNull())
    // Índices das alternativas escolhidas, ou o texto livre; nunca os dois.
    .addColumn("selected_choices", sql`integer[]`)
    .addColumn("text", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint("answer_versions_value", sql`(selected_choices is null) <> (text is null)`)
    .addUniqueConstraint("answer_versions_number", ["question_id", "number"])
    .execute();
  await forbidUpdate("answer_versions").execute(db);

  // Rascunho de resposta: o que o usuário preencheu e ainda não salvou como Versão, incompleto ou
  // não. Guarda a Versão sobre a qual a alteração começou.
  await db.schema
    .createTable("answer_drafts")
    .addColumn("question_id", "uuid", (col) => col.primaryKey().references("questions.id").onDelete("cascade"))
    .addColumn("based_on_version_id", "uuid", (col) => col.references("answer_versions.id").onDelete("cascade"))
    .addColumn("selected_choices", sql`integer[]`)
    .addColumn("text", "text")
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("answer_drafts").execute();
  await db.schema.dropTable("answer_versions").execute();
  await db.schema.dropTable("questions").execute();
  await db.schema.dropTable("blocks").execute();
  await sql`drop function probe_forbid_update`.execute(db);
  await sql`delete from ai_requests where operation = 'generate_block'`.execute(db);
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement'))`.execute(db);
  await db.schema.alterTable("processes").dropColumn("stage_points_version").execute();
}
