import type { StagePoint } from "../process/stage-points.ts";
import type { AskedQuestion } from "./assistant.ts";

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
