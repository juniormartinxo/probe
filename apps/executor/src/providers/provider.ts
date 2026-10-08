// O que cada provedor define: como a CLI é chamada para gerar texto e como a saída dela é lida. As
// CLIs não têm formatos de saída iguais; cada provedor lê o seu.

// Consumo como a CLI informou, nos baldes do executor; o que ela não informou fica null, nunca zero.
// `inputTokens` é só a entrada que não veio do cache.
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
}

// As falhas do Cloak vêm antes da CLI: ela nem chegou a rodar.
export type FailureReason =
  | "cloak_unavailable"
  | "cloak_profile_not_found"
  // Qualquer outro erro do próprio Cloak, como a configuração dele ilegível.
  | "cloak_error"
  | "cli_unavailable"
  | "cli_error"
  | "invalid_output";

export type GenerationOutcome =
  | { status: "completed"; output: string; usage: Usage | null }
  | {
      status: "failed";
      error: { reason: FailureReason; exitCode: number | null; message: string };
      usage: Usage | null;
    }
  | { status: "timed_out"; timeoutMs: number }
  | { status: "canceled" };

// Como a CLI terminou, com tudo o que escreveu.
export interface CliExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// Como o prompt chega à CLI: pelo stdin, no formato que ela lê, ou num arquivo cujo caminho vai nos
// argumentos. Nunca como argumento.
export type PromptDelivery = { via: "stdin"; content(prompt: string): string } | { via: "file" };

export interface Provider {
  // Argumentos depois de `cloak exec [--profile <perfil>] <cli>`. `promptFile` só existe quando o
  // prompt vai por arquivo.
  args(model: string, promptFile: string | null): string[];
  delivery: PromptDelivery;
  // Só uma saída que o provedor reconhece como resposta concluída vira conclusão.
  outcome(exit: CliExit): GenerationOutcome;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Saídas em JSON por linha: as linhas que não são objetos JSON ficam de fora.
export function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .map((line) => parseJson(line.trim()))
    .filter(isRecord);
}

// Um consumo em que nada foi informado é consumo não informado.
export const usageOrNull = (usage: Usage): Usage | null =>
  Object.values(usage).every((value) => value === null) ? null : usage;

export function failed(reason: FailureReason, exit: CliExit, message: string, usage: Usage | null): GenerationOutcome {
  return { status: "failed", error: { reason, exitCode: exit.exitCode, message }, usage };
}

// O que dizer de uma CLI que falhou sem explicar por quê.
export function exitMessage(cli: string, { exitCode, signal, stderr }: CliExit): string {
  return (
    stderr.trim() || (signal ? `${cli} foi encerrado pelo sinal ${signal}.` : `${cli} terminou com código ${exitCode}.`)
  );
}

export const invalidOutput = (cli: string) => `${cli} não devolveu um resultado reconhecível.`;
