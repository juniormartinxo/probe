import { createHash } from "node:crypto";
import { comparisonDimensions, type AnswerType, type ComparisonCells } from "../ai/assistant.ts";
import { describeAnswer } from "../process/answers.ts";
import type { Block } from "../process/blocks.ts";
import type { ChosenOption } from "../process/chosen-options.ts";
import type { ComparisonMatrixRow } from "../process/comparison-matrix.ts";
import {
  inForceOf,
  statementsOf,
  type ConstraintsAndPreferencesState,
  type ItemStatement,
  type StatedItem,
} from "../process/constraints-and-preferences.ts";
import type { ExecutionPlanElement, PlanCompatibilityStatus } from "../process/execution-plan.ts";
import type { Option, OptionOrigin, OptionStatus, OptionViability } from "../process/options.ts";
import type { Pendency } from "../process/pendencies.ts";
import type { ProblemStatement, StatementOrigin } from "../process/problem-statement.ts";
import type { Recommendation } from "../process/recommendations.ts";
import type { StageConfirmation } from "../process/stage-confirmations.ts";
import type { StagePointState } from "../process/stage-point-coverage.ts";
import { stages, type Stage } from "../process/stage.ts";
import { synthesisInForce } from "../process/syntheses.ts";

// Relatório do Processo: o conteúdo estruturado que a Revisão final apresenta e a Finalização congela.
// Começa pelo resumo da Decisão, segue com o registro por Etapa e termina no histórico. É montado do
// que está gravado, sem chamar a IA; as datas vão em ISO 8601, como ficam depois de congeladas.
export interface Report {
  identification: { processId: string; createdAt: string; origin: null };
  // A Decisão em poucas linhas: o problema, a Escolha, os descartes e o plano.
  decisionSummary: {
    problemStatement: string;
    chosenOption: string;
    discards: { option: string; reason: string }[];
    executionPlan: { key: string; name: string; text: string }[];
  };
  problem: { originalDescription: string; statement: string; statementOrigin: StatementOrigin };
  // As Restrições e Preferências em vigor; as retiradas ficam no histórico.
  constraints: ItemStatement[];
  preferences: ItemStatement[];
  stages: ReportStage[];
  // As Opções da Etapa O, aceitas ou descartadas, com a viabilidade das aceitas.
  options: {
    statement: string;
    description: string | null;
    origin: OptionOrigin;
    status: Exclude<OptionStatus, "suggested">;
    viability: OptionViability | null;
    violations: string[];
  }[];
  assumptionsAndClarifications: Assumption[];
  // A Matriz qualitativa: o atendimento às Restrições vem dos pares Opção × Restrição; as células, da
  // linha que vale.
  comparison: { option: string; viability: OptionViability; violations: string[]; cells: ComparisonCells | null }[];
  // As Recomendações da IA, identificadas como tal: nenhuma virou Escolha sem o usuário.
  recommendations: { option: string; rationale: string }[];
  // A Escolha e o que a justifica: a linha dela na matriz.
  choice: { option: string; description: string | null; comparison: ComparisonCells | null };
  // As Opções deixadas de lado: pela Escolha (com o motivo), por violarem uma Restrição ou descartadas na Etapa O.
  discardedOptions: { option: string; by: "choice" | "constraint" | "options_stage"; reason: string | null }[];
  executionPlan: {
    key: string;
    name: string;
    text: string;
    compatibility: PlanCompatibilityStatus;
    // A justificativa de quem manteve o elemento contra o Jev, se houver.
    justification: string | null;
  }[];
  history: HistoryEntry[];
}

export interface ReportStage {
  stage: Stage;
  stagePoints: Pick<StagePointState, "key" | "name" | "status" | "justification" | "absence">[];
  confirmation: Pick<StageConfirmation, "withoutAssessment" | "justification"> & { confirmedAt: string } | null;
  blocks: {
    number: number;
    // A síntese confirmada que vale; null enquanto não há.
    synthesis: string | null;
    questions: ReportQuestion[];
  }[];
}

