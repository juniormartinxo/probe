import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratedBlock, GeneratedRecommendation, GeneratedSynthesis } from "../src/modules/ai/assistant.ts";
import { FakeAssessor, conflictOutcome, impactOutcome, verdict } from "./support/fake-assessor.ts";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
import { cache, costConstraint, planB, processApi, runner } from "./support/process-api.ts";
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

const reconsider = (id: string) => api.inject({ method: "POST", url: `/api/processes/${id}/reconsiderations` });

const finalReview = async (id: string) => {
  const response = await api.inject({ method: "GET", url: `/api/processes/${id}/final-review` });
  expect(response.statusCode).toBe(200);
  return response.json().finalReview;
};

const finalize = (id: string, fingerprint: string) =>
  api.inject({ method: "POST", url: `/api/processes/${id}/finalization`, payload: { fingerprint } });

const frozenReport = async (id: string) => {
  const response = await api.inject({ method: "GET", url: `/api/processes/${id}/finalization` });
  expect(response.statusCode).toBe(200);
  return response.json().finalization;
};

// A Pergunta 1.1 da Etapa P, com a Versão que vale.
async function firstQuestionOfP(id: string) {
  const question = (await api.getProcess(id)).blocks[0].questions[0];
  return { questionId: question.id as string, versionId: question.answer.current.id as string };
}

// Processo finalizado com história: a resposta 1.1 mudou sem impacto, segundo o Jev, e o plano B foi
// reescrito depois da Confirmação da Etapa E.
async function finalizedOrigin() {
  const ids = await api.processInStageE();
  await api.recordPlan(ids.id);
  const { questionId, versionId } = await firstQuestionOfP(ids.id);
  expect((await api.answer(ids.id, questionId, { selectedChoices: [1], basedOnVersionId: versionId })).statusCode).toBe(201);
  expect((await api.confirmStage(ids.id, { stageAssessmentId: null }, "E")).statusCode).toBe(201);
  expect((await api.recordElement(ids.id, "plan_b", { text: "Voltar ao deploy manual." })).statusCode).toBe(201);
  const { fingerprint } = await finalReview(ids.id);
  expect((await finalize(ids.id, fingerprint)).statusCode).toBe(201);
  return ids;
}

// Bloco da Etapa R com um prazo de duas semanas e uma integração que só fica disponível em um mês.
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

const stageRSynthesis: GeneratedSynthesis = {
  synthesis: "O deploy precisa ficar mais rápido em duas semanas e depende da nova API de artefatos.",
  coverage: [
    { stagePoint: "deadline", covered: true, reason: "Duas semanas." },
    { stagePoint: "systems_and_apis", covered: true, reason: "A nova API de artefatos." },
    { stagePoint: "constraints_vs_preferences", covered: false, reason: "Não foi dito." },
  ],
  ambiguousAnswers: [],
};

const recommendation: GeneratedRecommendation = {
  comparisons: [
    { option: "O1", gains: "Deploy em 15 minutos.", losses: "Custo maior.", effort: "Baixo.", scalability: "Boa.", maintenance: "Nenhuma.", reversibility: "Total." },
    { option: "O2", gains: "Deploy em 25 minutos.", losses: "Cache velho.", effort: "Médio.", scalability: "Limitada.", maintenance: "Invalidar o cache.", reversibility: "Total." },
  ],
  recommendedOption: "O2",
  rationale: "O cache cumpre a Restrição de custo.",
};

