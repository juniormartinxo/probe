export interface Config {
  host: string;
  port: number;
  token: string;
  timeoutMs: number;
  // Ambiente repassado à CLI: o do executor, sem a credencial técnica.
  cliEnv: NodeJS.ProcessEnv;
}

const MIN_TOKEN_LENGTH = 16;

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} inválida: ${value}`);
  return parsed;
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
    cliEnv,
  };
}
