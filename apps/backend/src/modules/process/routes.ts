import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../../db/database.ts";
import { isCli, type Cli } from "../ai/assistant.ts";
import { impactAssessmentsOf, type ConfirmationRef } from "../assessments/impact-assessments.ts";
import { stageAssessmentsOf, type StageAssessments } from "../assessments/stage-assessments.ts";
import type { AnswerChange, AnswerValue, Answers } from "./answers.ts";
import type { Blocks } from "./blocks.ts";
import { conflictChecksOf, type ConflictConstraintRevision, type ConflictDecision, type Conflicts } from "./conflicts.ts";
import {
  constraintsAndPreferencesOf,
  itemPaths,
  type ConstraintsAndPreferences,
  type ItemKind,
  type ItemReplacement,
  type ItemStatement,
} from "./constraints-and-preferences.ts";
import type { Pendencies } from "./pendencies.ts";
import type { ProblemStatements, StatementConfirmation } from "./problem-statement.ts";
import { reassessmentsOf, type ImpactDecision, type Reassessments } from "./reassessments.ts";
import { createProcess, findProcess, listProcesses } from "./process.ts";
import type { StagePointCoverage } from "./stage-point-coverage.ts";
import { stageConfirmationsOf, type StageConfirmations, type StageConfirmationRequest } from "./stage-confirmations.ts";
import { isStage, stages } from "./stage.ts";
import type { SynthesisConfirmation, Syntheses } from "./syntheses.ts";
import { understandingOf } from "./understanding.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A descrição é guardada como digitada; só se recusa texto ausente ou em branco.
function descriptionFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("description" in body)) return undefined;
  const { description } = body;
  return typeof description === "string" && description.trim() !== "" ? description : undefined;
}

// Texto do enunciado a confirmar e, opcionalmente, a proposta da IA de que ele partiu.
function confirmationFrom(body: unknown): StatementConfirmation | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { statement, proposalId = null } = body as Record<string, unknown>;
  if (typeof statement !== "string" || statement.trim() === "") return undefined;
  if (proposalId !== null && (typeof proposalId !== "string" || !uuidPattern.test(proposalId))) return undefined;
  return { statement, proposalId };
}

const isChoiceIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

// Alternativas escolhidas ou texto livre, nunca os dois. Se casam com a Pergunta, o módulo decide.
function answerValueFrom(body: Record<string, unknown>): AnswerValue | undefined {
  const { selectedChoices, text } = body;
  if (selectedChoices !== undefined && text !== undefined) return undefined;
  if (Array.isArray(selectedChoices) && selectedChoices.every(isChoiceIndex)) return { selectedChoices };
  if (typeof text === "string") return { text };
  return undefined;
}

function answerChangeFrom(body: unknown): AnswerChange | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const { basedOnVersionId } = body as Record<string, unknown>;
  if (basedOnVersionId !== null && (typeof basedOnVersionId !== "string" || !uuidPattern.test(basedOnVersionId))) {
    return undefined;
  }
  const value = answerValueFrom(body as Record<string, unknown>);
  return value && { value, basedOnVersionId };
}

// Texto da síntese a confirmar, a proposta da IA que o usuário viu e os Pontos que ele dá por cobertos.
function synthesisConfirmationFrom(body: unknown): SynthesisConfirmation | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { proposalId, synthesis, coveredStagePoints } = body as Record<string, unknown>;
  if (typeof synthesis !== "string" || synthesis.trim() === "") return undefined;
  if (typeof proposalId !== "string" || !uuidPattern.test(proposalId)) return undefined;
  if (!Array.isArray(coveredStagePoints) || !coveredStagePoints.every((key) => typeof key === "string")) return undefined;
  return { proposalId, synthesis, coveredStagePoints };
}

function justificationFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { justification } = body as Record<string, unknown>;
  return typeof justification === "string" && justification.trim() !== "" ? justification : undefined;
}

const optionalText = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";

// O que a Restrição ou Preferência diz e, opcionalmente, o escopo e a unidade. Os espaços, o módulo tira.
function itemStatementFrom(body: unknown): ItemStatement | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { statement, scope, unit } = body as Record<string, unknown>;
  if (typeof statement !== "string" || statement.trim() === "") return undefined;
  if (!optionalText(scope) || !optionalText(unit)) return undefined;
  return { statement, scope: scope ?? null, unit: unit ?? null };
}

