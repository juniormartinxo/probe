import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedRecommendation } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
import { FakeAssessor, optionOutcome, verdict } from "./support/fake-assessor.ts";
import { costConstraint, processApi } from "./support/process-api.ts";
import { createTestApp, resetDatabase, waitFor, type TestApp } from "./support/test-app.ts";

let testApp: TestApp;
let assistant: FakeAssistant;
let assessor: FakeAssessor;
const api = processApi(() => testApp);

beforeEach(async () => {
  assistant = new FakeAssistant();
  assessor = new FakeAssessor();
  testApp = await createTestApp({ assistant, assessor });
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

const runner = "Trocar o runner por um maior";
const cache = "Cachear as dependências no GitHub Actions";
const platform = "Contratar uma plataforma de CI de 2.000 reais por mês";

// Processo na Etapa B: na Etapa O, duas Opções viáveis (O1, O2) e uma que viola a Restrição de custo (O3).
async function processInStageB() {
  const { id, constraintId } = await api.processInStageO();
  const runnerId = (await api.addOption(id, { statement: runner, description: "Máquina com o dobro de CPU." })).json().option.id as string;
  const cacheId = (await api.addOption(id, { statement: cache })).json().option.id as string;
  assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));
  const platformId = (await api.addOption(id, { statement: platform })).json().option.id as string;
  expect((await api.confirmStageO(id)).statusCode).toBe(201);
  return { id, constraintId, runnerId, cacheId, platformId };
}

const cells = {
  gains: "Deploy em 15 minutos.",
  losses: "Custo maior.",
  effort: "Baixo: troca de configuração.",
  scalability: "Escala com o tamanho da máquina.",
  maintenance: "Nenhuma além da atual.",
  reversibility: "Total: basta voltar o runner.",
};

const recordComparison = (id: string, optionId: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/options/${optionId}/comparisons`, payload });

const requestRecommendation = (id: string) => api.inject({ method: "POST", url: `/api/processes/${id}/recommendations` });

const newRecommendationAttempt = (id: string, recommendationId: string) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/recommendations/${recommendationId}/attempts` });

const choose = (id: string, payload: Record<string, unknown>) => api.inject({ method: "POST", url: `/api/processes/${id}/chosen-options`, payload });

const confirmStageB = (id: string) => api.confirmStage(id, { stageAssessmentId: null }, "B");

// Pede a Recomendação à IA e espera a tentativa terminar.
async function recommend(id: string) {
  const response = await requestRecommendation(id);
  expect(response.statusCode).toBe(202);
  let process: Awaited<ReturnType<typeof api.getProcess>>;
  await waitFor(async () => {
    process = await api.getProcess(id);
    return process.recommendations.at(-1).status !== "running";
  });
  return process!;
}

// Fecha os três Pontos de B cobertos por Blocos, inaplicáveis; o da Escolha só a Escolha cobre.
async function closeBlockPoints(id: string) {
  for (const key of ["gains_and_losses", "scalability", "maintenance"]) {
    expect((await api.declareInapplicable(id, key, { justification: "Fora deste exemplo." })).statusCode).toBe(201);
  }
}

const recommendation: GeneratedRecommendation = {
  comparisons: [
    { option: "O1", ...cells },
    { option: "O2", gains: "Deploy em 25 minutos.", losses: "Cache pode ficar velho.", effort: "Médio.", scalability: "Limitada.", maintenance: "Invalidar o cache.", reversibility: "Total." },
  ],
  recommendedOption: "O2",
  rationale: "O cache cumpre a Restrição de custo e atende a Preferência de manter o GitHub Actions.",
};

