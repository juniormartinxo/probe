import { CamelCasePlugin, Kysely, PostgresDialect, type Generated } from "kysely";
import pg from "pg";
import type { Stage } from "../modules/process/stage.ts";

export interface ProcessTable {
  id: Generated<string>;
  originalDescription: string;
  status: Generated<"open" | "finalized">;
  currentStage: Generated<Stage>;
  createdAt: Generated<Date>;
}

export interface ConversationTable {
  id: Generated<string>;
  processId: string;
  createdAt: Generated<Date>;
}

export interface MessageTable {
  id: Generated<string>;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Generated<Date>;
}

export interface Database {
  processes: ProcessTable;
  conversations: ConversationTable;
  messages: MessageTable;
}

export type Db = Kysely<Database>;

export function createDatabase(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
    plugins: [new CamelCasePlugin()],
  });
}
