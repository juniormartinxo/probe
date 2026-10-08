export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  executorUrl: string;
  // Opcional para o backend subir; sem ela, as solicitações à IA falham com a explicação.
  executorToken: string | undefined;
  // Prazo do backend para cada geração no executor.
  executorDeadlineMs: number;
  // Modelo do claude nas novas solicitações enquanto o usuário não escolhe outro na configuração.
  aiModel: string;
  // Opcional para o backend subir; sem ela, as Avaliações falham com a explicação.
  jevApiKey: string | undefined;
  jevModel: string;
  jevTimeoutMs: number;
}

// Folga sobre o tempo máximo do executor, para que ele responda "timed_out" antes de o backend desistir.
const EXECUTOR_DEADLINE_GRACE_MS = 30_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT inválida: ${env.PORT}`);
  const executorTimeoutMs = Number(env.PROBE_EXECUTOR_TIMEOUT_MS || "300000");
  if (!Number.isInteger(executorTimeoutMs) || executorTimeoutMs <= 0) {
    throw new Error(`PROBE_EXECUTOR_TIMEOUT_MS inválida: ${env.PROBE_EXECUTOR_TIMEOUT_MS}`);
  }
  const jevTimeoutMs = Number(env.PROBE_JEV_TIMEOUT_MS || "60000");
  if (!Number.isInteger(jevTimeoutMs) || jevTimeoutMs <= 0) {
    throw new Error(`PROBE_JEV_TIMEOUT_MS inválida: ${env.PROBE_JEV_TIMEOUT_MS}`);
  }
  return {
    databaseUrl,
    host: env.HOST ?? "localhost",
    port,
    executorUrl: env.PROBE_EXECUTOR_URL || "http://127.0.0.1:3211",
    executorToken: env.PROBE_EXECUTOR_TOKEN || undefined,
    executorDeadlineMs: executorTimeoutMs + EXECUTOR_DEADLINE_GRACE_MS,
    aiModel: env.PROBE_CLAUDE_MODEL || "sonnet",
    jevApiKey: env.TYPESAFE_API_KEY || undefined,
    jevModel: env.JEV_MODEL || "jev-latest",
    jevTimeoutMs,
  };
}
