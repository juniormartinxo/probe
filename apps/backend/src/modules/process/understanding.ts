import { describeAnswer } from "./answers.ts";
import type { StageWork } from "./blocks.ts";
import { inForceOf, statementsOf, type ConstraintsAndPreferencesState, type ItemStatements } from "./constraints-and-preferences.ts";
import type { Pendency, PendencyReason } from "./pendencies.ts";
import type { ProblemStatement } from "./problem-statement.ts";
import type { StagePointState } from "./stage-point-coverage.ts";
import type { Stage } from "./stage.ts";
import { synthesisInForce } from "./syntheses.ts";

// Resumo do entendimento atual do Processo, consultável a qualquer momento: o que foi confirmado, o
// que ainda é provisório e o que está pendente. É montado do que está gravado, sem chamar a IA.
export interface Understanding extends ItemStatements {
  originalDescription: string;
  problemStatement: string | null;
  currentStage: Stage;
  stagePoints: Pick<StagePointState, "key" | "name" | "status" | "justification" | "absence">[];
  // Restrições e Preferências: as em vigor.
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
    ...statementsOf(inForceOf(process)),
    blocks: process.blocks.map((block) => ({
      number: block.number,
      synthesis: block.synthesis ? synthesisInForce(block.synthesis) : null,
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
