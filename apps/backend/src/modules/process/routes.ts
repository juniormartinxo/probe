import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../../db/database.ts";
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

const errorStatus = {
  process_not_found: 404,
  process_not_open: 409,
  refinement_already_requested: 409,
  refinement_not_requested: 409,
  attempt_in_progress: 409,
  refinement_completed: 409,
  problem_statement_confirmed: 409,
  unknown_proposal: 422,
} as const;

export const processRoutes =
  ({ db, problemStatements }: { db: Db; problemStatements: ProblemStatements }): FastifyPluginAsync =>
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
      return { process: { ...process, ...(await problemStatements.find(id)) } };
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
  };
