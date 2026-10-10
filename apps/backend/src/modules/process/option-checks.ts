import type { Db } from "../../db/database.ts";
import { optionAssessmentsOf, type OptionAssessment, type OptionVerdict } from "../assessments/option-assessments.ts";
import { optionDecidesAlone } from "../assessments/option-assessments.ts";

// Em que pé está cada par Opção × Restrição: ainda sem Avaliação, com a Avaliação falha ou incerta à
// espera do usuário, decidido (a Opção cumpre ou viola a Restrição, pelo Jev ou pelo usuário), ou
// superado (a Opção foi descartada ou a Restrição deixou de valer, e o par não conta mais).
export type OptionPairStatus = "not_assessed" | "assessment_failed" | "awaiting_decision" | "complies" | "violates" | "superseded";

export const undecidedOptionStatuses: OptionPairStatus[] = ["not_assessed", "assessment_failed", "awaiting_decision"];

export interface OptionConstraintPair {
  id: string;
  position: number;
  option: { id: string; statement: string };
  constraint: { id: string; statement: string };
  status: OptionPairStatus;
  // Quem decidiu, quando o par está decidido.
  decidedBy: "jev" | "user" | null;
  // O julgamento da Avaliação que vale, se ela foi concluída.
  verdict: OptionVerdict | null;
}

export type OptionCheckStatus = "not_assessed" | "assessment_failed" | "awaiting_decision" | "decided";

// Verificação de viabilidade: os pares de Opções aceitas e Restrições em vigor que ainda não tinham
// sido avaliados, e as Avaliações de violação do Jev sobre eles, na ordem; a última é a que vale. Fica
// sem decisão enquanto algum par que ainda conta espera o Jev ou o usuário.
export interface OptionCheck {
  id: string;
  createdAt: Date;
  status: OptionCheckStatus;
  pairs: OptionConstraintPair[];
  assessments: OptionAssessment[];
}

// Os pares do Processo, como foram gravados, na ordem das verificações e, dentro de cada uma, dos pares.
export async function optionPairRowsOf(db: Db, processId: string) {
  return db
    .selectFrom("optionConstraintPairs")
    .innerJoin("optionChecks", "optionChecks.id", "optionConstraintPairs.checkId")
    .innerJoin("options", "options.id", "optionConstraintPairs.optionId")
    .innerJoin("constraints", "constraints.id", "optionConstraintPairs.constraintId")
    .select([
      "optionConstraintPairs.id",
      "optionConstraintPairs.checkId",
      "optionConstraintPairs.position",
      "optionConstraintPairs.optionId",
      "optionConstraintPairs.constraintId",
      "options.statement as optionStatement",
      "options.description as optionDescription",
      "options.discardedAt",
      "constraints.statement as constraintStatement",
      "constraints.scope",
      "constraints.unit",
      "constraints.withdrawnAt",
    ])
    .where("optionChecks.processId", "=", processId)
    .orderBy("optionChecks.createdAt")
    .orderBy("optionChecks.id")
    .orderBy("optionConstraintPairs.position")
    .execute();
}

// As verificações de viabilidade do Processo, na ordem em que foram feitas.
export async function optionChecksOf(db: Db, processId: string): Promise<OptionCheck[]> {
  const checks = await db
    .selectFrom("optionChecks")
    .select(["id", "createdAt"])
    .where("processId", "=", processId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  if (checks.length === 0) return [];
  const rows = await optionPairRowsOf(db, processId);
  const assessments = await optionAssessmentsOf(db, processId);
  const decisions = await db
    .selectFrom("optionDecisions")
    .select(["pairId", "violates"])
    .where(
      "pairId",
      "in",
      rows.map((row) => row.id),
    )
    .execute();
  return checks.map((check) => {
    const own = assessments.filter((assessment) => assessment.checkId === check.id);
    const last = own.at(-1);
    const pairs = rows
      .filter((row) => row.checkId === check.id)
      .map((row): OptionConstraintPair => {
        const verdict = last?.verdicts.find((item) => item.pairId === row.id) ?? null;
        const decision = decisions.find((item) => item.pairId === row.id);
        const decided = (violates: boolean, decidedBy: "jev" | "user") =>
          ({ status: violates ? "violates" : "complies", decidedBy }) as const;
        const state =
          row.discardedAt !== null || row.withdrawnAt !== null
            ? ({ status: "superseded", decidedBy: null } as const)
            : decision
              ? decided(decision.violates, "user")
              : !last
                ? ({ status: "not_assessed", decidedBy: null } as const)
                : last.status === "failed"
                  ? ({ status: "assessment_failed", decidedBy: null } as const)
                  : verdict && optionDecidesAlone(verdict)
                    ? decided(verdict.choice === "yes", "jev")
                    : ({ status: "awaiting_decision", decidedBy: null } as const);
        return {
          id: row.id,
          position: row.position,
          option: { id: row.optionId, statement: row.optionStatement },
          constraint: { id: row.constraintId, statement: row.constraintStatement },
          ...state,
          verdict,
        };
      });
    const undecided = pairs.some((pair) => undecidedOptionStatuses.includes(pair.status));
    const status: OptionCheckStatus = !undecided
      ? "decided"
      : !last
        ? "not_assessed"
        : last.status === "failed"
          ? "assessment_failed"
          : "awaiting_decision";
    return { id: check.id, createdAt: check.createdAt, status, pairs, assessments: own };
  });
}
