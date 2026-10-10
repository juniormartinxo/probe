import { createHash } from "node:crypto";
import { stageNames } from "../ai/prompt-parts.ts";
import type { AssessmentChoice, ImpactInput } from "./assessor.ts";
import type { ChoiceQuestion } from "./coverage-rubric.ts";

// Rubrica da Avaliação de impacto, versionada com o código e enviada em português (ADR 0001). Mudar
// qualquer texto abaixo muda a revisão gravada em cada Avaliação.
const INSTRUCTION =
  "O estado traz uma Confirmação que a pessoa fez num Processo de decisão pelo framework PROBE e a mudança de uma " +
  "resposta em que essa Confirmação se apoiava: a resposta anterior e a nova. " +
  "A mudança afeta o que a Confirmação dá por estabelecido, a ponto de ela precisar ser revista? " +
  "Julgue apenas pelo texto explícito; não use conhecimento externo.";

const CRITERIA: Record<AssessmentChoice, string> = {
  yes: "A resposta nova contradiz, invalida ou muda de forma relevante algo que a Confirmação afirma ou cobre.",
  no: "A Confirmação continua verdadeira com a resposta nova: a mudança não toca no que ela afirma ou cobre.",
  insufficient: "O texto não traz informação suficiente para distinguir sim de não.",
};

export const IMPACT_RUBRIC_REVISION = `sha256:${createHash("sha256")
  .update(JSON.stringify({ instruction: INSTRUCTION, criteria: CRITERIA }))
  .digest("hex")
  .slice(0, 16)}`;

// Abaixo desta confiança, o julgamento do Jev não decide sozinho: o usuário vê a Avaliação e decide se
// abre a Pendência. Não esconde nada; a Avaliação é exibida como veio. O valor tem apoio empírico, sem
// calibração: nos testes reais da One Model Arena (09/10/2026, jev-1.13.0, 314 respostas com gabarito,
// perguntas de outro tipo), as 299 com confiança ≥ 0,7 acertaram, e abaixo disso foram 10 acertos em 15.
export const IMPACT_CONFIDENCE_THRESHOLD = 0.7;

// A pergunta única de cada Avaliação de impacto.
export const IMPACT_KEY = "impacto";

// O estado e a pergunta, com a Confirmação e a mudança como dado, separados da instrução.
export function impactRequest(input: ImpactInput): { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> } {
  const { confirmation } = input;
  const etapa = `${confirmation.stage} (${stageNames[confirmation.stage]})`;
  return {
    state: {
      enunciado: input.problemStatement,
      confirmacao:
        confirmation.kind === "block_synthesis"
          ? {
              tipo: `Síntese do Bloco ${confirmation.blockNumber}`,
              etapa,
              sintese: confirmation.synthesis,
              pontosCobertos: confirmation.coveredStagePoints.map(({ name, description }) => ({ ponto: name, pede: description })),
            }
          : {
              tipo: "Confirmação da Etapa",
              etapa,
              pontos: confirmation.stagePoints.map(({ name, description }) => ({ ponto: name, pede: description })),
              respostas: confirmation.answers.map(({ ref, wording, answer }) => ({ pergunta: `[${ref}] ${wording}`, resposta: answer })),
            },
      mudanca: {
        pergunta: `[${input.question.ref}] ${input.question.wording}`,
        respostaAnterior: input.previousAnswer,
        respostaNova: input.newAnswer,
      },
    },
    questions: { [IMPACT_KEY]: { type: "choice", instructions: INSTRUCTION, criteria: { ...CRITERIA } } },
  };
}
