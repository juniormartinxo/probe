import { useState, type FormEvent } from "react";
import {
  ApiError,
  confirmSynthesis,
  newSynthesisAttempt,
  requestSynthesis,
  type Block,
  type ConfirmedSynthesis,
  type StagePoint,
  type SynthesisProposal,
  type SynthesisRequest,
} from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { attemptProblem } from "@/refinement";

const originText = { proposal: "síntese da IA aceita como veio", corrected: "corrigida a partir da síntese da IA" } as const;

// Um Bloco está pronto para a síntese quando cada Pergunta tem resposta ou foi declarada desconhecida.
export const isBlockComplete = (block: Block) => block.questions.every((question) => question.answer || question.unknown);

// Síntese do Bloco: a IA propõe uma síntese e sugere a cobertura dos Pontos abertos; o usuário
// confirma ou corrige, e escolhe quais Pontos dá por cobertos. `onChange` recarrega o Processo.
export function BlockSynthesis({
  processId,
  block,
  openStagePoints,
  onChange,
}: {
  processId: string;
  block: Block;
  openStagePoints: StagePoint[];
  onChange: () => void;
}) {
  const request = block.synthesisRequests.at(-1) ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Síntese do Bloco {block.number}</h3>
      {block.synthesis ? (
        <Confirmed synthesis={block.synthesis} />
      ) : (
        <Pending processId={processId} block={block} request={request} openStagePoints={openStagePoints} onChange={onChange} />
      )}
      {request && <AttemptList attempts={request.attempts} />}
    </div>
  );
}

function Confirmed({ synthesis }: { synthesis: ConfirmedSynthesis }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Confirmada</Badge>
        <span className="text-muted-foreground text-xs">
          {originText[synthesis.origin]} · {formatDate(synthesis.confirmedAt)}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{synthesis.synthesis}</p>
      <p className="text-muted-foreground text-xs">
        {synthesis.coveredStagePoints.length > 0
          ? `Pontos que você deu por cobertos: ${synthesis.coveredStagePoints.map((point) => point.name).join(", ")}.`
          : "Você não deu nenhum Ponto por coberto com este Bloco."}
      </p>
    </div>
  );
}

function Pending({
  processId,
  block,
  request,
  openStagePoints,
  onChange,
}: {
  processId: string;
  block: Block;
  request: SynthesisRequest | null;
  openStagePoints: StagePoint[];
  onChange: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function send(action: () => Promise<SynthesisRequest>) {
    setSending(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      // Outra aba pode ter pedido antes; o estado recarregado mostra o que vale.
      if (!(caught instanceof ApiError && caught.status === 409)) setError("Não foi possível pedir a síntese à IA.");
    } finally {
      setSending(false);
      onChange();
    }
  }

  const ask = (label: string) => (
    <div>
      <Button variant="outline" size="sm" disabled={sending} onClick={() => send(() => requestSynthesis(processId, block.id))}>
        {sending ? "Pedindo…" : label}
      </Button>
    </div>
  );

  let content;
  if (!request) {
    content = isBlockComplete(block) ? (
      <>
        <p className="text-muted-foreground text-sm">
          A IA resume o que você respondeu e sugere quais Pontos as respostas já cobrem. Nada vale até você confirmar.
        </p>
        {ask("Pedir síntese do Bloco")}
      </>
    ) : (
      <p className="text-muted-foreground text-sm">
        Responda cada Pergunta, ou registre que não sabe, para a IA sintetizar o Bloco. Até a síntese ser confirmada, as
        respostas são provisórias.
      </p>
    );
  } else if (request.status === "running") {
    content = <p className="text-muted-foreground text-sm">A IA está sintetizando o Bloco…</p>;
  } else if (!request.proposal) {
    const last = request.attempts.at(-1)!;
    content = (
      <>
        <p className="text-sm">{attemptProblem(last)}</p>
        {last.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{last.message}</p>}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => send(() => newSynthesisAttempt(processId, block.id, request.id))}
          >
            {sending ? "Pedindo…" : "Tentar novamente"}
          </Button>
        </div>
      </>
    );
  } else if (request.proposal.outdated) {
    content = (
      <>
        <p className="text-sm">
          Uma resposta do Bloco mudou depois desta síntese; ela não pode mais ser confirmada. Peça uma nova síntese.
        </p>
        <p className="text-muted-foreground text-xs whitespace-pre-wrap">{request.proposal.synthesis}</p>
        {ask("Pedir nova síntese")}
      </>
    );
  } else {
    content = (
      <ProposalForm
        key={request.proposal.id}
        processId={processId}
        block={block}
        proposal={request.proposal}
        openStagePoints={openStagePoints}
        onChange={onChange}
      />
    );
  }

  return (
    <>
      {content}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </>
  );
}

