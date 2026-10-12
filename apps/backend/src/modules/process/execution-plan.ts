import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../db/database.ts";
import type { AssessmentChoice, Assessor, AssessorFailureReason, Verdict } from "../assessments/assessor.ts";
import { decidesAlone, impactOutcomeColumns, judgedImpact } from "../assessments/impact-assessments.ts";
import { PLAN_CONFIDENCE_THRESHOLD, PLAN_RUBRIC_REVISION } from "../assessments/plan-rubric.ts";
import { choiceInForceOf, chosenOptionsOf } from "./chosen-options.ts";
import { confirmedStatementOf } from "./problem-statement.ts";
import { executionConfirmed, lockOpenProcessFrom } from "./process.ts";
import { openPoints, type ProcessPoints, type StagePointState } from "./stage-point-coverage.ts";
import { stagePointsOf, type StagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";

const EXECUTION_STAGE = "E";

// Um elemento como o usuário o escreveu; reescrevê-lo grava um novo.
export interface PlanElementText {
  id: string;
  text: string;
  recordedAt: Date;
}

// Avaliação de compatibilidade: o julgamento do Jev, bruto, sobre se o elemento é compatível com a
// Escolha que valia quando foi pedida. `needsDecision`: `no`, `insufficient` ou `yes` com confiança
// abaixo do limite; quem decide se mantém o elemento é o usuário.
export interface PlanAssessment {
  id: string;
  elementId: string;
  chosenOptionId: string;
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

// Em que pé está a compatibilidade do elemento que vale com a Escolha em vigor: sem elemento, sem
// Avaliação, com Avaliações só de uma Escolha anterior (desatualizado), com a Avaliação falha ou
// incerta à espera do usuário, compatível segundo o Jev, ou mantido pelo usuário.
export type PlanCompatibilityStatus =
  | "not_recorded"
  | "not_assessed"
  | "outdated"
  | "assessment_failed"
  | "awaiting_decision"
  | "compatible"
  | "kept";

const undecidedStatuses: PlanCompatibilityStatus[] = ["not_assessed", "outdated", "assessment_failed"];

// Elemento do Plano de execução: o Ponto de E que ele cobre, o texto que vale, os anteriores e a
// compatibilidade com a Escolha em vigor, com a Avaliação que vale (a mais recente sobre ela) e a
// decisão do usuário sobre essa Avaliação, se houver.
export interface ExecutionPlanElement {
  key: string;
  name: string;
  description: string;
  current: PlanElementText | null;
  history: PlanElementText[];
  compatibility: {
    status: PlanCompatibilityStatus;
    assessment: PlanAssessment | null;
    decision: { justification: string | null; decidedAt: Date } | null;
  };
}

// Só `yes` confiante dá o elemento por compatível sem o usuário (ADR 0008).
const compatibleAlone = ({ choice, confidence }: Pick<Verdict, "choice" | "confidence">): boolean =>
  choice === "yes" && decidesAlone({ choice, confidence }, PLAN_CONFIDENCE_THRESHOLD);

// Os Pontos de E, que só os elementos do plano cobrem.
const planPointsOf = (stagePointsVersion: number): StagePoint[] =>
  stagePointsOf(stagePointsVersion, EXECUTION_STAGE).filter((point) => point.coveredByPlan);

// O Plano de execução do Processo, um elemento por Ponto de E, na ordem dos Pontos.
export async function executionPlanOf(db: Db, process: ProcessPoints): Promise<ExecutionPlanElement[]> {
  const rows = await db
    .selectFrom("executionPlanElements")
    .select(["id", "element", "text", "recordedAt"])
    .where("processId", "=", process.id)
    .orderBy("recordedAt")
    .orderBy("id")
    .execute();
  const assessments = rows.length
    ? await db
        .selectFrom("planAssessments")
        .leftJoin("planDecisions", "planDecisions.planAssessmentId", "planAssessments.id")
        .selectAll("planAssessments")
        .select(["planDecisions.justification", "planDecisions.decidedAt"])
        .where("planAssessments.processId", "=", process.id)
        .orderBy("planAssessments.createdAt")
        .orderBy("planAssessments.id")
        .execute()
    : [];
  const chosenId = (await chosenOptionsOf(db, process.id)).at(-1)?.id ?? null;

  return planPointsOf(process.stagePointsVersion).map(({ key, name, description }) => {
    const texts = rows.filter((row) => row.element === key).map(({ id, text, recordedAt }) => ({ id, text, recordedAt }));
    const current = texts.at(-1) ?? null;
    const own = current ? assessments.filter((row) => row.elementId === current.id) : [];
    const row = own.filter((item) => item.chosenOptionId === chosenId).at(-1);
    const assessment: PlanAssessment | null = row
      ? {
          id: row.id,
          elementId: row.elementId,
          chosenOptionId: row.chosenOptionId,
          status: row.status,
          requestedModel: row.requestedModel,
          jevModel: row.jevModel,
          rubricRevision: row.rubricRevision,
          choice: row.choice,
          confidence: row.confidence,
          probabilities: row.probabilities,
          needsDecision: row.status === "completed" && !compatibleAlone({ choice: row.choice!, confidence: row.confidence! }),
          failureReason: row.failureReason,
          message: row.message,
          createdAt: row.createdAt,
        }
      : null;
    const decision = row?.decidedAt ? { justification: row.justification, decidedAt: row.decidedAt } : null;
    const status: PlanCompatibilityStatus = !current
      ? "not_recorded"
      : !assessment
        ? own.length > 0
          ? "outdated"
          : "not_assessed"
        : decision
          ? "kept"
          : assessment.status === "failed"
            ? "assessment_failed"
            : assessment.needsDecision
              ? "awaiting_decision"
              : "compatible";
    return { key, name, description, current, history: texts.slice(0, -1), compatibility: { status, assessment, decision } };
  });
}

// Os Pontos que os Blocos da Etapa servem: os abertos e, em E, os ainda sem elemento do plano, que só
// o elemento cobre.
export async function blockPointsOf(db: Db, process: ProcessPoints, stage: Stage, states: StagePointState[]): Promise<StagePoint[]> {
  const unplanned =
    stage === EXECUTION_STAGE
      ? (await executionPlanOf(db, process)).filter((element) => element.current === null).map(({ key, name, description }) => ({ key, name, description }))
      : [];
  return [...openPoints(states), ...unplanned];
}

// Os Pontos da Etapa com os de E cobertos ("planned") pelos elementos registrados.
export async function withPlanCoverage(db: Db, process: ProcessPoints, states: StagePointState[]): Promise<StagePointState[]> {
  if (!states.some((point) => point.coveredByPlan)) return states;
  const planned = new Set((await executionPlanOf(db, process)).filter((element) => element.current).map((element) => element.key));
  return states.map((point) => (point.coveredByPlan && planned.has(point.key) ? { ...point, status: "planned" } : point));
}

export type PlanNotReady = "execution_plan_incomplete" | "undecided_plan_compatibility";

// Na Etapa E, o que o plano ainda segura na Confirmação da Etapa: algum elemento faltando ou algum
// sem compatibilidade decidida com a Escolha em vigor.
export async function planBlockingStage(db: Db, process: ProcessPoints, stage: Stage): Promise<PlanNotReady | null> {
  if (stage !== EXECUTION_STAGE) return null;
  const plan = await executionPlanOf(db, process);
  if (plan.some((element) => element.current === null)) return "execution_plan_incomplete";
  const undecided = plan.some((element) => element.compatibility.status !== "compatible" && element.compatibility.status !== "kept");
  return undecided ? "undecided_plan_compatibility" : null;
}

export type PlanError = "process_not_found" | "process_not_open" | "stage_not_current" | "execution_confirmed" | "plan_element_not_found";

export type PlanDecisionError =
  | PlanError
  | "plan_element_not_recorded"
  | "assessment_required"
  | "unknown_assessment"
  | "plan_element_decided"
  | "justification_required";

// A Avaliação que o usuário viu e, se houver, a justificativa para manter o elemento.
export interface PlanDecision {
  planAssessmentId: string;
  justification: string | null;
}

export interface ExecutionPlan {
  // Registra (ou reescreve) um elemento na Etapa E, antes da Confirmação dela, e pede ao Jev a
  // Avaliação de compatibilidade dele com a Escolha em vigor.
  record(
    processId: string,
    key: string,
    text: string,
  ): Promise<{ ok: true; executionPlan: ExecutionPlanElement[] } | { ok: false; error: PlanError }>;
  // Pede ao Jev a Avaliação de cada elemento sem uma que valha sobre a Escolha em vigor: nenhuma, falha
  // ou de uma Escolha anterior.
  assessOpen(processId: string): Promise<{ ok: true; executionPlan: ExecutionPlanElement[] } | { ok: false; error: Exclude<PlanError, "plan_element_not_found"> }>;
  // Mantém o elemento sobre a Avaliação mais recente, incompatível, incerta ou falha.
  keep(
    processId: string,
    key: string,
    decision: PlanDecision,
  ): Promise<{ ok: true; executionPlan: ExecutionPlanElement[] } | { ok: false; error: PlanDecisionError }>;
}

// Trava o Processo aberto na Etapa E, ainda sem a Confirmação dela.
async function lockStageE(trx: Db, processId: string) {
  const locked = await lockOpenProcessFrom(trx, processId, EXECUTION_STAGE);
  if (!locked.ok) return locked;
  if (await executionConfirmed(trx, processId)) return { ok: false, error: "execution_confirmed" } as const;
  return locked;
}

export function executionPlan({ db, assessor, log }: { db: Db; assessor: Assessor; log: FastifyBaseLogger }): ExecutionPlan {
  // Chama o Jev fora da transação (o Processo não fica travado enquanto ele responde) e grava a
  // Avaliação de cada elemento, concluída ou falha, sobre a Escolha em vigor. Uma resposta que chega
  // depois de o elemento ser reescrito ou decidido, de a Escolha mudar ou de E ser confirmada não é
  // gravada: ela julgou um estado que já não vale.
  async function assess(processId: string, elements: ExecutionPlanElement[]): Promise<void> {
    const chosen = await choiceInForceOf(db, processId);
    if (!chosen) return;
    const problemStatement = await confirmedStatementOf(db, processId);
    for (const { key, name, description, current } of elements) {
      const outcome = await judgedImpact(() =>
        assessor.assessPlan({ problemStatement, chosenOption: chosen.choice, element: { key, name, description, text: current!.text } }),
      );
      await db.transaction().execute(async (trx) => {
        const locked = await lockStageE(trx, processId);
        if (!locked.ok) return;
        if ((await chosenOptionsOf(trx, processId)).at(-1)?.id !== chosen.id) return;
        const now = (await executionPlanOf(trx, locked.process)).find((element) => element.key === key);
        if (now?.current?.id !== current!.id || !undecidedStatuses.includes(now.compatibility.status)) return;
        await trx
          .insertInto("planAssessments")
          .values({
            processId,
            elementId: current!.id,
            chosenOptionId: chosen.id,
            rubricRevision: PLAN_RUBRIC_REVISION,
            ...impactOutcomeColumns(outcome, assessor.model),
          })
          .execute();
      });
    }
  }

  // Avalia sem deixar a falha de gravação escapar: o elemento fica sem Avaliação, e o usuário pede outra.
  async function assessLogged(processId: string, elements: ExecutionPlanElement[]): Promise<void> {
    try {
      await assess(processId, elements);
    } catch (error) {
      log.error({ err: error, processId }, "Não foi possível avaliar o plano de execução contra a Escolha.");
    }
  }

  const planOfProcess = async (processId: string) => {
    const process = await db.selectFrom("processes").select(["id", "stagePointsVersion"]).where("id", "=", processId).executeTakeFirstOrThrow();
    return executionPlanOf(db, process);
  };

  return {
    async record(processId, key, text) {
      const recorded = await db.transaction().execute(async (trx) => {
        const locked = await lockStageE(trx, processId);
        if (!locked.ok) return locked;
        if (!planPointsOf(locked.process.stagePointsVersion).some((point) => point.key === key)) {
          return { ok: false, error: "plan_element_not_found" } as const;
        }
        await trx.insertInto("executionPlanElements").values({ processId, element: key, text: text.trim() }).execute();
        return { ok: true, plan: await executionPlanOf(trx, locked.process) } as const;
      });
      if (!recorded.ok) return recorded;
      await assessLogged(
        processId,
        recorded.plan.filter((element) => element.key === key),
      );
      return { ok: true, executionPlan: await planOfProcess(processId) };
    },

    async assessOpen(processId) {
      const open = await db.transaction().execute(async (trx) => {
        const locked = await lockStageE(trx, processId);
        if (!locked.ok) return locked;
        const plan = await executionPlanOf(trx, locked.process);
        return { ok: true, elements: plan.filter((element) => undecidedStatuses.includes(element.compatibility.status)) } as const;
      });
      if (!open.ok) return open;
      await assessLogged(processId, open.elements);
      return { ok: true, executionPlan: await planOfProcess(processId) };
    },

    async keep(processId, key, { planAssessmentId, justification }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageE(trx, processId);
        if (!locked.ok) return locked;
        const element = (await executionPlanOf(trx, locked.process)).find((item) => item.key === key);
        if (!element) return { ok: false, error: "plan_element_not_found" } as const;
        const { status, assessment } = element.compatibility;
        if (status === "not_recorded") return { ok: false, error: "plan_element_not_recorded" } as const;
        if (status === "compatible" || status === "kept") return { ok: false, error: "plan_element_decided" } as const;
        if (!assessment) return { ok: false, error: "assessment_required" } as const;
        // A decisão vale sobre a Avaliação que o usuário viu, e a mais recente.
        if (assessment.id !== planAssessmentId) return { ok: false, error: "unknown_assessment" } as const;
        // Contra o Jev, ou sem certeza dele, a decisão continua do usuário, desde que ele diga por quê.
        if (status === "awaiting_decision" && justification === null) return { ok: false, error: "justification_required" } as const;
        await trx.insertInto("planDecisions").values({ planAssessmentId, justification }).execute();
        return { ok: true, executionPlan: await executionPlanOf(trx, locked.process) } as const;
      });
    },
  };
}
