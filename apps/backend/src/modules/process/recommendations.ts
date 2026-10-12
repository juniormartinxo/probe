import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequestRunner, type Attempt, type AttemptStatus } from "../ai/ai-requests.ts";
import {
  comparisonCellsOf,
  type Assistant,
  type AttemptContext,
  type Cli,
  type ComparisonCells,
  type RecommendationInput,
} from "../ai/assistant.ts";
import { recommendationProblem } from "../ai/recommend-option.ts";
import type { SettingsModule } from "../settings/settings.ts";
import { comparisonMatrixOf } from "./comparison-matrix.ts";
import { statementsInForceOf } from "./constraints-and-preferences.ts";
import { optionRefOf, optionsOf, type NamedOption } from "./options.ts";
import { confirmedStatementOf } from "./problem-statement.ts";
import { lockOpenProcess } from "./process.ts";
import { confirmedStagesOf } from "./stage-readiness.ts";
import { askedQuestionOf, currentVersionsOf, heldQuestionsOf, stageQuestions } from "./stage-questions.ts";
import { stagePointsOf } from "./stage-points.ts";

const RECOMMENDATION_OPERATION = "recommend_option";

// A Etapa em que a Recomendação é pedida.
const BALANCING_STAGE = "B";

// O que a tentativa concluída grava: a Recomendação com as Opções pelos ids, não pelas referências
// que a IA usou.
export interface RecommendationResult {
  optionId: string;
  rationale: string;
  comparisons: (ComparisonCells & { optionId: string })[];
}


// Recomendação da IA a favor de uma Opção viável, com a linha da matriz que ela sugere para cada
// Opção viável. É sugestão: nunca vira Escolha sem ato do usuário.
export interface Recommendation {
  id: string;
  status: AttemptStatus;
  attempts: Attempt[];
  // Null enquanto nenhuma tentativa trouxe a Recomendação.
  recommendation: { option: NamedOption; rationale: string; comparisons: (ComparisonCells & { option: NamedOption })[] } | null;
}

// As Recomendações do Processo, na ordem em que foram pedidas.
export async function recommendationsOf(db: Db, process: { id: string; stagePointsVersion: number }): Promise<Recommendation[]> {
  const requests = await listAiRequests<RecommendationResult>(db, process.id, RECOMMENDATION_OPERATION);
  if (requests.length === 0) return [];
  const options = await optionsOf(db, process);
  const named = (id: string): NamedOption => {
    const { statement } = options.find((option) => option.id === id)!;
    return { id, statement };
  };
  return requests.map(({ id, status, attempts, result }) => ({
    id,
    status,
    attempts,
    recommendation: result && {
      option: named(result.value.optionId),
      rationale: result.value.rationale,
      comparisons: result.value.comparisons.map(({ optionId, ...cells }) => ({ option: named(optionId), ...cells })),
    },
  }));
}

type RecommendationClosed = "process_not_found" | "process_not_open" | "stage_not_current" | "no_viable_option";

export type RecommendationError = RecommendationClosed | "recommendation_already_requested" | "cli_model_not_configured";

export type NewRecommendationAttemptError =
  | RecommendationClosed
  | "recommendation_not_found"
  | "attempt_in_progress"
  | "recommendation_made"
  | "cli_model_not_configured";

export interface Recommendations {
  // Pede à IA a Recomendação, enquanto a Etapa B é a atual.
  request(processId: string): Promise<{ ok: true; recommendation: Recommendation } | { ok: false; error: RecommendationError }>;
  // Nova tentativa da mesma Recomendação, depois de uma que não a trouxe. Sem `cli`, com a CLI da
  // tentativa anterior; com ela, com a que o usuário escolheu.
  newAttempt(
    processId: string,
    recommendationId: string,
    cli?: Cli,
  ): Promise<{ ok: true; recommendation: Recommendation } | { ok: false; error: NewRecommendationAttemptError }>;
}

interface PreparedRecommendation {
  input: RecommendationInput;
  // As Versões de resposta que o pedido envia à IA: as confirmadas das Etapas anteriores e as da Etapa B.
  usedVersionIds: string[];
  // A Opção de cada referência que a IA recebe.
  optionIds: Map<string, string>;
}

// O que a IA recebe para recomendar; chamar com o Processo travado.
async function prepareRecommendation(trx: Db, process: { id: string; stagePointsVersion: number }): Promise<PreparedRecommendation> {
  const { originalDescription } = await trx.selectFrom("processes").select("originalDescription").where("id", "=", process.id).executeTakeFirstOrThrow();
  // Respostas herdadas só valem reconfirmadas: até lá, ficam fora do que a IA recebe.
  const questions = heldQuestionsOf(await stageQuestions(trx, process.id, BALANCING_STAGE));
  const all = await optionsOf(trx, process);
  const matrix = await comparisonMatrixOf(trx, process);
  const options = matrix.map(({ option, viability, violations, comparison }) => ({
    ref: optionRefOf(all, option.id),
    statement: option.statement,
    description: option.description,
    viability,
    violatedConstraints: violations.map((violation) => violation.statement),
    comparison: comparison && comparisonCellsOf((dimension) => comparison[dimension]),
  }));
  return {
    input: {
      originalDescription,
      problemStatement: await confirmedStatementOf(trx, process.id),
      confirmedStages: await confirmedStagesOf(trx, process.id, BALANCING_STAGE),
      ...(await statementsInForceOf(trx, process.id)),
      // Os Pontos que os Blocos cobrem; o da Escolha é do usuário.
      stagePoints: stagePointsOf(process.stagePointsVersion, BALANCING_STAGE).filter((point) => !point.coveredByChoice),
      askedQuestions: questions.map(askedQuestionOf),
      options,
    },
    usedVersionIds: currentVersionsOf(questions),
    optionIds: new Map(matrix.map(({ option }) => [optionRefOf(all, option.id), option.id])),
  };
}

