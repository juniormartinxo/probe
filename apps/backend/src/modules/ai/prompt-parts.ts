import type { AskedQuestion } from "./assistant.ts";

export const stageNames = { P: "Problema", R: "Restrições", O: "Opções", B: "Balanceamento", E: "Execução" } as const;

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
