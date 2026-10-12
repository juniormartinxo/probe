import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssessor } from "./support/fake-assessor.ts";
import type { GeneratedBlock, GeneratedSynthesis } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed, defaultBlock } from "./support/fake-assistant.ts";
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

const newProblem = "Os testes de integração quebram toda semana e ninguém confia neles.";

const requestSpinoff = (id: string, payload: Record<string, unknown>) => api.inject({ method: "POST", url: `/api/processes/${id}/spinoffs`, payload });

const frozenReport = async (id: string) => {
  const response = await api.inject({ method: "GET", url: `/api/processes/${id}/finalization` });
  expect(response.statusCode).toBe(200);
  return response.json().finalization;
};

// Um Desdobramento recém-criado da origem dada, herdando as Versões dadas.
async function createdSpinoff(originId: string, answerVersionIds: string[] = []) {
  const response = await requestSpinoff(originId, { description: newProblem, answerVersionIds });
  expect(response.statusCode).toBe(201);
  return response.json().process;
}

type DetailQuestion = {
  id: string;
  wording: string;
  answer: { current: { id: string; selectedChoices: number[] | null; text: string | null; confirmed: boolean }; previous: unknown[] };
};

// As Perguntas do Bloco da Etapa P da origem, com a Versão que vale de cada uma.
async function originQuestions(originId: string): Promise<DetailQuestion[]> {
  return (await api.getProcess(originId)).blocks[0].questions;
}

// Bloco da Etapa R com o prazo, sintetizado sem cobrir Ponto: a Etapa R se fecha pelas ausências.
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
    { stagePoint: "deadline", covered: true, reason: "O fim do trimestre." },
    { stagePoint: "systems_and_apis", covered: false, reason: "Não foi dito." },
    { stagePoint: "constraints_vs_preferences", covered: false, reason: "Não foi dito." },
  ],
  ambiguousAnswers: [],
};

// Responde e sintetiza, na Etapa R da origem, o Bloco do prazo, sem cobrir Ponto.
async function answerDeadline(id: string) {
  assistant.block.willRespond(completed(stageRBlock));
  const block = await api.generateBlock(id);
  expect((await api.answer(id, block.questions[0].id, { text: "Até o fim do trimestre.", basedOnVersionId: null })).statusCode).toBe(201);
  assistant.synthesis.willRespond(completed(stageRSynthesis));
  const proposal = await api.synthesize(id, block.id);
  expect((await api.confirmSynthesis(id, block.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] })).statusCode).toBe(201);
}

