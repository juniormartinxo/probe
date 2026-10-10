import type { Db } from "../../db/database.ts";
import { listAiRequests, type Attempt, type AttemptStatus } from "../ai/ai-requests.ts";
import type { GeneratedResolutionQuestion } from "../ai/assistant.ts";
import { describeAnswer } from "./answers.ts";
import type { Stage } from "./stage.ts";

// Resposta confirmada num par de conflito: a Versão que o Jev recebeu, como o usuário a vê.
// `superseded`: a Pergunta já tem uma Versão mais nova.
export interface ConflictingAnswerRef {
  answerVersionId: string;
  versionNumber: number;
  question: { id: string; wording: string; stage: Stage; blockNumber: number; number: number };
  answer: string;
  superseded: boolean;
}

// Par de respostas de uma verificação de conflito: a que acabou de ser confirmada e a outra.
export interface ConflictPairRef {
  id: string;
  checkId: string;
  position: number;
  answer: ConflictingAnswerRef;
  other: ConflictingAnswerRef;
}

// A Versão como o Jev e a IA a recebem: "2.1", Pergunta 1 do Bloco 2, com a Etapa.
export const conflictingAnswerOf = ({ question, answer }: ConflictingAnswerRef) => ({
  ref: `${question.blockNumber}.${question.number}`,
  stage: question.stage,
  wording: question.wording,
  answer,
});

// As respostas, pelas Versões dadas, como o usuário as vê.
export async function conflictingAnswersOf(db: Db, versionIds: string[]): Promise<Map<string, ConflictingAnswerRef>> {
  const found = new Map<string, ConflictingAnswerRef>();
  if (versionIds.length === 0) return found;
  const rows = await db
    .selectFrom("answerVersions")
    .innerJoin("questions", "questions.id", "answerVersions.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select([
      "answerVersions.id",
      "answerVersions.number",
      "answerVersions.selectedChoices",
      "answerVersions.text",
      "questions.id as questionId",
      "questions.wording",
      "questions.choices",
      "questions.position",
      "blocks.number as blockNumber",
      "blocks.stage",
    ])
    .select((eb) =>
      eb
        .selectFrom("answerVersions as newer")
        .select((inner) => inner.fn.max("newer.number").as("latest"))
        .whereRef("newer.questionId", "=", "answerVersions.questionId")
        .as("latestNumber"),
    )
    .where("answerVersions.id", "in", [...new Set(versionIds)])
    .execute();
  for (const row of rows) {
    found.set(row.id, {
      answerVersionId: row.id,
      versionNumber: row.number,
      question: { id: row.questionId, wording: row.wording, stage: row.stage, blockNumber: row.blockNumber, number: row.position + 1 },
      answer: describeAnswer(row, row),
      superseded: (row.latestNumber ?? row.number) > row.number,
    });
  }
  return found;
}

// Os pares de conflito do Processo, na ordem das verificações e, dentro de cada uma, dos pares. Com
// `pairIds`, só esses.
export async function conflictPairsOf(db: Db, processId: string, pairIds?: string[]): Promise<ConflictPairRef[]> {
  if (pairIds?.length === 0) return [];
  let query = db
    .selectFrom("conflictPairs")
    .innerJoin("conflictChecks", "conflictChecks.id", "conflictPairs.checkId")
    .select(["conflictPairs.id", "conflictPairs.checkId", "conflictPairs.position", "conflictPairs.answerVersionId", "conflictPairs.otherAnswerVersionId"])
    .where("conflictChecks.processId", "=", processId)
    .orderBy("conflictChecks.createdAt")
    .orderBy("conflictChecks.id")
    .orderBy("conflictPairs.position");
  if (pairIds) query = query.where("conflictPairs.id", "in", pairIds);
  const rows = await query.execute();
  const answers = await conflictingAnswersOf(
    db,
    rows.flatMap((row) => [row.answerVersionId, row.otherAnswerVersionId]),
  );
  return rows.map(({ answerVersionId, otherAnswerVersionId, ...row }) => ({
    ...row,
    answer: answers.get(answerVersionId)!,
    other: answers.get(otherAnswerVersionId)!,
  }));
}

// Os esclarecimentos com que o usuário resolveu Pendências de conflito, na ordem em que foram dados,
// cada um com as duas respostas como estavam, como o Jev e a IA os recebem.
export async function clarificationsOf(db: Db, processId: string) {
  const rows = await db
    .selectFrom("pendencies")
    .select(["conflictPairId", "resolutionNote"])
    .where("processId", "=", processId)
    .where("resolution", "=", "clarified")
    .orderBy("resolvedAt")
    .orderBy("id")
    .execute();
  const pairs = await conflictPairsOf(
    db,
    processId,
    rows.map((row) => row.conflictPairId!),
  );
  return rows.map((row) => {
    const pair = pairs.find((item) => item.id === row.conflictPairId)!;
    return {
      answers: [conflictingAnswerOf(pair.answer), conflictingAnswerOf(pair.other)] as [
        ReturnType<typeof conflictingAnswerOf>,
        ReturnType<typeof conflictingAnswerOf>,
      ],
      clarification: row.resolutionNote!,
    };
  });
}

export const RESOLUTION_QUESTION_OPERATION = "formulate_resolution_question";

// A pergunta de resolução que a IA formula para uma Pendência de conflito: sugestão para orientar o
// usuário, que resolve a Pendência como preferir.
export interface ResolutionQuestion {
  id: string;
  status: AttemptStatus;
  question: string | null;
  attempts: Attempt[];
}

export async function resolutionQuestionOf(db: Db, processId: string, pendencyId: string): Promise<ResolutionQuestion | null> {
  const request = (await listAiRequests<GeneratedResolutionQuestion>(db, processId, RESOLUTION_QUESTION_OPERATION, { pendencyId })).at(-1);
  if (!request) return null;
  return { id: request.id, status: request.status, question: request.result?.value.question ?? null, attempts: request.attempts };
}
