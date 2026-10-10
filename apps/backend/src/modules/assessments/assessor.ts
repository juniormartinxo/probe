// Porta do Jev. A implementação real chama a API do Jev, em português (ADR 0001); nos testes, uma
// versão falsa a substitui.

import type { ItemKind, ItemStatement, ItemStatements } from "../process/constraints-and-preferences.ts";
import type { StagePoint } from "../process/stage-points.ts";
import type { Stage } from "../process/stage.ts";

// Respostas da primitiva Choice do Jev em toda Avaliação.
export const assessmentChoices = ["yes", "no", "insufficient"] as const;

export type AssessmentChoice = (typeof assessmentChoices)[number];

// Julgamento do Jev como veio: a escolha mais provável, a distribuição entre as três e a confiança.
export interface Verdict {
  choice: AssessmentChoice;
  probabilities: Record<AssessmentChoice, number>;
  confidence: number;
}

// Resposta confirmada, como o Jev a recebe.
export interface AssessedAnswer {
  // "2.1": Pergunta 1 do Bloco 2.
  ref: string;
  wording: string;
  answer: string;
}

// O que o Jev recebe para avaliar, Ponto a Ponto, se as respostas confirmadas da Etapa os cobrem,
// com as Restrições e Preferências em vigor, que o usuário registrou.
export interface CoverageInput extends ItemStatements {
  stage: Stage;
  problemStatement: string;
  stagePoints: StagePoint[];
  answers: AssessedAnswer[];
}

// A Confirmação sobre a qual se avalia o impacto, como o Jev a recebe: a síntese de um Bloco, com os
// Pontos que ela cobriu, ou a de uma Etapa, com os Pontos e as respostas confirmadas da Etapa.
export type ImpactedConfirmation =
  | { kind: "block_synthesis"; stage: Stage; blockNumber: number; synthesis: string; coveredStagePoints: StagePoint[] }
  | { kind: "stage"; stage: Stage; stagePoints: StagePoint[]; answers: AssessedAnswer[] };

// O que o Jev recebe para avaliar se a Versão nova de uma resposta afeta uma Confirmação que
// dependia da Versão anterior.
export interface ImpactInput {
  problemStatement: string;
  confirmation: ImpactedConfirmation;
  question: { ref: string; wording: string };
  previousAnswer: string;
  newAnswer: string;
}

// O que o Jev recebe para avaliar se uma Revisão de Restrição afeta uma Confirmação de Etapa que
// sustentava a Restrição revista: a retirada, a que a substituiu (se houver) e a nota do usuário.
export interface ConstraintImpactInput {
  problemStatement: string;
  confirmation: Extract<ImpactedConfirmation, { kind: "stage" }>;
  revision: { constraint: ItemStatement; replacement: { kind: ItemKind; item: ItemStatement } | null; note: string | null };
}

// Resposta confirmada num par avaliado quanto a conflito, com a Etapa da Pergunta.
export interface ConflictAnswer extends AssessedAnswer {
  stage: Stage;
}

// Par de respostas confirmadas: a que acabou de ser confirmada e outra já confirmada (ou outra do mesmo
// Bloco). `key` identifica o par no julgamento.
export interface ConflictPairInput {
  key: string;
  answer: ConflictAnswer;
  other: ConflictAnswer;
}

// Esclarecimento com que o usuário resolveu uma Pendência de conflito, com as duas respostas como
// estavam então.
export interface ConflictClarification {
  answers: [ConflictAnswer, ConflictAnswer];
  clarification: string;
}

// O que o Jev recebe para avaliar, par a par, se respostas confirmadas são incompatíveis entre si, com
// as Restrições e Preferências em vigor e os esclarecimentos do usuário como contexto.
export interface ConflictInput extends ItemStatements {
  problemStatement: string;
  clarifications: ConflictClarification[];
  pairs: ConflictPairInput[];
}

export type AssessorFailureReason =
  // A chave do Jev não está no ambiente do backend.
  | "jev_not_configured"
  // Sem resposta, fora do ar, sobrecarregado ou sem responder no prazo.
  | "jev_unavailable"
  | "jev_unauthenticated"
  | "jev_rate_limited"
  | "jev_error"
  | "invalid_output";

export type AssessorOutcome<T> =
  // `model`: o modelo do Jev que respondeu.
  | { status: "completed"; model: string; result: T }
  | { status: "failed"; reason: AssessorFailureReason; message: string };

// O desfecho de uma chamada ao Assessor, qualquer que seja ele: uma exceção vira falha do Jev.
export const failureOnThrow = <T>(call: () => Promise<AssessorOutcome<T>>): Promise<AssessorOutcome<T>> =>
  call().catch(
    (error: unknown): AssessorOutcome<never> => ({
      status: "failed",
      reason: "jev_error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );

export interface Assessor {
  // O modelo do Jev pedido em cada chamada.
  readonly model: string;
  // Um julgamento para cada Ponto recebido, pela chave do Ponto.
  assessCoverage(input: CoverageInput): Promise<AssessorOutcome<Record<string, Verdict>>>;
  // Um julgamento: `yes`, a mudança afeta a Confirmação; `no`, não afeta.
  assessImpact(input: ImpactInput): Promise<AssessorOutcome<Verdict>>;
  // Um julgamento: `yes`, a Revisão de Restrição afeta a Confirmação da Etapa; `no`, não afeta.
  assessConstraintImpact(input: ConstraintImpactInput): Promise<AssessorOutcome<Verdict>>;
  // Um julgamento para cada par recebido, pela chave do par: `yes`, as respostas são incompatíveis.
  assessConflicts(input: ConflictInput): Promise<AssessorOutcome<Record<string, Verdict>>>;
}
