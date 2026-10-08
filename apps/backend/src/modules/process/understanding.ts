import { describeAnswer } from "./answers.ts";
import type { StageWork } from "./blocks.ts";
import { inForce, type ConstraintsAndPreferencesState, type ItemStatement } from "./constraints-and-preferences.ts";
import type { Pendency, PendencyReason } from "./pendencies.ts";
import type { ProblemStatement } from "./problem-statement.ts";
import type { StagePointState } from "./stage-point-coverage.ts";
import type { Stage } from "./stage.ts";

// Resumo do entendimento atual do Processo, consultável a qualquer momento: o que foi confirmado, o
// que ainda é provisório e o que está pendente. É montado do que está gravado, sem chamar a IA.
export interface Understanding {
  originalDescription: string;
  problemStatement: string | null;
  currentStage: Stage;
  stagePoints: Pick<StagePointState, "key" | "name" | "status" | "justification" | "absence">[];
  // As Restrições e Preferências em vigor.
  constraints: ItemStatement[];
  preferences: ItemStatement[];
  blocks: {
    number: number;
    // A síntese que o usuário confirmou; null enquanto não há.
    synthesis: string | null;
    // A resposta que vale em cada Pergunta, como o usuário a vê.
    answers: { questionId: string; wording: string; answer: string | null; confirmed: boolean; unknown: boolean }[];
  }[];
  openPendencies: { reason: PendencyReason; wording: string }[];
}

export function understandingOf(process: {
  originalDescription: string;
  currentStage: Stage;
  problemStatement: ProblemStatement | null;
  stagePoints: StageWork["stagePoints"];
  blocks: StageWork["blocks"];
  pendencies: Pendency[];
} & ConstraintsAndPreferencesState): Understanding {
  const statements = (items: ConstraintsAndPreferencesState["constraints"]) =>
    inForce(items).map(({ statement, scope, unit }) => ({ statement, scope, unit }));
  return {
    originalDescription: process.originalDescription,
    problemStatement: process.problemStatement?.statement ?? null,
    currentStage: process.currentStage,
    stagePoints: process.stagePoints.map(({ key, name, status, justification, absence }) => ({
      key,
      name,
      status,
      justification,
      absence,
    })),
    constraints: statements(process.constraints),
    preferences: statements(process.preferences),
    blocks: process.blocks.map((block) => ({
      number: block.number,
      synthesis: block.synthesis?.synthesis ?? null,
      answers: block.questions.map((question) => ({
        questionId: question.id,
        wording: question.wording,
        answer: question.answer ? describeAnswer(question, question.answer.current) : null,
        confirmed: question.answer?.current.confirmed ?? false,
        unknown: question.unknown,
      })),
    })),
    openPendencies: process.pendencies
      .filter((pendency) => pendency.resolvedAt === null)
      .map((pendency) => ({ reason: pendency.reason, wording: pendency.question.wording })),
  };
}
