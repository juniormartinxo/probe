import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock, GeneratedSynthesis } from "../src/modules/ai/assistant.ts";
import { FakeAssistant, completed, defaultResolutionQuestion } from "./support/fake-assistant.ts";
import { FakeAssessor, JEV_MODEL, conflictOutcome, impactOutcome, verdict } from "./support/fake-assessor.ts";
import { processApi, statement } from "./support/process-api.ts";
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

// Bloco da Etapa R com o caso do prazo × integração: um prazo de duas semanas e uma dependência
// obrigatória de uma integração que só fica disponível em um mês.
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
      wording: "De que sistemas ou integrações a solução depende?",
      subject: "Integrações",
      contextRelation: "O deploy passa por outros sistemas.",
      rationale: null,
      stagePoints: ["systems_and_apis"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

const deadline = "Em duas semanas.";
const integration = "Depende obrigatoriamente da nova API de artefatos, que só fica disponível daqui a um mês.";

const stageRSynthesis: GeneratedSynthesis = {
  synthesis: "O deploy precisa ficar mais rápido em duas semanas e depende da nova API de artefatos, prevista para daqui a um mês.",
  coverage: [
    { stagePoint: "deadline", covered: true, reason: "Duas semanas." },
    { stagePoint: "systems_and_apis", covered: true, reason: "A nova API de artefatos." },
    { stagePoint: "constraints_vs_preferences", covered: false, reason: "Não foi dito." },
  ],
  ambiguousAnswers: [],
};

// O par prazo × integração, pelas referências das Perguntas do Bloco 2.
const isDeadlineAndIntegration = (pair: { answer: { ref: string }; other: { ref: string } }) =>
  [pair.answer.ref, pair.other.ref].toSorted().join("+") === "2.1+2.2";

// O mesmo par, como a API o devolve.
const isDeadlineAndIntegrationPair = (pair: { answer: { question: { blockNumber: number; number: number } }; other: { question: { blockNumber: number; number: number } } }) =>
  isDeadlineAndIntegration({
    answer: { ref: `${pair.answer.question.blockNumber}.${pair.answer.question.number}` },
    other: { ref: `${pair.other.question.blockNumber}.${pair.other.question.number}` },
  });

// Etapa R atual, com o Bloco 2 (prazo e integração) respondido e a síntese dele confirmada. `before`
// roda antes do Bloco ser pedido, com a Etapa R já aberta.
async function confirmStageRBlock({ before }: { before?: (id: string) => Promise<unknown> } = {}) {
  const { id, block: blockP } = await api.processInStageR();
  await before?.(id);
  assistant.block.willRespond(completed(stageRBlock));
  const generated = await api.generateBlock(id);
  await api.answer(id, generated.questions[0].id, { text: deadline, basedOnVersionId: null });
  await api.answer(id, generated.questions[1].id, { text: integration, basedOnVersionId: null });
  assistant.synthesis.willRespond(completed(stageRSynthesis));
  const proposal = await api.synthesize(id, generated.id);
  const response = await api.confirmSynthesis(id, generated.id, {
    proposalId: proposal.id,
    synthesis: proposal.synthesis,
    coveredStagePoints: ["deadline", "systems_and_apis"],
  });
  expect(response.statusCode).toBe(201);
  return { id, blockP, block: await api.blockOf(id, generated.id) };
}

const register = (id: string, kind: "constraints" | "preferences", statement: string) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/${kind}`, payload: { statement } });

describe("Confirming a block synthesis", () => {
  it("has the Jev assess conflict between the Block's answers and the relevant confirmed ones, with the context", async () => {
    const { id, blockP, block } = await confirmStageRBlock({
      before: async (processId) => {
        await register(processId, "preferences", "Manter o GitHub Actions");
        await register(processId, "constraints", "Sem downtime");
      },
    });

    // A síntese do Bloco 1 já tinha avaliado as respostas da Etapa P entre si.
    expect(assessor.conflictInputs.map((item) => item.pairs.map((pair) => `${pair.answer.ref}+${pair.other.ref}`))[0]).toEqual([
      "1.1+1.2",
      "1.1+1.3",
      "1.2+1.3",
    ]);
    expect(assessor.conflictInputs).toHaveLength(2);
    const input = assessor.conflictInputs.at(-1);
    expect(input!.problemStatement).toBe(statement);
    expect(input!.constraints).toEqual([{ statement: "Sem downtime", scope: null, unit: null }]);
    expect(input!.preferences).toEqual([{ statement: "Manter o GitHub Actions", scope: null, unit: null }]);
    const deadlineAnswer = { ref: "2.1", stage: "R", wording: block.questions[0].wording, answer: deadline };
    const integrationAnswer = { ref: "2.2", stage: "R", wording: block.questions[1].wording, answer: integration };
    // Entre as duas respostas do Bloco e entre cada uma e as respostas confirmadas da Etapa P.
    expect(input!.pairs).toEqual([
      { key: expect.any(String), answer: deadlineAnswer, other: integrationAnswer },
      ...[deadlineAnswer, integrationAnswer].flatMap((answer) =>
        blockP.questions.map((question: { wording: string }, index: number) => ({
          key: expect.any(String),
          answer,
          other: expect.objectContaining({ ref: `1.${index + 1}`, stage: "P", wording: question.wording }),
        })),
      ),
    ]);
    expect(new Set(input!.pairs.map((pair) => pair.key)).size).toBe(7);
    const process = await api.getProcess(id);
    expect(process.conflictChecks).toMatchObject([
      { status: "decided" },
      {
        status: "decided",
        assessments: [{ status: "completed", requestedModel: JEV_MODEL, jevModel: JEV_MODEL, rubricRevision: expect.stringMatching(/^sha256:/) }],
      },
    ]);
    expect(process.conflictChecks[1].pairs).toHaveLength(7);
    expect(process.conflictChecks[1].pairs.every((pair: { status: string }) => pair.status === "no_conflict")).toBe(true);
    expect(process.pendencies).toEqual([]);
  });
});

// O Jev vê conflito, com confiança, entre o prazo e a integração; nos outros pares, nenhum.
const deadlineVersusIntegration = (confidence = 0.92) =>
  conflictOutcome((pair) => (isDeadlineAndIntegration(pair) ? verdict("yes", confidence) : undefined));

describe("Conflict `yes`", () => {
  it("opens a Pendency of conflict linked to the answers involved and to the Assessment", async () => {
    // A primeira Avaliação é a das respostas da Etapa P entre si.
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id, block } = await confirmStageRBlock();

    const process = await api.getProcess(id);
    const check = process.conflictChecks.at(-1);
    const conflicting = check.pairs.find((pair: { status: string }) => pair.status === "pendency_open");
    expect(conflicting.verdict).toMatchObject({ choice: "yes", confidence: 0.92, needsDecision: false });
    const [deadlineQuestion, integrationQuestion] = block.questions;
    const answerOf = (question: { id: string; wording: string; answer: { current: { id: string } } }, number: number, answer: string) => ({
      answerVersionId: question.answer.current.id,
      versionNumber: 1,
      question: { id: question.id, wording: question.wording, stage: "R", blockNumber: 2, number },
      answer,
      superseded: false,
    });
    expect(process.pendencies).toEqual([
      {
        id: conflicting.pendencyId,
        reason: "conflict",
        question: { id: deadlineQuestion.id, wording: deadlineQuestion.wording, stage: "R", blockNumber: 2, number: 1 },
        stagePoints: [{ key: "deadline", name: "Prazo" }],
        openedAt: expect.any(String),
        resolvedAt: null,
        resolvedByAnswerVersionId: null,
        resolution: null,
        reassessment: null,
        conflict: {
          checkId: check.id,
          pairId: conflicting.id,
          answers: [answerOf(deadlineQuestion, 1, deadline), answerOf(integrationQuestion, 2, integration)],
          openedBy: "jev",
          conflictAssessment: check.assessments[0],
          resolutionQuestion: expect.objectContaining({ id: expect.any(String) }),
          clarification: null,
          constraintRevision: null,
        },
      },
    ]);
    expect(check.status).toBe("decided");
  });

  it("has the AI formulate the question with which the user resolves it", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    await confirmStageRBlock({ before: (processId) => register(processId, "constraints", "Sem downtime") });
    const id = (await api.inject({ method: "GET", url: "/api/processes" })).json().processes[0].id;

    expect(assistant.resolutionQuestion.attempts.map((attempt) => attempt.input)).toEqual([
      {
        problemStatement: statement,
        constraints: [{ statement: "Sem downtime", scope: null, unit: null }],
        preferences: [],
        answers: [
          expect.objectContaining({ ref: "2.1", stage: "R", answer: deadline }),
          expect.objectContaining({ ref: "2.2", stage: "R", answer: integration }),
        ],
        clarifications: [],
      },
    ]);
    let pendency: { conflict: { resolutionQuestion: { status: string; question: string | null } } };
    await waitFor(async () => {
      [pendency] = (await api.getProcess(id)).pendencies;
      return pendency.conflict.resolutionQuestion.status !== "running";
    });
    expect(pendency!.conflict.resolutionQuestion).toMatchObject({ status: "completed", question: defaultResolutionQuestion.question });
  });
});

// Fecha o último Ponto de R e pede a Confirmação da Etapa, com a Avaliação de cobertura.
async function confirmStageR(id: string) {
  await api.declareInapplicable(id, "constraints_vs_preferences", { justification: "Ainda em discussão." });
  const stageAssessment = await api.assess(id, "R");
  return api.confirmStage(id, { stageAssessmentId: stageAssessment.id }, "R");
}

const thirdBlock: GeneratedBlock = {
  questions: [
    {
      wording: "Quem precisa aprovar a mudança no deploy?",
      subject: "Aprovação",
      contextRelation: "A diretoria cobrou uma solução.",
      rationale: null,
      stagePoints: ["constraints_vs_preferences"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

describe("The Pendency of conflict", () => {
  it("blocks only the Confirmations that depend on it: the user keeps answering, synthesizing and registering", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id } = await confirmStageRBlock();
    const [pendency] = (await api.getProcess(id)).pendencies;

    assistant.block.willRespond(completed(thirdBlock));
    const block = await api.generateBlock(id);
    const answered = await api.answer(id, block.questions[0].id, { text: "A diretoria de engenharia.", basedOnVersionId: null });
    assistant.synthesis.willRespond(
      completed({
        synthesis: "A diretoria de engenharia aprova a mudança.",
        coverage: [{ stagePoint: "constraints_vs_preferences", covered: false, reason: "Não distingue Restrições." }],
        ambiguousAnswers: [],
      }),
    );
    const proposal = await api.synthesize(id, block.id);
    const synthesized = await api.confirmSynthesis(id, block.id, { proposalId: proposal.id, synthesis: proposal.synthesis, coveredStagePoints: [] });
    const registered = await register(id, "constraints", "Sem downtime");

    expect([answered.statusCode, synthesized.statusCode, registered.statusCode]).toEqual([201, 201, 201]);
    const response = await confirmStageR(id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "blocking_pendencies", pendencyIds: [pendency.id] });
    expect((await api.getProcess(id)).currentStage).toBe("R");
  });

  it("is resolved by revising the deadline: the new Version resolves it and goes through its own Assessment", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id, block } = await confirmStageRBlock();
    const [pendency] = (await api.getProcess(id)).pendencies;
    const [deadlineQuestion] = block.questions;

    const revised = await api.answer(id, deadlineQuestion.id, { text: "Em cinco semanas.", basedOnVersionId: deadlineQuestion.answer.current.id });

    expect(revised.statusCode).toBe(201);
    const version = revised.json().answerVersion;
    // Sem impacto na síntese do Bloco, a Versão nova fica confirmada e tem o conflito avaliado.
    expect(version.confirmed).toBe(true);
    expect(assessor.conflictInputs.at(-1)!.pairs.map((pair) => [pair.answer.answer, pair.other.ref])).toEqual([
      ["Em cinco semanas.", "1.1"],
      ["Em cinco semanas.", "1.2"],
      ["Em cinco semanas.", "1.3"],
      ["Em cinco semanas.", "2.2"],
    ]);
    const process = await api.getProcess(id);
    expect(process.pendencies).toEqual([
      expect.objectContaining({
        id: pendency.id,
        resolution: "corrected",
        resolvedByAnswerVersionId: version.id,
        resolvedAt: version.createdAt,
        conflict: expect.objectContaining({
          answers: [expect.objectContaining({ answer: deadline, superseded: true }), expect.objectContaining({ answer: integration, superseded: false })],
        }),
      }),
    ]);
    expect(process.conflictChecks.at(-1)).toMatchObject({ status: "decided" });
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });
});

const reviseConstraint = (id: string, pendencyId: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/pendencies/${pendencyId}/constraint-revision`, payload });

