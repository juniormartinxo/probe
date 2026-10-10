import { createHash } from "node:crypto";
import { stageNames } from "../ai/prompt-parts.ts";
import type { AssessmentChoice, ConstraintImpactInput, ImpactedConfirmation, ImpactInput } from "./assessor.ts";
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

const revisionOf = (rubric: { instruction: string; criteria: Record<AssessmentChoice, string> }) =>
  `sha256:${createHash("sha256").update(JSON.stringify(rubric)).digest("hex").slice(0, 16)}`;

export const IMPACT_RUBRIC_REVISION = revisionOf({ instruction: INSTRUCTION, criteria: CRITERIA });

// A rubrica do impacto de uma Revisão de Restrição, com revisão própria.
const CONSTRAINT_INSTRUCTION =
  "O estado traz a Confirmação de uma Etapa que a pessoa fez num Processo de decisão pelo framework PROBE e a revisão " +
  "de uma Restrição que valia quando ela confirmou: a Restrição retirada e a que a substituiu, se houver (uma Restrição " +
  "nova, inegociável, ou uma Preferência, negociável). " +
  "A revisão afeta o que a Confirmação dá por estabelecido, a ponto de ela precisar ser revista? " +
  "Julgue apenas pelo texto explícito; não use conhecimento externo.";

const CONSTRAINT_CRITERIA: Record<AssessmentChoice, string> = {
  yes: "Algo que a Confirmação afirma ou cobre se apoiava na Restrição retirada e deixa de valer, ou muda de forma relevante.",
  no: "A Confirmação continua verdadeira depois da revisão: nada do que ela afirma ou cobre dependia da Restrição retirada.",
  insufficient: "O texto não traz informação suficiente para distinguir sim de não.",
};

export const CONSTRAINT_IMPACT_RUBRIC_REVISION = revisionOf({ instruction: CONSTRAINT_INSTRUCTION, criteria: CONSTRAINT_CRITERIA });

// Abaixo desta confiança, o julgamento do Jev não decide sozinho: o usuário vê a Avaliação e decide se
// abre a Pendência. Não esconde nada; a Avaliação é exibida como veio. O valor tem apoio empírico, sem
// calibração: nos testes reais da One Model Arena (09/10/2026, jev-1.13.0, 314 respostas com gabarito,
// perguntas de outro tipo), as 299 com confiança ≥ 0,7 acertaram, e abaixo disso foram 10 acertos em 15.
export const IMPACT_CONFIDENCE_THRESHOLD = 0.7;

// A pergunta única de cada Avaliação de impacto.
export const IMPACT_KEY = "impacto";

const etapaOf = (confirmation: ImpactedConfirmation) => `${confirmation.stage} (${stageNames[confirmation.stage]})`;

const stageConfirmationOf = (confirmation: Extract<ImpactedConfirmation, { kind: "stage" }>) => ({
  tipo: "Confirmação da Etapa",
  etapa: etapaOf(confirmation),
  pontos: confirmation.stagePoints.map(({ name, description }) => ({ ponto: name, pede: description })),
  respostas: confirmation.answers.map(({ ref, wording, answer }) => ({ pergunta: `[${ref}] ${wording}`, resposta: answer })),
});

// O estado e a pergunta, com a Confirmação e a mudança como dado, separados da instrução.
export function impactRequest(input: ImpactInput): { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> } {
  const { confirmation } = input;
  return {
    state: {
      enunciado: input.problemStatement,
      confirmacao:
        confirmation.kind === "block_synthesis"
          ? {
              tipo: `Síntese do Bloco ${confirmation.blockNumber}`,
              etapa: etapaOf(confirmation),
              sintese: confirmation.synthesis,
              pontosCobertos: confirmation.coveredStagePoints.map(({ name, description }) => ({ ponto: name, pede: description })),
            }
          : stageConfirmationOf(confirmation),
      mudanca: {
        pergunta: `[${input.question.ref}] ${input.question.wording}`,
        respostaAnterior: input.previousAnswer,
        respostaNova: input.newAnswer,
      },
    },
    questions: { [IMPACT_KEY]: { type: "choice", instructions: INSTRUCTION, criteria: { ...CRITERIA } } },
  };
}

const itemOf = ({ statement, scope, unit }: { statement: string; scope: string | null; unit: string | null }) => ({
  enunciado: statement,
  escopo: scope,
  unidade: unit,
});

// O estado e a pergunta da Revisão de Restrição, com a Confirmação e a revisão como dado.
export function constraintImpactRequest(input: ConstraintImpactInput): {
  state: Record<string, unknown>;
  questions: Record<string, ChoiceQuestion>;
} {
  const { constraint, replacement, note } = input.revision;
  return {
    state: {
      enunciado: input.problemStatement,
      confirmacao: stageConfirmationOf(input.confirmation),
      revisao: {
        restricaoRetirada: itemOf(constraint),
        substituta: replacement && { tipo: replacement.kind === "constraint" ? "Restrição" : "Preferência", ...itemOf(replacement.item) },
        nota: note,
      },
    },
    questions: { [IMPACT_KEY]: { type: "choice", instructions: CONSTRAINT_INSTRUCTION, criteria: { ...CONSTRAINT_CRITERIA } } },
  };
}
