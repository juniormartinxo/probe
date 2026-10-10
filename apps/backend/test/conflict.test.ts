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
          note: null,
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

describe("Resolving the Pendency of conflict", () => {
  const reviseConstraint = (id: string, pendencyId: string, payload: Record<string, unknown>) =>
    api.inject({ method: "POST", url: `/api/processes/${id}/pendencies/${pendencyId}/constraint-revision`, payload });

  const clarify = (id: string, pendencyId: string, payload: Record<string, unknown>) =>
    api.inject({ method: "POST", url: `/api/processes/${id}/pendencies/${pendencyId}/clarification`, payload });

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
        note: "A data foi um desejo da diretoria, não um limite.",
        constraintRevision: { revisedConstraintId: constraintId, replacement: { kind: "preference", id: preference.id } },
      },
    });
    expect(process.pendencies).toEqual([response.json().pendency]);
    expect((await confirmStageR(id)).statusCode).toBe(201);
  });

  it("by revising a Constraint, only one in force, while Stage R is the current one", async () => {
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
      conflict: { note: text, answers: [expect.objectContaining({ answer: deadline }), expect.objectContaining({ answer: integration })] },
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
