import {
  exitMessage,
  failed,
  invalidOutput,
  isRecord,
  numberOrNull,
  parseJson,
  usageOrNull,
  type CliExit,
  type GenerationOutcome,
  type Provider,
  type Usage,
} from "./provider.ts";

// O grok já separa a entrada sem cache das lidas e gravadas no cache; o raciocínio está na saída.
// Sem consumo completo, ele omite o custo.
function usageFrom(result: Record<string, unknown>): Usage | null {
  const usage = isRecord(result.usage) ? result.usage : {};
  return usageOrNull({
    inputTokens: numberOrNull(usage.input_tokens),
    outputTokens: numberOrNull(usage.output_tokens),
    cacheCreationInputTokens: numberOrNull(usage.cache_creation_input_tokens),
    cacheReadInputTokens: numberOrNull(usage.cache_read_input_tokens),
    costUsd: numberOrNull(result.total_cost_usd),
  });
}

// Um único objeto JSON: a resposta em `text` ou, na falha, `{"type":"error","message":...}`.
function outcome(exit: CliExit): GenerationOutcome {
  const parsed = parseJson(exit.stdout);
  const result = isRecord(parsed) ? parsed : undefined;
  const usage = result ? usageFrom(result) : null;
  if (exit.exitCode !== 0 || result?.type === "error") {
    const message = typeof result?.message === "string" ? result.message : exitMessage("grok", exit);
    return failed("cli_error", exit, message, usage);
  }
  if (typeof result?.text !== "string") return failed("invalid_output", exit, invalidOutput("grok"), usage);
  return { status: "completed", output: result.text, usage };
}

// Grok: modo headless com saída JSON (traz o consumo), sem ferramentas embutidas, sem subagentes e
// sem busca na web. O grok não lê o prompt do stdin: ele vai num arquivo, fora do diretório em que
// a CLI roda.
export const grok: Provider = {
  args: (model, promptFile) => [
    "--prompt-file",
    promptFile!,
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--disallowed-tools",
    "Agent",
    "--disable-web-search",
    "--no-subagents",
  ],
  delivery: { via: "file" },
  outcome,
};
