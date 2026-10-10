import { useState, type FormEvent } from "react";
import {
  ApiError,
  declareInapplicable,
  newBlockAttempt,
  recordAbsence,
  requestBlock,
  type BlockRequest,
  type ProcessDetail,
  type StagePointState,
} from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { NewAttempt } from "@/components/new-attempt";
import { BlockSynthesis } from "@/components/block-synthesis";
import { Conflicts } from "@/components/conflicts";
import { ConstraintsAndPreferences } from "@/components/constraints-and-preferences";
import { Questionnaire } from "@/components/questionnaire";
import { Reassessments } from "@/components/reassessments";
import { ConfirmedStages, StageConfirmationPanel } from "@/components/stage-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attemptProblem } from "@/refinement";
import { stageName, stagePointStatusText } from "@/stages";

// Etapa atual: os Pontos (abertos, cobertos, inaplicáveis ou com a ausência registrada), as
// Restrições e Preferências, o que precisa ser revisto, as respostas em conflito, as Pendências e os Blocos de Perguntas da IA, cada um com a sua síntese. Só aparece depois da Confirmação do enunciado.
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
      <ConstraintsAndPreferences process={process} onChange={onChange} />
      <Reassessments process={process} onChange={onChange} />
      <Conflicts process={process} onChange={onChange} />
      <OpenPendencies process={process} />
      {process.blocks.map((block) => (
        <div key={block.id} className="flex flex-col gap-2">
          <Questionnaire
            processId={process.id}
            block={block}
            underReassessment={new Set(process.reassessments.map((reassessment) => reassessment.question.id))}
            impactAssessments={process.impactAssessments}
            onChange={onChange}
          />
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
          · {open.length === 0 ? "nenhum aberto" : `${open.length} ainda abertos`}
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
  const [confirmingAbsence, setConfirmingAbsence] = useState(false);
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await close(
      () => declareInapplicable(processId, point.key, justification),
      "Não foi possível declarar o Ponto inaplicável. A justificativa continua aqui; tente de novo.",
    );
  }

  async function close(action: () => Promise<unknown>, failure: string) {
    setSaving(true);
    setError(undefined);
    try {
      await action();
      setDeclaring(false);
      setConfirmingAbsence(false);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "stage_point_closed" ? "Este Ponto já não está aberto." : failure);
    } finally {
      setSaving(false);
      onChange();
    }
  }

  return (
    <li className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={point.status === "open" ? "outline" : "secondary"}>{stagePointStatusText[point.status]}</Badge>
        <span title={point.description}>{point.name}</span>
        {point.status === "open" && !declaring && !confirmingAbsence && (
          <div className="ml-auto flex gap-1">
            {point.absence && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={saving}
                title="A ausência registrada conta como cobertura do Ponto."
                onClick={() => setConfirmingAbsence(true)}
              >
                {point.absence}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={saving} onClick={() => setDeclaring(true)}>
              Declarar inaplicável
            </Button>
          </div>
        )}
      </div>
      {confirmingAbsence && (
        <div className="flex flex-col gap-2">
          <p className="text-xs">
            Registrar “{point.absence}” para este Ponto? A ausência conta como cobertura e não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setConfirmingAbsence(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => close(() => recordAbsence(processId, point.key), "Não foi possível registrar a ausência; tente de novo.")}
            >
              {saving ? "Registrando…" : "Confirmar"}
            </Button>
          </div>
        </div>
      )}
      {point.status === "absent" && <p className="text-muted-foreground text-xs">{point.absence}</p>}
      {!declaring && error && <p className="text-destructive text-xs">{error}</p>}
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
  // As de reavaliação aparecem com o que precisa ser revisto; as de conflito, com as respostas em conflito.
  const open = process.pendencies.filter((pendency) => pendency.resolvedAt === null && pendency.reason === "unknown_information");
  if (open.length === 0) return null;
  return (
    <div className="border-destructive/40 flex flex-col gap-1.5 rounded-lg border p-4 text-sm">
      <p className="text-xs font-medium">Pendências</p>
      <ul className="flex flex-col gap-1">
        {open.map((pendency) => {
          // A de informação desconhecida sempre fica numa Pergunta.
          const question = pendency.question!;
          return (
            <li key={pendency.id}>
              <span className="font-medium">Informação desconhecida</span> · Pergunta {question.number} do Bloco{" "}
              {question.blockNumber}: {question.wording}
            </li>
          );
        })}
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
