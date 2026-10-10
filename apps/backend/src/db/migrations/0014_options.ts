import { sql, type Kysely } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

const filled = (column: string) => sql`${sql.ref(column)} is null or btrim(${sql.ref(column)}) <> ''`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // A proposta de Opções que a IA faz na Etapa O.
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block', 'synthesize_block', 'formulate_resolution_question', 'propose_options'))`.execute(
    db,
  );

  // Opção: caminho concreto para o problema, registrado na Etapa O. Proposta pela IA (sugestão até o
  // usuário aceitá-la, como veio ou editada, ou descartá-la) ou acrescentada pelo usuário, já aceita.
  // A sugestão como a IA a fez fica ao lado do texto que vale. Descartada, fica no histórico.
  await db.schema
    .createTable("options")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("statement", "text", (col) => col.notNull().check(sql`btrim(statement) <> ''`))
    .addColumn("description", "text", (col) => col.check(filled("description")))
    .addColumn("stage_points", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn("origin", "text", (col) => col.notNull().check(sql`origin in ('ai', 'user')`))
    .addColumn("proposal_attempt_id", "uuid", (col) => col.references("ai_request_attempts.id").onDelete("cascade"))
    .addColumn("suggested_statement", "text")
    .addColumn("suggested_description", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addColumn("accepted_at", "timestamptz")
    .addColumn("discarded_at", "timestamptz")
    .addCheckConstraint(
      "options_origin",
      sql`case origin
          when 'ai' then proposal_attempt_id is not null and suggested_statement is not null
          else proposal_attempt_id is null and suggested_statement is null and suggested_description is null and accepted_at is not null
        end`,
    )
    .execute();
  await sql`create index options_process on options (process_id, created_at)`.execute(db);

  // Verificação de viabilidade: os pares de Opções aceitas e Restrições em vigor ainda não avaliados.
  await db.schema
    .createTable("option_checks")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await forbidUpdate("option_checks").execute(db);

  await db.schema
    .createTable("option_constraint_pairs")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("check_id", "uuid", (col) => col.notNull().references("option_checks.id").onDelete("cascade"))
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("option_id", "uuid", (col) => col.notNull().references("options.id").onDelete("cascade"))
    .addColumn("constraint_id", "uuid", (col) => col.notNull().references("constraints.id").onDelete("cascade"))
    .addUniqueConstraint("option_constraint_pairs_position", ["check_id", "position"])
    // Cada par é avaliado uma vez.
    .addUniqueConstraint("option_constraint_pairs_once", ["option_id", "constraint_id"])
    .execute();
  await forbidUpdate("option_constraint_pairs").execute(db);

  // Avaliação de violação: uma chamada ao Jev com todos os pares da verificação, concluída ou falha.
  await db.schema
    .createTable("option_assessments")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("check_id", "uuid", (col) => col.notNull().references("option_checks.id").onDelete("cascade"))
    .addColumn("status", "text", (col) => col.notNull().check(sql`status in ('completed', 'failed')`))
    .addColumn("requested_model", "text", (col) => col.notNull())
    .addColumn("jev_model", "text")
    .addColumn("rubric_revision", "text", (col) => col.notNull())
    .addColumn("failure_reason", "text")
    .addColumn("message", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint("option_assessments_outcome", sql`(status = 'completed') = (jev_model is not null and failure_reason is null)`)
    .execute();
  await forbidUpdate("option_assessments").execute(db);

  // O julgamento do Jev sobre cada par: `yes`, a Opção viola a Restrição.
  await db.schema
    .createTable("option_verdicts")
    .addColumn("assessment_id", "uuid", (col) => col.notNull().references("option_assessments.id").onDelete("cascade"))
    .addColumn("pair_id", "uuid", (col) => col.notNull().references("option_constraint_pairs.id").onDelete("cascade"))
    .addColumn("choice", "text", (col) => col.notNull().check(sql`choice in ('yes', 'no', 'insufficient')`))
    .addColumn("confidence", "double precision", (col) => col.notNull().check(sql`confidence between 0 and 1`))
    .addColumn("probabilities", "jsonb", (col) => col.notNull())
    .addPrimaryKeyConstraint("option_verdicts_pk", ["assessment_id", "pair_id"])
    .execute();
  await forbidUpdate("option_verdicts").execute(db);

  // O usuário decidiu um par, sobre a Avaliação que viu (incerta ou falha): viola ou não a Restrição.
  await db.schema
    .createTable("option_decisions")
    .addColumn("pair_id", "uuid", (col) => col.primaryKey().references("option_constraint_pairs.id").onDelete("cascade"))
    .addColumn("option_assessment_id", "uuid", (col) => col.notNull().references("option_assessments.id").onDelete("cascade"))
    .addColumn("violates", "boolean", (col) => col.notNull())
    .addColumn("decided_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await forbidUpdate("option_decisions").execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("option_decisions").execute();
  await db.schema.dropTable("option_verdicts").execute();
  await db.schema.dropTable("option_assessments").execute();
  await db.schema.dropTable("option_constraint_pairs").execute();
  await db.schema.dropTable("option_checks").execute();
  await db.schema.dropTable("options").execute();
  await sql`delete from ai_requests where operation = 'propose_options'`.execute(db);
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block', 'synthesize_block', 'formulate_resolution_question'))`.execute(db);
}
