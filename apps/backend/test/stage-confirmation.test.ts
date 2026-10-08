import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssistant, defaultSynthesis } from "./support/fake-assistant.ts";
import { FakeAssessor, JEV_MODEL, coverageOutcome, verdict } from "./support/fake-assessor.ts";
import { processApi, statement } from "./support/process-api.ts";
import { createTestApp, resetDatabase, type TestApp } from "./support/test-app.ts";

let testApp: TestApp;
let assessor: FakeAssessor;
const api = processApi(() => testApp);

beforeEach(async () => {
  assessor = new FakeAssessor();
  testApp = await createTestApp({ assessor });
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

const suggestionOf = (key: string) => {
  const { covered, reason } = defaultSynthesis.coverage.find((item) => item.stagePoint === key)!;
  return { covered, reason };
};

describe("Jev Assessment of a Stage", () => {
  it("judges each Point given as covered from the confirmed answers, next to the AI suggestion", async () => {
    const { id, block } = await api.processWithClosedPoints();

    const stageAssessment = await api.assess(id);

    const [input] = assessor.inputs;
    expect(input).toEqual({
      stage: "P",
      problemStatement: statement,
      stagePoints: [
        expect.objectContaining({ key: "real_problem", name: "Problema real versus sintoma" }),
        expect.objectContaining({ key: "consequence", name: "Consequência de não resolver" }),
      ],
      answers: [
        { ref: "1.1", wording: block.questions[0].wording, answer: "A demora é o problema em si" },
        { ref: "1.2", wording: block.questions[1].wording, answer: "Atraso nas entregas" },
        { ref: "1.3", wording: block.questions[2].wording, answer: "A diretoria cobrou na última reunião." },
      ],
    });
    const answered = (await api.getProcess(id)).blocks[0].questions.map(
      (question: { answer: { current: { id: string } } }) => question.answer.current.id,
    );
    expect(stageAssessment).toMatchObject({
      stage: "P",
      status: "completed",
      requestedModel: JEV_MODEL,
      jevModel: JEV_MODEL,
      rubricRevision: expect.stringMatching(/^sha256:[0-9a-f]{16}$/),
      failureReason: null,
      outdated: false,
      assessments: [
        {
          type: "stage_point_coverage",
          stagePoint: { key: "real_problem", name: "Problema real versus sintoma" },
          choice: "yes",
          confidence: 0.9,
          probabilities: { yes: 0.9, no: expect.any(Number), insufficient: expect.any(Number) },
          aiSuggestion: suggestionOf("real_problem"),
          disagrees: false,
        },
        {
          stagePoint: { key: "consequence", name: "Consequência de não resolver" },
          choice: "yes",
          aiSuggestion: suggestionOf("consequence"),
          disagrees: false,
        },
      ],
    });
    expect(stageAssessment.analyzedAnswerVersionIds.toSorted()).toEqual(answered.toSorted());
    expect((await api.getProcess(id)).stageAssessments).toEqual([stageAssessment]);
  });

  it("confirms nothing by itself, however high the confidence", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond(coverageOutcome({ real_problem: verdict("yes", 0.99), consequence: verdict("yes", 0.99) }));

    await api.assess(id);

    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("P");
    expect(process.stageConfirmations).toEqual([]);
  });

  it("shows a low-confidence judgment as it came", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond(coverageOutcome({ consequence: verdict("insufficient", 0.34) }));

    const stageAssessment = await api.assess(id);

    expect(stageAssessment.assessments[1]).toMatchObject({ choice: "insufficient", confidence: 0.34, disagrees: true });
  });

  it("is refused while a Point of the Stage is still open", async () => {
    const { id } = await api.processWithAnsweredBlock();

    const response = await api.requestAssessment(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "open_stage_points" });
    expect(assessor.inputs).toEqual([]);
  });

  it("is refused for a Stage that is not the current one", async () => {
    const { id } = await api.processWithClosedPoints();

    const response = await api.requestAssessment(id, "R");

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_not_current" });
  });

  it("has nothing to judge when every Point was declared inapplicable", async () => {
    const id = await api.createProcess();
    await api.confirmStatement(id);
    for (const key of ["real_problem", "consequence", "urgency"]) {
      await api.declareInapplicable(id, key, { justification: "Não se aplica a este caso." });
    }

    const response = await api.requestAssessment(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "nothing_to_assess" });
  });
});

