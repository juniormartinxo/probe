import {
  exitMessage,
  failed,
  invalidOutput,
  isRecord,
  numberOrNull,
  parseJson,
  type CliExit,
  type GenerationOutcome,
  type Provider,
  type Usage,
} from "./provider.ts";

function usageFrom(result: Record<string, unknown>): Usage | null {
  const usage = isRecord(result.usage) ? result.usage : undefined;
  if (!usage && result.total_cost_usd === undefined) return null;
  return {
    inputTokens: numberOrNull(usage?.input_tokens),
    outputTokens: numberOrNull(usage?.output_tokens),
    cacheCreationInputTokens: numberOrNull(usage?.cache_creation_input_tokens),
    cacheReadInputTokens: numberOrNull(usage?.cache_read_input_tokens),
    costUsd: numberOrNull(result.total_cost_usd),
  };
}

function parseResult(stdout: string): Record<string, unknown> | undefined {
  const parsed = parseJson(stdout);
  return isRecord(parsed) && parsed.type === "result" ? parsed : undefined;
}

// Só uma saída JSON de resultado, sem erro e com código 0, conta como conclusão.
function outcome(exit: CliExit): GenerationOutcome {
  const result = parseResult(exit.stdout);
  const usage = result ? usageFrom(result) : null;
  const resultText = typeof result?.result === "string" ? result.result : undefined;
  if (exit.exitCode !== 0 || result?.is_error === true) {
    return failed("cli_error", exit, resultText || exitMessage("claude", exit), usage);
  }
  if (resultText === undefined) return failed("invalid_output", exit, invalidOutput("claude"), usage);
  return { status: "completed", output: resultText, usage };
}

// Claude Code: modo não interativo, saída JSON (traz o consumo) e nada além de gerar texto: sem
// ferramentas embutidas, sem servidores MCP, sem skills e sem gravar a sessão em disco. O modo
// seguro deixa de fora as personalizações do usuário (CLAUDE.md global, hooks, plugins), mantendo
// autenticação e modelo. O prompt vai pelo stdin.
export const claude: Provider = {
  args: (model) => [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--safe-mode",
  ],
  delivery: { via: "stdin", content: (prompt) => prompt },
  outcome,
};