describe("Creating a Spinoff", () => {
  it("opens a new Process for the new problem, at Stage P, identifying the origin", async () => {
    const { id: originId } = await api.finalizedProcess();
    const origin = await api.getProcess(originId);

    const process = await createdSpinoff(originId);

    expect(process.id).not.toBe(originId);
    expect(process.status).toBe("open");
    expect(process.originalDescription).toBe(newProblem);
    expect(process.problemStatement).toBeNull();
    expect(process.currentStage).toBe("P");
    expect(process.stageConfirmations).toEqual([]);
    expect(process.derivation).toMatchObject({ kind: "spinoff", originProcessId: originId, originFinalizedAt: origin.finalizedAt });
    const listed = (await api.inject({ method: "GET", url: "/api/processes" })).json().processes;
    expect(listed.find((item: { id: string }) => item.id === process.id)).toMatchObject({ derivation: { kind: "spinoff", originProcessId: originId } });
  });

  it("brings the chosen answers of the origin as inherited answers: copied, identified and not confirmed", async () => {
    const { id: originId } = await api.finalizedProcess();
    const [first, second, third] = await originQuestions(originId);

    const process = await createdSpinoff(originId, [first!.answer.current.id, third!.answer.current.id]);

    expect(process.blocks).toHaveLength(1);
    const [block] = process.blocks;
    expect(block).toMatchObject({ stage: "P", number: 1, inherited: true, synthesis: null, synthesisRequests: [] });
    expect(block.questions.map((question: DetailQuestion) => question.wording)).toEqual([first!.wording, third!.wording]);
    expect(block.questions.map((question: DetailQuestion) => question.wording)).not.toContain(second!.wording);
    block.questions.forEach((question: DetailQuestion, index: number) => {
      const original = [first!, third!][index]!;
      expect(question.id).not.toBe(original.id);
      expect(question.answer.current.id).not.toBe(original.answer.current.id);
      expect(question.answer.current).toMatchObject({
        selectedChoices: original.answer.current.selectedChoices,
        text: original.answer.current.text,
        confirmed: false,
      });
      expect(question.answer.previous).toEqual([]);
    });
    // Nada está coberto: as Respostas herdadas ainda não valem.
    expect(process.stagePoints.every((point: { status: string }) => point.status === "open")).toBe(true);
  });

  it("is refused when the selection holds something other than an answer of the origin's confirmed set", async () => {
    const { id: originId, cacheId } = await api.finalizedProcess();
    const [first] = await originQuestions(originId);
    const { id: otherId } = await api.processWithAnsweredBlock();
    const other = (await api.getProcess(otherId)).blocks[0].questions[0].answer.current.id;
    const before = (await api.inject({ method: "GET", url: "/api/processes" })).json().processes;

    // A Escolha da origem não é resposta; a Versão de outro Processo não é da origem.
    for (const answerVersionIds of [[first!.answer.current.id, cacheId], [other], [first!.answer.current.id, first!.answer.current.id]]) {
      const response = await requestSpinoff(originId, { description: newProblem, answerVersionIds });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "invalid_inherited_answers" });
    }
    expect((await api.inject({ method: "GET", url: "/api/processes" })).json().processes).toEqual(before);
  });

  it("is refused without the new problem, for a Process that is not finalized and for one that does not exist", async () => {
    const { id: originId } = await api.finalizedProcess();
    const { id: openId } = await api.processWithAnsweredBlock();

    const withoutDescription = await requestSpinoff(originId, { answerVersionIds: [] });
    expect(withoutDescription.statusCode).toBe(400);
    expect(withoutDescription.json()).toEqual({ error: "description_required" });
    const notFinalized = await requestSpinoff(openId, { description: newProblem });
    expect(notFinalized.statusCode).toBe(409);
    expect(notFinalized.json()).toEqual({ error: "process_not_finalized" });
    const missing = await requestSpinoff("00000000-0000-4000-8000-000000000000", { description: newProblem });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "process_not_found" });
  });

  it("establishes the new problem in the first interaction, with the AI refinement, as in any Process", async () => {
    const { id: originId } = await api.finalizedProcess();
    const process = await createdSpinoff(originId);

    expect((await api.inject({ method: "POST", url: `/api/processes/${process.id}/problem-statement/refinement` })).statusCode).toBe(202);
    let refinement: { proposal: { id: string; statement: string } | null; status: string };
    await waitFor(async () => {
      refinement = (await api.getProcess(process.id)).refinement;
      return refinement.status !== "running";
    });
    expect(assistant.refinement.attempts.at(-1)!.input.originalDescription).toBe(newProblem);
    const { proposal } = refinement!;
    const confirmed = await api.inject({
      method: "POST",
      url: `/api/processes/${process.id}/problem-statement/confirmation`,
      payload: { statement: proposal!.statement, proposalId: proposal!.id },
    });
    expect(confirmed.statusCode).toBe(201);
  });
});

