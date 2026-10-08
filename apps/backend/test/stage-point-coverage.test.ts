import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssistant } from "./support/fake-assistant.ts";
import { processApi } from "./support/process-api.ts";
import { createTestApp, resetDatabase, type TestApp } from "./support/test-app.ts";

let testApp: TestApp;
const api = processApi(() => testApp);

beforeEach(async () => {
  testApp = await createTestApp({ assistant: new FakeAssistant() });
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

const justification = "O problema é de melhoria contínua; não há prazo nem pressão externa.";

describe("Inapplicable Stage Point", () => {
  it("is declared with a justification and is no longer open", async () => {
    const id = await api.createProcess();

    const response = await api.declareInapplicable(id, "urgency", { justification: `  ${justification} ` });

    expect(response.statusCode).toBe(201);
    expect(response.json().stagePoint).toMatchObject({
      key: "urgency",
      name: "Motivo da urgência",
      status: "inapplicable",
      justification,
      blockId: null,
      recordedAt: expect.any(String),
    });
    const process = await api.getProcess(id);
    expect(process.openStagePoints.map((point: { key: string }) => point.key)).toEqual(["real_problem", "consequence"]);
    expect(process.stagePoints[2]).toMatchObject({ key: "urgency", status: "inapplicable", justification });
  });

  it.each([
    ["no justification", {}],
    ["a blank justification", { justification: " \n " }],
    ["a justification that is not text", { justification: 42 }],
  ])("is refused with %s", async (_case, payload) => {
    const id = await api.createProcess();

    const response = await api.declareInapplicable(id, "urgency", payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "justification_required" });
    expect((await api.getProcess(id)).openStagePoints).toHaveLength(3);
  });

  it("is refused for a Point that is not of the current Stage", async () => {
    const id = await api.createProcess();

    const response = await api.declareInapplicable(id, "deadline", { justification });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "stage_point_not_found" });
  });

  it("is refused for a Point that is no longer open", async () => {
    const id = await api.createProcess();
    await api.declareInapplicable(id, "urgency", { justification });

    const response = await api.declareInapplicable(id, "urgency", { justification: "Outra justificativa." });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_point_closed" });
    expect((await api.getProcess(id)).stagePoints[2].justification).toBe(justification);
  });

  it("is not offered to the AI in the next Block", async () => {
    const assistant = new FakeAssistant();
    await testApp.close();
    testApp = await createTestApp({ assistant });
    const id = await api.createProcess();
    await api.confirmStatement(id);
    await api.declareInapplicable(id, "urgency", { justification });
    assistant.block.willRespond({
      status: "completed",
      usage: null,
      result: {
        questions: [
          {
            wording: "A demora é o problema em si?",
            subject: "Sintoma ou causa",
            contextRelation: "O enunciado fala da demora.",
            rationale: null,
            stagePoints: ["real_problem", "consequence"],
            reformulates: null,
            answerType: "free_text",
            choices: [],
          },
        ],
      },
    });

    await api.generateBlock(id);

    expect(assistant.block.attempts[0]!.input.openStagePoints.map((point) => point.key)).toEqual(["real_problem", "consequence"]);
  });
});
