import {
  exitMessage,
  failed,
  invalidOutput,
  isRecord,
  jsonLines,
  numberOrNull,
  usageOrNull,
  type CliExit,
  type GenerationOutcome,
  type Provider,
  type Usage,
} from "./provider.ts";

// O agy separa a entrada sem cache da lida do cache e informa o raciocínio à parte da saída; aqui o
// raciocínio conta como saída, como nas outras CLIs. Sem nenhum turno, o consumo zerado que ele
// informa não é medida de nada.
function usageFrom(result: Record<string, unknown>): Usage | null {
  if (result.num_turns === 0 || !isRecord(result.usage)) return null;
  const { usage } = result;
  const output = numberOrNull(usage.output_tokens);
  const thinking = numberOrNull(usage.thinking_tokens);
  return usageOrNull({
    inputTokens: numberOrNull(usage.input_tokens),
    outputTokens: output !== null && thinking !== null ? output + thinking : output,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: numberOrNull(usage.cache_read_tokens),
    costUsd: null,
  });
}

// Eventos NDJSON; o desfecho é o evento `result`. Os trechos de resposta que chegam antes dele
// nunca valem como conclusão.
function outcome(exit: CliExit): GenerationOutcome {
  const event = jsonLines(exit.stdout).findLast((line) => line.event === "result");
  const result = isRecord(event?.result) ? event.result : undefined;
  const usage = result ? usageFrom(result) : null;
  if (exit.exitCode !== 0 || (result && result.status !== "SUCCESS")) {
    const message = typeof result?.error === "string" && result.error ? result.error : exitMessage("agy", exit);
    return failed("cli_error", exit, message, usage);
  }
  if (typeof result?.response !== "string") return failed("invalid_output", exit, invalidOutput("agy"), usage);
  return { status: "completed", output: result.response, usage };
}

// Gemini pelo agy (Antigravity): modo de impressão, sem comandos de barra e com o terminal
// restrito. O agy não lê um prompt de texto do stdin; o prompt vai pelo stdin como a mensagem do
// usuário em stream-json, que pede a saída também em stream-json. `-p=` liga o modo de impressão sem
// prompt na linha de comando.
export const agy: Provider = {
  args: (model) => [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--disable-slash-commands",
    "--sandbox",
    "-p=",
  ],
  delivery: { via: "stdin", content: (prompt) => `${JSON.stringify({ event: "user", message: { content: prompt } })}\n` },
  outcome,
};
