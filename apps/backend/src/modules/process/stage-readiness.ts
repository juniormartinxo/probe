import type { Db } from "../../db/database.ts";
import { describeAnswer } from "./answers.ts";
import { constraintsAndPreferencesOf, inForce, type StatedItem } from "./constraints-and-preferences.ts";
import { stagePointStates, type StagePointState } from "./stage-point-coverage.ts";
import type { ConfirmedStageAnswers } from "../ai/assistant.ts";
import { stages, type Stage } from "./stage.ts";

// Resposta confirmada de uma Pergunta da Etapa: a Versão mais recente que uma Confirmação da síntese
// de bloco confirmou. Uma Versão posterior, ainda provisória, não entra.
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
  const rows = await db
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
    .distinctOn("answerVersions.questionId")
    .where("blocks.processId", "=", processId)
    .where("blocks.stage", "=", stage)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("attemptAnswerVersions")
          .innerJoin("blockSyntheses", "blockSyntheses.proposalId", "attemptAnswerVersions.attemptId")
          .select("attemptAnswerVersions.answerVersionId")
          .whereRef("attemptAnswerVersions.answerVersionId", "=", "answerVersions.id"),
      ),
    )
    .orderBy("answerVersions.questionId")
    .orderBy("answerVersions.number", "desc")
    .execute();
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

export interface ReadyStage {
  process: { id: string; stagePointsVersion: number };
  stage: Stage;
  problemStatement: string;
  stagePoints: StagePointState[];
  answers: ConfirmedAnswer[];
  // As Restrições e Preferências em vigor.
  constraints: StatedItem[];
  preferences: StatedItem[];
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
  const { constraints, preferences } = await constraintsAndPreferencesOf(db, processId);
  return {
    ok: true,
    ready: {
      process: { id: process.id, stagePointsVersion: process.stagePointsVersion },
      stage,
      problemStatement: confirmed.statement,
      stagePoints,
      answers: await confirmedAnswersOf(db, processId, stage),
      constraints: inForce(constraints),
      preferences: inForce(preferences),
    },
  };
}
