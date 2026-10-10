import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ConflictInput, ConstraintImpactInput, CoverageInput, ImpactInput } from "../src/modules/assessments/assessor.ts";
import { createJevAssessor } from "../src/modules/assessments/jev-assessor.ts";
import { stagePointsOf } from "../src/modules/process/stage-points.ts";

const API_KEY = "chave-de-teste-do-jev";

type Handler = (request: FastifyRequest, reply: FastifyReply) => unknown;

let jev: FastifyInstance | undefined;

afterEach(async () => {
  await jev?.close();
  jev = undefined;
});

// Jev falso, no contrato HTTP da API real: POST /v1/systemone devolve as respostas por chave.
async function startJev(handler: Handler): Promise<{ url: string; requests: FastifyRequest[] }> {
  const requests: FastifyRequest[] = [];
  jev = Fastify();
  jev.post("/v1/systemone", async (request, reply) => {
    requests.push(request);
    return handler(request, reply);
  });
  const base = await jev.listen({ host: "127.0.0.1", port: 0 });
  return { url: `${base}/v1/systemone`, requests };
}

const [realProblem, consequence] = stagePointsOf(1, "P");

const input: CoverageInput = {
  stage: "P",
  problemStatement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  stagePoints: [realProblem!, consequence!],
  answers: [
    { ref: "1.1", wording: "A demora é o problema em si?", answer: "A demora é sintoma de outra coisa" },
    { ref: "1.2", wording: "O que a demora já causou?", answer: "Atraso nas entregas" },
  ],
  constraints: [],
  preferences: [],
};

const choice = (picked: string, probabilities: Record<string, number>, confidence: number) => ({
  type: "choice",
  choice: picked,
  probabilities,
  confidence,
});

const validAnswers = {
  real_problem: choice("yes", { yes: 0.88, no: 0.1, insufficient: 0.02 }, 0.81),
  consequence: choice("insufficient", { yes: 0.3, no: 0.3, insufficient: 0.4 }, 0.12),
};

function assess(url: string, settings: { apiKey?: string | undefined; timeoutMs?: number } = {}) {
  const apiKey = "apiKey" in settings ? settings.apiKey : API_KEY;
  return createJevAssessor({ url, apiKey, model: "jev-latest", timeoutMs: settings.timeoutMs ?? 5_000 }).assessCoverage(input);
}

