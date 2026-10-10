import { sql, type Kysely, type RawBuilder } from "kysely";

const forbidUpdate = (table: string) => sql`
  create trigger ${sql.id(`${table}_immutable`)} before update on ${sql.table(table)}
  for each row execute function probe_forbid_update()`;

const addCheck = (table: string, name: string, check: RawBuilder<unknown>) =>
  sql`alter table ${sql.table(table)} add constraint ${sql.id(name)} check (${check})`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Verificação de conflito: as respostas que acabaram de ser confirmadas (pela síntese do Bloco ou
  // depois de uma mudança) e os pares que elas formam entre si e com as respostas já confirmadas.
  await db.schema
    .createTable("conflict_checks")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("subject_answer_version_ids", sql`uuid[]`, (col) => col.notNull().check(sql`cardinality(subject_answer_version_ids) > 0`))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await forbidUpdate("conflict_checks").execute(db);

  await db.schema
    .createTable("conflict_pairs")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("check_id", "uuid", (col) => col.notNull().references("conflict_checks.id").onDelete("cascade"))
    .addColumn("position", "integer", (col) => col.notNull())
    // A resposta que acabou de ser confirmada e a outra do par.
    .addColumn("answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    .addColumn("other_answer_version_id", "uuid", (col) => col.notNull().references("answer_versions.id").onDelete("cascade"))
    .addUniqueConstraint("conflict_pairs_position", ["check_id", "position"])
    .addCheckConstraint("conflict_pairs_distinct", sql`answer_version_id <> other_answer_version_id`)
    .execute();
  await forbidUpdate("conflict_pairs").execute(db);

  // Avaliação de conflito: uma chamada ao Jev com todos os pares da verificação, concluída ou falha.
  await db.schema
    .createTable("conflict_assessments")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("check_id", "uuid", (col) => col.notNull().references("conflict_checks.id").onDelete("cascade"))
    .addColumn("status", "text", (col) => col.notNull().check(sql`status in ('completed', 'failed')`))
    .addColumn("requested_model", "text", (col) => col.notNull())
    .addColumn("jev_model", "text")
    .addColumn("rubric_revision", "text", (col) => col.notNull())
    // As Restrições e Preferências em vigor que o Jev recebeu como contexto.
    .addColumn("analyzed_constraint_ids", sql`uuid[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn("analyzed_preference_ids", sql`uuid[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn("failure_reason", "text")
    .addColumn("message", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint("conflict_assessments_outcome", sql`(status = 'completed') = (jev_model is not null and failure_reason is null)`)
    .execute();
  await forbidUpdate("conflict_assessments").execute(db);

  // O julgamento do Jev sobre cada par, numa Avaliação concluída.
  await db.schema
    .createTable("conflict_verdicts")
    .addColumn("assessment_id", "uuid", (col) => col.notNull().references("conflict_assessments.id").onDelete("cascade"))
    .addColumn("pair_id", "uuid", (col) => col.notNull().references("conflict_pairs.id").onDelete("cascade"))
    .addColumn("choice", "text", (col) => col.notNull().check(sql`choice in ('yes', 'no', 'insufficient')`))
    .addColumn("confidence", "double precision", (col) => col.notNull().check(sql`confidence between 0 and 1`))
    .addColumn("probabilities", "jsonb", (col) => col.notNull())
    .addPrimaryKeyConstraint("conflict_verdicts_pk", ["assessment_id", "pair_id"])
    .execute();
  await forbidUpdate("conflict_verdicts").execute(db);

  // O usuário descartou o conflito de um par, sobre a Avaliação que viu (incerta ou falha).
  await db.schema
    .createTable("conflict_dismissals")
    .addColumn("pair_id", "uuid", (col) => col.primaryKey().references("conflict_pairs.id").onDelete("cascade"))
    .addColumn("conflict_assessment_id", "uuid", (col) => col.notNull().references("conflict_assessments.id").onDelete("cascade"))
    .addColumn("dismissed_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await forbidUpdate("conflict_dismissals").execute(db);

  // Pendência de conflito: ligada ao par (as duas respostas) e à Avaliação de conflito. Resolve-se com
  // uma Versão nova de uma das respostas, uma Revisão de Restrição ou um esclarecimento.
  await sql`alter table pendencies drop constraint pendencies_reason_check`.execute(db);
  await sql`alter table pendencies add constraint pendencies_reason_check
    check (reason in ('unknown_information', 'reassessment', 'conflict'))`.execute(db);
  await sql`alter table pendencies drop constraint pendencies_resolution_check`.execute(db);
  await sql`alter table pendencies add constraint pendencies_resolution_check
    check (resolution in ('answered', 'reconfirmed', 'corrected', 'clarified', 'constraint_revised'))`.execute(db);
  await db.schema
    .alterTable("pendencies")
    .addColumn("conflict_pair_id", "uuid", (col) => col.references("conflict_pairs.id").onDelete("cascade"))
    .addColumn("conflict_assessment_id", "uuid", (col) => col.references("conflict_assessments.id").onDelete("cascade"))
    // O esclarecimento do usuário que resolveu o conflito.
    .addColumn("clarification", "text", (col) => col.check(sql`clarification is null or btrim(clarification) <> ''`))
    .execute();

  // Revisão de Restrição: o usuário retira uma Restrição em vigor e, se houver, registra a que a
  // substitui (uma Restrição nova ou uma Preferência), com uma nota; as duas ficam no histórico. Vale
  // em qualquer Etapa a partir de R, e as Confirmações de Etapa que sustentavam a Restrição passam
  // pela Avaliação de impacto. Por ora, só como resolução de uma Pendência de conflito.
  await db.schema
    .createTable("constraint_revisions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    // Uma Restrição é retirada uma vez.
    .addColumn("constraint_id", "uuid", (col) => col.notNull().unique().references("constraints.id").onDelete("cascade"))
    .addColumn("replacement_constraint_id", "uuid", (col) => col.references("constraints.id").onDelete("cascade"))
    .addColumn("replacement_preference_id", "uuid", (col) => col.references("preferences.id").onDelete("cascade"))
    .addColumn("note", "text", (col) => col.check(sql`note is null or btrim(note) <> ''`))
    .addColumn("conflict_pendency_id", "uuid", (col) => col.unique().references("pendencies.id").onDelete("cascade"))
    .addColumn("revised_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint("constraint_revisions_one_replacement", sql`replacement_constraint_id is null or replacement_preference_id is null`)
    .addCheckConstraint("constraint_revisions_distinct", sql`replacement_constraint_id is distinct from constraint_id`)
    .execute();
  await forbidUpdate("constraint_revisions").execute(db);

  // Pendência de reavaliação de uma Revisão de Restrição: na Confirmação de Etapa afetada, sem Pergunta.
  await sql`alter table pendencies alter column question_id drop not null`.execute(db);
  await db.schema
    .alterTable("pendencies")
    .addColumn("constraint_revision_id", "uuid", (col) => col.references("constraint_revisions.id").onDelete("cascade"))
    .execute();
  await sql`alter table pendencies drop constraint pendencies_reassessment`.execute(db);
  await addCheck(
    "pendencies",
    "pendencies_reason_columns",
    sql`case reason
        when 'reassessment' then impact_assessment_id is not null and opened_by is not null
          and (block_id is null) <> (stage is null) and conflict_pair_id is null and conflict_assessment_id is null
          and case when constraint_revision_id is null
            then answer_version_id is not null and question_id is not null and coalesce(resolution in ('reconfirmed', 'corrected'), true)
            else answer_version_id is null and question_id is null and stage is not null and coalesce(resolution = 'reconfirmed', true)
          end
        when 'conflict' then conflict_pair_id is not null and conflict_assessment_id is not null and opened_by is not null
          and question_id is not null and answer_version_id is null and impact_assessment_id is null and block_id is null
          and stage is null and constraint_revision_id is null
          and coalesce(resolution in ('corrected', 'clarified', 'constraint_revised'), true)
        else question_id is not null and answer_version_id is null and impact_assessment_id is null and opened_by is null
          and block_id is null and stage is null and conflict_pair_id is null and conflict_assessment_id is null
          and constraint_revision_id is null and coalesce(resolution = 'answered', true)
      end`,
  ).execute(db);
  await addCheck("pendencies", "pendencies_clarification", sql`(clarification is not null) = coalesce(resolution = 'clarified', false)`).execute(db);
  // Uma Pendência de conflito por par.
  await sql`create unique index pendencies_one_conflict on pendencies (conflict_pair_id) where reason = 'conflict'`.execute(db);
  // Uma Pendência de reavaliação por mudança (Versão nova ou Revisão de Restrição) e Confirmação afetada.
  await sql`drop index pendencies_one_reassessment`.execute(db);
  await sql`create unique index pendencies_one_reassessment
    on pendencies (answer_version_id, constraint_revision_id, block_id, stage) nulls not distinct where reason = 'reassessment'`.execute(db);

  // Avaliação de impacto de uma Revisão de Restrição sobre uma Confirmação de Etapa que a sustentava.
  await sql`alter table impact_assessments alter column answer_version_id drop not null`.execute(db);
  await sql`alter table impact_assessments alter column previous_answer_version_id drop not null`.execute(db);
  await db.schema
    .alterTable("impact_assessments")
    .addColumn("constraint_revision_id", "uuid", (col) => col.references("constraint_revisions.id").onDelete("cascade"))
    .execute();
  await addCheck(
    "impact_assessments",
    "impact_assessments_change",
    sql`case when constraint_revision_id is null
        then answer_version_id is not null and previous_answer_version_id is not null
        else answer_version_id is null and previous_answer_version_id is null and stage is not null
      end`,
  ).execute(db);

  // A Revisão de Restrição que uma Confirmação de Etapa passou a sustentar: sem impacto, segundo o Jev;
  // mantida pelo usuário; ou reconfirmada, ao resolver a Pendência de reavaliação.
  await db.schema
    .createTable("confirmation_constraint_revisions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("constraint_revision_id", "uuid", (col) => col.notNull().references("constraint_revisions.id").onDelete("cascade"))
    .addColumn("stage", "text", (col) => col.notNull().check(sql`stage in ('P', 'R', 'O', 'B', 'E')`))
    .addColumn("basis", "text", (col) => col.notNull().check(sql`basis in ('no_impact', 'kept', 'reconfirmed')`))
    .addColumn("impact_assessment_id", "uuid", (col) => col.notNull().references("impact_assessments.id").onDelete("cascade"))
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addForeignKeyConstraint("confirmation_constraint_revisions_stage_confirmation", ["process_id", "stage"], "stage_confirmations", [
      "process_id",
      "stage",
    ])
    .addUniqueConstraint("confirmation_constraint_revisions_once", ["constraint_revision_id", "stage"])
    .execute();
  await forbidUpdate("confirmation_constraint_revisions").execute(db);

  // A pergunta de resolução que a IA formula para uma Pendência de conflito.
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block', 'synthesize_block', 'formulate_resolution_question'))`.execute(db);
  await db.schema
    .alterTable("ai_requests")
    .addColumn("pendency_id", "uuid", (col) => col.references("pendencies.id").onDelete("cascade"))
    .execute();
  await addCheck("ai_requests", "ai_requests_pendency", sql`(pendency_id is not null) = (operation = 'formulate_resolution_question')`).execute(db);
  // Uma solicitação por Pendência; novas chances são tentativas dela.
  await sql`create unique index ai_requests_one_per_pendency on ai_requests (pendency_id) where pendency_id is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from ai_requests where operation = 'formulate_resolution_question'`.execute(db);
  await sql`drop index ai_requests_one_per_pendency`.execute(db);
  await sql`alter table ai_requests drop constraint ai_requests_pendency`.execute(db);
  await db.schema.alterTable("ai_requests").dropColumn("pendency_id").execute();
  await sql`alter table ai_requests drop constraint ai_requests_operation_check`.execute(db);
  await sql`alter table ai_requests add constraint ai_requests_operation_check
    check (operation in ('refine_problem_statement', 'generate_block', 'synthesize_block'))`.execute(db);

  await db.schema.dropTable("confirmation_constraint_revisions").execute();
  await sql`delete from impact_assessments where constraint_revision_id is not null`.execute(db);
  await sql`alter table impact_assessments drop constraint impact_assessments_change`.execute(db);
  await db.schema.alterTable("impact_assessments").dropColumn("constraint_revision_id").execute();
  await sql`alter table impact_assessments alter column previous_answer_version_id set not null`.execute(db);
  await sql`alter table impact_assessments alter column answer_version_id set not null`.execute(db);

  await sql`delete from pendencies where reason = 'conflict' or constraint_revision_id is not null`.execute(db);
  await sql`drop index pendencies_one_reassessment`.execute(db);
  await sql`create unique index pendencies_one_reassessment
    on pendencies (answer_version_id, block_id, stage) nulls not distinct where reason = 'reassessment'`.execute(db);
  await sql`drop index pendencies_one_conflict`.execute(db);
  await sql`alter table pendencies drop constraint pendencies_clarification`.execute(db);
  await sql`alter table pendencies drop constraint pendencies_reason_columns`.execute(db);
  await db.schema.alterTable("pendencies").dropColumn("constraint_revision_id").execute();
  await sql`alter table pendencies alter column question_id set not null`.execute(db);
  await db.schema.dropTable("constraint_revisions").execute();
  await db.schema
    .alterTable("pendencies")
    .dropColumn("clarification")
    .dropColumn("conflict_assessment_id")
    .dropColumn("conflict_pair_id")
    .execute();
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
  await sql`alter table pendencies drop constraint pendencies_resolution_check`.execute(db);
  await sql`alter table pendencies add constraint pendencies_resolution_check
    check (resolution in ('answered', 'reconfirmed', 'corrected'))`.execute(db);
  await sql`alter table pendencies drop constraint pendencies_reason_check`.execute(db);
  await sql`alter table pendencies add constraint pendencies_reason_check
    check (reason in ('unknown_information', 'reassessment'))`.execute(db);

  await db.schema.dropTable("conflict_dismissals").execute();
  await db.schema.dropTable("conflict_verdicts").execute();
  await db.schema.dropTable("conflict_assessments").execute();
  await db.schema.dropTable("conflict_pairs").execute();
  await db.schema.dropTable("conflict_checks").execute();
}
