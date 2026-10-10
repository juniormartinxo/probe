import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db/database.ts";
import { AiRequestRunner } from "./modules/ai/ai-requests.ts";
import type { Assistant } from "./modules/ai/assistant.ts";
import type { Assessor } from "./modules/assessments/assessor.ts";
import { stageAssessments } from "./modules/assessments/stage-assessments.ts";
import { answers } from "./modules/process/answers.ts";
import { blocks } from "./modules/process/blocks.ts";
import { constraintsAndPreferences } from "./modules/process/constraints-and-preferences.ts";
import { pendencies } from "./modules/process/pendencies.ts";
import { problemStatements } from "./modules/process/problem-statement.ts";
import { reassessments as reassessmentsModule } from "./modules/process/reassessments.ts";
import { processRoutes } from "./modules/process/routes.ts";
import { stageConfirmations } from "./modules/process/stage-confirmations.ts";
import { stagePointCoverage } from "./modules/process/stage-point-coverage.ts";
import { syntheses } from "./modules/process/syntheses.ts";
import { settingsRoutes } from "./modules/settings/routes.ts";
import { settings as settingsModule } from "./modules/settings/settings.ts";

export interface AppDependencies {
  db: Db;
  assistant: Assistant;
  assessor: Assessor;
  // Modelo usado nas novas solicitações à IA enquanto o usuário não escolhe outro.
  defaultAiModel: string;
}

export function buildApp({ db, assistant, assessor, defaultAiModel }: AppDependencies, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const runner = new AiRequestRunner(db, app.log);
  const settings = settingsModule({ db, assistant, defaultAiModel });
  const reassessments = reassessmentsModule({ db, assessor, log: app.log });

  // Ao subir, o que ficou em andamento de uma execução anterior não tem mais quem o receba.
  app.addHook("onReady", () => runner.interruptAbandoned());
  app.addHook("onClose", () => runner.shutdown());

  app.register(
    async (api) => {
      api.get("/health", async () => ({ status: "ok" }));
      await api.register(
        processRoutes({
          db,
          problemStatements: problemStatements({ db, assistant, runner, settings }),
          blocks: blocks({ db, assistant, runner, settings }),
          answers: answers({ db, afterChange: (processId, questionId) => reassessments.assessChange(processId, questionId) }),
          syntheses: syntheses({ db, assistant, runner, settings }),
          pendencies: pendencies({ db }),
          stagePointCoverage: stagePointCoverage({ db }),
          stageAssessments: stageAssessments({ db, assessor }),
          stageConfirmations: stageConfirmations({ db }),
          constraintsAndPreferences: constraintsAndPreferences({ db }),
          reassessments,
        }),
      );
      await api.register(settingsRoutes({ settings }));
    },
    { prefix: "/api" },
  );

  return app;
}
