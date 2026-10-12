import type { Selectable } from "kysely";
import type { Db, ProcessTable } from "../../db/database.ts";
import {
  findConversationOfProcess,
  startConversation,
  type Conversation,
} from "../conversation/conversation.ts";
import type { DerivationKind } from "./derivations.ts";
import { CURRENT_STAGE_POINTS_VERSION } from "./stage-points.ts";
import { stages, type Stage } from "./stage.ts";

export type ProcessStatus = "open" | "finalized";

export type Process = Selectable<ProcessTable>;

export interface ProcessWithConversation extends Process {
  conversation: Conversation;
}

// O Processo nasce aberto, na Etapa P, com a descrição original intacta, uma Conversa vazia e a
// versão atual da lista de Pontos da etapa.
export async function createProcess(db: Db, originalDescription: string): Promise<ProcessWithConversation> {
  return db.transaction().execute(async (trx) => {
    const process = await trx
      .insertInto("processes")
      .values({ originalDescription, stagePointsVersion: CURRENT_STAGE_POINTS_VERSION })
      .returningAll()
      .executeTakeFirstOrThrow();
    const conversation = await startConversation(trx, process.id);
    return { ...process, conversation };
  });
}

export async function findProcess(db: Db, id: string): Promise<ProcessWithConversation | undefined> {
  const process = await db.selectFrom("processes").selectAll().where("id", "=", id).executeTakeFirst();
  if (!process) return undefined;
  return { ...process, conversation: await findConversationOfProcess(db, id) };
}

// Cada Processo com a Derivação de que veio, se veio de uma.
export interface ListedProcess extends Process {
  derivation: { kind: DerivationKind; originProcessId: string } | null;
}

export async function listProcesses(db: Db): Promise<ListedProcess[]> {
  const rows = await db
    .selectFrom("processes")
    .leftJoin("derivations", "derivations.processId", "processes.id")
    .selectAll("processes")
    .select(["derivations.kind as derivationKind", "derivations.originProcessId"])
    .orderBy("processes.createdAt", "desc")
    .orderBy("processes.id", "desc")
    .execute();
  return rows.map(({ derivationKind, originProcessId, ...process }) => ({
    ...process,
    derivation: derivationKind && originProcessId ? { kind: derivationKind, originProcessId } : null,
  }));
}

// Trava o Processo aberto para a transação.
export async function lockOpenProcess(trx: Db, processId: string) {
  const process = await trx
    .selectFrom("processes")
    .select(["id", "status", "currentStage", "stagePointsVersion"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" } as const;
  if (process.status !== "open") return { ok: false, error: "process_not_open" } as const;
  return { ok: true, process } as const;
}

// Trava o Processo aberto que já chegou à Etapa dada (ela ou uma seguinte) para a transação.
export async function lockOpenProcessFrom(trx: Db, processId: string, stage: Stage) {
  const locked = await lockOpenProcess(trx, processId);
  if (!locked.ok) return locked;
  if (stages.indexOf(locked.process.currentStage) < stages.indexOf(stage)) return { ok: false, error: "stage_not_current" } as const;
  return locked;
}

// A Etapa E foi confirmada: o Processo está pronto para a Revisão final, em que o plano e a Escolha
// ainda podem mudar até a Finalização (ADR 0009).
export async function executionConfirmed(db: Db, processId: string): Promise<boolean> {
  const row = await db
    .selectFrom("stageConfirmations")
    .select("stage")
    .where("processId", "=", processId)
    .where("stage", "=", "E")
    .executeTakeFirst();
  return row !== undefined;
}
