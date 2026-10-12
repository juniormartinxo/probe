import type { Db } from "../../db/database.ts";
import { startConversation } from "../conversation/conversation.ts";
import { describeAnswer } from "./answers.ts";
import type { Block } from "./blocks.ts";
import type { ChosenOption } from "./chosen-options.ts";
import type { ConstraintsAndPreferencesState, StatedItem } from "./constraints-and-preferences.ts";
import type { ExecutionPlanElement } from "./execution-plan.ts";
import type { ConfirmedSet } from "./finalization.ts";
import type { DecisionSummary } from "../reports/report.ts";
import { copyProcessRecords, insertInChunks, type CopiedRecord } from "./process-copy.ts";
import { stages } from "./stage.ts";

// A Reconsideração reabre uma Decisão para revisá-la; o Desdobramento estabelece um problema novo.
export type DerivationKind = "reconsideration" | "spinoff";

// O que mudou na Derivação em relação ao conjunto confirmado da origem: o estado na origem (null no
// que foi acrescentado) e o que vale agora (null no que foi retirado).
export interface OriginChange {
  kind: "answer" | "constraint" | "preference" | "choice" | "plan_element";
  subject: string;
  before: string | null;
  after: string | null;
}

// A origem de um Processo derivado: numa Reconsideração, o que mudou desde ela; num Desdobramento, a
// Decisão dela, copiada só como contexto: nunca é resposta, Escolha nem plano do Desdobramento.
export type Derivation =
  | { kind: "reconsideration"; originProcessId: string; originFinalizedAt: Date; changes: OriginChange[] }
  | { kind: "spinoff"; originProcessId: string; originFinalizedAt: Date; originDecision: DecisionSummary };

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

// A Derivação de que o Processo veio, com o que ela herdou; undefined num Processo que não é derivado.
export async function derivationRecordOf(db: Db, processId: string) {
  return db
    .selectFrom("derivations")
    .innerJoin("finalizations", "finalizations.processId", "derivations.originProcessId")
    .select([
      "derivations.kind",
      "derivations.originProcessId",
      "derivations.inheritedSet",
      "derivations.originDecision",
      "finalizations.finalizedAt as originFinalizedAt",
    ])
    .where("derivations.processId", "=", processId)
    .executeTakeFirst();
}

export type ReconsiderationError = "process_not_found" | "process_not_finalized";

// Trava a origem, finalizada, para a leitura: finalizada, ela não muda mais; a trava só evita lê-la no
// meio de uma Finalização.
async function lockFinalizedOrigin(trx: Db, originId: string) {
  const origin = await trx
    .selectFrom("processes")
    .select(["id", "status", "originalDescription", "currentStage", "stagePointsVersion"])
    .where("id", "=", originId)
    .forShare()
    .executeTakeFirst();
  if (!origin) return { ok: false, error: "process_not_found" } as const;
  const finalization = await trx.selectFrom("finalizations").select(["confirmedSet", "report"]).where("processId", "=", originId).executeTakeFirst();
  if (origin.status !== "finalized" || !finalization) return { ok: false, error: "process_not_finalized" } as const;
  return { ok: true, origin, finalization } as const;
}

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

export function reconsiderations({ db }: { db: Db }): Reconsiderations {
  return {
    async create(originId) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockFinalizedOrigin(trx, originId);
        if (!locked.ok) return locked;
        const { origin, finalization } = locked;

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
        await insertInChunks(
          trx,
          "derivationCopies",
          copied.map(({ table, originId, copyId }) => ({ processId: process.id, tableName: table, originId, copyId })),
        );
        return { ok: true, processId: process.id } as const;
      });
    },
  };
}

export type SpinoffError = ReconsiderationError | "invalid_inherited_answers";

// O que o usuário traz para o Desdobramento: o problema novo, com as palavras dele, e as respostas da
// origem que escolheu herdar, pelas Versões do conjunto confirmado dela.
export interface SpinoffRequest {
  description: string;
  answerVersionIds: string[];
}