// Processo finalizado que passou por quase tudo: enunciado proposto pela IA, conflito entre prazo e
// integração resolvido por uma Revisão de Restrição (com a pergunta de resolução da IA), Avaliações de
// cobertura, viabilidade das Opções, Recomendação com a linha aceita e plano avaliado.
async function finalizedOriginWithEverything() {
  const id = await api.createProcess();
  expect((await api.inject({ method: "POST", url: `/api/processes/${id}/problem-statement/refinement` })).statusCode).toBe(202);
  let refinement: { proposal: { id: string; statement: string } | null; status: string };
  await waitFor(async () => {
    refinement = (await api.getProcess(id)).refinement;
    return refinement.status !== "running";
  });
  const { proposal } = refinement!;
  const confirmed = await api.inject({
    method: "POST",
    url: `/api/processes/${id}/problem-statement/confirmation`,
    payload: { statement: proposal!.statement, proposalId: proposal!.id },
  });
  expect(confirmed.statusCode).toBe(201);

  // Etapa P, com a Avaliação de cobertura; a primeira Avaliação de conflito é a das respostas de P.
  assessor.willAssessConflicts(conflictOutcome(), conflictOutcome((pair) => ([pair.answer.ref, pair.other.ref].toSorted().join() === "2.1,2.2" ? verdict("yes") : undefined)));
  const blockP = await api.generateBlock(id);
  await api.answerAll(id, blockP);
  const synthesisP = await api.synthesize(id, blockP.id);
  await api.confirmSynthesis(id, blockP.id, { proposalId: synthesisP.id, synthesis: synthesisP.synthesis, coveredStagePoints: ["real_problem", "consequence"] });
  await api.declareInapplicable(id, "urgency", { justification: "Não há pressa." });
  expect((await api.confirmStage(id, { stageAssessmentId: (await api.assess(id)).id })).statusCode).toBe(201);

  // Etapa R: o prazo como Restrição entra em conflito com a integração e vira Preferência.
  const deadline = (await api.inject({ method: "POST", url: `/api/processes/${id}/constraints`, payload: { statement: "Entregar em duas semanas" } })).json();
  await api.inject({ method: "POST", url: `/api/processes/${id}/constraints`, payload: { statement: costConstraint } });
  assistant.block.willRespond(completed(stageRBlock));
  const blockR = await api.generateBlock(id);
  await api.answer(id, blockR.questions[0].id, { text: "Em duas semanas.", basedOnVersionId: null });
  await api.answer(id, blockR.questions[1].id, { text: "Depende da nova API de artefatos, disponível em um mês.", basedOnVersionId: null });
  assistant.synthesis.willRespond(completed(stageRSynthesis));
  const synthesisR = await api.synthesize(id, blockR.id);
  await api.confirmSynthesis(id, blockR.id, { proposalId: synthesisR.id, synthesis: synthesisR.synthesis, coveredStagePoints: ["deadline", "systems_and_apis"] });
  let pendency: { id: string; conflict: { resolutionQuestion: { status: string } } };
  await waitFor(async () => {
    [pendency] = (await api.getProcess(id)).pendencies;
    return pendency !== undefined && pendency.conflict.resolutionQuestion.status !== "running";
  });
  const revised = await api.inject({
    method: "POST",
    url: `/api/processes/${id}/pendencies/${pendency!.id}/constraint-revision`,
    payload: { constraintId: deadline.constraint.id, replacement: { kind: "preference", statement: "Entregar em duas semanas" }, note: "Era um desejo." },
  });
  expect(revised.statusCode).toBe(200);
  await api.declareInapplicable(id, "constraints_vs_preferences", { justification: "Já registradas." });
  expect((await api.confirmStage(id, { stageAssessmentId: (await api.assess(id, "R")).id }, "R")).statusCode).toBe(201);

  // Etapas O e B: duas Opções viáveis, a Recomendação da IA e a linha dela aceita para o cache.
  const runnerId = (await api.addOption(id, { statement: runner })).json().option.id as string;
  const cacheId = (await api.addOption(id, { statement: cache })).json().option.id as string;
  expect((await api.confirmStageO(id)).statusCode).toBe(201);
  for (const key of ["gains_and_losses", "scalability", "maintenance"]) await api.declareInapplicable(id, key, { justification: "Fora deste exemplo." });
  assistant.recommendation.willRespond(completed(recommendation));
  expect((await api.inject({ method: "POST", url: `/api/processes/${id}/recommendations` })).statusCode).toBe(202);
  let recommendations: { id: string; status: string }[];
  await waitFor(async () => {
    recommendations = (await api.getProcess(id)).recommendations;
    return recommendations.at(-1)!.status !== "running";
  });
  const { option: _, ...suggested } = recommendation.comparisons[1]!;
  const comparison = await api.inject({
    method: "POST",
    url: `/api/processes/${id}/options/${cacheId}/comparisons`,
    payload: { ...suggested, recommendationId: recommendations!.at(-1)!.id },
  });
  expect(comparison.statusCode).toBe(201);
  expect((await api.choose(id, { optionId: cacheId, discards: [{ optionId: runnerId, reason: "Mais caro." }] })).statusCode).toBe(201);
  expect((await api.confirmStage(id, { stageAssessmentId: null }, "B")).statusCode).toBe(201);

  // Etapa E e Finalização.
  await api.recordPlan(id);
  expect((await api.confirmStage(id, { stageAssessmentId: null }, "E")).statusCode).toBe(201);
  const review = await finalReview(id);
  expect(review.blockers).toEqual([]);
  expect((await finalize(id, review.fingerprint)).statusCode).toBe(201);
  return { id };
}

