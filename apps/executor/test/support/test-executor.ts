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
}

export interface Invocation {
  argv: string[];
  stdin: string;
  cwd: string;
  cwdEntries: string[];
  pid: number;
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

// Saída de `claude -p --output-format json` bem-sucedida.
export function claudeResult(result: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...extra });
}

// O PATH do executor tem só os diretórios dados e o do node (o `claude` falso é um script node),
// para que nenhum teste alcance o `claude` real instalado na máquina.
export function createTestExecutor(options: { pathDirs: string[]; defaultTimeoutMs?: number }): FastifyInstance {
  return buildApp({
    token: TOKEN,
    defaultTimeoutMs: options.defaultTimeoutMs ?? 10_000,
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