// A Avaliação que o usuário viu (a concluída ou a que falhou) e, se houver, a justificativa.
function stageConfirmationFrom(body: unknown): StageConfirmationRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { stageAssessmentId } = body as Record<string, unknown>;
  if (stageAssessmentId !== null && (typeof stageAssessmentId !== "string" || !uuidPattern.test(stageAssessmentId))) {
    return undefined;
  }
  return { stageAssessmentId, justification: justificationFrom(body)?.trim() ?? null };
}

// A Confirmação afetada: a síntese de um Bloco ou a de uma Etapa.
function confirmationRefFrom(value: unknown): ConfirmationRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, blockId, stage } = value as Record<string, unknown>;
  if (kind === "block_synthesis" && typeof blockId === "string" && uuidPattern.test(blockId)) return { kind, blockId };
  if (kind === "stage" && typeof stage === "string" && isStage(stage)) return { kind, stage };
  return undefined;
}

// A decisão do usuário sobre o impacto, quando o Jev não teve certeza ou não respondeu.
function impactDecisionFrom(answerVersionId: string, body: unknown): ImpactDecision | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { confirmation, impactAssessmentId, decision } = body as Record<string, unknown>;
  const ref = confirmationRefFrom(confirmation);
  if (!ref || typeof impactAssessmentId !== "string" || !uuidPattern.test(impactAssessmentId)) return undefined;
  if (decision !== "open_pendency" && decision !== "keep_confirmation") return undefined;
  return { answerVersionId, confirmation: ref, impactAssessmentId, decision };
}

// O texto corrigido da síntese, ao reconfirmá-la; sem corpo ou sem `synthesis`, reconfirma como está.
function correctedSynthesisFrom(body: unknown): { ok: true; synthesis: string | null } | { ok: false } {
  if (body === undefined || body === null) return { ok: true, synthesis: null };
  if (typeof body !== "object") return { ok: false };
  const { synthesis } = body as Record<string, unknown>;
  if (synthesis === undefined || synthesis === null) return { ok: true, synthesis: null };
  return typeof synthesis === "string" && synthesis.trim() !== "" ? { ok: true, synthesis } : { ok: false };
}

// A decisão do usuário sobre pares de conflito em que o Jev não teve certeza ou não respondeu.
function conflictDecisionFrom(body: unknown): ConflictDecision | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { conflictAssessmentId, pairIds, decision } = body as Record<string, unknown>;
  if (typeof conflictAssessmentId !== "string" || !uuidPattern.test(conflictAssessmentId)) return undefined;
  if (!Array.isArray(pairIds) || pairIds.length === 0 || !pairIds.every((id) => typeof id === "string" && uuidPattern.test(id))) {
    return undefined;
  }
  if (decision !== "open_pendency" && decision !== "dismiss") return undefined;
  return { conflictAssessmentId, pairIds, decision };
}

// O que substitui a Restrição revista, se houver: uma Restrição nova ou uma Preferência.
function itemReplacementFrom(value: unknown): { ok: true; replacement: ItemReplacement | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, replacement: null };
  if (typeof value !== "object") return { ok: false };
  const { kind } = value as Record<string, unknown>;
  const item = itemStatementFrom(value);
  if ((kind !== "constraint" && kind !== "preference") || !item) return { ok: false };
  return { ok: true, replacement: { kind, item } };
}

// A Restrição revista, a que a substitui (se houver) e uma nota opcional.
function constraintRevisionFrom(body: unknown): ConflictConstraintRevision | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { constraintId, replacement, note } = body as Record<string, unknown>;
  if (typeof constraintId !== "string" || !uuidPattern.test(constraintId)) return undefined;
  if (!optionalText(note)) return undefined;
  const replaced = itemReplacementFrom(replacement);
  if (!replaced.ok) return undefined;
  return { constraintId, replacement: replaced.replacement, note: note ?? null };
}

function clarificationFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { clarification } = body as Record<string, unknown>;
  return typeof clarification === "string" && clarification.trim() !== "" ? clarification : undefined;
}

