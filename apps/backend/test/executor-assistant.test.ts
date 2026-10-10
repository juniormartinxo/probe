import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AttemptContext, BlockInput, OptionProposalInput, ResolutionQuestionInput, SynthesisInput } from "../src/modules/ai/assistant.ts";
import { createExecutorAssistant } from "../src/modules/ai/executor-assistant.ts";
import { stagePointsOf } from "../src/modules/process/stage-points.ts";
import { waitFor } from "./support/test-app.ts";

const TOKEN = "credencial-de-teste-0123456789abcdef";
const description = "Nosso deploy demora demais e o time perde a manhã.";

type Handler = (request: FastifyRequest, reply: FastifyReply) => unknown;

let executor: FastifyInstance | undefined;

afterEach(async () => {
  await executor?.close();
  executor = undefined;
});

// Executor falso, no contrato HTTP do executor real: POST /generations devolve o desfecho.
async function startExecutor(handler: Handler): Promise<{ url: string; requests: FastifyRequest[] }> {
  const requests: FastifyRequest[] = [];
  executor = Fastify();
  executor.get("/health", async () => ({ status: "ok" }));
  executor.post("/generations", async (request, reply) => {
    requests.push(request);
    return handler(request, reply);
  });
  const url = await executor.listen({ host: "127.0.0.1", port: 0 });
  return { url, requests };
}

function attemptContext(overrides: Partial<AttemptContext> = {}): AttemptContext {
  return {
    id: "tentativa-1",
    cli: "claude",
    model: "sonnet",
    cloakProfile: { source: "directory" },
    signal: new AbortController().signal,
    ...overrides,
  };
}

const proposalJson = JSON.stringify({
  statement: "O deploy leva 40 minutos e bloqueia o time de manhã.",
  ambiguities: ["Os 40 minutos incluem os testes?"],
  missingInformation: ["Frequência dos deploys."],
});

function refine(url: string, overrides: Partial<AttemptContext> = {}, token = TOKEN, deadlineMs = 10_000) {
  return createExecutorAssistant({ url, token, deadlineMs }).refineProblemStatement(
    { originalDescription: description },
    attemptContext(overrides),
  );
}

describe("refinement through the executor", () => {
  it("sends the predefined operation with the attempt id, the model, the description and the credential", async () => {
    const { url, requests } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output: proposalJson, usage: null }));

    await refine(url, { id: "tentativa-7", model: "claude-opus-5-5" });

    const [request] = requests;
    expect(request!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request!.body).toMatchObject({ id: "tentativa-7", operation: "generate_text", model: "claude-opus-5-5" });
    expect((request!.body as { prompt: string }).prompt).toContain(description);
  });

  it.each(["claude", "codex", "grok", "agy"] as const)("sends the attempt's CLI, %s, for the executor to call", async (cli) => {
    const { url, requests } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output: proposalJson, usage: null }));

    await refine(url, { cli, model: "modelo-x" });

    expect(requests[0]!.body).toMatchObject({ operation: "generate_text", cli, model: "modelo-x" });
  });

  it("sends the Cloak profile chosen explicitly by its name, and the directory's as null", async () => {
    const { url, requests } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output: proposalJson, usage: null }));

    await refine(url, { cloakProfile: { source: "explicit", name: "pessoal" } });
    await refine(url, { cloakProfile: { source: "directory" } });

    expect(requests.map((request) => (request.body as { cloakProfile: unknown }).cloakProfile)).toEqual(["pessoal", null]);
  });

  it("brings the proposal and the usage the executor reported", async () => {
    const usage = { inputTokens: 812, outputTokens: 95, cacheCreationInputTokens: null, cacheReadInputTokens: 0, costUsd: 0.0123 };
    const { url } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output: proposalJson, usage }));

    const outcome = await refine(url);

    expect(outcome).toEqual({
      status: "completed",
      result: {
        statement: "O deploy leva 40 minutos e bloqueia o time de manhã.",
        ambiguities: ["Os 40 minutos incluem os testes?"],
        missingInformation: ["Frequência dos deploys."],
      },
      usage,
    });
  });

  it("accepts the JSON inside a Markdown code block", async () => {
    const { url } = await startExecutor(() => ({
      id: "tentativa-1",
      status: "completed",
      output: "```json\n" + proposalJson + "\n```",
      usage: null,
    }));

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "completed", result: { ambiguities: ["Os 40 minutos incluem os testes?"] } });
  });

  it.each([
    ["a truncated answer", proposalJson.slice(0, 60)],
    ["an answer without the statement", JSON.stringify({ ambiguities: [], missingInformation: [] })],
    ["a blank statement", JSON.stringify({ statement: " ", ambiguities: [], missingInformation: [] })],
    ["lists that are not of text", JSON.stringify({ statement: "Enunciado.", ambiguities: [1], missingInformation: [] })],
    ["prose instead of JSON", "Claro! O problema é que o deploy é lento."],
  ])("never takes %s as a completed proposal", async (_case, output) => {
    const usage = { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: null };
    const { url } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output, usage }));

    const outcome = await refine(url);

    expect(outcome).toEqual({ status: "failed", reason: "invalid_output", message: expect.any(String), usage });
  });
});

