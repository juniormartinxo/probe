import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock, GeneratedSynthesis } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed, defaultSynthesis } from "./support/fake-assistant.ts";
import { FakeAssessor, JEV_MODEL, impactOutcome } from "./support/fake-assessor.ts";
import { processApi, statement } from "./support/process-api.ts";
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

const unavailable = { status: "failed", reason: "jev_unavailable", message: "O Jev não respondeu em 60 s." } as const;

// Etapa P atual, com a síntese do Bloco 1 confirmada; muda a resposta da Pergunta 1.1 de "A demora é o
// problema em si" para "A demora é sintoma de outra coisa".
async function changeConfirmedAnswer(setup: () => Promise<{ id: string; block: { id: string } }> = api.processWithClosedPoints) {
  const { id, block } = await setup();
  const question = (await api.blockOf(id, block.id)).questions[0];
  const previous = question.answer.current;
  const response = await api.answer(id, question.id, { selectedChoices: [1], basedOnVersionId: previous.id });
  expect(response.statusCode).toBe(201);
  return { id, block, question, previous, version: response.json().answerVersion };
}

const blockConfirmation = (blockId: string) => ({ kind: "block_synthesis", blockId });

// Etapa P com dois Blocos confirmados: o Bloco 1 cobre o problema real e a consequência; o Bloco 2,
// que recebe as respostas do Bloco 1 como contexto, cobre a urgência.
async function processWithSecondBlock() {
  const { id, block } = await api.processWithAnsweredBlock();
  const first = await api.synthesize(id, block.id);
  await api.confirmSynthesis(id, block.id, { proposalId: first.id, synthesis: first.synthesis, coveredStagePoints: ["real_problem", "consequence"] });
  assistant.block.willRespond(completed(secondBlock));
  const second = await api.generateBlock(id);
  await api.answer(id, second.questions[0].id, { text: "A revisão trimestral é em novembro.", basedOnVersionId: null });
  assistant.synthesis.willRespond(completed(secondSynthesis));
  const proposal = await api.synthesize(id, second.id);
  const confirmed = await api.confirmSynthesis(id, second.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: ["urgency"] });
  expect(confirmed.statusCode).toBe(201);
  return { id, first: await api.blockOf(id, block.id), second };
}

