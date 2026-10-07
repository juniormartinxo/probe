import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { runClaude } from "./claude.ts";
import type { Config } from "./config.ts";
import { credentialChecker } from "./credential.ts";
import { parseGenerationRequest } from "./generation-request.ts";

export type ExecutorOptions = Pick<Config, "token" | "timeoutMs" | "cliEnv">;

export function buildApp(options: ExecutorOptions, appOptions: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: appOptions.logger ?? false });
  const hasCredential = credentialChecker(options.token);
  // Gerações em andamento, pelo id que o backend deu à solicitação.
  const running = new Map<string, AbortController>();

  // Ao encerrar, nenhuma CLI fica rodando sem alguém para receber o resultado.
  app.addHook("preClose", async () => {
    for (const cancellation of running.values()) cancellation.abort();
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Tudo o que aciona a CLI exige a credencial técnica combinada com o backend.
  app.register(async (generations) => {
    generations.addHook("onRequest", async (request, reply) => {
      if (!hasCredential(request.headers.authorization)) return reply.code(401).send({ error: "credential_required" });
    });

    generations.post("/generations", async (request, reply) => {
      const parsed = parseGenerationRequest(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      const { id, model, prompt } = parsed.request;
      if (running.has(id)) return reply.code(409).send({ error: "generation_in_progress" });

      const cancellation = new AbortController();
      running.set(id, cancellation);
      // Se o backend largar a conexão, ninguém vai receber o resultado: a CLI é interrompida.
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) cancellation.abort();
      });
      let workDir: string | undefined;
      try {
        // Diretório vazio por geração: a CLI não acha CLAUDE.md nem configuração de projeto por perto.
        workDir = await mkdtemp(path.join(tmpdir(), "probe-claude-"));
        const outcome = await runClaude({
          model,
          prompt,
          env: options.cliEnv,
          cwd: workDir,
          timeoutMs: options.timeoutMs,
          signal: cancellation.signal,
        });
        return { id, ...outcome };
      } finally {
        running.delete(id);
        if (workDir) await rm(workDir, { recursive: true, force: true });
      }
    });

    generations.post<{ Params: { id: string } }>("/generations/:id/cancel", async (request, reply) => {
      const { id } = request.params;
      const cancellation = running.get(id);
      if (!cancellation) return reply.code(404).send({ error: "generation_not_running" });
      cancellation.abort();
      return reply.code(202).send({ id, status: "canceling" });
    });
  });

  return app;
}