const blockInput: BlockInput = {
  stage: "P",
  originalDescription: description,
  problemStatement: "O deploy leva 40 minutos e bloqueia o time de manhã.",
  confirmedStages: [],
  constraints: [],
  preferences: [],
  openStagePoints: stagePointsOf(1, "P"),
  askedQuestions: [],
  confirmedSyntheses: [],
  ambiguousAnswers: [],
  options: [],
};

const blockQuestions = [
  {
    wording: "A demora é o problema ou sintoma?",
    subject: "Sintoma ou causa",
    contextRelation: "O enunciado fala da demora, não da causa.",
    rationale: "Separar sintoma de problema.",
    stagePoints: ["real_problem"],
    answerType: "single_choice",
    choices: ["É o problema", "É sintoma"],
  },
  {
    wording: "O que a demora causou?",
    subject: "Efeitos",
    contextRelation: "O time perde a manhã.",
    stagePoints: ["consequence", "urgency"],
    answerType: "multiple_choice",
    choices: ["Atrasos", "Horas extras", "Reclamações"],
  },
  {
    wording: "Por que agora?",
    subject: "Por que agora",
    contextRelation: "O problema é antigo.",
    rationale: "",
    stagePoints: ["urgency"],
    answerType: "free_text",
  },
];

function generateBlock(url: string) {
  return createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).generateBlock(blockInput, attemptContext());
}

const answering = (output: string) => () => ({ id: "tentativa-1", status: "completed", output, usage: null });