describe("Jev unavailable", () => {
  it("is recorded, and the user can try again", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond({ status: "failed", reason: "jev_unavailable", message: "O Jev não respondeu em 60 s." });

    const failed = await api.assess(id);
    const retried = await api.assess(id);

    expect(failed).toMatchObject({
      status: "failed",
      jevModel: null,
      failureReason: "jev_unavailable",
      message: "O Jev não respondeu em 60 s.",
      assessments: [],
      outdated: false,
    });
    expect(retried).toMatchObject({ status: "completed", failureReason: null });
    expect((await api.getProcess(id)).stageAssessments.map((item: { id: string }) => item.id)).toEqual([failed.id, retried.id]);
  });

  it("lets the user confirm the Stage without an Assessment, and that is recorded", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond({ status: "failed", reason: "jev_unavailable", message: "Fora do ar." });
    const failed = await api.assess(id);

    const response = await api.confirmStage(id, { stageAssessmentId: failed.id });

    expect(response.statusCode).toBe(201);
    const stageConfirmation = {
      stage: "P",
      stageAssessmentId: failed.id,
      withoutAssessment: true,
      justification: null,
      confirmedAt: expect.any(String),
    };
    expect(response.json().stageConfirmation).toEqual(stageConfirmation);
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("R");
    expect(process.stageConfirmations).toEqual([stageConfirmation]);
  });

  it("is what a judgment outside the Points asked becomes, whatever the Assessor", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond({ status: "completed", model: JEV_MODEL, result: { real_problem: verdict("yes") } });

    const stageAssessment = await api.assess(id);

    expect(stageAssessment).toMatchObject({ status: "failed", failureReason: "invalid_output", assessments: [] });
  });
});

