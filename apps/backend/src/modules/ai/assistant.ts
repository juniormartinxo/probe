// Porta da IA. A implementação real chama o executor; nos testes, uma versão falsa a substitui.

export type Cli = "claude";

// Consumo como a CLI informou; o que ela não informou fica null, nunca zero.
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
}

export type FailureReason =
  | "executor_unavailable"
  | "executor_error"
  | "cli_unavailable"
  | "cli_rate_limited"
  | "cli_unauthenticated"
  | "cli_error"
  | "invalid_output";

// Só "completed" traz resultado; qualquer outro desfecho chega sem conteúdo aproveitável.
// "interrupted": a geração começou e o resultado ficou desconhecido (por exemplo, o executor caiu).
export type AssistantOutcome<T> =
  | { status: "completed"; result: T; usage: Usage | null }
  | { status: "failed"; reason: FailureReason; message: string; usage: Usage | null }
  | { status: "timed_out" }
  | { status: "canceled" }
  | { status: "interrupted"; message: string };

export interface Generation {
  // Identifica a tentativa no executor; permite cancelá-la.
  id: string;
  model: string;
  signal: AbortSignal;
}

// Proposta de enunciado mais claro, com o que a IA achou ambíguo ou faltando na descrição.
export interface StatementProposal {
  statement: string;
  ambiguities: string[];
  missingInformation: string[];
}

export interface Assistant {
  readonly cli: Cli;
  refineProblemStatement(
    input: { originalDescription: string },
    generation: Generation,
  ): Promise<AssistantOutcome<StatementProposal>>;
}
