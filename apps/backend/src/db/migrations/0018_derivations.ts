import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Derivação: o Processo novo, o finalizado de que ele veio e o tipo. `inherited_set` é o conjunto
  // confirmado da origem, pelos ids das cópias: o ponto de partida contra o qual se lê o que mudou.
  // Uma por Processo derivado; fica como foi gravada.
  await db.schema
    .createTable("derivations")
    .addColumn("process_id", "uuid", (col) => col.primaryKey().references("processes.id").onDelete("cascade"))
    .addColumn("origin_process_id", "uuid", (col) => col.notNull().references("processes.id"))
    .addColumn("kind", "text", (col) => col.notNull().check(sql`kind in ('reconsideration')`))
    .addColumn("inherited_set", "jsonb", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint("derivations_other_process", sql`process_id <> origin_process_id`)
    .execute();
  await sql`create index derivations_origin on derivations (origin_process_id)`.execute(db);
  await sql`create trigger derivations_immutable before update on derivations
    for each row execute function probe_forbid_update()`.execute(db);

  // Cada registro copiado da origem, identificado: de que tabela, o id na origem e o da cópia.
  await db.schema
    .createTable("derivation_copies")
    .addColumn("process_id", "uuid", (col) => col.notNull().references("derivations.process_id").onDelete("cascade"))
    .addColumn("table_name", "text", (col) => col.notNull())
    .addColumn("origin_id", "uuid", (col) => col.notNull())
    .addColumn("copy_id", "uuid", (col) => col.notNull())
    .addPrimaryKeyConstraint("derivation_copies_pkey", ["process_id", "table_name", "copy_id"])
    .addUniqueConstraint("derivation_copies_once", ["process_id", "table_name", "origin_id"])
    .execute();
  await sql`create trigger derivation_copies_immutable before update on derivation_copies
    for each row execute function probe_forbid_update()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("derivation_copies").execute();
  await db.schema.dropTable("derivations").execute();
}
