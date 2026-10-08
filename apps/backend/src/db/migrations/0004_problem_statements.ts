import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Só existe linha depois da Confirmação: nada vira enunciado sem o usuário.
  await db.schema
    .createTable("problem_statements")
    .addColumn("process_id", "uuid", (col) => col.primaryKey().references("processes.id").onDelete("cascade"))
    .addColumn("statement", "text", (col) => col.notNull())
    .addColumn("origin", "text", (col) =>
      col.notNull().check(sql`origin in ('proposal', 'corrected', 'written')`),
    )
    .addColumn("proposal_id", "uuid", (col) => col.references("ai_request_attempts.id"))
    // clock_timestamp(): comparável com o fim das Tentativas, que pode cair durante a Confirmação.
    .addColumn("confirmed_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addCheckConstraint("problem_statements_origin_proposal", sql`(proposal_id is null) = (origin = 'written')`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("problem_statements").execute();
}