// A CLI que o usuário escolheu para uma nova tentativa; sem corpo ou sem `cli`, nenhuma escolha
// (a tentativa segue com a CLI da anterior). Uma CLI que não existe é recusada.
function attemptCliFrom(body: unknown): { ok: true; cli: Cli | undefined } | { ok: false } {
  if (body === undefined || body === null) return { ok: true, cli: undefined };
  if (typeof body !== "object") return { ok: false };
  const { cli } = body as Record<string, unknown>;
  if (cli === undefined) return { ok: true, cli: undefined };
  return isCli(cli) ? { ok: true, cli } : { ok: false };
}

const errorStatus = {
  process_not_found: 404,
  process_not_open: 409,
  refinement_already_requested: 409,
  refinement_not_requested: 409,
  attempt_in_progress: 409,
  refinement_completed: 409,
  problem_statement_confirmed: 409,
  unknown_proposal: 422,
  problem_statement_not_confirmed: 409,
  block_already_requested: 409,
  block_request_not_found: 404,
  block_generated: 409,
  question_not_found: 404,
  invalid_answer: 422,
  superseded_version: 409,
  invalid_draft: 422,
  synthesis_not_confirmed: 409,
  no_open_stage_points: 409,
  block_not_found: 404,
  synthesis_confirmed: 409,
  block_incomplete: 409,
  synthesis_already_requested: 409,
  synthesis_request_not_found: 404,
  synthesis_generated: 409,
  unknown_synthesis: 422,
  synthesis_outdated: 409,
  invalid_coverage: 422,
  question_answered: 409,
  already_unknown: 409,
  stage_point_not_found: 404,
  stage_point_closed: 409,
  stage_not_found: 404,
  stage_not_current: 409,
  open_stage_points: 409,
  nothing_to_assess: 409,
  blocking_pendencies: 409,
  unknown_assessment: 422,
  assessment_outdated: 409,
  assessment_required: 409,
  justification_required: 422,
  cli_model_not_configured: 409,
  constraint_not_found: 404,
  preference_not_found: 404,
  already_withdrawn: 409,
  absence_not_allowed: 422,
  no_constraint_or_preference: 409,
  undecided_reassessments: 409,
  reassessment_not_found: 404,
  impact_assessed: 409,
  reassessment_decided: 409,
  pendency_not_found: 404,
  pendency_resolved: 409,
  synthesis_not_applicable: 422,
  undecided_conflicts: 409,
  conflict_check_not_found: 404,
  conflict_assessed: 409,
  conflict_pair_not_found: 404,
  conflict_decided: 409,
  resolution_question_generated: 409,
} as const;

// Restrições e Preferências seguem as mesmas rotas, cada uma no seu caminho.
const itemKinds: ItemKind[] = ["constraint", "preference"];

