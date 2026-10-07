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

export async function getProcess(id: string): Promise<ProcessWithConversation> {
  const { process } = await request<{ process: ProcessWithConversation }>(`/processes/${encodeURIComponent(id)}`);
  return process;
}
