import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed, defaultSynthesis } from "./support/fake-assistant.ts";
import { processApi } from "./support/process-api.ts";
import { createTestApp, resetDatabase, type TestApp } from "./support/test-app.ts";

let assistant: FakeAssistant;
let testApp: TestApp;
const api = processApi(() => testApp);

beforeEach(async () => {
  assistant = new FakeAssistant();
  testApp = await createTestApp({ assistant });
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

const ambiguity = "Não ficou claro se a cobrança da diretoria tem prazo.";

// Segundo Bloco: reformula a Pergunta 1.3, cuja resposta a síntese apontou como ambígua.
const secondBlock: GeneratedBlock = {
  questions: [
    {
      wording: "A diretoria deu um prazo para resolver a demora do deploy?",
      subject: "Prazo da diretoria",
      contextRelation: "Você contou que a diretoria cobrou uma solução.",
      rationale: "Um prazo explica a urgência.",
      stagePoints: ["urgency"],
      reformulates: "1.3",
      answerType: "single_choice",
      choices: ["Sim, com data", "Não, sem data"],
    },
  ],
};

// Processo com o primeiro Bloco respondido e a síntese confirmada, com "real_problem" e
// "consequence" cobertos e a resposta 1.3 apontada como ambígua.
async function processWithConfirmedBlock() {
  assistant.synthesis.willRespond(completed({ ...defaultSynthesis, ambiguousAnswers: [{ question: "1.3", reason: ambiguity }] }));
  const { id, block } = await api.processWithAnsweredBlock();
  const proposal = await api.synthesize(id, block.id);
  const confirmed = await api.confirmSynthesis(id, block.id, {
    proposalId: proposal.id,
    synthesis: "A demora é sintoma; já atrasou entregas e a diretoria cobrou.",
    coveredStagePoints: ["real_problem", "consequence"],
  });
  expect(confirmed.statusCode).toBe(201);
  return { id, block: await api.blockOf(id, block.id) };
}

describe("New Block", () => {
  it("is generated for the Points still open, with what was already answered so it is not asked again", async () => {
    const { id, block } = await processWithConfirmedBlock();
    assistant.block.willRespond(completed(secondBlock));

    const second = await api.generateBlock(id);

    const [single, multiple, free] = block.questions;
    expect(assistant.block.attempts[1]!.input).toMatchObject({
      openStagePoints: [{ key: "urgency" }],
      askedQuestions: [
        { ref: "1.1", wording: single.wording, stagePoints: ["real_problem"], answer: single.choices[0], unknown: false },
        { ref: "1.2", wording: multiple.wording, stagePoints: ["consequence", "urgency"], answer: multiple.choices[0], unknown: false },
        { ref: "1.3", wording: free.wording, stagePoints: ["urgency"], answer: "A diretoria cobrou na última reunião.", unknown: false },
      ],
      confirmedSyntheses: ["A demora é sintoma; já atrasou entregas e a diretoria cobrou."],
      ambiguousAnswers: [{ question: "1.3", reason: ambiguity }],
    });
    expect(second).toMatchObject({ number: 2, stage: "P", synthesis: null, synthesisRequests: [] });
    const process = await api.getProcess(id);
    expect(process.blockRequests).toHaveLength(2);
    // O Bloco anterior fica como foi apresentado.
    const { synthesis: _s, synthesisRequests: _r, ...before } = block;
    const { synthesis: _s2, synthesisRequests: _r2, ...after } = process.blocks[0];
    expect(after).toEqual(before);
  });

  it("brings a reformulation as a new question linked to the original, whose answer stays with the text the user saw", async () => {
    const { id, block } = await processWithConfirmedBlock();
    assistant.block.willRespond(completed(secondBlock));

    const second = await api.generateBlock(id);

    const original = block.questions[2];
    const [reformulation] = second.questions;
    expect(reformulation).toMatchObject({
      wording: secondBlock.questions[0]!.wording,
      reformulates: { questionId: original.id, blockNumber: 1, number: 3, wording: original.wording },
      answer: null,
    });
    expect(reformulation.id).not.toBe(original.id);
    const kept = (await api.getProcess(id)).blocks[0].questions[2];
    expect(kept).toMatchObject({ wording: original.wording, answer: { current: { text: "A diretoria cobrou na última reunião." } } });
  });

  it("is refused when it reformulates a question that was never asked", async () => {
    const { id } = await processWithConfirmedBlock();
    assistant.block.willRespond(completed({ questions: [{ ...secondBlock.questions[0]!, reformulates: "9.9" }] }));

    await api.requestBlock(id);

    const process = await api.settledBlockRequest(id);
    expect(process.blockRequests[1]).toMatchObject({
      status: "failed",
      blockId: null,
      attempts: [{ failureReason: "invalid_output", message: expect.stringContaining("9.9") }],
    });
    expect(process.blocks).toHaveLength(1);
  });

  it("is not requested when every Point of the Stage is covered or inapplicable", async () => {
    const { id } = await processWithConfirmedBlock();
    await api.declareInapplicable(id, "urgency", { justification: "Não há urgência; é melhoria contínua." });

    const response = await api.requestBlock(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "no_open_stage_points" });
  });

  it("is synthesized with the earlier Blocks' answers, and its suggestion covers only what is still open", async () => {
    const { id, block } = await processWithConfirmedBlock();
    assistant.block.willRespond(completed(secondBlock));
    const second = await api.generateBlock(id);
    await api.answer(id, second.questions[0].id, { selectedChoices: [0], basedOnVersionId: null });
    assistant.synthesis.willRespond(
      completed({
        synthesis: "A diretoria deu prazo para resolver a demora.",
        coverage: [{ stagePoint: "urgency", covered: true, reason: "Há um prazo." }],
        ambiguousAnswers: [],
      }),
    );

    const proposal = await api.synthesize(id, second.id);

    const input = assistant.synthesis.attempts[1]!.input;
    expect(input.blockNumber).toBe(2);
    expect(input.openStagePoints.map((point) => point.key)).toEqual(["urgency"]);
    expect(input.questions.map((question) => question.ref)).toEqual(["2.1"]);
    expect(input.earlierQuestions.map((question) => question.ref)).toEqual(block.questions.map((_q: unknown, index: number) => `1.${index + 1}`));
    await api.confirmSynthesis(id, second.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: ["urgency"] });
    expect((await api.getProcess(id)).openStagePoints).toEqual([]);
  });

  it("does not ask again to reformulate an ambiguous answer that was already reformulated", async () => {
    const { id } = await processWithConfirmedBlock();
    assistant.block.willRespond(completed(secondBlock));
    const second = await api.generateBlock(id);
    await api.answer(id, second.questions[0].id, { selectedChoices: [1], basedOnVersionId: null });
    assistant.synthesis.willRespond(
      completed({ synthesis: "Sem prazo.", coverage: [{ stagePoint: "urgency", covered: false, reason: "Sem prazo." }], ambiguousAnswers: [] }),
    );
    const proposal = await api.synthesize(id, second.id);
    await api.confirmSynthesis(id, second.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] });
    assistant.block.willRespond(completed({ questions: [{ ...secondBlock.questions[0]!, reformulates: null }] }));

    await api.generateBlock(id);

    expect(assistant.block.attempts[2]!.input.ambiguousAnswers).toEqual([]);
  });

  it("whose synthesis used an earlier Block's answer is outdated when that answer changes", async () => {
    const { id, block } = await processWithConfirmedBlock();
    assistant.block.willRespond(completed(secondBlock));
    const second = await api.generateBlock(id);
    await api.answer(id, second.questions[0].id, { selectedChoices: [0], basedOnVersionId: null });
    assistant.synthesis.willRespond(
      completed({ synthesis: "Há prazo.", coverage: [{ stagePoint: "urgency", covered: true, reason: "Há prazo." }], ambiguousAnswers: [] }),
    );
    const proposal = await api.synthesize(id, second.id);
    const earlier = block.questions[2];
    await api.answer(id, earlier.id, { text: "A diretoria deu prazo até março.", basedOnVersionId: earlier.answer.current.id });

    const response = await api.confirmSynthesis(id, second.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "synthesis_outdated" });
    expect((await api.blockOf(id, second.id)).synthesisRequests[0].proposal.outdated).toBe(true);
  });

  it("does not offer for reformulation an ambiguous answer whose Points are all covered or inapplicable", async () => {
    assistant.synthesis.willRespond(
      completed({
        ...defaultSynthesis,
        ambiguousAnswers: [
          { question: "1.1", reason: "Não disse do que a demora é sintoma." },
          { question: "1.3", reason: ambiguity },
        ],
      }),
    );
    const { id, block } = await api.processWithAnsweredBlock();
    const proposal = await api.synthesize(id, block.id);
    // 1.1 serve só a real_problem, que fica coberto; 1.3 serve a urgency, que segue aberto.
    await api.confirmSynthesis(id, block.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: ["real_problem"] });
    assistant.block.willRespond(completed(secondBlock));

    await api.generateBlock(id);

    expect(assistant.block.attempts[1]!.input.ambiguousAnswers).toEqual([{ question: "1.3", reason: ambiguity }]);
  });
});
