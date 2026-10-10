import { createHash } from "node:crypto";
import { stageNames } from "../ai/prompt-parts.ts";
import type { AssessmentChoice, ConflictAnswer, ConflictInput } from "./assessor.ts";
import type { ChoiceQuestion } from "./coverage-rubric.ts";
import { IMPACT_CONFIDENCE_THRESHOLD } from "./impact-rubric.ts";

// Rubrica da Avaliação de conflito, versionada com o código e enviada em português (ADR 0001). Mudar
// qualquer texto abaixo muda a revisão gravada em cada Avaliação.
const PREAMBLE =
  "O estado traz o enunciado de um problema, as Restrições e Preferências que a pessoa registrou e respostas que ela " +
  "confirmou num Processo de decisão pelo framework PROBE. Restrições são inegociáveis; Preferências são desejáveis, " +
  "mas negociáveis: deixar de atender uma Preferência não é conflito. " +
  "Julgue apenas pelo texto explícito; não use conhecimento externo.";

// {a} e {b} são as referências das duas respostas, dadas pela aplicação.
const INSTRUCTION =
  "As respostas [{a}] e [{b}] são incompatíveis entre si, a ponto de não poderem valer ao mesmo tempo? " +
  "Considere as duas respostas e o contexto do estado.";

const CRITERIA: Record<AssessmentChoice, string> = {
  yes:
    "As duas respostas não podem valer juntas: cumprir uma impede cumprir a outra, como um prazo que termina antes de " +
    "uma dependência obrigatória ficar disponível.",
  no: "As duas respostas podem valer juntas, ou só se chocam com uma Preferência.",
  insufficient: "O texto não traz informação suficiente para distinguir sim de não.",
};

export const CONFLICT_RUBRIC_REVISION = `sha256:${createHash("sha256")
  .update(JSON.stringify({ preamble: PREAMBLE, instruction: INSTRUCTION, criteria: CRITERIA }))
  .digest("hex")
  .slice(0, 16)}`;

// Abaixo desta confiança, o julgamento de um par não decide sozinho: o usuário vê a Avaliação e decide
// se abre a Pendência de conflito. É o limite da Avaliação de impacto (ADR 0003), estendido ao conflito
// pelo ADR 0004; não esconde nada.
export const CONFLICT_CONFIDENCE_THRESHOLD = IMPACT_CONFIDENCE_THRESHOLD;

// Substituição em passagem única: as referências vêm da aplicação.
const instructionFor = (a: string, b: string): string =>
  `${PREAMBLE}\n\n${INSTRUCTION.replace(/\{(a|b)\}/g, (_, key: string) => (key === "a" ? a : b))}`;

const answerOf = ({ ref, stage, wording, answer }: ConflictAnswer) => ({
  pergunta: `[${ref}] ${wording}`,
  etapa: `${stage} (${stageNames[stage]})`,
  resposta: answer,
});

// O estado, com cada resposta uma vez, e uma pergunta por par, pela chave do par. As respostas e os
// itens vão como dado, separados das instruções.
export function conflictRequest(input: ConflictInput): { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> } {
  const answers = new Map<string, ConflictAnswer>();
  for (const { answer, other } of input.pairs) {
    answers.set(answer.ref, answer);
    answers.set(other.ref, other);
  }
  return {
    state: {
      enunciado: input.problemStatement,
      restricoes: input.constraints.map(({ statement, scope, unit }) => ({ restricao: statement, escopo: scope, unidade: unit })),
      preferencias: input.preferences.map(({ statement, scope, unit }) => ({ preferencia: statement, escopo: scope, unidade: unit })),
      respostas: [...answers.values()].map(answerOf),
    },
    questions: Object.fromEntries(
      input.pairs.map(({ key, answer, other }) => [
        key,
        { type: "choice", instructions: instructionFor(answer.ref, other.ref), criteria: { ...CRITERIA } },
      ]),
    ),
  };
}
