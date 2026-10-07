import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, getProcess, type ProcessWithConversation, type Stage } from "@/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { stages, statusName } from "@/stages";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; process: ProcessWithConversation }
  | { kind: "not-found" }
  | { kind: "error" };

export function ProcessPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    setState({ kind: "loading" });
    getProcess(id).then(
      (process) => setState({ kind: "loaded", process }),
      (error: unknown) =>
        setState({ kind: error instanceof ApiError && error.status === 404 ? "not-found" : "error" }),
    );
  }, [id]);

  return (
    <>
      <Link to="/" className="text-muted-foreground hover:text-foreground text-sm">
        ← Processos
      </Link>
      {state.kind === "loading" && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {state.kind === "not-found" && <p className="text-sm">Processo não encontrado.</p>}
      {state.kind === "error" && <p className="text-destructive text-sm">Não foi possível carregar o Processo.</p>}
      {state.kind === "loaded" && <ProcessView process={state.process} />}
    </>
  );
}

function ProcessView({ process }: { process: ProcessWithConversation }) {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Processo</h1>
          <p className="text-muted-foreground text-xs">
            Criado em {formatDate(process.createdAt)} · {statusName(process.status)}
          </p>
        </div>
        <StageIndicator current={process.currentStage} />
      </header>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm">Descrição original</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{process.originalDescription}</p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Conversa</h2>
        <p className="text-muted-foreground text-sm">A conversa ainda não começou.</p>
      </section>
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
