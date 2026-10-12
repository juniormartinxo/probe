import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ComparisonCells, DecisionSummary, ItemStatement, OptionViability, OriginChange, Report, ReportAssumption, ReportHistoryEntry, ReportStage } from "@/api";
import { dimensions } from "@/components/balancing";
import { itemDetails } from "@/components/constraints-and-preferences";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { derivationText, stageName, stagePointStatusText } from "@/stages";

const viabilityText: Record<OptionViability, string> = { viable: "viável", inviable: "inviável", undecided: "sem decisão" };

const questionStatusText: Record<ReportStage["blocks"][number]["questions"][number]["status"], string> = {
  confirmed: "confirmada",
  provisional: "provisória",
  unknown: "informação desconhecida",
  unanswered: "sem resposta",
};

const assumptionText: Record<ReportAssumption["kind"], string> = {
  inapplicable: "Ponto inaplicável",
  absence: "Ausência registrada",
  clarification: "Esclarecimento de conflito",
  confirmed_against_assessment: "Confirmada contra a Avaliação do Jev",
  confirmed_without_assessment: "Confirmada sem Avaliação (Jev em falha)",
  plan_element_kept: "Elemento do plano mantido contra o Jev",
};

const historyKindText: Record<ReportHistoryEntry["kind"], string> = {
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Cells({ cells }: { cells: ComparisonCells }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
      {dimensions.map(({ key, name }) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="whitespace-pre-wrap">{cells[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

function Items({ items, empty }: { items: ItemStatement[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted-foreground text-xs">{empty}</p>;
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-5">
      {items.map((item, index) => (
        <li key={index}>
          {item.statement}
          {itemDetails(item) && <span className="text-muted-foreground"> ({itemDetails(item)})</span>}
        </li>
      ))}
    </ul>
  );
}

// Uma mudança em relação à origem, como o relatório exportado a escreve: "—" no que não havia.
const describeChange = ({ subject, before, after }: OriginChange): string => `${subject}: ${before ?? "—"} → ${after ?? "—"}`;

// Num Processo derivado, de onde ele veio e, numa Reconsideração, o que mudou em relação à origem; num
// Desdobramento, a Decisão da origem, só como contexto.
export function OriginSection({ report }: { report: Report }) {
  const { origin } = report.identification;
  if (!origin) return null;
  const from = (
    <p className="text-muted-foreground text-xs">
      {derivationText[origin.kind]} do{" "}
      <Link to={`/processes/${origin.processId}`} className="underline">
        Processo finalizado em {formatDate(origin.finalizedAt)}
      </Link>
      .
    </p>
  );
  if (origin.kind === "spinoff") {
    return (
      <Section title="Decisão da origem">
        {from}
        <p className="text-muted-foreground text-xs">Só como contexto: não é resposta, Escolha nem plano deste Processo.</p>
        <DecisionSummaryContent summary={origin.decision} />
      </Section>
    );
  }
  return (
    <Section title="O que mudou em relação à origem">
      {from}
      {origin.changes.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nada mudou em relação à origem.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-0.5 pl-5">
          {origin.changes.map((change, index) => (
            <li key={index} className="whitespace-pre-wrap">
              {describeChange(change)}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DecisionSummarySection({ report }: { report: Report }) {
  return (
    <Section title="Resumo da Decisão">
      <DecisionSummaryContent summary={report.decisionSummary} />
    </Section>
  );
}

// A Decisão em poucas linhas: o problema, a Escolha, os descartes e o plano.
export function DecisionSummaryContent({ summary }: { summary: DecisionSummary }) {
  return (
    <>
      <p className="whitespace-pre-wrap">{summary.problemStatement}</p>
      <p>
        <span className="text-muted-foreground">Escolha: </span>
        {summary.chosenOption}
      </p>
      {summary.discards.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs">
          {summary.discards.map((discard) => (
            <li key={discard.option}>
              {discard.option}: <span className="text-muted-foreground">{discard.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-0.5">
        {summary.executionPlan.map((element) => (
          <li key={element.key}>
            <span className="text-muted-foreground">{element.name}: </span>
            {element.text}
          </li>
        ))}
      </ul>
    </>
  );
}

export function ProblemSection({ report }: { report: Report }) {
  return (
    <Section title="Problema">
      <div>
        <p className="text-muted-foreground text-xs">Descrição original</p>
        <p className="whitespace-pre-wrap">{report.problem.originalDescription}</p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs">Enunciado confirmado</p>
        <p className="whitespace-pre-wrap">{report.problem.statement}</p>
      </div>
    </Section>
  );
}

export function ConstraintsAndPreferencesSection({ report }: { report: Report }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Restrições">
        <Items items={report.constraints} empty="Nenhuma Restrição em vigor." />
      </Section>
      <Section title="Preferências">
        <Items items={report.preferences} empty="Nenhuma Preferência em vigor." />
      </Section>
    </div>
  );
}

// A Escolha e o que a justifica (a linha dela na matriz), com as concessões: o que ela perde e as
// Opções deixadas de lado.
export function ChoiceSection({ report }: { report: Report }) {
  return (
    <Section title="Escolha e justificativa">
      <div>
        <p className="font-medium">{report.choice.option}</p>
        {report.choice.description && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{report.choice.description}</p>}
      </div>
      {report.choice.comparison ? (
        <Cells cells={report.choice.comparison} />
      ) : (
        <p className="text-muted-foreground text-xs">A Opção escolhida não tem linha na Matriz qualitativa.</p>
      )}
    </Section>
  );
}

export function DiscardsSection({ report }: { report: Report }) {
  return (
    <Section title="Opções descartadas">
      {report.discardedOptions.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nenhuma outra Opção.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-0.5 pl-5">
          {report.discardedOptions.map((discard, index) => (
            <li key={index}>
              {discard.option} <span className="text-muted-foreground text-xs">({discardText[discard.by]})</span>
              {discard.reason && <span className="text-muted-foreground">: {discard.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function PlanSection({ report }: { report: Report }) {
  return (
    <Section title="Plano de execução">
      <ul className="flex flex-col gap-2">
        {report.executionPlan.map((element) => (
          <li key={element.key}>
            <p className="text-muted-foreground text-xs">
              {element.name}
              {element.compatibility === "kept" && " · mantido contra o Jev"}
            </p>
            <p className="whitespace-pre-wrap">{element.text}</p>
            {element.justification && <p className="text-muted-foreground text-xs">Justificativa: {element.justification}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StageRecord({ stage }: { stage: ReportStage }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="font-medium">
        Etapa {stage.stage} · {stageName(stage.stage)}
        {stage.confirmation && (
          <span className="text-muted-foreground text-xs font-normal"> · confirmada em {formatDate(stage.confirmation.confirmedAt)}</span>
        )}
      </p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {stage.stagePoints.map((point) => (
          <li key={point.key}>
            {point.name}: {stagePointStatusText[point.status]}
            {point.justification && <span className="text-muted-foreground"> ({point.justification})</span>}
          </li>
        ))}
      </ul>
      {stage.blocks.map((block) => (
        <div key={block.number} className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Bloco {block.number}
            {block.inherited && " · Respostas herdadas"}
          </p>
          <ol className="flex flex-col gap-2">
            {block.questions.map((question) => (
              <li key={question.number}>
                <p>
                  {block.number}.{question.number} {question.wording}
                  {question.reformulates && <span className="text-muted-foreground text-xs"> (reformula a {question.reformulates})</span>}
                </p>
                {question.choices.length > 0 && (
                  <p className="text-muted-foreground text-xs">Alternativas apresentadas: {question.choices.join("; ")}</p>
                )}
                <p className="text-xs">
                  {question.answer ?? "—"} <Badge variant="outline">{questionStatusText[question.status]}</Badge>
                </p>
              </li>
            ))}
          </ol>
          {block.synthesis && <p className="text-xs whitespace-pre-wrap">Síntese: {block.synthesis}</p>}
        </div>
      ))}
    </div>
  );
}

// O relatório inteiro, do geral ao detalhe: o resumo da Decisão, o registro por Etapa, as suposições e
// esclarecimentos, a comparação das Opções, a Escolha, os descartes, o plano e, por último, o histórico.
export function ReportView({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <OriginSection report={report} />
      <DecisionSummarySection report={report} />
      <ProblemSection report={report} />
      <ConstraintsAndPreferencesSection report={report} />
      <Section title="Registro por Etapa">
        {report.stages.map((stage) => (
          <StageRecord key={stage.stage} stage={stage} />
        ))}
      </Section>
      <Section title="Opções">
        <ul className="flex list-disc flex-col gap-0.5 pl-5">
          {report.options.map((option, index) => (
            <li key={index}>
              {option.statement}
              <span className="text-muted-foreground text-xs">
                {" "}
                ({option.origin === "ai" ? "sugerida pela IA" : "sua"} ·{" "}
                {option.status === "discarded" ? "descartada" : option.viability ? viabilityText[option.viability] : "aceita"})
              </span>
              {option.violations.length > 0 && <span className="text-muted-foreground text-xs">: viola {option.violations.join("; ")}</span>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Suposições e esclarecimentos">
        {report.assumptionsAndClarifications.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nenhuma.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.assumptionsAndClarifications.map((assumption, index) => (
              <li key={index}>
                <span className="text-muted-foreground text-xs">
                  {assumptionText[assumption.kind]} · Etapa {assumption.stage}:{" "}
                </span>
                {assumption.subject}
                {assumption.text && <span className="text-muted-foreground">: {assumption.text}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Comparação das Opções">
        <ul className="flex flex-col gap-3">
          {report.comparison.map((row, index) => (
            <li key={index} className="flex flex-col gap-1">
              <p>
                {row.option} <Badge variant="outline">{viabilityText[row.viability]}</Badge>
              </p>
              {row.violations.length > 0 && <p className="text-muted-foreground text-xs">Viola: {row.violations.join("; ")}</p>}
              {row.cells ? <Cells cells={row.cells} /> : <p className="text-muted-foreground text-xs">Sem linha na matriz.</p>}
            </li>
          ))}
        </ul>
        {report.recommendations.length > 0 && (
          <div>
            <p className="text-muted-foreground text-xs">Recomendações da IA (sugestões, nenhuma virou Escolha sozinha)</p>
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs">
              {report.recommendations.map((recommendation, index) => (
                <li key={index}>
                  “{recommendation.option}”: {recommendation.rationale}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
      <ChoiceSection report={report} />
      <DiscardsSection report={report} />
      <PlanSection report={report} />
      <Section title="Histórico">
        <ul className="flex flex-col gap-1 text-xs">
          {report.history.map((entry, index) => (
            <li key={index} className={entry.status === "superseded" ? "text-muted-foreground" : undefined}>
              <Badge variant={entry.status === "valid" ? "secondary" : "outline"}>{entry.status === "valid" ? "válido" : "superado"}</Badge>{" "}
              {formatDate(entry.recordedAt)} · {historyKindText[entry.kind]} · {entry.subject}: {entry.text}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
