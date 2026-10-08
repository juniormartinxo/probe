import type {
  Assistant,
  AssistantOutcome,
  Generation,
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

export interface FakeCall {
  input: { originalDescription: string };
  generation: Generation;
  // Responde uma chamada retida por hold().
  respond(outcome: Outcome): void;
}

const HOLD = Symbol("hold");

// `Assistant` falso: segue um roteiro de desfechos, na ordem; sem roteiro, propõe defaultProposal.
// Uma chamada retida fica pendente até o teste respondê-la, e termina como cancelada se a geração
// for abortada antes disso.
export class FakeAssistant implements Assistant {
  readonly cli = "claude";
  readonly calls: FakeCall[] = [];
  private readonly script: (Outcome | typeof HOLD)[] = [];

  willRespond(...outcomes: Outcome[]): this {
    this.script.push(...outcomes);
    return this;
  }

  willHold(): this {
    this.script.push(HOLD);
    return this;
  }

  refineProblemStatement(input: { originalDescription: string }, generation: Generation): Promise<Outcome> {
    const step = this.script.shift() ?? completed();
    return new Promise((resolve) => {
      this.calls.push({ input, generation, respond: resolve });
      if (step !== HOLD) return resolve(step);
      generation.signal.addEventListener("abort", () => resolve({ status: "canceled" }), { once: true });
    });
  }
}
