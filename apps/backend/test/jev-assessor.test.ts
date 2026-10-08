import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { CoverageInput } from "../src/modules/assessments/assessor.ts";
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
