import type { Db } from "../../db/database.ts";
import type { AnswerType, AskedQuestion } from "../ai/assistant.ts";
import { describeAnswer } from "./answers.ts";
import type { Stage } from "./stage.ts";

// Pergunta já apresentada numa Etapa, com a Versão que vale da resposta e se o usuário registrou
// que não sabe. É o que se passa à IA para ela não perguntar de novo.
export interface StageQuestion {
  id: string;
  blockId: string;
  blockNumber: number;
  // "2.1": Pergunta 1 do Bloco 2.
  ref: string;
  wording: string;
  stagePoints: string[];
  answerType: AnswerType;
  choices: string[];
  // A Pergunta que esta reformula, se for uma reformulação.
  reformulatesQuestionId: string | null;
  currentVersionId: string | null;
  answer: string | null;
  unknown: boolean;
}

// As Perguntas da Etapa, na ordem dos Blocos e, dentro de cada um, na ordem em que foram feitas.
export async function stageQuestions(db: Db, processId: string, stage: Stage): Promise<StageQuestion[]> {
  const rows = await db
    .selectFrom("questions")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select([
      "questions.id",
      "questions.blockId",
      "blocks.number as blockNumber",
      "questions.position",
      "questions.wording",
      "questions.stagePoints",
      "questions.answerType",
      "questions.choices",
      "questions.reformulatesQuestionId",
    ])
    .where("blocks.processId", "=", processId)
    .where("blocks.stage", "=", stage)
    .orderBy("blocks.number")
    .orderBy("questions.position")
    .execute();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const versions = await db
    .selectFrom("answerVersions")
    .select(["id", "questionId", "selectedChoices", "text"])
    .distinctOn("questionId")
    .where("questionId", "in", ids)
    .orderBy("questionId")
    .orderBy("number", "desc")
    .execute();
  const unknown = await db
    .selectFrom("pendencies")
    .select("questionId")
    .where("questionId", "in", ids)
    .where("reason", "=", "unknown_information")
    .where("resolvedAt", "is", null)
    .execute();
  return rows.map(({ position, ...row }) => {
    const current = versions.find((version) => version.questionId === row.id);
    return {
      ...row,
      ref: `${row.blockNumber}.${position + 1}`,
      currentVersionId: current?.id ?? null,
      answer: current ? describeAnswer(row, current) : null,
      unknown: unknown.some((pendency) => pendency.questionId === row.id),
    };
  });
}

// As Versões que valem nas Perguntas, as que têm resposta.
export const currentVersionsOf = (questions: StageQuestion[]): string[] =>
  questions.flatMap((question) => (question.currentVersionId ? [question.currentVersionId] : []));

export const askedQuestionOf = ({ ref, wording, stagePoints, answer, unknown }: StageQuestion): AskedQuestion => ({
  ref,
  wording,
  stagePoints,
  answer,
  unknown,
});
