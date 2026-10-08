// Porta do Jev. A implementação real chama a API do Jev, em português (ADR 0001); nos testes, uma
// versão falsa a substitui.

import type { ItemStatement } from "../process/constraints-and-preferences.ts";
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
export interface CoverageInput {
  stage: Stage;
  problemStatement: string;
  stagePoints: StagePoint[];
  answers: AssessedAnswer[];
  constraints: ItemStatement[];
  preferences: ItemStatement[];
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

export interface Assessor {
  // O modelo do Jev pedido em cada chamada.
  readonly model: string;
  // Um julgamento para cada Ponto recebido, pela chave do Ponto.
  assessCoverage(input: CoverageInput): Promise<AssessorOutcome<Record<string, Verdict>>>;
}