describe("The comparison matrix", () => {
  it("has a row for each accepted Option, with its compliance with the Constraints and no numeric score", async () => {
    const { id, runnerId, cacheId, platformId, constraintId } = await processInStageB();

    const process = await api.getProcess(id);

    expect(process.currentStage).toBe("B");
    expect(process.comparisonMatrix).toEqual([
      { option: { id: runnerId, statement: runner, description: "Máquina com o dobro de CPU." }, viability: "viable", violations: [], comparison: null, history: [] },
      { option: { id: cacheId, statement: cache, description: null }, viability: "viable", violations: [], comparison: null, history: [] },
      {
        option: { id: platformId, statement: platform, description: null },
        viability: "inviable",
        violations: [{ constraintId, statement: costConstraint, decidedBy: "jev" }],
        comparison: null,
        history: [],
      },
    ]);
  });

  it("records the row the user writes, and a new row keeps the previous one in the history", async () => {
    const { id, runnerId } = await processInStageB();

    const first = await recordComparison(id, runnerId, cells);
    const second = await recordComparison(id, runnerId, { ...cells, losses: " Custo 30% maior. " });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().comparison).toEqual({ id: expect.any(String), ...cells, losses: "Custo 30% maior.", recommendationId: null, recordedAt: expect.any(String) });
    const [row] = (await api.getProcess(id)).comparisonMatrix;
    expect(row.comparison).toMatchObject({ losses: "Custo 30% maior." });
    expect(row.history).toEqual([expect.objectContaining({ id: first.json().comparison.id, losses: "Custo maior." })]);
  });

  it("needs every qualitative cell, an accepted and not inviable Option and Stage B reached", async () => {
    const { id, runnerId, platformId } = await processInStageB();

    for (const payload of [{}, { ...cells, effort: " " }, { ...cells, gains: 3 }, { ...cells, score: 7 }]) {
      const response = await recordComparison(id, runnerId, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "comparison_required" });
    }
    const inviable = await recordComparison(id, platformId, cells);
    expect(inviable.statusCode).toBe(409);
    expect(inviable.json()).toEqual({ error: "option_inviable" });
    const unknown = await recordComparison(id, "00000000-0000-4000-8000-000000000000", cells);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "option_not_found" });

    const { id: inStageO } = await api.processInStageO();
    const optionId = (await api.addOption(inStageO, { statement: runner })).json().option.id;
    const early = await recordComparison(inStageO, optionId, cells);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: "stage_not_current" });
  });
});

