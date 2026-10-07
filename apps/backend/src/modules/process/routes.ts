import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../../db/database.ts";
import { createProcess, findProcess, listProcesses } from "./process.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A descrição é guardada como digitada; só se recusa texto ausente ou em branco.
function descriptionFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("description" in body)) return undefined;
  const { description } = body;
  return typeof description === "string" && description.trim() !== "" ? description : undefined;
}

export const processRoutes =
  (db: Db): FastifyPluginAsync =>
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
      return { process };
    });
  };
