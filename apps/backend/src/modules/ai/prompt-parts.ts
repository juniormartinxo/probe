import type { StagePoint } from "../process/stage-points.ts";
import type { ItemStatement } from "../process/constraints-and-preferences.ts";
import type { Stage } from "../process/stage.ts";
import type { AskedQuestion, ConfirmedStageAnswers } from "./assistant.ts";

export const stageNames = { P: "Problema", R: "Restrições", O: "Opções", B: "Balanceamento", E: "Execução" } as const;

// Referência a uma Pergunta como a IA a devolve: "1.2" ou, copiada do prompt, "[1.2]".
export const questionRef = (value: string): string => value.trim().replace(/^\[(.*)\]$/, "$1").trim();

// Pontos abertos, como entram nos prompts: chave, nome e o que o Ponto pede.
export const stagePointsText = (points: StagePoint[]): string =>
  points.map((point) => `- ${point.key}: ${point.name}. ${point.description}`).join("\n");

// Perguntas já feitas, como entram nos prompts: referência, Pontos, pergunta e resposta. O texto é
// do usuário e vai dentro dos delimitadores de dado.
export function askedQuestionsText(questions: AskedQuestion[]): string {
  if (questions.length === 0) return "(nenhuma)";
  return questions
    .map((question) => {
      const answer = question.unknown
        ? "a pessoa registrou que não sabe"
        : question.answer === null
          ? "sem resposta"
          : question.answer;
      return `[${question.ref}] (Pontos: ${question.stagePoints.join(", ")}) ${question.wording}\nResposta: ${answer}`;
    })
    .join("\n\n");
}

// Respostas confirmadas das Etapas anteriores, como entram nos prompts: por Etapa, referência,
// pergunta e resposta. O texto é do usuário e vai dentro dos delimitadores de dado.
export function confirmedStagesText(confirmed: ConfirmedStageAnswers[]): string {
  if (confirmed.length === 0) return "(nenhuma)";
  return confirmed
    .map(({ stage, answers }) => {
      const lines = answers.map(({ ref, wording, answer }) => `[${ref}] ${wording}\nResposta: ${answer}`);
      return `Etapa ${stage} (${stageNames[stage]})\n${lines.length > 0 ? lines.join("\n\n") : "(nenhuma resposta)"}`;
    })
    .join("\n\n");
}

// O que cada Etapa pede de particular às Perguntas, além dos Pontos.
const stageGuidance: Partial<Record<Stage, string>> = {
  R:
    "Nesta Etapa, ajude a pessoa a separar Restrições (condições inegociáveis, que eliminam Opções) de Preferências (desejáveis, mas negociáveis). " +
    "Quando uma resposta envolver prazo, valor, volume ou outro limite, pergunte o escopo a que ele se aplica e a unidade em que é medido " +
    "(por exemplo, dias úteis ou corridos, por mês ou por ano). Não haver prazo, ou nenhum sistema envolvido, também é uma resposta válida.",
};

export const stageGuidanceText = (stage: Stage): string => {
  const guidance = stageGuidance[stage];
  return guidance ? `\n\n${guidance}` : "";
};

const itemText = ({ statement, scope, unit }: ItemStatement): string => {
  const details = [scope && `escopo: ${scope}`, unit && `unidade: ${unit}`].filter(Boolean);
  return `- ${statement}${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
};

const itemsText = (items: ItemStatement[]): string => (items.length > 0 ? items.map(itemText).join("\n") : "(nenhuma)");

// Restrições e Preferências em vigor, como entram nos prompts, separadas. O texto é do usuário e vai
// dentro dos delimitadores de dado.
export const constraintsAndPreferencesText = ({ constraints, preferences }: { constraints: ItemStatement[]; preferences: ItemStatement[] }): string =>
  `Restrições (inegociáveis):\n${itemsText(constraints)}\nPreferências (negociáveis):\n${itemsText(preferences)}`;
