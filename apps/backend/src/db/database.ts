import { CamelCasePlugin, Kysely, PostgresDialect, type ColumnType, type Generated } from "kysely";
import pg from "pg";
import type { AttemptStatus, Operation } from "../modules/ai/ai-requests.ts";
import type { AnswerType, Cli, CloakProfile, FailureReason } from "../modules/ai/assistant.ts";
import type { AssessmentChoice, AssessorFailureReason } from "../modules/assessments/assessor.ts";
import type { AssessmentType } from "../modules/assessments/stage-assessments.ts";
import type { OptionOrigin } from "../modules/process/options.ts";
import type { PendencyReason, PendencyResolution } from "../modules/process/pendencies.ts";
import type { ConfirmationBasis } from "../modules/process/reassessments.ts";
import type { StatementOrigin } from "../modules/process/problem-statement.ts";
import type { CoverageStatus } from "../modules/process/stage-point-coverage.ts";
import type { SynthesisOrigin } from "../modules/process/syntheses.ts";
import type { ProcessStatus } from "../modules/process/process.ts";
import type { Stage } from "../modules/process/stage.ts";

export interface ProcessTable {
  id: Generated<string>;
  originalDescription: string;
  status: Generated<ProcessStatus>;
  currentStage: Generated<Stage>;
  stagePointsVersion: number;
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
  // Bloco que a solicitação sintetiza; só nas de síntese.
  blockId: string | null;
  // Pendência de conflito cuja pergunta de resolução a solicitação formula; só nessas.
  pendencyId: Generated<string | null>;
  createdAt: Generated<Date>;
}

