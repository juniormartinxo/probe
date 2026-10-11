import type { StagePoint } from "../process/stage-points.ts";
import type { ItemStatement, ItemStatements } from "../process/constraints-and-preferences.ts";
import type { OptionStatus, OptionViability } from "../process/options.ts";
import type { Stage } from "../process/stage.ts";
import type { AskedQuestion, ComparedOption, ComparisonCells, ConfirmedStageAnswers, KnownOption } from "./assistant.ts";

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
  B:
    "Nesta Etapa, ajude a pessoa a enxergar as concessões entre as Opções que ela aceitou (abaixo): o que cada uma ganha e perde, " +
    "como se comporta quando a demanda cresce e o esforço de mantê-la. Opções que violam uma Restrição são inviáveis e nada as compensa. " +
    "Não pergunte qual Opção ela escolhe nem recomende uma: a Escolha é registrada por ela à parte.",
  O:
    "Nesta Etapa, ajude a pessoa a explorar caminhos para o problema: se ele pode deixar de existir, qual a solução mais simples " +
    "(inclusive manual), qual entrega a maior parte do resultado com pouco esforço e o quanto cada Opção é reversível. " +
    "As Opções que ela já aceitou vêm abaixo; pergunte sobre elas quando ajudar, sem inventar Opções nem escolher uma.",
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
export const constraintsAndPreferencesText = ({ constraints, preferences }: ItemStatements): string =>
  `Restrições (inegociáveis):\n${itemsText(constraints)}\nPreferências (negociáveis):\n${itemsText(preferences)}`;

const viabilityNames: Record<OptionViability, string> = { viable: "viável", inviable: "inviável", undecided: "viabilidade sem decisão" };

const comparisonNames: Record<keyof ComparisonCells, string> = {
  gains: "Ganhos",
  losses: "Perdas",
  effort: "Esforço",
  scalability: "Escala",
  maintenance: "Manutenção",
  reversibility: "Reversibilidade",
};

// Opções aceitas, como entram no prompt da Recomendação: referência, viabilidade, Restrições violadas
// e a linha da matriz que o usuário escreveu, se há. O texto é do usuário ou da IA e vai dentro dos
// delimitadores de dado.
export function comparedOptionsText(options: ComparedOption[]): string {
  if (options.length === 0) return "(nenhuma)";
  return options
    .map(({ ref, statement, description, viability, violatedConstraints, comparison }) => {
      const lines = [`[${ref}] (${viabilityNames[viability]}) ${statement}`];
      if (description) lines.push(description);
      if (violatedConstraints.length > 0) lines.push(`Viola: ${violatedConstraints.join("; ")}`);
      lines.push(
        comparison
          ? Object.entries(comparisonNames)
              .map(([key, name]) => `${name}: ${comparison[key as keyof ComparisonCells]}`)
              .join("\n")
          : "Matriz: a pessoa ainda não escreveu esta linha.",
      );
      return lines.join("\n");
    })
    .join("\n\n");
}

const optionStatusNames: Record<OptionStatus, string> = { suggested: "sugerida", accepted: "aceita", discarded: "descartada" };

// Opções já registradas, como entram nos prompts: o estado e, numa aceita, as Restrições que ela viola.
// O texto é do usuário ou da IA e vai dentro dos delimitadores de dado.
export function knownOptionsText(options: KnownOption[]): string {
  if (options.length === 0) return "(nenhuma)";
  return options
    .map(({ statement, description, status, violatedConstraints }) => {
      const violations = violatedConstraints.length > 0 ? `\nViola: ${violatedConstraints.join("; ")}` : "";
      return `- (${optionStatusNames[status]}) ${statement}${description ? `\n${description}` : ""}${violations}`;
    })
    .join("\n");
}
