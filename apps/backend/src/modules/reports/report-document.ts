import { comparisonDimensions, type ComparisonCells } from "../ai/assistant.ts";
import { comparisonNames, stageNames } from "../ai/prompt-parts.ts";
import type { ItemStatement } from "../process/constraints-and-preferences.ts";
import type { OptionViability } from "../process/options.ts";
import type { StagePointState } from "../process/stage-point-coverage.ts";
import type { FrozenFinalization } from "../process/finalization.ts";
import type { Assumption, DecisionSummary, HistoryEntry, Report, ReportOrigin, ReportQuestion, ReportStage } from "./report.ts";

// O relatório congelado como documento: títulos, parágrafos, listas e tabelas, na ordem da tela. As
// exportações em Markdown e em PDF são duas formas de escrever o mesmo documento.
export type DocumentNode =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  // `label`: o rótulo que antecede o texto ("Escolha: "); `note`: texto secundário, em cinza no PDF.
  | { kind: "paragraph"; text: string; label?: string; note?: boolean }
  // Cada item, em linhas: a primeira é o item, as demais o detalham.
  | { kind: "list"; items: string[][] }
  // `columns`: as colunas estreitas (sem quebra de linha) e as largas, que dividem o espaço que sobra;
  // sem ela, só a última é larga.
  | { kind: "table"; header: string[]; rows: string[][]; columns?: ("narrow" | "wide")[] };

export interface ReportDocument {
  title: string;
  // A data da Finalização (ISO 8601): a do arquivo, que não muda de uma exportação para outra.
  finalizedAt: string;
  nodes: DocumentNode[];
}

// Os textos da tela do relatório (apps/frontend/src/components/report-view.tsx).
const viabilityText: Record<OptionViability, string> = { viable: "viável", inviable: "inviável", undecided: "sem decisão" };

const questionStatusText: Record<ReportQuestion["status"], string> = {
  confirmed: "confirmada",
  provisional: "provisória",
  unknown: "informação desconhecida",
  unanswered: "sem resposta",
};

const stagePointStatusText: Record<StagePointState["status"], string> = {
  open: "aberto",
  covered: "coberto",
  inapplicable: "inaplicável",
  absent: "ausência registrada",
  chosen: "coberto pela Escolha",
  planned: "coberto pelo plano",
};

const assumptionText: Record<Assumption["kind"], string> = {
  inapplicable: "Ponto inaplicável",
  absence: "Ausência registrada",
  clarification: "Esclarecimento de conflito",
  confirmed_against_assessment: "Confirmada contra a Avaliação do Jev",
  confirmed_without_assessment: "Confirmada sem Avaliação (Jev em falha)",
  plan_element_kept: "Elemento do plano mantido contra o Jev",
};

const historyKindText: Record<HistoryEntry["kind"], string> = {
  answer: "Resposta",
  synthesis: "Síntese",
  constraint: "Restrição",
  preference: "Preferência",
  option: "Opção",
  comparison: "Matriz",
  choice: "Escolha",
  plan_element: "Plano",
};

const discardText: Record<Report["discardedOptions"][number]["by"], string> = {
  choice: "descartada pela Escolha",
  constraint: "viola uma Restrição",
  options_stage: "descartada na Etapa O",
};

// As datas no fuso de quem usa o PROBE, para que exportar duas vezes, em qualquer servidor, dê o mesmo.
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const formatDate = (iso: string): string => dateFormat.format(new Date(iso));

const heading = (level: 1 | 2 | 3 | 4, text: string): DocumentNode => ({ kind: "heading", level, text });
const paragraph = (text: string, options: { label?: string; note?: boolean } = {}): DocumentNode => ({ kind: "paragraph", text, ...options });
const list = (items: string[][]): DocumentNode => ({ kind: "list", items });

const itemDetails = ({ scope, unit }: ItemStatement): string => [scope && `escopo: ${scope}`, unit && `unidade: ${unit}`].filter(Boolean).join(" · ");

const items = (statements: ItemStatement[], empty: string): DocumentNode =>
  statements.length === 0
    ? paragraph(empty, { note: true })
    : list(statements.map((item) => [itemDetails(item) ? `${item.statement} (${itemDetails(item)})` : item.statement]));