const clarify = (id: string, pendencyId: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/pendencies/${pendencyId}/clarification`, payload });

describe("Resolving the Pendency of conflict", () => {
  it("by revising a Constraint: the deadline is withdrawn and replaced, and both stay in the history", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    let constraintId = "";
    const { id } = await confirmStageRBlock({
      before: async (processId) => {
        constraintId = (await register(processId, "constraints", "Entregar em duas semanas")).json().constraint.id;
      },
    });
    const [pendency] = (await api.getProcess(id)).pendencies;

    const response = await reviseConstraint(id, pendency.id, {
      constraintId,
      replacement: { kind: "preference", statement: "Entregar em duas semanas", scope: "Primeira versão" },
      note: " A data foi um desejo da diretoria, não um limite. ",
    });

    expect(response.statusCode).toBe(200);
    const process = await api.getProcess(id);
    const [preference] = process.preferences;
    expect(process.constraints).toEqual([expect.objectContaining({ id: constraintId, withdrawnAt: expect.any(String) })]);
    expect(preference).toMatchObject({ statement: "Entregar em duas semanas", scope: "Primeira versão", withdrawnAt: null });
    expect(response.json().pendency).toMatchObject({
      id: pendency.id,
      resolution: "constraint_revised",
      resolvedAt: expect.any(String),
      resolvedByAnswerVersionId: null,
      conflict: {
        clarification: null,
        constraintRevision: {
          id: expect.any(String),
          constraint: expect.objectContaining({ id: constraintId, statement: "Entregar em duas semanas" }),
          replacement: { kind: "preference", item: preference },
          note: "A data foi um desejo da diretoria, não um limite.",
          conflictPendencyId: pendency.id,
          revisedAt: expect.any(String),
        },
      },
    });
    expect(process.pendencies).toEqual([response.json().pendency]);
    // Na Etapa R, antes da Confirmação dela, nenhuma Confirmação sustentava a Restrição: nada a reavaliar.
    expect(assessor.constraintImpactInputs).toEqual([]);
    expect(process.constraintReassessments).toEqual([]);
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });

  it("by revising a Constraint, only one in force, leaving nothing recorded when refused", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    let constraintId = "";
    const { id } = await confirmStageRBlock({
      before: async (processId) => {
        constraintId = (await register(processId, "constraints", "Entregar em duas semanas")).json().constraint.id;
      },
    });
    const [pendency] = (await api.getProcess(id)).pendencies;
    await api.inject({ method: "POST", url: `/api/processes/${id}/constraints/${constraintId}/withdrawal` });

    const withdrawn = await reviseConstraint(id, pendency.id, { constraintId, replacement: { kind: "constraint", statement: "Cinco semanas" } });
    const malformed = await reviseConstraint(id, pendency.id, { constraintId, replacement: { kind: "desejo", statement: "Cinco semanas" } });

    expect(withdrawn.statusCode).toBe(409);
    expect(withdrawn.json()).toEqual({ error: "already_withdrawn" });
    expect(malformed.statusCode).toBe(400);
    // Nada da revisão recusada fica gravado.
    const process = await api.getProcess(id);
    expect(process.constraints).toHaveLength(1);
    expect(process.pendencies[0].resolvedAt).toBeNull();
  });

  it("by a clarification of the user, linked to the Pendency and to the answers", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id } = await confirmStageRBlock();
    const [pendency] = (await api.getProcess(id)).pendencies;
    const text = "Há uma alternativa provisória: publicar pelo registro atual até a nova API ficar pronta.";

    const empty = await clarify(id, pendency.id, { clarification: "  " });
    const response = await clarify(id, pendency.id, { clarification: ` ${text} ` });
    const again = await clarify(id, pendency.id, { clarification: text });

    expect(empty.statusCode).toBe(400);
    expect(response.statusCode).toBe(200);
    expect(response.json().pendency).toMatchObject({
      resolution: "clarified",
      resolvedAt: expect.any(String),
      conflict: { clarification: text, answers: [expect.objectContaining({ answer: deadline }), expect.objectContaining({ answer: integration })] },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "pendency_resolved" });
    const understanding = (await api.inject({ method: "GET", url: `/api/processes/${id}/understanding` })).json().understanding;
    expect(understanding.openPendencies).toEqual([]);
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });
});

const unavailable = { status: "failed", reason: "jev_unavailable", message: "O Jev não respondeu em 60 s." } as const;

const decide = (id: string, checkId: string, payload: Record<string, unknown>) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/conflict-checks/${checkId}/decision`, payload });

