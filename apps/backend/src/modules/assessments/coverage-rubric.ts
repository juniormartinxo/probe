import { createHash } from "node:crypto";
import { stageNames } from "../ai/prompt-parts.ts";
import { hasAny } from "../process/constraints-and-preferences.ts";
import type { StagePoint } from "../process/stage-points.ts";
import type { AssessmentChoice, CoverageInput } from "./assessor.ts";

// Rubrica da Avaliação de cobertura, versionada com o código e enviada em português (ADR 0001). Não
// há calibração: a Avaliação é exibida como vier. Mudar qualquer texto abaixo muda a revisão gravada
// em cada Avaliação.
const PREAMBLE =
  "O estado traz o enunciado de um problema e as respostas que a pessoa confirmou numa Etapa do framework PROBE. " +
  "Quando o estado traz Restrições e Preferências que a pessoa registrou, elas contam como respostas. " +
  "Julgue apenas pelo texto explícito das respostas; não use conhecimento externo para completar o que falta.";

// {nome} e {pede} vêm do Ponto da etapa, mantido pela aplicação (ADR 0002).
const INSTRUCTION =
  'As respostas confirmadas cobrem o Ponto "{nome}"? O Ponto pede: {pede} ' +
  "Conta só o que as respostas dizem; uma Pergunta feita sobre o Ponto, sem resposta que o trate, não o cobre.";

const CRITERIA: Record<AssessmentChoice, string> = {
  yes: "As respostas tratam, de forma explícita, o que o Ponto pede.",
  no: "As respostas não tratam o que o Ponto pede.",
  insufficient: "O texto não traz informação suficiente para distinguir sim de não.",
};

export const COVERAGE_RUBRIC_REVISION = `sha256:${createHash("sha256")
  .update(JSON.stringify({ preamble: PREAMBLE, instruction: INSTRUCTION, criteria: CRITERIA }))
  .digest("hex")
  .slice(0, 16)}`;

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<AssessmentChoice, string>;
}

// Substituição em passagem única: um marcador dentro do texto do Ponto não é reinterpretado.
const instructionFor = (point: StagePoint): string =>
  `${PREAMBLE}\n\n${INSTRUCTION.replace(/\{(nome|pede)\}/g, (_, key: string) => (key === "nome" ? point.name : point.description))}`;

// O estado e as perguntas, uma por Ponto, pela chave do Ponto. As respostas vão como dado, num
// objeto, separadas das instruções.
export function coverageRequest(input: CoverageInput): {
  state: Record<string, unknown>;
  questions: Record<string, ChoiceQuestion>;
} {
  return {
    state: {
      enunciado: input.problemStatement,
      etapa: `${input.stage} (${stageNames[input.stage]})`,
      respostas: input.answers.map(({ ref, wording, answer }) => ({ pergunta: `[${ref}] ${wording}`, resposta: answer })),
      ...(hasAny(input) && {
        restricoes: input.constraints.map(({ statement, scope, unit }) => ({ restricao: statement, escopo: scope, unidade: unit })),
        preferencias: input.preferences.map(({ statement, scope, unit }) => ({ preferencia: statement, escopo: scope, unidade: unit })),
      }),
    },
    questions: Object.fromEntries(
      input.stagePoints.map((point) => [point.key, { type: "choice", instructions: instructionFor(point), criteria: { ...CRITERIA } }]),
    ),
  };
}
