import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock } from "../src/modules/ai/assistant.ts";
import type { AssessorOutcome, Verdict } from "../src/modules/assessments/assessor.ts";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
import { FakeAssessor, impactOutcome, optionOutcome, verdict } from "./support/fake-assessor.ts";
import { costConstraint, processApi, statement } from "./support/process-api.ts";
import { createTestApp, resetDatabase, type TestApp } from "./support/test-app.ts";

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

const firstStep = "Ativar o cache de dependências no workflow de deploy nesta sexta.";
const successCriteria = "O deploy cai para menos de 20 minutos em duas semanas.";
const planB = "Se o deploy não cair, trocar o runner por um maior.";

// Processo na Etapa E: na Etapa O, duas Opções viáveis; na B, o cache escolhido, com o runner descartado.
async function processInStageE() {
  const { id, constraintId } = await api.processInStageO();
  const runnerId = (await api.addOption(id, { statement: runner })).json().option.id as string;
  const cacheId = (await api.addOption(id, { statement: cache, description: "Cache do pnpm por hash do lockfile." })).json().option.id as string;
  expect((await api.confirmStageO(id)).statusCode).toBe(201);
  for (const key of ["gains_and_losses", "scalability", "maintenance"]) {
    expect((await api.declareInapplicable(id, key, { justification: "Fora deste exemplo." })).statusCode).toBe(201);
  }
  expect((await choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "Mais caro." }] })).statusCode).toBe(201);
  expect((await api.confirmStage(id, { stageAssessmentId: null }, "B")).statusCode).toBe(201);
  return { id, constraintId, runnerId, cacheId };
}

const choose = (id: string, payload: Record<string, unknown>) => api.inject({ method: "POST", url: `/api/processes/${id}/chosen-options`, payload });

const recordElement = (id: string, element: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/execution-plan/${element}`, payload });

const assessPlan = (id: string) => api.inject({ method: "POST", url: `/api/processes/${id}/execution-plan/assessments` });

const keepElement = (id: string, element: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/execution-plan/${element}/decision`, payload });

const confirmStageE = (id: string) => api.confirmStage(id, { stageAssessmentId: null }, "E");

// Registra os três elementos, cada um avaliado compatível pelo Jev falso, salvo roteiro.
async function recordPlan(id: string) {
  for (const [element, text] of [
    ["first_step", firstStep],
    ["success_criteria", successCriteria],
    ["plan_b", planB],
  ]) {
    expect((await recordElement(id, element!, { text })).statusCode).toBe(201);
  }
}

const elementOf = async (id: string, key: string) =>
  (await api.getProcess(id)).executionPlan.find((element: { key: string }) => element.key === key);

const planOutcome = (choice: Verdict["choice"], confidence = 0.9): AssessorOutcome<Verdict> => impactOutcome(choice, confidence);

const jevDown: AssessorOutcome<Verdict> = { status: "failed", reason: "jev_unavailable", message: "O Jev está fora do ar." };

