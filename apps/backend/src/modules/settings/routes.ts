import type { FastifyPluginAsync } from "fastify";
import type { SettingsModule } from "./settings.ts";

// O modelo e o perfil do Cloak pedidos, como vieram; se são válidos, o módulo decide.
function settingsFrom(body: unknown): { claudeModel: unknown; cloakProfile: unknown } {
  if (typeof body !== "object" || body === null) return { claudeModel: undefined, cloakProfile: undefined };
  const { claudeModel, cloakProfile } = body as Record<string, unknown>;
  return { claudeModel, cloakProfile };
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
