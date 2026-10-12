import { createHash } from "node:crypto";
import type { AssessmentChoice, PlanCompatibilityInput } from "./assessor.ts";
import type { ChoiceQuestion } from "./coverage-rubric.ts";
import { IMPACT_CONFIDENCE_THRESHOLD } from "./impact-rubric.ts";

// Rubrica da Avaliação de compatibilidade de um elemento do Plano de execução com a Escolha,
// versionada com o código e enviada em português (ADR 0001). Mudar qualquer texto abaixo muda a
// revisão gravada em cada Avaliação.
const PREAMBLE =
  "O estado traz o enunciado de um problema, a Escolha que a pessoa fez num Processo de decisão pelo framework PROBE " +
  "(a Opção escolhida e o motivo de cada Opção descartada) e um elemento do plano de execução que ela escreveu. " +
  "Julgue apenas pelo texto explícito; não use conhecimento externo para supor como a Escolha seria executada.";

// {nome} e {pede} vêm do Ponto da etapa que o elemento cobre, mantido pela aplicação (ADR 0002).
const INSTRUCTION =
  'O elemento "{nome}" do plano é compatível com a Escolha? O elemento pede: {pede} ' +
  "Num plano B, recorrer a outra Opção se a escolhida não funcionar é compatível; abandoná-la antes de tentá-la, não.";

const CRITERIA: Record<AssessmentChoice, string> = {
  yes: "O elemento serve à execução da Opção escolhida ou, sendo o plano B, diz o que fazer se ela não funcionar.",
  no: "O elemento contradiz a Escolha: executa outra Opção no lugar da escolhida ou não tem relação com ela.",
  insufficient: "O texto não traz informação suficiente para distinguir sim de não.",
};

export const PLAN_RUBRIC_REVISION = `sha256:${createHash("sha256")
  .update(JSON.stringify({ preamble: PREAMBLE, instruction: INSTRUCTION, criteria: CRITERIA }))
  .digest("hex")
  .slice(0, 16)}`;

// Só `yes` com pelo menos esta confiança dá o elemento por compatível sem o usuário; abaixo dela, com
// `no` ou com `insufficient`, o usuário decide. É o limite da Avaliação de impacto (ADR 0003),
// estendido à compatibilidade pelo ADR 0008.
export const PLAN_CONFIDENCE_THRESHOLD = IMPACT_CONFIDENCE_THRESHOLD;

// A pergunta única de cada Avaliação de compatibilidade.
export const PLAN_KEY = "compatibilidade";

// Substituição em passagem única: um marcador dentro do texto do Ponto não é reinterpretado.
const instructionFor = ({ name, description }: { name: string; description: string }): string =>
  `${PREAMBLE}\n\n${INSTRUCTION.replace(/\{(nome|pede)\}/g, (_, key: string) => (key === "nome" ? name : description))}`;

// O estado e a pergunta, com a Escolha e o elemento como dado, separados da instrução.
export function planRequest(input: PlanCompatibilityInput): { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> } {
  const { chosenOption, element } = input;
  return {
    state: {
      enunciado: input.problemStatement,
      escolha: {
        opcao: chosenOption.statement,
        detalhes: chosenOption.description,
        descartes: chosenOption.discards.map(({ statement, reason }) => ({ opcao: statement, motivo: reason })),
      },
      elemento: { ponto: element.name, texto: element.text },
    },
    questions: { [PLAN_KEY]: { type: "choice", instructions: instructionFor(element), criteria: { ...CRITERIA } } },
  };
}