export interface ReportQuestion {
  number: number;
  wording: string;
  subject: string;
  answerType: AnswerType;
  // As alternativas de resposta apresentadas.
  choices: string[];
  // A Pergunta que esta reformula ("1.2"), se alguma.
  reformulates: string | null;
  // A resposta que vale, como o usuário a vê; null sem resposta.
  answer: string | null;
  status: "confirmed" | "provisional" | "unknown" | "unanswered";
}

// O que o Processo assumiu ou esclareceu em vez de responder: Pontos inaplicáveis, ausências
// registradas, esclarecimentos de conflito, Confirmações contra o Jev ou sem ele e elementos do plano
// mantidos contra ele.
export interface Assumption {
  kind: "inapplicable" | "absence" | "clarification" | "confirmed_against_assessment" | "confirmed_without_assessment" | "plan_element_kept";
  stage: Stage;
  subject: string;
  text: string | null;
}

// Cada estado registrado do que pode ser revisto, superado ou válido.
export interface HistoryEntry {
  kind: "answer" | "synthesis" | "constraint" | "preference" | "option" | "comparison" | "choice" | "plan_element";
  subject: string;
  text: string;
  recordedAt: string;
  status: "valid" | "superseded";
}

// O Processo pelo que o relatório precisa, como o detalhe do Processo o traz, e os Pontos de cada Etapa.
export interface ReportSource extends ConstraintsAndPreferencesState {
  id: string;
  createdAt: Date;
  originalDescription: string;
  problemStatement: ProblemStatement | null;
  blocks: Block[];
  pendencies: Pendency[];
  stageConfirmations: StageConfirmation[];
  stagePointsByStage: Record<Stage, StagePointState[]>;
  options: Option[];
  comparisonMatrix: ComparisonMatrixRow[];
  recommendations: Recommendation[];
  chosenOptions: ChosenOption[];
  executionPlan: ExecutionPlanElement[];
}

const iso = (date: Date): string => date.toISOString();

const cellsOf = (row: ComparisonCells): ComparisonCells =>
  Object.fromEntries(comparisonDimensions.map((dimension) => [dimension, row[dimension]])) as unknown as ComparisonCells;

const dimensionNames: Record<keyof ComparisonCells, string> = {
  gains: "Ganhos",
  losses: "Perdas",
  effort: "Esforço",
  scalability: "Escala",
  maintenance: "Manutenção",
  reversibility: "Reversibilidade",
};

const describeCells = (row: ComparisonCells): string =>
  comparisonDimensions.map((dimension) => `${dimensionNames[dimension]}: ${row[dimension]}`).join(" · ");

function stageOf(source: ReportSource, stage: Stage): ReportStage {
  const confirmation = source.stageConfirmations.find((item) => item.stage === stage);
  return {
    stage,
    stagePoints: source.stagePointsByStage[stage].map(({ key, name, status, justification, absence }) => ({ key, name, status, justification, absence })),
    confirmation: confirmation
      ? { confirmedAt: iso(confirmation.confirmedAt), withoutAssessment: confirmation.withoutAssessment, justification: confirmation.justification }
      : null,
    blocks: source.blocks
      .filter((block) => block.stage === stage)
      .map((block) => ({
        number: block.number,
        synthesis: block.synthesis ? synthesisInForce(block.synthesis) : null,
        questions: block.questions.map((question, index) => ({
          number: index + 1,
          wording: question.wording,
          subject: question.subject,
          answerType: question.answerType,
          choices: question.choices,
          reformulates: question.reformulates && `${question.reformulates.blockNumber}.${question.reformulates.number}`,
          answer: question.answer ? describeAnswer(question, question.answer.current) : null,
          status: question.answer
            ? question.answer.current.confirmed
              ? "confirmed"
              : "provisional"
            : question.unknown
              ? "unknown"
              : "unanswered",
        })),
      })),
  };
}

