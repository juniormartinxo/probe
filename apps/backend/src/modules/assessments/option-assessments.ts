import type { Db } from "../../db/database.ts";
import type { AssessmentChoice, AssessorFailureReason, Verdict } from "./assessor.ts";
import { decidesAlone } from "./impact-assessments.ts";
import { OPTION_CONFIDENCE_THRESHOLD } from "./option-rubric.ts";

// O julgamento do Jev sobre um par Opção × Restrição, bruto. `needsDecision`: `insufficient` ou
// confiança abaixo do limite; quem decide se a Opção viola a Restrição é o usuário.
export interface OptionVerdict extends Verdict {
  pairId: string;
  needsDecision: boolean;
}

// Avaliação de violação: uma chamada ao Jev com os pares de uma verificação, concluída (um julgamento
// por par) ou falha.
export interface OptionAssessment {
  id: string;
  checkId: string;
  status: "completed" | "failed";
  requestedModel: string;
  // O modelo que respondeu; null quando a chamada falhou.
  jevModel: string | null;
  rubricRevision: string;
  verdicts: OptionVerdict[];
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Date;
}

// Um par só se decide sozinho com `yes` ou `no` e confiança no limite ou acima dele (ADR 0006).
export const optionDecidesAlone = (verdict: Pick<Verdict, "choice" | "confidence">): boolean =>
  decidesAlone(verdict, OPTION_CONFIDENCE_THRESHOLD);

// As Avaliações de violação do Processo, na ordem em que foram pedidas, com os julgamentos na ordem dos pares.
export async function optionAssessmentsOf(db: Db, processId: string): Promise<OptionAssessment[]> {
  const rows = await db
    .selectFrom("optionAssessments")
    .selectAll()
    .where("processId", "=", processId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  if (rows.length === 0) return [];
  const verdicts = await db
    .selectFrom("optionVerdicts")
    .innerJoin("optionConstraintPairs", "optionConstraintPairs.id", "optionVerdicts.pairId")
    .select(["optionVerdicts.assessmentId", "optionVerdicts.pairId", "optionVerdicts.choice", "optionVerdicts.confidence", "optionVerdicts.probabilities"])
    .where(
      "optionVerdicts.assessmentId",
      "in",
      rows.map((row) => row.id),
    )
    .orderBy("optionConstraintPairs.position")
    .execute();
  return rows.map(({ processId: _, ...row }) => ({
    ...row,
    verdicts: verdicts
      .filter((verdict) => verdict.assessmentId === row.id)
      .map(({ pairId, choice, confidence, probabilities }) => ({
        pairId,
        choice,
        confidence,
        probabilities: probabilities as Record<AssessmentChoice, number>,
        needsDecision: !optionDecidesAlone({ choice, confidence }),
      })),
  }));
}