const cells = (row: ComparisonCells): DocumentNode => ({
  kind: "table",
  header: ["Dimensão", "Texto"],
  columns: ["narrow", "wide"],
  rows: comparisonDimensions.map((dimension) => [comparisonNames[dimension], row[dimension]]),
});

const derivationText: Record<ReportOrigin["kind"], string> = { reconsideration: "Reconsideração", spinoff: "Desdobramento" };

// Num Processo derivado, de onde ele veio e, numa Reconsideração, o que mudou em relação à origem; num
// Desdobramento, a Decisão da origem, só como contexto.
function origin({ identification: { origin } }: Report): DocumentNode[] {
  if (!origin) return [];
  const from = paragraph(`${derivationText[origin.kind]} do Processo ${origin.processId}, finalizado em ${formatDate(origin.finalizedAt)}.`, {
    label: "Origem",
  });
  if (origin.kind === "spinoff") {
    return [
      from,
      heading(2, "Decisão da origem"),
      paragraph("Só como contexto: não é resposta, Escolha nem plano deste Processo.", { note: true }),
      ...summaryNodes(origin.decision),
    ];
  }
  return [
    from,
    heading(2, "O que mudou em relação à origem"),
    origin.changes.length === 0
      ? paragraph("Nada mudou em relação à origem.", { note: true })
      : list(
          origin.changes.map(({ subject, before, after }) => [
            `${subject}: ${before ?? "—"} → ${after ?? "—"}`,
          ]),
        ),
  ];
}

function decisionSummary({ decisionSummary: summary }: Report): DocumentNode[] {
  return [heading(2, "Resumo da Decisão"), ...summaryNodes(summary)];
}

function summaryNodes(summary: DecisionSummary): DocumentNode[] {
  return [
    paragraph(summary.problemStatement),
    paragraph(summary.chosenOption, { label: "Escolha" }),
    ...(summary.discards.length > 0 ? [list(summary.discards.map((discard) => [`${discard.option}: ${discard.reason}`]))] : []),
    list(summary.executionPlan.map((element) => [`${element.name}: ${element.text}`])),
  ];
}

function stageRecord(stage: ReportStage): DocumentNode[] {
  const confirmed = stage.confirmation ? ` · confirmada em ${formatDate(stage.confirmation.confirmedAt)}` : "";
  return [
    heading(3, `Etapa ${stage.stage} · ${stageNames[stage.stage]}${confirmed}`),
    list(stage.stagePoints.map((point) => [`${point.name}: ${stagePointStatusText[point.status]}${point.justification ? ` (${point.justification})` : ""}`])),
    ...stage.blocks.flatMap((block) => [
      heading(4, `Bloco ${block.number}${block.inherited ? " · Respostas herdadas" : ""}`),
      list(
        block.questions.map((question) => [
          `${block.number}.${question.number} ${question.wording}${question.reformulates ? ` (reformula a ${question.reformulates})` : ""}`,
          ...(question.choices.length > 0 ? [`Alternativas apresentadas: ${question.choices.join("; ")}`] : []),
          `${question.answer ?? "—"} (${questionStatusText[question.status]})`,
        ]),
      ),
      ...(block.synthesis ? [paragraph(block.synthesis, { label: "Síntese" })] : []),
    ]),
  ];
}

function options(report: Report): DocumentNode[] {
  return [
    heading(2, "Opções"),
    list(
      report.options.map((option) => {
        const origin = option.origin === "ai" ? "sugerida pela IA" : "sua";
        const status = option.status === "discarded" ? "descartada" : option.viability ? viabilityText[option.viability] : "aceita";
        const violations = option.violations.length > 0 ? `: viola ${option.violations.join("; ")}` : "";
        return [`${option.statement} (${origin} · ${status})${violations}`];
      }),
    ),
  ];
}

