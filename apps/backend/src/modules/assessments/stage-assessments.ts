import type { Db } from "../../db/database.ts";
import type { GeneratedSynthesis } from "../ai/assistant.ts";
import { stagePointStates, type ProcessPoints } from "../process/stage-point-coverage.ts";
import { namedStagePoint } from "../process/stage-points.ts";
import { confirmedAnswersOf, readyStage, type ReadyStage, type StageNotReady } from "../process/stage-readiness.ts";
import type { Stage } from "../process/stage.ts";
import {
  assessmentChoices,
  type Assessor,
  type AssessorFailureReason,
  type AssessorOutcome,
  type CoverageInput,
  type Verdict,
} from "./assessor.ts";
import { COVERAGE_RUBRIC_REVISION } from "./coverage-rubric.ts";

export type AssessmentType = "stage_point_coverage";

// Avaliação do Jev sobre um Ponto, bruta (escolha, probabilidades e confiança), ao lado da sugestão
// da IA que acompanhou a Confirmação da síntese que cobriu o Ponto. Só se avaliam Pontos dados por
// cobertos. `disagreesWithCoverage`: o Jev não confirma a cobertura que o usuário deu (escolha
// diferente de `yes`); confirmar a Etapa assim pede justificativa. `disagreesWithAi`: o Jev e a
// sugestão da IA dizem coisas diferentes sobre o Ponto.
export interface Assessment extends Verdict {
  type: AssessmentType;
  stagePoint: { key: string; name: string };
  aiSuggestion: { covered: boolean; reason: string } | null;
  disagreesWithCoverage: boolean;
  disagreesWithAi: boolean;
}

// Uma chamada ao Jev sobre os Pontos de uma Etapa. `outdated`: as respostas confirmadas ou os Pontos
// cobertos mudaram depois dela; não serve mais para confirmar a Etapa, e uma nova pode ser pedida.
export interface StageAssessment {
  id: string;
  stage: Stage;
  status: "completed" | "failed";
  requestedModel: string;
  // O modelo que respondeu; null quando a chamada falhou.
  jevModel: string | null;
  rubricRevision: string;
  analyzedAnswerVersionIds: string[];
  assessments: Assessment[];
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Date;
  outdated: boolean;
}

export type AssessmentRequestError = StageNotReady | "nothing_to_assess";

export interface StageAssessments {
  // Pede ao Jev a Avaliação de cada Ponto coberto da Etapa atual, a partir das respostas confirmadas.
  // Uma falha do Jev também fica gravada: o usuário pode tentar de novo ou confirmar sem Avaliação.
  request(
    processId: string,
    stage: Stage,
  ): Promise<{ ok: true; stageAssessment: StageAssessment } | { ok: false; error: AssessmentRequestError }>;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));

const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

// Os Pontos são da aplicação (ADR 0002): um desfecho que deixe Ponto sem julgamento, julgue Ponto que
// não foi pedido ou traga escolha fora da primitiva é recusado, qualquer que seja o Assessor.
function coverageProblem(input: CoverageInput, result: Record<string, Verdict>): string | undefined {
  const asked = input.stagePoints.map((point) => point.key);
  const received = Object.keys(result);
  if (!sameSet(asked, received)) return `O Jev não julgou exatamente os Pontos pedidos (${received.join(", ") || "nenhum"}).`;
  const invalid = received.filter((key) => {
    const { choice, confidence } = result[key]!;
    return !assessmentChoices.includes(choice) || !isUnit(confidence);
  });
  if (invalid.length > 0) return `O Jev devolveu julgamentos fora do formato em: ${invalid.join(", ")}.`;
  return undefined;
}

// O que o Jev recebe: só os Pontos cobertos; um Ponto inaplicável não tem cobertura a avaliar.
function coverageInputOf(ready: ReadyStage): CoverageInput {
  return {
    stage: ready.stage,
    problemStatement: ready.problemStatement,
    stagePoints: ready.stagePoints
      .filter((point) => point.status === "covered")
      .map(({ key, name, description }) => ({ key, name, description })),
    answers: ready.answers.map(({ ref, wording, answer }) => ({ ref, wording, answer })),
  };
}

// A sugestão da IA sobre cada Ponto coberto: a da proposta de síntese que o usuário confirmou ao cobri-lo.
async function aiSuggestionsOf(db: Db, processId: string, stage: Stage): Promise<Map<string, Assessment["aiSuggestion"]>> {
  const rows = await db
    .selectFrom("stagePointCoverage")
    .innerJoin("blockSyntheses", "blockSyntheses.blockId", "stagePointCoverage.blockId")
    .innerJoin("aiRequestAttempts", "aiRequestAttempts.id", "blockSyntheses.proposalId")
    .select(["stagePointCoverage.stagePoint", "aiRequestAttempts.result"])
    .where("stagePointCoverage.processId", "=", processId)
    .where("stagePointCoverage.stage", "=", stage)
    .execute();
  return new Map(
    rows.map(({ stagePoint, result }) => {
      // O resultado foi validado como GeneratedSynthesis antes de a tentativa ser gravada.
      const suggestion = (result as GeneratedSynthesis).coverage.find((item) => item.stagePoint === stagePoint);
      return [stagePoint, suggestion ? { covered: suggestion.covered, reason: suggestion.reason } : null];
    }),
  );
}

