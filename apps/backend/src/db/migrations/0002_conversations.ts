import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("conversations")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) =>
      col.notNull().unique().references("processes.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("messages")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("conversation_id", "uuid", (col) =>
      col.notNull().references("conversations.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (col) => col.notNull().check(sql`role in ('user', 'assistant')`))
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("messages_conversation_id_created_at_idx")
    .on("messages")
    .columns(["conversation_id", "created_at"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("messages").execute();
  await db.schema.dropTable("conversations").execute();
}
