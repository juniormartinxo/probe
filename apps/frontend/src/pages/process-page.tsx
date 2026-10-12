import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, getFinalization, getProcess, reportExportUrl, type Finalization, type ProcessDetail, type Stage } from "@/api";
import { FinalReviewSection } from "@/components/final-review";
import { ProblemStatementSection } from "@/components/problem-statement-section";
import { ReportView } from "@/components/report-view";
import { StageSection } from "@/components/stage-section";
import { UnderstandingPanel } from "@/components/understanding-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { stages, statusName } from "@/stages";

const POLL_INTERVAL_MS = 1_500;

type State =
  | { kind: "loading" }
  | { kind: "loaded"; process: ProcessDetail }
  | { kind: "not-found" }
  | { kind: "error" };

export function ProcessPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(
    () =>
      getProcess(id).then(
        (process) => setState({ kind: "loaded", process }),
        (error: unknown) =>
          // Uma recarga que falha não esconde o Processo já carregado (nem o que está nos campos).
          setState((current) =>
            current.kind === "loaded" ? current : { kind: error instanceof ApiError && error.status === 404 ? "not-found" : "error" },
          ),
      ),
    [id],
  );

  useEffect(() => {
    setState({ kind: "loading" });
    load();
  }, [load]);

  // Enquanto a IA trabalha, o Processo é recarregado até a tentativa terminar.
  const running =
    state.kind === "loaded" &&
    (state.process.refinement?.status === "running" ||
      state.process.blockRequests.at(-1)?.status === "running" ||
      state.process.blocks.some((block) => block.synthesisRequests.at(-1)?.status === "running") ||
      state.process.optionProposals.at(-1)?.status === "running" ||
      state.process.recommendations.at(-1)?.status === "running" ||
      state.process.pendencies.some((pendency) => pendency.conflict?.resolutionQuestion?.status === "running"));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  return (
    <>
      <Link to="/" className="text-muted-foreground hover:text-foreground text-sm">
        ← Processos
      </Link>
      {state.kind === "loading" && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {state.kind === "not-found" && <p className="text-sm">Processo não encontrado.</p>}
      {state.kind === "error" && <p className="text-destructive text-sm">Não foi possível carregar o Processo.</p>}
      {state.kind === "loaded" && <ProcessView process={state.process} onChange={load} />}
    </>
  );
}

function ProcessView({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Processo</h1>
          <p className="text-muted-foreground text-xs">
            Criado em {formatDate(process.createdAt)} · {statusName(process.status)}
            {process.finalizedAt && ` em ${formatDate(process.finalizedAt)}`}
          </p>
        </div>
        <StageIndicator current={process.currentStage} />
      </header>

      {process.status === "finalized" ? <FinalizedReport processId={process.id} /> : <OpenProcess process={process} onChange={onChange} />}
    </>
  );
}

// O relatório congelado pela Finalização: o Processo finalizado é somente leitura.
function FinalizedReport({ processId }: { processId: string }) {
  const [finalization, setFinalization] = useState<Finalization | "error">();
  useEffect(() => {
    let current = true;
    getFinalization(processId).then(
      (loaded) => current && setFinalization(loaded),
      () => current && setFinalization("error"),
    );
    return () => {
      current = false;
    };
  }, [processId]);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm">Relatório da Decisão</CardTitle>
        {finalization && finalization !== "error" && (
          <>
            <p className="text-muted-foreground text-xs">Finalizado em {formatDate(finalization.finalizedAt)}. Somente leitura.</p>
            {/* Cada clique gera o arquivo de novo a partir do relatório congelado, sem mudá-lo. */}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={reportExportUrl(processId, "md")} download>
                  Exportar Markdown
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={reportExportUrl(processId, "pdf")} download>
                  Exportar PDF
                </a>
              </Button>
            </div>
          </>
        )}
      </CardHeader>
      <CardContent>
        {finalization === undefined && <p className="text-muted-foreground text-sm">Carregando…</p>}
        {finalization === "error" && <p className="text-destructive text-sm">Não foi possível carregar o relatório.</p>}
        {finalization && finalization !== "error" && <ReportView report={finalization.report} />}
      </CardContent>
    </Card>
  );
}

function OpenProcess({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  return (
    <>

      <UnderstandingPanel processId={process.id} />

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm">Descrição original</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{process.originalDescription}</p>
        </CardContent>
      </Card>

      <ProblemStatementSection process={process} onChange={onChange} />

      {process.problemStatement && <StageSection process={process} onChange={onChange} />}

      {process.readyForFinalReview && <FinalReviewSection process={process} onChange={onChange} />}
    </>
  );
}

function StageIndicator({ current }: { current: Stage }) {
  return (
    <ol className="flex gap-1" aria-label="Etapas do PROBE">
      {stages.map(({ stage, name }) => (
        <li
          key={stage}
          title={name}
          aria-current={stage === current ? "step" : undefined}
          className={cn(
            "flex size-7 items-center justify-center rounded-md border text-xs font-medium",
            stage === current ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground",
          )}
        >
          {stage}
        </li>
      ))}
    </ol>
  );
}