// Uma Reconsideração recém-criada da origem dada.
async function reconsideration(originId: string) {
  const response = await reconsider(originId);
  expect(response.statusCode).toBe(201);
  return response.json().process;
}

// Os ids que aparecem em qualquer ponto do detalhe do Processo.
function idsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) found.add(value);
  else if (Array.isArray(value)) for (const item of value) idsIn(item, found);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) idsIn(item, found);
  return found;
}

describe("Creating a Reconsideration", () => {
  it("opens a new Process that inherits the context, the valid Versions and the Confirmations of the origin", async () => {
    const { id: originId } = await finalizedOrigin();
    const origin = await api.getProcess(originId);

    const process = await reconsideration(originId);

    expect(process.id).not.toBe(originId);
    expect(process.status).toBe("open");
    expect(process.finalizedAt).toBeNull();
    expect(process.originalDescription).toBe(origin.originalDescription);
    expect(process.problemStatement).toEqual(origin.problemStatement);
    expect(process.currentStage).toBe("E");
    expect(process.readyForFinalReview).toBe(true);
    expect(process.stageConfirmations.map((confirmation: { stage: string }) => confirmation.stage)).toEqual(["P", "R", "O", "B", "E"]);
    const answers = (detail: typeof origin) =>
      detail.blocks.flatMap((block: { questions: { wording: string; answer: { current: { selectedChoices: number[]; text: string; confirmed: boolean } } }[] }) =>
        block.questions.map(({ wording, answer }) => [wording, answer.current.selectedChoices, answer.current.text, answer.current.confirmed]),
      );
    expect(answers(process)).toEqual(answers(origin));
    expect(process.pendencies).toEqual([]);
    expect(process.reassessments).toEqual([]);
  });

  it("identifies the origin and starts with nothing changed", async () => {
    const { id: originId } = await finalizedOrigin();
    const origin = await api.getProcess(originId);

    const process = await reconsideration(originId);

    expect(process.derivation).toEqual({ kind: "reconsideration", originProcessId: originId, originFinalizedAt: origin.finalizedAt, changes: [] });
    expect(origin.derivation).toBeNull();
    const listed = (await api.inject({ method: "GET", url: "/api/processes" })).json().processes;
    expect(listed.find((item: { id: string }) => item.id === process.id)).toMatchObject({
      derivation: { kind: "reconsideration", originProcessId: originId },
    });
    expect(listed.find((item: { id: string }) => item.id === originId)).toMatchObject({ derivation: null });
  });

  it("copies the content instead of referencing the origin's", async () => {
    const { id: originId } = await finalizedOrigin();
    const origin = await api.getProcess(originId);

    const process = await reconsideration(originId);

    // Nada do Processo novo aponta para registros da origem; só a identificação dela.
    const { derivation: _, ...copied } = process;
    const shared = [...idsIn(copied)].filter((id) => idsIn(origin).has(id));
    expect(shared).toEqual([]);
  });

  it("presents in the final review the report the origin froze, now with the origin", async () => {
    const { id: originId } = await finalizedOrigin();
    const { report: frozen } = await frozenReport(originId);

    const process = await reconsideration(originId);

    const { report, blockers } = await finalReview(process.id);
    expect(blockers).toEqual([]);
    const { identification, ...content } = report;
    const { identification: originIdentification, ...originContent } = frozen;
    expect(content).toEqual(originContent);
    expect(identification).toEqual({
      processId: process.id,
      createdAt: process.createdAt,
      finalizedAt: null,
      origin: { kind: "reconsideration", processId: originId, finalizedAt: originIdentification.finalizedAt, changes: [] },
    });
  });

  it("copies a Process with its whole history: conflicts, Constraint revisions, Recommendations and AI requests", async () => {
    const { id: originId } = await finalizedOriginWithEverything();
    const { report: frozen } = await frozenReport(originId);
    const origin = await api.getProcess(originId);

    const process = await reconsideration(originId);

    const { identification: _, ...content } = (await finalReview(process.id)).report;
    const { identification: __, ...originContent } = frozen;
    expect(content).toEqual(originContent);
    expect(content.recommendations).toHaveLength(1);
    expect(process.problemStatement).toMatchObject({ origin: "proposal" });
    expect(process.constraintRevisions).toHaveLength(1);
    expect(process.pendencies.map(({ reason, resolution }: { reason: string; resolution: string }) => [reason, resolution])).toEqual([["conflict", "constraint_revised"]]);
    expect(process.recommendations[0].recommendation.option.id).toBe(process.options.find((option: { statement: string }) => option.statement === cache).id);
    const { derivation: ___, ...copied } = process;
    expect([...idsIn(copied)].filter((id) => idsIn(origin).has(id))).toEqual([]);
  });

  it("is refused for a Process that is not finalized", async () => {
    const { id } = await api.processInStageE();

    const response = await reconsider(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "process_not_finalized" });
  });

  it("is refused for a Process that does not exist", async () => {
    const response = await reconsider("00000000-0000-4000-8000-000000000000");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "process_not_found" });
  });
});

