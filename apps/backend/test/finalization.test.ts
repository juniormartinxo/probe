import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
import { FakeAssessor, impactOutcome } from "./support/fake-assessor.ts";
import {
  cache,
  costConstraint,
  description,
  firstStep,
  planB,
  processApi,
  runner,
  statement,
  successCriteria,
} from "./support/process-api.ts";
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

const finalReview = (id: string) => api.inject({ method: "GET", url: `/api/processes/${id}/final-review` });

const finalize = (id: string, payload?: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/finalization`, ...(payload && { payload }) });

const finalization = (id: string) => api.inject({ method: "GET", url: `/api/processes/${id}/finalization` });

// Processo com a Etapa E confirmada: pronto para a Revisão final.
async function processReadyForFinalReview() {
  const ids = await api.processInStageE();
  await api.recordPlan(ids.id);
  expect((await api.confirmStage(ids.id, { stageAssessmentId: null }, "E")).statusCode).toBe(201);
  return ids;
}

// A Revisão final como o usuário a vê.
async function reviewed(id: string) {
  const response = await finalReview(id);
  expect(response.statusCode).toBe(200);
  return response.json().finalReview;
}

// Uma Pergunta respondida da Etapa P, com a Versão que vale.
async function firstQuestionOfP(id: string) {
  const question = (await api.getProcess(id)).blocks[0].questions[0];
  return { questionId: question.id as string, versionId: question.answer.current.id as string };
}

describe("The final review", () => {
  it("waits for Stage E to be confirmed", async () => {
    const { id } = await api.processInStageE();
    await api.recordPlan(id);

    const response = await finalReview(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "execution_not_confirmed" });
  });

  it("presents the problem, the Constraints, the Preferences, the Choice, its trade-offs and the plan", async () => {
    const { id } = await processReadyForFinalReview();

    const { report, blockers, fingerprint } = await reviewed(id);

    expect(blockers).toEqual([]);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(report.problem).toEqual({ originalDescription: description, statement, statementOrigin: "written" });
    expect(report.constraints).toEqual([{ statement: costConstraint, scope: null, unit: null }]);
    expect(report.preferences).toEqual([{ statement: "Manter o GitHub Actions", scope: null, unit: null }]);
    expect(report.choice).toEqual({ option: cache, description: "Cache do pnpm por hash do lockfile.", comparison: null });
    expect(report.discardedOptions).toEqual([{ option: runner, by: "choice", reason: "Mais caro." }]);
    expect(report.executionPlan).toEqual([
      { key: "first_step", name: "Primeiro passo concreto", text: firstStep, compatibility: "compatible", justification: null },
      { key: "success_criteria", name: "Como reconhecer sucesso", text: successCriteria, compatibility: "compatible", justification: null },
      { key: "plan_b", name: "Plano B", text: planB, compatibility: "compatible", justification: null },
    ]);
  });

  it("shows what still prevents the Finalization", async () => {
    const { id } = await processReadyForFinalReview();
    const { questionId, versionId } = await firstQuestionOfP(id);
    assessor.willAssessImpact(impactOutcome("yes"));
    expect((await api.answer(id, questionId, { selectedChoices: [1], basedOnVersionId: versionId })).statusCode).toBe(201);
    const pendencyIds = (await api.getProcess(id)).pendencies.map((pendency: { id: string }) => pendency.id);
    expect(pendencyIds).toHaveLength(1);

    const { blockers } = await reviewed(id);

    expect(blockers).toEqual([{ reason: "blocking_pendencies", pendencyIds }]);
  });
});

describe("The Finalization", () => {
  it("freezes the Decision and the report the final review presented", async () => {
    const { id } = await processReadyForFinalReview();
    const review = await reviewed(id);

    const response = await finalize(id, { fingerprint: review.fingerprint });

    expect(response.statusCode).toBe(201);
    const frozen = response.json().finalization;
    expect(frozen.report).toEqual(review.report);
    expect(new Date(frozen.finalizedAt).getTime()).not.toBeNaN();
    const process = await api.getProcess(id);
    expect(process.status).toBe("finalized");
    expect(process.finalizedAt).toBe(frozen.finalizedAt);
    const stored = await finalization(id);
    expect(stored.statusCode).toBe(200);
    expect(stored.json().finalization).toEqual(frozen);
  });

  it("needs an explicit confirmation of the final review the user saw", async () => {
    const { id } = await processReadyForFinalReview();

    const response = await finalize(id);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "fingerprint_required" });
    expect((await api.getProcess(id)).status).toBe("open");
  });

  it("is refused before Stage E is confirmed", async () => {
    const { id } = await api.processInStageE();

    const response = await finalize(id, { fingerprint: "0".repeat(64) });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "execution_not_confirmed" });
  });

  it("is refused while a Pendency compromises the Decision", async () => {
    const { id } = await processReadyForFinalReview();
    const { questionId, versionId } = await firstQuestionOfP(id);
    assessor.willAssessImpact(impactOutcome("yes"));
    expect((await api.answer(id, questionId, { selectedChoices: [1], basedOnVersionId: versionId })).statusCode).toBe(201);
    const review = await reviewed(id);

    const response = await finalize(id, { fingerprint: review.fingerprint });

    expect(response.statusCode).toBe(409);
    const pendencyIds = (await api.getProcess(id)).pendencies.map((pendency: { id: string }) => pendency.id);
    expect(response.json()).toEqual({ error: "blocking_pendencies", pendencyIds });
    expect((await api.getProcess(id)).status).toBe("open");
  });

  it("is refused when something changed between the final review and the confirmation", async () => {
    const { id } = await processReadyForFinalReview();
    const review = await reviewed(id);
    // Em outra aba, uma Versão nova de uma resposta (sem impacto, segundo o Jev).
    const { questionId, versionId } = await firstQuestionOfP(id);
    expect((await api.answer(id, questionId, { selectedChoices: [1], basedOnVersionId: versionId })).statusCode).toBe(201);

    const response = await finalize(id, { fingerprint: review.fingerprint });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "final_review_outdated" });
    expect((await api.getProcess(id)).status).toBe("open");
    const again = await reviewed(id);
    expect(again.fingerprint).not.toBe(review.fingerprint);
    expect((await finalize(id, { fingerprint: again.fingerprint })).statusCode).toBe(201);
  });

  it("waits for the plan to be compatible again with a Choice changed in the final review", async () => {
    const { id, runnerId, cacheId } = await processReadyForFinalReview();
    expect((await api.choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "O cache não resolve." }] })).statusCode).toBe(201);

    const review = await reviewed(id);
    expect(review.blockers).toEqual([{ reason: "undecided_plan_compatibility" }]);
    expect((await finalize(id, { fingerprint: review.fingerprint })).json()).toEqual({ error: "undecided_plan_compatibility" });

    expect((await api.inject({ method: "POST", url: `/api/processes/${id}/execution-plan/assessments` })).statusCode).toBe(201);
    const ready = await reviewed(id);
    expect(ready.blockers).toEqual([]);
    expect(ready.report.choice.option).toBe(runner);
    expect((await finalize(id, { fingerprint: ready.fingerprint })).statusCode).toBe(201);
  });

  it("waits for a request to the AI still running", async () => {
    const { id } = await api.processInStageE();
    assistant.block.willRespond(completed(executionBlock));
    const block = await api.generateBlock(id);
    for (const question of block.questions) {
      expect((await api.answer(id, question.id, { text: "A Ana, nesta sexta.", basedOnVersionId: null })).statusCode).toBe(201);
    }
    await api.recordPlan(id);
    expect((await api.confirmStage(id, { stageAssessmentId: null }, "E")).statusCode).toBe(201);
    assistant.synthesis.willHold();
    expect((await api.requestSynthesis(id, block.id)).statusCode).toBe(202);

    const review = await reviewed(id);
    expect(review.blockers).toEqual([{ reason: "ai_request_in_progress" }]);
    expect((await finalize(id, { fingerprint: review.fingerprint })).json()).toEqual({ error: "ai_request_in_progress" });

    assistant.synthesis.attempts.at(-1)!.respond(completed({ synthesis: "A Ana ativa o cache.", coverage: [], ambiguousAnswers: [] }));
    await api.settledSynthesis(id, block.id);
    expect((await finalize(id, { fingerprint: (await reviewed(id)).fingerprint })).statusCode).toBe(201);
  });
});

describe("A finalized Process", () => {
  it("is read-only: every attempt to change it is refused", async () => {
    const { id, constraintId, runnerId, cacheId } = await processReadyForFinalReview();
    const { questionId, versionId } = await firstQuestionOfP(id);
    expect((await finalize(id, { fingerprint: (await reviewed(id)).fingerprint })).statusCode).toBe(201);

    const attempts = [
      await api.answer(id, questionId, { selectedChoices: [1], basedOnVersionId: versionId }),
      await api.inject({ method: "PUT", url: `/api/processes/${id}/questions/${questionId}/answer/draft`, payload: { text: "x", basedOnVersionId: null } }),
      await api.choose(id, { optionId: runnerId, discards: [{ optionId: cacheId, reason: "Mudei de ideia." }] }),
      await api.recordElement(id, "plan_b", { text: "Outro plano B." }),
      await api.reviseConstraint(id, constraintId, null),
      await api.inject({ method: "POST", url: `/api/processes/${id}/recommendations` }),
      await finalize(id, { fingerprint: "0".repeat(64) }),
    ];

    for (const response of attempts) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "process_not_open" });
    }
    expect((await finalReview(id)).json()).toEqual({ error: "process_not_open" });
  });

  it("is protected by the database as well", async () => {
    const { id } = await processReadyForFinalReview();
    expect((await finalize(id, { fingerprint: (await reviewed(id)).fingerprint })).statusCode).toBe(201);

    await expect(sql`update processes set status = 'open' where id = ${id}`.execute(testApp.db)).rejects.toThrow();
    await expect(sql`update finalizations set report = '{}' where process_id = ${id}`.execute(testApp.db)).rejects.toThrow();
  });

  it("has no frozen report before the Finalization", async () => {
    const { id } = await processReadyForFinalReview();

    const response = await finalization(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "process_not_finalized" });
  });
});

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
  ],
};

describe("The report", () => {
  it("opens with the summary of the Decision", async () => {
    const { id } = await processReadyForFinalReview();

    const { report } = await reviewed(id);

    expect(report.identification).toMatchObject({ processId: id, origin: null });
    expect(report.decisionSummary).toEqual({
      problemStatement: statement,
      chosenOption: cache,
      discards: [{ option: runner, reason: "Mais caro." }],
      executionPlan: [
        { key: "first_step", name: "Primeiro passo concreto", text: firstStep },
        { key: "success_criteria", name: "Como reconhecer sucesso", text: successCriteria },
        { key: "plan_b", name: "Plano B", text: planB },
      ],
    });
  });

  it("records each Stage with its Points, Questions, the alternatives presented and the answers", async () => {
    const { id } = await processReadyForFinalReview();

    const { report } = await reviewed(id);

    expect(report.stages.map((stage: { stage: string }) => stage.stage)).toEqual(["P", "R", "O", "B", "E"]);
    const [p, r] = report.stages;
    expect(p.confirmation).toMatchObject({ withoutAssessment: false, justification: null });
    expect(p.stagePoints.map(({ key, status }: { key: string; status: string }) => [key, status])).toEqual([
      ["real_problem", "covered"],
      ["consequence", "covered"],
      ["urgency", "inapplicable"],
    ]);
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].synthesis).not.toBeNull();
    expect(p.blocks[0].questions[0]).toEqual({
      number: 1,
      wording: "A demora do deploy é o problema em si ou sintoma de outra coisa?",
      subject: "Sintoma ou causa",
      answerType: "single_choice",
      choices: ["A demora é o problema em si", "A demora é sintoma de outra coisa", "Não sei"],
      reformulates: null,
      answer: "A demora é o problema em si",
      status: "confirmed",
    });
    expect(r.blocks).toEqual([]);
    expect(report.stages[4].stagePoints.every((point: { status: string }) => point.status === "planned")).toBe(true);
  });

  it("gathers the assumptions and clarifications, the comparison of the Options and the Recommendations", async () => {
    const { id } = await processReadyForFinalReview();

    const { report } = await reviewed(id);

    expect(report.assumptionsAndClarifications).toEqual(
      expect.arrayContaining([
        { kind: "inapplicable", stage: "P", subject: "Motivo da urgência", text: "Não há pressa: é melhoria contínua." },
        { kind: "absence", stage: "R", subject: "Prazo", text: expect.any(String) },
      ]),
    );
    expect(report.comparison).toEqual([
      { option: runner, viability: "viable", violations: [], cells: null },
      { option: cache, viability: "viable", violations: [], cells: null },
    ]);
    expect(report.recommendations).toEqual([]);
    expect(report.options.map((option: { statement: string; status: string }) => [option.statement, option.status])).toEqual([
      [runner, "accepted"],
      [cache, "accepted"],
    ]);
  });

  it("ends with the history, telling superseded content from valid", async () => {
    const { id } = await processReadyForFinalReview();
    const { questionId, versionId } = await firstQuestionOfP(id);
    expect((await api.answer(id, questionId, { selectedChoices: [1], basedOnVersionId: versionId })).statusCode).toBe(201);
    expect((await api.recordElement(id, "plan_b", { text: "Voltar ao deploy manual." })).statusCode).toBe(201);

    const { report } = await reviewed(id);

    const answers = report.history.filter((entry: { kind: string; subject: string }) => entry.kind === "answer" && entry.subject.startsWith("P 1.1"));
    expect(answers.map(({ text, status }: { text: string; status: string }) => [text, status])).toEqual([
      ["A demora é o problema em si", "superseded"],
      ["A demora é sintoma de outra coisa", "valid"],
    ]);
    const planBs = report.history.filter((entry: { kind: string; subject: string }) => entry.kind === "plan_element" && entry.subject === "Plano B");
    expect(planBs.map(({ text, status }: { text: string; status: string }) => [text, status])).toEqual([
      [planB, "superseded"],
      ["Voltar ao deploy manual.", "valid"],
    ]);
    expect(report.history.find((entry: { kind: string }) => entry.kind === "choice")).toMatchObject({ text: cache, status: "valid" });
  });
});