export const processRoutes =
  ({
    db,
    problemStatements,
    blocks,
    answers,
    syntheses,
    pendencies,
    stagePointCoverage,
    stageAssessments,
    stageConfirmations,
    constraintsAndPreferences,
    reassessments,
    conflicts,
  }: {
    db: Db;
    problemStatements: ProblemStatements;
    blocks: Blocks;
    answers: Answers;
    syntheses: Syntheses;
    pendencies: Pendencies;
    stagePointCoverage: StagePointCoverage;
    stageAssessments: StageAssessments;
    stageConfirmations: StageConfirmations;
    constraintsAndPreferences: ConstraintsAndPreferences;
    reassessments: Reassessments;
    conflicts: Conflicts;
  }): FastifyPluginAsync =>
  async (app) => {
    app.post("/processes", async (request, reply) => {
      const description = descriptionFrom(request.body);
      if (description === undefined) return reply.code(400).send({ error: "description_required" });
      const process = await createProcess(db, description);
      return reply.code(201).send({ process });
    });

    app.get("/processes", async () => ({ processes: await listProcesses(db) }));

    // O Processo como o frontend o retoma: enunciado, Etapa, Blocos, respostas e Pendências.
    async function processDetail(id: string) {
      const process = uuidPattern.test(id) ? await findProcess(db, id) : undefined;
      if (!process) return undefined;
      return {
        ...process,
        ...(await problemStatements.find(id)),
        ...(await blocks.find(process)),
        pendencies: await pendencies.list(process),
        // Confirmações cuja Versão sustentada foi superada, ainda em revisão, e as Avaliações de impacto.
        reassessments: await reassessmentsOf(db, id),
        impactAssessments: await impactAssessmentsOf(db, id),
        // As verificações de conflito entre respostas confirmadas, com os pares e as Avaliações.
        conflictChecks: await conflictChecksOf(db, id),
        // As Avaliações de cada Etapa já aberta, da primeira à atual.
        stageAssessments: (
          await Promise.all(
            stages.slice(0, stages.indexOf(process.currentStage) + 1).map((stage) => stageAssessmentsOf(db, process, stage)),
          )
        ).flat(),
        stageConfirmations: await stageConfirmationsOf(db, process),
        ...(await constraintsAndPreferencesOf(db, id)),
      };
    }

    app.get<{ Params: { id: string } }>("/processes/:id", async (request, reply) => {
      const process = await processDetail(request.params.id);
      if (!process) return reply.code(404).send({ error: "process_not_found" });
      return { process };
    });

    app.get<{ Params: { id: string } }>("/processes/:id/understanding", async (request, reply) => {
      const process = await processDetail(request.params.id);
      if (!process) return reply.code(404).send({ error: "process_not_found" });
      return { understanding: understandingOf(process) };
    });

    app.post<{ Params: { id: string } }>("/processes/:id/problem-statement/refinement", async (request, reply) => {
      const { id } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      const result = await problemStatements.requestRefinement(id);
      if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
      return reply.code(202).send({ refinement: result.refinement });
    });

    app.post<{ Params: { id: string } }>(
      "/processes/:id/problem-statement/refinement/attempts",
      async (request, reply) => {
        const { id } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        const chosen = attemptCliFrom(request.body);
        if (!chosen.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await problemStatements.newRefinementAttempt(id, chosen.cli);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(202).send({ refinement: result.refinement });
      },
    );

    app.post<{ Params: { id: string } }>("/processes/:id/problem-statement/confirmation", async (request, reply) => {
      const { id } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      const confirmation = confirmationFrom(request.body);
      if (!confirmation) return reply.code(400).send({ error: "statement_required" });
      const result = await problemStatements.confirm(id, confirmation);
      if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
      return reply.code(201).send({ problemStatement: result.problemStatement });
    });

    app.post<{ Params: { id: string } }>("/processes/:id/block-requests", async (request, reply) => {
      const { id } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      const result = await blocks.request(id);
      if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
      return reply.code(202).send({ blockRequest: result.blockRequest });
    });

    app.post<{ Params: { id: string; requestId: string } }>(
      "/processes/:id/block-requests/:requestId/attempts",
      async (request, reply) => {
        const { id, requestId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(requestId)) return reply.code(404).send({ error: "block_request_not_found" });
        const chosen = attemptCliFrom(request.body);
        if (!chosen.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await blocks.newAttempt(id, requestId, chosen.cli);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(202).send({ blockRequest: result.blockRequest });
      },
    );

    app.post<{ Params: { id: string; questionId: string } }>(
      "/processes/:id/questions/:questionId/answer/versions",
      async (request, reply) => {
        const { id, questionId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(questionId)) return reply.code(404).send({ error: "question_not_found" });
        const change = answerChangeFrom(request.body);
        if (!change) return reply.code(400).send({ error: "answer_required" });
        const result = await answers.record(id, questionId, change);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ answerVersion: result.answerVersion });
      },
    );

    app.put<{ Params: { id: string; questionId: string } }>(
      "/processes/:id/questions/:questionId/answer/draft",
      async (request, reply) => {
        const { id, questionId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(questionId)) return reply.code(404).send({ error: "question_not_found" });
        const change = answerChangeFrom(request.body);
        if (!change) return reply.code(400).send({ error: "draft_required" });
        const result = await answers.saveDraft(id, questionId, change);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return { draft: result.draft };
      },
    );

    app.delete<{ Params: { id: string; questionId: string } }>(
      "/processes/:id/questions/:questionId/answer/draft",
      async (request, reply) => {
        const { id, questionId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(questionId)) return reply.code(404).send({ error: "question_not_found" });
        const result = await answers.discardDraft(id, questionId);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(204).send();
      },
    );

    app.post<{ Params: { id: string; blockId: string } }>(
      "/processes/:id/blocks/:blockId/synthesis-requests",
      async (request, reply) => {
        const { id, blockId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(blockId)) return reply.code(404).send({ error: "block_not_found" });
        const result = await syntheses.request(id, blockId);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(202).send({ synthesisRequest: result.synthesisRequest });
      },
    );

    app.post<{ Params: { id: string; blockId: string; requestId: string } }>(
      "/processes/:id/blocks/:blockId/synthesis-requests/:requestId/attempts",
      async (request, reply) => {
        const { id, blockId, requestId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(blockId)) return reply.code(404).send({ error: "block_not_found" });
        if (!uuidPattern.test(requestId)) return reply.code(404).send({ error: "synthesis_request_not_found" });
        const chosen = attemptCliFrom(request.body);
        if (!chosen.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await syntheses.newAttempt(id, blockId, requestId, chosen.cli);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(202).send({ synthesisRequest: result.synthesisRequest });
      },
    );

    app.post<{ Params: { id: string; blockId: string } }>(
      "/processes/:id/blocks/:blockId/synthesis/confirmation",
      async (request, reply) => {
        const { id, blockId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(blockId)) return reply.code(404).send({ error: "block_not_found" });
        const confirmation = synthesisConfirmationFrom(request.body);
        if (!confirmation) return reply.code(400).send({ error: "synthesis_required" });
        const result = await syntheses.confirm(id, blockId, confirmation);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ synthesis: result.synthesis });
      },
    );

    app.post<{ Params: { id: string; questionId: string } }>(
      "/processes/:id/questions/:questionId/unknown-information",
      async (request, reply) => {
        const { id, questionId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(questionId)) return reply.code(404).send({ error: "question_not_found" });
        const result = await pendencies.markUnknown(id, questionId);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ pendency: result.pendency });
      },
    );

    app.post<{ Params: { id: string; key: string } }>(
      "/processes/:id/stage-points/:key/inapplicability",
      async (request, reply) => {
        const { id, key } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        const justification = justificationFrom(request.body);
        if (justification === undefined) return reply.code(400).send({ error: "justification_required" });
        const result = await stagePointCoverage.declareInapplicable(id, key, justification);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ stagePoint: result.stagePoint });
      },
    );

    app.post<{ Params: { id: string; key: string } }>("/processes/:id/stage-points/:key/absence", async (request, reply) => {
      const { id, key } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      const result = await stagePointCoverage.recordAbsence(id, key);
      if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
      return reply.code(201).send({ stagePoint: result.stagePoint });
    });

    app.post<{ Params: { id: string; stage: string } }>("/processes/:id/stages/:stage/assessments", async (request, reply) => {
      const { id, stage } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      if (!isStage(stage)) return reply.code(404).send({ error: "stage_not_found" });
      const result = await stageAssessments.request(id, stage);
      if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
      return reply.code(201).send({ stageAssessment: result.stageAssessment });
    });

    app.post<{ Params: { id: string; stage: string } }>("/processes/:id/stages/:stage/confirmation", async (request, reply) => {
      const { id, stage } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      if (!isStage(stage)) return reply.code(404).send({ error: "stage_not_found" });
      const confirmation = stageConfirmationFrom(request.body);
      if (!confirmation) return reply.code(400).send({ error: "stage_assessment_id_required" });
      const result = await stageConfirmations.confirm(id, stage, confirmation);
      if (!result.ok) {
        const { error } = result;
        return reply.code(errorStatus[error]).send({ error, ...("pendencyIds" in result ? { pendencyIds: result.pendencyIds } : {}) });
      }
      return reply.code(201).send({ stageConfirmation: result.stageConfirmation });
    });

    app.post<{ Params: { id: string; versionId: string } }>(
      "/processes/:id/answer-versions/:versionId/impact-assessments",
      async (request, reply) => {
        const { id, versionId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(versionId)) return reply.code(404).send({ error: "reassessment_not_found" });
        const confirmation = confirmationRefFrom((request.body as Record<string, unknown> | undefined)?.confirmation);
        if (!confirmation) return reply.code(400).send({ error: "confirmation_required" });
        const result = await reassessments.retry(id, versionId, confirmation);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ impactAssessment: result.impactAssessment });
      },
    );

    app.post<{ Params: { id: string; versionId: string } }>(
      "/processes/:id/answer-versions/:versionId/impact-decision",
      async (request, reply) => {
        const { id, versionId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(versionId)) return reply.code(404).send({ error: "reassessment_not_found" });
        const decision = impactDecisionFrom(versionId, request.body);
        if (!decision) return reply.code(400).send({ error: "decision_required" });
        const result = await reassessments.decide(id, decision);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ pendency: result.pendency });
      },
    );

    app.post<{ Params: { id: string; pendencyId: string } }>(
      "/processes/:id/pendencies/:pendencyId/reconfirmation",
      async (request, reply) => {
        const { id, pendencyId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(pendencyId)) return reply.code(404).send({ error: "pendency_not_found" });
        const corrected = correctedSynthesisFrom(request.body);
        if (!corrected.ok) return reply.code(400).send({ error: "invalid_synthesis" });
        const result = await reassessments.reconfirm(id, pendencyId, corrected.synthesis);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return { pendency: result.pendency };
      },
    );

    app.post<{ Params: { id: string; checkId: string } }>(
      "/processes/:id/conflict-checks/:checkId/conflict-assessments",
      async (request, reply) => {
        const { id, checkId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(checkId)) return reply.code(404).send({ error: "conflict_check_not_found" });
        const result = await conflicts.retry(id, checkId);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ conflictCheck: result.conflictCheck });
      },
    );

    app.post<{ Params: { id: string; checkId: string } }>("/processes/:id/conflict-checks/:checkId/decision", async (request, reply) => {
      const { id, checkId } = request.params;
      if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
      if (!uuidPattern.test(checkId)) return reply.code(404).send({ error: "conflict_check_not_found" });
      const decision = conflictDecisionFrom(request.body);
      if (!decision) return reply.code(400).send({ error: "decision_required" });
      const result = await conflicts.decide(id, checkId, decision);
      if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
      return reply.code(201).send({ pendencies: result.pendencies });
    });

    app.post<{ Params: { id: string; pendencyId: string } }>(
      "/processes/:id/pendencies/:pendencyId/clarification",
      async (request, reply) => {
        const { id, pendencyId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(pendencyId)) return reply.code(404).send({ error: "pendency_not_found" });
        const clarification = clarificationFrom(request.body);
        if (clarification === undefined) return reply.code(400).send({ error: "clarification_required" });
        const result = await conflicts.clarify(id, pendencyId, clarification);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return { pendency: result.pendency };
      },
    );

    app.post<{ Params: { id: string; pendencyId: string } }>(
      "/processes/:id/pendencies/:pendencyId/constraint-revision",
      async (request, reply) => {
        const { id, pendencyId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(pendencyId)) return reply.code(404).send({ error: "pendency_not_found" });
        const revision = constraintRevisionFrom(request.body);
        if (!revision) return reply.code(400).send({ error: "revision_required" });
        const result = await conflicts.reviseConstraint(id, pendencyId, revision);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return { pendency: result.pendency };
      },
    );

    app.post<{ Params: { id: string; pendencyId: string } }>(
      "/processes/:id/pendencies/:pendencyId/resolution-question/attempts",
      async (request, reply) => {
        const { id, pendencyId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(pendencyId)) return reply.code(404).send({ error: "pendency_not_found" });
        const chosen = attemptCliFrom(request.body);
        if (!chosen.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await conflicts.requestResolutionQuestion(id, pendencyId, chosen.cli);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(202).send({ resolutionQuestion: result.resolutionQuestion });
      },
    );

    for (const kind of itemKinds) {
      const path = itemPaths[kind];
      app.post<{ Params: { id: string } }>(`/processes/:id/${path}`, async (request, reply) => {
        const { id } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        const item = itemStatementFrom(request.body);
        if (!item) return reply.code(400).send({ error: "statement_required" });
        const result = await constraintsAndPreferences.register(id, kind, item);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return reply.code(201).send({ [kind]: result.item });
      });

      app.post<{ Params: { id: string; itemId: string } }>(`/processes/:id/${path}/:itemId/withdrawal`, async (request, reply) => {
        const { id, itemId } = request.params;
        if (!uuidPattern.test(id)) return reply.code(404).send({ error: "process_not_found" });
        if (!uuidPattern.test(itemId)) return reply.code(404).send({ error: `${kind}_not_found` });
        const result = await constraintsAndPreferences.withdraw(id, kind, itemId);
        if (!result.ok) return reply.code(errorStatus[result.error]).send({ error: result.error });
        return { [kind]: result.item };
      });
    }
  };
