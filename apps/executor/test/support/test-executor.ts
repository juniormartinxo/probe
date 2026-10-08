import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";

export const TOKEN = "credencial-de-teste-0123456789abcdef";

export type Cli = "claude" | "codex" | "grok" | "agy";

export interface FakeCliBehavior {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  killSignal?: NodeJS.Signals;
}

export interface Invocation {
  argv: string[];
  stdin: string;
  // Arquivo passado em `--prompt-file`, como estava quando a CLI rodou.
  promptFile: { path: string; content: string } | null;
  cwd: string;
  cwdEntries: string[];
  pid: number;
  // Diretório de configuração que a CLI recebeu do Cloak: o dela no perfil escolhido.
  configDir: string | null;
}

export interface FakeCli {
  dir: string;
  invocation(): Invocation | undefined;
}

const temporaryDirs: string[] = [];

export function removeTemporaryDirs(): void {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// Põe uma CLI falsa num diretório próprio; o executor a encontra pelo PATH.
export function installFakeCli(cli: Cli, behavior: FakeCliBehavior): FakeCli {
  const dir = mkdtempSync(path.join(tmpdir(), `probe-fake-${cli}-`));
  temporaryDirs.push(dir);
  const executable = path.join(dir, cli);
  copyFileSync(new URL("./fake-cli.cjs", import.meta.url), executable);
  chmodSync(executable, 0o755);
  writeFileSync(path.join(dir, "behavior.json"), JSON.stringify(behavior));
  const invocationFile = path.join(dir, "invocation.json");
  return {
    dir,
    invocation: () => (existsSync(invocationFile) ? JSON.parse(readFileSync(invocationFile, "utf8")) : undefined),
  };
}

export interface CloakInvocation {
  argv: string[];
  cwd: string;
  // Perfil que o Cloak usou: o explícito ou o do diretório.
  profile: string;
}

export interface FakeCloak {
  dir: string;
  invocations(): CloakInvocation[];
  // Diretório de configuração da CLI no perfil, como o Cloak o passa à CLI.
  configDirOf(profile: string, cli?: Cli): string;
}

const allClis: Cli[] = ["claude", "codex", "grok", "agy"];

// Põe um `cloak` falso num diretório próprio. Ele conhece os perfis padrao (o padrão, sem `.cloak`
// no caminho), pessoal e trabalho, e executa as CLIs registradas em `clis` (todas, por padrão); com
// `brokenConfig`, falha antes de qualquer comando, como o Cloak real com a configuração ilegível.
export function installFakeCloak({ brokenConfig = false, clis = allClis } = {}): FakeCloak {
  const dir = mkdtempSync(path.join(tmpdir(), "probe-fake-cloak-"));
  temporaryDirs.push(dir);
  const executable = path.join(dir, "cloak");
  copyFileSync(new URL("./fake-cloak.sh", import.meta.url), executable);
  chmodSync(executable, 0o755);
  copyFileSync(new URL("./fake-cloak.cjs", import.meta.url), path.join(dir, "fake-cloak.cjs"));
  const profiles = ["padrao", "pessoal", "trabalho"];
  writeFileSync(path.join(dir, "cloak.json"), JSON.stringify({ profiles, defaultProfile: "padrao", brokenConfig, clis }));
  const invocationsFile = path.join(dir, "invocations.json");
  return {
    dir,
    invocations: () => (existsSync(invocationsFile) ? JSON.parse(readFileSync(invocationsFile, "utf8")) : []),
    configDirOf: (profile, cli = "claude") => path.join(dir, "profiles", profile, cli),
  };
}

// Diretório de trabalho do executor, ligado ao perfil por um `.cloak`, como faz `cloak use`.
export function createWorkDir(profile: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "probe-work-dir-"));
  temporaryDirs.push(dir);
  writeFileSync(path.join(dir, ".cloak"), `profile = "${profile}"\n`);
  return dir;
}

// Saída de `claude -p --output-format json` bem-sucedida.
export function claudeResult(result: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...extra });
}

// O PATH do executor tem só os diretórios dados e o do node (as CLIs falsas são scripts node),
// para que nenhum teste alcance as CLIs reais instaladas na máquina.
export function createTestExecutor(options: { pathDirs: string[]; timeoutMs?: number; workDir?: string }): FastifyInstance {
  return buildApp({
    token: TOKEN,
    timeoutMs: options.timeoutMs ?? 10_000,
    workDir: options.workDir,
    cliEnv: { ...process.env, PATH: [...options.pathDirs, path.dirname(process.execPath)].join(path.delimiter) },
  });
}

export async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Condição não atingida a tempo.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
