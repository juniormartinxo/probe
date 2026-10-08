import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Cli } from "./generation-request.ts";
import { providers } from "./providers/index.ts";
import type { CliExit, GenerationOutcome } from "./providers/provider.ts";

export interface CliRun {
  cli: Cli;
  model: string;
  // Perfil do Cloak; null deixa o Cloak resolver o perfil a partir de `cwd`.
  cloakProfile: string | null;
  prompt: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}

// A CLI roda pelo Cloak (`cloak exec`), que lhe dá a configuração e as credenciais do perfil. Os
// argumentos depois do nome da CLI são os do provedor.
function cloakExecArgs(cli: Cli, cloakProfile: string | null, cliArgs: string[]): string[] {
  return ["exec", ...(cloakProfile === null ? [] : ["--profile", cloakProfile]), cli, ...cliArgs];
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

// O Cloak falhou antes de chamar a CLI (ela não escreveu nada); se foi por não achá-la ou por ela
// não estar registrada na configuração dele, a CLI não está disponível.
function cloakFailure(exit: CliExit): GenerationOutcome | undefined {
  if (exit.exitCode === 0 || exit.stdout.trim() !== "" || !isCloakReport(exit.stderr)) return undefined;
  const message = cloakErrors(exit.stderr);
  const unavailable = /'[^']+' not found in PATH|CLI '[^']+' not configured/.test(message);
  return {
    status: "failed",
    error: { reason: unavailable ? "cli_unavailable" : "cloak_error", exitCode: exit.exitCode, message },
    usage: null,
  };
}

// Tempo que a CLI tem para sair depois do SIGTERM antes de receber SIGKILL.
const KILL_GRACE_MS = 2_000;

type ProcessEnd =
  | ({ status: "exited" } & CliExit)
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

export async function runCli({
  cli,
  model,
  cloakProfile,
  prompt,
  env,
  cwd,
  timeoutMs,
  signal,
}: CliRun): Promise<GenerationOutcome> {
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

  const provider = providers[cli];
  // O prompt que vai por arquivo fica num diretório próprio, fora do diretório em que a CLI roda.
  const promptDir = provider.delivery.via === "file" ? await mkdtemp(path.join(tmpdir(), "probe-prompt-")) : undefined;
  let run: ProcessEnd;
  try {
    const promptFile = promptDir ? path.join(promptDir, "prompt.txt") : null;
    if (promptFile) await writeFile(promptFile, prompt, { mode: 0o600 });
    const input = provider.delivery.via === "stdin" ? provider.delivery.content(prompt) : "";
    run = await runProcess("cloak", cloakExecArgs(cli, cloakProfile, provider.args(model, promptFile)), { ...options, input });
  } finally {
    if (promptDir) await rm(promptDir, { recursive: true, force: true });
  }
  switch (run.status) {
    case "stopped":
      return stopped();
    case "not_found":
      return cloakUnavailable;
    case "spawn_failed":
      return cloakFailed(run.message);
    case "exited":
      return cloakFailure(run) ?? provider.outcome(run);
  }
}
