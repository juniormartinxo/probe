import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("ai_requests")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("process_id", "uuid", (col) => col.notNull().references("processes.id").onDelete("cascade"))
    .addColumn("operation", "text", (col) =>
      col.notNull().check(sql`operation in ('refine_problem_statement')`),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  // O enunciado é refinado por uma única solicitação; novas chances são tentativas dela.
  await db.schema
    .createIndex("ai_requests_one_refinement_per_process")
    .on("ai_requests")
    .column("process_id")
    .unique()
    .where(sql.ref("operation"), "=", "refine_problem_statement")
    .execute();

  await db.schema
    .createTable("ai_request_attempts")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("ai_request_id", "uuid", (col) => col.notNull().references("ai_requests.id").onDelete("cascade"))
    .addColumn("number", "integer", (col) => col.notNull())
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .check(sql`status in ('running', 'completed', 'failed', 'timed_out', 'canceled', 'interrupted')`),
    )
    .addColumn("cli", "text", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    // Só uma tentativa concluída tem resultado; nunca se guarda resposta parcial.
    .addColumn("result", "jsonb", (col) => col.check(sql`(result is not null) = (status = 'completed')`))
    .addColumn("failure_reason", "text")
    .addColumn("message", "text")
    // Consumo informado pela CLI; ausente fica null, nunca zero.
    .addColumn("input_tokens", "integer")
    .addColumn("output_tokens", "integer")
    .addColumn("cache_creation_input_tokens", "integer")
    .addColumn("cache_read_input_tokens", "integer")
    .addColumn("cost_usd", "double precision")
    // clock_timestamp(): o instante do comando, comparável com o das Confirmações.
    .addColumn("started_at", "timestamptz", (col) => col.notNull().defaultTo(sql`clock_timestamp()`))
    .addColumn("finished_at", "timestamptz")
    .addUniqueConstraint("ai_request_attempts_number", ["ai_request_id", "number"])
    .execute();
  await db.schema
    .createIndex("ai_request_attempts_one_running")
    .on("ai_request_attempts")
    .column("ai_request_id")
    .unique()
    .where(sql.ref("status"), "=", "running")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("ai_request_attempts").execute();
  await db.schema.dropTable("ai_requests").execute();
}
