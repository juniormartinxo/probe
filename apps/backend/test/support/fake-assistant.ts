import type {
  Assistant,
  AssistantOutcome,
  AttemptContext,
  BlockInput,
  GeneratedBlock,
  StatementProposal,
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
      answerType: "single_choice",
      choices: ["A demora é o problema em si", "A demora é sintoma de outra coisa", "Não sei"],
    },
    {
      wording: "O que a demora do deploy já causou?",
      subject: "Efeitos da demora",
      contextRelation: "O time perde a manhã esperando o deploy.",
      rationale: null,
      stagePoints: ["consequence", "urgency"],
      answerType: "multiple_choice",
      choices: ["Atraso nas entregas", "Horas extras", "Clientes reclamando"],
    },
    {
      wording: "Por que resolver isso agora, e não daqui a seis meses?",
      subject: "Por que agora",
      contextRelation: "O problema existe há algum tempo.",
      rationale: "A urgência define quanto esforço cabe agora.",
      stagePoints: ["urgency"],
      answerType: "free_text",
      choices: [],
    },
  ],
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

  refineProblemStatement(input: { originalDescription: string }, context: AttemptContext) {
    return this.refinement.run(input, context);
  }

  generateBlock(input: BlockInput, context: AttemptContext) {
    return this.block.run(input, context);
  }
}