describe("The origin of a Reconsideration", () => {
  it("stays intact and read-only while the Reconsideration changes", async () => {
    const { id: originId } = await finalizedOrigin();
    const before = await api.getProcess(originId);
    const frozenBefore = await frozenReport(originId);
    const process = await reconsideration(originId);
    const { questionId, versionId } = await firstQuestionOfP(process.id);

    assessor.willAssessImpact(impactOutcome("yes"));
    expect((await api.answer(process.id, questionId, { selectedChoices: [0], basedOnVersionId: versionId })).statusCode).toBe(201);
    expect((await api.recordElement(process.id, "first_step", { text: "Medir o tempo de cada passo do deploy." })).statusCode).toBe(201);

    expect(await api.getProcess(originId)).toEqual(before);
    expect(await frozenReport(originId)).toEqual(frozenBefore);
    const origin = await firstQuestionOfP(originId);
    const write = await api.answer(originId, origin.questionId, { selectedChoices: [0], basedOnVersionId: origin.versionId });
    expect(write.statusCode).toBe(409);
    expect(write.json()).toEqual({ error: "process_not_open" });
  });
});

describe("Changing a Reconsideration", () => {
  it("keeps the inherited Confirmations until a change, which goes through the impact assessment and opens a reassessment Pendency", async () => {
    const { id: originId } = await finalizedOrigin();
    const process = await reconsideration(originId);
    const { questionId, versionId } = await firstQuestionOfP(process.id);
    const assessedBefore = assessor.impactInputs.length;

    assessor.willAssessImpact(impactOutcome("yes"));
    const changed = await api.answer(process.id, questionId, { selectedChoices: [0], basedOnVersionId: versionId });

    expect(changed.statusCode).toBe(201);
    // A síntese do Bloco herdada sustentava a Versão superada: o Jev avalia o impacto sobre ela.
    expect(assessor.impactInputs.length).toBeGreaterThan(assessedBefore);
    const after = await api.getProcess(process.id);
    expect(after.pendencies).toEqual([expect.objectContaining({ reason: "reassessment", question: expect.objectContaining({ id: questionId }) })]);
    const { blockers } = await finalReview(process.id);
    expect(blockers).toEqual([{ reason: "blocking_pendencies", pendencyIds: [after.pendencies[0].id] }]);
    // As outras respostas continuam confirmadas, como vieram da origem.
    const others = after.blocks[0].questions.slice(1);
    expect(others.every((question: { answer: { current: { confirmed: boolean } } }) => question.answer.current.confirmed)).toBe(true);
  });

  it("records what changed from the origin", async () => {
    const { id: originId, runnerId, cacheId } = await finalizedOrigin();
    const process = await reconsideration(originId);
    const { questionId, versionId } = await firstQuestionOfP(process.id);
    const options = (await api.getProcess(process.id)).options;
    const copyOf = (originOptionId: string, statement: string) => {
      expect(originOptionId).not.toBe(options.find((option: { statement: string }) => option.statement === statement).id);
      return options.find((option: { statement: string }) => option.statement === statement).id as string;
    };

    expect((await api.answer(process.id, questionId, { selectedChoices: [0], basedOnVersionId: versionId })).statusCode).toBe(201);
    const choice = await api.choose(process.id, { optionId: copyOf(runnerId, runner), discards: [{ optionId: copyOf(cacheId, cache), reason: "Não resolveu." }] });
    expect(choice.statusCode).toBe(201);
    expect((await api.recordElement(process.id, "plan_b", { text: planB })).statusCode).toBe(201);
    const cost = (await api.getProcess(process.id)).constraints.find((item: { statement: string }) => item.statement === costConstraint);
    const revised = await api.reviseConstraint(process.id, cost.id, { kind: "preference", statement: "Gastar pouco com infraestrutura" });
    expect(revised.statusCode).toBe(201);

    const { derivation } = await api.getProcess(process.id);
    expect(derivation.changes).toEqual([
      {
        kind: "answer",
        subject: "P 1.1: A demora do deploy é o problema em si ou sintoma de outra coisa?",
        before: "A demora é sintoma de outra coisa",
        after: "A demora é o problema em si",
      },
      { kind: "constraint", subject: "Restrição", before: costConstraint, after: null },
      { kind: "preference", subject: "Preferência", before: null, after: "Gastar pouco com infraestrutura" },
      { kind: "choice", subject: "Escolha", before: cache, after: runner },
      { kind: "plan_element", subject: "Plano B", before: "Voltar ao deploy manual.", after: planB },
    ]);
  });
});