describe("Reconfirming the inherited answers", () => {
  it("holds them only after the user confirms the synthesis of their Block", async () => {
    const { id: originId } = await api.finalizedProcess();
    const inheritedIds = (await originQuestions(originId)).map((question) => question.answer.current.id);
    const process = await createdSpinoff(originId, inheritedIds);
    const [block] = process.blocks;

    // O problema novo vem antes: sem enunciado confirmado, não há síntese.
    const early = await api.requestSynthesis(process.id, block.id);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: "problem_statement_not_confirmed" });
    await api.confirmStatement(process.id);
    // Perguntas novas, só depois de reconfirmar o que veio da origem.
    expect((await api.requestBlock(process.id)).json()).toEqual({ error: "synthesis_not_confirmed" });

    const proposal = await api.synthesize(process.id, block.id);
    const sent = assistant.synthesis.attempts.at(-1)!.input;
    expect(sent.questions.map((question) => question.answer)).toEqual([
      "A demora é o problema em si",
      "Atraso nas entregas",
      "A diretoria cobrou na última reunião.",
    ]);
    const confirmed = await api.confirmSynthesis(process.id, block.id, {
      proposalId: proposal.id,
      synthesis: proposal.synthesis,
      coveredStagePoints: ["consequence"],
    });

    expect(confirmed.statusCode).toBe(201);
    const after = await api.getProcess(process.id);
    expect(after.blocks[0].questions.every((question: DetailQuestion) => question.answer.current.confirmed)).toBe(true);
    expect(after.stagePoints.find((point: { key: string }) => point.key === "consequence").status).toBe("covered");
    // Reconfirmadas, entram no que a IA já sabe ao formular o Bloco seguinte.
    assistant.block.willRespond(completed({ questions: defaultBlock.questions.slice(0, 1) }));
    const next = await api.generateBlock(process.id);
    expect(next.inherited).toBe(false);
    expect(assistant.block.attempts.at(-1)!.input.askedQuestions.map((question) => question.ref)).toEqual(["1.1", "1.2", "1.3"]);
  });

  it("lets the user change an inherited answer before reconfirming it", async () => {
    const { id: originId } = await api.finalizedProcess();
    const [first] = await originQuestions(originId);
    const process = await createdSpinoff(originId, [first!.answer.current.id]);
    const [question] = process.blocks[0].questions;

    const changed = await api.answer(process.id, question.id, { selectedChoices: [0], basedOnVersionId: question.answer.current.id });

    expect(changed.statusCode).toBe(201);
    expect(changed.json().answerVersion).toMatchObject({ number: 2, selectedChoices: [0], confirmed: false });
    expect((await api.getProcess(process.id)).pendencies).toEqual([]);
  });
});

describe("Inherited answers of a later Stage", () => {
  it("wait for their Stage to open before being reconfirmed", async () => {
    const { id: originId } = await api.finalizedProcess({ inStageR: answerDeadline });
    const deadline = (await api.getProcess(originId)).blocks.find((block: { stage: string }) => block.stage === "R").questions[0];
    const process = await createdSpinoff(originId, [deadline.answer.current.id]);
    const [block] = process.blocks;
    expect(block).toMatchObject({ stage: "R", inherited: true });
    expect(block.questions[0].answer.current).toMatchObject({ text: "Até o fim do trimestre.", confirmed: false });

    await api.confirmStatement(process.id);
    const early = await api.requestSynthesis(process.id, block.id);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: "stage_not_current" });

    // A Etapa P do problema novo, como em qualquer Processo; o Bloco herdado de R não a impede.
    const blockP = await api.generateBlock(process.id);
    await api.answerAll(process.id, blockP);
    const synthesisP = await api.synthesize(process.id, blockP.id);
    await api.confirmSynthesis(process.id, blockP.id, { proposalId: synthesisP.id, synthesis: synthesisP.synthesis, coveredStagePoints: ["real_problem", "consequence"] });
    await api.declareInapplicable(process.id, "urgency", { justification: "Não há pressa." });
    expect((await api.confirmStage(process.id, { stageAssessmentId: (await api.assess(process.id)).id })).statusCode).toBe(201);

    assistant.synthesis.willRespond(completed(stageRSynthesis));
    const proposal = await api.synthesize(process.id, block.id);
    const confirmed = await api.confirmSynthesis(process.id, block.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: ["deadline"] });
    expect(confirmed.statusCode).toBe(201);
    const after = await api.getProcess(process.id);
    expect(after.blocks.find((item: { id: string }) => item.id === block.id).questions[0].answer.current.confirmed).toBe(true);
    expect(after.stagePoints.find((point: { key: string }) => point.key === "deadline").status).toBe("covered");
  });
});

// Os ids que aparecem em qualquer ponto do detalhe do Processo.
function idsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) found.add(value);
  else if (Array.isArray(value)) for (const item of value) idsIn(item, found);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) idsIn(item, found);
  return found;
}

