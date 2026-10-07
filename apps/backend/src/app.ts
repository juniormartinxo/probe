import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db/database.ts";
import { processRoutes } from "./modules/process/routes.ts";

export interface AppDependencies {
  db: Db;
}

export function buildApp({ db }: AppDependencies, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.register(
    async (api) => {
      api.get("/health", async () => ({ status: "ok" }));
      await api.register(processRoutes(db));
    },
    { prefix: "/api" },
  );

  return app;
}