describe("Block generation through the executor", () => {
  it("sends the problem and the open Stage Points in the prompt", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify({ questions: blockQuestions })));

    await generateBlock(url);

    const { operation, prompt } = requests[0]!.body as { operation: string; prompt: string };
    expect(operation).toBe("generate_text");
    expect(prompt).toContain(blockInput.problemStatement);
    expect(prompt).toContain(description);
    for (const point of blockInput.openStagePoints) {
      expect(prompt).toContain(point.key);
      expect(prompt).toContain(point.name);
    }
  });

  it("brings the questions, each with the Points it serves and its kind of answer", async () => {
    const { url } = await startExecutor(answering("```json\n" + JSON.stringify({ questions: blockQuestions }) + "\n```"));

    const outcome = await generateBlock(url);

    expect(outcome).toEqual({
      status: "completed",
      usage: null,
      result: {
        questions: [
          {
            wording: "A demora é o problema ou sintoma?",
            subject: "Sintoma ou causa",
            contextRelation: "O enunciado fala da demora, não da causa.",
            rationale: "Separar sintoma de problema.",
            stagePoints: ["real_problem"],
            reformulates: null,
            answerType: "single_choice",
            choices: ["É o problema", "É sintoma"],
          },
          {
            wording: "O que a demora causou?",
            subject: "Efeitos",
            contextRelation: "O time perde a manhã.",
            rationale: null,
            stagePoints: ["consequence", "urgency"],
            reformulates: null,
            answerType: "multiple_choice",
            choices: ["Atrasos", "Horas extras", "Reclamações"],
          },
          {
            wording: "Por que agora?",
            subject: "Por que agora",
            contextRelation: "O problema é antigo.",
            rationale: null,
            stagePoints: ["urgency"],
            reformulates: null,
            answerType: "free_text",
            choices: [],
          },
        ],
      },
    });
  });

  const withFirst = (changes: Record<string, unknown>) =>
    JSON.stringify({ questions: [{ ...blockQuestions[0], ...changes }, ...blockQuestions.slice(1)] });

  it.each([
    ["no questions", JSON.stringify({ questions: [] })],
    ["a truncated answer", JSON.stringify({ questions: blockQuestions }).slice(0, 80)],
    ["a question without wording", withFirst({ wording: undefined })],
    ["a question without subject", withFirst({ subject: " " })],
    ["a question without its relation to the context", withFirst({ contextRelation: undefined })],
    ["a question that serves no Point", withFirst({ stagePoints: [] })],
    ["a Point that is not open in the Stage", withFirst({ stagePoints: ["deadline"] })],
    ["an unknown kind of answer", withFirst({ answerType: "scale" })],
    ["a choice question with a single choice", withFirst({ choices: ["É o problema"] })],
    ["a choice question with a blank choice", withFirst({ choices: ["É o problema", " "] })],
    ["a choice question with repeated choices", withFirst({ choices: ["É o problema", "É o problema"] })],
    ["free text with choices", withFirst({ answerType: "free_text" })],
  ])("never takes %s as a completed Block", async (_case, output) => {
    const { url } = await startExecutor(answering(output));

    const outcome = await generateBlock(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

const askedBefore = [
  { ref: "1.1", wording: "A demora é o problema ou sintoma?", stagePoints: ["real_problem"], answer: "É sintoma", unknown: false },
  { ref: "1.2", wording: "Por que agora?", stagePoints: ["urgency"], answer: null, unknown: true },
];

describe("Block generation after earlier Blocks, through the executor", () => {
  const laterInput: BlockInput = {
    ...blockInput,
    openStagePoints: stagePointsOf(1, "P").filter((point) => point.key !== "real_problem"),
    askedQuestions: askedBefore,
    confirmedSyntheses: ["A demora é sintoma de testes lentos."],
    ambiguousAnswers: [{ question: "1.1", reason: "Não disse do quê." }],
  };
  const generateLater = (url: string) =>
    createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).generateBlock(laterInput, attemptContext());
  const reformulation = (reformulates: unknown) =>
    JSON.stringify({
      questions: [
        {
          wording: "A demora é sintoma de quê?",
          subject: "Causa",
          contextRelation: "Você disse que a demora é sintoma.",
          stagePoints: ["consequence"],
          reformulates,
          answerType: "free_text",
        },
      ],
    });

  it("sends what was already asked and answered, the confirmed syntheses and the ambiguous answers", async () => {
    const { url, requests } = await startExecutor(answering(reformulation(null)));

    await generateLater(url);

    const { prompt } = requests[0]!.body as { prompt: string };
    expect(prompt).toContain("[1.1]");
    expect(prompt).toContain("É sintoma");
    expect(prompt).toContain("a pessoa registrou que não sabe");
    expect(prompt).toContain("A demora é sintoma de testes lentos.");
    expect(prompt).toContain("Não disse do quê.");
    expect(prompt).not.toContain("- real_problem:");
  });

  it("brings a reformulation pointing to the question it reformulates", async () => {
    const { url } = await startExecutor(answering(reformulation("1.1")));

    const outcome = await generateLater(url);

    expect(outcome).toMatchObject({ status: "completed", result: { questions: [{ reformulates: "1.1" }] } });
  });

  it("accepts the reference to the reformulated question written between brackets, as it appears in the prompt", async () => {
    const { url } = await startExecutor(answering(reformulation("[1.1]")));

    const outcome = await generateLater(url);

    expect(outcome).toMatchObject({ status: "completed", result: { questions: [{ reformulates: "1.1" }] } });
  });

  it.each([
    ["a question that was never asked", "3.1"],
    ["a reference that is not text", 11],
  ])("never takes a reformulation of %s as a completed Block", async (_case, reformulates) => {
    const { url } = await startExecutor(answering(reformulation(reformulates)));

    expect(await generateLater(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

const confirmedP = {
  stage: "P" as const,
  answers: [
    { ref: "1.1", wording: "A demora é o problema ou sintoma?", answer: "É sintoma de testes lentos" },
    { ref: "1.2", wording: "Por que agora?", answer: "A diretoria cobrou." },
  ],
};

describe("Block generation in Stage R, through the executor", () => {
  const stageRInput: BlockInput = { ...blockInput, stage: "R", confirmedStages: [confirmedP], openStagePoints: stagePointsOf(1, "R") };
  const stageRQuestion = JSON.stringify({
    questions: [
      { wording: "Até quando?", subject: "Prazo", contextRelation: "A diretoria cobrou.", stagePoints: ["deadline"], answerType: "free_text" },
    ],
  });

  it("sends the confirmed answers of Stage P as context, and asks to clarify scope and units", async () => {
    const { url, requests } = await startExecutor(answering(stageRQuestion));

    const outcome = await createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).generateBlock(stageRInput, attemptContext());

    expect(outcome.status).toBe("completed");
    const { prompt } = requests[0]!.body as { prompt: string };
    expect(prompt).toContain("Etapa R (Restrições)");
    expect(prompt).toContain("Etapa P (Problema)\n[1.1] A demora é o problema ou sintoma?\nResposta: É sintoma de testes lentos");
    expect(prompt).toContain("[1.2] Por que agora?\nResposta: A diretoria cobrou.");
    expect(prompt).toMatch(/escopo/);
    expect(prompt).toMatch(/unidade/);
  });

  it("sends the registered Constraints and Preferences apart, with scope and unit", async () => {
    const { url, requests } = await startExecutor(answering(stageRQuestion));
    const input: BlockInput = {
      ...stageRInput,
      constraints: [{ statement: "Custo de até 500", scope: "Produção", unit: "reais por mês" }],
      preferences: [{ statement: "Deploys sem fila", scope: null, unit: null }],
    };

    await createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).generateBlock(input, attemptContext());

    const { prompt } = requests[0]!.body as { prompt: string };
    expect(prompt).toContain(
      "<<<RESTRICOES_E_PREFERENCIAS\nRestrições (inegociáveis):\n- Custo de até 500 (escopo: Produção; unidade: reais por mês)\nPreferências (negociáveis):\n- Deploys sem fila\nRESTRICOES_E_PREFERENCIAS>>>",
    );
  });

  it("says there is no confirmed Stage yet in Stage P", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify({ questions: blockQuestions })));

    await generateBlock(url);

    const { prompt } = requests[0]!.body as { prompt: string };
    expect(prompt).toContain("<<<ETAPAS_CONFIRMADAS\n(nenhuma)\nETAPAS_CONFIRMADAS>>>");
    expect(prompt).toContain("Restrições (inegociáveis):\n(nenhuma)\nPreferências (negociáveis):\n(nenhuma)");
    expect(prompt).not.toMatch(/unidade em que/);
  });
});

const synthesisInput: SynthesisInput = {
  stage: "P",
  originalDescription: description,
  problemStatement: "O deploy leva 40 minutos e bloqueia o time de manhã.",
  confirmedStages: [],
  openStagePoints: stagePointsOf(1, "P").filter((point) => point.key !== "real_problem"),
  blockNumber: 2,
  questions: [
    { ref: "2.1", wording: "O que a demora causou?", stagePoints: ["consequence"], answer: "Atrasos; Horas extras", unknown: false },
    { ref: "2.2", wording: "Por que agora?", stagePoints: ["urgency"], answer: "A diretoria cobrou.", unknown: false },
  ],
  earlierQuestions: [askedBefore[0]!],
};

const synthesisJson = {
  synthesis: "A demora causa atrasos e horas extras; a diretoria cobrou.",
  coverage: [
    { stagePoint: "consequence", covered: true, reason: "Atrasos e horas extras." },
    { stagePoint: "urgency", covered: false, reason: "A cobrança não diz por que agora." },
  ],
  ambiguousAnswers: [{ question: "2.2", reason: "Não diz quando a diretoria cobrou." }],
};

function synthesize(url: string) {
  return createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).synthesizeBlock(synthesisInput, attemptContext());
}

describe("Block synthesis through the executor", () => {
  it("sends the Block's answers, the earlier ones and the open Points in the prompt", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify(synthesisJson)));

    await synthesize(url);

    const { operation, prompt } = requests[0]!.body as { operation: string; prompt: string };
    expect(operation).toBe("generate_text");
    expect(prompt).toContain(description);
    expect(prompt).toContain(synthesisInput.problemStatement);
    expect(prompt).toContain("[2.1] (Pontos: consequence) O que a demora causou?\nResposta: Atrasos; Horas extras");
    expect(prompt).toContain("[1.1]");
    expect(prompt).toContain("- consequence:");
    expect(prompt).toContain("<<<ETAPAS_CONFIRMADAS\n(nenhuma)\nETAPAS_CONFIRMADAS>>>");
    expect(prompt).not.toContain("- real_problem:");
  });

  it("brings the synthesis, the coverage it suggests for each open Point and the ambiguous answers", async () => {
    const { url } = await startExecutor(answering("```json\n" + JSON.stringify(synthesisJson) + "\n```"));

    expect(await synthesize(url)).toEqual({ status: "completed", usage: null, result: synthesisJson });
  });

  const withChanges = (changes: Record<string, unknown>) => JSON.stringify({ ...synthesisJson, ...changes });

  it("accepts an ambiguous answer's reference between brackets, and keeps each question once", async () => {
    const { url } = await startExecutor(
      answering(
        withChanges({
          ambiguousAnswers: [
            { question: "[2.2]", reason: "Não diz quando a diretoria cobrou." },
            { question: "2.2", reason: "Repetida." },
          ],
        }),
      ),
    );

    expect(await synthesize(url)).toMatchObject({
      status: "completed",
      result: { ambiguousAnswers: [{ question: "2.2", reason: "Não diz quando a diretoria cobrou." }] },
    });
  });
  const [consequence, urgency] = synthesisJson.coverage;

  it.each([
    ["prose instead of JSON", "As respostas mostram que a demora atrasa entregas."],
    ["a truncated answer", JSON.stringify(synthesisJson).slice(0, 70)],
    ["no synthesis", withChanges({ synthesis: " " })],
    ["no coverage", withChanges({ coverage: undefined })],
    ["an open Point without suggestion", withChanges({ coverage: [consequence] })],
    ["coverage of a Point that is not open", withChanges({ coverage: [consequence, urgency, { ...urgency, stagePoint: "real_problem" }] })],
    ["the same Point twice", withChanges({ coverage: [consequence, urgency, consequence] })],
    ["coverage that is not true or false", withChanges({ coverage: [consequence, { ...urgency, covered: "sim" }] })],
    ["coverage without a reason", withChanges({ coverage: [consequence, { ...urgency, reason: "" }] })],
    ["an ambiguous answer outside the Block", withChanges({ ambiguousAnswers: [{ question: "1.1", reason: "Vago." }] })],
    ["an ambiguous answer without a reason", withChanges({ ambiguousAnswers: [{ question: "2.1" }] })],
  ])("never takes %s as a completed synthesis", async (_case, output) => {
    const { url } = await startExecutor(answering(output));

    expect(await synthesize(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

const resolutionQuestionInput: ResolutionQuestionInput = {
  problemStatement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  constraints: [{ statement: "Sem downtime", scope: null, unit: null }],
  preferences: [],
  answers: [
    { ref: "2.1", stage: "R", wording: "Até quando o deploy precisa ficar mais rápido?", answer: "Em duas semanas." },
    { ref: "2.2", stage: "R", wording: "De que integrações a solução depende?", answer: "Da nova API, disponível em um mês." },
  ],
  clarifications: [
    {
      answers: [
        { ref: "2.1", stage: "R", wording: "Até quando o deploy precisa ficar mais rápido?", answer: "Em três semanas." },
        { ref: "2.3", stage: "R", wording: "Quem aprova a mudança?", answer: "A diretoria, em um mês." },
      ],
      clarification: "A aprovação só vale para a segunda fase.",
    },
  ],
};

describe("Conflict resolution question through the executor", () => {
  const formulate = (url: string) =>
    createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).formulateResolutionQuestion(resolutionQuestionInput, attemptContext());

  it("sends the two answers in conflict, the statement and the Constraints, as data, in the prompt", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify({ question: "Há alternativa provisória?" })));

    await formulate(url);

    const { operation, prompt } = requests[0]!.body as { operation: string; prompt: string };
    expect(operation).toBe("generate_text");
    expect(prompt).toContain("[2.1] e [2.2], parecem incompatíveis");
    expect(prompt).toContain("[2.1] (Etapa R, Restrições) Até quando o deploy precisa ficar mais rápido?\nResposta: Em duas semanas.");
    expect(prompt).toContain("<<<ENUNCIADO\nO deploy leva 40 minutos");
    expect(prompt).toContain("Restrições (inegociáveis):\n- Sem downtime");
  });

  it("sends the user's clarifications of earlier conflicts, with the answers as they were, as data", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify({ question: "Há alternativa provisória?" })));

    await formulate(url);

    const { prompt } = requests[0]!.body as { prompt: string };
    expect(prompt).toContain(
      "<<<ESCLARECIMENTOS\n[2.1] (Etapa R, Restrições) Até quando o deploy precisa ficar mais rápido?\nResposta: Em três semanas.\n" +
        "[2.3] (Etapa R, Restrições) Quem aprova a mudança?\nResposta: A diretoria, em um mês.\n" +
        "Esclarecimento: A aprovação só vale para a segunda fase.\nESCLARECIMENTOS>>>",
    );
  });

  it("brings the question", async () => {
    const { url } = await startExecutor(answering("```json\n" + JSON.stringify({ question: " Há alternativa provisória? " }) + "\n```"));

    expect(await formulate(url)).toEqual({ status: "completed", usage: null, result: { question: "Há alternativa provisória?" } });
  });

  it.each([
    ["prose instead of JSON", "Há alternativa provisória?"],
    ["an empty question", JSON.stringify({ question: " " })],
  ])("never takes %s as a completed question", async (_case, output) => {
    const { url } = await startExecutor(answering(output));

    expect(await formulate(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

const optionProposalInput: OptionProposalInput = {
  originalDescription: description,
  problemStatement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  confirmedStages: [{ stage: "R", answers: [{ ref: "2.1", wording: "Até quando?", answer: "Fim do trimestre." }] }],
  constraints: [{ statement: "Custo de até 500", scope: null, unit: "reais por mês" }],
  preferences: [{ statement: "Manter o GitHub Actions", scope: null, unit: null }],
  stagePoints: stagePointsOf(1, "O"),
  askedQuestions: [],
  options: [
    { statement: "Contratar uma plataforma de CI cara", description: null, status: "accepted", violatedConstraints: ["Custo de até 500"] },
    { statement: "Desistir do deploy", description: "Ninguém aprovou.", status: "discarded", violatedConstraints: [] },
  ],
};

describe("Option proposal through the executor", () => {
  const propose = (url: string) =>
    createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).proposeOptions(optionProposalInput, attemptContext());

  it("sends the Points of Stage O, the Constraints and the Options already recorded, as data, in the prompt", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify({ options: [] })));

    await propose(url);

    const { operation, prompt } = requests[0]!.body as { operation: string; prompt: string };
    expect(operation).toBe("generate_text");
    expect(prompt).toContain("Etapa O (Opções)");
    expect(prompt).toContain("- eighty_twenty: Alternativa 80/20.");
    expect(prompt).toContain("Não invente Opções só para atingir uma quantidade");
    expect(prompt).toContain("Restrições (inegociáveis):\n- Custo de até 500 (unidade: reais por mês)");
    expect(prompt).toContain("Etapa R (Restrições)\n[2.1] Até quando?\nResposta: Fim do trimestre.");
    expect(prompt).toContain(
      "<<<OPCOES\n- (aceita) Contratar uma plataforma de CI cara\nViola: Custo de até 500\n- (descartada) Desistir do deploy\nNinguém aprovou.\nOPCOES>>>",
    );
  });

  it("brings the Options, each with the Points of Stage O it represents", async () => {
    const options = [
      { statement: " Cachear dependências ", description: " No GitHub Actions. ", stagePoints: ["eighty_twenty", "eighty_twenty"] },
      { statement: "Rodar à mão", stagePoints: [] },
    ];
    const { url } = await startExecutor(answering(JSON.stringify({ options })));

    expect(await propose(url)).toEqual({
      status: "completed",
      usage: null,
      result: {
        options: [
          { statement: "Cachear dependências", description: "No GitHub Actions.", stagePoints: ["eighty_twenty"] },
          { statement: "Rodar à mão", description: null, stagePoints: [] },
        ],
      },
    });
  });

  it("accepts an empty list: no Option is invented to reach a number", async () => {
    const { url } = await startExecutor(answering(JSON.stringify({ options: [] })));

    expect(await propose(url)).toEqual({ status: "completed", usage: null, result: { options: [] } });
  });

  it.each([
    ["prose instead of JSON", "Cachear dependências."],
    ["an Option without statement", JSON.stringify({ options: [{ statement: " ", stagePoints: [] }] })],
    ["a Point outside Stage O", JSON.stringify({ options: [{ statement: "Cachear", stagePoints: ["deadline"] }] })],
  ])("never takes %s as completed Options", async (_case, output) => {
    const { url } = await startExecutor(answering(output));

    expect(await propose(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });
});

describe("Block generation in Stage O, through the executor", () => {
  it("sends the accepted Options, with the Constraints each one violates, as data", async () => {
    const { url, requests } = await startExecutor(answering(JSON.stringify({ questions: [] })));
    const input: BlockInput = {
      ...blockInput,
      stage: "O",
      openStagePoints: stagePointsOf(1, "O"),
      options: [{ statement: "Contratar uma plataforma de CI cara", description: null, status: "accepted", violatedConstraints: ["Custo de até 500"] }],
    };

    await createExecutorAssistant({ url, token: TOKEN, deadlineMs: 10_000 }).generateBlock(input, attemptContext());

    const { prompt } = requests[0]!.body as { prompt: string };
    expect(prompt).toContain("<<<OPCOES\n- (aceita) Contratar uma plataforma de CI cara\nViola: Custo de até 500\nOPCOES>>>");
    expect(prompt).toMatch(/reversível/);
  });
});

function failedWith(reason: string, message: string) {
  return () => ({ id: "tentativa-1", status: "failed", error: { reason, exitCode: 1, message }, usage: null });
}

describe("CLI failure reported by the executor", () => {
  it.each([
    ["claude is not installed", failedWith("cli_unavailable", "spawn claude ENOENT"), "cli_unavailable"],
    ["the usage limit is reached", failedWith("cli_error", "API Error: 429 rate_limit_error"), "cli_rate_limited"],
    ["claude is not logged in in the Cloak profile", failedWith("cli_error", "Invalid API key · Please run /login"), "cloak_unauthenticated"],
    ["codex reaches the usage limit", failedWith("cli_error", "429: Rate limit reached."), "cli_rate_limited"],
    ["codex is not logged in in the Cloak profile", failedWith("cli_error", "401: Missing bearer or basic authentication in header"), "cloak_unauthenticated"],
    [
      "grok is not signed in in the Cloak profile",
      failedWith("cli_error", "Not signed in. To authenticate without a browser, run:\n  grok login --device-code"),
      "cloak_unauthenticated",
    ],
    ["agy runs out of quota", failedWith("cli_error", "RESOURCE_EXHAUSTED: quota exceeded"), "cli_rate_limited"],
    ["agy fails otherwise", failedWith("cli_error", "model not available"), "cli_error"],
    ["cloak is not installed", failedWith("cloak_unavailable", "cloak não foi encontrado no PATH do executor."), "cloak_unavailable"],
    ["the Cloak profile does not exist", failedWith("cloak_profile_not_found", 'O perfil "x" não foi encontrado no Cloak.'), "cloak_profile_not_found"],
    ["Cloak fails on its own", failedWith("cloak_error", "failed parsing ~/.config/cloak/config.toml"), "cloak_error"],
    ["claude fails otherwise", failedWith("cli_error", "claude terminou com código 1."), "cli_error"],
    ["claude's output is unrecognizable", failedWith("invalid_output", "claude não devolveu um resultado."), "invalid_output"],
  ])("is reported when %s", async (_case, handler, reason) => {
    const { url } = await startExecutor(handler);

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason, message: expect.any(String) });
  });

  it("keeps the message and the usage the CLI reported", async () => {
    const usage = { inputTokens: 10, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: null };
    const { url } = await startExecutor(() => ({
      id: "tentativa-1",
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "API Error: 429 rate_limit_error" },
      usage,
    }));

    const outcome = await refine(url);

    expect(outcome).toEqual({ status: "failed", reason: "cli_rate_limited", message: "API Error: 429 rate_limit_error", usage });
  });

  it("is reported as timed out when the executor stopped claude for taking too long", async () => {
    const { url } = await startExecutor(() => ({ id: "tentativa-1", status: "timed_out", timeoutMs: 300_000 }));

    expect(await refine(url)).toEqual({ status: "timed_out" });
  });
});

