import type { Db } from "../../db/database.ts";
import { fingerprintOf, reportOf, type Report, type ReportSource } from "../reports/report.ts";
import { choiceBlockingStage, withChoiceCoverage, type ChoiceNotReady } from "./chosen-options.ts";
import { undecidedConflictsBlocking } from "./conflicts.ts";
import { undecidedConstraintReassessmentsBlocking } from "./constraint-reassessments.ts";
import { inForceOf } from "./constraints-and-preferences.ts";
import { planBlockingStage, withPlanCoverage, type PlanNotReady } from "./execution-plan.ts";
import { pendenciesBlockingStage } from "./pendencies.ts";
import { processDetailOf, type ProcessDetailDeps } from "./process-detail.ts";
import { executionConfirmed, lockOpenProcess } from "./process.ts";
import { undecidedReassessmentsBlocking } from "./reassessments.ts";
import { stagePointStates, type ProcessPoints } from "./stage-point-coverage.ts";
import { stages, type Stage } from "./stage.ts";

// A Etapa cujas Confirmações já exigem tudo o que a Finalização exige: a última.
const LAST_STAGE: Stage = "E";

// O conjunto confirmado que a Finalização congela, pelos ids: o enunciado, a Versão que vale de cada
// resposta, as Restrições e Preferências em vigor, a Escolha e os elementos do plano.
export interface ConfirmedSet {
  problemStatement: string;
  answerVersionIds: string[];
  constraintIds: string[];
  preferenceIds: string[];
  chosenOptionId: string;
  planElementIds: string[];
}

// O que impede a Finalização: qualquer Pendência aberta, uma Reavaliação ou um Conflito sem decisão,
// a Escolha que não se sustenta, um elemento do plano sem compatibilidade decidida ou uma Solicitação
// à IA em andamento (o resultado dela mudaria o Processo depois de congelado).
export type FinalizationBlocker =
  | { reason: "blocking_pendencies"; pendencyIds: string[] }
  | { reason: "undecided_reassessments" | "undecided_conflicts" | ChoiceNotReady | PlanNotReady | "ai_request_in_progress" };

// A Revisão final: o relatório como ficaria congelado agora, o que ainda impede a Finalização e a
// impressão digital que a Finalização precisa trazer (ADR 0009).
export interface FinalReview {
  report: Report;
  blockers: FinalizationBlocker[];
  fingerprint: string;
}

// A Finalização gravada: quando, e o relatório congelado.
export interface FrozenFinalization {
  finalizedAt: Date;
  report: Report;
}

type ReviewError = "process_not_found" | "process_not_open" | "execution_not_confirmed";

export type FinalizationError = ReviewError | Exclude<FinalizationBlocker["reason"], "blocking_pendencies"> | "final_review_outdated";

export interface Finalization {
  // A Revisão final de um Processo aberto com a Etapa E confirmada.
  review(processId: string): Promise<{ ok: true; finalReview: FinalReview } | { ok: false; error: ReviewError }>;
  // Finaliza o Processo sobre a Revisão final que o usuário viu, dada pela impressão digital: grava o
  // conjunto confirmado e o relatório e torna o Processo somente leitura, tudo na mesma transação.
  finalize(
    processId: string,
    fingerprint: string,
  ): Promise<
    | { ok: true; finalization: FrozenFinalization }
    | { ok: false; error: "blocking_pendencies"; pendencyIds: string[] }
    | { ok: false; error: FinalizationError }
  >;
  // A Finalização gravada de um Processo finalizado.
  find(processId: string): Promise<{ ok: true; finalization: FrozenFinalization } | { ok: false; error: "process_not_found" | "process_not_finalized" }>;
}

async function aiRequestRunning(db: Db, processId: string): Promise<boolean> {
  const running = await db
    .selectFrom("aiRequestAttempts")
    .innerJoin("aiRequests", "aiRequests.id", "aiRequestAttempts.aiRequestId")
    .select("aiRequestAttempts.id")
    .where("aiRequests.processId", "=", processId)
    .where("aiRequestAttempts.status", "=", "running")
    .executeTakeFirst();
  return running !== undefined;
}

