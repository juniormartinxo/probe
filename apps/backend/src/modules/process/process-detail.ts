import type { Db } from "../../db/database.ts";
import { impactAssessmentsOf } from "../assessments/impact-assessments.ts";
import { stageAssessmentsOf } from "../assessments/stage-assessments.ts";
import { stageWorkOf } from "./blocks.ts";
import { chosenOptionsOf } from "./chosen-options.ts";
import { comparisonMatrixOf } from "./comparison-matrix.ts";
import { conflictChecksOf } from "./conflicts.ts";
import { constraintReassessmentsOf } from "./constraint-reassessments.ts";
import { constraintRevisionsOf, constraintsAndPreferencesOf } from "./constraints-and-preferences.ts";
import { executionPlanOf } from "./execution-plan.ts";
import { optionChecksOf } from "./option-checks.ts";
import { optionProposalsOf, optionsOf } from "./options.ts";
import { listPendencies } from "./pendencies.ts";
import { problemStatementStateOf } from "./problem-statement.ts";
import { executionConfirmed, findProcess } from "./process.ts";
import { reassessmentsOf } from "./reassessments.ts";
import { recommendationsOf } from "./recommendations.ts";
import { stageConfirmationsOf } from "./stage-confirmations.ts";
import { stages } from "./stage.ts";

// O Processo como o frontend o retoma: enunciado, Etapa, Blocos, respostas e Pendências. É também de
// onde sai o relatório da Revisão final; dentro de uma transação, lê o que ela vê.
export async function processDetailOf(db: Db, id: string) {
  const process = await findProcess(db, id);
  if (!process) return undefined;
  const finalization = await db.selectFrom("finalizations").select("finalizedAt").where("processId", "=", id).executeTakeFirst();
  return {
    ...process,
    // Quando a Finalização congelou o Processo; null enquanto ele está aberto.
    finalizedAt: finalization?.finalizedAt ?? null,
    ...(await problemStatementStateOf(db, id)),
    ...(await stageWorkOf(db, process)),
    pendencies: await listPendencies(db, process),
    // Confirmações cuja Versão sustentada foi superada, ainda em revisão, e as Avaliações de impacto.
    reassessments: await reassessmentsOf(db, id),
    // Confirmações de Etapa que sustentavam uma Restrição revista, ainda em revisão.
    constraintReassessments: await constraintReassessmentsOf(db, id),
    // As Revisões de Restrição, na ordem: o histórico de cada Restrição revista.
    constraintRevisions: await constraintRevisionsOf(db, id),
    impactAssessments: await impactAssessmentsOf(db, id),
    // As verificações de conflito entre respostas confirmadas, com os pares e as Avaliações.
    conflictChecks: await conflictChecksOf(db, id),
    // As Avaliações de cada Etapa já aberta, da primeira à atual.
    stageAssessments: (
      await Promise.all(stages.slice(0, stages.indexOf(process.currentStage) + 1).map((stage) => stageAssessmentsOf(db, process, stage)))
    ).flat(),
    stageConfirmations: await stageConfirmationsOf(db, process),
    ...(await constraintsAndPreferencesOf(db, id)),
    // As Opções da Etapa O, inclusive as descartadas, e as propostas pedidas à IA.
    options: await optionsOf(db, process),
    optionProposals: await optionProposalsOf(db, id),
    // As verificações de viabilidade, com os pares Opção × Restrição e as Avaliações do Jev.
    optionChecks: await optionChecksOf(db, id),
    // Na Etapa B: a matriz qualitativa, as Recomendações da IA e as Escolhas (a última vale).
    comparisonMatrix: await comparisonMatrixOf(db, process),
    recommendations: await recommendationsOf(db, process),
    chosenOptions: await chosenOptionsOf(db, id),
    // Na Etapa E: cada elemento do plano, com a compatibilidade com a Escolha em vigor.
    executionPlan: await executionPlanOf(db, process),
    // A Etapa E foi confirmada: o Processo espera a Revisão final.
    readyForFinalReview: await executionConfirmed(db, id),
  };
}

export type ProcessDetail = NonNullable<Awaited<ReturnType<typeof processDetailOf>>>;