function assumptionsOf(source: ReportSource): Assumption[] {
  const points = stages.flatMap((stage) =>
    source.stagePointsByStage[stage].flatMap((point): Assumption[] => {
      if (point.status === "inapplicable") return [{ kind: "inapplicable", stage, subject: point.name, text: point.justification }];
      if (point.status === "absent") return [{ kind: "absence", stage, subject: point.name, text: point.absence }];
      return [];
    }),
  );
  const clarifications = source.pendencies.flatMap((pendency): Assumption[] =>
    pendency.conflict?.clarification
      ? [
          {
            kind: "clarification",
            stage: pendency.question?.stage ?? pendency.conflict.answers[0].question.stage,
            subject: pendency.conflict.answers.map((answer) => answer.question.wording).join(" × "),
            text: pendency.conflict.clarification,
          },
        ]
      : [],
  );
  const confirmations = source.stageConfirmations.flatMap((confirmation): Assumption[] => {
    const subject = `Confirmação da Etapa ${confirmation.stage}`;
    if (confirmation.justification !== null) {
      return [{ kind: "confirmed_against_assessment", stage: confirmation.stage, subject, text: confirmation.justification }];
    }
    // Havia o que avaliar, e o Jev falhou.
    if (confirmation.stageAssessmentId !== null && confirmation.withoutAssessment) {
      return [{ kind: "confirmed_without_assessment", stage: confirmation.stage, subject, text: null }];
    }
    return [];
  });
  const kept = source.executionPlan.flatMap((element): Assumption[] =>
    element.compatibility.status === "kept"
      ? [{ kind: "plan_element_kept", stage: "E", subject: element.name, text: element.compatibility.decision?.justification ?? null }]
      : [],
  );
  return [...points, ...clarifications, ...confirmations, ...kept];
}

// Os estados de uma sequência, do mais antigo ao que vale.
function sequence(kind: HistoryEntry["kind"], subject: string, states: { text: string; recordedAt: Date }[]): HistoryEntry[] {
  return states.map(({ text, recordedAt }, index) => ({
    kind,
    subject,
    text,
    recordedAt: iso(recordedAt),
    status: index === states.length - 1 ? "valid" : "superseded",
  }));
}

const itemHistory = (kind: "constraint" | "preference", items: StatedItem[]): HistoryEntry[] =>
  items.map((item) => ({
    kind,
    subject: kind === "constraint" ? "Restrição" : "Preferência",
    text: item.statement,
    recordedAt: iso(item.registeredAt),
    status: item.withdrawnAt === null ? "valid" : "superseded",
  }));

