import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedOptions } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
import { FakeAssessor, optionOutcome, verdict } from "./support/fake-assessor.ts";
import { processApi } from "./support/process-api.ts";
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

const costConstraint = "O custo da infraestrutura não pode passar de 500 reais por mês";

const proposedOptions: GeneratedOptions = {
  options: [
    {
      statement: "Deixar de rodar o deploy completo a cada commit",
      description: "Só os serviços alterados entram no deploy.",
      stagePoints: ["eliminate_problem"],
    },
    { statement: "Cachear as dependências no GitHub Actions", description: null, stagePoints: ["eighty_twenty"] },
  ],
};

// Processo na Etapa O: a Etapa R foi confirmada com a Restrição de custo e uma Preferência, sem Bloco.
async function processInStageO() {
  const { id } = await api.processInStageR();
  const constraint = await api.inject({ method: "POST", url: `/api/processes/${id}/constraints`, payload: { statement: costConstraint } });
  expect(constraint.statusCode).toBe(201);
  const preference = await api.inject({ method: "POST", url: `/api/processes/${id}/preferences`, payload: { statement: "Manter o GitHub Actions" } });
  expect(preference.statusCode).toBe(201);
  for (const key of ["deadline", "systems_and_apis"]) {
    expect((await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/${key}/absence` })).statusCode).toBe(201);
  }
  expect((await api.declareInapplicable(id, "constraints_vs_preferences", { justification: "Já registradas." })).statusCode).toBe(201);
  expect((await api.confirmStage(id, { stageAssessmentId: null }, "R")).statusCode).toBe(201);
  return { id, constraintId: constraint.json().constraint.id as string };
}

const requestProposal = (id: string) => api.inject({ method: "POST", url: `/api/processes/${id}/option-proposals` });

// Pede Opções à IA e espera a tentativa terminar.
async function proposeOptions(id: string) {
  const response = await requestProposal(id);
  expect(response.statusCode).toBe(202);
  let process: Awaited<ReturnType<typeof api.getProcess>>;
  await waitFor(async () => {
    process = await api.getProcess(id);
    return process.optionProposals.at(-1).status !== "running";
  });
  return process!;
}

describe("Options proposed by the AI", () => {
  it("arrive as suggestions, from the problem, the confirmed Stages and the Constraints in force", async () => {
    const { id } = await processInStageO();
    assistant.options.willRespond(completed(proposedOptions));

    const process = await proposeOptions(id);

    expect(process.optionProposals).toHaveLength(1);
    expect(process.optionProposals[0]).toMatchObject({ status: "completed" });
    expect(process.options).toEqual([
      {
        id: expect.any(String),
        statement: "Deixar de rodar o deploy completo a cada commit",
        description: "Só os serviços alterados entram no deploy.",
        stagePoints: [{ key: "eliminate_problem", name: "Possibilidade de eliminar o problema" }],
        origin: "ai",
        suggestion: { statement: "Deixar de rodar o deploy completo a cada commit", description: "Só os serviços alterados entram no deploy." },
        status: "suggested",
        createdAt: expect.any(String),
        acceptedAt: null,
        discardedAt: null,
        viability: null,
        violations: [],
      },
      expect.objectContaining({ statement: "Cachear as dependências no GitHub Actions", origin: "ai", status: "suggested" }),
    ]);
    const { input } = assistant.options.attempts.at(-1)!;
    expect(input.problemStatement).toBe("O deploy leva 40 minutos e bloqueia o time durante a manhã.");
    expect(input.constraints).toEqual([{ statement: costConstraint, scope: null, unit: null }]);
    expect(input.preferences).toEqual([{ statement: "Manter o GitHub Actions", scope: null, unit: null }]);
    expect(input.confirmedStages.map((stage) => stage.stage)).toEqual(["P", "R"]);
    expect(input.stagePoints.map((point) => point.key)).toEqual(["eliminate_problem", "simplest_solution", "eighty_twenty", "reversibility"]);
    expect(input.options).toEqual([]);
  });
});

const addOption = (id: string, payload: Record<string, unknown>) => api.inject({ method: "POST", url: `/api/processes/${id}/options`, payload });

const acceptOption = (id: string, optionId: string, payload?: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/options/${optionId}/acceptance`, ...(payload && { payload }) });

const discardOption = (id: string, optionId: string) => api.inject({ method: "POST", url: `/api/processes/${id}/options/${optionId}/discard` });

describe("The user, on the suggested Options", () => {
  it("accepts one as it came", async () => {
    const { id } = await processInStageO();
    const { options } = await proposeOptions(id);

    const response = await acceptOption(id, options[0].id);

    expect(response.statusCode).toBe(200);
    expect(response.json().option).toMatchObject({
      id: options[0].id,
      statement: options[0].statement,
      status: "accepted",
      acceptedAt: expect.any(String),
    });
  });

  it("accepts one edited, keeping the suggestion as the AI made it", async () => {
    const { id } = await processInStageO();
    const { options } = await proposeOptions(id);

    const response = await acceptOption(id, options[1].id, {
      statement: " Rodar o deploy à mão às 7h ",
      description: "Antes de o time chegar.",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().option).toMatchObject({
      statement: "Rodar o deploy à mão às 7h",
      description: "Antes de o time chegar.",
      suggestion: { statement: "Rodar o deploy à mão, fora do horário do time", description: null },
      status: "accepted",
    });
  });

  it("discards one, which stays in the history", async () => {
    const { id } = await processInStageO();
    const { options } = await proposeOptions(id);

    const response = await discardOption(id, options[0].id);

    expect(response.statusCode).toBe(200);
    expect(response.json().option).toMatchObject({ id: options[0].id, status: "discarded", discardedAt: expect.any(String) });
    expect((await api.getProcess(id)).options.map((option: { status: string }) => option.status)).toEqual(["discarded", "suggested"]);
  });

  it("cannot accept an Option twice nor discard it twice", async () => {
    const { id } = await processInStageO();
    const { options } = await proposeOptions(id);
    await acceptOption(id, options[0].id);
    await discardOption(id, options[1].id);

    const again = await acceptOption(id, options[0].id);
    const discarded = await acceptOption(id, options[1].id);
    const twice = await discardOption(id, options[1].id);

    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "option_not_suggested" });
    expect(discarded.json()).toEqual({ error: "option_not_suggested" });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toEqual({ error: "option_discarded" });
  });

  it("asks for new Options, and the AI receives the ones already recorded so as not to repeat them", async () => {
    const { id } = await processInStageO();
    const { options } = await proposeOptions(id);
    await acceptOption(id, options[0].id);
    await discardOption(id, options[1].id);
    assistant.options.willRespond(completed({ options: [] }));

    const process = await proposeOptions(id);

    expect(process.optionProposals).toHaveLength(2);
    expect(process.optionProposals[1]).toMatchObject({ status: "completed", optionIds: [] });
    expect(assistant.options.attempts.at(-1)!.input.options).toEqual([
      { statement: options[0].statement, description: null, status: "accepted", violatedConstraints: [] },
      { statement: options[1].statement, description: null, status: "discarded", violatedConstraints: [] },
    ]);
  });
});

describe("Options of the user", () => {
  it("are added already accepted", async () => {
    const { id } = await processInStageO();

    const response = await addOption(id, {
      statement: " Trocar o runner por um maior ",
      description: "Máquina com o dobro de CPU.",
      stagePoints: ["simplest_solution"],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().option).toMatchObject({
      statement: "Trocar o runner por um maior",
      description: "Máquina com o dobro de CPU.",
      stagePoints: [{ key: "simplest_solution", name: "Solução mais simples (inclusive manual)" }],
      origin: "user",
      suggestion: null,
      status: "accepted",
    });
  });

  it("need a statement and Points of Stage O only", async () => {
    const { id } = await processInStageO();

    for (const payload of [{}, { statement: "  " }, { statement: "Algo", description: 3 }, { statement: "Algo", stagePoints: "deadline" }]) {
      const response = await addOption(id, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "statement_required" });
    }
    const outside = await addOption(id, { statement: "Algo", stagePoints: ["deadline"] });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toEqual({ error: "invalid_stage_points" });
    expect((await api.getProcess(id)).options).toEqual([]);
  });

  it("are recorded only while Stage O is the current one", async () => {
    const { id } = await api.processInStageR();

    const added = await addOption(id, { statement: "Trocar o runner por um maior" });
    const proposal = await requestProposal(id);

    expect(added.statusCode).toBe(409);
    expect(added.json()).toEqual({ error: "stage_not_current" });
    expect(proposal.statusCode).toBe(409);
    expect(proposal.json()).toEqual({ error: "stage_not_current" });
  });
});

const revise = (id: string, constraintId: string, replacement: Record<string, unknown> | null) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/constraints/${constraintId}/revision`, payload: { replacement, note: "Mudou." } });

const retryOptionAssessment = (id: string, checkId: string) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/option-checks/${checkId}/option-assessments` });