const executionBlock: GeneratedBlock = {
  questions: [
    {
      wording: "Quem pode ativar o cache no workflow de deploy, e quando?",
      subject: "Responsável pelo primeiro passo",
      contextRelation: "A Escolha foi cachear as dependências no GitHub Actions.",
      rationale: null,
      stagePoints: ["first_step"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
    {
      wording: "Que tempo de deploy mostraria que o cache resolveu?",
      subject: "Sinal de sucesso",
      contextRelation: "O deploy hoje leva 40 minutos.",
      rationale: null,
      stagePoints: ["success_criteria", "plan_b"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

describe("The Blocks of Stage E", () => {
  it("serve the Points still without an element, from the Choice and the Constraints", async () => {
    const { id } = await processInStageE();
    assistant.block.willRespond(completed(executionBlock));

    await api.generateBlock(id);

    const input = assistant.block.attempts.at(-1)!.input;
    expect(input.stage).toBe("E");
    expect(input.openStagePoints.map((point) => point.key)).toEqual(["first_step", "success_criteria", "plan_b"]);
    expect(input.chosenOption).toEqual({
      statement: cache,
      description: "Cache do pnpm por hash do lockfile.",
      discards: [{ statement: runner, reason: "Mais caro." }],
    });
    expect(input.constraints.map((item) => item.statement)).toEqual([costConstraint]);
  });

  it("leave out the Points whose element was recorded", async () => {
    const { id } = await processInStageE();
    await recordElement(id, "first_step", { text: firstStep });
    assistant.block.willRespond(completed({ questions: executionBlock.questions.slice(1) }));

    await api.generateBlock(id);

    expect(assistant.block.attempts.at(-1)!.input.openStagePoints.map((point) => point.key)).toEqual(["success_criteria", "plan_b"]);
  });

  it("have their synthesis confirmed without covering any Point", async () => {
    const { id } = await processInStageE();
    assistant.block.willRespond(completed(executionBlock));
    const block = await api.generateBlock(id);
    for (const question of block.questions) {
      expect((await api.answer(id, question.id, { text: "A Ana, nesta sexta.", basedOnVersionId: null })).statusCode).toBe(201);
    }
    assistant.synthesis.willRespond(completed({ synthesis: "A Ana ativa o cache nesta sexta.", coverage: [], ambiguousAnswers: [] }));

    const proposal = await api.synthesize(id, block.id);
    const confirmed = await api.confirmSynthesis(id, block.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] });

    expect(assistant.synthesis.attempts.at(-1)!.input.openStagePoints).toEqual([]);
    expect(confirmed.statusCode).toBe(201);
    const points = (await api.getProcess(id)).stagePoints;
    expect(points.map((point: { status: string }) => point.status)).toEqual(["open", "open", "open"]);
  });
});

describe("The execution plan", () => {
  it("records each element written by the user, which covers its Point, and a rewrite keeps the previous one", async () => {
    const { id } = await processInStageE();

    const first = await recordElement(id, "first_step", { text: ` ${firstStep} ` });
    const second = await recordElement(id, "first_step", { text: "Ativar o cache hoje à tarde." });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const element = await elementOf(id, "first_step");
    expect(element).toMatchObject({
      key: "first_step",
      name: "Primeiro passo concreto",
      current: { id: expect.any(String), text: "Ativar o cache hoje à tarde.", recordedAt: expect.any(String) },
      history: [{ id: first.json().executionPlan.find((item: { key: string }) => item.key === "first_step").current.id, text: firstStep }],
    });
    const points = (await api.getProcess(id)).stagePoints;
    expect(points.map((point: { key: string; status: string }) => [point.key, point.status])).toEqual([
      ["first_step", "planned"],
      ["success_criteria", "open"],
      ["plan_b", "open"],
    ]);
  });

  it("needs a text, a known element and Stage E reached", async () => {
    const { id } = await processInStageE();

    for (const payload of [{}, { text: " " }, { text: 3 }]) {
      const response = await recordElement(id, "first_step", payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "plan_element_required" });
    }
    const unknown = await recordElement(id, "deadline", { text: firstStep });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "plan_element_not_found" });

    const { id: inStageR } = await api.processInStageR();
    const early = await recordElement(inStageR, "first_step", { text: firstStep });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: "stage_not_current" });
  });

  it("has Points no one declares inapplicable", async () => {
    const { id } = await processInStageE();

    const response = await api.declareInapplicable(id, "plan_b", { justification: "Não há plano B." });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_point_covered_by_plan" });
  });
});

