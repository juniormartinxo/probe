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

// CLIs que o executor chama pelo Cloak. Gemini roda pelo `agy`.
export const clis = ["claude", "codex", "grok", "agy"] as const;
export type Cli = (typeof clis)[number];

// Perfil do Cloak com que a CLI roda: o que o Cloak liga ao diretório de trabalho do executor, ou
// um perfil escolhido pelo nome.
export type CloakProfile = { source: "directory" } | { source: "explicit"; name: string };

export interface Attempt {
  id: string;
  number: number;
  status: AttemptStatus;
  cli: Cli;
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

// Restrição (inegociável) ou Preferência (negociável), registrada na Etapa R. Uma retirada deixa de
// valer e continua no histórico.
export type ItemKind = "constraint" | "preference";

export interface StatedItem {
  id: string;
  statement: string;
  scope: string | null;
  unit: string | null;
  registeredAt: string;
  withdrawnAt: string | null;
}

export interface ItemStatement {
  statement: string;
  scope: string | null;
  unit: string | null;
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

// `synthesis` é o texto confirmado; as correções feitas ao reconfirmá-la vêm na ordem, e a última vale.
export interface ConfirmedSynthesis {
  synthesis: string;
  origin: SynthesisOrigin;
  proposalId: string;
  confirmedAt: string;
  coveredStagePoints: { key: string; name: string }[];
  corrections: { synthesis: string; correctedAt: string }[];
}

export const synthesisInForce = ({ synthesis, corrections }: ConfirmedSynthesis): string =>
  corrections.at(-1)?.synthesis ?? synthesis;

export interface Block {
  id: string;
  number: number;
  stage: Stage;
  createdAt: string;
  questions: Question[];
  synthesis: ConfirmedSynthesis | null;
  synthesisRequests: SynthesisRequest[];
}

// `absent`: o usuário registrou que não há o que o Ponto pede (prazo, sistemas); conta como cobertura.
export type StagePointStatus = "open" | "covered" | "inapplicable" | "absent";

export interface StagePointState extends StagePoint {
  // Como se registra a ausência, nos Pontos que a admitem; null nos outros.
  absence: string | null;
  status: StagePointStatus;
  blockId: string | null;
  justification: string | null;
  recordedAt: string | null;
}

// Confirmação que depende de respostas: a síntese de um Bloco ou a de uma Etapa.
export type ConfirmationRef = { kind: "block_synthesis"; blockId: string } | { kind: "stage"; stage: Stage };

export type DependentConfirmation =
  | { kind: "block_synthesis"; blockId: string; blockNumber: number; stage: Stage }
  | { kind: "stage"; stage: Stage };

// Avaliação de impacto do Jev, bruta: se uma mudança afeta a Confirmação que dependia do que mudou (a
// Versão nova de uma resposta, com a anterior, ou uma Revisão de Restrição). `needsDecision`:
// `insufficient` ou confiança baixa; quem decide é o usuário.
export interface ImpactAssessment {
  id: string;
  answerVersionId: string | null;
  previousAnswerVersionId: string | null;
  constraintRevisionId: string | null;
  confirmation: DependentConfirmation;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  choice: AssessmentChoice | null;
  confidence: number | null;
  probabilities: Record<AssessmentChoice, number> | null;
  needsDecision: boolean;
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: string;
}

export type PendencyReason = "unknown_information" | "reassessment" | "conflict";

// Resposta confirmada num par de conflito, como o usuário a vê. `superseded`: a Pergunta já tem uma
// Versão mais nova.
export interface ConflictingAnswer {
  answerVersionId: string;
  versionNumber: number;
  question: { id: string; wording: string; stage: Stage; blockNumber: number; number: number };
  answer: string;
  superseded: boolean;
}

// Julgamento do Jev sobre um par de respostas. `needsDecision`: `insufficient` ou confiança baixa.
export interface ConflictVerdict {
  pairId: string;
  choice: AssessmentChoice;
  probabilities: Record<AssessmentChoice, number>;
  confidence: number;
  needsDecision: boolean;
}

// Uma chamada ao Jev com os pares de uma verificação de conflito.
export interface ConflictAssessment {
  id: string;
  checkId: string;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  analyzedConstraintIds: string[];
  analyzedPreferenceIds: string[];
  verdicts: ConflictVerdict[];
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: string;
}

export type ConflictPairStatus =
  | "not_assessed"
  | "assessment_failed"
  | "awaiting_decision"
  | "no_conflict"
  | "dismissed"
  | "pendency_open"
  | "pendency_resolved"
  | "superseded";

// O par ainda espera o Jev ou a decisão do usuário.
export const undecidedConflictStatuses: ConflictPairStatus[] = ["not_assessed", "assessment_failed", "awaiting_decision"];

export interface ConflictPair {
  id: string;
  position: number;
  answer: ConflictingAnswer;
  other: ConflictingAnswer;
  status: ConflictPairStatus;
  verdict: ConflictVerdict | null;
  pendencyId: string | null;
}

// Respostas recém-confirmadas, em pares entre si e com as já confirmadas, e as Avaliações do Jev.
export interface ConflictCheck {
  id: string;
  createdAt: string;
  status: "not_assessed" | "assessment_failed" | "awaiting_decision" | "decided";
  pairs: ConflictPair[];
  assessments: ConflictAssessment[];
}

// A pergunta com que a IA orienta a resolução de uma Pendência de conflito.
export interface ResolutionQuestion {
  id: string;
  status: AttemptStatus;
  question: string | null;
  attempts: Attempt[];
}

// Revisão de Restrição: a Restrição retirada, a que a substitui (se houver) e a nota do usuário.
export interface ConstraintRevision {
  id: string;
  constraint: StatedItem;
  replacement: { kind: ItemKind; item: StatedItem } | null;
  note: string | null;
  conflictPendencyId: string | null;
  revisedAt: string;
}

// Pendência numa Pergunta: de informação desconhecida, até uma resposta resolvê-la; de reavaliação,
// até o usuário reconfirmar a Confirmação afetada ou corrigir a resposta; de conflito, até o usuário
// corrigir uma das respostas, rever uma Restrição ou esclarecer. A de reavaliação de uma Revisão de
// Restrição não tem Pergunta: fica na Confirmação da Etapa.
export interface Pendency {
  id: string;
  reason: PendencyReason;
  question: { id: string; wording: string; stage: Stage; blockNumber: number; number: number } | null;
  stagePoints: { key: string; name: string }[];
  openedAt: string;
  resolvedAt: string | null;
  resolvedByAnswerVersionId: string | null;
  resolution: "answered" | "reconfirmed" | "corrected" | "clarified" | "constraint_revised" | null;
  reassessment: {
    answerVersionId: string | null;
    previousAnswerVersionId: string | null;
    constraintRevisionId: string | null;
    confirmation: DependentConfirmation;
    openedBy: "jev" | "user";
    impactAssessment: ImpactAssessment;
  } | null;
  conflict: {
    checkId: string;
    pairId: string;
    answers: [ConflictingAnswer, ConflictingAnswer];
    openedBy: "jev" | "user";
    conflictAssessment: ConflictAssessment;
    resolutionQuestion: ResolutionQuestion | null;
    clarification: string | null;
    constraintRevision: ConstraintRevision | null;
  } | null;
}

export type ReassessmentStatus = "not_assessed" | "assessment_failed" | "awaiting_decision" | "pendency_open";

// Uma Confirmação dependia de uma Versão que já não vale: fica em revisão até passar a sustentar a nova.
export interface Reassessment {
  confirmation: DependentConfirmation;
  question: { id: string; wording: string; stage: Stage; blockNumber: number; number: number };
  previousVersion: { id: string; number: number; answer: string };
  newVersion: { id: string; number: number; answer: string };
  status: ReassessmentStatus;
  impactAssessments: ImpactAssessment[];
  pendencyId: string | null;
}

// Uma Confirmação de Etapa sustentava uma Restrição que foi revista: fica em revisão até passar a
// sustentar a revisão.
export interface ConstraintReassessment {
  confirmation: { kind: "stage"; stage: Stage };
  revision: ConstraintRevision;
  status: ReassessmentStatus;
  impactAssessments: ImpactAssessment[];
  pendencyId: string | null;
}

// Resumo do entendimento atual do Processo, montado sem chamar a IA.
export interface Understanding {
  originalDescription: string;
  problemStatement: string | null;
  currentStage: Stage;
  stagePoints: { key: string; name: string; status: StagePointStatus; justification: string | null; absence: string | null }[];
  // As Restrições e Preferências em vigor.
  constraints: ItemStatement[];
  preferences: ItemStatement[];
  blocks: {
    number: number;
    synthesis: string | null;
    answers: { questionId: string; wording: string; answer: string | null; confirmed: boolean; unknown: boolean }[];
  }[];
  openPendencies: { reason: PendencyReason; wording: string }[];
}

export type AssessmentChoice = "yes" | "no" | "insufficient";

export type AssessorFailureReason =
  | "jev_not_configured"
  | "jev_unavailable"
  | "jev_unauthenticated"
  | "jev_rate_limited"
  | "jev_error"
  | "invalid_output";

// Avaliação do Jev sobre um Ponto coberto, bruta, ao lado da sugestão da IA. `disagreesWithCoverage`:
// o Jev não confirma a cobertura que você deu ao Ponto. `disagreesWithAi`: o Jev e a IA divergem.
export interface Assessment {
  type: "stage_point_coverage";
  stagePoint: { key: string; name: string };
  choice: AssessmentChoice;
  probabilities: Record<AssessmentChoice, number>;
  confidence: number;
  aiSuggestion: { covered: boolean; reason: string } | null;
  disagreesWithCoverage: boolean;
  disagreesWithAi: boolean;
}

// Uma chamada ao Jev sobre os Pontos de uma Etapa; `outdated` quando as respostas confirmadas, as
// Restrições e Preferências em vigor ou os Pontos cobertos mudaram depois dela.
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
  // Pontos da Etapa atual, cada um aberto, coberto, inaplicável ou com a ausência registrada.
  stagePoints: StagePointState[];
  // Pontos da Etapa atual ainda abertos.
  openStagePoints: StagePoint[];
  blockRequests: BlockRequest[];
  blocks: Block[];
  pendencies: Pendency[];
  // Confirmações em revisão porque uma resposta de que dependiam mudou, e as Avaliações de impacto.
  reassessments: Reassessment[];
  // Confirmações de Etapa em revisão porque uma Restrição que sustentavam foi revista.
  constraintReassessments: ConstraintReassessment[];
  impactAssessments: ImpactAssessment[];
  // Verificações de conflito entre respostas confirmadas, com os pares e as Avaliações do Jev.
  conflictChecks: ConflictCheck[];
  // Avaliações do Jev de cada Etapa já aberta, na ordem em que foram pedidas.
  stageAssessments: StageAssessment[];
  stageConfirmations: StageConfirmation[];
  // Restrições e Preferências registradas, inclusive as retiradas, na ordem do registro.
  constraints: StatedItem[];
  preferences: StatedItem[];
}

// Configurações não sensíveis; segredos ficam no ambiente do backend e nunca chegam aqui.
export interface Settings {
  // CLI usada nas novas solicitações à IA; uma nova tentativa pode usar outra, por escolha do usuário.
  cli: Cli;
  // Modelo de cada CLI; null enquanto não foi escolhido, e a CLI não pode ser usada.
  models: Record<Cli, string | null>;
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

// Nova tentativa da mesma solicitação, com a CLI que o usuário escolheu.
export async function newRefinementAttempt(processId: string, cli: Cli): Promise<Refinement> {
  const { refinement } = await request<{ refinement: Refinement }>(`${statementPath(processId)}/refinement/attempts`, {
    method: "POST",
    body: JSON.stringify({ cli }),
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

export async function newBlockAttempt(processId: string, blockRequestId: string, cli: Cli): Promise<BlockRequest> {
  const { blockRequest } = await request<{ blockRequest: BlockRequest }>(
    `${processPath(processId)}/block-requests/${encodeURIComponent(blockRequestId)}/attempts`,
    { method: "POST", body: JSON.stringify({ cli }) },
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

export async function newSynthesisAttempt(
  processId: string,
  blockId: string,
  requestId: string,
  cli: Cli,
): Promise<SynthesisRequest> {
  const { synthesisRequest } = await request<{ synthesisRequest: SynthesisRequest }>(
    `${blockPath(processId, blockId)}/synthesis-requests/${encodeURIComponent(requestId)}/attempts`,
    { method: "POST", body: JSON.stringify({ cli }) },
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

export async function recordAbsence(processId: string, key: string): Promise<StagePointState> {
  const { stagePoint } = await request<{ stagePoint: StagePointState }>(
    `${processPath(processId)}/stage-points/${encodeURIComponent(key)}/absence`,
    { method: "POST" },
  );
  return stagePoint;
}

const itemPaths: Record<ItemKind, string> = { constraint: "constraints", preference: "preferences" };

export async function registerItem(processId: string, kind: ItemKind, item: ItemStatement): Promise<StatedItem> {
  const body = await request<Record<ItemKind, StatedItem>>(`${processPath(processId)}/${itemPaths[kind]}`, {
    method: "POST",
    body: JSON.stringify(item),
  });
  return body[kind];
}

export async function withdrawItem(processId: string, kind: ItemKind, itemId: string): Promise<StatedItem> {
  const body = await request<Record<ItemKind, StatedItem>>(
    `${processPath(processId)}/${itemPaths[kind]}/${itemId}/withdrawal`,
    { method: "POST" },
  );
  return body[kind];
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

const versionPath = (processId: string, versionId: string) =>
  `${processPath(processId)}/answer-versions/${encodeURIComponent(versionId)}`;

// Nova tentativa da Avaliação de impacto, depois de uma falha do Jev.
export async function retryImpactAssessment(processId: string, versionId: string, confirmation: ConfirmationRef): Promise<ImpactAssessment> {
  const { impactAssessment } = await request<{ impactAssessment: ImpactAssessment }>(`${versionPath(processId, versionId)}/impact-assessments`, {
    method: "POST",
    body: JSON.stringify({ confirmation }),
  });
  return impactAssessment;
}

// A decisão do usuário quando o Jev não teve certeza ou não respondeu, sobre a Avaliação que ele viu.
export async function decideImpact(
  processId: string,
  versionId: string,
  decision: { confirmation: ConfirmationRef; impactAssessmentId: string; decision: "open_pendency" | "keep_confirmation" },
): Promise<Pendency | null> {
  const { pendency } = await request<{ pendency: Pendency | null }>(`${versionPath(processId, versionId)}/impact-decision`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
  return pendency;
}

const revisionPath = (processId: string, revisionId: string) =>
  `${processPath(processId)}/constraint-revisions/${encodeURIComponent(revisionId)}`;

// Nova tentativa da Avaliação de impacto de uma Revisão de Restrição sobre a Confirmação da Etapa.
export async function retryConstraintImpact(processId: string, revisionId: string, stage: Stage): Promise<ImpactAssessment> {
  const { impactAssessment } = await request<{ impactAssessment: ImpactAssessment }>(`${revisionPath(processId, revisionId)}/impact-assessments`, {
    method: "POST",
    body: JSON.stringify({ confirmation: { kind: "stage", stage } }),
  });
  return impactAssessment;
}

// A decisão do usuário sobre o impacto de uma Revisão de Restrição, sobre a Avaliação que ele viu.
export async function decideConstraintImpact(
  processId: string,
  revisionId: string,
  decision: { stage: Stage; impactAssessmentId: string; decision: "open_pendency" | "keep_confirmation" },
): Promise<Pendency | null> {
  const { pendency } = await request<{ pendency: Pendency | null }>(`${revisionPath(processId, revisionId)}/impact-decision`, {
    method: "POST",
    body: JSON.stringify({
      confirmation: { kind: "stage", stage: decision.stage },
      impactAssessmentId: decision.impactAssessmentId,
      decision: decision.decision,
    }),
  });
  return pendency;
}

// Reconfirma a Confirmação afetada com a mudança; numa síntese de bloco, com o texto corrigido, se houver.
export async function reconfirmPendency(processId: string, pendencyId: string, synthesis: string | null): Promise<Pendency> {
  const { pendency } = await request<{ pendency: Pendency }>(
    `${processPath(processId)}/pendencies/${encodeURIComponent(pendencyId)}/reconfirmation`,
    { method: "POST", body: JSON.stringify({ synthesis }) },
  );
  return pendency;
}

const pendencyPath = (processId: string, pendencyId: string) => `${processPath(processId)}/pendencies/${encodeURIComponent(pendencyId)}`;

const checkPath = (processId: string, checkId: string) => `${processPath(processId)}/conflict-checks/${encodeURIComponent(checkId)}`;

// Nova tentativa da Avaliação de conflito, depois de uma falha do Jev.
export async function retryConflictAssessment(processId: string, checkId: string): Promise<ConflictCheck> {
  const { conflictCheck } = await request<{ conflictCheck: ConflictCheck }>(`${checkPath(processId, checkId)}/conflict-assessments`, {
    method: "POST",
  });
  return conflictCheck;
}

// A decisão do usuário sobre pares em que o Jev não teve certeza ou não respondeu, sobre a Avaliação que ele viu.
export async function decideConflict(
  processId: string,
  checkId: string,
  decision: { conflictAssessmentId: string; pairIds: string[]; decision: "open_pendency" | "dismiss" },
): Promise<Pendency[]> {
  const { pendencies } = await request<{ pendencies: Pendency[] }>(`${checkPath(processId, checkId)}/decision`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
  return pendencies;
}

export async function clarifyConflict(processId: string, pendencyId: string, clarification: string): Promise<Pendency> {
  const { pendency } = await request<{ pendency: Pendency }>(`${pendencyPath(processId, pendencyId)}/clarification`, {
    method: "POST",
    body: JSON.stringify({ clarification }),
  });
  return pendency;
}

// Resolve a Pendência de conflito com uma Revisão de Restrição: retira a Restrição e, se houver,
// registra a que a substitui. Vale em qualquer Etapa a partir de R.
export async function reviseConstraintForConflict(
  processId: string,
  pendencyId: string,
  revision: { constraintId: string; replacement: (ItemStatement & { kind: ItemKind }) | null; note: string | null },
): Promise<Pendency> {
  const { pendency } = await request<{ pendency: Pendency }>(`${pendencyPath(processId, pendencyId)}/constraint-revision`, {
    method: "POST",
    body: JSON.stringify(revision),
  });
  return pendency;
}

// Pede a pergunta de resolução à IA, ou uma nova tentativa dela, com a CLI escolhida.
export async function requestResolutionQuestion(processId: string, pendencyId: string, cli?: Cli): Promise<ResolutionQuestion> {
  const { resolutionQuestion } = await request<{ resolutionQuestion: ResolutionQuestion }>(
    `${pendencyPath(processId, pendencyId)}/resolution-question/attempts`,
    { method: "POST", body: JSON.stringify(cli ? { cli } : {}) },
  );
  return resolutionQuestion;
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
