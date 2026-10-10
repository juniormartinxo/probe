import type { Db } from "../../db/database.ts";
import type { AssessmentChoice, AssessorFailureReason, Verdict } from "./assessor.ts";
import { CONFLICT_CONFIDENCE_THRESHOLD } from "./conflict-rubric.ts";
import { decidesAlone } from "./impact-assessments.ts";

// O julgamento do Jev sobre um par, bruto. `needsDecision`: `insufficient` ou confiança abaixo do
// limite; quem decide se abre a Pendência de conflito é o usuário.
export interface ConflictVerdict extends Verdict {
  pairId: string;
  needsDecision: boolean;
}

// Avaliação de conflito: uma chamada ao Jev com os pares de uma verificação, concluída (um julgamento por
// par) ou falha.
export interface ConflictAssessment {
  id: string;
  checkId: string;
  status: "completed" | "failed";
  requestedModel: string;
  // O modelo que respondeu; null quando a chamada falhou.
  jevModel: string | null;
  rubricRevision: string;
  // As Restrições e Preferências em vigor que o Jev recebeu como contexto.
  analyzedConstraintIds: string[];
  analyzedPreferenceIds: string[];
  verdicts: ConflictVerdict[];
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Date;
}

// Um par só se decide sozinho com `yes` ou `no` e confiança no limite ou acima dele (ADR 0004).
export const conflictDecidesAlone = (verdict: Pick<Verdict, "choice" | "confidence">): boolean =>
  decidesAlone(verdict, CONFLICT_CONFIDENCE_THRESHOLD);

// As Avaliações de conflito do Processo, na ordem em que foram pedidas, com os julgamentos na ordem dos pares.
export async function conflictAssessmentsOf(db: Db, processId: string): Promise<ConflictAssessment[]> {
  const rows = await db
    .selectFrom("conflictAssessments")
    .selectAll()
    .where("processId", "=", processId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  if (rows.length === 0) return [];
  const verdicts = await db
    .selectFrom("conflictVerdicts")
    .innerJoin("conflictPairs", "conflictPairs.id", "conflictVerdicts.pairId")
    .select([
      "conflictVerdicts.assessmentId",
      "conflictVerdicts.pairId",
      "conflictVerdicts.choice",
      "conflictVerdicts.confidence",
      "conflictVerdicts.probabilities",
    ])
    .where(
      "conflictVerdicts.assessmentId",
      "in",
      rows.map((row) => row.id),
    )
    .orderBy("conflictPairs.position")
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
        needsDecision: !conflictDecidesAlone({ choice, confidence }),
      })),
  }));
}