const secondBlock: GeneratedBlock = {
  questions: [
    {
      wording: "Quando é a próxima cobrança da diretoria?",
      subject: "Prazo da cobrança",
      contextRelation: "A diretoria cobrou uma solução.",
      rationale: null,
      stagePoints: ["urgency"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

const secondSynthesis: GeneratedSynthesis = {
  synthesis: "A urgência vem da revisão trimestral, em novembro.",
  coverage: [{ stagePoint: "urgency", covered: true, reason: "Revisão em novembro." }],
  ambiguousAnswers: [],
};

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
  ],
};

const stageRSynthesis: GeneratedSynthesis = {
  synthesis: "O deploy precisa ficar mais rápido até o fim do trimestre.",
  coverage: [
    { stagePoint: "deadline", covered: true, reason: "Fim do trimestre." },
    { stagePoint: "systems_and_apis", covered: false, reason: "Não foi dito." },
    { stagePoint: "constraints_vs_preferences", covered: false, reason: "Não foi dito." },
  ],
  ambiguousAnswers: [],
};

describe("A new Version of an answer", () => {
  it("has the Jev assess its impact on the block synthesis that depended on the previous one", async () => {
    const { id, block, question, previous, version } = await changeConfirmedAnswer();

    expect(assessor.impactInputs).toEqual([
      {
        problemStatement: statement,
        confirmation: {
          kind: "block_synthesis",
          stage: "P",
          blockNumber: 1,
          synthesis: defaultSynthesis.synthesis,
          coveredStagePoints: [
            expect.objectContaining({ key: "real_problem", name: "Problema real versus sintoma" }),
            expect.objectContaining({ key: "consequence", name: "Consequência de não resolver" }),
          ],
        },
        question: { ref: "1.1", wording: question.wording },
        previousAnswer: "A demora é o problema em si",
        newAnswer: "A demora é sintoma de outra coisa",
      },
    ]);
    const process = await api.getProcess(id);
    expect(process.impactAssessments).toEqual([
      {
        id: expect.any(String),
        answerVersionId: version.id,
        previousAnswerVersionId: previous.id,
        constraintRevisionId: null,
        analyzedAnswerVersionIds: [],
        confirmation: { kind: "block_synthesis", blockId: block.id, blockNumber: 1, stage: "P" },
        status: "completed",
        requestedModel: JEV_MODEL,
        jevModel: JEV_MODEL,
        rubricRevision: expect.stringMatching(/^sha256:[0-9a-f]{16}$/),
        choice: "no",
        confidence: 0.9,
        probabilities: { yes: expect.any(Number), no: 0.9, insufficient: expect.any(Number) },
        needsDecision: false,
        failureReason: null,
        message: null,
        createdAt: expect.any(String),
      },
    ]);
  });

  it("with no impact, keeps the Confirmation valid and confirmed by it", async () => {
    const { id, version } = await changeConfirmedAnswer();

    expect(version.confirmed).toBe(true);
    const process = await api.getProcess(id);
    expect(process.reassessments).toEqual([]);
    expect(process.pendencies).toEqual([]);
    expect(process.blocks[0].questions[0].answer.current).toMatchObject({ id: version.id, confirmed: true });
    // A Avaliação de cobertura passa a olhar a resposta nova.
    const stageAssessment = await api.assess(id);
    expect(stageAssessment.analyzedAnswerVersionIds).toContain(version.id);
  });

  it("is not assessed when no Confirmation depended on the previous Version", async () => {
    const { id, block } = await api.processWithAnsweredBlock();
    const [single] = (await api.blockOf(id, block.id)).questions;

    const response = await api.answer(id, single.id, { selectedChoices: [1], basedOnVersionId: single.answer.current.id });

    expect(response.statusCode).toBe(201);
    expect(assessor.impactInputs).toEqual([]);
    expect((await api.getProcess(id)).impactAssessments).toEqual([]);
  });

  it("in a confirmed Stage, is assessed against each Confirmation that depended on it", async () => {
    const { id, block, question } = await changeConfirmedAnswer(api.processInStageR);

    expect(assessor.impactInputs.map((input) => input.confirmation.kind).toSorted()).toEqual(["block_synthesis", "stage"]);
    const onStage = assessor.impactInputs.find((input) => input.confirmation.kind === "stage")!;
    expect(onStage.confirmation).toEqual({
      kind: "stage",
      stage: "P",
      stagePoints: [
        expect.objectContaining({ key: "real_problem" }),
        expect.objectContaining({ key: "consequence" }),
        expect.objectContaining({ key: "urgency" }),
      ],
      // A Etapa como estava confirmada antes da mudança.
      answers: [
        { ref: "1.1", wording: question.wording, answer: "A demora é o problema em si" },
        expect.objectContaining({ ref: "1.2" }),
        expect.objectContaining({ ref: "1.3" }),
      ],
    });
    const process = await api.getProcess(id);
    const onStageAssessment = process.impactAssessments.find((item: { confirmation: { kind: string } }) => item.confirmation.kind === "stage");
    // As Versões que a Etapa sustentava e que o Jev recebeu ficam gravadas.
    expect(onStageAssessment.analyzedAnswerVersionIds).toHaveLength(3);
    expect(process.impactAssessments.map((item: { confirmation: unknown }) => item.confirmation)).toEqual(
      expect.arrayContaining([
        { kind: "block_synthesis", blockId: block.id, blockNumber: 1, stage: "P" },
        { kind: "stage", stage: "P" },
      ]),
    );
    expect(process.reassessments).toEqual([]);
  });

  it("is assessed against a later Block's synthesis that received it as context, which does not confirm it", async () => {
    const second = await processWithSecondBlock();
    assessor.willAssessImpact(impactOutcome("yes"), impactOutcome("no"));
    const [single] = second.first.questions;

    const response = await api.answer(second.id, single.id, { selectedChoices: [1], basedOnVersionId: single.answer.current.id });

    expect(response.statusCode).toBe(201);
    expect(assessor.impactInputs.map((input) => input.confirmation.kind === "block_synthesis" && input.confirmation.blockNumber)).toEqual([1, 2]);
    const process = await api.getProcess(second.id);
    // A síntese do Bloco 1, em revisão, é a que confirma a resposta; a do Bloco 2 apenas se apoia nela.
    expect(process.reassessments).toMatchObject([{ confirmation: { blockNumber: 1 }, status: "pendency_open" }]);
    expect(process.blocks[0].questions[0].answer.current).toMatchObject({ id: response.json().answerVersion.id, confirmed: false });
  });
});

describe("Impact `yes`", () => {
  it("opens a Pendency of reassessment linked to the new Version, the affected Confirmation and the Assessment", async () => {
    assessor.willAssessImpact(impactOutcome("yes", 0.85));
    const { id, block, question, previous, version } = await changeConfirmedAnswer();

    expect(version.confirmed).toBe(false);
    const process = await api.getProcess(id);
    const [impactAssessment] = process.impactAssessments;
    expect(impactAssessment).toMatchObject({ choice: "yes", confidence: 0.85, needsDecision: false });
    const pendency = {
      id: expect.any(String),
      reason: "reassessment",
      question: { id: question.id, wording: question.wording, stage: "P", blockNumber: 1, number: 1 },
      stagePoints: [{ key: "real_problem", name: "Problema real versus sintoma" }],
      openedAt: expect.any(String),
      resolvedAt: null,
      resolvedByAnswerVersionId: null,
      resolution: null,
      reassessment: {
        answerVersionId: version.id,
        previousAnswerVersionId: previous.id,
        constraintRevisionId: null,
        confirmation: { kind: "block_synthesis", blockId: block.id, blockNumber: 1, stage: "P" },
        openedBy: "jev",
        impactAssessment,
      },
      conflict: null,
    };
    expect(process.pendencies).toEqual([pendency]);
    // O chat mostra o que precisa ser revisto e por quê: a Confirmação, a mudança e o julgamento.
    expect(process.reassessments).toEqual([
      {
        confirmation: { kind: "block_synthesis", blockId: block.id, blockNumber: 1, stage: "P" },
        question: { id: question.id, wording: question.wording, stage: "P", blockNumber: 1, number: 1 },
        previousVersion: { id: previous.id, number: 1, answer: "A demora é o problema em si" },
        newVersion: { id: version.id, number: 2, answer: "A demora é sintoma de outra coisa" },
        status: "pendency_open",
        impactAssessments: [impactAssessment],
        pendencyId: process.pendencies[0].id,
      },
    ]);
    expect(process.blocks[0].questions[0].answer.current.confirmed).toBe(false);
  });

  it("blocks the Confirmation of the Stage, which depends on the Confirmation under review", async () => {
    assessor.willAssessImpact(impactOutcome("yes"));
    const { id } = await changeConfirmedAnswer();
    const stageAssessment = await api.assess(id);

    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id });

    const [pendency] = (await api.getProcess(id)).pendencies;
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "blocking_pendencies", pendencyIds: [pendency.id] });
    expect((await api.getProcess(id)).currentStage).toBe("P");
  });

  it("blocks only what depends on it: in Stage R, the user keeps answering, synthesizing and registering", async () => {
    const { id } = await api.processInStageR();
    assessor.willAssessImpact(impactOutcome("yes"), impactOutcome("yes"));
    const [single] = (await api.getProcess(id)).blocks[0].questions;
    await api.answer(id, single.id, { selectedChoices: [1], basedOnVersionId: single.answer.current.id });
    const pendencyIds = (await api.getProcess(id)).pendencies.map((pendency: { id: string }) => pendency.id);
    expect(pendencyIds).toHaveLength(2);

    assistant.block.willRespond(completed(stageRBlock));
    const blockR = await api.generateBlock(id);
    const answered = await api.answer(id, blockR.questions[0].id, { text: "Até o fim do trimestre.", basedOnVersionId: null });
    assistant.synthesis.willRespond(completed(stageRSynthesis));
    const proposal = await api.synthesize(id, blockR.id);
    const synthesized = await api.confirmSynthesis(id, blockR.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["deadline"],
    });
    const registered = await api.inject({ method: "POST", url: `/api/processes/${id}/constraints`, payload: { statement: "Custo até 500" } });

    expect([answered.statusCode, synthesized.statusCode, registered.statusCode]).toEqual([201, 201, 201]);
    await api.inject({ method: "POST", url: `/api/processes/${id}/stage-points/systems_and_apis/absence` });
    await api.declareInapplicable(id, "constraints_vs_preferences", { justification: "Ainda em discussão." });
    const stageAssessment = await api.assess(id, "R");
    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id }, "R");
    // A Confirmação de R se apoia na de P, em revisão.
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "blocking_pendencies", pendencyIds });
  });
});

