import type { Db } from "../../db/database.ts";
import type { Stage } from "../process/stage.ts";
import { assessmentChoices, type AssessmentChoice, type AssessorFailureReason, type Verdict } from "./assessor.ts";
import { IMPACT_CONFIDENCE_THRESHOLD } from "./impact-rubric.ts";

// Confirmação que depende de respostas: a síntese de um Bloco ou a de uma Etapa.
export type ConfirmationRef = { kind: "block_synthesis"; blockId: string } | { kind: "stage"; stage: Stage };

// A Confirmação como o usuário a vê.
export type DependentConfirmation =
  | { kind: "block_synthesis"; blockId: string; blockNumber: number; stage: Stage }
  | { kind: "stage"; stage: Stage };

export const confirmationKey = (ref: ConfirmationRef): string =>
  ref.kind === "stage" ? `stage:${ref.stage}` : `block:${ref.blockId}`;

// As colunas que gravam a Confirmação: uma delas, nunca as duas.
export const confirmationColumnsOf = (ref: ConfirmationRef): { blockId: string | null; stage: Stage | null } =>
  ref.kind === "stage" ? { blockId: null, stage: ref.stage } : { blockId: ref.blockId, stage: null };

export const confirmationRefOf = ({ blockId, stage }: { blockId: string | null; stage: Stage | null }): ConfirmationRef =>
  blockId !== null ? { kind: "block_synthesis", blockId } : { kind: "stage", stage: stage! };

// Avaliação de impacto: o julgamento do Jev, bruto, sobre se a Versão nova de uma resposta afeta uma
// Confirmação que dependia da anterior. `needsDecision`: o Jev respondeu `insufficient` ou com
// confiança abaixo do limite; quem decide se abre a Pendência é o usuário.
export interface ImpactAssessment {
  id: string;
  answerVersionId: string;
  previousAnswerVersionId: string;
  confirmation: DependentConfirmation;
  status: "completed" | "failed";
  requestedModel: string;
  // O modelo que respondeu; null quando a chamada falhou. Escolha, confiança e probabilidades também.
  jevModel: string | null;
  rubricRevision: string;
  choice: AssessmentChoice | null;
  confidence: number | null;
  probabilities: Record<AssessmentChoice, number> | null;
  needsDecision: boolean;
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Date;
}

// O julgamento decide sozinho só com `yes` ou `no` e confiança no limite ou acima dele.
export const decidesAlone = ({ choice, confidence }: Pick<Verdict, "choice" | "confidence">): boolean =>
  choice !== "insufficient" && confidence >= IMPACT_CONFIDENCE_THRESHOLD;

const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

// Um julgamento fora da primitiva é recusado, qualquer que seja o Assessor.
export function verdictProblem({ choice, confidence, probabilities }: Verdict): string | undefined {
  if (!assessmentChoices.includes(choice) || !isUnit(confidence)) return "O Jev devolveu um julgamento fora do formato.";
  if (!assessmentChoices.every((key) => isUnit(probabilities[key]))) return "O Jev devolveu probabilidades fora do formato.";
  return undefined;
}

// As Avaliações de impacto do Processo, na ordem em que foram pedidas.
export async function impactAssessmentsOf(db: Db, processId: string): Promise<ImpactAssessment[]> {
  const rows = await db
    .selectFrom("impactAssessments")
    .leftJoin("blocks", "blocks.id", "impactAssessments.blockId")
    .selectAll("impactAssessments")
    .select(["blocks.number as blockNumber", "blocks.stage as blockStage"])
    .where("impactAssessments.processId", "=", processId)
    .orderBy("impactAssessments.createdAt")
    .orderBy("impactAssessments.id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    answerVersionId: row.answerVersionId,
    previousAnswerVersionId: row.previousAnswerVersionId,
    confirmation:
      row.blockId !== null
        ? { kind: "block_synthesis", blockId: row.blockId, blockNumber: row.blockNumber!, stage: row.blockStage! }
        : { kind: "stage", stage: row.stage! },
    status: row.status,
    requestedModel: row.requestedModel,
    jevModel: row.jevModel,
    rubricRevision: row.rubricRevision,
    choice: row.choice,
    confidence: row.confidence,
    probabilities: row.probabilities,
    needsDecision: row.status === "completed" && !decidesAlone({ choice: row.choice!, confidence: row.confidence! }),
    failureReason: row.failureReason,
    message: row.message,
    createdAt: row.createdAt,
  }));
}
