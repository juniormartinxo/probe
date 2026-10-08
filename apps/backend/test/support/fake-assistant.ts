import type {
  Assistant,
  AssistantOutcome,
  AttemptContext,
  StatementProposal,
  Usage,
} from "../../src/modules/ai/assistant.ts";

export const defaultProposal: StatementProposal = {
  statement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  ambiguities: ["Não está claro se os 40 minutos incluem os testes."],
  missingInformation: ["Com que frequência o deploy é feito?"],
};

export function completed(
  result: StatementProposal = defaultProposal,
  usage: Usage | null = null,
): AssistantOutcome<StatementProposal> {
  return { status: "completed", result, usage };
}

type Outcome = AssistantOutcome<StatementProposal>;

export interface ReceivedAttempt {
  input: { originalDescription: string };
  context: AttemptContext;
  // Responde uma tentativa retida por willHold().
  respond(outcome: Outcome): void;
}

const HOLD = Symbol("hold");

// `Assistant` falso: segue um roteiro de desfechos, na ordem; sem roteiro, propõe defaultProposal.
// Uma tentativa retida fica pendente até o teste respondê-la, e termina como cancelada se a geração
// for abortada antes disso.
export class FakeAssistant implements Assistant {
  readonly cli = "claude";
  readonly attempts: ReceivedAttempt[] = [];
  private readonly script: (Outcome | typeof HOLD)[] = [];

  willRespond(...outcomes: Outcome[]): this {
    this.script.push(...outcomes);
    return this;
  }

  willHold(): this {
    this.script.push(HOLD);
    return this;
  }

  refineProblemStatement(input: { originalDescription: string }, context: AttemptContext): Promise<Outcome> {
    const step = this.script.shift() ?? completed();
    return new Promise((resolve) => {
      this.attempts.push({ input, context, respond: resolve });
      if (step !== HOLD) return resolve(step);
      context.signal.addEventListener("abort", () => resolve({ status: "canceled" }), { once: true });
    });
  }
}
