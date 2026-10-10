import { createHash } from "node:crypto";
import type { AssessedConstraint, AssessedOption, AssessmentChoice, OptionViolationInput } from "./assessor.ts";
import type { ChoiceQuestion } from "./coverage-rubric.ts";
import { IMPACT_CONFIDENCE_THRESHOLD } from "./impact-rubric.ts";

// Rubrica da Avaliação de violação de Restrição por Opção, versionada com o código e enviada em
// português (ADR 0001). Mudar qualquer texto abaixo muda a revisão gravada em cada Avaliação.
const PREAMBLE =
  "O estado traz o enunciado de um problema, as Opções que a pessoa considera para resolvê-lo e as Restrições que ela " +
  "registrou num Processo de decisão pelo framework PROBE. Restrições são inegociáveis: uma Opção que viola uma " +
  "Restrição é inviável, quaisquer que sejam as suas vantagens. " +
  "Julgue apenas pelo texto explícito; não use conhecimento externo para supor como a Opção seria executada.";

// {opcao} e {restricao} são as referências da Opção e da Restrição, dadas pela aplicação.
const INSTRUCTION =
  "Adotar a Opção [{opcao}] viola a Restrição [{restricao}]? " +
  "Considere o que a Opção diz, o escopo e a unidade da Restrição, quando houver, e o enunciado.";

const CRITERIA: Record<AssessmentChoice, string> = {
  yes: "Adotar a Opção descumpre a Restrição: não há como seguir a Opção e cumprir a Restrição ao mesmo tempo.",
  no: "A Opção cumpre a Restrição, ou a Restrição não se aplica a ela.",
  insufficient: "O texto não traz informação suficiente para distinguir sim de não.",
};

export const OPTION_RUBRIC_REVISION = `sha256:${createHash("sha256")
  .update(JSON.stringify({ preamble: PREAMBLE, instruction: INSTRUCTION, criteria: CRITERIA }))
  .digest("hex")
  .slice(0, 16)}`;

// Abaixo desta confiança, o julgamento de um par não decide sozinho: o usuário vê a Avaliação e decide
// se a Opção viola a Restrição. É o limite da Avaliação de impacto (ADR 0003), estendido à violação
// pelo ADR 0006; não esconde nada.
export const OPTION_CONFIDENCE_THRESHOLD = IMPACT_CONFIDENCE_THRESHOLD;

// Substituição em passagem única: as referências vêm da aplicação.
const instructionFor = (option: string, constraint: string): string =>
  `${PREAMBLE}\n\n${INSTRUCTION.replace(/\{(opcao|restricao)\}/g, (_, key: string) => (key === "opcao" ? option : constraint))}`;

const optionOf = ({ ref, statement, description }: AssessedOption) => ({ opcao: `[${ref}] ${statement}`, detalhes: description });

const constraintOf = ({ ref, statement, scope, unit }: AssessedConstraint) => ({ restricao: `[${ref}] ${statement}`, escopo: scope, unidade: unit });

// O estado, com cada Opção e cada Restrição uma vez, e uma pergunta por par, pela chave do par. As
// Opções e as Restrições vão como dado, separadas das instruções.
export function optionRequest(input: OptionViolationInput): { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> } {
  const options = new Map<string, AssessedOption>();
  const constraints = new Map<string, AssessedConstraint>();
  for (const { option, constraint } of input.pairs) {
    options.set(option.ref, option);
    constraints.set(constraint.ref, constraint);
  }
  return {
    state: {
      enunciado: input.problemStatement,
      opcoes: [...options.values()].map(optionOf),
      restricoes: [...constraints.values()].map(constraintOf),
    },
    questions: Object.fromEntries(
      input.pairs.map(({ key, option, constraint }) => [
        key,
        { type: "choice", instructions: instructionFor(option.ref, constraint.ref), criteria: { ...CRITERIA } },
      ]),
    ),
  };
}