describe("The Recommendation of the AI", () => {
  it("is identified as such, suggests the rows of the viable Options and never becomes the Choice by itself", async () => {
    const { id, runnerId, cacheId } = await processInStageB();
    await recordComparison(id, runnerId, cells);
    assistant.recommendation.willRespond(completed(recommendation));

    const process = await recommend(id);

    expect(process.recommendations).toEqual([
      {
        id: expect.any(String),
        status: "completed",
        attempts: [expect.objectContaining({ status: "completed" })],
        recommendation: {
          option: { id: cacheId, statement: cache },
          rationale: recommendation.rationale,
          comparisons: [
            { option: { id: runnerId, statement: runner }, ...cells },
            { ...recommendation.comparisons[1], option: { id: cacheId, statement: cache } },
          ],
        },
      },
    ]);
    expect(process.chosenOptions).toEqual([]);
    expect(process.comparisonMatrix[1].comparison).toBeNull();
    const { input } = assistant.recommendation.attempts.at(-1)!;
    expect(input.problemStatement).toBe("O deploy leva 40 minutos e bloqueia o time durante a manhã.");
    expect(input.confirmedStages.map((stage) => stage.stage)).toEqual(["P", "R", "O"]);
    expect(input.constraints).toEqual([{ statement: costConstraint, scope: null, unit: null }]);
    expect(input.preferences).toEqual([{ statement: "Manter o GitHub Actions", scope: null, unit: null }]);
    expect(input.stagePoints.map((point) => point.key)).toEqual(["gains_and_losses", "scalability", "maintenance"]);
    expect(input.options).toEqual([
      { ref: "O1", statement: runner, description: "Máquina com o dobro de CPU.", viability: "viable", violatedConstraints: [], comparison: cells },
      { ref: "O2", statement: cache, description: null, viability: "viable", violatedConstraints: [], comparison: null },
      { ref: "O3", statement: platform, description: null, viability: "inviable", violatedConstraints: [costConstraint], comparison: null },
    ]);
  });

  it("has a suggested row accepted by the user, as it came or edited, with the Recommendation it came from", async () => {
    const { id, cacheId } = await processInStageB();
    assistant.recommendation.willRespond(completed(recommendation));
    const recommendationId = (await recommend(id)).recommendations[0].id;
    const { option: _, ...suggested } = recommendation.comparisons[1]!;

    const response = await recordComparison(id, cacheId, { ...suggested, recommendationId });

    expect(response.statusCode).toBe(201);
    expect(response.json().comparison).toMatchObject({ ...suggested, recommendationId });
    const stranger = await recordComparison(id, cacheId, { ...suggested, recommendationId: "00000000-0000-4000-8000-000000000000" });
    expect(stranger.statusCode).toBe(422);
    expect(stranger.json()).toEqual({ error: "unknown_recommendation" });
  });

  it("is refused when it recommends an inviable Option or leaves a viable one out of the matrix", async () => {
    const { id } = await processInStageB();
    assistant.recommendation.willRespond(
      completed({ ...recommendation, recommendedOption: "O3" }),
      completed({ ...recommendation, comparisons: [recommendation.comparisons[0]!] }),
    );

    const first = await recommend(id);
    expect(first.recommendations[0]).toMatchObject({ status: "failed", recommendation: null });
    expect(first.recommendations[0].attempts[0]).toMatchObject({ failureReason: "invalid_output" });

    // Enquanto a Recomendação não vem, segue com novas tentativas, não com outra Recomendação.
    const another = await requestRecommendation(id);
    expect(another.statusCode).toBe(409);
    expect(another.json()).toEqual({ error: "recommendation_already_requested" });

    const retried = await newRecommendationAttempt(id, first.recommendations[0].id);
    expect(retried.statusCode).toBe(202);
    await waitFor(async () => (await api.getProcess(id)).recommendations[0].status !== "running");
    expect((await api.getProcess(id)).recommendations[0]).toMatchObject({ status: "failed", attempts: [{}, { failureReason: "invalid_output" }] });
  });

  it("can be asked again, keeping the earlier ones in the history", async () => {
    const { id } = await processInStageB();
    await recommend(id);

    const process = await recommend(id);

    expect(process.recommendations.map((item: { status: string }) => item.status)).toEqual(["completed", "completed"]);
  });

  it("is asked only while Stage B is the current one", async () => {
    const { id } = await api.processInStageO();

    const response = await requestRecommendation(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_not_current" });
  });
});

describe("The Choice", () => {
  it("is recorded by the user with the reason for discarding each other viable Option", async () => {
    const { id, runnerId, cacheId } = await processInStageB();
    await recommend(id);

    const response = await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: " Custo maior que o cache. " }] });

    expect(response.statusCode).toBe(201);
    expect(response.json().chosenOption).toEqual({
      id: expect.any(String),
      option: { id: cacheId, statement: cache },
      discards: [{ option: { id: runnerId, statement: runner }, reason: "Custo maior que o cache." }],
      chosenAt: expect.any(String),
      supersededAt: null,
    });
    const process = await api.getProcess(id);
    expect(process.chosenOptions).toHaveLength(1);
    expect(process.stagePoints.find((point: { key: string }) => point.key === "chosen_option_and_discards")).toMatchObject({ status: "chosen" });
  });

  it("refuses an inviable Option", async () => {
    const { id, runnerId, cacheId, platformId } = await processInStageB();

    const response = await choose(id, {
      optionId: platformId,
      discards: [
        { optionId: runnerId, reason: "Mais caro." },
        { optionId: cacheId, reason: "Mais lento." },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "option_not_choosable" });
    expect((await api.getProcess(id)).chosenOptions).toEqual([]);
  });

  it("needs a reason for each other viable Option, and only for them", async () => {
    const { id, runnerId, cacheId, platformId } = await processInStageB();

    const missing = await choose(id, { optionId: cacheId, discards: [] });
    const blank = await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "  " }] });
    const inviable = await choose(id, {
      optionId: cacheId,
      discards: [
        { optionId: runnerId, reason: "Mais caro." },
        { optionId: platformId, reason: "Viola o custo." },
      ],
    });
    const itself = await choose(id, {
      optionId: cacheId,
      discards: [
        { optionId: runnerId, reason: "Mais caro." },
        { optionId: cacheId, reason: "?" },
      ],
    });

    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toEqual({ error: "discard_reasons_required" });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: "choice_required" });
    expect(inviable.statusCode).toBe(422);
    expect(inviable.json()).toEqual({ error: "invalid_discards" });
    expect(itself.json()).toEqual({ error: "invalid_discards" });
  });

  it("is changed by recording a new one, which keeps the previous one in the history", async () => {
    const { id, runnerId, cacheId } = await processInStageB();
    const first = (await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "Mais caro." }] })).json().chosenOption;

    const second = await choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "Cache instável." }] });

    expect(second.statusCode).toBe(201);
    const { chosenOptions } = await api.getProcess(id);
    expect(chosenOptions).toEqual([
      { ...first, supersededAt: second.json().chosenOption.chosenAt },
      expect.objectContaining({ option: { id: runnerId, statement: runner }, supersededAt: null }),
    ]);
  });

  it("covers its Point, which no Block asks about and no one declares inapplicable", async () => {
    const { id } = await processInStageB();

    const process = await api.getProcess(id);
    const inapplicable = await api.declareInapplicable(id, "chosen_option_and_discards", { justification: "Não quero escolher." });
    await api.generateBlock(id);

    expect(process.stagePoints.find((point: { key: string }) => point.key === "chosen_option_and_discards")).toMatchObject({
      status: "open",
      coveredByChoice: true,
    });
    expect(process.openStagePoints.map((point: { key: string }) => point.key)).toEqual(["gains_and_losses", "scalability", "maintenance"]);
    expect(inapplicable.statusCode).toBe(409);
    expect(inapplicable.json()).toEqual({ error: "stage_point_covered_by_choice" });
    expect(assistant.block.attempts.at(-1)!.input.openStagePoints.map((point) => point.key)).toEqual([
      "gains_and_losses",
      "scalability",
      "maintenance",
    ]);
  });

  it("can be recorded only from Stage B on", async () => {
    const { id } = await api.processInStageO();
    const optionId = (await api.addOption(id, { statement: runner })).json().option.id;

    const response = await choose(id, { optionId, discards: [] });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_not_current" });
  });
});