describe("The origin's Decision in a Spinoff", () => {
  it("comes only as context, never as an answer, Choice or plan", async () => {
    const { id: originId } = await api.finalizedProcess();
    const { report } = await frozenReport(originId);

    const process = await createdSpinoff(originId, (await originQuestions(originId)).map((question) => question.answer.current.id));

    expect(process.derivation.originDecision).toEqual(report.decisionSummary);
    expect(process.options).toEqual([]);
    expect(process.chosenOptions).toEqual([]);
    expect(process.constraints).toEqual([]);
    expect(process.preferences).toEqual([]);
    expect(process.executionPlan.every((element: { current: unknown }) => element.current === null)).toBe(true);
    const answers = process.blocks.flatMap((block: { questions: DetailQuestion[] }) => block.questions.map((question) => question.answer.current.text));
    expect(answers).not.toContain(report.decisionSummary.chosenOption);
  });
});

describe("The origin of a Spinoff", () => {
  it("stays intact while the Spinoff changes, and the Spinoff copies instead of referencing it", async () => {
    const { id: originId } = await api.finalizedProcess();
    const before = await api.getProcess(originId);
    const frozenBefore = await frozenReport(originId);
    const process = await createdSpinoff(originId, (await originQuestions(originId)).map((question) => question.answer.current.id));
    const [block] = process.blocks;

    const [question] = block.questions;
    expect((await api.answer(process.id, question.id, { selectedChoices: [1], basedOnVersionId: question.answer.current.id })).statusCode).toBe(201);
    await api.confirmStatement(process.id);
    const proposal = await api.synthesize(process.id, block.id);
    expect((await api.confirmSynthesis(process.id, block.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] })).statusCode).toBe(201);

    expect(await api.getProcess(originId)).toEqual(before);
    expect(await frozenReport(originId)).toEqual(frozenBefore);
    const { derivation: _, ...copied } = await api.getProcess(process.id);
    expect([...idsIn(copied)].filter((id) => idsIn(before).has(id))).toEqual([]);
  });
});

describe("Finalizing a Spinoff", () => {
  it("follows the rules of any Process, and the report identifies the origin and the inherited answers", async () => {
    const { id: originId } = await api.finalizedProcess();
    const { report: originReport, finalizedAt: originFinalizedAt } = await frozenReport(originId);
    const [, , third] = await originQuestions(originId);
    let spinoffId = "";
    // O problema novo, com a resposta sobre a urgência herdada e reconfirmada sem cobrir Ponto.
    const start = async () => {
      const process = await createdSpinoff(originId, [third!.answer.current.id]);
      spinoffId = process.id;
      await api.confirmStatement(process.id);
      const proposal = await api.synthesize(process.id, process.blocks[0].id);
      const confirmed = await api.confirmSynthesis(process.id, process.blocks[0].id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] });
      expect(confirmed.statusCode).toBe(201);
      return process.id;
    };

    await api.finalizedProcess({ start });

    const { report } = await frozenReport(spinoffId);
    expect(report.identification.origin).toEqual({ kind: "spinoff", processId: originId, finalizedAt: originFinalizedAt, decision: originReport.decisionSummary });
    expect(report.problem.originalDescription).toBe(newProblem);
    const [inherited, generated] = report.stages[0].blocks;
    expect(inherited).toMatchObject({ number: 1, inherited: true, questions: [{ wording: third!.wording, answer: third!.answer.current.text, status: "confirmed" }] });
    expect(generated).toMatchObject({ number: 2, inherited: false });
    const markdown = await api.inject({ method: "GET", url: `/api/processes/${spinoffId}/report.md` });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain(`Desdobramento do Processo ${originId}`);
    expect(markdown.body).toContain("Decisão da origem");
    expect(markdown.body).toContain("Bloco 1 · Respostas herdadas");
  });

  it("can itself be spun off and reconsidered", async () => {
    const { id: originId } = await api.finalizedProcess();
    let spinoffId = "";
    await api.finalizedProcess({
      start: async () => {
        spinoffId = (await createdSpinoff(originId)).id;
        await api.confirmStatement(spinoffId);
        return spinoffId;
      },
    });

    const next = await createdSpinoff(spinoffId);
    const reconsidered = await api.inject({ method: "POST", url: `/api/processes/${spinoffId}/reconsiderations` });

    expect(next.derivation).toMatchObject({ kind: "spinoff", originProcessId: spinoffId });
    expect(reconsidered.statusCode).toBe(201);
    expect(reconsidered.json().process.derivation).toMatchObject({ kind: "reconsideration", originProcessId: spinoffId, changes: [] });
  });
});