export interface Spinoffs {
  // Abre um Desdobramento do Processo finalizado: um Processo novo, aberto, na Etapa P, para o problema
  // novo, com a Decisão da origem como contexto. A origem não muda.
  create(originId: string, request: SpinoffRequest): Promise<{ ok: true; processId: string } | { ok: false; error: SpinoffError }>;
}

// As Versões escolhidas, cada uma com a Pergunta que ela responde, na ordem em que a origem as perguntou.
async function inheritedAnswersOf(trx: Db, answerVersionIds: string[]) {
  if (answerVersionIds.length === 0) return [];
  return trx
    .selectFrom("answerVersions")
    .innerJoin("questions", "questions.id", "answerVersions.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select([
      "answerVersions.id as versionId",
      "answerVersions.selectedChoices",
      "answerVersions.text",
      "questions.id as questionId",
      "questions.wording",
      "questions.subject",
      "questions.contextRelation",
      "questions.rationale",
      "questions.stagePoints",
      "questions.answerType",
      "questions.choices",
      "blocks.stage",
    ])
    .where("answerVersions.id", "in", answerVersionIds)
    .orderBy("blocks.number")
    .orderBy("questions.position")
    .execute();
}

export function spinoffs({ db }: { db: Db }): Spinoffs {
  return {
    async create(originId, { description, answerVersionIds }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockFinalizedOrigin(trx, originId);
        if (!locked.ok) return locked;
        const { origin, finalization } = locked;
        // Só se herdam respostas: as Versões que valiam na Finalização da origem, cada uma uma vez.
        const confirmed = new Set(finalization.confirmedSet.answerVersionIds);
        if (new Set(answerVersionIds).size !== answerVersionIds.length || answerVersionIds.some((id) => !confirmed.has(id))) {
          return { ok: false, error: "invalid_inherited_answers" } as const;
        }
        const inherited = await inheritedAnswersOf(trx, answerVersionIds);

        // A lista de Pontos da origem: as Respostas herdadas servem aos Pontos pelas chaves dela.
        const process = await trx
          .insertInto("processes")
          .values({ originalDescription: description, stagePointsVersion: origin.stagePointsVersion })
          .returning("id")
          .executeTakeFirstOrThrow();
        await startConversation(trx, process.id);
        await trx
          .insertInto("derivations")
          .values({
            processId: process.id,
            originProcessId: originId,
            kind: "spinoff",
            inheritedSet: null,
            originDecision: JSON.stringify(finalization.report.decisionSummary),
          })
          .execute();

        // Um Bloco de Respostas herdadas por Etapa, na ordem do PROBE: cópias das Perguntas, cada uma com
        // a resposta como Versão 1, ainda provisória. Só a Confirmação da síntese do Bloco as faz valer.
        const copied: CopiedRecord[] = [];
        let number = 0;
        for (const stage of stages) {
          const ofStage = inherited.filter((row) => row.stage === stage);
          if (ofStage.length === 0) continue;
          number += 1;
          const block = await trx
            .insertInto("blocks")
            .values({ processId: process.id, number, stage, attemptId: null })
            .returning("id")
            .executeTakeFirstOrThrow();
          for (const [position, row] of ofStage.entries()) {
            const question = await trx
              .insertInto("questions")
              .values({
                blockId: block.id,
                position,
                wording: row.wording,
                subject: row.subject,
                contextRelation: row.contextRelation,
                rationale: row.rationale,
                stagePoints: row.stagePoints,
                answerType: row.answerType,
                choices: row.choices,
                reformulatesQuestionId: null,
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            const version = await trx
              .insertInto("answerVersions")
              .values({ questionId: question.id, number: 1, selectedChoices: row.selectedChoices, text: row.text })
              .returning("id")
              .executeTakeFirstOrThrow();
            copied.push(
              { table: "questions", originId: row.questionId, copyId: question.id },
              { table: "answer_versions", originId: row.versionId, copyId: version.id },
            );
          }
        }
        await insertInChunks(
          trx,
          "derivationCopies",
          copied.map(({ table, originId, copyId }) => ({ processId: process.id, tableName: table, originId, copyId })),
        );
        return { ok: true, processId: process.id } as const;
      });
    },
  };
}
