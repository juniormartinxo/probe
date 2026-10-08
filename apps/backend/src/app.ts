import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db/database.ts";
import { AiRequestRunner } from "./modules/ai/ai-requests.ts";
import type { Assistant } from "./modules/ai/assistant.ts";
import { answers } from "./modules/process/answers.ts";
import { blocks } from "./modules/process/blocks.ts";
import { problemStatements } from "./modules/process/problem-statement.ts";
import { processRoutes } from "./modules/process/routes.ts";

export interface AppDependencies {
  db: Db;
  assistant: Assistant;
  // Modelo usado nas novas solicitações à IA.
  aiModel: string;
}

export function buildApp({ db, assistant, aiModel }: AppDependencies, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const runner = new AiRequestRunner(db, app.log);

  // Ao subir, o que ficou em andamento de uma execução anterior não tem mais quem o receba.
  app.addHook("onReady", () => runner.interruptAbandoned());
  app.addHook("onClose", () => runner.shutdown());

  app.register(
    async (api) => {
      api.get("/health", async () => ({ status: "ok" }));
      await api.register(
        processRoutes({
          db,
          problemStatements: problemStatements({ db, assistant, runner, aiModel }),
          blocks: blocks({ db, assistant, runner, aiModel }),
          answers: answers({ db }),
        }),
      );
    },
    { prefix: "/api" },
  );

  return app;
}