function assumptions(report: Report): DocumentNode[] {
  const all = report.assumptionsAndClarifications;
  return [
    heading(2, "Suposições e esclarecimentos"),
    all.length === 0
      ? paragraph("Nenhuma.", { note: true })
      : list(all.map((assumption) => [`${assumptionText[assumption.kind]} · Etapa ${assumption.stage}: ${assumption.subject}${assumption.text ? `: ${assumption.text}` : ""}`])),
  ];
}

function comparison(report: Report): DocumentNode[] {
  return [
    heading(2, "Comparação das Opções"),
    ...report.comparison.flatMap((row) => [
      heading(3, `${row.option} (${viabilityText[row.viability]})`),
      ...(row.violations.length > 0 ? [paragraph(row.violations.join("; "), { label: "Viola", note: true })] : []),
      row.cells ? cells(row.cells) : paragraph("Sem linha na matriz.", { note: true }),
    ]),
    ...(report.recommendations.length > 0
      ? [
          paragraph("Recomendações da IA (sugestões, nenhuma virou Escolha sozinha)", { note: true }),
          list(report.recommendations.map((recommendation) => [`“${recommendation.option}”: ${recommendation.rationale}`])),
        ]
      : []),
  ];
}

// A Escolha e o que a justifica (a linha dela na matriz).
function choice(report: Report): DocumentNode[] {
  const { option, description, comparison } = report.choice;
  return [
    heading(2, "Escolha e justificativa"),
    paragraph(option),
    ...(description ? [paragraph(description, { note: true })] : []),
    comparison ? cells(comparison) : paragraph("A Opção escolhida não tem linha na Matriz qualitativa.", { note: true }),
  ];
}

// As Opções deixadas de lado por qualquer caminho, não só os descartes da Escolha.
function discardedOptions(report: Report): DocumentNode[] {
  return [
    heading(2, "Opções descartadas"),
    report.discardedOptions.length === 0
      ? paragraph("Nenhuma outra Opção.", { note: true })
      : list(report.discardedOptions.map((discard) => [`${discard.option} (${discardText[discard.by]})${discard.reason ? `: ${discard.reason}` : ""}`])),
  ];
}

function plan(report: Report): DocumentNode[] {
  return [
    heading(2, "Plano de execução"),
    ...report.executionPlan.flatMap((element) => [
      paragraph(element.text, { label: `${element.name}${element.compatibility === "kept" ? " · mantido contra o Jev" : ""}` }),
      ...(element.justification ? [paragraph(element.justification, { label: "Justificativa", note: true })] : []),
    ]),
  ];
}

function history(report: Report): DocumentNode[] {
  return [
    heading(2, "Histórico"),
    {
      kind: "table",
      header: ["Estado", "Data", "Tipo", "Assunto", "Texto"],
      columns: ["narrow", "narrow", "narrow", "wide", "wide"],
      rows: report.history.map((entry) => [
        entry.status === "valid" ? "válido" : "superado",
        formatDate(entry.recordedAt),
        historyKindText[entry.kind],
        entry.subject,
        entry.text,
      ]),
    },
  ];
}

// O relatório que a Finalização congelou, do geral ao detalhe, como a tela o mostra.
export function reportDocument({ finalizedAt, report }: FrozenFinalization): ReportDocument {
  return {
    title: "Relatório da Decisão",
    finalizedAt: finalizedAt.toISOString(),
    nodes: [
      heading(1, "Relatório da Decisão"),
      paragraph(`Finalizado em ${formatDate(finalizedAt.toISOString())}.`, { note: true }),
      ...origin(report),
      ...decisionSummary(report),
      heading(2, "Problema"),
      paragraph(report.problem.originalDescription, { label: "Descrição original" }),
      paragraph(report.problem.statement, { label: "Enunciado confirmado" }),
      heading(2, "Restrições"),
      items(report.constraints, "Nenhuma Restrição em vigor."),
      heading(2, "Preferências"),
      items(report.preferences, "Nenhuma Preferência em vigor."),
      heading(2, "Registro por Etapa"),
      ...report.stages.flatMap(stageRecord),
      ...options(report),
      ...assumptions(report),
      ...comparison(report),
      ...choice(report),
      ...discardedOptions(report),
      ...plan(report),
      ...history(report),
    ],
  };
}