const decideOptions = (id: string, checkId: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/option-checks/${checkId}/decision`, payload });

async function optionOf(id: string, optionId: string) {
  return (await api.getProcess(id)).options.find((option: { id: string }) => option.id === optionId);
}

// Processo na Etapa O com uma Opção do usuário aceita.
async function processWithOption() {
  const { id, constraintId } = await processInStageO();
  const added = await addOption(id, { statement: "Trocar o runner por um maior", description: "Máquina com o dobro de CPU." });
  expect(added.statusCode).toBe(201);
  return { id, constraintId, optionId: added.json().option.id as string };
}

describe("The Jev, on each accepted Option against each Constraint in force", () => {
  it("is asked once per pair, with the problem statement, when the Option is accepted", async () => {
    const { id, optionId, constraintId } = await processWithOption();

    expect(assessor.optionInputs).toEqual([
      {
        problemStatement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
        pairs: [
          {
            key: "par_0",
            option: { ref: "O1", statement: "Trocar o runner por um maior", description: "Máquina com o dobro de CPU." },
            constraint: { ref: "R1", statement: costConstraint, scope: null, unit: null },
          },
        ],
      },
    ]);
    const process = await api.getProcess(id);
    expect(process.optionChecks).toHaveLength(1);
    expect(process.optionChecks[0]).toMatchObject({
      status: "decided",
      pairs: [
        {
          option: { id: optionId, statement: "Trocar o runner por um maior" },
          constraint: { id: constraintId, statement: costConstraint },
          status: "complies",
          decidedBy: "jev",
          verdict: { choice: "no", confidence: 0.9, needsDecision: false },
        },
      ],
      assessments: [{ status: "completed", jevModel: "jev-de-teste", requestedModel: "jev-de-teste" }],
    });
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "viable", violations: [] });
  });

  it("marks the Option inviable on a confident violation, whatever else it offers", async () => {
    const { id, constraintId } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));

    const added = await addOption(id, { statement: "Contratar uma plataforma de CI de 2.000 reais por mês" });

    expect(added.json().option).toMatchObject({
      viability: "inviable",
      violations: [{ constraintId, statement: costConstraint, decidedBy: "jev" }],
    });
    const process = await api.getProcess(id);
    expect(process.optionChecks[0].pairs[0]).toMatchObject({ status: "violates", decidedBy: "jev" });
  });

  it("is not asked about suggestions nor without Constraints in force", async () => {
    const { id } = await api.processInStageR();
    for (const key of ["deadline", "systems_and_apis"]) {
      await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/${key}/absence` });
    }
    await api.declareInapplicable(id, "constraints_vs_preferences", { justification: "Nada a registrar." });
    await api.confirmStage(id, { stageAssessmentId: null }, "R");
    await proposeOptions(id);

    const added = await addOption(id, { statement: "Trocar o runner por um maior" });

    expect(assessor.optionInputs).toEqual([]);
    expect(added.json().option).toMatchObject({ viability: "viable", violations: [] });
    expect((await api.getProcess(id)).options.map((option: { viability: string | null }) => option.viability)).toEqual([null, null, "viable"]);
  });

  it("leaves an uncertain pair to the user, who decides on the Assessment they saw", async () => {
    const { id } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.6)));
    const { optionId } = { optionId: (await addOption(id, { statement: "Usar runners spot" })).json().option.id as string };
    const [check] = (await api.getProcess(id)).optionChecks;
    expect(check).toMatchObject({ status: "awaiting_decision", pairs: [{ status: "awaiting_decision", verdict: { needsDecision: true } }] });
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "undecided" });

    const response = await decideOptions(id, check.id, {
      optionAssessmentId: check.assessments[0].id,
      pairIds: [check.pairs[0].id],
      decision: "violates",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().optionCheck).toMatchObject({ status: "decided", pairs: [{ status: "violates", decidedBy: "user" }] });
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "inviable", violations: [{ decidedBy: "user" }] });
    const again = await decideOptions(id, check.id, { optionAssessmentId: check.assessments[0].id, pairIds: [check.pairs[0].id], decision: "complies" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "option_pair_decided" });
  });

  it("lets the user retry when the Jev fails, or decide without it", async () => {
    const { id, optionId } = await (async () => {
      const stageO = await processInStageO();
      assessor.willAssessOptions({ status: "failed", reason: "jev_unavailable", message: "O Jev não respondeu em 60 s." });
      const added = await addOption(stageO.id, { statement: "Usar runners spot" });
      return { id: stageO.id, optionId: added.json().option.id as string };
    })();
    const [check] = (await api.getProcess(id)).optionChecks;
    expect(check).toMatchObject({ status: "assessment_failed", pairs: [{ status: "assessment_failed" }] });
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "undecided" });

    const stale = await decideOptions(id, check.id, { optionAssessmentId: "00000000-0000-4000-8000-000000000000", pairIds: [check.pairs[0].id], decision: "complies" });
    expect(stale.statusCode).toBe(422);
    expect(stale.json()).toEqual({ error: "unknown_assessment" });

    const retried = await retryOptionAssessment(id, check.id);

    expect(retried.statusCode).toBe(201);
    expect(retried.json().optionCheck).toMatchObject({ status: "decided", pairs: [{ status: "complies" }] });
    expect(retried.json().optionCheck.assessments.map((item: { status: string }) => item.status)).toEqual(["failed", "completed"]);
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "viable" });
    const assessed = await retryOptionAssessment(id, check.id);
    expect(assessed.statusCode).toBe(409);
    expect(assessed.json()).toEqual({ error: "option_check_assessed" });
  });

  it("has a failed pair decided by the user without an Assessment", async () => {
    const { id } = await processInStageO();
    assessor.willAssessOptions({ status: "failed", reason: "jev_unavailable", message: "O Jev não respondeu em 60 s." });
    const optionId = (await addOption(id, { statement: "Usar runners spot" })).json().option.id;
    const [check] = (await api.getProcess(id)).optionChecks;

    const response = await decideOptions(id, check.id, { optionAssessmentId: check.assessments[0].id, pairIds: [check.pairs[0].id], decision: "complies" });

    expect(response.statusCode).toBe(201);
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "viable" });
  });

  it("has the missing pairs formed and assessed on request, when their check was lost", async () => {
    const { id, optionId } = await processWithOption();
    // Uma verificação perdida (o banco falhou ao formá-la): o par não existe, e a Opção fica sem decisão.
    await testApp.db.deleteFrom("optionChecks").execute();
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "undecided" });

    const response = await api.inject({ method: "POST", url: `/api/processes/${id}/option-checks` });

    expect(response.statusCode).toBe(201);
    expect(response.json().optionChecks).toHaveLength(1);
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "viable" });
  });

  it("assesses the accepted Options against the Constraint that replaces a revised one, and forgets the withdrawn one", async () => {
    const { id, constraintId } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));
    const optionId = (await addOption(id, { statement: "Contratar uma plataforma de CI de 2.000 reais por mês" })).json().option.id;
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "inviable" });

    const revised = await revise(id, constraintId, { kind: "constraint", statement: "O custo não pode passar de 3.000 reais por mês" });

    expect(revised.statusCode).toBe(201);
    expect(assessor.optionInputs).toHaveLength(2);
    expect(assessor.optionInputs[1]!.pairs).toEqual([
      expect.objectContaining({ constraint: { ref: "R2", statement: "O custo não pode passar de 3.000 reais por mês", scope: null, unit: null } }),
    ]);
    const process = await api.getProcess(id);
    expect(process.optionChecks.map((check: { pairs: { status: string }[] }) => check.pairs[0]!.status)).toEqual(["superseded", "complies"]);
    expect(await optionOf(id, optionId)).toMatchObject({ viability: "viable", violations: [] });
  });

  it("tells the AI which Constraints each accepted Option violates", async () => {
    const { id } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));
    await addOption(id, { statement: "Contratar uma plataforma de CI de 2.000 reais por mês" });

    await proposeOptions(id);

    expect(assistant.options.attempts.at(-1)!.input.options).toEqual([
      { statement: "Contratar uma plataforma de CI de 2.000 reais por mês", description: null, status: "accepted", violatedConstraints: [costConstraint] },
    ]);
  });
});

