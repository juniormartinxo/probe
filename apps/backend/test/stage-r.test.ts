import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock, GeneratedSynthesis } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
import { FakeAssessor } from "./support/fake-assessor.ts";
import { processApi } from "./support/process-api.ts";
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

// Bloco da Etapa R: prazo (texto livre), sistemas (alternativa múltipla) e condições (texto livre).
const stageRBlock: GeneratedBlock = {
  questions: [
    {
      wording: "Até quando o deploy precisa ficar mais rápido?",
      subject: "Prazo",
      contextRelation: "A diretoria cobrou uma solução.",
      rationale: null,
      stagePoints: ["deadline"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
    {
      wording: "Quais sistemas participam do deploy?",
      subject: "Sistemas envolvidos",
      contextRelation: "O deploy leva 40 minutos.",
      rationale: null,
      stagePoints: ["systems_and_apis"],
      reformulates: null,
      answerType: "multiple_choice",
      choices: ["GitHub Actions", "Kubernetes", "Nenhum outro"],
    },
    {
      wording: "O que a solução não pode deixar de cumprir, e o que seria apenas bom ter?",
      subject: "Restrições e Preferências",
      contextRelation: "O time perde a manhã esperando.",
      rationale: "Restrições eliminam Opções; Preferências só pesam no Balanceamento.",
      stagePoints: ["constraints_vs_preferences"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

const stageRSynthesis: GeneratedSynthesis = {
  synthesis: "O deploy precisa cair para 10 minutos até o fim do trimestre, no GitHub Actions; custo é limite, fila é desejo.",
  coverage: [
    { stagePoint: "deadline", covered: true, reason: "Fim do trimestre." },
    { stagePoint: "systems_and_apis", covered: true, reason: "GitHub Actions." },
    { stagePoint: "constraints_vs_preferences", covered: true, reason: "Custo é limite; fila é desejo." },
  ],
  ambiguousAnswers: [],
};

describe("Blocks of Stage R", () => {
  it("are generated for the Points of R, with the statement and the confirmed answers of P as context", async () => {
    const { id, block: blockP } = await api.processInStageR();
    assistant.block.willRespond(completed(stageRBlock));

    const block = await api.generateBlock(id);

    expect(block.stage).toBe("R");
    const { input } = assistant.block.attempts.at(-1)!;
    expect(input.openStagePoints.map((point) => point.key)).toEqual(["deadline", "systems_and_apis", "constraints_vs_preferences"]);
    expect(input.askedQuestions).toEqual([]);
    expect(input.confirmedStages).toEqual([
      {
        stage: "P",
        answers: [
          { ref: "1.1", wording: blockP.questions[0].wording, answer: "A demora é o problema em si" },
          { ref: "1.2", wording: blockP.questions[1].wording, answer: "Atraso nas entregas" },
          { ref: "1.3", wording: blockP.questions[2].wording, answer: "A diretoria cobrou na última reunião." },
        ],
      },
    ]);
  });
});

describe("Constraints and Preferences", () => {
  const register = (id: string, kind: "constraints" | "preferences", payload: Record<string, unknown>) =>
    api.inject({ method: "POST", url: `/api/processes/${id}/${kind}`, payload });

  it("are recorded as distinct items of the Process, with scope and unit when they apply", async () => {
    const { id } = await api.processInStageR();

    const constraint = await register(id, "constraints", {
      statement: " O custo da infraestrutura não pode passar de 500 ",
      scope: "Ambiente de produção",
      unit: "reais por mês",
    });
    const preference = await register(id, "preferences", { statement: "Manter o GitHub Actions" });

    expect(constraint.statusCode).toBe(201);
    expect(constraint.json().constraint).toEqual({
      id: expect.any(String),
      statement: "O custo da infraestrutura não pode passar de 500",
      scope: "Ambiente de produção",
      unit: "reais por mês",
      registeredAt: expect.any(String),
      withdrawnAt: null,
    });
    expect(preference.statusCode).toBe(201);
    expect(preference.json().preference).toMatchObject({ statement: "Manter o GitHub Actions", scope: null, unit: null });
    const process = await api.getProcess(id);
    expect(process.constraints).toEqual([constraint.json().constraint]);
    expect(process.preferences).toEqual([preference.json().preference]);
  });

  it("need a statement", async () => {
    const { id } = await api.processInStageR();

    for (const payload of [{}, { statement: "  " }, { statement: "Prazo", scope: 3 }]) {
      const response = await register(id, "constraints", payload);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "statement_required" });
    }
    expect((await api.getProcess(id)).constraints).toEqual([]);
  });

  it("are recorded only while Stage R is the current one", async () => {
    const id = await api.createProcess();
    await api.confirmStatement(id);

    const response = await register(id, "preferences", { statement: "Manter o GitHub Actions" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_not_current" });
  });

  it("can be withdrawn, and stay in the history", async () => {
    const { id } = await api.processInStageR();
    const { constraint } = (await register(id, "constraints", { statement: "Sem downtime" })).json();

    const response = await api.inject({ method: "POST", url: `/api/processes/${id}/constraints/${constraint.id}/withdrawal` });
    const again = await api.inject({ method: "POST", url: `/api/processes/${id}/constraints/${constraint.id}/withdrawal` });
    const asPreference = await api.inject({ method: "POST", url: `/api/processes/${id}/preferences/${constraint.id}/withdrawal` });

    expect(response.statusCode).toBe(200);
    expect(response.json().constraint).toMatchObject({ id: constraint.id, withdrawnAt: expect.any(String) });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "already_withdrawn" });
    expect(asPreference.statusCode).toBe(404);
    expect(asPreference.json()).toEqual({ error: "preference_not_found" });
    expect((await api.getProcess(id)).constraints).toEqual([response.json().constraint]);
  });
});

describe("Explicit absence of a deadline or of integrations", () => {
  const recordAbsence = (id: string, key: string) =>
    api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/${key}/absence` });

  it("is recorded and counts as coverage of the Point", async () => {
    const { id } = await api.processInStageR();

    const response = await recordAbsence(id, "deadline");

    expect(response.statusCode).toBe(201);
    expect(response.json().stagePoint).toMatchObject({ key: "deadline", status: "absent", absence: "Não há prazo." });
    const process = await api.getProcess(id);
    expect(process.stagePoints.map((point: { key: string; status: string }) => [point.key, point.status])).toEqual([
      ["deadline", "absent"],
      ["systems_and_apis", "open"],
      ["constraints_vs_preferences", "open"],
    ]);
    expect(process.openStagePoints.map((point: { key: string }) => point.key)).toEqual(["systems_and_apis", "constraints_vs_preferences"]);
    assistant.block.willRespond(completed({ questions: stageRBlock.questions.slice(1) }));
    await api.generateBlock(id);
    expect(assistant.block.attempts.at(-1)!.input.openStagePoints.map((point) => point.key)).toEqual([
      "systems_and_apis",
      "constraints_vs_preferences",
    ]);
  });

  it("is also how no system or API involved is recorded", async () => {
    const { id } = await api.processInStageR();

    const response = await recordAbsence(id, "systems_and_apis");

    expect(response.statusCode).toBe(201);
    expect(response.json().stagePoint).toMatchObject({ status: "absent", absence: "Nenhum sistema ou API envolvido." });
  });

  it("is refused for a Point that has nothing to be absent", async () => {
    const { id } = await api.processInStageR();

    const response = await recordAbsence(id, "constraints_vs_preferences");

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "absence_not_allowed" });
  });

  it("is refused for a Point already closed", async () => {
    const { id } = await api.processInStageR();
    await api.declareInapplicable(id, "deadline", { justification: "Não se aplica." });

    const response = await recordAbsence(id, "deadline");

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_point_closed" });
  });
});

// Processo na Etapa R com o primeiro Bloco de R respondido.
async function stageRWithAnsweredBlock() {
  const { id, block: blockP } = await api.processInStageR();
  assistant.block.willRespond(completed(stageRBlock));
  const block = await api.generateBlock(id);
  const [deadline, systems, conditions] = block.questions;
  await api.answer(id, deadline.id, { text: "Até o fim do trimestre, em dias corridos.", basedOnVersionId: null });
  await api.answer(id, systems.id, { selectedChoices: [0], basedOnVersionId: null });
  await api.answer(id, conditions.id, { text: "Custo é limite; fila é desejo.", basedOnVersionId: null });
  return { id, blockP, block };
}

const registerConstraint = (id: string) =>
  api.inject({
    method: "POST",
    url: `/api/processes/${id}/constraints`,
    payload: { statement: "O custo não pode passar de 500", scope: "Produção", unit: "reais por mês" },
  });

const registerPreference = (id: string) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/preferences`, payload: { statement: "Deploys sem fila" } });

describe("Coverage of Constraints distinguished from Preferences", () => {
  it("needs a Constraint or a Preference registered", async () => {
    const { id, block } = await stageRWithAnsweredBlock();
    assistant.synthesis.willRespond(completed(stageRSynthesis));
    const proposal = await api.synthesize(id, block.id);

    const response = await api.confirmSynthesis(id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["deadline", "systems_and_apis", "constraints_vs_preferences"],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "constraints_not_registered" });
    expect((await api.blockOf(id, block.id)).synthesis).toBeNull();
  });

  it("is suggested by the AI from the answers and the registered Constraints and Preferences, and confirmed by the user", async () => {
    const { id, block } = await stageRWithAnsweredBlock();
    await registerConstraint(id);
    await registerPreference(id);
    assistant.synthesis.willRespond(completed(stageRSynthesis));

    const proposal = await api.synthesize(id, block.id);
    const response = await api.confirmSynthesis(id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["deadline", "systems_and_apis", "constraints_vs_preferences"],
    });

    const { input } = assistant.synthesis.attempts.at(-1)!;
    expect(input.stage).toBe("R");
    expect(input.confirmedStages.map((stage) => stage.stage)).toEqual(["P"]);
    expect(input.constraints).toEqual([{ statement: "O custo não pode passar de 500", scope: "Produção", unit: "reais por mês" }]);
    expect(input.preferences).toEqual([{ statement: "Deploys sem fila", scope: null, unit: null }]);
    expect(response.statusCode).toBe(201);
    expect((await api.getProcess(id)).openStagePoints).toEqual([]);
  });

  it("does not count a withdrawn item", async () => {
    const { id, block } = await stageRWithAnsweredBlock();
    const { constraint } = (await registerConstraint(id)).json();
    await api.inject({ method: "POST", url: `/api/processes/${id}/constraints/${constraint.id}/withdrawal` });
    assistant.synthesis.willRespond(completed(stageRSynthesis));
    const proposal = await api.synthesize(id, block.id);

    const response = await api.confirmSynthesis(id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["constraints_vs_preferences"],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "constraints_not_registered" });
  });
});

// Processo na Etapa R com o Bloco de R sintetizado, cobrindo os três Pontos, e uma Restrição e uma
// Preferência registradas.
async function stageRWithCoveredPoints() {
  const { id, blockP, block } = await stageRWithAnsweredBlock();
  await registerConstraint(id);
  await registerPreference(id);
  assistant.synthesis.willRespond(completed(stageRSynthesis));
  const proposal = await api.synthesize(id, block.id);
  const confirmed = await api.confirmSynthesis(id, block.id, {
    proposalId: proposal.id,
    synthesis: proposal.synthesis,
    coveredStagePoints: ["deadline", "systems_and_apis", "constraints_vs_preferences"],
  });
  expect(confirmed.statusCode).toBe(201);
  return { id, blockP, block };
}

describe("Jev Assessment and Confirmation of Stage R", () => {
  it("judges the covered Points of R from the answers of R and the registered Constraints and Preferences", async () => {
    const { id, block } = await stageRWithCoveredPoints();

    const stageAssessment = await api.assess(id, "R");

    expect(assessor.inputs.at(-1)).toEqual({
      stage: "R",
      problemStatement: expect.any(String),
      stagePoints: [
        expect.objectContaining({ key: "deadline" }),
        expect.objectContaining({ key: "systems_and_apis" }),
        expect.objectContaining({ key: "constraints_vs_preferences" }),
      ],
      answers: [
        { ref: "2.1", wording: block.questions[0].wording, answer: "Até o fim do trimestre, em dias corridos." },
        { ref: "2.2", wording: block.questions[1].wording, answer: "GitHub Actions" },
        { ref: "2.3", wording: block.questions[2].wording, answer: "Custo é limite; fila é desejo." },
      ],
      constraints: [{ statement: "O custo não pode passar de 500", scope: "Produção", unit: "reais por mês" }],
      preferences: [{ statement: "Deploys sem fila", scope: null, unit: null }],
    });
    expect(stageAssessment).toMatchObject({ stage: "R", status: "completed", outdated: false });
    expect(stageAssessment.assessments.map((item: { stagePoint: { key: string } }) => item.stagePoint.key)).toEqual([
      "deadline",
      "systems_and_apis",
      "constraints_vs_preferences",
    ]);
  });

  it("does not judge a Point whose absence the user recorded", async () => {
    const { id } = await api.processInStageR();
    await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/deadline/absence` });
    await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/systems_and_apis/absence` });
    await registerConstraint(id);
    assistant.block.willRespond(completed({ questions: stageRBlock.questions.slice(2) }));
    const block = await api.generateBlock(id);
    await api.answer(id, block.questions[0].id, { text: "Custo é limite.", basedOnVersionId: null });
    assistant.synthesis.willRespond(
      completed({ ...stageRSynthesis, coverage: stageRSynthesis.coverage.filter((item) => item.stagePoint === "constraints_vs_preferences") }),
    );
    const proposal = await api.synthesize(id, block.id);
    await api.confirmSynthesis(id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["constraints_vs_preferences"],
    });

    const stageAssessment = await api.assess(id, "R");

    expect(assessor.inputs.at(-1)!.stagePoints.map((point) => point.key)).toEqual(["constraints_vs_preferences"]);
    expect(stageAssessment.assessments).toHaveLength(1);
  });

  it("is outdated when a Constraint or Preference changes after it", async () => {
    const { id } = await stageRWithCoveredPoints();
    const stageAssessment = await api.assess(id, "R");

    await registerPreference(id);

    const process = await api.getProcess(id);
    expect(process.stageAssessments.at(-1)).toMatchObject({ id: stageAssessment.id, outdated: true });
    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id }, "R");
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "assessment_outdated" });
  });

  it("confirms Stage R and opens Stage O", async () => {
    const { id } = await stageRWithCoveredPoints();
    const stageAssessment = await api.assess(id, "R");

    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id }, "R");

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stage: "R", stageAssessmentId: stageAssessment.id, withoutAssessment: false });
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("O");
    expect(process.stageConfirmations.map((item: { stage: string }) => item.stage)).toEqual(["P", "R"]);
    expect(process.openStagePoints.map((point: { key: string }) => point.key)).toEqual([
      "eliminate_problem",
      "simplest_solution",
      "eighty_twenty",
      "reversibility",
    ]);
  });

  it("confirms Stage R without an Assessment when no Point was covered by a Block", async () => {
    const { id } = await api.processInStageR();
    await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/deadline/absence` });
    await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/systems_and_apis/absence` });
    await api.declareInapplicable(id, "constraints_vs_preferences", { justification: "Nada é obrigatório nem desejado." }, );

    const response = await api.confirmStage(id, { stageAssessmentId: null }, "R");

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stage: "R", withoutAssessment: true });
    expect((await api.getProcess(id)).currentStage).toBe("O");
  });
});