// As Avaliações da Etapa, na ordem em que foram pedidas; a última é a que vale.
export async function stageAssessmentsOf(db: Db, process: ProcessPoints, stage: Stage): Promise<StageAssessment[]> {
  const runs = await db
    .selectFrom("stageAssessments")
    .selectAll()
    .where("processId", "=", process.id)
    .where("stage", "=", stage)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  if (runs.length === 0) return [];
  const ids = runs.map((run) => run.id);
  const versions = await db
    .selectFrom("stageAssessmentAnswerVersions")
    .select(["stageAssessmentId", "answerVersionId"])
    .where("stageAssessmentId", "in", ids)
    .execute();
  const verdicts = await db
    .selectFrom("assessments")
    .select(["stageAssessmentId", "type", "stagePoint", "choice", "confidence", "probabilities"])
    .where("stageAssessmentId", "in", ids)
    .orderBy("id")
    .execute();
  const current = (await confirmedAnswersOf(db, process.id, stage)).map((answer) => answer.answerVersionId);
  const states = await stagePointStates(db, process, stage);
  const covered = states.filter((point) => point.status === "covered").map((point) => point.key);
  const order = states.map((point) => point.key);
  const suggestions = await aiSuggestionsOf(db, process.id, stage);

  return runs.map((run) => {
    const analyzed = versions.filter((row) => row.stageAssessmentId === run.id).map((row) => row.answerVersionId);
    const assessments = verdicts
      .filter((row) => row.stageAssessmentId === run.id)
      .toSorted((a, b) => order.indexOf(a.stagePoint) - order.indexOf(b.stagePoint))
      .map((row) => {
        const aiSuggestion = suggestions.get(row.stagePoint) ?? null;
        return {
          type: row.type,
          stagePoint: namedStagePoint(process.stagePointsVersion, stage, row.stagePoint),
          choice: row.choice,
          confidence: row.confidence,
          probabilities: row.probabilities,
          aiSuggestion,
          disagreesWithCoverage: row.choice !== "yes",
          disagreesWithAi: aiSuggestion !== null && aiSuggestion.covered !== (row.choice === "yes"),
        };
      });
    // Os Pontos que a chamada julgou (ou, se falhou, os que ela enviou) são os cobertos na época.
    const assessedPoints = run.status === "completed" ? assessments.map((item) => item.stagePoint.key) : null;
    return {
      id: run.id,
      stage: run.stage,
      status: run.status,
      requestedModel: run.requestedModel,
      jevModel: run.jevModel,
      rubricRevision: run.rubricRevision,
      analyzedAnswerVersionIds: analyzed,
      assessments,
      failureReason: run.failureReason,
      message: run.message,
      createdAt: run.createdAt,
      outdated: !sameSet(analyzed, current) || (assessedPoints !== null && !sameSet(assessedPoints, covered)),
    };
  });
}

export function stageAssessments({ db, assessor }: { db: Db; assessor: Assessor }): StageAssessments {
  async function assess(input: CoverageInput): Promise<AssessorOutcome<Record<string, Verdict>>> {
    const outcome = await assessor.assessCoverage(input).catch(
      (error: unknown): AssessorOutcome<never> => ({
        status: "failed",
        reason: "jev_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    if (outcome.status !== "completed") return outcome;
    const problem = coverageProblem(input, outcome.result);
    return problem ? { status: "failed", reason: "invalid_output", message: problem } : outcome;
  }

  return {
    async request(processId, stage) {
      // A chamada ao Jev fica fora da transação: o Processo não fica travado enquanto ele responde.
      const found = await readyStage(db, processId, stage, { lock: false });
      if (!found.ok) return found;
      const input = coverageInputOf(found.ready);
      if (input.stagePoints.length === 0) return { ok: false, error: "nothing_to_assess" } as const;
      const outcome = await assess(input);

      const saved = await db.transaction().execute(async (trx) => {
        const process = await trx
          .selectFrom("processes")
          .select(["status", "currentStage"])
          .where("id", "=", processId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (process.status !== "open") return { ok: false, error: "process_not_open" } as const;
        if (process.currentStage !== stage) return { ok: false, error: "stage_not_current" } as const;
        const { id } = await trx
          .insertInto("stageAssessments")
          .values({
            processId,
            stage,
            status: outcome.status,
            requestedModel: assessor.model,
            jevModel: outcome.status === "completed" ? outcome.model : null,
            rubricRevision: COVERAGE_RUBRIC_REVISION,
            failureReason: outcome.status === "failed" ? outcome.reason : null,
            message: outcome.status === "failed" ? outcome.message : null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        if (found.ready.answers.length > 0) {
          await trx
            .insertInto("stageAssessmentAnswerVersions")
            .values(found.ready.answers.map(({ answerVersionId }) => ({ stageAssessmentId: id, answerVersionId })))
            .execute();
        }
        if (outcome.status === "completed") {
          await trx
            .insertInto("assessments")
            .values(
              Object.entries(outcome.result).map(([stagePoint, { choice, confidence, probabilities }]) => ({
                stageAssessmentId: id,
                type: "stage_point_coverage" as const,
                stagePoint,
                choice,
                confidence,
                probabilities: JSON.stringify(probabilities),
              })),
            )
            .execute();
        }
        return { ok: true, id } as const;
      });
      if (!saved.ok) return saved;
      const all = await stageAssessmentsOf(db, found.ready.process, stage);
      return { ok: true, stageAssessment: all.find((item) => item.id === saved.id)! } as const;
    },
  };
}
