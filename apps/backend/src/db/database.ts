import { CamelCasePlugin, Kysely, PostgresDialect, type ColumnType, type Generated } from "kysely";
import pg from "pg";
import type { AttemptStatus, Operation } from "../modules/ai/ai-requests.ts";
import type { AnswerType, Cli, CloakProfile, FailureReason } from "../modules/ai/assistant.ts";
import type { AssessmentChoice, AssessorFailureReason } from "../modules/assessments/assessor.ts";
import type { AssessmentType } from "../modules/assessments/stage-assessments.ts";
import type { PendencyReason } from "../modules/process/pendencies.ts";
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
  questionId: string;
  openedAt: Generated<Date>;
  resolvedAt: Date | null;
  resolvedByAnswerVersionId: string | null;
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

export interface StageConfirmationTable {
  processId: string;
  stage: Stage;
  stageAssessmentId: string | null;
  justification: string | null;
  confirmedAt: Generated<Date>;
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
  settings: SettingsTable;
}

export type Db = Kysely<Database>;

export function createDatabase(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
    plugins: [new CamelCasePlugin()],
  });
}