describe("executor failure", () => {
  it("is reported as unavailable, without sending the generation, when the executor is not running", async () => {
    const { url } = await startExecutor(() => ({}));
    await executor!.close();
    executor = undefined;

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_unavailable", usage: null });
  });

  it("is reported as unavailable, without sending the generation, when the executor does not answer its health check", async () => {
    const requests: FastifyRequest[] = [];
    executor = Fastify();
    executor.get("/health", (_request, reply) => reply.code(503).send());
    executor.post("/generations", async (request) => requests.push(request));
    const url = await executor.listen({ host: "127.0.0.1", port: 0 });

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_unavailable" });
    expect(requests).toHaveLength(0);
  });

  it("is reported as unavailable when the backend has no credential for it", async () => {
    const { url, requests } = await startExecutor(() => ({}));

    const outcome = await refine(url, {}, "");

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_unavailable", message: expect.stringContaining("PROBE_EXECUTOR_TOKEN") });
    expect(requests).toHaveLength(0);
  });

  it("is reported when the executor refuses the request", async () => {
    const { url } = await startExecutor((_request, reply) => reply.code(401).send({ error: "credential_required" }));

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_error", message: expect.stringContaining("credential_required") });
  });

  it("is reported as interrupted when the executor drops the connection mid-generation", async () => {
    const { url } = await startExecutor((request) => {
      request.raw.socket.destroy();
      return new Promise(() => {});
    });

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "interrupted", message: expect.any(String) });
  });
});

