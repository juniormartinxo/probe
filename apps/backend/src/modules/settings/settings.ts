import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database.ts";
import type { Attempt, AttemptStatus } from "../ai/ai-requests.ts";
import type { Assistant, CloakProfile } from "../ai/assistant.ts";

// Configurações não sensíveis, guardadas no banco. Segredos ficam no ambiente do backend e nunca
// fazem parte delas.
export interface Settings {
  // Modelo do claude usado nas novas solicitações à IA.
  claudeModel: string;
  // Perfil do Cloak com que a CLI roda nas novas solicitações.
  cloakProfile: CloakProfile;
}

export type SettingsError = "invalid_model" | "invalid_cloak_profile";

// Desfecho de um teste de conexão: a CLI, o modelo e o perfil do Cloak usados e, se não concluiu, por quê.
export interface ConnectionTest extends Pick<Attempt, "cli" | "model" | "failureReason" | "message" | "usage"> {
  cloakProfile: CloakProfile;
  status: Exclude<AttemptStatus, "running">;
}

export interface SettingsModule {
  // Dentro de uma transação, passe-a: a leitura fica nela.
  find(trx?: Db): Promise<Settings>;
  save(settings: { claudeModel: unknown; cloakProfile: unknown }): Promise<
    { ok: true; settings: Settings } | { ok: false; error: SettingsError }
  >;
  // Chamada paga à IA: só por ação explícita do usuário. Não pertence a nenhum Processo.
  testConnection(signal: AbortSignal): Promise<ConnectionTest>;
}

// O mesmo formato que o executor aceita: alias ("sonnet") ou nome completo ("claude-opus-5-5[1m]"),
// começando por letra ou dígito para nunca ser lido como opção da CLI.
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

const isModel = (value: unknown): value is string => typeof value === "string" && modelPattern.test(value);

// O mesmo formato que o executor aceita: nome de perfil do Cloak que nunca é lido como opção nem
// como caminho.
const cloakProfileNamePattern = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function cloakProfileFrom(value: unknown): CloakProfile | undefined {
  if (!isRecord(value)) return undefined;
  if (value.source === "directory") return { source: "directory" };
  if (value.source !== "explicit" || typeof value.name !== "string" || !cloakProfileNamePattern.test(value.name)) {
    return undefined;
  }
  return { source: "explicit", name: value.name };
}

// No banco, o perfil do diretório é a ausência de um nome.
const cloakProfileOf = (name: string | null): CloakProfile =>
  name === null ? { source: "directory" } : { source: "explicit", name };

export function settings(deps: { db: Db; assistant: Assistant; defaultAiModel: string }): SettingsModule {
  const { db, assistant, defaultAiModel } = deps;

  async function find(trx: Db = db): Promise<Settings> {
    const row = await trx.selectFrom("settings").select(["claudeModel", "cloakProfile"]).executeTakeFirst();
    return { claudeModel: row?.claudeModel ?? defaultAiModel, cloakProfile: cloakProfileOf(row?.cloakProfile ?? null) };
  }

  return {
    find,

    async save(requested) {
      const { claudeModel } = requested;
      if (!isModel(claudeModel)) return { ok: false, error: "invalid_model" };
      const profile = cloakProfileFrom(requested.cloakProfile);
      if (!profile) return { ok: false, error: "invalid_cloak_profile" };
      const cloakProfile = profile.source === "explicit" ? profile.name : null;
      const saved = await db
        .insertInto("settings")
        .values({ claudeModel, cloakProfile })
        .onConflict((oc) => oc.column("id").doUpdateSet({ claudeModel, cloakProfile, updatedAt: new Date() }))
        .returning(["claudeModel", "cloakProfile"])
        .executeTakeFirstOrThrow();
      return { ok: true, settings: { claudeModel: saved.claudeModel, cloakProfile: cloakProfileOf(saved.cloakProfile) } };
    },

    async testConnection(signal) {
      const { claudeModel: model, cloakProfile } = await find();
      const outcome = await assistant.testConnection({ id: `connection-test-${randomUUID()}`, model, cloakProfile, signal });
      const base = { cli: assistant.cli, model, cloakProfile, failureReason: null, message: null, usage: null };
      switch (outcome.status) {
        case "completed":
          return { ...base, status: outcome.status, usage: outcome.usage };
        case "failed":
          return { ...base, status: outcome.status, failureReason: outcome.reason, message: outcome.message, usage: outcome.usage };
        case "interrupted":
          return { ...base, status: outcome.status, message: outcome.message };
        case "timed_out":
        case "canceled":
          return { ...base, status: outcome.status };
      }
    },
  };
}
