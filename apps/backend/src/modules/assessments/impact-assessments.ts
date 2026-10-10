import type { Db } from "../../db/database.ts";
import type { Stage } from "../process/stage.ts";
import { assessmentChoices, type AssessmentChoice, type AssessorFailureReason, type AssessorOutcome, type Verdict } from "./assessor.ts";
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

// Avaliação de impacto: o julgamento do Jev, bruto, sobre se uma mudança afeta uma Confirmação que
// dependia do que mudou: a Versão nova de uma resposta (com a anterior) ou uma Revisão de Restrição.
// `needsDecision`: o Jev respondeu `insufficient` ou com confiança abaixo do limite; quem decide se
// abre a Pendência é o usuário.
export interface ImpactAssessment {
  id: string;
  answerVersionId: string | null;
  previousAnswerVersionId: string | null;
  constraintRevisionId: string | null;
  // As outras Versões que o Jev recebeu: numa Confirmação da Etapa, as respostas que ela sustentava.
  analyzedAnswerVersionIds: string[];
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

// O julgamento decide sozinho só com `yes` ou `no` e confiança no limite ou acima dele; o limite é o
// da Avaliação de impacto, salvo outro dado.
export const decidesAlone = (
  { choice, confidence }: Pick<Verdict, "choice" | "confidence">,
  threshold = IMPACT_CONFIDENCE_THRESHOLD,
): boolean => choice !== "insufficient" && confidence >= threshold;

const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

// Um julgamento fora da primitiva é recusado, qualquer que seja o Assessor.
export function verdictProblem({ choice, confidence, probabilities }: Verdict): string | undefined {
  if (!assessmentChoices.includes(choice) || !isUnit(confidence)) return "O Jev devolveu um julgamento fora do formato.";
  if (!assessmentChoices.every((key) => isUnit(probabilities[key]))) return "O Jev devolveu probabilidades fora do formato.";
  return undefined;
}

// O desfecho do Jev, qualquer que seja o Assessor: uma exceção vira falha.
export const caught = <T>(call: () => Promise<AssessorOutcome<T>>): Promise<AssessorOutcome<T>> =>
  call().catch(
    (error: unknown): AssessorOutcome<never> => ({
      status: "failed",
      reason: "jev_error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );

// Um julgamento único válido, ou a falha.
export async function judgedImpact(call: () => Promise<AssessorOutcome<Verdict>>): Promise<AssessorOutcome<Verdict>> {
  const outcome = await caught(call);
  if (outcome.status !== "completed") return outcome;
  const problem = verdictProblem(outcome.result);
  return problem ? { status: "failed", reason: "invalid_output", message: problem } : outcome;
}

// As colunas do desfecho do Jev numa Avaliação de impacto gravada.
export const impactOutcomeColumns = (outcome: AssessorOutcome<Verdict>, requestedModel: string) => ({
  status: outcome.status,
  requestedModel,
  jevModel: outcome.status === "completed" ? outcome.model : null,
  choice: outcome.status === "completed" ? outcome.result.choice : null,
  confidence: outcome.status === "completed" ? outcome.result.confidence : null,
  probabilities: outcome.status === "completed" ? JSON.stringify(outcome.result.probabilities) : null,
  failureReason: outcome.status === "failed" ? outcome.reason : null,
  message: outcome.status === "failed" ? outcome.message : null,
});

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
    constraintRevisionId: row.constraintRevisionId,
    analyzedAnswerVersionIds: row.analyzedAnswerVersionIds,
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