describe("The compatibility of the plan with the Choice", () => {
  it("is assessed by the Jev for each element as it is recorded, against the Choice in force", async () => {
    const { id } = await processInStageE();

    await recordElement(id, "plan_b", { text: planB });

    expect(assessor.planInputs).toEqual([
      {
        problemStatement: statement,
        chosenOption: { statement: cache, description: "Cache do pnpm por hash do lockfile.", discards: [{ statement: runner, reason: "Mais caro." }] },
        element: { key: "plan_b", name: "Plano B", description: expect.any(String), text: planB },
      },
    ]);
    const element = await elementOf(id, "plan_b");
    expect(element.compatibility).toMatchObject({
      status: "compatible",
      assessment: { status: "completed", choice: "yes", confidence: 0.9, jevModel: "jev-de-teste", needsDecision: false },
      decision: null,
    });
  });

  it("shows an incompatibility, and the user keeps the element only with a justification", async () => {
    const { id } = await processInStageE();
    assessor.willAssessPlan(planOutcome("no", 0.95));
    await recordPlan(id);
    const element = await elementOf(id, "first_step");
    expect(element.compatibility).toMatchObject({ status: "awaiting_decision", assessment: { choice: "no", needsDecision: true } });

    const refused = await confirmStageE(id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "undecided_plan_compatibility" });
    const unjustified = await keepElement(id, "first_step", { planAssessmentId: element.compatibility.assessment.id });
    expect(unjustified.statusCode).toBe(422);
    expect(unjustified.json()).toEqual({ error: "justification_required" });

    const kept = await keepElement(id, "first_step", {
      planAssessmentId: element.compatibility.assessment.id,
      justification: " O cache entra pelo mesmo workflow. ",
    });

    expect(kept.statusCode).toBe(201);
    expect((await elementOf(id, "first_step")).compatibility).toMatchObject({
      status: "kept",
      decision: { justification: "O cache entra pelo mesmo workflow.", decidedAt: expect.any(String) },
    });
    expect((await confirmStageE(id)).statusCode).toBe(201);
  });

  it("shows an uncertain judgment for the user to decide on", async () => {
    const { id } = await processInStageE();
    assessor.willAssessPlan(planOutcome("yes", 0.5), planOutcome("insufficient", 0.9));

    await recordElement(id, "first_step", { text: firstStep });
    await recordElement(id, "success_criteria", { text: successCriteria });

    expect((await elementOf(id, "first_step")).compatibility.status).toBe("awaiting_decision");
    expect((await elementOf(id, "success_criteria")).compatibility.status).toBe("awaiting_decision");
  });

  it("is rewritten instead of kept, with a new Assessment of the new text", async () => {
    const { id } = await processInStageE();
    assessor.willAssessPlan(planOutcome("no", 0.95));
    await recordElement(id, "first_step", { text: "Contratar uma plataforma de CI." });

    await recordElement(id, "first_step", { text: firstStep });

    expect(assessor.planInputs.map((input) => input.element.text)).toEqual(["Contratar uma plataforma de CI.", firstStep]);
    expect((await elementOf(id, "first_step")).compatibility.status).toBe("compatible");
  });

  it("with the Jev failing, is tried again or kept without an Assessment", async () => {
    const { id } = await processInStageE();
    assessor.willAssessPlan(jevDown, jevDown);
    await recordPlan(id);
    expect((await elementOf(id, "first_step")).compatibility).toMatchObject({
      status: "assessment_failed",
      assessment: { status: "failed", failureReason: "jev_unavailable" },
    });
    const failed = (await elementOf(id, "success_criteria")).compatibility.assessment;

    // A nova tentativa avalia só os elementos sem Avaliação que valha: o Jev volta para o primeiro e falha de novo no segundo.
    assessor.willAssessPlan(planOutcome("yes"), jevDown);
    const retried = await assessPlan(id);

    expect(retried.statusCode).toBe(201);
    expect(assessor.planInputs.map((input) => input.element.key)).toEqual(["first_step", "success_criteria", "plan_b", "first_step", "success_criteria"]);
    expect((await elementOf(id, "first_step")).compatibility.status).toBe("compatible");
    const latest = (await elementOf(id, "success_criteria")).compatibility.assessment;
    expect(latest.id).not.toBe(failed.id);
    const stale = await keepElement(id, "success_criteria", { planAssessmentId: failed.id });
    expect(stale.statusCode).toBe(422);
    expect(stale.json()).toEqual({ error: "unknown_assessment" });
    const kept = await keepElement(id, "success_criteria", { planAssessmentId: latest.id });
    expect(kept.statusCode).toBe(201);
    expect((await elementOf(id, "success_criteria")).compatibility).toMatchObject({ status: "kept", decision: { justification: null } });
    expect((await confirmStageE(id)).statusCode).toBe(201);
  });

  it("is not decided by the user when the Jev already found it compatible", async () => {
    const { id } = await processInStageE();
    await recordElement(id, "first_step", { text: firstStep });
    const element = await elementOf(id, "first_step");

    const response = await keepElement(id, "first_step", { planAssessmentId: element.compatibility.assessment.id, justification: "Sim." });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "plan_element_decided" });
  });

  it("goes out of date when the Choice changes, and is assessed again against the new one", async () => {
    const { id, runnerId, cacheId } = await processInStageE();
    await recordPlan(id);
    expect((await choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "O cache não resolveu." }] })).statusCode).toBe(201);

    expect((await elementOf(id, "first_step")).compatibility.status).toBe("outdated");
    const refused = await confirmStageE(id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "undecided_plan_compatibility" });

    expect((await assessPlan(id)).statusCode).toBe(201);
    expect(assessor.planInputs.slice(3).map((input) => [input.element.key, input.chosenOption.statement])).toEqual([
      ["first_step", runner],
      ["success_criteria", runner],
      ["plan_b", runner],
    ]);
    expect((await elementOf(id, "plan_b")).compatibility.status).toBe("compatible");
    expect((await confirmStageE(id)).statusCode).toBe(201);
  });
});