describe("executor failure mid-answer", () => {
  it("is reported as interrupted when the connection drops in the middle of the answer", async () => {
    const { url } = await startExecutor((_request, reply) => {
      reply.raw.writeHead(200, { "content-type": "application/json", "content-length": "500" });
      reply.raw.write('{"id":"tentativa-1","status":"completed","output":"{\\"statement\\":');
      setTimeout(() => reply.raw.destroy(), 20);
      return reply;
    });

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "interrupted", message: expect.any(String) });
  });

  it("is reported as interrupted when the executor does not answer within the backend's deadline", async () => {
    let connectionClosed = false;
    const { url } = await startExecutor((request) => {
      request.raw.socket.on("close", () => (connectionClosed = true));
      return new Promise(() => {});
    });

    const outcome = await refine(url, {}, TOKEN, 200);

    expect(outcome).toEqual({ status: "interrupted", message: expect.stringContaining("prazo") });
    await waitFor(() => connectionClosed);
  });
});

describe("cancellation", () => {
  it("drops the connection, so the executor stops claude, and reports the generation as canceled", async () => {
    let connectionClosed = false;
    const { url, requests } = await startExecutor((request) => {
      request.raw.socket.on("close", () => (connectionClosed = true));
      return new Promise(() => {});
    });
    const cancellation = new AbortController();
    const pending = refine(url, { signal: cancellation.signal });
    await waitFor(() => requests.length === 1);

    cancellation.abort();

    expect(await pending).toEqual({ status: "canceled" });
    await waitFor(() => connectionClosed);
  });
});

