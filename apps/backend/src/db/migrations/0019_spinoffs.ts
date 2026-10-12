import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Desdobramento: a Derivação que estabelece um problema novo. Não herda o conjunto confirmado da
  // origem, e sim a Decisão dela, copiada como contexto (o resumo da Decisão do relatório congelado).
  await sql`alter table derivations drop constraint derivations_kind_check`.execute(db);
  await sql`alter table derivations add constraint derivations_kind_check
    check (kind in ('reconsideration', 'spinoff'))`.execute(db);
  await sql`alter table derivations alter column inherited_set drop not null`.execute(db);
  await db.schema.alterTable("derivations").addColumn("origin_decision", "jsonb").execute();
  await sql`alter table derivations add constraint derivations_inherited check (
    (kind = 'reconsideration' and inherited_set is not null and origin_decision is null)
    or (kind = 'spinoff' and inherited_set is null and origin_decision is not null))`.execute(db);

  // O Bloco de Respostas herdadas nasce com o Desdobramento, sem tentativa da IA: as Perguntas e as
  // respostas são cópias das da origem.
  await sql`alter table blocks alter column attempt_id drop not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Os Desdobramentos, e o que se derivou deles (onde vivem os Blocos de Respostas herdadas), não cabem no
  // esquema anterior. As Derivações saem antes dos Processos: nenhuma fica apontando para uma origem apagada.
  await sql`create temporary table spinoff_lineage as with recursive lineage(id) as (
      select process_id from derivations where kind = 'spinoff'
      union select derivations.process_id from derivations join lineage on derivations.origin_process_id = lineage.id)
    select id from lineage`.execute(db);
  await sql`delete from derivations where process_id in (select id from spinoff_lineage)`.execute(db);
  await sql`delete from processes where id in (select id from spinoff_lineage)`.execute(db);
  await sql`drop table spinoff_lineage`.execute(db);
  await sql`alter table blocks alter column attempt_id set not null`.execute(db);
  await sql`alter table derivations drop constraint derivations_inherited`.execute(db);
  await db.schema.alterTable("derivations").dropColumn("origin_decision").execute();
  await sql`alter table derivations alter column inherited_set set not null`.execute(db);
  await sql`alter table derivations drop constraint derivations_kind_check`.execute(db);
  await sql`alter table derivations add constraint derivations_kind_check check (kind in ('reconsideration'))`.execute(db);
}
