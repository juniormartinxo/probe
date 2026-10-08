import { CamelCasePlugin, Kysely, PostgresDialect, type Generated } from "kysely";
import pg from "pg";
import type { AttemptStatus, Operation } from "../modules/ai/ai-requests.ts";
import type { Cli, FailureReason } from "../modules/ai/assistant.ts";
import type { StatementOrigin } from "../modules/process/problem-statement.ts";
import type { ProcessStatus } from "../modules/process/process.ts";
import type { Stage } from "../modules/process/stage.ts";

export interface ProcessTable {
  id: Generated<string>;
  originalDescription: string;
  status: Generated<ProcessStatus>;
  currentStage: Generated<Stage>;
  createdAt: Generated<Date>;
}

export interface ConversationTable {
  id: Generated<string>;
  processId: string;
  createdAt: Generated<Date>;
}

export interface AiRequestTable {
  id: Generated<string>;
  processId: string;
  operation: Operation;
  createdAt: Generated<Date>;
}

export interface AiRequestAttemptTable {
  id: Generated<string>;
  aiRequestId: string;
  number: number;
  status: AttemptStatus;
  cli: Cli;
  model: string;
  // Resultado validado da operação, só em tentativas concluídas.
  result: unknown;
  failureReason: FailureReason | null;
  message: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
  startedAt: Generated<Date>;
  finishedAt: Date | null;
}

export interface ProblemStatementTable {
  processId: string;
  statement: string;
  origin: StatementOrigin;
  proposalId: string | null;
  confirmedAt: Generated<Date>;
}

export interface Database {
  processes: ProcessTable;
  conversations: ConversationTable;
  aiRequests: AiRequestTable;
  aiRequestAttempts: AiRequestAttemptTable;
  problemStatements: ProblemStatementTable;
}

export type Db = Kysely<Database>;

export function createDatabase(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
    plugins: [new CamelCasePlugin()],
  });
}
