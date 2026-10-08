export type Stage = "P" | "R" | "O" | "B" | "E";

export type ProcessStatus = "open" | "finalized";

export interface Process {
  id: string;
  originalDescription: string;
  status: ProcessStatus;
  currentStage: Stage;
  stagePointsVersion: number;
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

// Item fixo que a Etapa precisa cobrir; a lista é da aplicação, não da IA.
export interface StagePoint {
  key: string;
  name: string;
  description: string;
}

export type AnswerType = "single_choice" | "multiple_choice" | "free_text";

// Índices das alternativas escolhidas ou texto livre, conforme a Pergunta.
export type AnswerValue = { selectedOptions: number[] } | { text: string };

export interface AnswerVersion {
  id: string;
  number: number;
  selectedOptions: number[] | null;
  text: string | null;
  createdAt: string;
}

// A Versão que vale e as superadas, da mais recente para a mais antiga.
export interface Answer {
  current: AnswerVersion;
  previous: AnswerVersion[];
}

export interface AnswerDraft {
  basedOnVersionId: string | null;
  selectedOptions: number[] | null;
  text: string | null;
  updatedAt: string;
}

export interface Question {
  id: string;
  subject: string;
  contextRelation: string;
  rationale: string | null;
  stagePoints: { key: string; name: string }[];
  answerType: AnswerType;
  options: string[];
  answer: Answer | null;
  draft: AnswerDraft | null;
}

export interface Block {
  id: string;
  number: number;
  stage: Stage;
  createdAt: string;
  questions: Question[];
}

export interface BlockRequest {
  id: string;
  status: AttemptStatus;
  blockId: string | null;
  attempts: Attempt[];
}

export interface ProcessDetail extends ProcessWithConversation {
  problemStatement: ProblemStatement | null;
  refinement: Refinement | null;
  // Pontos da Etapa atual ainda não cobertos.
  openStagePoints: StagePoint[];
  blockRequests: BlockRequest[];
  blocks: Block[];
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

export async function newRefinementAttempt(processId: string): Promise<Refinement> {
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

const processPath = (processId: string) => `/processes/${encodeURIComponent(processId)}`;

export async function requestBlock(processId: string): Promise<BlockRequest> {
  const { blockRequest } = await request<{ blockRequest: BlockRequest }>(`${processPath(processId)}/block-requests`, {
    method: "POST",
  });
  return blockRequest;
}

export async function newBlockAttempt(processId: string, blockRequestId: string): Promise<BlockRequest> {
  const { blockRequest } = await request<{ blockRequest: BlockRequest }>(
    `${processPath(processId)}/block-requests/${encodeURIComponent(blockRequestId)}/attempts`,
    { method: "POST" },
  );
  return blockRequest;
}

const answerPath = (processId: string, questionId: string) =>
  `${processPath(processId)}/questions/${encodeURIComponent(questionId)}/answer`;

// Nova Versão da resposta, a partir da Versão que o usuário viu (null na primeira resposta).
export async function recordAnswer(
  processId: string,
  questionId: string,
  value: AnswerValue,
  basedOnVersionId: string | null,
): Promise<AnswerVersion> {
  const { answerVersion } = await request<{ answerVersion: AnswerVersion }>(`${answerPath(processId, questionId)}/versions`, {
    method: "POST",
    body: JSON.stringify({ ...value, basedOnVersionId }),
  });
  return answerVersion;
}

export async function saveDraft(
  processId: string,
  questionId: string,
  value: AnswerValue,
  basedOnVersionId: string | null,
): Promise<AnswerDraft> {
  const { draft } = await request<{ draft: AnswerDraft }>(`${answerPath(processId, questionId)}/draft`, {
    method: "PUT",
    body: JSON.stringify({ ...value, basedOnVersionId }),
  });
  return draft;
}

export async function discardDraft(processId: string, questionId: string): Promise<void> {
  await request<void>(`${answerPath(processId, questionId)}/draft`, { method: "DELETE" });
}