describe("coverage Assessment through the Jev API", () => {
  it("sends the confirmed answers in Portuguese and one Choice question per Point, with the key", async () => {
    const { url, requests } = await startJev(() => ({ model: "jev-1.13.0", answers: validAnswers, usage: {} }));

    await assess(url);

    const [request] = requests;
    expect(request!.headers.authorization).toBe(`Bearer ${API_KEY}`);
    const body = request!.body as { state: unknown; model: string; questions: Record<string, Record<string, unknown>> };
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual({
      enunciado: input.problemStatement,
      etapa: "P (Problema)",
      respostas: [
        { pergunta: "[1.1] A demora é o problema em si?", resposta: "A demora é sintoma de outra coisa" },
        { pergunta: "[1.2] O que a demora já causou?", resposta: "Atraso nas entregas" },
      ],
    });
    expect(Object.keys(body.questions)).toEqual(["real_problem", "consequence"]);
    expect(body.questions.real_problem).toMatchObject({ type: "choice" });
    expect(body.questions.real_problem!.instructions).toContain('"Problema real versus sintoma"');
    expect(body.questions.real_problem!.instructions).toContain(realProblem!.description);
    expect(Object.keys(body.questions.real_problem!.criteria as object)).toEqual(["yes", "no", "insufficient"]);
  });

  it("sends the registered Constraints and Preferences apart, with scope and unit, when there are any", async () => {
    const { url, requests } = await startJev(() => ({ model: "jev-1.13.0", answers: validAnswers, usage: {} }));
    const stageR: CoverageInput = {
      ...input,
      stage: "R",
      constraints: [{ statement: "Custo de até 500", scope: "Produção", unit: "reais por mês" }],
      preferences: [{ statement: "Deploys sem fila", scope: null, unit: null }],
    };

    await createJevAssessor({ url, apiKey: API_KEY, model: "jev-latest", timeoutMs: 5_000 }).assessCoverage(stageR);

    const body = requests[0]!.body as { state: Record<string, unknown>; questions: Record<string, { instructions: string }> };
    expect(body.state).toMatchObject({
      etapa: "R (Restrições)",
      restricoes: [{ restricao: "Custo de até 500", escopo: "Produção", unidade: "reais por mês" }],
      preferencias: [{ preferencia: "Deploys sem fila", escopo: null, unidade: null }],
    });
    expect(body.questions.real_problem!.instructions).toContain("Restrições e Preferências");
  });

  it("brings each judgment as it came, with the model that answered", async () => {
    const { url } = await startJev(() => ({ model: "jev-1.13.0", answers: validAnswers, usage: {} }));

    const outcome = await assess(url);

    expect(outcome).toEqual({
      status: "completed",
      model: "jev-1.13.0",
      result: {
        real_problem: { choice: "yes", probabilities: { yes: 0.88, no: 0.1, insufficient: 0.02 }, confidence: 0.81 },
        consequence: { choice: "insufficient", probabilities: { yes: 0.3, no: 0.3, insufficient: 0.4 }, confidence: 0.12 },
      },
    });
  });

  it("sends nothing without the key", async () => {
    const { url, requests } = await startJev(() => ({}));

    const outcome = await assess(url, { apiKey: undefined });

    expect(outcome).toMatchObject({ status: "failed", reason: "jev_not_configured" });
    expect(requests).toHaveLength(0);
  });

  it.each([
    [401, "jev_unauthenticated"],
    [429, "jev_rate_limited"],
    [529, "jev_unavailable"],
    [500, "jev_unavailable"],
    [422, "jev_error"],
  ])("reads HTTP %i as %s, without repeating the error body", async (status, reason) => {
    const { url } = await startJev((_request, reply) => reply.code(status).send({ error: "segredo ecoado" }));

    const outcome = await assess(url);

    expect(outcome).toMatchObject({ status: "failed", reason });
    expect(JSON.stringify(outcome)).not.toContain("segredo ecoado");
  });

  it("is unavailable when nobody answers at the address", async () => {
    const { url } = await startJev(() => ({}));
    await jev!.close();

    expect(await assess(url)).toMatchObject({ status: "failed", reason: "jev_unavailable" });
  });

  it("is unavailable when it does not answer in time", async () => {
    const { url } = await startJev(() => new Promise(() => {}));

    const outcome = await assess(url, { timeoutMs: 100 });

    expect(outcome).toMatchObject({ status: "failed", reason: "jev_unavailable" });
    await jev!.close().catch(() => {});
  });

  it.each([
    ["a Point without answer", { real_problem: validAnswers.real_problem }],
    ["a choice outside the primitive", { ...validAnswers, consequence: choice("maybe", { yes: 0.5, no: 0.5 }, 0.5) }],
    [
      "probabilities that do not sum to 1",
      { ...validAnswers, consequence: choice("no", { yes: 0.5, no: 0.6, insufficient: 0.1 }, 0.4) },
    ],
    ["a confidence out of range", { ...validAnswers, consequence: choice("no", { yes: 0.1, no: 0.8, insufficient: 0.1 }, 1.4) }],
  ])("refuses %s as invalid output, never inferring a choice", async (_case, answers) => {
    const { url } = await startJev(() => ({ model: "jev-1.13.0", answers, usage: {} }));

    expect(await assess(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

const impactInput: ImpactInput = {
  problemStatement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  confirmation: {
    kind: "block_synthesis",
    stage: "P",
    blockNumber: 1,
    synthesis: "A demora é o problema em si e já atrasou entregas.",
    coveredStagePoints: [realProblem!],
  },
  question: { ref: "1.1", wording: "A demora é o problema em si?" },
  previousAnswer: "A demora é o problema em si",
  newAnswer: "A demora é sintoma de outra coisa",
};

describe("impact Assessment through the Jev API", () => {
  const assessImpact = (url: string, input: ImpactInput = impactInput) =>
    createJevAssessor({ url, apiKey: API_KEY, model: "jev-latest", timeoutMs: 5_000 }).assessImpact(input);

  it("sends the Confirmation and the change in Portuguese, as data, with one Choice question", async () => {
    const { url, requests } = await startJev(() => ({ model: "jev-1.13.0", answers: { impacto: validAnswers.real_problem }, usage: {} }));

    await assessImpact(url);

    const body = requests[0]!.body as { state: unknown; model: string; questions: Record<string, Record<string, unknown>> };
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual({
      enunciado: impactInput.problemStatement,
      confirmacao: {
        tipo: "Síntese do Bloco 1",
        etapa: "P (Problema)",
        sintese: "A demora é o problema em si e já atrasou entregas.",
        pontosCobertos: [{ ponto: realProblem!.name, pede: realProblem!.description }],
      },
      mudanca: {
        pergunta: "[1.1] A demora é o problema em si?",
        respostaAnterior: "A demora é o problema em si",
        respostaNova: "A demora é sintoma de outra coisa",
      },
    });
    expect(Object.keys(body.questions)).toEqual(["impacto"]);
    expect(body.questions.impacto).toMatchObject({ type: "choice" });
    expect(Object.keys(body.questions.impacto!.criteria as object)).toEqual(["yes", "no", "insufficient"]);
  });

  it("sends a Stage Confirmation with its Points and confirmed answers", async () => {
    const { url, requests } = await startJev(() => ({ model: "jev-1.13.0", answers: { impacto: validAnswers.real_problem }, usage: {} }));

    await assessImpact(url, {
      ...impactInput,
      confirmation: { kind: "stage", stage: "P", stagePoints: [realProblem!], answers: input.answers },
    });

    expect((requests[0]!.body as { state: Record<string, unknown> }).state.confirmacao).toEqual({
      tipo: "Confirmação da Etapa",
      etapa: "P (Problema)",
      pontos: [{ ponto: realProblem!.name, pede: realProblem!.description }],
      respostas: [
        { pergunta: "[1.1] A demora é o problema em si?", resposta: "A demora é sintoma de outra coisa" },
        { pergunta: "[1.2] O que a demora já causou?", resposta: "Atraso nas entregas" },
      ],
    });
  });

  it("brings the judgment as it came", async () => {
    const { url } = await startJev(() => ({ model: "jev-1.13.0", answers: { impacto: validAnswers.consequence }, usage: {} }));

    expect(await assessImpact(url)).toEqual({
      status: "completed",
      model: "jev-1.13.0",
      result: { choice: "insufficient", probabilities: { yes: 0.3, no: 0.3, insufficient: 0.4 }, confidence: 0.12 },
    });
  });

  it("refuses an answer without the judgment as invalid output", async () => {
    const { url } = await startJev(() => ({ model: "jev-1.13.0", answers: {}, usage: {} }));

    expect(await assessImpact(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

describe("impact Assessment of a Constraint revision through the Jev API", () => {
  const constraintImpactInput: ConstraintImpactInput = {
    problemStatement: impactInput.problemStatement,
    confirmation: { kind: "stage", stage: "R", stagePoints: [realProblem!], answers: input.answers },
    revision: {
      constraint: { statement: "Entregar em duas semanas", scope: null, unit: null },
      replacement: { kind: "preference", item: { statement: "Entregar em duas semanas", scope: "Primeira versão", unit: null } },
      note: "Foi um desejo da diretoria.",
    },
  };

  it("sends the Stage Confirmation and the revision, as data, with its own rubric", async () => {
    const { url, requests } = await startJev(() => ({ model: "jev-1.13.0", answers: { impacto: validAnswers.real_problem }, usage: {} }));
    const assessor = createJevAssessor({ url, apiKey: API_KEY, model: "jev-latest", timeoutMs: 5_000 });

    const outcome = await assessor.assessConstraintImpact(constraintImpactInput);

    const body = requests[0]!.body as { state: Record<string, unknown>; questions: Record<string, { instructions: string; criteria: object }> };
    expect(body.state).toEqual({
      enunciado: impactInput.problemStatement,
      confirmacao: {
        tipo: "Confirmação da Etapa",
        etapa: "R (Restrições)",
        pontos: [{ ponto: realProblem!.name, pede: realProblem!.description }],
        respostas: [
          { pergunta: "[1.1] A demora é o problema em si?", resposta: "A demora é sintoma de outra coisa" },
          { pergunta: "[1.2] O que a demora já causou?", resposta: "Atraso nas entregas" },
        ],
      },
      revisao: {
        restricaoRetirada: { enunciado: "Entregar em duas semanas", escopo: null, unidade: null },
        substituta: { tipo: "Preferência", enunciado: "Entregar em duas semanas", escopo: "Primeira versão", unidade: null },
        nota: "Foi um desejo da diretoria.",
      },
    });
    expect(Object.keys(body.questions)).toEqual(["impacto"]);
    expect(body.questions.impacto!.instructions).toContain("a revisão de uma Restrição que valia quando ela confirmou");
    expect(Object.keys(body.questions.impacto!.criteria)).toEqual(["yes", "no", "insufficient"]);
    expect(outcome).toMatchObject({ status: "completed", result: { choice: "yes", confidence: 0.81 } });
  });
});

const conflictInput: ConflictInput = {
  problemStatement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  constraints: [{ statement: "Sem downtime", scope: "Produção", unit: null }],
  preferences: [{ statement: "Manter o GitHub Actions", scope: null, unit: null }],
  clarifications: [
    {
      answers: [
        { ref: "2.1", stage: "R", wording: "Até quando?", answer: "Em três semanas." },
        { ref: "2.3", stage: "R", wording: "Quem aprova?", answer: "A diretoria, em um mês." },
      ],
      clarification: "A aprovação só vale para a segunda fase.",
    },
  ],
  pairs: [
    {
      key: "par_0",
      answer: { ref: "2.1", stage: "R", wording: "Até quando?", answer: "Em duas semanas." },
      other: { ref: "2.2", stage: "R", wording: "De que integrações depende?", answer: "Da nova API, disponível em um mês." },
    },
    {
      key: "par_1",
      answer: { ref: "2.1", stage: "R", wording: "Até quando?", answer: "Em duas semanas." },
      other: { ref: "1.1", stage: "P", wording: "A demora é o problema em si?", answer: "A demora é sintoma de outra coisa" },
    },
  ],
};

describe("conflict Assessment through the Jev API", () => {
  const assessConflicts = (url: string) =>
    createJevAssessor({ url, apiKey: API_KEY, model: "jev-latest", timeoutMs: 5_000 }).assessConflicts(conflictInput);

  it("sends the answers once, with the Constraints and Preferences as context, and one Choice question per pair", async () => {
    const answers = { par_0: validAnswers.real_problem, par_1: validAnswers.consequence };
    const { url, requests } = await startJev(() => ({ model: "jev-1.13.0", answers, usage: {} }));

    const outcome = await assessConflicts(url);

    const body = requests[0]!.body as { state: unknown; questions: Record<string, { instructions: string; criteria: object }> };
    expect(body.state).toEqual({
      enunciado: conflictInput.problemStatement,
      restricoes: [{ restricao: "Sem downtime", escopo: "Produção", unidade: null }],
      preferencias: [{ preferencia: "Manter o GitHub Actions", escopo: null, unidade: null }],
      respostas: [
        { pergunta: "[2.1] Até quando?", etapa: "R (Restrições)", resposta: "Em duas semanas." },
        { pergunta: "[2.2] De que integrações depende?", etapa: "R (Restrições)", resposta: "Da nova API, disponível em um mês." },
        { pergunta: "[1.1] A demora é o problema em si?", etapa: "P (Problema)", resposta: "A demora é sintoma de outra coisa" },
      ],
      // Os esclarecimentos do usuário, com as respostas como estavam então.
      esclarecimentos: [
        {
          respostasDeEntao: [
            { pergunta: "[2.1] Até quando?", etapa: "R (Restrições)", resposta: "Em três semanas." },
            { pergunta: "[2.3] Quem aprova?", etapa: "R (Restrições)", resposta: "A diretoria, em um mês." },
          ],
          esclarecimento: "A aprovação só vale para a segunda fase.",
        },
      ],
    });
    expect(Object.keys(body.questions)).toEqual(["par_0", "par_1"]);
    expect(body.questions.par_0!.instructions).toContain("As respostas [2.1] e [2.2] são incompatíveis entre si");
    // Preferência não é obrigação.
    expect(body.questions.par_0!.instructions).toContain("deixar de atender uma Preferência não é conflito");
    expect(body.questions.par_0!.instructions).toContain("Um esclarecimento explica por que respostas anteriores não conflitavam; considere-o, mas julgue as respostas atuais.");
    expect(Object.keys(body.questions.par_1!.criteria)).toEqual(["yes", "no", "insufficient"]);
    expect(outcome).toEqual({
      status: "completed",
      model: "jev-1.13.0",
      result: {
        par_0: { choice: "yes", probabilities: { yes: 0.88, no: 0.1, insufficient: 0.02 }, confidence: 0.81 },
        par_1: { choice: "insufficient", probabilities: { yes: 0.3, no: 0.3, insufficient: 0.4 }, confidence: 0.12 },
      },
    });
  });

  it("refuses an answer that leaves a pair without judgment as invalid output", async () => {
    const { url } = await startJev(() => ({ model: "jev-1.13.0", answers: { par_0: validAnswers.real_problem }, usage: {} }));

    expect(await assessConflicts(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});