export interface AiRequestAttemptTable {
  id: Generated<string>;
  aiRequestId: string;
  number: number;
  status: AttemptStatus;
  cli: Cli;
  model: string;
  // Perfil do Cloak com que a CLI foi chamada; os dois null em tentativas anteriores ao Cloak.
  cloakProfileSource: CloakProfile["source"] | null;
  cloakProfileName: string | null;
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

export interface BlockTable {
  id: Generated<string>;
  processId: string;
  number: number;
  stage: Stage;
  attemptId: string;
  createdAt: Generated<Date>;
}

export interface QuestionTable {
  id: Generated<string>;
  blockId: string;
  position: number;
  wording: string;
  subject: string;
  contextRelation: string;
  rationale: string | null;
  stagePoints: string[];
  answerType: AnswerType;
  choices: string[];
  // A Pergunta que esta reformula, se for uma reformulação.
  reformulatesQuestionId: Generated<string | null>;
}

export interface AnswerVersionTable {
  id: Generated<string>;
  questionId: string;
  number: number;
  selectedChoices: number[] | null;
  text: string | null;
  createdAt: Generated<Date>;
}

export interface AnswerDraftTable {
  questionId: string;
  basedOnVersionId: string | null;
  selectedChoices: number[] | null;
  text: string | null;
  updatedAt: Generated<Date>;
}

export interface AttemptAnswerVersionTable {
  attemptId: string;
  answerVersionId: string;
}

export interface BlockSynthesisTable {
  blockId: string;
  synthesis: string;
  origin: SynthesisOrigin;
  proposalId: string;
  confirmedAt: Generated<Date>;
}

export interface StagePointCoverageTable {
  processId: string;
  stage: Stage;
  stagePoint: string;
  status: CoverageStatus;
  blockId: string | null;
  justification: string | null;
  recordedAt: Generated<Date>;
}

// Restrição ou Preferência registrada pelo usuário na Etapa R; as duas têm a mesma forma.
export interface StatedItemTable {
  id: Generated<string>;
  processId: string;
  statement: string;
  scope: string | null;
  unit: string | null;
  registeredAt: Generated<Date>;
  withdrawnAt: Date | null;
}

export interface PendencyTable {
  id: Generated<string>;
  processId: string;
  reason: PendencyReason;
  // Sem Pergunta só a de reavaliação de uma Revisão de Restrição, que fica na Confirmação da Etapa.
  questionId: string | null;
  openedAt: Generated<Date>;
  resolvedAt: Date | null;
  resolvedByAnswerVersionId: string | null;
  resolution: PendencyResolution | null;
  // Só nas de reavaliação: a mudança (a Versão nova ou a Revisão de Restrição), a Avaliação de impacto
  // que a originou, quem a abriu e a Confirmação afetada (a síntese de um Bloco ou a de uma Etapa).
  answerVersionId: string | null;
  constraintRevisionId: Generated<string | null>;
  impactAssessmentId: string | null;
  openedBy: "jev" | "user" | null;
  blockId: string | null;
  stage: Stage | null;
  // Só nas de conflito: o par de respostas e a Avaliação de conflito que a originou; o esclarecimento,
  // quando resolvida por ele.
  conflictPairId: Generated<string | null>;
  conflictAssessmentId: Generated<string | null>;
  clarification: Generated<string | null>;
}

export interface ConstraintRevisionTable {
  id: Generated<string>;
  processId: string;
  constraintId: string;
  replacementConstraintId: string | null;
  replacementPreferenceId: string | null;
  note: string | null;
  conflictPendencyId: string | null;
  revisedAt: Generated<Date>;
}

export interface ConfirmationConstraintRevisionTable {
  id: Generated<string>;
  processId: string;
  constraintRevisionId: string;
  stage: Stage;
  basis: ConfirmationBasis;
  impactAssessmentId: string;
  recordedAt: Generated<Date>;
}

export interface ConflictCheckTable {
  id: Generated<string>;
  processId: string;
  subjectAnswerVersionIds: string[];
  createdAt: Generated<Date>;
}

export interface ConflictPairTable {
  id: Generated<string>;
  checkId: string;
  position: number;
  answerVersionId: string;
  otherAnswerVersionId: string;
}

export interface ConflictAssessmentTable {
  id: Generated<string>;
  processId: string;
  checkId: string;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  analyzedConstraintIds: Generated<string[]>;
  analyzedPreferenceIds: Generated<string[]>;
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Generated<Date>;
}

export interface ConflictVerdictTable {
  assessmentId: string;
  pairId: string;
  choice: AssessmentChoice;
  confidence: number;
  // Gravado como JSON; lido como objeto.
  probabilities: ColumnType<Record<AssessmentChoice, number>, string, never>;
}

export interface ConflictDismissalTable {
  pairId: string;
  conflictAssessmentId: string;
  dismissedAt: Generated<Date>;
}

export interface StageAssessmentTable {
  id: Generated<string>;
  processId: string;
  stage: Stage;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  analyzedConstraintIds: Generated<string[]>;
  analyzedPreferenceIds: Generated<string[]>;
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Generated<Date>;
}

export interface StageAssessmentAnswerVersionTable {
  stageAssessmentId: string;
  answerVersionId: string;
}

export interface AssessmentTable {
  id: Generated<string>;
  stageAssessmentId: string;
  type: AssessmentType;
  stagePoint: string;
  choice: AssessmentChoice;
  confidence: number;
  // Gravado como JSON; lido como objeto.
  probabilities: ColumnType<Record<AssessmentChoice, number>, string, never>;
}

// A Confirmação que depende de respostas: a síntese de um Bloco ou a de uma Etapa.
interface ConfirmationColumns {
  blockId: string | null;
  stage: Stage | null;
}

export interface ImpactAssessmentTable extends ConfirmationColumns {
  id: Generated<string>;
  processId: string;
  // A mudança: a Versão nova de uma resposta (com a anterior) ou uma Revisão de Restrição.
  answerVersionId: string | null;
  previousAnswerVersionId: string | null;
  constraintRevisionId: Generated<string | null>;
  analyzedAnswerVersionIds: Generated<string[]>;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  choice: AssessmentChoice | null;
  confidence: number | null;
  // Gravado como JSON; lido como objeto.
  probabilities: ColumnType<Record<AssessmentChoice, number> | null, string | null, never>;
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Generated<Date>;
}

export interface ConfirmationAnswerVersionTable extends ConfirmationColumns {
  id: Generated<string>;
  processId: string;
  answerVersionId: string;
  basis: ConfirmationBasis;
  impactAssessmentId: string;
  correctedSynthesis: string | null;
  recordedAt: Generated<Date>;
}

export interface StageConfirmationTable {
  processId: string;
  stage: Stage;
  stageAssessmentId: string | null;
  justification: string | null;
  confirmedAt: Generated<Date>;
}

// Opção registrada na Etapa O: proposta pela IA (com a sugestão como veio) ou acrescentada pelo usuário.
export interface OptionTable {
  id: Generated<string>;
  processId: string;
  statement: string;
  description: string | null;
  stagePoints: Generated<string[]>;
  origin: OptionOrigin;
  proposalAttemptId: string | null;
  suggestedStatement: string | null;
  suggestedDescription: string | null;
  createdAt: Generated<Date>;
  acceptedAt: Date | null;
  discardedAt: Date | null;
}

export interface OptionCheckTable {
  id: Generated<string>;
  processId: string;
  createdAt: Generated<Date>;
}

export interface OptionConstraintPairTable {
  id: Generated<string>;
  checkId: string;
  position: number;
  optionId: string;
  constraintId: string;
}

export interface OptionAssessmentTable {
  id: Generated<string>;
  processId: string;
  checkId: string;
  status: "completed" | "failed";
  requestedModel: string;
  jevModel: string | null;
  rubricRevision: string;
  failureReason: AssessorFailureReason | null;
  message: string | null;
  createdAt: Generated<Date>;
}

export interface OptionVerdictTable {
  assessmentId: string;
  pairId: string;
  choice: AssessmentChoice;
  confidence: number;
  // Gravado como JSON; lido como objeto.
  probabilities: ColumnType<Record<AssessmentChoice, number>, string, never>;
}

export interface OptionDecisionTable {
  pairId: string;
  optionAssessmentId: string;
  violates: boolean;
  decidedAt: Generated<Date>;
}

// Linha única de configurações não sensíveis.
export interface SettingsTable {
  id: Generated<boolean>;
  cli: Cli;
  // Modelo de cada CLI; null enquanto o usuário não escolheu um.
  claudeModel: string | null;
  codexModel: string | null;
  grokModel: string | null;
  agyModel: string | null;
  // Nome do perfil do Cloak escolhido; null é o perfil do diretório.
  cloakProfileName: string | null;
  updatedAt: Generated<Date>;
}

export interface Database {
  processes: ProcessTable;
  conversations: ConversationTable;
  aiRequests: AiRequestTable;
  aiRequestAttempts: AiRequestAttemptTable;
  problemStatements: ProblemStatementTable;
  blocks: BlockTable;
  questions: QuestionTable;
  answerVersions: AnswerVersionTable;
  answerDrafts: AnswerDraftTable;
  attemptAnswerVersions: AttemptAnswerVersionTable;
  blockSyntheses: BlockSynthesisTable;
  stagePointCoverage: StagePointCoverageTable;
  constraints: StatedItemTable;
  preferences: StatedItemTable;
  pendencies: PendencyTable;
  stageAssessments: StageAssessmentTable;
  stageAssessmentAnswerVersions: StageAssessmentAnswerVersionTable;
  assessments: AssessmentTable;
  stageConfirmations: StageConfirmationTable;
  impactAssessments: ImpactAssessmentTable;
  confirmationAnswerVersions: ConfirmationAnswerVersionTable;
  conflictChecks: ConflictCheckTable;
  conflictPairs: ConflictPairTable;
  conflictAssessments: ConflictAssessmentTable;
  conflictVerdicts: ConflictVerdictTable;
  conflictDismissals: ConflictDismissalTable;
  constraintRevisions: ConstraintRevisionTable;
  confirmationConstraintRevisions: ConfirmationConstraintRevisionTable;
  options: OptionTable;
  optionChecks: OptionCheckTable;
  optionConstraintPairs: OptionConstraintPairTable;
  optionAssessments: OptionAssessmentTable;
  optionVerdicts: OptionVerdictTable;
  optionDecisions: OptionDecisionTable;
  settings: SettingsTable;
}

export type Db = Kysely<Database>;

export function createDatabase(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
    plugins: [new CamelCasePlugin()],
  });
}