describe("Impact `insufficient` or with low confidence", () => {
  it("is shown to the user, opens no Pendency and holds the Stage Confirmation until the user decides", async () => {
    assessor.willAssessImpact(impactOutcome("insufficient", 0.5));
    const { id } = await changeConfirmedAnswer();

    const process = await api.getProcess(id);
    expect(process.pendencies).toEqual([]);
    expect(process.reassessments).toMatchObject([
      { status: "awaiting_decision", impactAssessments: [{ choice: "insufficient", confidence: 0.5, needsDecision: true }], pendencyId: null },
    ]);
    const stageAssessment = await api.assess(id);
    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "undecided_reassessments" });
  });

  it("lets the user open the Pendency, recorded as theirs and linked to the Assessment they saw", async () => {
    assessor.willAssessImpact(impactOutcome("yes", 0.6));
    const { id, block, version } = await changeConfirmedAnswer();
    const [reassessment] = (await api.getProcess(id)).reassessments;
    expect(reassessment).toMatchObject({ status: "awaiting_decision", impactAssessments: [{ choice: "yes", needsDecision: true }] });
    const [impactAssessment] = reassessment.impactAssessments;

    const response = await api.decideImpact(id, version.id, {
      confirmation: blockConfirmation(block.id),
      impactAssessmentId: impactAssessment.id,
      decision: "open_pendency",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().pendency).toMatchObject({
      reason: "reassessment",
      reassessment: { answerVersionId: version.id, openedBy: "user", impactAssessment: { id: impactAssessment.id } },
    });
    expect((await api.getProcess(id)).reassessments).toMatchObject([{ status: "pendency_open", pendencyId: response.json().pendency.id }]);
  });

  it("with a low-confidence `no`, also waits for the user", async () => {
    assessor.willAssessImpact(impactOutcome("no", 0.65));
    const { id } = await changeConfirmedAnswer();

    const process = await api.getProcess(id);
    expect(process.pendencies).toEqual([]);
    expect(process.reassessments).toMatchObject([{ status: "awaiting_decision", impactAssessments: [{ choice: "no", needsDecision: true }] }]);
    expect(process.blocks[0].questions[0].answer.current.confirmed).toBe(false);
  });

  it("lets the user keep the Confirmation, which then holds the new Version", async () => {
    assessor.willAssessImpact(impactOutcome("no", 0.55));
    const { id, block, version } = await changeConfirmedAnswer();
    const [impactAssessment] = (await api.getProcess(id)).impactAssessments;

    const response = await api.decideImpact(id, version.id, {
      confirmation: blockConfirmation(block.id),
      impactAssessmentId: impactAssessment.id,
      decision: "keep_confirmation",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ pendency: null });
    const process = await api.getProcess(id);
    expect(process.reassessments).toEqual([]);
    expect(process.pendencies).toEqual([]);
    expect(process.blocks[0].questions[0].answer.current).toMatchObject({ id: version.id, confirmed: true });
    const again = await api.decideImpact(id, version.id, {
      confirmation: blockConfirmation(block.id),
      impactAssessmentId: impactAssessment.id,
      decision: "open_pendency",
    });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ error: "reassessment_not_found" });
  });

  it("is decided only on the latest Assessment, the one the user saw", async () => {
    assessor.willAssessImpact(unavailable, impactOutcome("insufficient"));
    const { id, block, version } = await changeConfirmedAnswer();
    const [failed] = (await api.getProcess(id)).impactAssessments;
    await api.retryImpact(id, version.id, blockConfirmation(block.id));

    const response = await api.decideImpact(id, version.id, {
      confirmation: blockConfirmation(block.id),
      impactAssessmentId: failed.id,
      decision: "keep_confirmation",
    });
    const malformed = await api.decideImpact(id, version.id, { confirmation: { kind: "stage", stage: "X" }, decision: "keep_confirmation" });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "unknown_assessment" });
    expect(malformed.statusCode).toBe(400);
  });

  it("is not up to the user once the Jev decided", async () => {
    assessor.willAssessImpact(impactOutcome("yes"));
    const { id, block, version } = await changeConfirmedAnswer();
    const [impactAssessment] = (await api.getProcess(id)).impactAssessments;

    const response = await api.decideImpact(id, version.id, {
      confirmation: blockConfirmation(block.id),
      impactAssessmentId: impactAssessment.id,
      decision: "keep_confirmation",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "reassessment_decided" });
  });
});

