import { useState } from "react";
import { ApiError, newBlockAttempt, requestBlock, type BlockRequest, type ProcessDetail } from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { Questionnaire } from "@/components/questionnaire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { attemptProblem } from "@/refinement";
import { stageName } from "@/stages";

// Etapa atual: os Pontos ainda não cobertos e os Blocos de Perguntas da IA. Só aparece depois da
// Confirmação do enunciado. `onChange` recarrega o Processo depois de cada ação.
export function StageSection({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const blockRequest = process.blockRequests.at(-1) ?? null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        Etapa {process.currentStage} · {stageName(process.currentStage)}
      </h2>
      <OpenStagePoints process={process} />
      {process.blocks.map((block) => (
        <Questionnaire key={block.id} processId={process.id} block={block} onChange={onChange} />
      ))}
      {process.blocks.length === 0 && (
        <BlockRequestStatus processId={process.id} blockRequest={blockRequest} onChange={onChange} />
      )}
      {blockRequest && <AttemptList attempts={blockRequest.attempts} />}
    </section>
  );
}

function OpenStagePoints({ process }: { process: ProcessDetail }) {
  if (process.openStagePoints.length === 0) {
    return <p className="text-muted-foreground text-xs">Todos os Pontos desta Etapa estão cobertos.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground text-xs">Pontos ainda não cobertos:</span>
      {process.openStagePoints.map((point) => (
        <Badge key={point.key} variant="outline" title={point.description}>
          {point.name}
        </Badge>
      ))}
    </div>
  );
}

function BlockRequestStatus({
  processId,
  blockRequest,
  onChange,
}: {
  processId: string;
  blockRequest: BlockRequest | null;
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
          A IA formula Perguntas sobre o seu caso para cobrir os Pontos desta Etapa.
        </p>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => send(() => requestBlock(processId))}>
          {sending ? "Pedindo…" : "Gerar Perguntas"}
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
      <p className="text-muted-foreground text-xs">Seu progresso continua salvo. Você pode tentar de novo.</p>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={sending}
          onClick={() => send(() => newBlockAttempt(processId, blockRequest.id))}
        >
          {sending ? "Pedindo…" : "Tentar novamente"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
