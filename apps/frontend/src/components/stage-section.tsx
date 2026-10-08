import { useState, type FormEvent } from "react";
import {
  ApiError,
  declareInapplicable,
  newBlockAttempt,
  requestBlock,
  type BlockRequest,
  type ProcessDetail,
  type StagePointState,
} from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { NewAttempt } from "@/components/new-attempt";
import { BlockSynthesis } from "@/components/block-synthesis";
import { Questionnaire } from "@/components/questionnaire";
import { ConfirmedStages, StageConfirmationPanel } from "@/components/stage-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attemptProblem } from "@/refinement";
import { stageName } from "@/stages";

// Etapa atual: os Pontos (abertos, cobertos ou inaplicáveis), as Pendências e os Blocos de
// Perguntas da IA, cada um com a sua síntese. Só aparece depois da Confirmação do enunciado.
// `onChange` recarrega o Processo depois de cada ação.
export function StageSection({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const blockRequest = process.blockRequests.at(-1) ?? null;
  const stageBlocks = process.blocks.filter((block) => block.stage === process.currentStage);
  // Um Bloco novo cabe quando a última solicitação não trouxe Bloco (nova tentativa) ou quando todo
  // Bloco da Etapa tem a síntese confirmada e ainda há Pontos abertos.
  const pendingRequest = blockRequest !== null && blockRequest.status !== "completed";
  const canAskNewBlock =
    stageBlocks.every((block) => block.synthesis !== null) && process.openStagePoints.length > 0;
  return (
    <section className="flex flex-col gap-3">
      <ConfirmedStages confirmations={process.stageConfirmations} />
      <h2 className="text-sm font-semibold">
        Etapa {process.currentStage} · {stageName(process.currentStage)}
      </h2>
      <StagePoints processId={process.id} points={process.stagePoints} onChange={onChange} />
      <OpenPendencies process={process} />
      {process.blocks.map((block) => (
        <div key={block.id} className="flex flex-col gap-2">
          <Questionnaire processId={process.id} block={block} onChange={onChange} />
          <BlockSynthesis
            processId={process.id}
            block={block}
            openStagePoints={process.openStagePoints}
            onChange={onChange}
          />
        </div>
      ))}
      {(pendingRequest || canAskNewBlock) && (
        <BlockRequestStatus
          processId={process.id}
          blockRequest={pendingRequest ? blockRequest : null}
          first={process.blocks.length === 0}
          onChange={onChange}
        />
      )}
      {blockRequest && <AttemptList attempts={blockRequest.attempts} />}
      {process.openStagePoints.length === 0 && !pendingRequest && <StageConfirmationPanel process={process} onChange={onChange} />}
    </section>
  );
}

const statusText = { open: "aberto", covered: "coberto", inapplicable: "inaplicável" } as const;

function StagePoints({
  processId,
  points,
  onChange,
}: {
  processId: string;
  points: StagePointState[];
  onChange: () => void;
}) {
  const open = points.filter((point) => point.status === "open");
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-xs font-medium">
        Pontos da Etapa{" "}
        <span className="text-muted-foreground font-normal">
          · {open.length === 0 ? "todos cobertos ou inaplicáveis" : `${open.length} ainda abertos`}
        </span>
      </p>
      <ul className="flex flex-col gap-2">
        {points.map((point) => (
          <StagePointItem key={point.key} processId={processId} point={point} onChange={onChange} />
        ))}
      </ul>
    </div>
  );
}

function StagePointItem({ processId, point, onChange }: { processId: string; point: StagePointState; onChange: () => void }) {
  const [declaring, setDeclaring] = useState(false);
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await declareInapplicable(processId, point.key, justification);
      setDeclaring(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "stage_point_closed"
          ? "Este Ponto já não está aberto."
          : "Não foi possível declarar o Ponto inaplicável. A justificativa continua aqui; tente de novo.",
      );
    } finally {
      setSaving(false);
      onChange();
    }
  }

  return (
    <li className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={point.status === "open" ? "outline" : "secondary"}>{statusText[point.status]}</Badge>
        <span title={point.description}>{point.name}</span>
        {point.status === "open" && !declaring && (
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setDeclaring(true)}>
            Declarar inaplicável
          </Button>
        )}
      </div>
      {point.status === "inapplicable" && (
        <p className="text-muted-foreground text-xs whitespace-pre-wrap">Justificativa: {point.justification}</p>
      )}
      {declaring && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor={`inapplicable-${point.key}`} className="text-xs font-normal">
            Por que este Ponto não se aplica ao seu caso? A justificativa é obrigatória.
          </Label>
          <Textarea
            id={`inapplicable-${point.key}`}
            value={justification}
            rows={2}
            disabled={saving}
            onChange={(event) => setJustification(event.target.value)}
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setDeclaring(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || justification.trim() === ""}>
              {saving ? "Salvando…" : "Declarar inaplicável"}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function OpenPendencies({ process }: { process: ProcessDetail }) {
  const open = process.pendencies.filter((pendency) => pendency.resolvedAt === null);
  if (open.length === 0) return null;
  return (
    <div className="border-destructive/40 flex flex-col gap-1.5 rounded-lg border p-4 text-sm">
      <p className="text-xs font-medium">Pendências</p>
      <ul className="flex flex-col gap-1">
        {open.map((pendency) => (
          <li key={pendency.id}>
            <span className="font-medium">Informação desconhecida</span> · Pergunta {pendency.question.number} do Bloco{" "}
            {pendency.question.blockNumber}: {pendency.question.wording}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">Se souber a informação depois, responda a Pergunta e a Pendência se resolve.</p>
    </div>
  );
}

function BlockRequestStatus({
  processId,
  blockRequest,
  first,
  onChange,
}: {
  processId: string;
  // A solicitação que ainda não trouxe Bloco; null quando cabe pedir um Bloco novo.
  blockRequest: BlockRequest | null;
  first: boolean;
  onChange: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function send(action: () => Promise<BlockRequest>) {
    setSending(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      // Outra aba pode ter pedido antes; o estado recarregado mostra o que vale.
      if (!(caught instanceof ApiError && caught.status === 409)) setError("Não foi possível pedir as Perguntas à IA.");
    } finally {
      setSending(false);
      onChange();
    }
  }

  if (!blockRequest) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">
          {first
            ? "A IA formula Perguntas sobre o seu caso para cobrir os Pontos desta Etapa."
            : "Ainda há Pontos abertos. A IA formula um Bloco novo para eles, sem repetir o que você já respondeu."}
        </p>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => send(() => requestBlock(processId))}>
          {sending ? "Pedindo…" : first ? "Gerar Perguntas" : "Gerar novo Bloco"}
        </Button>
        {error && <p className="text-destructive w-full text-sm">{error}</p>}
      </div>
    );
  }

  if (blockRequest.status === "running") {
    return <p className="text-muted-foreground rounded-lg border p-4 text-sm">A IA está formulando as Perguntas…</p>;
  }

  const last = blockRequest.attempts.at(-1)!;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm">{attemptProblem(last)}</p>
      {last.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{last.message}</p>}
      <p className="text-muted-foreground text-xs">Seu progresso continua salvo. Você pode tentar de novo, com a mesma CLI ou outra.</p>
      <NewAttempt last={last} open={(cli) => newBlockAttempt(processId, blockRequest.id, cli)} onChange={onChange} />
    </div>
  );
}
