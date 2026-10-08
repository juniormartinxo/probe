import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../../db/database.ts";
import { isCli, type Cli } from "../ai/assistant.ts";
import { stageAssessmentsOf, type StageAssessments } from "../assessments/stage-assessments.ts";
import type { AnswerChange, AnswerValue, Answers } from "./answers.ts";
import type { Blocks } from "./blocks.ts";
import type { Pendencies } from "./pendencies.ts";
import type { ProblemStatements, StatementConfirmation } from "./problem-statement.ts";
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

// A Avaliação que o usuário viu (a concluída ou a que falhou) e, se houver, a justificativa.
function stageConfirmationFrom(body: unknown): StageConfirmationRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { stageAssessmentId } = body as Record<string, unknown>;
  if (stageAssessmentId !== null && (typeof stageAssessmentId !== "string" || !uuidPattern.test(stageAssessmentId))) {
    return undefined;
  }
  return { stageAssessmentId, justification: justificationFrom(body)?.trim() ?? null };
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
} as const;

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
        // As Avaliações de cada Etapa já aberta, da primeira à atual.
        stageAssessments: (
          await Promise.all(
            stages.slice(0, stages.indexOf(process.currentStage) + 1).map((stage) => stageAssessmentsOf(db, process, stage)),
          )
        ).flat(),
        stageConfirmations: await stageConfirmationsOf(db, process),
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
        const choice = attemptCliFrom(request.body);
        if (!choice.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await problemStatements.newRefinementAttempt(id, choice.cli);
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
        const choice = attemptCliFrom(request.body);
        if (!choice.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await blocks.newAttempt(id, requestId, choice.cli);
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
        const choice = attemptCliFrom(request.body);
        if (!choice.ok) return reply.code(400).send({ error: "invalid_cli" });
        const result = await syntheses.newAttempt(id, blockId, requestId, choice.cli);
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
  };
