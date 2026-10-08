import type { FastifyPluginAsync } from "fastify";
import type { SettingsModule } from "./settings.ts";

// O modelo pedido, como veio; se é um modelo válido, o módulo decide.
function settingsFrom(body: unknown): { claudeModel: unknown } {
  if (typeof body !== "object" || body === null) return { claudeModel: undefined };
  return { claudeModel: (body as Record<string, unknown>).claudeModel };
}

export const settingsRoutes =
  ({ settings }: { settings: SettingsModule }): FastifyPluginAsync =>
  async (app) => {
    // Só lê o banco: abrir a página de configuração nunca chama a IA.
    app.get("/settings", async () => ({ settings: await settings.find() }));

    app.put("/settings", async (request, reply) => {
      const result = await settings.save(settingsFrom(request.body));
      if (!result.ok) return reply.code(400).send({ error: result.error });
      return { settings: result.settings };
    });

    app.post("/settings/connection-test", async (_request, reply) => {
      // Se o navegador desistir da resposta, a CLI é interrompida em vez de seguir sem ninguém esperando.
      const cancellation = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) cancellation.abort();
      });
      return { connectionTest: await settings.testConnection(cancellation.signal) };
    });
  };
