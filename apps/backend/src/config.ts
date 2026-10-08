export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  executorUrl: string;
  // Opcional para o backend subir; sem ela, as solicitações à IA falham com a explicação.
  executorToken: string | undefined;
  // Modelo do claude usado nas novas solicitações.
  aiModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT inválida: ${env.PORT}`);
  return {
    databaseUrl,
    host: env.HOST ?? "localhost",
    port,
    executorUrl: env.PROBE_EXECUTOR_URL || "http://127.0.0.1:3211",
    executorToken: env.PROBE_EXECUTOR_TOKEN || undefined,
    aiModel: env.PROBE_CLAUDE_MODEL || "sonnet",
  };
}
