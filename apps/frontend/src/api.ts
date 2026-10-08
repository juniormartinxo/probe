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
  | "cloak_unavailable"
  | "cloak_profile_not_found"
  | "cloak_error"
  | "cloak_unauthenticated"
  | "cli_unavailable"
  | "cli_rate_limited"
  // Só em tentativas anteriores ao Cloak.
  | "cli_unauthenticated"
  | "cli_error"
  | "invalid_output";

// Perfil do Cloak com que a CLI roda: o que o Cloak liga ao diretório de trabalho do executor, ou
// um perfil escolhido pelo nome.
export type CloakProfile = { source: "directory" } | { source: "explicit"; name: string };

export interface Attempt {
  id: string;
  number: number;
  status: AttemptStatus;
  cli: string;
  model: string;
  // null nas tentativas anteriores ao Cloak.
  cloakProfile: CloakProfile | null;
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
export type AnswerValue = { selectedChoices: number[] } | { text: string };

export interface AnswerVersion {
  id: string;
  number: number;
  selectedChoices: number[] | null;
  text: string | null;
  createdAt: string;
  // Confirmada em conjunto com o Bloco pela Confirmação da síntese; até lá, provisória.
  confirmed: boolean;
}

// A Versão que vale e as superadas, da mais recente para a mais antiga.
export interface Answer {
  current: AnswerVersion;
  previous: AnswerVersion[];
}

export interface AnswerDraft {
  basedOnVersionId: string | null;
  selectedChoices: number[] | null;
  text: string | null;
  updatedAt: string;
}

export interface Question {
  id: string;
  // A pergunta como é feita ao usuário; `subject` diz do que ela trata.
  wording: string;
  subject: string;
  contextRelation: string;
  rationale: string | null;
  stagePoints: { key: string; name: string }[];
  // A Pergunta original, quando esta é uma reformulação dela.
  reformulates: { questionId: string; blockNumber: number; number: number; wording: string } | null;
  answerType: AnswerType;
  choices: string[];
  answer: Answer | null;
  draft: AnswerDraft | null;
  // O usuário registrou que não sabe a informação.
  unknown: boolean;
}

export type SynthesisOrigin = "proposal" | "corrected";

// Proposta de síntese da IA: sugestão até o usuário confirmá-la ou corrigi-la.
export interface SynthesisProposal {
  id: string;
  synthesis: string;
  coverage: { stagePoint: { key: string; name: string }; covered: boolean; reason: string }[];
  ambiguousAnswers: { questionId: string; reason: string }[];
  // Uma resposta do Bloco mudou depois da proposta: ela não pode mais ser confirmada.
  outdated: boolean;
}

export interface SynthesisRequest {
  id: string;
  status: AttemptStatus;
  proposal: SynthesisProposal | null;
  attempts: Attempt[];
}

export interface ConfirmedSynthesis {
  synthesis: string;
  origin: SynthesisOrigin;
  proposalId: string;
  confirmedAt: string;
  coveredStagePoints: { key: string; name: string }[];
}

export interface Block {
  id: string;
  number: number;
  stage: Stage;
  createdAt: string;
  questions: Question[];
  synthesis: ConfirmedSynthesis | null;
  synthesisRequests: SynthesisRequest[];
}

export type StagePointStatus = "open" | "covered" | "inapplicable";

export interface StagePointState extends StagePoint {
  status: StagePointStatus;
  blockId: string | null;
  justification: string | null;
  recordedAt: string | null;
}

// Pendência de informação desconhecida, aberta numa Pergunta até uma resposta resolvê-la.
export interface Pendency {
  id: string;
  reason: "unknown_information";
  question: { id: string; wording: string; blockNumber: number; number: number };
  stagePoints: { key: string; name: string }[];
  openedAt: string;
  resolvedAt: string | null;
  resolvedByAnswerVersionId: string | null;
}

// Resumo do entendimento atual do Processo, montado sem chamar a IA.
export interface Understanding {
  originalDescription: string;
  problemStatement: string | null;
  currentStage: Stage;
  stagePoints: { key: string; name: string; status: StagePointStatus; justification: string | null }[];
  blocks: {
    number: number;
    synthesis: string | null;
    answers: { questionId: string; wording: string; answer: string | null; confirmed: boolean; unknown: boolean }[];
  }[];
  openPendencies: { reason: Pendency["reason"]; wording: string }[];
}

export type AssessmentChoice = "yes" | "no" | "insufficient";

export type AssessorFailureReason =
  | "jev_not_configured"
  | "jev_unavailable"
  | "jev_unauthenticated"
  | "jev_rate_limited"
  | "jev_error"
  | "invalid_output";

// Avaliação do Jev sobre um Ponto coberto, bruta, ao lado da sugestão da IA. `disagrees`: o Jev não
// confirma a cobertura que você deu ao Ponto.
export interface Assessment {
  type: "stage_point_coverage";
  stagePoint: { key: string; name: string };
  choice: AssessmentChoice;
  probabilities: Record<AssessmentChoice, number>;
  confidence: number;
  aiSuggestion: { covered: boolean; reason: string } | null;
  disagrees: boolean;
}

// Uma chamada ao Jev sobre os Pontos de uma Etapa; `outdated` quando as respostas confirmadas ou os
// Pontos cobertos mudaram depois dela.
export interface StageAssessment {
  id: string;
  stage: Stage;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  analyzedAnswerVersionIds: string[];
  assessments: Assessment[];
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: string;
  outdated: boolean;
}

export interface StageConfirmation {
  stage: Stage;
  stageAssessmentId: string | null;
  withoutAssessment: boolean;
  justification: string | null;
  confirmedAt: string;
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
  // Pontos da Etapa atual, cada um aberto, coberto ou inaplicável.
  stagePoints: StagePointState[];
  // Pontos da Etapa atual ainda abertos.
  openStagePoints: StagePoint[];
  blockRequests: BlockRequest[];
  blocks: Block[];
  pendencies: Pendency[];
  // Avaliações do Jev de cada Etapa já aberta, na ordem em que foram pedidas.
  stageAssessments: StageAssessment[];
  stageConfirmations: StageConfirmation[];
}

// Configurações não sensíveis; segredos ficam no ambiente do backend e nunca chegam aqui.
export interface Settings {
  // Modelo do claude usado nas novas solicitações à IA.
  claudeModel: string;
  // Perfil do Cloak com que a CLI roda nas novas solicitações.
  cloakProfile: CloakProfile;
}

// Desfecho de um teste de conexão com a CLI, pelo executor.
export interface ConnectionTest extends Pick<Attempt, "cli" | "model" | "failureReason" | "message" | "usage"> {
  cloakProfile: CloakProfile;
  status: Exclude<AttemptStatus, "running">;
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
  const { answerVersion } = await request<{ answerVersion: AnswerVersion }>(
    `${answerPath(processId, questionId)}/versions`,
    {
      method: "POST",
      body: JSON.stringify({ ...value, basedOnVersionId }),
    },
  );
  return answerVersion;
}

// `keepalive` deixa o envio terminar mesmo que a página esteja sendo fechada.
export async function saveDraft(
  processId: string,
  questionId: string,
  value: AnswerValue,
  basedOnVersionId: string | null,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<AnswerDraft> {
  const { draft } = await request<{ draft: AnswerDraft }>(`${answerPath(processId, questionId)}/draft`, {
    method: "PUT",
    body: JSON.stringify({ ...value, basedOnVersionId }),
    keepalive,
  });
  return draft;
}

export async function discardDraft(processId: string, questionId: string): Promise<void> {
  await request<void>(`${answerPath(processId, questionId)}/draft`, { method: "DELETE" });
}

// Registra que o usuário não sabe a informação que a Pergunta pede (Pendência de informação desconhecida).
export async function markUnknown(processId: string, questionId: string): Promise<Pendency> {
  const { pendency } = await request<{ pendency: Pendency }>(
    `${processPath(processId)}/questions/${encodeURIComponent(questionId)}/unknown-information`,
    { method: "POST" },
  );
  return pendency;
}

const blockPath = (processId: string, blockId: string) => `${processPath(processId)}/blocks/${encodeURIComponent(blockId)}`;

export async function requestSynthesis(processId: string, blockId: string): Promise<SynthesisRequest> {
  const { synthesisRequest } = await request<{ synthesisRequest: SynthesisRequest }>(
    `${blockPath(processId, blockId)}/synthesis-requests`,
    { method: "POST" },
  );
  return synthesisRequest;
}

export async function newSynthesisAttempt(processId: string, blockId: string, requestId: string): Promise<SynthesisRequest> {
  const { synthesisRequest } = await request<{ synthesisRequest: SynthesisRequest }>(
    `${blockPath(processId, blockId)}/synthesis-requests/${encodeURIComponent(requestId)}/attempts`,
    { method: "POST" },
  );
  return synthesisRequest;
}

// Confirmação da síntese de bloco: o texto (como veio ou corrigido) e os Pontos que o usuário dá por cobertos.
export async function confirmSynthesis(
  processId: string,
  blockId: string,
  confirmation: { proposalId: string; synthesis: string; coveredStagePoints: string[] },
): Promise<ConfirmedSynthesis> {
  const { synthesis } = await request<{ synthesis: ConfirmedSynthesis }>(`${blockPath(processId, blockId)}/synthesis/confirmation`, {
    method: "POST",
    body: JSON.stringify(confirmation),
  });
  return synthesis;
}

export async function declareInapplicable(processId: string, key: string, justification: string): Promise<StagePointState> {
  const { stagePoint } = await request<{ stagePoint: StagePointState }>(
    `${processPath(processId)}/stage-points/${encodeURIComponent(key)}/inapplicability`,
    { method: "POST", body: JSON.stringify({ justification }) },
  );
  return stagePoint;
}

export async function requestStageAssessment(processId: string, stage: Stage): Promise<StageAssessment> {
  const { stageAssessment } = await request<{ stageAssessment: StageAssessment }>(
    `${processPath(processId)}/stages/${stage}/assessments`,
    { method: "POST" },
  );
  return stageAssessment;
}

export async function confirmStage(
  processId: string,
  stage: Stage,
  confirmation: { stageAssessmentId: string | null; justification: string | null },
): Promise<StageConfirmation> {
  const { stageConfirmation } = await request<{ stageConfirmation: StageConfirmation }>(
    `${processPath(processId)}/stages/${stage}/confirmation`,
    { method: "POST", body: JSON.stringify(confirmation) },
  );
  return stageConfirmation;
}

export async function getUnderstanding(processId: string): Promise<Understanding> {
  const { understanding } = await request<{ understanding: Understanding }>(`${processPath(processId)}/understanding`);
  return understanding;
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await request<{ settings: Settings }>("/settings");
  return settings;
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const { settings: saved } = await request<{ settings: Settings }>("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return saved;
}

// Chamada paga à IA: só por ação explícita do usuário.
export async function testConnection(): Promise<ConnectionTest> {
  const { connectionTest } = await request<{ connectionTest: ConnectionTest }>("/settings/connection-test", {
    method: "POST",
  });
  return connectionTest;
}
