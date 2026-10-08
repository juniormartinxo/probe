import { statSync } from "node:fs";
import path from "node:path";

export interface Config {
  host: string;
  port: number;
  token: string;
  timeoutMs: number;
  // Onde cada geração ganha seu diretório vazio; o perfil do diretório é o que o Cloak liga a ele.
  // Sem valor, o diretório temporário do sistema.
  workDir: string | undefined;
  // Ambiente repassado à CLI: o do executor, sem a credencial técnica.
  cliEnv: NodeJS.ProcessEnv;
}

const MIN_TOKEN_LENGTH = 16;

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} inválida: ${value}`);
  return parsed;
}

function existingDirectory(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!path.isAbsolute(value) || !statSync(value, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${name} precisa ser o caminho absoluto de um diretório existente: ${value}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { PROBE_EXECUTOR_TOKEN: token, ...cliEnv } = env;
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `PROBE_EXECUTOR_TOKEN ausente ou curta (mínimo ${MIN_TOKEN_LENGTH} caracteres). ` +
        "Defina-a no .env.local, por exemplo com: openssl rand -hex 32",
    );
  }
  return {
    // 127.0.0.1 basta para o Docker Desktop alcançar o executor por host.docker.internal.
    host: env.PROBE_EXECUTOR_HOST || "127.0.0.1",
    port: positiveInteger("PROBE_EXECUTOR_PORT", env.PROBE_EXECUTOR_PORT || "3211"),
    token,
    timeoutMs: positiveInteger("PROBE_EXECUTOR_TIMEOUT_MS", env.PROBE_EXECUTOR_TIMEOUT_MS || "300000"),
    workDir: existingDirectory("PROBE_EXECUTOR_WORK_DIR", env.PROBE_EXECUTOR_WORK_DIR),
    cliEnv,
  };
}
