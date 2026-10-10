import type { Db } from "../../db/database.ts";
import { confirmedVersionIdsOf, describeAnswer } from "./answers.ts";
import {
  constraintsAndPreferencesOf,
  inForceOf,
  itemsApplyTo,
  type ConstraintsAndPreferencesState,
} from "./constraints-and-preferences.ts";
import { stagePointStates, type StagePointState } from "./stage-point-coverage.ts";
import type { ConfirmedStageAnswers } from "../ai/assistant.ts";
import { stages, type Stage } from "./stage.ts";

// Resposta confirmada de uma Pergunta da Etapa: a Versão mais recente que uma Confirmação da síntese
// de bloco confirmou ou que a síntese do Bloco da Pergunta passou a sustentar depois de uma mudança.
// Uma Versão posterior, ainda provisória ou em reavaliação, não entra.
export interface ConfirmedAnswer {
  answerVersionId: string;
  questionId: string;
  // "2.1": Pergunta 1 do Bloco 2.
  ref: string;
  wording: string;
  answer: string;
}

// As respostas confirmadas da Etapa, na ordem dos Blocos e das Perguntas.
export async function confirmedAnswersOf(db: Db, processId: string, stage: Stage): Promise<ConfirmedAnswer[]> {
  const versions = await db
    .selectFrom("answerVersions")
    .innerJoin("questions", "questions.id", "answerVersions.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select([
      "answerVersions.id",
      "answerVersions.questionId",
      "answerVersions.selectedChoices",
      "answerVersions.text",
      "questions.wording",
      "questions.choices",
      "questions.position",
      "blocks.number as blockNumber",
    ])
    .where("blocks.processId", "=", processId)
    .where("blocks.stage", "=", stage)
    .orderBy("answerVersions.questionId")
    .orderBy("answerVersions.number", "desc")
    .execute();
  const confirmed = await confirmedVersionIdsOf(
    db,
    versions.map((version) => version.id),
  );
  // A mais recente confirmada de cada Pergunta (as Versões vêm da mais nova para a mais antiga).
  const rows = versions.filter(
    (version, index) =>
      confirmed.has(version.id) &&
      !versions.slice(0, index).some((newer) => newer.questionId === version.questionId && confirmed.has(newer.id)),
  );
  return rows
    .toSorted((a, b) => a.blockNumber - b.blockNumber || a.position - b.position)
    .map((row) => ({
      answerVersionId: row.id,
      questionId: row.questionId,
      ref: `${row.blockNumber}.${row.position + 1}`,
      wording: row.wording,
      answer: describeAnswer(row, row),
    }));
}

// As respostas confirmadas de cada Etapa anterior à atual, todas já confirmadas (as Etapas são
// lineares), na ordem do PROBE.
export async function confirmedStagesOf(db: Db, processId: string, current: Stage): Promise<ConfirmedStageAnswers[]> {
  return Promise.all(
    stages.slice(0, stages.indexOf(current)).map(async (stage) => ({
      stage,
      answers: (await confirmedAnswersOf(db, processId, stage)).map(({ ref, wording, answer }) => ({ ref, wording, answer })),
    })),
  );
}

export type StageNotReady =
  | "process_not_found"
  | "process_not_open"
  | "stage_not_current"
  | "problem_statement_not_confirmed"
  | "open_stage_points";

export interface ReadyStage extends ConstraintsAndPreferencesState {
  process: { id: string; stagePointsVersion: number };
  stage: Stage;
  problemStatement: string;
  stagePoints: StagePointState[];
  answers: ConfirmedAnswer[];
  // Restrições e Preferências: as em vigor, nas Etapas a partir de R; nenhuma antes.
}

// A Etapa atual de um Processo aberto, com o enunciado confirmado e nenhum Ponto aberto: o que a
// Avaliação do Jev e a Confirmação da Etapa exigem. Com `lock`, trava o Processo para a transação.
export async function readyStage(
  db: Db,
  processId: string,
  stage: Stage,
  { lock }: { lock: boolean },
): Promise<{ ok: true; ready: ReadyStage } | { ok: false; error: StageNotReady }> {
  let query = db
    .selectFrom("processes")
    .select(["id", "status", "currentStage", "stagePointsVersion"])
    .where("id", "=", processId);
  if (lock) query = query.forUpdate();
  const process = await query.executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  if (process.currentStage !== stage) return { ok: false, error: "stage_not_current" };
  const confirmed = await db.selectFrom("problemStatements").select("statement").where("processId", "=", processId).executeTakeFirst();
  if (!confirmed) return { ok: false, error: "problem_statement_not_confirmed" };
  const stagePoints = await stagePointStates(db, process, stage);
  if (stagePoints.some((point) => point.status === "open")) return { ok: false, error: "open_stage_points" };
  const items = itemsApplyTo(stage) ? inForceOf(await constraintsAndPreferencesOf(db, processId)) : { constraints: [], preferences: [] };
  return {
    ok: true,
    ready: {
      process: { id: process.id, stagePointsVersion: process.stagePointsVersion },
      stage,
      problemStatement: confirmed.statement,
      stagePoints,
      answers: await confirmedAnswersOf(db, processId, stage),
      ...items,
    },
  };
}
