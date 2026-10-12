import type { Db } from "../../db/database.ts";
import { startConversation } from "../conversation/conversation.ts";
import { describeAnswer } from "./answers.ts";
import type { Block } from "./blocks.ts";
import type { ChosenOption } from "./chosen-options.ts";
import type { ConstraintsAndPreferencesState, StatedItem } from "./constraints-and-preferences.ts";
import type { ExecutionPlanElement } from "./execution-plan.ts";
import type { ConfirmedSet } from "./finalization.ts";
import { copyProcessRecords } from "./process-copy.ts";

// Por ora, a Derivação que reabre uma Decisão para revisá-la; o Desdobramento vem depois (PRB-31).
export type DerivationKind = "reconsideration";

// O que mudou na Derivação em relação ao conjunto confirmado da origem: o estado na origem (null no
// que foi acrescentado) e o que vale agora (null no que foi retirado).
export interface OriginChange {
  kind: "answer" | "constraint" | "preference" | "choice" | "plan_element";
  subject: string;
  before: string | null;
  after: string | null;
}

// A origem de um Processo derivado e o que mudou desde ela.
export interface Derivation {
  kind: DerivationKind;
  originProcessId: string;
  // Quando a origem foi finalizada.
  originFinalizedAt: Date;
  changes: OriginChange[];
}

// O Processo como a comparação com a origem o lê, no estado que vale agora.
export interface DerivedState extends ConstraintsAndPreferencesState {
  blocks: Block[];
  chosenOptions: ChosenOption[];
  executionPlan: ExecutionPlanElement[];
}

function answerChanges(inherited: Set<string>, blocks: Block[]): OriginChange[] {
  return blocks.flatMap((block) =>
    block.questions.flatMap((question, index): OriginChange[] => {
      if (!question.answer) return [];
      const { current, previous } = question.answer;
      const origin = [current, ...previous].find((version) => inherited.has(version.id));
      const before = origin ? describeAnswer(question, origin) : null;
      const after = describeAnswer(question, current);
      return before === after ? [] : [{ kind: "answer", subject: `${block.stage} ${block.number}.${index + 1}: ${question.wording}`, before, after }];
    }),
  );
}

// Restrições ou Preferências retiradas da origem e as que entraram em vigor depois dela.
function itemChanges(kind: "constraint" | "preference", inherited: string[], items: StatedItem[]): OriginChange[] {
  const subject = kind === "constraint" ? "Restrição" : "Preferência";
  const withdrawn = items.filter((item) => inherited.includes(item.id) && item.withdrawnAt !== null);
  const added = items.filter((item) => !inherited.includes(item.id) && item.withdrawnAt === null);
  return [
    ...withdrawn.map((item) => ({ kind, subject, before: item.statement, after: null })),
    ...added.map((item) => ({ kind, subject, before: null, after: item.statement })),
  ];
}

function choiceChanges(inherited: string, chosenOptions: ChosenOption[]): OriginChange[] {
  const before = chosenOptions.find((chosen) => chosen.id === inherited)!.option.statement;
  const after = chosenOptions.at(-1)!.option.statement;
  return before === after ? [] : [{ kind: "choice", subject: "Escolha", before, after }];
}

function planChanges(inherited: string[], plan: ExecutionPlanElement[]): OriginChange[] {
  return plan.flatMap((element): OriginChange[] => {
    if (!element.current) return [];
    const before = [element.current, ...element.history].find((text) => inherited.includes(text.id))?.text ?? null;
    const after = element.current.text;
    return before === after ? [] : [{ kind: "plan_element", subject: element.name, before, after }];
  });
}

// O que mudou em relação ao conjunto confirmado da origem, pelo conteúdo: uma resposta que mudou e
// voltou ao que era não conta.
export function changesFromOrigin(inherited: ConfirmedSet, state: DerivedState): OriginChange[] {
  return [
    ...answerChanges(new Set(inherited.answerVersionIds), state.blocks),
    ...itemChanges("constraint", inherited.constraintIds, state.constraints),
    ...itemChanges("preference", inherited.preferenceIds, state.preferences),
    ...choiceChanges(inherited.chosenOptionId, state.chosenOptions),
    ...planChanges(inherited.planElementIds, state.executionPlan),
  ];
}

// A Derivação de que o Processo veio, com o conjunto herdado; undefined num Processo que não é derivado.
export async function derivationRecordOf(db: Db, processId: string) {
  return db
    .selectFrom("derivations")
    .innerJoin("finalizations", "finalizations.processId", "derivations.originProcessId")
    .select(["derivations.kind", "derivations.originProcessId", "derivations.inheritedSet", "finalizations.finalizedAt as originFinalizedAt"])
    .where("derivations.processId", "=", processId)
    .executeTakeFirst();
}

export type ReconsiderationError = "process_not_found" | "process_not_finalized";

export interface Reconsiderations {
  // Abre uma Reconsideração do Processo finalizado: um Processo novo, aberto, na Etapa em que a origem
  // terminou, com uma cópia identificada de tudo o que ela registrou. A origem não muda.
  create(originId: string): Promise<{ ok: true; processId: string } | { ok: false; error: ReconsiderationError }>;
}

// O conjunto confirmado da origem, pelos ids das cópias.
function inheritedSetOf(set: ConfirmedSet, ids: Map<string, string>): ConfirmedSet {
  const copy = (id: string) => ids.get(id)!;
  return {
    problemStatement: set.problemStatement,
    answerVersionIds: set.answerVersionIds.map(copy),
    constraintIds: set.constraintIds.map(copy),
    preferenceIds: set.preferenceIds.map(copy),
    chosenOptionId: copy(set.chosenOptionId),
    planElementIds: set.planElementIds.map(copy),
  };
}

// Até quantas cópias vão num único insert.
const INSERT_CHUNK = 1000;

export function reconsiderations({ db }: { db: Db }): Reconsiderations {
  return {
    async create(originId) {
      return db.transaction().execute(async (trx) => {
        // Finalizado, o Processo não muda mais; a trava só evita ler a origem no meio de uma Finalização.
        const origin = await trx
          .selectFrom("processes")
          .select(["id", "status", "originalDescription", "currentStage", "stagePointsVersion"])
          .where("id", "=", originId)
          .forShare()
          .executeTakeFirst();
        if (!origin) return { ok: false, error: "process_not_found" } as const;
        const finalization = await trx.selectFrom("finalizations").select("confirmedSet").where("processId", "=", originId).executeTakeFirst();
        if (origin.status !== "finalized" || !finalization) return { ok: false, error: "process_not_finalized" } as const;

        const process = await trx
          .insertInto("processes")
          .values({ originalDescription: origin.originalDescription, currentStage: origin.currentStage, stagePointsVersion: origin.stagePointsVersion })
          .returning("id")
          .executeTakeFirstOrThrow();
        await startConversation(trx, process.id);
        const copied = await copyProcessRecords(trx, originId, process.id);
        const ids = new Map(copied.map((record) => [record.originId, record.copyId]));
        await trx
          .insertInto("derivations")
          .values({
            processId: process.id,
            originProcessId: originId,
            kind: "reconsideration",
            inheritedSet: JSON.stringify(inheritedSetOf(finalization.confirmedSet, ids)),
          })
          .execute();
        for (let start = 0; start < copied.length; start += INSERT_CHUNK) {
          await trx
            .insertInto("derivationCopies")
            .values(copied.slice(start, start + INSERT_CHUNK).map(({ table, originId, copyId }) => ({ processId: process.id, tableName: table, originId, copyId })))
            .execute();
        }
        return { ok: true, processId: process.id } as const;
      });
    },
  };
}