// Com a Etapa E confirmada, o que a Confirmação dela exigia pode ter deixado de valer: uma Versão
// nova, uma Revisão de Restrição ou uma troca de Escolha feitas depois.
async function blockersOf(db: Db, process: ProcessPoints): Promise<FinalizationBlocker[]> {
  const blockers: FinalizationBlocker[] = [];
  const pendencyIds = await pendenciesBlockingStage(db, process.id, LAST_STAGE);
  if (pendencyIds.length > 0) blockers.push({ reason: "blocking_pendencies", pendencyIds });
  const undecided = [
    ...(await undecidedReassessmentsBlocking(db, process.id, LAST_STAGE)),
    ...(await undecidedConstraintReassessmentsBlocking(db, process.id, LAST_STAGE)),
  ];
  if (undecided.length > 0) blockers.push({ reason: "undecided_reassessments" });
  if ((await undecidedConflictsBlocking(db, process.id, LAST_STAGE)).length > 0) blockers.push({ reason: "undecided_conflicts" });
  const choice = await choiceBlockingStage(db, process, LAST_STAGE);
  if (choice) blockers.push({ reason: choice });
  // Sem Escolha que se sustente, o plano não tem contra o que ser compatível.
  const plan = choice ? null : await planBlockingStage(db, process, LAST_STAGE);
  if (plan) blockers.push({ reason: plan });
  if (await aiRequestRunning(db, process.id)) blockers.push({ reason: "ai_request_in_progress" });
  return blockers;
}

// O Processo como o relatório o lê: o detalhe e os Pontos de cada Etapa, com o da Escolha e os do plano.
async function reportSourceOf(deps: ProcessDetailDeps, processId: string): Promise<ReportSource> {
  const detail = (await processDetailOf(deps, processId))!;
  const byStage = await Promise.all(
    stages.map(async (stage) => [stage, await withPlanCoverage(deps.db, detail, await withChoiceCoverage(deps.db, detail, await stagePointStates(deps.db, detail, stage)))] as const),
  );
  return { ...detail, stagePointsByStage: Object.fromEntries(byStage) as ReportSource["stagePointsByStage"] };
}

function confirmedSetOf(source: ReportSource): ConfirmedSet {
  const inForce = inForceOf(source);
  return {
    problemStatement: source.problemStatement!.statement,
    answerVersionIds: source.blocks.flatMap((block) => block.questions.flatMap((question) => question.answer?.current.id ?? [])),
    constraintIds: inForce.constraints.map((item) => item.id),
    preferenceIds: inForce.preferences.map((item) => item.id),
    chosenOptionId: source.chosenOptions.at(-1)!.id,
    planElementIds: source.executionPlan.flatMap((element) => element.current?.id ?? []),
  };
}

export function finalization(deps: ProcessDetailDeps): Finalization {
  const { db } = deps;

  return {
    // Só lê: a Finalização é que confere, com o Processo travado, se nada mudou desde a Revisão.
    async review(processId) {
      const process = await db.selectFrom("processes").select(["id", "status", "stagePointsVersion"]).where("id", "=", processId).executeTakeFirst();
      if (!process) return { ok: false, error: "process_not_found" };
      if (process.status !== "open") return { ok: false, error: "process_not_open" };
      if (!(await executionConfirmed(db, processId))) return { ok: false, error: "execution_not_confirmed" };
      const report = reportOf(await reportSourceOf(deps, processId));
      return { ok: true, finalReview: { report, blockers: await blockersOf(db, process), fingerprint: fingerprintOf(report) } };
    },

    async finalize(processId, fingerprint) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        if (!(await executionConfirmed(trx, processId))) return { ok: false, error: "execution_not_confirmed" } as const;
        const [blocker] = await blockersOf(trx, locked.process);
        if (blocker?.reason === "blocking_pendencies") return { ok: false, error: blocker.reason, pendencyIds: blocker.pendencyIds } as const;
        if (blocker) return { ok: false, error: blocker.reason } as const;
        // O Processo está travado: o que se lê agora é o que fica congelado.
        const source = await reportSourceOf(deps, processId);
        const report = reportOf(source);
        if (fingerprintOf(report) !== fingerprint) return { ok: false, error: "final_review_outdated" } as const;
        const confirmedSet = confirmedSetOf(source);
        const { finalizedAt } = await trx
          .insertInto("finalizations")
          .values({
            processId,
            chosenOptionId: confirmedSet.chosenOptionId,
            fingerprint,
            confirmedSet: JSON.stringify(confirmedSet),
            report: JSON.stringify(report),
          })
          .returning("finalizedAt")
          .executeTakeFirstOrThrow();
        await trx.updateTable("processes").set({ status: "finalized" }).where("id", "=", processId).execute();
        return { ok: true, finalization: { finalizedAt, report } } as const;
      });
    },

    async find(processId) {
      const process = await db.selectFrom("processes").select("status").where("id", "=", processId).executeTakeFirst();
      if (!process) return { ok: false, error: "process_not_found" };
      const row = await db.selectFrom("finalizations").select(["finalizedAt", "report"]).where("processId", "=", processId).executeTakeFirst();
      if (!row) return { ok: false, error: "process_not_finalized" };
      return { ok: true, finalization: row };
    },
  };
}