describe("Going back to Stage P while in Stage R", () => {
  it("lets the user change an answer of P, with a new Version, and stays in R", async () => {
    const { id, block: blockP } = await api.processInStageR();
    const [single] = (await api.blockOf(id, blockP.id)).questions;
    const confirmed = single.answer.current;

    const response = await api.answer(id, single.id, { selectedChoices: [1], basedOnVersionId: confirmed.id });

    expect(response.statusCode).toBe(201);
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("R");
    const changed = process.blocks.find((block: { id: string }) => block.id === blockP.id).questions[0];
    expect(changed.answer.current).toMatchObject({ id: response.json().answerVersion.id, confirmed: false });
    expect(changed.answer.previous).toEqual([confirmed]);
    // A IA continua recebendo de P o que foi confirmado; a mudança ainda não foi.
    assistant.block.willRespond(completed(stageRBlock));
    await api.generateBlock(id);
    expect(assistant.block.attempts.at(-1)!.input.confirmedStages[0]!.answers[0]).toMatchObject({
      ref: "1.1",
      answer: "A demora é o problema em si",
    });
  });

  it("refuses a change based on a superseded Version", async () => {
    const { id, block: blockP } = await api.processInStageR();
    const [single] = (await api.blockOf(id, blockP.id)).questions;
    const confirmed = single.answer.current;
    await api.answer(id, single.id, { selectedChoices: [1], basedOnVersionId: confirmed.id });

    const response = await api.answer(id, single.id, { selectedChoices: [2], basedOnVersionId: confirmed.id });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "superseded_version" });
  });
});

describe("Understanding in Stage R", () => {
  it("shows the Constraints and Preferences in force and the Points whose absence was recorded", async () => {
    const { id } = await api.processInStageR();
    await registerConstraint(id);
    const { preference } = (await registerPreference(id)).json();
    await api.inject({ method: "POST", url: `/api/processes/${id}/preferences/${preference.id}/withdrawal` });
    await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/deadline/absence` });

    const response = await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` });

    const { understanding } = response.json();
    expect(understanding.currentStage).toBe("R");
    expect(understanding.stagePoints[0]).toMatchObject({ key: "deadline", status: "absent", absence: "Não há prazo." });
    expect(understanding.constraints).toEqual([{ statement: "O custo não pode passar de 500", scope: "Produção", unit: "reais por mês" }]);
    expect(understanding.preferences).toEqual([]);
  });
});
