import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssistant } from "./support/fake-assistant.ts";
import { description, processApi, statement } from "./support/process-api.ts";
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

const getUnderstanding = (id: string) => api.inject({ method: "GET", url: `/api/processes/${id}/understanding` });

describe("Understanding of the Process", () => {
  it("starts with the original description, before anything is confirmed", async () => {
    const id = await api.createProcess();

    const response = await getUnderstanding(id);

    expect(response.statusCode).toBe(200);
    expect(response.json().understanding).toEqual({
      originalDescription: description,
      problemStatement: null,
      currentStage: "P",
      stagePoints: [
        { key: "real_problem", name: "Problema real versus sintoma", status: "open", justification: null, absence: null },
        { key: "consequence", name: "Consequência de não resolver", status: "open", justification: null, absence: null },
        { key: "urgency", name: "Motivo da urgência", status: "open", justification: null, absence: null },
      ],
      constraints: [],
      preferences: [],
      blocks: [],
      openPendencies: [],
      options: [],
    });
  });

  it("gathers the confirmed statement, Point coverage, Block syntheses, answers as the user sees them and open Pendencies, without calling the AI", async () => {
    const id = await api.createProcess();
    await api.confirmStatement(id);
    const block = await api.generateBlock(id);
    const [single, multiple, free] = block.questions;
    await api.answer(id, single.id, { selectedChoices: [1], basedOnVersionId: null });
    await api.answer(id, multiple.id, { selectedChoices: [0, 2], basedOnVersionId: null });
    await api.markUnknown(id, free.id);
    const proposal = await api.synthesize(id, block.id);
    await api.confirmSynthesis(id, block.id, { proposalId: proposal.id, synthesis: "Síntese confirmada.", coveredStagePoints: ["real_problem"] });
    await api.declareInapplicable(id, "consequence", { justification: "Nada acontece se não resolver." });
    const calls = assistant.block.attempts.length + assistant.synthesis.attempts.length;

    const { understanding } = (await getUnderstanding(id)).json();

    expect(understanding).toEqual({
      originalDescription: description,
      problemStatement: statement,
      currentStage: "P",
      stagePoints: [
        { key: "real_problem", name: "Problema real versus sintoma", status: "covered", justification: null, absence: null },
        { key: "consequence", name: "Consequência de não resolver", status: "inapplicable", justification: "Nada acontece se não resolver.", absence: null },
        { key: "urgency", name: "Motivo da urgência", status: "open", justification: null, absence: null },
      ],
      constraints: [],
      preferences: [],
      blocks: [
        {
          number: 1,
          synthesis: "Síntese confirmada.",
          answers: [
            { questionId: single.id, wording: single.wording, answer: single.choices[1], confirmed: true, unknown: false },
            {
              questionId: multiple.id,
              wording: multiple.wording,
              answer: `${multiple.choices[0]}; ${multiple.choices[2]}`,
              confirmed: true,
              unknown: false,
            },
            { questionId: free.id, wording: free.wording, answer: null, confirmed: false, unknown: true },
          ],
        },
      ],
      openPendencies: [{ reason: "unknown_information", wording: free.wording }],
      options: [],
    });
    expect(assistant.block.attempts.length + assistant.synthesis.attempts.length).toBe(calls);
  });

  it.each([
    ["an unknown Process", "00000000-0000-4000-8000-000000000000"],
    ["a malformed id", "not-a-process"],
  ])("is not found for %s", async (_case, id) => {
    expect((await getUnderstanding(id)).statusCode).toBe(404);
  });
});
