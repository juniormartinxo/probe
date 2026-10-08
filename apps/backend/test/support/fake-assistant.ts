import type {
  Assistant,
  AssistantOutcome,
  AttemptContext,
  BlockInput,
  GeneratedBlock,
  GeneratedSynthesis,
  StatementProposal,
  SynthesisInput,
  Usage,
} from "../../src/modules/ai/assistant.ts";

export const defaultProposal: StatementProposal = {
  statement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  ambiguities: ["Não está claro se os 40 minutos incluem os testes."],
  missingInformation: ["Com que frequência o deploy é feito?"],
};

export const defaultBlock: GeneratedBlock = {
  questions: [
    {
      wording: "A demora do deploy é o problema em si ou sintoma de outra coisa?",
      subject: "Sintoma ou causa",
      contextRelation: "O enunciado fala da demora do deploy, mas não do que a provoca.",
      rationale: "Separar o sintoma do problema real evita resolver a coisa errada.",
      stagePoints: ["real_problem"],
      reformulates: null,
      answerType: "single_choice",
      choices: ["A demora é o problema em si", "A demora é sintoma de outra coisa", "Não sei"],
    },
    {
      wording: "O que a demora do deploy já causou?",
      subject: "Efeitos da demora",
      contextRelation: "O time perde a manhã esperando o deploy.",
      rationale: null,
      stagePoints: ["consequence", "urgency"],
      reformulates: null,
      answerType: "multiple_choice",
      choices: ["Atraso nas entregas", "Horas extras", "Clientes reclamando"],
    },
    {
      wording: "Por que resolver isso agora, e não daqui a seis meses?",
      subject: "Por que agora",
      contextRelation: "O problema existe há algum tempo.",
      rationale: "A urgência define quanto esforço cabe agora.",
      stagePoints: ["urgency"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

// Síntese padrão do primeiro Bloco: sugere cobertos o problema real e a consequência, e aberta a
// urgência.
export const defaultSynthesis: GeneratedSynthesis = {
  synthesis: "A demora do deploy é sintoma de outra coisa e já atrasou entregas; a diretoria cobrou uma solução.",
  coverage: [
    { stagePoint: "real_problem", covered: true, reason: "A pessoa disse que a demora é sintoma de outra coisa." },
    { stagePoint: "consequence", covered: true, reason: "As entregas já atrasaram." },
    { stagePoint: "urgency", covered: false, reason: "A cobrança da diretoria não explica por que agora." },
  ],
  ambiguousAnswers: [],
};

export function completed<T = StatementProposal>(
  result: T = defaultProposal as T,
  usage: Usage | null = null,
): AssistantOutcome<T> {
  return { status: "completed", result, usage };
}

export interface ReceivedAttempt<I, T> {
  input: I;
  context: AttemptContext;
  // Responde uma tentativa retida por willHold().
  respond(outcome: AssistantOutcome<T>): void;
}

const HOLD = Symbol("hold");

// Roteiro de uma operação: desfechos na ordem; sem roteiro, conclui com o resultado padrão.
// Uma tentativa retida fica pendente até o teste respondê-la, e termina como cancelada se a geração
// for abortada antes disso.
export class Script<I, T> {
  readonly attempts: ReceivedAttempt<I, T>[] = [];
  private readonly steps: (AssistantOutcome<T> | typeof HOLD)[] = [];

  constructor(private readonly fallback: () => AssistantOutcome<T>) {}

  willRespond(...outcomes: AssistantOutcome<T>[]): this {
    this.steps.push(...outcomes);
    return this;
  }

  willHold(): this {
    this.steps.push(HOLD);
    return this;
  }

  run(input: I, context: AttemptContext): Promise<AssistantOutcome<T>> {
    const step = this.steps.shift() ?? this.fallback();
    return new Promise((resolve) => {
      this.attempts.push({ input, context, respond: resolve });
      if (step !== HOLD) return resolve(step);
      context.signal.addEventListener("abort", () => resolve({ status: "canceled" }), { once: true });
    });
  }
}

// `Assistant` falso, com um roteiro por operação.
export class FakeAssistant implements Assistant {
  readonly cli = "claude";
  readonly refinement = new Script<{ originalDescription: string }, StatementProposal>(() => completed());
  readonly block = new Script<BlockInput, GeneratedBlock>(() => completed(defaultBlock));
  readonly synthesis = new Script<SynthesisInput, GeneratedSynthesis>(() => completed(defaultSynthesis));
  readonly connection = new Script<null, string>(() => completed("ok"));

  refineProblemStatement(input: { originalDescription: string }, context: AttemptContext) {
    return this.refinement.run(input, context);
  }

  generateBlock(input: BlockInput, context: AttemptContext) {
    return this.block.run(input, context);
  }

  synthesizeBlock(input: SynthesisInput, context: AttemptContext) {
    return this.synthesis.run(input, context);
  }

  testConnection(context: AttemptContext) {
    return this.connection.run(null, context);
  }
}
