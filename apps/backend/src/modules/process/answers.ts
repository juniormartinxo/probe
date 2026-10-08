import { sql } from "kysely";
import type { Db } from "../../db/database.ts";
import type { AnswerType } from "../ai/assistant.ts";

// Cada estado registrado de uma resposta. Traz os índices das alternativas escolhidas ou o texto
// livre, conforme a Pergunta.
export interface AnswerVersion {
  id: string;
  number: number;
  selectedOptions: number[] | null;
  text: string | null;
  createdAt: Date;
}

// A resposta de uma Pergunta: a Versão que vale e as superadas, da mais recente para a mais antiga.
export interface Answer {
  current: AnswerVersion;
  previous: AnswerVersion[];
}

// O que o usuário preencheu e ainda não salvou, e a Versão sobre a qual começou a alterar.
export interface AnswerDraft {
  basedOnVersionId: string | null;
  selectedOptions: number[] | null;
  text: string | null;
  updatedAt: Date;
}

export interface QuestionAnswers {
  answer: Answer | null;
  draft: AnswerDraft | null;
}

export async function answersOf(db: Db, questionIds: string[]): Promise<Map<string, QuestionAnswers>> {
  const found = new Map<string, QuestionAnswers>(questionIds.map((id) => [id, { answer: null, draft: null }]));
  if (questionIds.length === 0) return found;
  const versions = await db
    .selectFrom("answerVersions")
    .select(["id", "questionId", "number", "selectedOptions", "text", "createdAt"])
    .where("questionId", "in", questionIds)
    .orderBy("number", "desc")
    .execute();
  for (const { questionId, ...version } of versions) {
    const entry = found.get(questionId)!;
    if (entry.answer) entry.answer.previous.push(version);
    else entry.answer = { current: version, previous: [] };
  }
  const drafts = await db
    .selectFrom("answerDrafts")
    .select(["questionId", "basedOnVersionId", "selectedOptions", "text", "updatedAt"])
    .where("questionId", "in", questionIds)
    .execute();
  for (const { questionId, ...draft } of drafts) found.get(questionId)!.draft = draft;
  return found;
}

// Valor de uma resposta ou rascunho como chega do usuário: índices de alternativas ou texto livre.
export type AnswerValue = { selectedOptions: number[] } | { text: string };

export interface AnswerChange {
  value: AnswerValue;
  // A Versão que o usuário viu ao alterar; null na primeira resposta.
  basedOnVersionId: string | null;
}

type QuestionError = "process_not_found" | "process_not_open" | "question_not_found";

export type AnswerError = QuestionError | "invalid_answer" | "superseded_version";

export type DraftError = QuestionError | "invalid_draft";

export interface Answers {
  // Registra uma nova Versão, se a alteração partiu da Versão que vale; descarta o rascunho.
  record(
    processId: string,
    questionId: string,
    change: AnswerChange,
  ): Promise<{ ok: true; answerVersion: AnswerVersion } | { ok: false; error: AnswerError }>;
  // Guarda o que o usuário preencheu, mesmo incompleto, no lugar do rascunho anterior.
  saveDraft(
    processId: string,
    questionId: string,
    change: AnswerChange,
  ): Promise<{ ok: true; draft: AnswerDraft } | { ok: false; error: DraftError }>;
  discardDraft(processId: string, questionId: string): Promise<{ ok: true } | { ok: false; error: QuestionError }>;
}

interface QuestionShape {
  answerType: AnswerType;
  options: string[];
}

// Normaliza a resposta conforme o tipo da Pergunta, ou a recusa. Alternativas ficam em ordem.
function completeValue(
  { answerType, options }: QuestionShape,
  value: AnswerValue,
): { selectedOptions: number[]; text: null } | { selectedOptions: null; text: string } | undefined {
  if (answerType === "free_text") {
    if (!("text" in value) || value.text.trim() === "") return undefined;
    return { selectedOptions: null, text: value.text.trim() };
  }
  if (!("selectedOptions" in value)) return undefined;
  const selected = [...value.selectedOptions].sort((a, b) => a - b);
  if (selected.some((option, index) => option >= options.length || selected[index - 1] === option)) return undefined;
  if (answerType === "single_choice" ? selected.length !== 1 : selected.length === 0) return undefined;
  return { selectedOptions: selected, text: null };
}

