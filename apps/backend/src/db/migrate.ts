import { loadConfig } from "../config.ts";
import { createDatabase } from "./database.ts";
import { migrateDown, migrateToLatest } from "./migrator.ts";

// Uso: migrate.ts [latest|down]. "down" desfaz apenas a última migration aplicada.
const direction = process.argv[2] ?? "latest";
if (direction !== "latest" && direction !== "down") {
  console.error(`Direção desconhecida: ${direction}. Use latest ou down.`);
  process.exit(2);
}

const db = createDatabase(loadConfig().databaseUrl);
try {
  await (direction === "latest" ? migrateToLatest(db) : migrateDown(db));
} finally {
  await db.destroy();
}
