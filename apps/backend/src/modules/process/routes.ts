import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../../db/database.ts";
import type { AnswerChange, AnswerValue, Answers } from "./answers.ts";
import type { Blocks } from "./blocks.ts";
import type { ProblemStatements, StatementConfirmation } from "./problem-statement.ts";
import { createProcess, findProcess, listProcesses } from "./process.ts";

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

const isOptionIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

// Alternativas escolhidas ou texto livre, nunca os dois. Se casam com a Pergunta, o módulo decide.
function answerValueFrom(body: Record<string, unknown>): AnswerValue | undefined {
  const { selectedOptions, text } = body;
  if (selectedOptions !== undefined && text !== undefined) return undefined;
  if (Array.isArray(selectedOptions) && selectedOptions.every(isOptionIndex)) return { selectedOptions };
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
} as const;

export const processRoutes =
  ({
    db,
    problemStatements,
    blocks,
    answers,
  }: {
    db: Db;
    problemStatements: ProblemStatements;
    blocks: Blocks;
    answers: Answers;
  }): FastifyPluginAsync =>
  async (app) => {
    app.post("/processes", async (request, reply) => {
      const description = descriptionFrom(request.body);
      if (description === undefined) return reply.code(400).send({ error: "description_required" });
      const process = await createProcess(db, description);
      return reply.code(201).send({ process });
    });

    app.get("/processes", async () => ({ processes: await listProcesses(db) }));

    app.get<{ Params: { id: string } }>("/processes/:id", async (request, reply) => {
      const { id } = request.params;
      const process = uuidPattern.test(id) ? await findProcess(db, id) : undefined;
      if (!process) return reply.code(404).send({ error: "process_not_found" });
      return { process: { ...process, ...(await problemStatements.find(id)), ...(await blocks.find(process)) } };
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
        const result = await problemStatements.newRefinementAttempt(id);
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
        const result = await blocks.newAttempt(id, requestId);
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
  };