const retryConflicts = (id: string, checkId: string) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/conflict-checks/${checkId}/conflict-assessments` });

describe("An uncertain conflict result", () => {
  it("is shown to the user, opens no Pendency and holds the Stage Confirmation until the user decides", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration(0.55));
    const { id } = await confirmStageRBlock();

    const process = await api.getProcess(id);
    const check = process.conflictChecks.at(-1);
    expect(process.pendencies).toEqual([]);
    expect(check.status).toBe("awaiting_decision");
    expect(check.pairs.filter((pair: { status: string }) => pair.status === "awaiting_decision")).toEqual([
      expect.objectContaining({ verdict: expect.objectContaining({ choice: "yes", confidence: 0.55, needsDecision: true }) }),
    ]);
    const response = await confirmStageR(id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "undecided_conflicts" });
  });

  it("with a low-confidence `no`, also waits for the user", async () => {
    assessor.willAssessConflicts(conflictOutcome(), conflictOutcome((pair) => (isDeadlineAndIntegration(pair) ? verdict("no", 0.65) : undefined)));
    const { id } = await confirmStageRBlock();

    const process = await api.getProcess(id);
    const check = process.conflictChecks.at(-1);
    expect(process.pendencies).toEqual([]);
    expect(check.status).toBe("awaiting_decision");
    expect(check.pairs.filter((pair: { status: string }) => pair.status === "awaiting_decision")).toEqual([
      expect.objectContaining({ verdict: expect.objectContaining({ choice: "no", confidence: 0.65, needsDecision: true }) }),
    ]);
    expect((await confirmStageR(id)).json()).toEqual({ error: "undecided_conflicts" });
  });

  it("can be dismissed by the user: no Pendency, recorded on the Assessment they saw, and the Stage can be confirmed", async () => {
    assessor.willAssessConflicts(conflictOutcome(), conflictOutcome((pair) => (isDeadlineAndIntegration(pair) ? verdict("insufficient", 0.5) : undefined)));
    const { id } = await confirmStageRBlock();
    const check = (await api.getProcess(id)).conflictChecks.at(-1);
    const pair = check.pairs.find((item: { status: string }) => item.status === "awaiting_decision");
    const noConflict = check.pairs.find((item: { status: string }) => item.status === "no_conflict");

    const decided = await decide(id, check.id, { conflictAssessmentId: check.assessments[0].id, pairIds: [noConflict.id], decision: "open_pendency" });
    const response = await decide(id, check.id, { conflictAssessmentId: check.assessments[0].id, pairIds: [pair.id], decision: "dismiss" });
    const again = await decide(id, check.id, { conflictAssessmentId: check.assessments[0].id, pairIds: [pair.id], decision: "open_pendency" });

    expect(decided.statusCode).toBe(409);
    expect(decided.json()).toEqual({ error: "conflict_decided" });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ pendencies: [] });
    expect(again.statusCode).toBe(409);
    const process = await api.getProcess(id);
    expect(process.pendencies).toEqual([]);
    expect(process.conflictChecks.at(-1)).toMatchObject({ status: "decided" });
    expect(process.conflictChecks.at(-1).pairs.find((item: { id: string }) => item.id === pair.id).status).toBe("dismissed");
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });

  it("lets the user open the Pendency, recorded as theirs, and the AI formulates the question", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration(0.6));
    const { id } = await confirmStageRBlock();
    const check = (await api.getProcess(id)).conflictChecks.at(-1);
    const pair = check.pairs.find((item: { status: string }) => item.status === "awaiting_decision");

    const response = await decide(id, check.id, { conflictAssessmentId: check.assessments[0].id, pairIds: [pair.id], decision: "open_pendency" });

    expect(response.statusCode).toBe(201);
    expect(response.json().pendencies).toMatchObject([
      { reason: "conflict", conflict: { pairId: pair.id, openedBy: "user", conflictAssessment: { id: check.assessments[0].id } } },
    ]);
    expect(assistant.resolutionQuestion.attempts).toHaveLength(1);
    expect((await confirmStageR(id)).json()).toEqual({ error: "blocking_pendencies", pendencyIds: [response.json().pendencies[0].id] });
  });

  it("is decided only on the latest Assessment, the one the user saw", async () => {
    assessor.willAssessConflicts(conflictOutcome(), unavailable, deadlineVersusIntegration(0.5));
    const { id } = await confirmStageRBlock();
    const { id: checkId } = (await api.getProcess(id)).conflictChecks.at(-1);
    const retried = await retryConflicts(id, checkId);
    const [failed, latest] = retried.json().conflictCheck.assessments;
    const pair = retried.json().conflictCheck.pairs.find((item: { status: string }) => item.status === "awaiting_decision");

    const response = await decide(id, checkId, { conflictAssessmentId: failed.id, pairIds: [pair.id], decision: "dismiss" });
    const malformed = await decide(id, checkId, { conflictAssessmentId: latest.id, pairIds: [], decision: "dismiss" });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "unknown_assessment" });
    expect(malformed.statusCode).toBe(400);
  });
});

describe("Jev unavailable for the conflict", () => {
  it("is recorded, and the user can try again", async () => {
    assessor.willAssessConflicts(conflictOutcome(), unavailable, deadlineVersusIntegration());
    const { id } = await confirmStageRBlock();
    const check = (await api.getProcess(id)).conflictChecks.at(-1);
    expect(check).toMatchObject({
      status: "assessment_failed",
      assessments: [{ status: "failed", jevModel: null, failureReason: "jev_unavailable", message: unavailable.message, verdicts: [] }],
    });
    expect((await confirmStageR(id)).json()).toEqual({ error: "undecided_conflicts" });

    const retried = await retryConflicts(id, check.id);
    const again = await retryConflicts(id, check.id);

    expect(retried.statusCode).toBe(201);
    expect(retried.json().conflictCheck).toMatchObject({ status: "decided", assessments: [{ status: "failed" }, { status: "completed" }] });
    expect((await api.getProcess(id)).pendencies).toMatchObject([{ reason: "conflict", conflict: { openedBy: "jev" } }]);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "conflict_assessed" });
  });

  it("lets the user go on without it, dismissing the pairs on the failed Assessment", async () => {
    assessor.willAssessConflicts(conflictOutcome(), unavailable);
    const { id } = await confirmStageRBlock();
    const check = (await api.getProcess(id)).conflictChecks.at(-1);

    const response = await decide(id, check.id, {
      conflictAssessmentId: check.assessments[0].id,
      pairIds: check.pairs.map((pair: { id: string }) => pair.id),
      decision: "dismiss",
    });

    expect(response.statusCode).toBe(201);
    expect((await api.getProcess(id)).conflictChecks.at(-1).status).toBe("decided");
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });

  it("lets the user open the Pendency of one pair by hand, linked to the failed Assessment they saw", async () => {
    assessor.willAssessConflicts(conflictOutcome(), unavailable);
    const { id } = await confirmStageRBlock();
    const check = (await api.getProcess(id)).conflictChecks.at(-1);
    const pair = check.pairs.find(isDeadlineAndIntegrationPair);

    const response = await decide(id, check.id, { conflictAssessmentId: check.assessments[0].id, pairIds: [pair.id], decision: "open_pendency" });

    expect(response.statusCode).toBe(201);
    expect(response.json().pendencies).toMatchObject([
      { conflict: { pairId: pair.id, openedBy: "user", conflictAssessment: { status: "failed", failureReason: "jev_unavailable" } } },
    ]);
    // Os outros pares continuam à espera de decisão.
    expect((await api.getProcess(id)).conflictChecks.at(-1).status).toBe("assessment_failed");
  });

  it("is what an Assessor that throws becomes, and the synthesis stays confirmed", async () => {
    assessor.willAssessConflicts(conflictOutcome());
    const { id, block } = await (async () => {
      const original = assessor.assessConflicts.bind(assessor);
      let calls = 0;
      assessor.assessConflicts = async (input) => {
        calls += 1;
        if (calls === 2) throw new Error("conexão recusada");
        return original(input);
      };
      return confirmStageRBlock();
    })();

    expect(block.synthesis).not.toBeNull();
    expect((await api.getProcess(id)).conflictChecks.at(-1)).toMatchObject({
      status: "assessment_failed",
      assessments: [{ failureReason: "jev_error", message: "conexão recusada" }],
    });
  });
});

describe("The resolution question", () => {
  const askAgain = (id: string, pendencyId: string, payload?: Record<string, unknown>) =>
    api.inject({ method: "POST", url: `/api/processes/${id}/pendencies/${pendencyId}/resolution-question/attempts`, ...(payload && { payload }) });

  async function settledQuestion(id: string) {
    let pendency: { id: string; conflict: { resolutionQuestion: { status: string; question: string | null; attempts: { cli: string }[] } } };
    await waitFor(async () => {
      [pendency] = (await api.getProcess(id)).pendencies;
      return pendency.conflict.resolutionQuestion.status !== "running";
    });
    return pendency!;
  }

  it("that failed can be asked again, with the CLI the user chooses; the Pendency stays open meanwhile", async () => {
    assistant.resolutionQuestion.willRespond({ status: "failed", reason: "cli_rate_limited", message: "Limite de uso.", usage: null });
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id } = await confirmStageRBlock();
    const failed = await settledQuestion(id);
    expect(failed.conflict.resolutionQuestion).toMatchObject({ status: "failed", question: null });
    const saved = await api.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { cli: "claude", models: { claude: "sonnet", codex: "gpt-6-astra", grok: null, agy: null }, cloakProfile: { source: "directory" } },
    });
    expect(saved.statusCode).toBe(200);

    const response = await askAgain(id, failed.id, { cli: "codex" });

    expect(response.statusCode).toBe(202);
    const asked = await settledQuestion(id);
    expect(asked.conflict.resolutionQuestion).toMatchObject({ status: "completed", question: defaultResolutionQuestion.question });
    expect(asked.conflict.resolutionQuestion.attempts.map((attempt) => attempt.cli)).toEqual(["claude", "codex"]);
    const again = await askAgain(id, failed.id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "resolution_question_generated" });
  });

  it("is not asked for a resolved Pendency", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id } = await confirmStageRBlock();
    const pendency = await settledQuestion(id);
    await api.inject({ method: "POST", url: `/api/processes/${id}/pendencies/${pendency.id}/clarification`, payload: { clarification: "Mal entendido." } });

    const response = await askAgain(id, pendency.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "pendency_resolved" });
  });
});

describe("A pair whose answer changed", () => {
  it("no longer holds the Stage Confirmation while uncertain: the new Version has its own Assessment", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration(0.5));
    const { id, block } = await confirmStageRBlock();
    const [deadlineQuestion] = block.questions;

    await api.answer(id, deadlineQuestion.id, { text: "Em cinco semanas.", basedOnVersionId: deadlineQuestion.answer.current.id });

    const process = await api.getProcess(id);
    expect(process.conflictChecks.map((check: { status: string }) => check.status)).toEqual(["decided", "decided", "decided"]);
    expect(process.conflictChecks[1].pairs.find((pair: { status: string }) => pair.status === "superseded")).toBeDefined();
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });
});

describe("Reopening the Process with a conflict open", () => {
  it("restores the conflict checks, the Pendencies and the resolution question", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id } = await confirmStageRBlock();
    await waitFor(async () => (await api.getProcess(id)).pendencies[0].conflict.resolutionQuestion.status !== "running");
    const before = await api.getProcess(id);

    await testApp.close();
    testApp = await createTestApp({ assistant, assessor });
    const after = await api.getProcess(id);

    expect(after).toEqual(before);
    expect(after.pendencies[0].conflict.resolutionQuestion.question).toBe(defaultResolutionQuestion.question);
  });
});

describe("A new Version that a Confirmation comes to hold", () => {
  const changedIntegration = "Depende da nova API de artefatos, mas o registro atual serve até ela sair.";

  // Bloco 2 confirmado sem conflito; muda a resposta da integração (Pergunta 2.2).
  async function changeIntegration() {
    const { id, block } = await confirmStageRBlock();
    const question = block.questions[1];
    const response = await api.answer(id, question.id, { text: changedIntegration, basedOnVersionId: question.answer.current.id });
    expect(response.statusCode).toBe(201);
    return { id, block, version: response.json().answerVersion };
  }

  // A última Avaliação de conflito pedida é a da Versão nova, contra as outras respostas confirmadas.
  const assessedNewVersion = () =>
    expect(assessor.conflictInputs.at(-1)!.pairs.map((pair) => [pair.answer.answer, pair.other.ref])).toEqual([
      [changedIntegration, "1.1"],
      [changedIntegration, "1.2"],
      [changedIntegration, "1.3"],
      [changedIntegration, "2.1"],
    ]);

  it("kept by the user has its conflict assessed, and not before", async () => {
    assessor.willAssessImpact(impactOutcome("no", 0.55));
    const { id, block, version } = await changeIntegration();
    expect(assessor.conflictInputs).toHaveLength(2);
    const [impactAssessment] = (await api.getProcess(id)).impactAssessments;

    const response = await api.decideImpact(id, version.id, {
      confirmation: { kind: "block_synthesis", blockId: block.id },
      impactAssessmentId: impactAssessment.id,
      decision: "keep_confirmation",
    });

    expect(response.statusCode).toBe(201);
    expect(assessor.conflictInputs).toHaveLength(3);
    assessedNewVersion();
  });

  it("reconfirmed has its conflict assessed", async () => {
    assessor.willAssessImpact(impactOutcome("yes"));
    const { id } = await changeIntegration();
    expect(assessor.conflictInputs).toHaveLength(2);
    const [pendency] = (await api.getProcess(id)).pendencies;

    const response = await api.reconfirm(id, pendency.id);

    expect(response.statusCode).toBe(200);
    expect(assessor.conflictInputs).toHaveLength(3);
    assessedNewVersion();
  });

  it("held after a new try of the impact Assessment has its conflict assessed", async () => {
    assessor.willAssessImpact({ status: "failed", reason: "jev_unavailable", message: "O Jev não respondeu em 60 s." });
    const { id, block, version } = await changeIntegration();
    expect(assessor.conflictInputs).toHaveLength(2);

    const response = await api.retryImpact(id, version.id, { kind: "block_synthesis", blockId: block.id });

    expect(response.statusCode).toBe(201);
    expect(assessor.conflictInputs).toHaveLength(3);
    assessedNewVersion();
  });
});

describe("A Constraint revision after Stage R", () => {
  const changedIntegration = "Depende da nova API de artefatos, que agora só sai daqui a seis semanas.";
  const note = "O prazo era da primeira versão; a diretoria aceita cinco semanas.";

  // Etapa O atual: a Etapa R foi confirmada com o prazo como Restrição e, sem conflito, com o Bloco 2.
  // Depois, a resposta da integração muda e entra em conflito com o prazo.
  async function conflictInStageO() {
    let constraintId = "";
    const { id, block } = await confirmStageRBlock({
      before: async (processId) => {
        constraintId = (await register(processId, "constraints", "Entregar em duas semanas")).json().constraint.id;
      },
    });
    expect((await confirmStageR(id)).statusCode).toBe(201);
    assessor.willAssessConflicts(deadlineVersusIntegration());
    const question = block.questions[1];
    const changed = await api.answer(id, question.id, { text: changedIntegration, basedOnVersionId: question.answer.current.id });
    expect(changed.statusCode).toBe(201);
    const process = await api.getProcess(id);
    expect(process.currentStage).toBe("O");
    const pendency = process.pendencies.find((item: { reason: string; resolvedAt: string | null }) => item.reason === "conflict" && item.resolvedAt === null);
    expect(pendency).toBeDefined();
    return { id, constraintId, pendency };
  }

  const revise = (id: string, pendencyId: string, constraintId: string) =>
    reviseConstraint(id, pendencyId, { constraintId, replacement: { kind: "constraint", statement: "Entregar em cinco semanas" }, note });

  // Fecha os Pontos da Etapa O, inaplicáveis, acrescenta uma Opção viável e pede a Confirmação dela (sem
  // Ponto coberto a avaliar).
  async function confirmStageO(id: string) {
    const option = await api.inject({ method: "POST", url: `/api/processes/${id}/options`, payload: { statement: "Fazer o deploy à noite" } });
    expect(option.statusCode).toBe(201);
    for (const key of ["eliminate_problem", "simplest_solution", "eighty_twenty", "reversibility"]) {
      await api.declareInapplicable(id, key, { justification: "Fora deste exemplo." });
    }
    return api.confirmStage(id, { stageAssessmentId: null }, "O");
  }

  const retryConstraintImpact = (id: string, revisionId: string) =>
    api.inject({
      method: "POST",
      url: `/api/processes/${id}/constraint-revisions/${revisionId}/impact-assessments`,
      payload: { confirmation: { kind: "stage", stage: "R" } },
    });

  const decideConstraintImpact = (id: string, revisionId: string, payload: Record<string, unknown>) =>
    api.inject({
      method: "POST",
      url: `/api/processes/${id}/constraint-revisions/${revisionId}/impact-decision`,
      payload: { confirmation: { kind: "stage", stage: "R" }, ...payload },
    });

  it("resolves the Pendency of conflict, and the Jev reassesses the Stage Confirmation that held the Constraint", async () => {
    const { id, constraintId, pendency } = await conflictInStageO();
    assessor.willAssessConstraintImpact(impactOutcome("yes"));

    const response = await revise(id, pendency.id, constraintId);

    expect(response.statusCode).toBe(200);
    const revision = response.json().pendency.conflict.constraintRevision;
    expect(revision).toMatchObject({ note, replacement: { kind: "constraint", item: { statement: "Entregar em cinco semanas" } } });
    // Só a Confirmação da Etapa R sustentava a Restrição: a da P veio antes dela, e a O não foi confirmada.
    expect(assessor.constraintImpactInputs).toEqual([
      {
        problemStatement: statement,
        confirmation: expect.objectContaining({ kind: "stage", stage: "R" }),
        revision: {
          constraint: { statement: "Entregar em duas semanas", scope: null, unit: null },
          replacement: { kind: "constraint", item: { statement: "Entregar em cinco semanas", scope: null, unit: null } },
          note,
        },
      },
    ]);
    const process = await api.getProcess(id);
    const [reassessment] = process.constraintReassessments;
    expect(process.constraintReassessments).toEqual([
      {
        confirmation: { kind: "stage", stage: "R" },
        revision,
        status: "pendency_open",
        impactAssessments: [
          expect.objectContaining({
            answerVersionId: null,
            previousAnswerVersionId: null,
            constraintRevisionId: revision.id,
            confirmation: { kind: "stage", stage: "R" },
            choice: "yes",
            needsDecision: false,
            rubricRevision: expect.stringMatching(/^sha256:/),
          }),
        ],
        pendencyId: expect.any(String),
      },
    ]);
    const reassessmentPendency = process.pendencies.find((item: { id: string }) => item.id === reassessment.pendencyId);
    expect(reassessmentPendency).toEqual({
      id: reassessment.pendencyId,
      reason: "reassessment",
      // Sem Pergunta: fica na Confirmação da Etapa.
      question: null,
      stagePoints: [],
      openedAt: expect.any(String),
      resolvedAt: null,
      resolvedByAnswerVersionId: null,
      resolution: null,
      reassessment: {
        answerVersionId: null,
        previousAnswerVersionId: null,
        constraintRevisionId: revision.id,
        confirmation: { kind: "stage", stage: "R" },
        openedBy: "jev",
        impactAssessment: reassessment.impactAssessments[0],
      },
      conflict: null,
    });

    // Bloqueia a Confirmação da Etapa atual até o usuário reconfirmar a Etapa R com a revisão.
    const blocked = await confirmStageO(id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: "blocking_pendencies", pendencyIds: [reassessment.pendencyId] });
    const reconfirmed = await api.reconfirm(id, reassessment.pendencyId);
    expect(reconfirmed.statusCode).toBe(200);
    expect(reconfirmed.json().pendency).toMatchObject({ resolution: "reconfirmed", resolvedAt: expect.any(String) });
    expect((await api.getProcess(id)).constraintReassessments).toEqual([]);
    expect((await confirmStageO(id)).statusCode).toBe(201);
  });

  it("with a confident `no`, has the Stage Confirmation hold the revision: nothing to review", async () => {
    const { id, constraintId, pendency } = await conflictInStageO();

    await revise(id, pendency.id, constraintId);

    const process = await api.getProcess(id);
    expect(process.constraintReassessments).toEqual([]);
    expect(process.impactAssessments.at(-1)).toMatchObject({ constraintRevisionId: expect.any(String), choice: "no", needsDecision: false });
    expect(process.pendencies.filter((item: { resolvedAt: string | null }) => item.resolvedAt === null)).toEqual([]);
    expect((await confirmStageO(id)).statusCode).toBe(201);
  });

  it("with the Jev unavailable and then uncertain, holds the Stage Confirmation until the user keeps it", async () => {
    const { id, constraintId, pendency } = await conflictInStageO();
    assessor.willAssessConstraintImpact(unavailable, impactOutcome("yes", 0.5));

    const revised = await revise(id, pendency.id, constraintId);
    const revisionId = revised.json().pendency.conflict.constraintRevision.id;

    expect((await api.getProcess(id)).constraintReassessments).toMatchObject([{ status: "assessment_failed" }]);
    const retried = await retryConstraintImpact(id, revisionId);
    expect(retried.statusCode).toBe(201);
    expect(retried.json().impactAssessment).toMatchObject({ choice: "yes", confidence: 0.5, needsDecision: true });
    const [reassessment] = (await api.getProcess(id)).constraintReassessments;
    expect(reassessment).toMatchObject({ status: "awaiting_decision", pendencyId: null });
    const blocked = await confirmStageO(id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: "undecided_reassessments" });

    const stale = await decideConstraintImpact(id, revisionId, {
      impactAssessmentId: reassessment.impactAssessments[0].id,
      decision: "keep_confirmation",
    });
    const kept = await decideConstraintImpact(id, revisionId, {
      impactAssessmentId: reassessment.impactAssessments[1].id,
      decision: "keep_confirmation",
    });

    expect(stale.statusCode).toBe(422);
    expect(stale.json()).toEqual({ error: "unknown_assessment" });
    expect(kept.statusCode).toBe(201);
    expect(kept.json()).toEqual({ pendency: null });
    expect((await api.getProcess(id)).constraintReassessments).toEqual([]);
    expect((await confirmStageO(id)).statusCode).toBe(201);
  });

  it("reassesses a chained revision once the Stage Confirmation holds the one before it", async () => {
    const { id, constraintId, pendency } = await conflictInStageO();
    assessor.willAssessConstraintImpact(impactOutcome("yes"));
    const first = (await revise(id, pendency.id, constraintId)).json().pendency.conflict.constraintRevision;
    const [{ pendencyId }] = (await api.getProcess(id)).constraintReassessments;

    // A integração muda de novo e volta a conflitar; a Restrição que substituiu o prazo é revista também.
    assessor.willAssessConflicts(deadlineVersusIntegration());
    const question = (await api.getProcess(id)).blocks[1].questions[1];
    await api.answer(id, question.id, { text: "Depende da nova API, que agora sai em oito semanas.", basedOnVersionId: question.answer.current.id });
    const conflictPendency = (await api.getProcess(id)).pendencies.find(
      (item: { reason: string; resolvedAt: string | null }) => item.reason === "conflict" && item.resolvedAt === null,
    );
    const second = await reviseConstraint(id, conflictPendency.id, {
      constraintId: first.replacement.item.id,
      replacement: { kind: "constraint", statement: "Entregar em oito semanas" },
      note: null,
    });
    expect(second.statusCode).toBe(200);
    // A Etapa R ainda sustenta a Restrição original: a segunda revisão espera a primeira.
    expect(assessor.constraintImpactInputs).toHaveLength(1);

    expect((await api.reconfirm(id, pendencyId)).statusCode).toBe(200);

    expect(assessor.constraintImpactInputs).toHaveLength(2);
    expect(assessor.constraintImpactInputs[1]!.revision.constraint.statement).toBe("Entregar em cinco semanas");
    expect((await api.getProcess(id)).constraintReassessments).toEqual([]);
    expect((await confirmStageO(id)).statusCode).toBe(201);
  });

  it("lets the user open the Pendency of reassessment when the Jev is uncertain", async () => {
    const { id, constraintId, pendency } = await conflictInStageO();
    assessor.willAssessConstraintImpact(impactOutcome("no", 0.55));
    const revisionId = (await revise(id, pendency.id, constraintId)).json().pendency.conflict.constraintRevision.id;
    const [reassessment] = (await api.getProcess(id)).constraintReassessments;

    const opened = await decideConstraintImpact(id, revisionId, {
      impactAssessmentId: reassessment.impactAssessments[0].id,
      decision: "open_pendency",
    });

    expect(opened.statusCode).toBe(201);
    expect(opened.json().pendency).toMatchObject({
      reason: "reassessment",
      question: null,
      reassessment: { constraintRevisionId: revisionId, openedBy: "user", confirmation: { kind: "stage", stage: "R" } },
    });
    expect((await api.getProcess(id)).constraintReassessments).toMatchObject([{ status: "pendency_open", pendencyId: opened.json().pendency.id }]);
  });
});

describe("A clarification of the user", () => {
  it("goes as context to the next conflict Assessments and resolution questions, with the answers as they were", async () => {
    assessor.willAssessConflicts(conflictOutcome(), deadlineVersusIntegration());
    const { id, block } = await confirmStageRBlock();
    const [pendency] = (await api.getProcess(id)).pendencies;
    const text = "Há uma alternativa provisória: publicar pelo registro atual até a nova API ficar pronta.";
    expect((await clarify(id, pendency.id, { clarification: text })).statusCode).toBe(200);

    // A integração muda e volta a conflitar com o prazo: o Jev e a IA recebem o esclarecimento.
    assessor.willAssessConflicts(deadlineVersusIntegration());
    const question = block.questions[1];
    const changed = "Depende da nova API de artefatos, prevista para daqui a seis semanas.";
    await api.answer(id, question.id, { text: changed, basedOnVersionId: question.answer.current.id });

    const clarification = {
      answers: [
        { ref: "2.1", stage: "R", wording: block.questions[0].wording, answer: deadline },
        { ref: "2.2", stage: "R", wording: question.wording, answer: integration },
      ],
      clarification: text,
    };
    expect(assessor.conflictInputs.at(-1)!.clarifications).toEqual([clarification]);
    expect(assistant.resolutionQuestion.attempts.at(-1)!.input).toMatchObject({
      answers: [expect.objectContaining({ answer: changed }), expect.objectContaining({ answer: deadline })],
      clarifications: [clarification],
    });
  });
});

describe("A standalone Constraint revision", () => {
  const reviseStandalone = (id: string, constraintId: string, payload: Record<string, unknown>) =>
    api.inject({ method: "POST", url: `/api/processes/${id}/constraints/${constraintId}/revision`, payload });

  // Etapa O atual, com a Etapa R confirmada com o prazo como Restrição e sem conflito.
  async function stageOWithDeadline() {
    let constraintId = "";
    const { id } = await confirmStageRBlock({
      before: async (processId) => {
        constraintId = (await register(processId, "constraints", "Entregar em duas semanas")).json().constraint.id;
      },
    });
    expect((await confirmStageR(id)).statusCode).toBe(201);
    return { id, constraintId };
  }

  it("revises a Constraint in a later Stage, without a conflict, with history and reassessment", async () => {
    const { id, constraintId } = await stageOWithDeadline();
    assessor.willAssessConstraintImpact(impactOutcome("yes"));

    const response = await reviseStandalone(id, constraintId, {
      replacement: { kind: "preference", statement: "Entregar em duas semanas", scope: "Primeira versão" },
      note: " A diretoria aceita mais prazo. ",
    });

    expect(response.statusCode).toBe(201);
    const process = await api.getProcess(id);
    const [preference] = process.preferences;
    expect(response.json().constraintRevision).toEqual({
      id: expect.any(String),
      constraint: expect.objectContaining({ id: constraintId, withdrawnAt: expect.any(String) }),
      replacement: { kind: "preference", item: preference },
      note: "A diretoria aceita mais prazo.",
      conflictPendencyId: null,
      revisedAt: expect.any(String),
    });
    expect(assessor.constraintImpactInputs).toEqual([
      expect.objectContaining({ confirmation: expect.objectContaining({ kind: "stage", stage: "R" }) }),
    ]);
    expect(process.constraintReassessments).toMatchObject([
      { confirmation: { kind: "stage", stage: "R" }, revision: { id: response.json().constraintRevision.id }, status: "pendency_open" },
    ]);
  });

  it("refuses a Constraint not in force, unknown or a malformed revision, recording nothing; registering stays in Stage R", async () => {
    const { id, constraintId } = await stageOWithDeadline();

    const unknown = await reviseStandalone(id, "00000000-0000-4000-8000-000000000000", { replacement: null, note: null });
    const malformed = await reviseStandalone(id, constraintId, { replacement: { kind: "desejo", statement: "Cinco semanas" } });
    const registered = await register(id, "constraints", "Sem downtime");
    const revised = await reviseStandalone(id, constraintId, { replacement: null, note: null });
    const again = await reviseStandalone(id, constraintId, { replacement: null, note: null });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "constraint_not_found" });
    expect(malformed.statusCode).toBe(400);
    expect(registered.statusCode).toBe(409);
    expect(registered.json()).toEqual({ error: "stage_not_current" });
    expect(revised.statusCode).toBe(201);
    expect(revised.json().constraintRevision).toMatchObject({ replacement: null, note: null });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "already_withdrawn" });
    const process = await api.getProcess(id);
    expect(process.constraints).toHaveLength(1);
    expect(process.preferences).toEqual([]);
  });

  it("is refused while Stage R is the current one, where registering and withdrawing stay as they were", async () => {
    let constraintId = "";
    const { id } = await confirmStageRBlock({
      before: async (processId) => {
        constraintId = (await register(processId, "constraints", "Entregar em duas semanas")).json().constraint.id;
      },
    });

    const response = await reviseStandalone(id, constraintId, { replacement: null, note: null });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stage_not_current" });
    const process = await api.getProcess(id);
    expect(process.constraints).toEqual([expect.objectContaining({ id: constraintId, withdrawnAt: null })]);
    expect(process.constraintRevisions).toEqual([]);
  });

  it("without a replacement, has the Stage Confirmation stop holding the Constraint once reconfirmed, and stays in the history", async () => {
    const { id, constraintId } = await stageOWithDeadline();
    assessor.willAssessConstraintImpact(impactOutcome("yes"));

    const revision = (await reviseStandalone(id, constraintId, { replacement: null, note: "Não há mais prazo." })).json().constraintRevision;

    expect(assessor.constraintImpactInputs.map((input) => input.revision)).toEqual([
      { constraint: { statement: "Entregar em duas semanas", scope: null, unit: null }, replacement: null, note: "Não há mais prazo." },
    ]);
    const [reassessment] = (await api.getProcess(id)).constraintReassessments;
    expect((await api.reconfirm(id, reassessment.pendencyId)).statusCode).toBe(200);
    const process = await api.getProcess(id);
    expect(process.constraintReassessments).toEqual([]);
    // A revisão continua consultável depois que a reavaliação se resolve.
    expect(process.constraintRevisions).toEqual([revision]);
  });

  describe("in a chain (the replacement revised again)", () => {
    // A → B e, antes de a Etapa R sustentar B, B → C.
    async function chain(firstOutcomes: Parameters<FakeAssessor["willAssessConstraintImpact"]>) {
      const { id, constraintId } = await stageOWithDeadline();
      assessor.willAssessConstraintImpact(...firstOutcomes);
      const first = (
        await reviseStandalone(id, constraintId, { replacement: { kind: "constraint", statement: "Entregar em cinco semanas" }, note: null })
      ).json().constraintRevision;
      const second = (
        await reviseStandalone(id, first.replacement.item.id, { replacement: { kind: "constraint", statement: "Entregar em oito semanas" }, note: null })
      ).json().constraintRevision;
      // A Etapa R ainda sustenta A: a segunda revisão espera a primeira.
      expect(assessor.constraintImpactInputs).toHaveLength(1);
      const [reassessment] = (await api.getProcess(id)).constraintReassessments;
      return { id, first, second, reassessment };
    }

    const assessedSecond = () =>
      expect(assessor.constraintImpactInputs.map((input) => input.revision.constraint.statement)).toEqual([
        "Entregar em duas semanas",
        "Entregar em duas semanas",
        "Entregar em cinco semanas",
      ]);

    it("advances when a new try of the first gets a confident `no`", async () => {
      const { id, first, second } = await chain([unavailable, impactOutcome("no"), impactOutcome("yes")]);

      const retried = await api.inject({
        method: "POST",
        url: `/api/processes/${id}/constraint-revisions/${first.id}/impact-assessments`,
        payload: { confirmation: { kind: "stage", stage: "R" } },
      });

      expect(retried.statusCode).toBe(201);
      assessedSecond();
      expect((await api.getProcess(id)).constraintReassessments).toMatchObject([{ revision: { id: second.id }, status: "pendency_open" }]);
    });

    it("advances when the user keeps the Confirmation on the first", async () => {
      const { id, first, reassessment } = await chain([impactOutcome("yes", 0.5)]);

      const kept = await api.inject({
        method: "POST",
        url: `/api/processes/${id}/constraint-revisions/${first.id}/impact-decision`,
        payload: { confirmation: { kind: "stage", stage: "R" }, impactAssessmentId: reassessment.impactAssessments[0].id, decision: "keep_confirmation" },
      });

      expect(kept.statusCode).toBe(201);
      expect(assessor.constraintImpactInputs.map((input) => input.revision.constraint.statement)).toEqual([
        "Entregar em duas semanas",
        "Entregar em cinco semanas",
      ]);
      // Sem impacto na segunda, nada fica em revisão, e o histórico guarda as duas.
      const process = await api.getProcess(id);
      expect(process.constraintReassessments).toEqual([]);
      expect(process.constraintRevisions).toHaveLength(2);
    });
  });
});
