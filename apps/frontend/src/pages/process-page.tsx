import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ApiError,
  downloadReport,
  getFinalization,
  getProcess,
  reconsiderProcess,
  requestRefinement,
  spinOffProcess,
  type Finalization,
  type ProcessDetail,
  type ReportFormat,
  type Stage,
} from "@/api";
import { FinalReviewSection } from "@/components/final-review";
import { ProblemStatementSection } from "@/components/problem-statement-section";
import { describe } from "@/components/questionnaire";
import { DecisionSummaryContent, ReportView } from "@/components/report-view";
import { StageSection } from "@/components/stage-section";
import { UnderstandingPanel } from "@/components/understanding-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { derivationText, stages, statusName } from "@/stages";

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
          {process.derivation && (
            <p className="text-muted-foreground text-xs">
              {derivationText[process.derivation.kind]} do{" "}
              <Link to={`/processes/${process.derivation.originProcessId}`} className="underline">
                Processo finalizado em {formatDate(process.derivation.originFinalizedAt)}
              </Link>
              , que continua como foi finalizado.
            </p>
          )}
        </div>
        <StageIndicator current={process.currentStage} />
      </header>

      {process.status === "finalized" ? <FinalizedReport process={process} /> : <OpenProcess process={process} onChange={onChange} />}
    </>
  );
}

// O relatório congelado pela Finalização: o Processo finalizado é somente leitura.
function FinalizedReport({ process }: { process: ProcessDetail }) {
  const processId = process.id;
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
            <ReportExports processId={processId} />
            <Reconsider processId={processId} />
            <SpinOff process={process} />
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

const reportFormats: { format: ReportFormat; label: string }[] = [
  { format: "md", label: "Exportar Markdown" },
  { format: "pdf", label: "Exportar PDF" },
];

// Cada clique gera o arquivo de novo a partir do relatório congelado, sem mudá-lo: uma falha só pede
// outra tentativa.
function ReportExports({ processId }: { processId: string }) {
  const [exporting, setExporting] = useState<ReportFormat>();
  const [failed, setFailed] = useState(false);
  const exportReport = (format: ReportFormat) => {
    setExporting(format);
    setFailed(false);
    downloadReport(processId, format).then(
      () => setExporting(undefined),
      () => {
        setExporting(undefined);
        setFailed(true);
      },
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {reportFormats.map(({ format, label }) => (
          <Button key={format} variant="outline" size="sm" disabled={exporting !== undefined} onClick={() => exportReport(format)}>
            {exporting === format ? "Gerando…" : label}
          </Button>
        ))}
      </div>
      {failed && <p className="text-destructive text-xs">Não foi possível gerar o arquivo. Tente de novo.</p>}
    </div>
  );
}

// A Reconsideração abre um Processo novo com a cópia deste: as respostas, as Confirmações, a Escolha e o
// plano valem lá até você mudá-los. Este continua como foi finalizado.
function Reconsider({ processId }: { processId: string }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const reconsider = () => {
    setCreating(true);
    setFailed(false);
    reconsiderProcess(processId).then(
      (process) => navigate(`/processes/${process.id}`),
      () => {
        setCreating(false);
        setFailed(true);
      },
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs">
        Para revisar esta Decisão, abra uma Reconsideração: um Processo novo que herda as respostas, as Confirmações, a Escolha e o plano.
        Cada mudança passa pela Avaliação de impacto; este Processo fica como está.
      </p>
      <Button variant="outline" size="sm" className="self-start" disabled={creating} onClick={reconsider}>
        {creating ? "Abrindo…" : "Reconsiderar a Decisão"}
      </Button>
      {failed && <p className="text-destructive text-xs">Não foi possível abrir a Reconsideração. Tente de novo.</p>}
    </div>
  );
}

// O Desdobramento abre um Processo novo que estabelece um problema novo: você o descreve e escolhe quais
// respostas deste herdar. Elas chegam como Respostas herdadas e só valem lá depois de reconfirmadas; a
// Decisão deste Processo vai junto só como contexto. Este continua como foi finalizado.
function SpinOff({ process }: { process: ProcessDetail }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  // As respostas que valiam na Finalização: as confirmadas, uma por Pergunta.
  const answers = process.blocks.flatMap((block) =>
    block.questions.flatMap((question, index) =>
      question.answer?.current.confirmed ? [{ block, question, index, version: question.answer.current }] : [],
    ),
  );
  const toggle = (versionId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(versionId);
      else next.delete(versionId);
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFailed(false);
    try {
      const spinoff = await spinOffProcess(process.id, description, [...selected]);
      // Como em qualquer Processo, a IA já começa a propor um enunciado; se o pedido falhar, a página
      // do Desdobramento oferece pedir de novo.
      await requestRefinement(spinoff.id).catch(() => undefined);
      navigate(`/processes/${spinoff.id}`);
    } catch {
      // O texto e a seleção ficam para uma nova tentativa.
      setCreating(false);
      setFailed(true);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs">
          Para estabelecer um problema novo a partir desta Decisão, abra um Desdobramento: você escolhe quais respostas herdar, e elas só valem lá
          depois de reconfirmadas. Este Processo fica como está.
        </p>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
          Desdobrar em um problema novo
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="spinoff-description">Descreva o problema novo com suas palavras</Label>
        <Textarea id="spinoff-description" value={description} rows={4} disabled={creating} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium">Respostas a herdar</legend>
        <p className="text-muted-foreground text-xs">
          Chegam como Respostas herdadas, provisórias até você confirmar a síntese do Bloco delas. A Decisão deste Processo vai junto só
          como contexto, nunca como resposta.
        </p>
        {answers.length === 0 && <p className="text-muted-foreground text-xs">Este Processo não tem respostas confirmadas.</p>}
        <ul className="flex flex-col gap-2">
          {answers.map(({ block, question, index, version }) => {
            const id = `inherit-${version.id}`;
            return (
              <li key={version.id} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={selected.has(version.id)}
                  disabled={creating}
                  onCheckedChange={(checked) => toggle(version.id, checked === true)}
                />
                <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                  <span className="text-sm">
                    Etapa {block.stage} · {block.number}.{index + 1} {question.wording}
                  </span>
                  <span className="text-muted-foreground text-xs whitespace-pre-wrap">{describe(question, version)}</span>
                </Label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {failed && <p className="text-destructive text-xs">Não foi possível abrir o Desdobramento. Seu texto e a seleção continuam aqui; tente de novo.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={creating} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={creating || description.trim() === ""}>
          {creating ? "Abrindo…" : "Abrir Desdobramento"}
        </Button>
      </div>
    </form>
  );
}

// Num Desdobramento, a Decisão da origem, só como contexto, e as Respostas herdadas que ainda esperam
// reconfirmação.
function OriginDecision({ process }: { process: ProcessDetail }) {
  const { derivation } = process;
  if (derivation?.kind !== "spinoff") return null;
  const awaiting = process.blocks
    .filter((block) => block.inherited && !block.synthesis)
    .reduce((count, block) => count + block.questions.length, 0);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm">Decisão da origem</CardTitle>
        <p className="text-muted-foreground text-xs">Só como contexto: não é resposta, Escolha nem plano deste Processo.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <DecisionSummaryContent summary={derivation.originDecision} />
        {awaiting > 0 && (
          <p className="text-muted-foreground text-xs">
            {awaiting === 1 ? "1 Resposta herdada aguarda" : `${awaiting} Respostas herdadas aguardam`} reconfirmação: valem depois da
            Confirmação da síntese do Bloco delas, na Etapa de cada uma.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OpenProcess({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  return (
    <>
      <OriginDecision process={process} />

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
