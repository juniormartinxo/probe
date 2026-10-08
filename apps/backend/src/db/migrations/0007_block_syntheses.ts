import { sql, type Kysely } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // A síntese é pedida por Bloco: a solicitação aponta o Bloco que sintetiza.
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block', 'synthesize_block'))`.execute(db);
  await db.schema
    .alterTable("ai_requests")
    .addColumn("block_id", "uuid", (col) => col.references("blocks.id").onDelete("cascade"))
    .execute();
  await db.schema
    .alterTable("ai_requests")
    .addCheckConstraint("ai_requests_block", sql`(block_id is not null) = (operation = 'synthesize_block')`)
    .execute();

  // Versões de resposta que uma tentativa enviou à IA: a solicitação referencia o que de fato usou.
  await db.schema
    .createTable("attempt_answer_versions")
    .addColumn("attempt_id", "uuid", (col) => col.notNull().references("ai_request_attempts.id").onDelete("cascade"))
    .addColumn("answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    .addPrimaryKeyConstraint("attempt_answer_versions_pk", ["attempt_id", "answer_version_id"])
    .execute();

  // Reformulação: Pergunta nova, num Bloco novo, ligada à Pergunta que ela reformula.
  await db.schema
    .alterTable("questions")
    .addColumn("reformulates_question_id", "uuid", (col) => col.references("questions.id").onDelete("cascade"))
    .execute();

  // Confirmação da síntese de bloco: o texto que o usuário confirmou, como a IA propôs ou corrigido.
  // Confirma em conjunto as Versões que a proposta sintetizou.
  await db.schema
    .createTable("block_syntheses")
    .addColumn("block_id", "uuid", (col) => col.primaryKey().references("blocks.id").onDelete("cascade"))
    .addColumn("synthesis", "text", (col) => col.notNull())
    .addColumn("origin", "text", (col) => col.notNull().check(sql`origin in ('proposal', 'corrected')`))
    .addColumn("proposal_id", "uuid", (col) => col.notNull().unique().references("ai_request_attempts.id"))
    .addColumn("confirmed_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await forbidUpdate("block_syntheses").execute(db);

  // Ponto da etapa que deixou de estar aberto: coberto (confirmado com a síntese de um Bloco) ou
  // declarado inaplicável, com justificativa.
  await db.schema
    .createTable("stage_point_coverage")
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("stage", "text", (col) => col.notNull().check(sql`stage in ('P', 'R', 'O', 'B', 'E')`))
    .addColumn("stage_point", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().check(sql`status in ('covered', 'inapplicable')`))
    .addColumn("block_id", "uuid", (col) => col.references("block_syntheses.block_id").onDelete("cascade"))
    .addColumn("justification", "text")
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addPrimaryKeyConstraint("stage_point_coverage_pk", ["process_id", "stage", "stage_point"])
    .addCheckConstraint("stage_point_coverage_covered", sql`(status = 'covered') = (block_id is not null)`)
    .addCheckConstraint(
      "stage_point_coverage_inapplicable",
      sql`(status = 'inapplicable') = (justification is not null and btrim(justification) <> '')`,
    )
    .execute();

  // Pendência. Nesta fatia, só a de informação desconhecida, aberta numa Pergunta e resolvida
  // pela resposta que chegar depois.
  await db.schema
    .createTable("pendencies")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("reason", "text", (col) => col.notNull().check(sql`reason in ('unknown_information')`))
    .addColumn("question_id", "uuid", (col) => col.notNull().references("questions.id").onDelete("cascade"))
    .addColumn("opened_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addColumn("resolved_at", "timestamptz")
    .addColumn("resolved_by_answer_version_id", "uuid", (col) => col.references("answer_versions.id"))
    .addCheckConstraint(
      "pendencies_resolution",
      sql`(resolved_at is null) = (resolved_by_answer_version_id is null)`,
    )
    .execute();
  await db.schema
    .createIndex("pendencies_one_open_unknown_per_question")
    .on("pendencies")
    .column("question_id")
    .unique()
    .where(sql.ref("resolved_at"), "is", null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("pendencies").execute();
  await db.schema.dropTable("stage_point_coverage").execute();
  await db.schema.dropTable("block_syntheses").execute();
  await db.schema.alterTable("questions").dropColumn("reformulates_question_id").execute();
  await db.schema.dropTable("attempt_answer_versions").execute();
  await sql`delete from ai_requests where operation = 'synthesize_block'`.execute(db);
  await db.schema.alterTable("ai_requests").dropColumn("block_id").execute();
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block'))`.execute(db);
}
