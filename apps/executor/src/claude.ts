import { spawn } from "node:child_process";

export interface ClaudeRun {
  model: string;
  // Perfil do Cloak; null deixa o Cloak resolver o perfil a partir de `cwd`.
  cloakProfile: string | null;
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

// A CLI roda pelo Cloak (`cloak exec`), que lhe dá a configuração e as credenciais do perfil.
// Modo não interativo, saída JSON (traz o consumo) e nada além de gerar texto: sem ferramentas
// embutidas, sem servidores MCP, sem skills e sem gravar a sessão em disco. O modo seguro deixa de
// fora as personalizações do usuário (CLAUDE.md global, hooks, plugins), mantendo autenticação e
// modelo. O prompt vai pelo stdin, nunca pela linha de comando.
function cloakExecArgs(cloakProfile: string | null, model: string): string[] {
  return [
    "exec",
    ...(cloakProfile === null ? [] : ["--profile", cloakProfile]),
    "claude",
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

const withoutColors = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

// Os erros do próprio Cloak saem no formato do color-eyre: "Error:" e a cadeia numerada de causas.
const isCloakReport = (stderr: string) => /^Error:\s*\n\s*0: /.test(withoutColors(stderr));

// Só as mensagens de erro do Cloak, sem cor, sem o local no código-fonte nem o aviso de backtrace.
function cloakErrors(stderr: string): string {
  const plain = withoutColors(stderr);
  const errors = [...plain.matchAll(/^\s*\d+: (.+)$/gm)].map(([, message]) => message!.trim());
  return errors.length > 0 ? errors.join("\n") : plain.trim();
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

  // O Cloak falhou antes de chamar o claude; se foi por não achá-lo, o claude não está instalado.
  if (!result && exitCode !== 0 && isCloakReport(stderr)) {
    const message = cloakErrors(stderr);
    return failed(/'claude' not found in PATH/.test(message) ? "cli_unavailable" : "cloak_error", message);
  }
  if (exitCode !== 0 || result?.is_error === true) {
    const ending = signal ? `claude foi encerrado pelo sinal ${signal}.` : `claude terminou com código ${exitCode}.`;
    return failed("cli_error", resultText || stderr.trim() || ending);
  }
  if (resultText === undefined) return failed("invalid_output", "claude não devolveu um resultado reconhecível.");
  return { status: "completed", output: resultText, usage };
}

// Tempo que a CLI tem para sair depois do SIGTERM antes de receber SIGKILL.
const KILL_GRACE_MS = 2_000;

type ProcessEnd =
  | { status: "exited"; exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
  | { status: "not_found" }
  | { status: "spawn_failed"; message: string }
  | { status: "stopped" };

// Roda um comando com `input` no stdin e espera ele sair. Interrompido por `stop`, a saída é
// descartada: o resultado parcial nunca vira conclusão.
function runProcess(
  command: string,
  args: string[],
  { env, cwd, input, stop }: { env: NodeJS.ProcessEnv; cwd: string; input: string; stop: AbortSignal },
): Promise<ProcessEnd> {
  if (stop.aborted) return Promise.resolve({ status: "stopped" });
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stopped = false;
    const onStop = () => {
      if (stopped || child.exitCode !== null) return;
      stopped = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    };
    stop.addEventListener("abort", onStop, { once: true });
    const settle = (end: ProcessEnd) => {
      stop.removeEventListener("abort", onStop);
      resolve(end);
    };

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // O processo pode sair antes de ler todo o stdin; o resultado vem do código de saída.
    child.stdin.on("error", () => {});

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle(error.code === "ENOENT" ? { status: "not_found" } : { status: "spawn_failed", message: error.message });
    });
    child.on("close", (exitCode, signal) => {
      settle(stopped ? { status: "stopped" } : { status: "exited", exitCode, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}


const cloakUnavailable: GenerationOutcome = {
  status: "failed",
  error: { reason: "cloak_unavailable", exitCode: null, message: "cloak não foi encontrado no PATH do executor." },
  usage: null,
};

const cloakFailed = (message: string, exitCode: number | null = null): GenerationOutcome => ({
  status: "failed",
  error: { reason: "cloak_error", exitCode, message },
  usage: null,
});

export async function runClaude({
  model,
  cloakProfile,
  prompt,
  env,
  cwd,
  timeoutMs,
  signal,
}: ClaudeRun): Promise<GenerationOutcome> {
  const stop = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const stopped = (): GenerationOutcome => (signal.aborted ? { status: "canceled" } : { status: "timed_out", timeoutMs });
  // O Cloak resolve o perfil do diretório pelo PWD quando ele aponta para o diretório atual.
  const options = { env: { ...env, PWD: cwd }, cwd, stop };

  // Um perfil explícito que não existe faria o `cloak exec` perguntar, pelo stdin (o prompt), se
  // deve criá-lo. Por isso o perfil é conferido antes, sem nada no stdin.
  if (cloakProfile !== null) {
    const check = await runProcess("cloak", ["profile", "account", cloakProfile], { ...options, input: "" });
    if (check.status === "stopped") return stopped();
    if (check.status === "not_found") return cloakUnavailable;
    if (check.status === "spawn_failed") return cloakFailed(check.message);
    if (check.exitCode !== 0) {
      const detail = cloakErrors(check.stderr);
      if (!/does not exist/.test(detail)) return cloakFailed(detail, check.exitCode);
      return {
        status: "failed",
        error: {
          reason: "cloak_profile_not_found",
          exitCode: check.exitCode,
          message: `O perfil "${cloakProfile}" não foi encontrado no Cloak.\n${detail}`,
        },
        usage: null,
      };
    }
  }

  const run = await runProcess("cloak", cloakExecArgs(cloakProfile, model), { ...options, input: prompt });
  switch (run.status) {
    case "stopped":
      return stopped();
    case "not_found":
      return cloakUnavailable;
    case "spawn_failed":
      return cloakFailed(run.message);
    case "exited":
      return outcomeOf(run.exitCode, run.signal, run.stdout, run.stderr);
  }
}