describe("Finalizing a Reconsideration", () => {
  it("follows the rules of any Process, and the report carries the origin and what changed", async () => {
    const { id: originId } = await finalizedOrigin();
    const { finalizedAt: originFinalizedAt } = await frozenReport(originId);
    const process = await reconsideration(originId);
    const { questionId, versionId } = await firstQuestionOfP(process.id);
    assessor.willAssessImpact(impactOutcome("yes"));
    expect((await api.answer(process.id, questionId, { selectedChoices: [0], basedOnVersionId: versionId })).statusCode).toBe(201);
    const [pendency] = (await api.getProcess(process.id)).pendencies;

    const refused = await finalize(process.id, (await finalReview(process.id)).fingerprint);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "blocking_pendencies", pendencyIds: [pendency.id] });

    expect((await api.reconfirm(process.id, pendency.id)).statusCode).toBe(200);
    const review = await finalReview(process.id);
    expect(review.blockers).toEqual([]);
    const finalized = await finalize(process.id, review.fingerprint);

    expect(finalized.statusCode).toBe(201);
    const { report } = finalized.json().finalization;
    const change = {
      kind: "answer",
      subject: "P 1.1: A demora do deploy é o problema em si ou sintoma de outra coisa?",
      before: "A demora é sintoma de outra coisa",
      after: "A demora é o problema em si",
    };
    expect(report.identification.origin).toEqual({ kind: "reconsideration", processId: originId, finalizedAt: originFinalizedAt, changes: [change] });
    expect((await api.getProcess(process.id)).status).toBe("finalized");
    const markdown = await api.inject({ method: "GET", url: `/api/processes/${process.id}/report.md` });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain(`Reconsideração do Processo ${originId}`);
    expect(markdown.body).toContain("A demora é sintoma de outra coisa → A demora é o problema em si");
  });

  it("can itself be reconsidered", async () => {
    const { id: originId } = await finalizedOrigin();
    const first = await reconsideration(originId);
    expect((await finalize(first.id, (await finalReview(first.id)).fingerprint)).statusCode).toBe(201);

    const second = await reconsideration(first.id);

    expect(second.derivation).toMatchObject({ kind: "reconsideration", originProcessId: first.id });
    expect((await finalReview(second.id)).blockers).toEqual([]);
  });
});