describe("Resolving the Pendency of reassessment", () => {
  it("by reconfirming the block synthesis, with the corrected text, which the AI then receives", async () => {
    assessor.willAssessImpact(impactOutcome("yes"));
    const { id, version } = await changeConfirmedAnswer();
    const [pendency] = (await api.getProcess(id)).pendencies;
    const corrected = "A demora é sintoma de testes lentos e já atrasou entregas.";

    const response = await api.reconfirm(id, pendency.id, { synthesis: ` ${corrected} ` });

    expect(response.statusCode).toBe(200);
    expect(response.json().pendency).toMatchObject({
      id: pendency.id,
      resolution: "reconfirmed",
      resolvedAt: expect.any(String),
      resolvedByAnswerVersionId: null,
    });
    const process = await api.getProcess(id);
    expect(process.reassessments).toEqual([]);
    expect(process.blocks[0].synthesis).toMatchObject({
      synthesis: defaultSynthesis.synthesis,
      corrections: [{ synthesis: corrected, correctedAt: expect.any(String) }],
    });
    expect(process.blocks[0].questions[0].answer.current).toMatchObject({ id: version.id, confirmed: true });
    const understanding = (await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` })).json().understanding;
    expect(understanding.blocks[0].synthesis).toBe(corrected);
    expect(understanding.openPendencies).toEqual([]);

    // Resolvida, a Etapa volta a poder ser confirmada, com uma Avaliação de cobertura da resposta nova.
    const stageAssessment = await api.assess(id);
    expect((await api.confirmStage(id, { stageAssessmentId: stageAssessment.id })).statusCode).toBe(201);
  });

  it("by reconfirming as it is, and only once", async () => {
    assessor.willAssessImpact(impactOutcome("yes"));
    const { id } = await changeConfirmedAnswer();
    const [pendency] = (await api.getProcess(id)).pendencies;

    const response = await api.reconfirm(id, pendency.id);
    const again = await api.reconfirm(id, pendency.id);

    expect(response.statusCode).toBe(200);
    expect((await api.getProcess(id)).blocks[0].synthesis.corrections).toEqual([]);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "pendency_resolved" });
  });

  it("of a Stage Confirmation, by reconfirming it, without a synthesis to correct", async () => {
    // A síntese do Bloco é avaliada antes da Etapa que se apoia nela.
    assessor.willAssessImpact(impactOutcome("no"), impactOutcome("yes"));
    const { id } = await changeConfirmedAnswer(api.processInStageR);
    const [pendency] = (await api.getProcess(id)).pendencies;
    expect(pendency.reassessment.confirmation).toEqual({ kind: "stage", stage: "P" });

    const withText = await api.reconfirm(id, pendency.id, { synthesis: "Outro texto." });
    const response = await api.reconfirm(id, pendency.id);

    expect(withText.statusCode).toBe(422);
    expect(withText.json()).toEqual({ error: "synthesis_not_applicable" });
    expect(response.statusCode).toBe(200);
    expect(response.json().pendency).toMatchObject({ resolution: "reconfirmed" });
    expect((await api.getProcess(id)).reassessments).toEqual([]);
  });

  it("by correcting the answer: the new Version resolves it and goes through its own Assessment", async () => {
    assessor.willAssessImpact(impactOutcome("yes"), impactOutcome("no"));
    const { id, question, version } = await changeConfirmedAnswer();
    const [pendency] = (await api.getProcess(id)).pendencies;

    const corrected = await api.answer(id, question.id, { selectedChoices: [0], basedOnVersionId: version.id });

    expect(corrected.statusCode).toBe(201);
    const process = await api.getProcess(id);
    expect(process.pendencies).toEqual([
      expect.objectContaining({
        id: pendency.id,
        resolution: "corrected",
        resolvedByAnswerVersionId: corrected.json().answerVersion.id,
        resolvedAt: corrected.json().answerVersion.createdAt,
      }),
    ]);
    expect(assessor.impactInputs.at(-1)).toMatchObject({
      previousAnswer: "A demora é o problema em si",
      newAnswer: "A demora é o problema em si",
    });
    expect(process.reassessments).toEqual([]);
    expect(corrected.json().answerVersion.confirmed).toBe(true);
  });
});

describe("Jev unavailable for the impact", () => {
  it("is recorded, and the user can try again", async () => {
    assessor.willAssessImpact(unavailable);
    const { id, block, version } = await changeConfirmedAnswer();

    const [reassessment] = (await api.getProcess(id)).reassessments;
    expect(reassessment).toMatchObject({
      status: "assessment_failed",
      impactAssessments: [
        { status: "failed", jevModel: null, choice: null, confidence: null, failureReason: "jev_unavailable", message: unavailable.message },
      ],
    });
    const retried = await api.retryImpact(id, version.id, blockConfirmation(block.id));

    expect(retried.statusCode).toBe(201);
    expect(retried.json().impactAssessment).toMatchObject({ status: "completed", choice: "no" });
    const process = await api.getProcess(id);
    expect(process.reassessments).toEqual([]);
    expect(process.impactAssessments.map((item: { status: string }) => item.status)).toEqual(["failed", "completed"]);
  });

  it("lets the user decide by hand, and that is recorded", async () => {
    assessor.willAssessImpact(unavailable);
    const { id, block, version } = await changeConfirmedAnswer();
    const [failed] = (await api.getProcess(id)).impactAssessments;

    const response = await api.decideImpact(id, version.id, {
      confirmation: blockConfirmation(block.id),
      impactAssessmentId: failed.id,
      decision: "open_pendency",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().pendency.reassessment).toMatchObject({
      openedBy: "user",
      impactAssessment: { id: failed.id, status: "failed", failureReason: "jev_unavailable" },
    });
  });

  it("on a Stage Confirmation, tries again with the Stage as it was confirmed, even after the block synthesis took the change", async () => {
    // A síntese do Bloco recebe `no` e passa a sustentar a Versão nova; a Etapa fica sem Avaliação.
    assessor.willAssessImpact(impactOutcome("no"), unavailable);
    const { id, version } = await changeConfirmedAnswer(api.processInStageR);

    const retried = await api.retryImpact(id, version.id, { kind: "stage", stage: "P" });

    expect(retried.statusCode).toBe(201);
    const input = assessor.impactInputs.at(-1)!;
    expect(input.confirmation.kind === "stage" && input.confirmation.answers[0]).toMatchObject({ ref: "1.1", answer: "A demora é o problema em si" });
    expect(input.newAnswer).toBe("A demora é sintoma de outra coisa");
  });

  it("does not try again once the Jev judged the impact", async () => {
    assessor.willAssessImpact(impactOutcome("insufficient"));
    const { id, block, version } = await changeConfirmedAnswer();

    const response = await api.retryImpact(id, version.id, blockConfirmation(block.id));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "impact_assessed" });
  });

  it("is what an Assessor that throws becomes, and the new Version stays recorded", async () => {
    assessor.assessImpact = async () => {
      throw new Error("conexão recusada");
    };
    const { id, version } = await changeConfirmedAnswer();

    const process = await api.getProcess(id);
    expect(process.blocks[0].questions[0].answer.current.id).toBe(version.id);
    expect(process.reassessments).toMatchObject([
      { status: "assessment_failed", impactAssessments: [{ failureReason: "jev_error", message: "conexão recusada" }] },
    ]);
  });
});

describe("Reopening the Process with a reassessment open", () => {
  it("restores the reassessments, the Pendencies and the impact Assessments", async () => {
    assessor.willAssessImpact(impactOutcome("yes"), impactOutcome("insufficient"));
    await changeConfirmedAnswer(api.processInStageR);
    const id = (await api.inject({ method: "GET", url: "/api/processes" })).json().processes[0].id;
    const before = await api.getProcess(id);

    await testApp.close();
    testApp = await createTestApp({ assistant, assessor });
    const after = await api.getProcess(id);

    expect(after).toEqual(before);
    expect(after.reassessments.map((item: { status: string }) => item.status).toSorted()).toEqual(["awaiting_decision", "pendency_open"]);
  });
});