// Fecha os Pontos da Etapa O, inaplicáveis, e pede a Confirmação dela (sem Ponto coberto a avaliar).
async function confirmStageO(id: string) {
  for (const key of ["eliminate_problem", "simplest_solution", "eighty_twenty", "reversibility"]) {
    const point = (await api.getProcess(id)).stagePoints.find((item: { key: string }) => item.key === key);
    if (point.status === "open") await api.declareInapplicable(id, key, { justification: "Fora deste exemplo." });
  }
  return api.confirmStage(id, { stageAssessmentId: null }, "O");
}

describe("Confirming Stage O", () => {
  it("opens Stage B with a viable Option", async () => {
    const { id } = await processWithOption();

    const response = await confirmStageO(id);

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stage: "O", withoutAssessment: true });
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("B");
    expect(process.openStagePoints.map((point: { key: string }) => point.key)).toEqual([
      "gains_and_losses",
      "scalability",
      "maintenance",
      "chosen_option_and_discards",
    ]);
  });

  it("is refused without any accepted Option", async () => {
    const { id } = await processInStageO();

    const response = await confirmStageO(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "no_viable_option", impediments: [] });
    expect((await api.getProcess(id)).currentStage).toBe("O");
  });

  it("explains the impediments when no Option meets the Constraints, and keeps the Process open", async () => {
    const { id, constraintId } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));
    const optionId = (await addOption(id, { statement: "Contratar uma plataforma de CI de 2.000 reais por mês" })).json().option.id;
    const discarded = (await addOption(id, { statement: "Desistir do deploy" })).json().option.id;
    await discardOption(id, discarded);

    const response = await confirmStageO(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "no_viable_option",
      impediments: [
        {
          option: { id: optionId, statement: "Contratar uma plataforma de CI de 2.000 reais por mês" },
          violations: [{ constraintId, statement: costConstraint, decidedBy: "jev" }],
        },
      ],
    });
    const process = await api.getProcess(id);
    expect(process).toMatchObject({ status: "open", currentStage: "O" });
    // Os caminhos seguem abertos: pedir novas Opções à IA ou rever a Restrição.
    expect((await requestProposal(id)).statusCode).toBe(202);
  });

  it("is accepted after a Constraint revision makes an Option viable", async () => {
    const { id, constraintId } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));
    await addOption(id, { statement: "Contratar uma plataforma de CI de 2.000 reais por mês" });
    expect((await confirmStageO(id)).statusCode).toBe(409);

    await revise(id, constraintId, { kind: "preference", statement: "Gastar pouco com infraestrutura" });

    const response = await confirmStageO(id);
    expect(response.statusCode).toBe(201);
    expect((await api.getProcess(id)).currentStage).toBe("B");
  });

  it("waits for the user on each suggestion of the AI", async () => {
    const { id } = await processWithOption();
    await proposeOptions(id);

    const response = await confirmStageO(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "pending_option_suggestions" });
  });

  it("waits while the AI is still proposing Options", async () => {
    const { id } = await processWithOption();
    assistant.options.willHold();
    expect((await requestProposal(id)).statusCode).toBe(202);

    const response = await confirmStageO(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "pending_option_suggestions" });
    assistant.options.attempts.at(-1)!.respond(completed({ options: [] }));
  });

  it("waits for each pair still without decision, even with another Option viable", async () => {
    const { id } = await processWithOption();
    assessor.willAssessOptions(optionOutcome(() => verdict("insufficient", 0.5)));
    await addOption(id, { statement: "Usar runners spot" });

    const response = await confirmStageO(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "undecided_options" });
  });
});

