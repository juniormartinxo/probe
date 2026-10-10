import { useState } from "react";
import {
  ApiError,
  decideImpact,
  reconfirmPendency,
  retryImpactAssessment,
  synthesisInForce,
  type AssessmentChoice,
  type DependentConfirmation,
  type ImpactAssessment,
  type ProcessDetail,
  type Reassessment,
  type Stage,
} from "@/api";
import { failureText } from "@/components/stage-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { stageName } from "@/stages";

const impactText: Record<AssessmentChoice, string> = {
  yes: "afeta a Confirmação",
  no: "não afeta a Confirmação",
  insufficient: "informação insuficiente",
};

const errorText: Record<string, string> = {
  reassessment_not_found: "Esta revisão já não está aberta; a resposta pode ter mudado de novo.",
  reassessment_decided: "Esta revisão já tem uma Pendência aberta.",
  unknown_assessment: "Há uma Avaliação mais recente do que a que você viu. Confira-a antes de decidir.",
  impact_assessed: "O Jev já avaliou o impacto.",
  pendency_resolved: "Esta Pendência já foi resolvida.",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function confirmationName(confirmation: DependentConfirmation): string {
  return confirmation.kind === "block_synthesis"
    ? `Síntese do Bloco ${confirmation.blockNumber} (Etapa ${confirmation.stage})`
    : `Confirmação da Etapa ${confirmation.stage} · ${stageName(confirmation.stage)}`;
}

// O que precisa ser revisto e por quê: cada Confirmação que dependia de uma resposta que mudou, com a
// mudança e a Avaliação de impacto do Jev. O que não foi afetado continua valendo, e o usuário segue
// respondendo as outras Perguntas.
export function Reassessments({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  if (process.reassessments.length === 0) return null;
  return (
    <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div>
        <p className="text-xs font-medium">O que precisa ser revisto</p>
        <p className="text-muted-foreground text-xs">
          Uma resposta mudou depois de sustentar uma Confirmação. O Jev avalia se a mudança a afeta; quem decide é você. O
          resto continua valendo, e você pode seguir respondendo as outras Perguntas.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {process.reassessments.map((reassessment) => (
          <ReassessmentItem
            key={`${reassessment.newVersion.id}-${reassessment.confirmation.kind === "stage" ? reassessment.confirmation.stage : reassessment.confirmation.blockId}`}
            process={process}
            reassessment={reassessment}
            onChange={onChange}
          />
        ))}
      </ul>
    </div>
  );
}

function ReassessmentItem({
  process,
  reassessment,
  onChange,
}: {
  process: ProcessDetail;
  reassessment: Reassessment;
  onChange: () => void;
}) {
  const { confirmation, question, previousVersion, newVersion, status } = reassessment;
  const latest = reassessment.impactAssessments.at(-1) ?? null;
  const pendency = process.pendencies.find((item) => item.id === reassessment.pendencyId) ?? null;
  const confirmedSynthesis =
    confirmation.kind === "block_synthesis" ? process.blocks.find((block) => block.id === confirmation.blockId)?.synthesis : undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function act(action: () => Promise<unknown>, failure: string) {
    setSaving(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError((caught instanceof ApiError && caught.code && errorText[caught.code]) || failure);
    } finally {
      setSaving(false);
      onChange();
    }
  }

  const decide = (decision: "open_pendency" | "keep_confirmation") =>
    act(
      () => decideImpact(process.id, newVersion.id, { confirmation, impactAssessmentId: latest!.id, decision }),
      "Não foi possível registrar a sua decisão; tente de novo.",
    );
  const retry = () =>
    act(() => retryImpactAssessment(process.id, newVersion.id, confirmation), "Não foi possível pedir a Avaliação de impacto.");

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{confirmationName(confirmation)}</span>
        {status === "pendency_open" && <Badge variant="destructive">Pendência de reavaliação</Badge>}
      </div>
      <p className="text-xs">
        A resposta da Pergunta {question.number} do Bloco {question.blockNumber} (“{question.wording}”) mudou de “
        {previousVersion.answer}” (Versão {previousVersion.number}) para “{newVersion.answer}” (Versão {newVersion.number}).
        Esta Confirmação dependia da resposta anterior.
      </p>
      {latest && <ImpactLine assessment={latest} />}
      {reassessment.impactAssessments.length > 1 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Avaliações anteriores ({reassessment.impactAssessments.length - 1})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {reassessment.impactAssessments.slice(0, -1).map((assessment) => (
              <li key={assessment.id}>
                <ImpactLine assessment={assessment} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {status === "not_assessed" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">O Jev ainda não avaliou o impacto desta mudança.</p>
          <Button variant="outline" size="sm" disabled={saving} onClick={retry}>
            {saving ? "Avaliando…" : "Avaliar impacto"}
          </Button>
        </div>
      )}
      {(status === "assessment_failed" || status === "awaiting_decision") && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {status === "assessment_failed"
              ? "Você pode tentar de novo ou decidir sem o Jev; a decisão fica registrada."
              : "O Jev não tem certeza. Decida se a mudança pede revisão desta Confirmação."}
          </p>
          <div className="flex flex-wrap gap-2">
            {status === "assessment_failed" && (
              <Button variant="outline" size="sm" disabled={saving} onClick={retry}>
                Tentar de novo
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={saving} onClick={() => decide("open_pendency")}>
              Abrir Pendência
            </Button>
            <Button size="sm" disabled={saving} onClick={() => decide("keep_confirmation")}>
              Manter a Confirmação
            </Button>
          </div>
        </div>
      )}
      {status === "pendency_open" && pendency && (
        <Reconfirmation
          processId={process.id}
          pendencyId={pendency.id}
          openedBy={pendency.reassessment?.openedBy ?? "jev"}
          synthesis={confirmedSynthesis ? synthesisInForce(confirmedSynthesis) : null}
          stage={confirmation.stage}
          saving={saving}
          onReconfirm={(text) => act(() => reconfirmPendency(process.id, pendency.id, text), "Não foi possível reconfirmar; tente de novo.")}
        />
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </li>
  );
}

// A Avaliação de impacto como veio, ou a falha.
export function ImpactLine({ assessment }: { assessment: ImpactAssessment }) {
  if (assessment.status === "failed") {
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span>{assessment.failureReason ? failureText[assessment.failureReason] : "A Avaliação de impacto falhou."}</span>
        {assessment.message && <span className="text-muted-foreground whitespace-pre-wrap">{assessment.message}</span>}
      </div>
    );
  }
  const { yes, no, insufficient } = assessment.probabilities!;
  return (
    <p className="text-xs">
      <span className="text-muted-foreground">Jev: </span>
      <span className="font-medium">{impactText[assessment.choice!]}</span> · confiança {percent(assessment.confidence!)}
      <span className="text-muted-foreground">
        {" "}
        · sim {percent(yes)} · não {percent(no)} · insuficiente {percent(insufficient)}
      </span>
    </p>
  );
}

// Resolver a Pendência: reconfirmar a Confirmação com a resposta nova (numa síntese de bloco, com o
// texto corrigido, se precisar) ou corrigir a resposta na Pergunta, com uma Versão nova.
function Reconfirmation({
  processId,
  pendencyId,
  openedBy,
  synthesis,
  stage,
  saving,
  onReconfirm,
}: {
  processId: string;
  pendencyId: string;
  openedBy: "jev" | "user";
  // O texto da síntese que vale; null quando a Confirmação é a da Etapa.
  synthesis: string | null;
  stage: Stage;
  saving: boolean;
  onReconfirm: (synthesis: string | null) => void;
}) {
  const [text, setText] = useState(synthesis ?? "");
  const id = `reconfirm-${processId}-${pendencyId}`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {openedBy === "jev" ? "O Jev avaliou que a mudança afeta esta Confirmação." : "Você abriu esta Pendência."} Ela bloqueia a
        Confirmação da Etapa {stage} e das seguintes até você resolvê-la: reconfirme com a resposta nova ou corrija a resposta
        na Pergunta (uma Versão nova substitui esta Pendência).
      </p>
      {synthesis !== null && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id} className="text-xs font-normal">
            Síntese do Bloco. Corrija o texto se a resposta nova pedir.
          </Label>
          <Textarea id={id} value={text} rows={3} disabled={saving} onChange={(event) => setText(event.target.value)} />
        </div>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={saving || (synthesis !== null && text.trim() === "")}
          onClick={() => onReconfirm(synthesis !== null && text.trim() !== synthesis.trim() ? text : null)}
        >
          {saving ? "Reconfirmando…" : synthesis !== null ? "Reconfirmar a síntese" : `Reconfirmar a Etapa ${stage}`}
        </Button>
      </div>
    </div>
  );
}
