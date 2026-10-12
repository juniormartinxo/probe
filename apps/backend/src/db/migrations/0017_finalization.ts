import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Finalização: a Escolha que vale, o conjunto confirmado (pelos ids) e o relatório como a Revisão
  // final o apresentou, com a impressão digital dele. Uma por Processo; fica como foi gravada.
  await db.schema
    .createTable("finalizations")
    .addColumn("process_id", "uuid", (col) => col.primaryKey().references("processes.id").onDelete("cascade"))
    .addColumn("chosen_option_id", "uuid", (col) => col.notNull().references("chosen_options.id"))
    .addColumn("fingerprint", "text", (col) => col.notNull().check(sql`fingerprint ~ '^[0-9a-f]{64}$'`))
    .addColumn("confirmed_set", "jsonb", (col) => col.notNull())
    .addColumn("report", "jsonb", (col) => col.notNull())
    .addColumn("finalized_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .execute();
  await sql`create trigger finalizations_immutable before update on finalizations
    for each row execute function probe_forbid_update()`.execute(db);

  // Um Processo finalizado é somente leitura: nem o próprio registro muda mais.
  await sql`create function probe_forbid_finalized_update() returns trigger language plpgsql as $$
    begin raise exception 'O Processo % foi finalizado e não pode ser alterado', old.id; end $$`.execute(db);
  await sql`create trigger processes_finalized before update on processes
    for each row when (old.status = 'finalized') execute function probe_forbid_finalized_update()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger processes_finalized on processes`.execute(db);
  await sql`drop function probe_forbid_finalized_update`.execute(db);
  await db.schema.dropTable("finalizations").execute();
}
