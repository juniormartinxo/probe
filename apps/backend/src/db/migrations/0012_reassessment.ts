import { sql, type Kysely, type RawBuilder } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

const addCheck = (table: string, name: string, check: RawBuilder<unknown>) =>
  sql`alter table ${sql.table(table)} add constraint ${sql.id(name)} check (${check})`;

const stageCheck = sql`stage is null or stage in ('P', 'R', 'O', 'B', 'E')`;

// A Confirmação que depende de respostas: a síntese de um Bloco ou a de uma Etapa, nunca as duas.
async function confirmationColumns(db: Kysely<unknown>, table: string): Promise<void> {
  await db.schema
    .alterTable(table)
    .addColumn("block_id", "uuid", (col) => col.references("block_syntheses.block_id").onDelete("cascade"))
    .addColumn("stage", "text", (col) => col.check(stageCheck))
    .execute();
  await db.schema
    .alterTable(table)
    .addForeignKeyConstraint(`${table}_stage_confirmation`, ["process_id", "stage"], "stage_confirmations", ["process_id", "stage"])
    .onDelete("cascade")
    .execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // Avaliação de impacto: o Jev julga se a Versão nova de uma resposta afeta uma Confirmação que
  // dependia da Versão anterior. Uma por chamada, concluída ou falha; fica como foi gravada.
  await db.schema
    .createTable("impact_assessments")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    .addColumn("previous_answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    // As outras Versões que o Jev recebeu: as respostas que a Confirmação da Etapa sustentava.
    .addColumn("analyzed_answer_version_ids", sql`uuid[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
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
      "impact_assessments_outcome",
      sql`(status = 'completed') = (jev_model is not null and choice is not null and confidence is not null
        and probabilities is not null and failure_reason is null)`,
    )
    .execute();
  await confirmationColumns(db, "impact_assessments");
  await addCheck("impact_assessments", "impact_assessments_confirmation", sql`(block_id is null) <> (stage is null)`).execute(db);
  await forbidUpdate("impact_assessments").execute(db);

  // A Versão que uma Confirmação passou a sustentar depois de uma mudança: sem impacto, segundo o
  // Jev; mantida pelo usuário, quando o Jev não teve certeza ou não respondeu; ou reconfirmada, ao
  // resolver a Pendência de reavaliação. Na reconfirmação de uma síntese de bloco, o texto corrigido.
  await db.schema
    .createTable("confirmation_answer_versions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    .addColumn("basis", "text", (col) => col.notNull().check(sql`basis in ('no_impact', 'kept', 'reconfirmed')`))
    .addColumn("impact_assessment_id", "uuid", (col) => col.notNull().references("impact_assessments.id").onDelete("cascade"))
    .addColumn("corrected_synthesis", "text", (col) =>
      col.check(sql`corrected_synthesis is null or btrim(corrected_synthesis) <> ''`),
    )
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await confirmationColumns(db, "confirmation_answer_versions");
  await addCheck("confirmation_answer_versions", "confirmation_answer_versions_confirmation", sql`(block_id is null) <> (stage is null)`).execute(db);
  await addCheck(
    "confirmation_answer_versions",
    "confirmation_answer_versions_correction",
    sql`corrected_synthesis is null or (basis = 'reconfirmed' and block_id is not null)`,
  ).execute(db);
  await sql`create unique index confirmation_answer_versions_once
    on confirmation_answer_versions (answer_version_id, block_id, stage) nulls not distinct`.execute(db);
  await forbidUpdate("confirmation_answer_versions").execute(db);

  // Pendência de reavaliação: ligada à Versão nova, à Confirmação afetada e à Avaliação de impacto
  // que a originou. Resolve-se reconfirmando ou corrigindo (uma Versão nova da resposta).
  await sql`alter table pendencies drop constraint pendencies_reason_check`.execute(db);
  await sql`alter table pendencies add constraint pendencies_reason_check
    check (reason in ('unknown_information', 'reassessment'))`.execute(db);
  await db.schema
    .alterTable("pendencies")
    .addColumn("answer_version_id", "uuid", (col) => col.references("answer_versions.id").onDelete("cascade"))
    .addColumn("impact_assessment_id", "uuid", (col) => col.references("impact_assessments.id").onDelete("cascade"))
    // Quem abriu: o Jev (impacto `yes` com confiança) ou o usuário, quando o Jev não teve certeza ou não respondeu.
    .addColumn("opened_by", "text", (col) => col.check(sql`opened_by in ('jev', 'user')`))
    // Como se resolveu: respondida (informação desconhecida), reconfirmada ou corrigida (Versão nova).
    .addColumn("resolution", "text", (col) => col.check(sql`resolution in ('answered', 'reconfirmed', 'corrected')`))
    .execute();
  await confirmationColumns(db, "pendencies");
  await sql`update pendencies set resolution = 'answered' where resolved_at is not null`.execute(db);
  await sql`alter table pendencies drop constraint pendencies_resolution`.execute(db);
  await addCheck(
    "pendencies",
    "pendencies_resolution",
    sql`(resolved_at is null) = (resolution is null)
      and (resolved_by_answer_version_id is not null) = coalesce(resolution in ('answered', 'corrected'), false)`,
  ).execute(db);
  await addCheck(
    "pendencies",
    "pendencies_reassessment",
    sql`case reason
        when 'reassessment' then answer_version_id is not null and impact_assessment_id is not null
          and opened_by is not null and (block_id is null) <> (stage is null) and resolution is distinct from 'answered'
        else answer_version_id is null and impact_assessment_id is null and opened_by is null
          and block_id is null and stage is null and coalesce(resolution = 'answered', true)
      end`,
  ).execute(db);
  await db.schema.dropIndex("pendencies_one_open_unknown_per_question").execute();
  await sql`create unique index pendencies_one_open_unknown_per_question
    on pendencies (question_id) where resolved_at is null and reason = 'unknown_information'`.execute(db);
  // Uma Pendência de reavaliação por Versão nova e Confirmação afetada.
  await sql`create unique index pendencies_one_reassessment
    on pendencies (answer_version_id, block_id, stage) nulls not distinct where reason = 'reassessment'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from pendencies where reason = 'reassessment'`.execute(db);
  await sql`drop index pendencies_one_reassessment`.execute(db);
  await db.schema.dropIndex("pendencies_one_open_unknown_per_question").execute();
  await db.schema
    .createIndex("pendencies_one_open_unknown_per_question")
    .on("pendencies")
    .column("question_id")
    .unique()
    .where(sql.ref("resolved_at"), "is", null)
    .execute();
  await sql`alter table pendencies drop constraint pendencies_reassessment`.execute(db);
  await sql`alter table pendencies drop constraint pendencies_resolution`.execute(db);
  await db.schema
    .alterTable("pendencies")
    .dropConstraint("pendencies_stage_confirmation")
    .execute();
  await db.schema
    .alterTable("pendencies")
    .dropColumn("stage")
    .dropColumn("block_id")
    .dropColumn("resolution")
    .dropColumn("opened_by")
    .dropColumn("impact_assessment_id")
    .dropColumn("answer_version_id")
    .execute();
  await addCheck("pendencies", "pendencies_resolution", sql`(resolved_at is null) = (resolved_by_answer_version_id is null)`).execute(db);
  await sql`alter table pendencies drop constraint pendencies_reason_check`.execute(db);
  await sql`alter table pendencies add constraint pendencies_reason_check check (reason in ('unknown_information'))`.execute(db);
  await db.schema.dropTable("confirmation_answer_versions").execute();
  await db.schema.dropTable("impact_assessments").execute();
}