// Um rascunho pode estar incompleto, mas não pode ser de outro tipo de resposta.
function draftValue(
  { answerType, options }: QuestionShape,
  value: AnswerValue,
): { selectedOptions: number[]; text: null } | { selectedOptions: null; text: string } | undefined {
  if (answerType === "free_text") return "text" in value ? { selectedOptions: null, text: value.text } : undefined;
  if (!("selectedOptions" in value)) return undefined;
  const selected = [...new Set(value.selectedOptions)].sort((a, b) => a - b);
  if (selected.some((option) => option >= options.length)) return undefined;
  if (answerType === "single_choice" && selected.length > 1) return undefined;
  return { selectedOptions: selected, text: null };
}

// Trava o Processo para a transação e encontra nele a Pergunta.
async function lockQuestion(
  trx: Db,
  processId: string,
  questionId: string,
): Promise<{ ok: true; question: QuestionShape } | { ok: false; error: QuestionError }> {
  const process = await trx.selectFrom("processes").select("status").where("id", "=", processId).forUpdate().executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  const question = await trx
    .selectFrom("questions")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select(["questions.answerType", "questions.options"])
    .where("questions.id", "=", questionId)
    .where("blocks.processId", "=", processId)
    .executeTakeFirst();
  if (!question) return { ok: false, error: "question_not_found" };
  return { ok: true, question };
}

export function answers({ db }: { db: Db }): Answers {
  return {
    async record(processId, questionId, { value, basedOnVersionId }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockQuestion(trx, processId, questionId);
        if (!locked.ok) return locked;
        const complete = completeValue(locked.question, value);
        if (!complete) return { ok: false, error: "invalid_answer" } as const;
        const current = await trx
          .selectFrom("answerVersions")
          .select(["id", "number"])
          .where("questionId", "=", questionId)
          .orderBy("number", "desc")
          .executeTakeFirst();
        // Alteração feita sobre uma Versão que já não vale (outra aba, por exemplo) é recusada.
        if ((current?.id ?? null) !== basedOnVersionId) return { ok: false, error: "superseded_version" } as const;
        const answerVersion = await trx
          .insertInto("answerVersions")
          .values({ questionId, number: (current?.number ?? 0) + 1, ...complete })
          .returning(["id", "number", "selectedOptions", "text", "createdAt"])
          .executeTakeFirstOrThrow();
        await trx.deleteFrom("answerDrafts").where("questionId", "=", questionId).execute();
        return { ok: true, answerVersion } as const;
      });
    },


    async saveDraft(processId, questionId, { value, basedOnVersionId }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockQuestion(trx, processId, questionId);
        if (!locked.ok) return locked;
        const content = draftValue(locked.question, value);
        if (!content) return { ok: false, error: "invalid_draft" } as const;
        if (basedOnVersionId !== null) {
          const base = await trx
            .selectFrom("answerVersions")
            .select("id")
            .where("id", "=", basedOnVersionId)
            .where("questionId", "=", questionId)
            .executeTakeFirst();
          if (!base) return { ok: false, error: "invalid_draft" } as const;
        }
        const row = { basedOnVersionId, ...content, updatedAt: sql<Date>`clock_timestamp()` };
        const draft = await trx
          .insertInto("answerDrafts")
          .values({ questionId, ...row })
          .onConflict((oc) => oc.column("questionId").doUpdateSet(row))
          .returning(["basedOnVersionId", "selectedOptions", "text", "updatedAt"])
          .executeTakeFirstOrThrow();
        return { ok: true, draft } as const;
      });
    },

    async discardDraft(processId, questionId) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockQuestion(trx, processId, questionId);
        if (!locked.ok) return locked;
        await trx.deleteFrom("answerDrafts").where("questionId", "=", questionId).execute();
        return { ok: true } as const;
      });
    },
  };
}
