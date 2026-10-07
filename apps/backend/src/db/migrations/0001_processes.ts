import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("processes")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("original_description", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) =>
      col.notNull().defaultTo("open").check(sql`status in ('open', 'finalized')`),
    )
    .addColumn("current_stage", "text", (col) =>
      col.notNull().defaultTo("P").check(sql`current_stage in ('P', 'R', 'O', 'B', 'E')`),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("processes").execute();
}
