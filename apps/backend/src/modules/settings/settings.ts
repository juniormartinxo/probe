import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database.ts";
import type { AttemptStatus } from "../ai/ai-requests.ts";
import type { Assistant, Cli, FailureReason, Usage } from "../ai/assistant.ts";

// Configurações não sensíveis, guardadas no banco. Segredos ficam no ambiente do backend e nunca
// fazem parte delas.
export interface Settings {
  // Modelo do claude usado nas novas solicitações à IA.
  claudeModel: string;
}

export type SettingsError = "invalid_model";

// Desfecho de um teste de conexão: a CLI e o modelo usados e, se não concluiu, por quê.
export interface ConnectionTest {
  cli: Cli;
  model: string;
  status: Exclude<AttemptStatus, "running">;
  failureReason: FailureReason | null;
  message: string | null;
  usage: Usage | null;
}

export interface SettingsModule {
  find(): Promise<Settings>;
  save(settings: { claudeModel: unknown }): Promise<{ ok: true; settings: Settings } | { ok: false; error: SettingsError }>;
  // Chamada paga à IA: só por ação explícita do usuário. Não pertence a nenhum Processo.
  testConnection(signal: AbortSignal): Promise<ConnectionTest>;
}

// O mesmo formato que o executor aceita: alias ("sonnet") ou nome completo ("claude-opus-5-5[1m]"),
// começando por letra ou dígito para nunca ser lido como opção da CLI.
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

const isModel = (value: unknown): value is string => typeof value === "string" && modelPattern.test(value);

export function settings(deps: { db: Db; assistant: Assistant; defaultAiModel: string }): SettingsModule {
  const { db, assistant, defaultAiModel } = deps;

  async function find(): Promise<Settings> {
    const row = await db.selectFrom("settings").select("claudeModel").executeTakeFirst();
    return { claudeModel: row?.claudeModel ?? defaultAiModel };
  }

  return {
    find,

    async save({ claudeModel }) {
      if (!isModel(claudeModel)) return { ok: false, error: "invalid_model" };
      const saved = await db
        .insertInto("settings")
        .values({ claudeModel })
        .onConflict((oc) => oc.column("id").doUpdateSet({ claudeModel, updatedAt: new Date() }))
        .returning("claudeModel")
        .executeTakeFirstOrThrow();
      return { ok: true, settings: saved };
    },

    async testConnection(signal) {
      const { claudeModel: model } = await find();
      const outcome = await assistant.testConnection({ id: `connection-test-${randomUUID()}`, model, signal });
      const base = { cli: assistant.cli, model, failureReason: null, message: null, usage: null };
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
