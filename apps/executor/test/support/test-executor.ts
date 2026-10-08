import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";

export const TOKEN = "credencial-de-teste-0123456789abcdef";

export interface FakeClaudeBehavior {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  killSignal?: NodeJS.Signals;
}

export interface Invocation {
  argv: string[];
  stdin: string;
  cwd: string;
  cwdEntries: string[];
  pid: number;
  // CLAUDE_CONFIG_DIR que o claude recebeu: o diretório do perfil que o Cloak escolheu.
  configDir: string | null;
}

export interface FakeClaude {
  dir: string;
  invocation(): Invocation | undefined;
}

const temporaryDirs: string[] = [];

export function removeTemporaryDirs(): void {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// Põe um `claude` falso num diretório próprio; o executor o encontra pelo PATH.
export function installFakeClaude(behavior: FakeClaudeBehavior): FakeClaude {
  const dir = mkdtempSync(path.join(tmpdir(), "probe-fake-claude-"));
  temporaryDirs.push(dir);
  const executable = path.join(dir, "claude");
  copyFileSync(new URL("./fake-claude.cjs", import.meta.url), executable);
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
  // Diretório de configuração do claude no perfil, como o Cloak o passa à CLI.
  configDirOf(profile: string): string;
}

// Põe um `cloak` falso num diretório próprio. Ele conhece só os perfis dados; sem `.cloak` no
// caminho, usa o padrão.
export function installFakeCloak({ profiles = ["padrao", "pessoal", "trabalho"], defaultProfile = "padrao" } = {}): FakeCloak {
  const dir = mkdtempSync(path.join(tmpdir(), "probe-fake-cloak-"));
  temporaryDirs.push(dir);
  const executable = path.join(dir, "cloak");
  copyFileSync(new URL("./fake-cloak.sh", import.meta.url), executable);
  chmodSync(executable, 0o755);
  copyFileSync(new URL("./fake-cloak.cjs", import.meta.url), path.join(dir, "fake-cloak.cjs"));
  writeFileSync(path.join(dir, "cloak.json"), JSON.stringify({ profiles, defaultProfile }));
  const invocationsFile = path.join(dir, "invocations.json");
  return {
    dir,
    invocations: () => (existsSync(invocationsFile) ? JSON.parse(readFileSync(invocationsFile, "utf8")) : []),
    configDirOf: (profile) => path.join(dir, "profiles", profile, "claude"),
  };
}

// Diretório de trabalho do executor; com `profile`, ligado a esse perfil por um `.cloak`, como faz
// `cloak use`.
export function createWorkDir({ profile }: { profile?: string } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "probe-work-dir-"));
  temporaryDirs.push(dir);
  if (profile) writeFileSync(path.join(dir, ".cloak"), `profile = "${profile}"\n`);
  return dir;
}

// Saída de `claude -p --output-format json` bem-sucedida.
export function claudeResult(result: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...extra });
}

// O PATH do executor tem só os diretórios dados e o do node (o `claude` falso é um script node),
// para que nenhum teste alcance o `claude` real instalado na máquina.
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
