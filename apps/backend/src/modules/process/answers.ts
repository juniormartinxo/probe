import { sql } from "kysely";
import type { Db } from "../../db/database.ts";
import type { AnswerType } from "../ai/assistant.ts";

// Cada estado registrado de uma resposta. Traz os índices das alternativas escolhidas ou o texto
// livre, conforme a Pergunta.
export interface AnswerVersion {
  id: string;
  number: number;
  selectedChoices: number[] | null;
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
  selectedChoices: number[] | null;
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
    .select(["id", "questionId", "number", "selectedChoices", "text", "createdAt"])
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
    .select(["questionId", "basedOnVersionId", "selectedChoices", "text", "updatedAt"])
    .where("questionId", "in", questionIds)
    .execute();
  for (const { questionId, ...draft } of drafts) found.get(questionId)!.draft = draft;
  return found;
}

// Valor de uma resposta ou rascunho como chega do usuário: índices de alternativas ou texto livre.
export type AnswerValue = { selectedChoices: number[] } | { text: string };

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
  choices: string[];
}

type StoredValue = { selectedChoices: number[]; text: null } | { selectedChoices: null; text: string };

// Lê o valor conforme o tipo da Pergunta, ou o recusa; alternativas ficam em ordem. Uma resposta
// precisa estar completa; um rascunho pode estar incompleto, mas não ser de outro tipo.
function valueFor(
  { answerType, choices }: QuestionShape,
  value: AnswerValue,
  { complete }: { complete: boolean },
): StoredValue | undefined {
  if (answerType === "free_text") {
    if (!("text" in value)) return undefined;
    if (!complete) return { selectedChoices: null, text: value.text };
    return value.text.trim() === "" ? undefined : { selectedChoices: null, text: value.text.trim() };
  }
  if (!("selectedChoices" in value)) return undefined;
  const selected = [...value.selectedChoices].sort((a, b) => a - b);
  if (selected.some((choice, index) => choice >= choices.length || selected[index - 1] === choice)) return undefined;
  const most = answerType === "single_choice" ? 1 : choices.length;
  if (selected.length > most || (complete && selected.length === 0)) return undefined;
  return { selectedChoices: selected, text: null };
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
    .select(["questions.answerType", "questions.choices"])
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
        const complete = valueFor(locked.question, value, { complete: true });
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
          .returning(["id", "number", "selectedChoices", "text", "createdAt"])
          .executeTakeFirstOrThrow();
        await trx.deleteFrom("answerDrafts").where("questionId", "=", questionId).execute();
        return { ok: true, answerVersion } as const;
      });
    },


    async saveDraft(processId, questionId, { value, basedOnVersionId }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockQuestion(trx, processId, questionId);
        if (!locked.ok) return locked;
        const content = valueFor(locked.question, value, { complete: false });
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
          .returning(["basedOnVersionId", "selectedChoices", "text", "updatedAt"])
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