describe("Confirming Stage E", () => {
  it("is refused while an element is missing", async () => {
    const { id } = await processInStageE();
    await recordElement(id, "first_step", { text: firstStep });
    await recordElement(id, "plan_b", { text: planB });

    const response = await confirmStageE(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "execution_plan_incomplete" });
  });

  it("is refused while the chosen Option is no longer viable", async () => {
    const { id, constraintId } = await processInStageE();
    await recordPlan(id);
    assessor.willAssessOptions(optionOutcome((pair) => verdict(pair.option.statement === cache ? "yes" : "no", 0.95)));

    await api.reviseConstraint(id, constraintId, { kind: "constraint", statement: "Nenhum cache de terceiros no CI" });

    const response = await confirmStageE(id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "chosen_option_not_viable" });
  });

  it("leaves the Process ready for the final review, with the plan and the Choice no longer changing", async () => {
    const { id, runnerId, cacheId } = await processInStageE();
    await recordPlan(id);
    expect((await api.getProcess(id)).readyForFinalReview).toBe(false);

    const response = await confirmStageE(id);

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stage: "E", stageAssessmentId: null, withoutAssessment: true });
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("E");
    expect(process.readyForFinalReview).toBe(true);
    const rewrite = await recordElement(id, "plan_b", { text: "Outro plano B." });
    expect(rewrite.statusCode).toBe(409);
    expect(rewrite.json()).toEqual({ error: "execution_confirmed" });
    const rechoice = await choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "Mudei de ideia." }] });
    expect(rechoice.statusCode).toBe(409);
    expect(rechoice.json()).toEqual({ error: "execution_confirmed" });
    const again = await confirmStageE(id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "execution_confirmed" });
  });
});

describe("The understanding of the Process", () => {
  it("shows the execution plan with the compatibility of each element", async () => {
    const { id } = await processInStageE();
    assessor.willAssessPlan(planOutcome("yes"), planOutcome("no", 0.95));
    await recordElement(id, "first_step", { text: firstStep });
    await recordElement(id, "success_criteria", { text: successCriteria });

    const response = await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` });

    expect(response.json().understanding.executionPlan).toEqual([
      { key: "first_step", name: "Primeiro passo concreto", text: firstStep, compatibility: "compatible" },
      { key: "success_criteria", name: "Como reconhecer sucesso", text: successCriteria, compatibility: "awaiting_decision" },
      { key: "plan_b", name: "Plano B", text: null, compatibility: "not_recorded" },
    ]);
  });
});