describe("Stage Confirmation", () => {
  it("with the Jev in agreement, confirms Stage P and opens Stage R", async () => {
    const { id } = await api.processWithClosedPoints();
    const stageAssessment = await api.assess(id);

    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id });

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toEqual({
      stage: "P",
      stageAssessmentId: stageAssessment.id,
      withoutAssessment: false,
      justification: null,
      confirmedAt: expect.any(String),
    });
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("R");
    expect(process.stagePoints.map((point: { key: string; status: string }) => [point.key, point.status])).toEqual([
      ["deadline", "open"],
      ["systems_and_apis", "open"],
      ["constraints_vs_preferences", "open"],
    ]);
  });

  it("opens Stage R only then: before it, Blocks are of Stage P and R cannot be confirmed", async () => {
    const assistant = new FakeAssistant();
    await testApp.close();
    testApp = await createTestApp({ assistant, assessor });
    const { id } = await api.processWithClosedPoints();
    const stageAssessment = await api.assess(id);

    const early = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id }, "R");
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: "stage_not_current" });
    expect(assistant.block.attempts.map((attempt) => attempt.input.stage)).toEqual(["P"]);

    await api.confirmStage(id, { stageAssessmentId: stageAssessment.id });
    assistant.block.willRespond({
      status: "completed",
      usage: null,
      result: {
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
      },
    });
    const block = await api.generateBlock(id);

    expect(block.stage).toBe("R");
    expect(assistant.block.attempts.at(-1)!.input.openStagePoints.map((point) => point.key)).toEqual([
      "deadline",
      "systems_and_apis",
      "constraints_vs_preferences",
    ]);
  });

  it("against the Jev, is refused without a justification", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond(coverageOutcome({ consequence: verdict("no", 0.71) }));
    const stageAssessment = await api.assess(id);
    expect(stageAssessment.assessments[1]).toMatchObject({ choice: "no", aiSuggestion: { covered: true }, disagrees: true });

    for (const justification of [undefined, "   "]) {
      const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id, justification });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "justification_required" });
    }
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("P");
    expect(process.stageConfirmations).toEqual([]);
  });

  it("against the Jev, is accepted with the justification recorded", async () => {
    const { id } = await api.processWithClosedPoints();
    assessor.willRespond(coverageOutcome({ consequence: verdict("no", 0.71) }));
    const stageAssessment = await api.assess(id);
    const justification = "Os atrasos nas entregas são a consequência; o Jev não os ligou ao Ponto.";

    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id, justification: ` ${justification} ` });

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stage: "P", withoutAssessment: false, justification });
    expect((await api.getProcess(id)).currentStage).toBe("R");
  });

  it("is refused with a Point still open", async () => {
    const { id, block } = await api.processWithAnsweredBlock();
    const proposal = await api.synthesize(id, block.id);
    await api.confirmSynthesis(id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["real_problem", "consequence"],
    });

    const response = await api.confirmStage(id, { stageAssessmentId: null });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "open_stage_points" });
    expect((await api.getProcess(id)).currentStage).toBe("P");
  });

  it("is refused while a Pendency on a question of the Stage is open", async () => {
    const id = await api.createProcess();
    await api.confirmStatement(id);
    const block = await api.generateBlock(id);
    const [single, multiple, free] = block.questions;
    await api.answer(id, single.id, { selectedChoices: [0], basedOnVersionId: null });
    await api.answer(id, multiple.id, { selectedChoices: [0], basedOnVersionId: null });
    const pendency = (await api.markUnknown(id, free.id)).json().pendency;
    const proposal = await api.synthesize(id, block.id);
    await api.confirmSynthesis(id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["real_problem", "consequence", "urgency"],
    });
    const stageAssessment = await api.assess(id);

    const response = await api.confirmStage(id, { stageAssessmentId: stageAssessment.id });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "blocking_pendencies", pendencyIds: [pendency.id] });
    expect((await api.getProcess(id)).currentStage).toBe("P");
  });

  it("needs the Assessment the user saw, and the latest one", async () => {
    const { id } = await api.processWithClosedPoints();
    const older = await api.assess(id);
    await api.assess(id);

    const withNone = await api.confirmStage(id, { stageAssessmentId: null });
    const withOlder = await api.confirmStage(id, { stageAssessmentId: older.id });

    expect(withNone.statusCode).toBe(409);
    expect(withNone.json()).toEqual({ error: "assessment_required" });
    expect(withOlder.statusCode).toBe(422);
    expect(withOlder.json()).toEqual({ error: "unknown_assessment" });
  });

  it("goes without an Assessment when every Point was declared inapplicable", async () => {
    const id = await api.createProcess();
    await api.confirmStatement(id);
    for (const key of ["real_problem", "consequence", "urgency"]) {
      await api.declareInapplicable(id, key, { justification: "Não se aplica a este caso." });
    }

    const response = await api.confirmStage(id, { stageAssessmentId: null });

    expect(response.statusCode).toBe(201);
    expect(response.json().stageConfirmation).toMatchObject({ stageAssessmentId: null, withoutAssessment: true });
  });
});

describe("Reopening the Process after the Stage Confirmation", () => {
  it("restores the Stage, the Blocks, the valid Versions, the drafts, the Pendencies and the Assessments", async () => {
    const { id, block } = await api.processWithClosedPoints();
    const [single] = block.questions;
    const current = (await api.getProcess(id)).blocks[0].questions[0].answer.current;
    const draft = await api.inject({
      method: "PUT",
      url: `/api/processes/${id}/questions/${single.id}/answer/draft`,
      payload: { selectedChoices: [1], basedOnVersionId: current.id },
    });
    expect(draft.statusCode).toBe(200);
    const stageAssessment = await api.assess(id);
    await api.confirmStage(id, { stageAssessmentId: stageAssessment.id });
    const before = await api.getProcess(id);

    await testApp.close();
    testApp = await createTestApp({ assessor });
    const after = await api.getProcess(id);

    expect(after).toEqual(before);
    expect(after).toMatchObject({
      currentStage: "R",
      stageConfirmations: [{ stage: "P", stageAssessmentId: stageAssessment.id }],
      stageAssessments: [{ id: stageAssessment.id, stage: "P", outdated: false }],
      blocks: [{ id: block.id, questions: [{ answer: { current: { id: current.id, confirmed: true } }, draft: { selectedChoices: [1] } }, {}, {}] }],
    });
  });
});
