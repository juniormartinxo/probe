import type { Db } from "../../db/database.ts";
import { stageAssessmentsOf } from "../assessments/stage-assessments.ts";
import { undecidedConflictsBlocking } from "./conflicts.ts";
import { undecidedConstraintReassessmentsBlocking } from "./constraint-reassessments.ts";
import { pendenciesBlockingStage } from "./pendencies.ts";
import { undecidedReassessmentsBlocking } from "./reassessments.ts";
import type { ProcessPoints } from "./stage-point-coverage.ts";
import { readyStage, type StageNotReady } from "./stage-readiness.ts";
import { nextStage, type Stage } from "./stage.ts";

// Confirmação da Etapa: o ato do usuário que dá a Etapa por estabelecida e abre a seguinte. Registra a
// Avaliação do Jev que ele viu e a justificativa, obrigatória quando confirma contra o Jev. `withoutAssessment`: o
// Jev falhou (ou não havia Ponto coberto a avaliar) e o usuário confirmou sem Avaliação.
export interface StageConfirmation {
  stage: Stage;
  stageAssessmentId: string | null;
  withoutAssessment: boolean;
  justification: string | null;
  confirmedAt: Date;
}

// A Avaliação mais recente da Etapa, como o usuário a viu (concluída ou falha), ou null quando não há
// Ponto coberto a avaliar; a justificativa, se houver.
export interface StageConfirmationRequest {
  stageAssessmentId: string | null;
  justification: string | null;
}

export type StageConfirmationError =
  | StageNotReady
  | "blocking_pendencies"
  | "undecided_reassessments"
  | "undecided_conflicts"
  | "unknown_assessment"
  | "assessment_outdated"
  | "assessment_required"
  | "justification_required";

export interface StageConfirmations {
  confirm(
    processId: string,
    stage: Stage,
    request: StageConfirmationRequest,
  ): Promise<
    | { ok: true; stageConfirmation: StageConfirmation }
    | { ok: false; error: "blocking_pendencies"; pendencyIds: string[] }
    | { ok: false; error: Exclude<StageConfirmationError, "blocking_pendencies"> }
  >;
}

export async function stageConfirmationsOf(db: Db, process: { id: string }): Promise<StageConfirmation[]> {
  const rows = await db
    .selectFrom("stageConfirmations")
    .leftJoin("stageAssessments", "stageAssessments.id", "stageConfirmations.stageAssessmentId")
    .select([
      "stageConfirmations.stage",
      "stageConfirmations.stageAssessmentId",
      "stageConfirmations.justification",
      "stageConfirmations.confirmedAt",
      "stageAssessments.status as assessmentStatus",
    ])
    .where("stageConfirmations.processId", "=", process.id)
    .orderBy("stageConfirmations.confirmedAt")
    .execute();
  return rows.map(({ assessmentStatus, ...row }) => ({ ...row, withoutAssessment: assessmentStatus !== "completed" }));
}

export function stageConfirmations({ db }: { db: Db }): StageConfirmations {
  return {
    async confirm(processId, stage, { stageAssessmentId, justification }) {
      return db.transaction().execute(async (trx) => {
        const found = await readyStage(trx, processId, stage, { lock: true });
        if (!found.ok) return found;
        const process: ProcessPoints = found.ready.process;
        const pendencyIds = await pendenciesBlockingStage(trx, processId, stage);
        if (pendencyIds.length > 0) return { ok: false, error: "blocking_pendencies", pendencyIds } as const;
        // Uma Confirmação em que se apoia esta, com o impacto de uma mudança (uma Versão nova ou uma
        // Revisão de Restrição) ainda sem decisão.
        const undecided = [
          ...(await undecidedReassessmentsBlocking(trx, processId, stage)),
          ...(await undecidedConstraintReassessmentsBlocking(trx, processId, stage)),
        ];
        if (undecided.length > 0) {
          return { ok: false, error: "undecided_reassessments" } as const;
        }
        // Respostas da Etapa ou das anteriores cuja compatibilidade ainda espera o Jev ou o usuário.
        if ((await undecidedConflictsBlocking(trx, processId, stage)).length > 0) {
          return { ok: false, error: "undecided_conflicts" } as const;
        }

        // Nenhuma Avaliação confirma nada: ela só precisa ser a que o usuário viu, e valer ainda.
        if (stageAssessmentId === null) {
          const toAssess = found.ready.stagePoints.some((point) => point.status === "covered");
          if (toAssess) return { ok: false, error: "assessment_required" } as const;
        } else {
          const latest = (await stageAssessmentsOf(trx, process, stage)).at(-1);
          if (latest?.id !== stageAssessmentId) return { ok: false, error: "unknown_assessment" } as const;
          if (latest.outdated) return { ok: false, error: "assessment_outdated" } as const;
          // Contra o Jev, a decisão continua do usuário, desde que ele diga por quê.
          const against = latest.assessments.some((assessment) => assessment.disagreesWithCoverage);
          if (against && justification === null) return { ok: false, error: "justification_required" } as const;
        }

        await trx.insertInto("stageConfirmations").values({ processId, stage, stageAssessmentId, justification }).execute();
        const next = nextStage(stage);
        if (next) await trx.updateTable("processes").set({ currentStage: next }).where("id", "=", processId).execute();
        const confirmed = (await stageConfirmationsOf(trx, process)).find((item) => item.stage === stage)!;
        return { ok: true, stageConfirmation: confirmed } as const;
      });
    },
  };
}