describe("Blocks of Stage O", () => {
  it("are generated for the Points of O, with the accepted Options as context", async () => {
    const { id } = await processInStageO();
    assessor.willAssessOptions(optionOutcome(() => verdict("yes", 0.95)));
    await addOption(id, { statement: "Contratar uma plataforma de CI de 2.000 reais por mês" });
    const discarded = (await addOption(id, { statement: "Desistir do deploy" })).json().option.id;
    await discardOption(id, discarded);
    assistant.block.willRespond(
      completed({
        questions: [
          {
            wording: "Dá para o deploy deixar de bloquear o time?",
            subject: "Eliminar o problema",
            contextRelation: "O time espera o deploy.",
            rationale: null,
            stagePoints: ["eliminate_problem"],
            reformulates: null,
            answerType: "free_text",
            choices: [],
          },
        ],
      }),
    );

    const block = await api.generateBlock(id);

    expect(block.stage).toBe("O");
    const { input } = assistant.block.attempts.at(-1)!;
    expect(input.options).toEqual([
      { statement: "Contratar uma plataforma de CI de 2.000 reais por mês", description: null, status: "accepted", violatedConstraints: [costConstraint] },
    ]);
  });
});

describe("The understanding of the Process", () => {
  it("shows the accepted Options with their viability", async () => {
    const { id } = await processWithOption();
    await proposeOptions(id);

    const response = await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` });

    expect(response.json().understanding.options).toEqual([
      { statement: "Trocar o runner por um maior", viability: "viable", violations: [] },
    ]);
  });
});
