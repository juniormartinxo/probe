import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Perfil do Cloak nas novas solicitações: null é o perfil que o Cloak liga ao diretório de
  // trabalho do executor; um nome é um perfil escolhido.
  await db.schema.alterTable("settings").addColumn("cloak_profile", "text").execute();

  // Perfil com que cada tentativa chamou a CLI. Tentativas anteriores ao Cloak ficam sem nenhum.
  await db.schema
    .alterTable("ai_request_attempts")
    .addColumn("cloak_profile_source", "text", (col) => col.check(sql`cloak_profile_source in ('directory', 'explicit')`))
    .addColumn("cloak_profile", "text")
    .execute();
  await db.schema
    .alterTable("ai_request_attempts")
    .addCheckConstraint(
      "ai_request_attempts_cloak_profile",
      sql`(cloak_profile is not null) = (cloak_profile_source is not distinct from 'explicit')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("ai_request_attempts")
    .dropConstraint("ai_request_attempts_cloak_profile")
    .execute();
  await db.schema
    .alterTable("ai_request_attempts")
    .dropColumn("cloak_profile")
    .dropColumn("cloak_profile_source")
    .execute();
  await db.schema.alterTable("settings").dropColumn("cloak_profile").execute();
}
