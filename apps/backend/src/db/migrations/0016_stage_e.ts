import { sql, type Kysely } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

const filled = (column: string) => sql`btrim(${sql.ref(column)}) <> ''`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Elemento do Plano de execução (primeiro passo, critério de sucesso, plano B), escrito pelo usuário
  // na Etapa E, pela chave do Ponto que ele cobre. Reescrever grava um novo; o mais recente vale e os
  // anteriores ficam no histórico.
  await db.schema
    .createTable("execution_plan_elements")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("element", "text", (col) => col.notNull().check(filled("element")))
    .addColumn("text", "text", (col) => col.notNull().check(filled("text")))
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await sql`create index execution_plan_elements_process on execution_plan_elements (process_id, element, recorded_at)`.execute(db);
  await forbidUpdate("execution_plan_elements").execute(db);

  // Avaliação de compatibilidade: o Jev julga se um elemento do plano é compatível com a Escolha em
  // vigor. Uma por chamada, concluída ou falha; fica como foi gravada.
  await db.schema
    .createTable("plan_assessments")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("element_id", "uuid", (col) => col.notNull().references("execution_plan_elements.id").onDelete("cascade"))
    .addColumn("chosen_option_id", "uuid", (col) => col.notNull().references("chosen_options.id").onDelete("cascade"))
    .addColumn("status", "text", (col) => col.notNull().check(sql`status in ('completed', 'failed')`))
    .addColumn("requested_model", "text", (col) => col.notNull())
    .addColumn("jev_model", "text")
    .addColumn("rubric_revision", "text", (col) => col.notNull())
    .addColumn("choice", "text", (col) => col.check(sql`choice in ('yes', 'no', 'insufficient')`))
    .addColumn("confidence", "double precision", (col) => col.check(sql`confidence between 0 and 1`))
    .addColumn("probabilities", "jsonb")
    .addColumn("failure_reason", "text")
    .addColumn("message", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint(
      "plan_assessments_outcome",
      sql`(status = 'completed') = (jev_model is not null and choice is not null and confidence is not null
        and probabilities is not null and failure_reason is null)`,
    )
    .execute();
  await sql`create index plan_assessments_element on plan_assessments (element_id, created_at)`.execute(db);
  await forbidUpdate("plan_assessments").execute(db);

  // O usuário mantém o elemento sobre a Avaliação que viu: incompatível ou incerta, com justificativa;
  // falha, com ou sem ela.
  await db.schema
    .createTable("plan_decisions")
    .addColumn("plan_assessment_id", "uuid", (col) => col.primaryKey().references("plan_assessments.id").onDelete("cascade"))
    .addColumn("justification", "text", (col) => col.check(sql`justification is null or btrim(justification) <> ''`))
    .addColumn("decided_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await forbidUpdate("plan_decisions").execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("plan_decisions").execute();
  await db.schema.dropTable("plan_assessments").execute();
  await db.schema.dropTable("execution_plan_elements").execute();
}