export function recommendations(deps: { db: Db; assistant: Assistant; runner: AiRequestRunner; settings: SettingsModule }): Recommendations {
  const { db, assistant, runner, settings } = deps;

  // Só a Opção viável pode ser recomendada, e a matriz sugerida tem uma linha para cada viável,
  // qualquer que seja a implementação do Assistant. A Recomendação é gravada pelos ids.
  async function recommend({ input, optionIds }: PreparedRecommendation, context: AttemptContext) {
    const outcome = await assistant.recommendOption(input, context);
    if (outcome.status !== "completed") return outcome;
    const problem = recommendationProblem(outcome.result, input);
    if (problem) return { status: "failed", reason: "invalid_output", message: problem, usage: outcome.usage } as const;
    const { comparisons, recommendedOption, rationale } = outcome.result;
    const result: RecommendationResult = {
      optionId: optionIds.get(recommendedOption)!,
      rationale,
      // Na ordem das Opções, como a matriz as mostra.
      comparisons: input.options.flatMap(({ ref }) => {
        const row = comparisons.find((item) => item.option === ref);
        if (!row) return [];
        const { option: _, ...cells } = row;
        return [{ optionId: optionIds.get(ref)!, ...cells }];
      }),
    };
    return { status: "completed", result, usage: outcome.usage } as const;
  }

  // Abre uma tentativa, com o Processo travado na Etapa B até a transação terminar, e só depois de
  // gravá-la dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    prepare: (trx: Db) => Promise<{ ok: true; aiRequestId: string; cli?: Cli } | { ok: false; error: E }>,
  ): Promise<{ ok: true; recommendation: Recommendation } | { ok: false; error: E | RecommendationClosed | "cli_model_not_configured" }> {
    const opened = await db.transaction().execute(async (trx) => {
      const locked = await lockOpenProcess(trx, processId);
      if (!locked.ok) return locked;
      if (locked.process.currentStage !== BALANCING_STAGE) return { ok: false, error: "stage_not_current" } as const;
      const prepared = await prepareRecommendation(trx, locked.process);
      // Sem Opção viável não há o que recomendar (uma Revisão de Restrição pode ter levado a isso).
      if (!prepared.input.options.some((option) => option.viability === "viable")) return { ok: false, error: "no_viable_option" } as const;
      const ready = await prepare(trx);
      if (!ready.ok) return ready;
      const attemptSettings = await settings.forNewAttempt(trx, ready.cli);
      if (!attemptSettings.ok) return attemptSettings;
      const attempt = await runner.openAttempt(trx, ready.aiRequestId, attemptSettings.settings, prepared.usedVersionIds);
      return { ok: true, attempt, aiRequestId: ready.aiRequestId, prepared, process: locked.process } as const;
    });
    if (!opened.ok) return opened;
    try {
      // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
      const recommendation = (await recommendationsOf(db, opened.process)).find((item) => item.id === opened.aiRequestId)!;
      return { ok: true, recommendation };
    } finally {
      // Aberta, a tentativa sempre segue, mesmo que a leitura falhe: nunca fica "running" à toa.
      runner.run(opened.attempt, (context) => recommend(opened.prepared, context));
    }
  }

  return {
    async request(processId) {
      return startAttempt(processId, async (trx) => {
        // Uma Recomendação que ainda não veio segue com novas tentativas, não com outra.
        const requests = await listAiRequests(trx, processId, RECOMMENDATION_OPERATION);
        if (requests.some((request) => request.status !== "completed")) return { ok: false, error: "recommendation_already_requested" } as const;
        const request = await trx
          .insertInto("aiRequests")
          .values({ processId, operation: RECOMMENDATION_OPERATION, blockId: null })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, aiRequestId: request.id } as const;
      });
    },

    async newAttempt(processId, recommendationId, cli) {
      return startAttempt(processId, async (trx) => {
        const request = (await listAiRequests(trx, processId, RECOMMENDATION_OPERATION)).find(({ id }) => id === recommendationId);
        if (!request) return { ok: false, error: "recommendation_not_found" } as const;
        if (request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (request.status === "completed") return { ok: false, error: "recommendation_made" } as const;
        return { ok: true, aiRequestId: request.id, cli: cli ?? request.attempts.at(-1)!.cli } as const;
      });
    },
  };
}