function historyOf(source: ReportSource): HistoryEntry[] {
  const answers = source.blocks.flatMap((block) =>
    block.questions.flatMap((question, index) =>
      question.answer
        ? sequence(
            "answer",
            `${block.stage} ${block.number}.${index + 1}: ${question.wording}`,
            [...question.answer.previous].reverse().concat(question.answer.current).map((version) => ({
              text: describeAnswer(question, version),
              recordedAt: version.createdAt,
            })),
          )
        : [],
    ),
  );
  const syntheses = source.blocks.flatMap((block) =>
    block.synthesis
      ? sequence("synthesis", `Síntese do Bloco ${block.number}`, [
          { text: block.synthesis.synthesis, recordedAt: block.synthesis.confirmedAt },
          ...block.synthesis.corrections.map((correction) => ({ text: correction.synthesis, recordedAt: correction.correctedAt })),
        ])
      : [],
  );
  const options = source.options.flatMap((option): HistoryEntry[] =>
    option.status === "suggested"
      ? []
      : [
          {
            kind: "option",
            subject: "Opção",
            text: option.statement,
            recordedAt: iso(option.acceptedAt ?? option.discardedAt ?? option.createdAt),
            status: option.status === "accepted" ? "valid" : "superseded",
          },
        ],
  );
  const comparisons = source.comparisonMatrix.flatMap((row) =>
    row.comparison
      ? sequence(
          "comparison",
          row.option.statement,
          [...row.history, row.comparison].map((comparison) => ({ text: describeCells(comparison), recordedAt: comparison.recordedAt })),
        )
      : [],
  );
  const choices = sequence(
    "choice",
    "Escolha",
    source.chosenOptions.map((chosen) => ({ text: chosen.option.statement, recordedAt: chosen.chosenAt })),
  );
  const plan = source.executionPlan.flatMap((element) =>
    element.current ? sequence("plan_element", element.name, [...element.history, element.current]) : [],
  );
  return [
    ...answers,
    ...syntheses,
    ...itemHistory("constraint", source.constraints),
    ...itemHistory("preference", source.preferences),
    ...options,
    ...comparisons,
    ...choices,
    ...plan,
  ].toSorted((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

// O relatório de um Processo com a Etapa E confirmada: enunciado, Escolha e plano já existem.
export function reportOf(source: ReportSource): Report {
  const statement = source.problemStatement!;
  const chosen = source.chosenOptions.at(-1)!;
  const chosenOption = source.options.find((option) => option.id === chosen.option.id)!;
  const chosenRow = source.comparisonMatrix.find((row) => row.option.id === chosen.option.id);
  const discards = chosen.discards.map(({ option, reason }) => ({ option: option.statement, reason }));
  const plan = source.executionPlan.filter((element) => element.current !== null);
  const violations = (option: Pick<Option, "violations">) => option.violations.map((violation) => violation.statement);
  return {
    identification: { processId: source.id, createdAt: iso(source.createdAt), origin: null },
    decisionSummary: {
      problemStatement: statement.statement,
      chosenOption: chosen.option.statement,
      discards,
      executionPlan: plan.map(({ key, name, current }) => ({ key, name, text: current!.text })),
    },
    problem: { originalDescription: source.originalDescription, statement: statement.statement, statementOrigin: statement.origin },
    ...statementsOf(inForceOf(source)),
    stages: stages.map((stage) => stageOf(source, stage)),
    options: source.options.flatMap((option) =>
      option.status === "suggested"
        ? []
        : [
            {
              statement: option.statement,
              description: option.description,
              origin: option.origin,
              status: option.status,
              viability: option.viability,
              violations: violations(option),
            },
          ],
    ),
    assumptionsAndClarifications: assumptionsOf(source),
    comparison: source.comparisonMatrix.map((row) => ({
      option: row.option.statement,
      viability: row.viability,
      violations: violations(row),
      cells: row.comparison && cellsOf(row.comparison),
    })),
    recommendations: source.recommendations.flatMap(({ recommendation }) =>
      recommendation ? [{ option: recommendation.option.statement, rationale: recommendation.rationale }] : [],
    ),
    choice: {
      option: chosen.option.statement,
      description: chosenOption.description,
      comparison: chosenRow?.comparison ? cellsOf(chosenRow.comparison) : null,
    },
    discardedOptions: [
      ...discards.map(({ option, reason }) => ({ option, by: "choice" as const, reason })),
      ...source.options
        .filter((option) => option.status === "accepted" && option.viability === "inviable")
        .map((option) => ({ option: option.statement, by: "constraint" as const, reason: violations(option).join("; ") })),
      ...source.options
        .filter((option) => option.status === "discarded")
        .map((option) => ({ option: option.statement, by: "options_stage" as const, reason: null })),
    ],
    executionPlan: plan.map(({ key, name, current, compatibility }) => ({
      key,
      name,
      text: current!.text,
      compatibility: compatibility.status,
      justification: compatibility.decision?.justification ?? null,
    })),
    history: historyOf(source),
  };
}

// A impressão digital do relatório: muda com qualquer coisa que ele apresenta.
export const fingerprintOf = (report: Report): string => createHash("sha256").update(JSON.stringify(report)).digest("hex");
