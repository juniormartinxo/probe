import { spawn } from "node:child_process";

export interface ClaudeRun {
  model: string;
  prompt: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}

// Consumo como a CLI informou; o que ela não informou fica null, nunca zero.
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
}

export type FailureReason = "cli_unavailable" | "cli_error" | "invalid_output";

export type GenerationOutcome =
  | { status: "completed"; output: string; usage: Usage | null }
  | {
      status: "failed";
      error: { reason: FailureReason; exitCode: number | null; message: string };
      usage: Usage | null;
    }
  | { status: "timed_out"; timeoutMs: number }
  | { status: "canceled" };

// Modo não interativo, saída JSON (traz o consumo) e nada além de gerar texto: sem ferramentas
// embutidas, sem servidores MCP, sem skills e sem gravar a sessão em disco. O modo seguro deixa de
// fora as personalizações do usuário (CLAUDE.md global, hooks, plugins), mantendo autenticação e
// modelo. O prompt vai pelo stdin, nunca pela linha de comando.
function claudeArgs(model: string): string[] {
  return [
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
  ];
}

const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isRecord(parsed) && parsed.type === "result" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Só uma saída JSON de resultado, sem erro e com código 0, conta como conclusão.
function outcomeOf(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
): GenerationOutcome {
  const result = parseResult(stdout);
  const usage = result ? usageFrom(result) : null;
  const failed = (reason: FailureReason, message: string): GenerationOutcome => ({
    status: "failed",
    error: { reason, exitCode, message },
    usage,
  });
  const resultText = typeof result?.result === "string" ? result.result : undefined;

  if (exitCode !== 0 || result?.is_error === true) {
    const ending = signal ? `claude foi encerrado pelo sinal ${signal}.` : `claude terminou com código ${exitCode}.`;
    return failed("cli_error", resultText || stderr.trim() || ending);
  }
  if (resultText === undefined) return failed("invalid_output", "claude não devolveu um resultado reconhecível.");
  return { status: "completed", output: resultText, usage };
}

// Tempo que a CLI tem para sair depois do SIGTERM antes de receber SIGKILL.
const KILL_GRACE_MS = 2_000;

export function runClaude({ model, prompt, env, cwd, timeoutMs, signal }: ClaudeRun): Promise<GenerationOutcome> {
  if (signal.aborted) return Promise.resolve({ status: "canceled" });
  return new Promise((resolve) => {
    const child = spawn("claude", claudeArgs(model), { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    // Interrompida, a saída é descartada: o resultado parcial nunca vira conclusão.
    let stopped: GenerationOutcome | undefined;
    const stop = (outcome: GenerationOutcome) => {
      if (stopped || child.exitCode !== null) return;
      stopped = outcome;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => stop({ status: "timed_out", timeoutMs }), timeoutMs);
    const onCancel = () => stop({ status: "canceled" });
    signal.addEventListener("abort", onCancel, { once: true });
    const settle = (outcome: GenerationOutcome) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onCancel);
      resolve(outcome);
    };

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // A CLI pode sair antes de ler todo o stdin; o resultado vem do código de saída.
    child.stdin.on("error", () => {});

    child.on("error", (error: NodeJS.ErrnoException) => {
      const reason = error.code === "ENOENT" ? "cli_unavailable" : "cli_error";
      settle({ status: "failed", error: { reason, exitCode: null, message: error.message }, usage: null });
    });
    child.on("close", (exitCode, exitSignal) => settle(stopped ?? outcomeOf(exitCode, exitSignal, stdout, stderr)));
    child.stdin.end(prompt);
  });
}