describe("Confirming Stage B", () => {
  it("is refused without a Choice", async () => {
    const { id } = await processInStageB();
    await closeBlockPoints(id);

    const response = await confirmStageB(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "choice_required" });
  });

  it("opens Stage E with the Choice recorded", async () => {
    const { id, runnerId, cacheId } = await processInStageB();
    await closeBlockPoints(id);
    await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "Mais caro." }] });

    const response = await confirmStageB(id);

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stage: "B" });
    expect((await api.getProcess(id)).currentStage).toBe("E");
  });

  it("keeps the Choice revisable after Stage B, while the Process is open", async () => {
    const { id, runnerId, cacheId } = await processInStageB();
    await closeBlockPoints(id);
    await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "Mais caro." }] });
    await confirmStageB(id);

    const response = await choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "O cache não resolveu." }] });

    expect(response.statusCode).toBe(201);
    expect((await api.getProcess(id)).chosenOptions.map((item: { option: { id: string } }) => item.option.id)).toEqual([cacheId, runnerId]);
  });
});

describe("A Constraint revision in Stage B", () => {
  it("assesses the Options against the new Constraint, and a chosen Option that becomes inviable must be chosen again", async () => {
    const { id, constraintId, runnerId, cacheId } = await processInStageB();
    await closeBlockPoints(id);
    await choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "Cache instável." }] });
    const assessed = assessor.optionInputs.length;
    // A nova Restrição: o runner maior e a plataforma passam a violá-la; o cache, não.
    assessor.willAssessOptions(optionOutcome((pair) => verdict(pair.option.statement === cache ? "no" : "yes", 0.95)));

    const revised = await api.reviseConstraint(id, constraintId, { kind: "constraint", statement: "O custo não pode passar de 300 reais por mês" });

    expect(revised.statusCode).toBe(201);
    expect(assessor.optionInputs).toHaveLength(assessed + 1);
    expect(assessor.optionInputs.at(-1)!.pairs.map((pair) => pair.option.statement)).toEqual([runner, cache, platform]);
    const process = await api.getProcess(id);
    expect(process.comparisonMatrix.map((row: { viability: string }) => row.viability)).toEqual(["inviable", "viable", "inviable"]);
    expect(process.constraintRevisions).toHaveLength(1);
    expect(process.stagePoints.find((point: { key: string }) => point.key === "chosen_option_and_discards")).toMatchObject({ status: "open" });

    const refused = await confirmStageB(id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "chosen_option_not_viable" });
    const understanding = (await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` })).json().understanding;
    expect(understanding.chosenOption).toMatchObject({ statement: runner, viable: false });

    // O cache, agora a única viável, é escolhido sem descarte a justificar.
    expect((await choose(id, { optionId: cacheId, discards: [] })).statusCode).toBe(201);
    expect((await confirmStageB(id)).statusCode).toBe(201);
  });

  it("waits for the user on each pair the Jev was not sure about", async () => {
    const { id, constraintId, runnerId, cacheId } = await processInStageB();
    await closeBlockPoints(id);
    await choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "Cache instável." }] });
    assessor.willAssessOptions(optionOutcome(() => verdict("insufficient", 0.5)));

    await api.reviseConstraint(id, constraintId, { kind: "constraint", statement: "O custo não pode passar de 300 reais por mês" });

    const response = await confirmStageB(id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "undecided_options" });
  });
});

describe("The understanding of the Process", () => {
  it("shows the Choice in force with the reasons of the discards", async () => {
    const { id, runnerId, cacheId } = await processInStageB();
    await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "Mais caro." }] });

    const response = await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` });

    expect(response.json().understanding.chosenOption).toEqual({ statement: cache, viable: true, discards: [{ statement: runner, reason: "Mais caro." }] });
  });
});
