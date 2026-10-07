export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT inválida: ${env.PORT}`);
  return { databaseUrl, host: env.HOST ?? "localhost", port };
}
