import { sql, type Kysely } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

const stageCheck = sql`stage in ('P', 'R', 'O', 'B', 'E')`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Cada chamada ao Jev sobre a cobertura dos Pontos de uma Etapa: o modelo pedido e o que respondeu,
  // a revisão da rubrica e, se falhou, por quê. Fica como foi gravada.
  await db.schema
    .createTable("stage_assessments")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("stage", "text", (col) => col.notNull().check(stageCheck))
    .addColumn("status", "text", (col) => col.notNull().check(sql`status in ('completed', 'failed')`))
    .addColumn("requested_model", "text", (col) => col.notNull())
    .addColumn("jev_model", "text")
    .addColumn("rubric_revision", "text", (col) => col.notNull())
    .addColumn("failure_reason", "text")
    .addColumn("message", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint(
      "stage_assessments_outcome",
      sql`(status = 'completed') = (jev_model is not null and failure_reason is null)`,
    )
    .execute();
  await forbidUpdate("stage_assessments").execute(db);

  // As Versões de resposta que o Jev analisou: as confirmadas da Etapa no momento da chamada.
  await db.schema
    .createTable("stage_assessment_answer_versions")
    .addColumn("stage_assessment_id", "uuid", (col) => col.notNull().references("stage_assessments.id").onDelete("cascade"))
    .addColumn("answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    .addPrimaryKeyConstraint("stage_assessment_answer_versions_pk", ["stage_assessment_id", "answer_version_id"])
    .execute();

  // Avaliação: o julgamento do Jev sobre um Ponto, com a escolha, as probabilidades e a confiança
  // como vieram. Informa; nunca confirma nada.
  await db.schema
    .createTable("assessments")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("stage_assessment_id", "uuid", (col) => col.notNull().references("stage_assessments.id").onDelete("cascade"))
    .addColumn("type", "text", (col) => col.notNull().check(sql`type in ('stage_point_coverage')`))
    .addColumn("stage_point", "text", (col) => col.notNull())
    .addColumn("choice", "text", (col) => col.notNull().check(sql`choice in ('yes', 'no', 'insufficient')`))
    .addColumn("confidence", "double precision", (col) => col.notNull().check(sql`confidence between 0 and 1`))
    .addColumn("probabilities", "jsonb", (col) => col.notNull())
    .addUniqueConstraint("assessments_stage_point", ["stage_assessment_id", "stage_point"])
    .execute();
  await forbidUpdate("assessments").execute(db);

  // Confirmação da Etapa: com a Avaliação que o usuário viu (concluída, ou a que falhou, quando
  // confirma sem Avaliação) e a justificativa, obrigatória quando confirma contra o Jev.
  await db.schema
    .createTable("stage_confirmations")
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("stage", "text", (col) => col.notNull().check(stageCheck))
    .addColumn("stage_assessment_id", "uuid", (col) => col.references("stage_assessments.id"))
    .addColumn("justification", "text")
    .addColumn("confirmed_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addPrimaryKeyConstraint("stage_confirmations_pk", ["process_id", "stage"])
    .addCheckConstraint("stage_confirmations_justification", sql`justification is null or btrim(justification) <> ''`)
    .execute();
  await forbidUpdate("stage_confirmations").execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("stage_confirmations").execute();
  await db.schema.dropTable("assessments").execute();
  await db.schema.dropTable("stage_assessment_answer_versions").execute();
  await db.schema.dropTable("stage_assessments").execute();
  // Sem as Confirmações da Etapa, nenhum Processo pode ter passado de P.
  await sql`update processes set current_stage = 'P'`.execute(db);
}
