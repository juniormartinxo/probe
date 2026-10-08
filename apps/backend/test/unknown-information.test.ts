import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssistant } from "./support/fake-assistant.ts";
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

async function processWithBlock() {
  const id = await api.createProcess();
  await api.confirmStatement(id);
  const block = await api.generateBlock(id);
  const [single, multiple, free] = block.questions;
  return { id, block, single, multiple, free };
}

describe("Unknown information", () => {
  it("is registered explicitly on a question and stays visible as a Pendency of unknown information", async () => {
    const { id, free } = await processWithBlock();

    const response = await api.markUnknown(id, free.id);

    expect(response.statusCode).toBe(201);
    const pendency = {
      id: expect.any(String),
      reason: "unknown_information",
      question: { id: free.id, wording: free.wording, blockNumber: 1, number: 3 },
      stagePoints: [{ key: "urgency", name: "Motivo da urgência" }],
      openedAt: expect.any(String),
      resolvedAt: null,
      resolvedByAnswerVersionId: null,
    };
    expect(response.json().pendency).toEqual(pendency);
    await testApp.close();
    testApp = await createTestApp({ assistant });
    const process = await api.getProcess(id);
    expect(process.pendencies).toEqual([pendency]);
    expect(process.blocks[0].questions.map((question: { unknown: boolean }) => question.unknown)).toEqual([false, false, true]);
  });

  it("lets the Block be synthesized, and reaches the AI as unknown rather than as an answer", async () => {
    const { id, block, single, multiple, free } = await processWithBlock();
    await api.answer(id, single.id, { selectedChoices: [0], basedOnVersionId: null });
    await api.answer(id, multiple.id, { selectedChoices: [1], basedOnVersionId: null });
    await api.markUnknown(id, free.id);

    await api.synthesize(id, block.id);

    expect(assistant.synthesis.attempts[0]!.input.questions[2]).toEqual({
      ref: "1.3",
      wording: free.wording,
      stagePoints: ["urgency"],
      answer: null,
      unknown: true,
    });
  });

  it("is resolved by an answer given later, which stays linked to the Pendency", async () => {
    const { id, free } = await processWithBlock();
    await api.markUnknown(id, free.id);

    const answered = await api.answer(id, free.id, { text: "O contrato vence em março.", basedOnVersionId: null });

    const [pendency] = (await api.getProcess(id)).pendencies;
    expect(pendency).toMatchObject({
      resolvedAt: answered.json().answerVersion.createdAt,
      resolvedByAnswerVersionId: answered.json().answerVersion.id,
    });
    expect((await api.blockOf(id, (await api.getProcess(id)).blocks[0].id)).questions[2].unknown).toBe(false);
  });

  it("is refused for a question that already has an answer", async () => {
    const { id, single } = await processWithBlock();
    await api.answer(id, single.id, { selectedChoices: [0], basedOnVersionId: null });

    const response = await api.markUnknown(id, single.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "question_answered" });
    expect((await api.getProcess(id)).pendencies).toEqual([]);
  });

  it("is registered only once while open", async () => {
    const { id, free } = await processWithBlock();
    await api.markUnknown(id, free.id);

    const response = await api.markUnknown(id, free.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "already_unknown" });
    expect((await api.getProcess(id)).pendencies).toHaveLength(1);
  });

  it("is refused for a question of another Process", async () => {
    const other = await processWithBlock();
    const id = await api.createProcess();

    const response = await api.markUnknown(id, other.free.id);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "question_not_found" });
  });
});