function ProposalForm({
  processId,
  block,
  proposal,
  openStagePoints,
  onChange,
}: {
  processId: string;
  block: Block;
  proposal: SynthesisProposal;
  openStagePoints: StagePoint[];
  onChange: () => void;
}) {
  const open = new Set(openStagePoints.map((point) => point.key));
  const [text, setText] = useState(proposal.synthesis);
  // Começa com o que a IA sugeriu, entre os Pontos ainda abertos; quem decide é o usuário.
  const [covered, setCovered] = useState(
    () => new Set(proposal.coverage.filter((item) => item.covered && open.has(item.stagePoint.key)).map((item) => item.stagePoint.key)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const corrected = text.trim() !== proposal.synthesis;

  function toggle(key: string, checked: boolean) {
    setCovered((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await confirmSynthesis(processId, block.id, {
        proposalId: proposal.id,
        synthesis: text,
        coveredStagePoints: [...covered].filter((key) => open.has(key)),
      });
    } catch (caught) {
      // O texto fica nos campos para uma nova tentativa; o estado recarregado mostra o que mudou.
      setError(
        caught instanceof ApiError && caught.code === "synthesis_outdated"
          ? "Uma resposta mudou depois desta síntese. Peça uma nova síntese."
          : "Não foi possível confirmar a síntese. O que você escreveu continua aqui; tente de novo.",
      );
    } finally {
      setSaving(false);
      onChange();
    }
  }

  const questionLabel = (questionId: string) => {
    const index = block.questions.findIndex((question) => question.id === questionId);
    return index === -1 ? "Pergunta" : `Pergunta ${index + 1}`;
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Sugestão da IA</Badge>
        <span className="text-muted-foreground text-xs">Confirme como veio ou corrija o texto.</span>
      </div>
      <Label htmlFor={`synthesis-${block.id}`} className="sr-only">
        Síntese do Bloco
      </Label>
      <Textarea
        id={`synthesis-${block.id}`}
        value={text}
        rows={4}
        disabled={saving}
        onChange={(event) => setText(event.target.value)}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium">Pontos que as respostas já cobrem</legend>
        {proposal.coverage.map(({ stagePoint, covered: suggested, reason }) => {
          const id = `coverage-${block.id}-${stagePoint.key}`;
          const stillOpen = open.has(stagePoint.key);
          return (
            <div key={stagePoint.key} className="flex items-start gap-2">
              <Checkbox
                id={id}
                checked={stillOpen && covered.has(stagePoint.key)}
                disabled={saving || !stillOpen}
                onCheckedChange={(checked) => toggle(stagePoint.key, checked === true)}
              />
              <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                <span>
                  {stagePoint.name}
                  {!stillOpen && <span className="text-muted-foreground"> · já não está aberto</span>}
                </span>
                <span className="text-muted-foreground text-xs">
                  A IA sugere {suggested ? "coberto" : "ainda aberto"}: {reason}
                </span>
              </Label>
            </div>
          );
        })}
      </fieldset>

      {proposal.ambiguousAnswers.length > 0 && (
        <div className="flex flex-col gap-1 text-xs">
          <p className="font-medium">Respostas que a IA achou ambíguas</p>
          <ul className="text-muted-foreground list-disc pl-4">
            {proposal.ambiguousAnswers.map((item) => (
              <li key={item.questionId}>
                {questionLabel(item.questionId)}: {item.reason}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">Um Bloco novo pode reformular essas Perguntas.</p>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving || text.trim() === ""}>
          {saving ? "Confirmando…" : corrected ? "Confirmar síntese corrigida" : "Confirmar síntese"}
        </Button>
      </div>
    </form>
  );
}