describe("connection test through the executor", () => {
  function testConnection(url: string, overrides: Partial<AttemptContext> = {}, token: string | undefined = TOKEN) {
    return createExecutorAssistant({ url, token, deadlineMs: 10_000 }).testConnection(attemptContext(overrides));
  }

  it("sends a minimal predefined generation with the CLI, the model, the Cloak profile and the credential", async () => {
    const { url, requests } = await startExecutor(() => ({ id: "teste", status: "completed", output: "ok", usage: null }));

    await testConnection(url, {
      id: "connection-test-1",
      cli: "codex",
      model: "gpt-6-astra",
      cloakProfile: { source: "explicit", name: "pessoal" },
    });

    const [request] = requests;
    expect(request!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request!.body).toMatchObject({
      id: "connection-test-1",
      operation: "generate_text",
      cli: "codex",
      model: "gpt-6-astra",
      cloakProfile: "pessoal",
    });
  });

  it("is completed with whatever claude answered, and the usage it reported", async () => {
    const usage = { inputTokens: 20, outputTokens: 2, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: 0.0001 };
    const { url } = await startExecutor(() => ({ id: "teste", status: "completed", output: "Ok.", usage }));

    expect(await testConnection(url)).toEqual({ status: "completed", result: "Ok.", usage });
  });

  it("is not completed when claude answers nothing", async () => {
    const { url } = await startExecutor(() => ({ id: "teste", status: "completed", output: "  ", usage: null }));

    expect(await testConnection(url)).toMatchObject({ status: "failed", reason: "invalid_output" });
  });

  it("reports the executor as unavailable when it is not running", async () => {
    const { url } = await startExecutor(() => ({}));
    await executor!.close();
    executor = undefined;

    expect(await testConnection(url)).toMatchObject({ status: "failed", reason: "executor_unavailable" });
  });

  it("reports the CLI failure the executor relayed", async () => {
    const { url } = await startExecutor(failedWith("cli_error", "Invalid API key · Please run /login"));

    expect(await testConnection(url)).toMatchObject({ status: "failed", reason: "cloak_unauthenticated" });
  });
});
