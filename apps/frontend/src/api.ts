export type Stage = "P" | "R" | "O" | "B" | "E";

export type ProcessStatus = "open" | "finalized";

export interface Process {
  id: string;
  originalDescription: string;
  status: ProcessStatus;
  currentStage: Stage;
  createdAt: string;
}

export interface ProcessWithConversation extends Process {
  conversation: { id: string };
}

// Consumo como a CLI informou; null quando ela não informou, nunca zero.
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
}

export type AttemptStatus = "running" | "completed" | "failed" | "timed_out" | "canceled" | "interrupted";

export type FailureReason =
  | "executor_unavailable"
  | "executor_error"
  | "cli_unavailable"
  | "cli_rate_limited"
  | "cli_unauthenticated"
  | "cli_error"
  | "invalid_output";

export interface Attempt {
  id: string;
  number: number;
  status: AttemptStatus;
  cli: string;
  model: string;
  usage: Usage | null;
  failureReason: FailureReason | null;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Proposal {
  id: string;
  statement: string;
  ambiguities: string[];
  missingInformation: string[];
  arrivedAfterConfirmation: boolean;
}

export interface Refinement {
  id: string;
  status: AttemptStatus;
  proposal: Proposal | null;
  attempts: Attempt[];
}

export type StatementOrigin = "proposal" | "corrected" | "written";

export interface ProblemStatement {
  statement: string;
  origin: StatementOrigin;
  proposalId: string | null;
  confirmedAt: string;
}

export interface ProcessDetail extends ProcessWithConversation {
  problemStatement: ProblemStatement | null;
  refinement: Refinement | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`A API respondeu ${status}${code ? ` (${code})` : ""}.`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : undefined;
    throw new ApiError(response.status, code);
  }
  return body as T;
}

export async function createProcess(description: string): Promise<ProcessWithConversation> {
  const { process } = await request<{ process: ProcessWithConversation }>("/processes", {
    method: "POST",
    body: JSON.stringify({ description }),
  });
  return process;
}

export async function listProcesses(): Promise<Process[]> {
  const { processes } = await request<{ processes: Process[] }>("/processes");
  return processes;
}

export async function getProcess(id: string): Promise<ProcessDetail> {
  const { process } = await request<{ process: ProcessDetail }>(`/processes/${encodeURIComponent(id)}`);
  return process;
}

const statementPath = (processId: string) => `/processes/${encodeURIComponent(processId)}/problem-statement`;

export async function requestRefinement(processId: string): Promise<Refinement> {
  const { refinement } = await request<{ refinement: Refinement }>(`${statementPath(processId)}/refinement`, {
    method: "POST",
  });
  return refinement;
}

export async function retryRefinement(processId: string): Promise<Refinement> {
  const { refinement } = await request<{ refinement: Refinement }>(`${statementPath(processId)}/refinement/attempts`, {
    method: "POST",
  });
  return refinement;
}

export async function confirmProblemStatement(
  processId: string,
  statement: string,
  proposalId: string | null,
): Promise<ProblemStatement> {
  const { problemStatement } = await request<{ problemStatement: ProblemStatement }>(
    `${statementPath(processId)}/confirmation`,
    { method: "POST", body: JSON.stringify({ statement, proposalId }) },
  );
  return problemStatement;
}
