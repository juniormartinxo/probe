import { useState, type FormEvent } from "react";
import {
  ApiError,
  confirmStage,
  requestStageAssessment,
  type Assessment,
  type AssessmentChoice,
  type AssessorFailureReason,
  type ProcessDetail,
  type StageAssessment,
  type StageConfirmation,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { stageName } from "@/stages";

const choiceText: Record<AssessmentChoice, string> = {
  yes: "cobre",
  no: "não cobre",
  insufficient: "informação insuficiente",
};

const failureText: Record<AssessorFailureReason, string> = {
  jev_not_configured: "A chave do Jev não está configurada no backend.",
  jev_unavailable: "O Jev está indisponível.",
  jev_unauthenticated: "O Jev recusou a chave configurada.",
  jev_rate_limited: "O Jev atingiu o limite de uso.",
  jev_error: "O Jev recusou a Avaliação.",
  invalid_output: "A resposta do Jev veio fora do formato esperado.",
};

const confirmErrorText: Record<string, string> = {
  open_stage_points: "Ainda há Pontos abertos nesta Etapa.",
  blocking_pendencies: "Há Pendências abertas nas Perguntas desta Etapa. Resolva-as antes de confirmar.",
  unknown_assessment: "Há uma Avaliação mais recente do que a que você viu. Confira-a antes de confirmar.",
  assessment_outdated: "As respostas ou os Pontos mudaram depois da Avaliação. Peça uma Avaliação nova.",
  assessment_required: "Peça a Avaliação do Jev antes de confirmar.",
  justification_required: "Diga por que você confirma contra a Avaliação do Jev.",
  stage_not_current: "Esta Etapa já não é a atual.",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

// Confirmação da Etapa atual, quando nenhum Ponto está aberto: o Jev avalia cada Ponto coberto a
// partir das respostas confirmadas, a Avaliação aparece ao lado da sugestão da IA e só o usuário
// confirma, mesmo contra o Jev (com justificativa) ou sem ele, se estiver indisponível.
export function StageConfirmationPanel({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const stage = process.currentStage;
  const latest = process.stageAssessments.filter((item) => item.stage === stage).at(-1) ?? null;
  const toAssess = process.stagePoints.some((point) => point.status === "covered");
  const stageQuestionIds = new Set(
    process.blocks.filter((block) => block.stage === stage).flatMap((block) => block.questions.map((question) => question.id)),
  );
  const blocking = process.pendencies.filter((pendency) => pendency.resolvedAt === null && stageQuestionIds.has(pendency.question.id));

  const [assessing, setAssessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string>();

  async function assess() {
    setAssessing(true);
    setError(undefined);
    try {
      await requestStageAssessment(process.id, stage);
    } catch {
      setError("Não foi possível pedir a Avaliação do Jev.");
    } finally {
      setAssessing(false);
      onChange();
    }
  }

  async function confirm(event?: FormEvent) {
    event?.preventDefault();
    setConfirming(true);
    setError(undefined);
    try {
      await confirmStage(process.id, stage, {
        stageAssessmentId: latest?.id ?? null,
        justification: justification.trim() === "" ? null : justification,
      });
    } catch (caught) {
      setError(
        (caught instanceof ApiError && caught.code && confirmErrorText[caught.code]) ||
          "Não foi possível confirmar a Etapa. O que você escreveu continua aqui; tente de novo.",
      );
    } finally {
      setConfirming(false);
      onChange();
    }
  }

  const busy = assessing || confirming;
  const against = latest?.status === "completed" && !latest.outdated && latest.assessments.some((item) => item.disagrees);
  const confirmLabel = confirming ? "Confirmando…" : `Confirmar Etapa ${stage}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">
          Confirmação da Etapa {stage} · {stageName(stage)}
        </h3>
        <p className="text-muted-foreground text-xs">
          Todos os Pontos estão cobertos ou inaplicáveis. O Jev avalia se as respostas confirmadas cobrem cada Ponto; a
          Avaliação informa, e quem confirma é você.
        </p>
      </div>

      {blocking.length > 0 && (
        <p className="text-destructive text-sm">
          {blocking.length === 1 ? "Uma Pendência aberta" : `${blocking.length} Pendências abertas`} nas Perguntas desta Etapa
          bloqueia a Confirmação. Responda a Pergunta para resolvê-la.
        </p>
      )}

      {!toAssess ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">Todos os Pontos foram declarados inaplicáveis: não há cobertura para o Jev avaliar.</p>
          <div>
            <Button size="sm" disabled={busy || blocking.length > 0} onClick={() => confirm()}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : latest === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">Peça a Avaliação do Jev para ver a opinião dele ao lado da sugestão da IA.</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={assess}>
            {assessing ? "Avaliando…" : "Pedir Avaliação do Jev"}
          </Button>
        </div>
      ) : latest.outdated ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            As respostas confirmadas ou os Pontos cobertos mudaram depois da última Avaliação. Peça uma Avaliação nova.
          </p>
          <Button variant="outline" size="sm" disabled={busy} onClick={assess}>
            {assessing ? "Avaliando…" : "Avaliar de novo"}
          </Button>
        </div>
      ) : latest.status === "failed" ? (
        <FailedAssessment
          assessment={latest}
          busy={busy}
          assessing={assessing}
          confirming={confirming}
          blocked={blocking.length > 0}
          onRetry={assess}
          onConfirm={() => confirm()}
        />
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <AssessmentList assessment={latest} />
          {against && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`stage-justification-${stage}`} className="text-xs font-normal">
                O Jev não confirma a cobertura de algum Ponto. Você pode confirmar mesmo assim; diga por quê (obrigatório).
              </Label>
              <Textarea
                id={`stage-justification-${stage}`}
                value={justification}
                rows={2}
                disabled={busy}
                onChange={(event) => setJustification(event.target.value)}
              />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={assess}>
              {assessing ? "Avaliando…" : "Avaliar de novo"}
            </Button>
            <Button type="submit" size="sm" disabled={busy || blocking.length > 0 || (against && justification.trim() === "")}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

function FailedAssessment({
  assessment,
  busy,
  assessing,
  confirming,
  blocked,
  onRetry,
  onConfirm,
}: {
  assessment: StageAssessment;
  busy: boolean;
  assessing: boolean;
  confirming: boolean;
  blocked: boolean;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{assessment.failureReason ? failureText[assessment.failureReason] : "A Avaliação falhou."}</p>
      {assessment.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{assessment.message}</p>}
      <p className="text-muted-foreground text-xs">
        Você pode tentar de novo ou confirmar a Etapa sem Avaliação; a Confirmação registra que o Jev não avaliou.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
          {assessing ? "Avaliando…" : "Tentar de novo"}
        </Button>
        <Button size="sm" disabled={busy || blocked} onClick={onConfirm}>
          {confirming ? "Confirmando…" : "Confirmar sem Avaliação"}
        </Button>
      </div>
    </div>
  );
}

// Cada Ponto com a sugestão da IA e a Avaliação do Jev lado a lado, sem limiar: a confiança aparece
// como veio, alta ou baixa.
function AssessmentList({ assessment }: { assessment: StageAssessment }) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {assessment.assessments.map((item) => (
          <AssessmentItem key={item.stagePoint.key} item={item} />
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Avaliado em {formatDate(assessment.createdAt)} · modelo {assessment.jevModel} · rubrica {assessment.rubricRevision}
      </p>
    </div>
  );
}

function AssessmentItem({ item }: { item: Assessment }) {
  const { yes, no, insufficient } = item.probabilities;
  return (
    <li className="flex flex-col gap-1 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.stagePoint.name}</span>
        {item.disagrees && <Badge variant="destructive">Jev discorda da cobertura</Badge>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Sugestão da IA</span>
          {item.aiSuggestion ? (
            <span className="text-xs">
              <span className="font-medium">{item.aiSuggestion.covered ? "cobre" : "não cobre"}</span> · {item.aiSuggestion.reason}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">sem sugestão</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Avaliação do Jev</span>
          <span className="text-xs">
            <span className="font-medium">{choiceText[item.choice]}</span> · confiança {percent(item.confidence)}
          </span>
          <span className="text-muted-foreground text-xs">
            sim {percent(yes)} · não {percent(no)} · insuficiente {percent(insufficient)}
          </span>
        </div>
      </div>
    </li>
  );
}

// Etapas já confirmadas, com o que a Confirmação registrou.
export function ConfirmedStages({ confirmations }: { confirmations: StageConfirmation[] }) {
  if (confirmations.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {confirmations.map((confirmation) => (
        <li key={confirmation.stage} className="flex flex-col gap-0.5">
          <span>
            <Badge variant="secondary">Confirmada</Badge> Etapa {confirmation.stage} · {stageName(confirmation.stage)} ·{" "}
            <span className="text-muted-foreground text-xs">
              {formatDate(confirmation.confirmedAt)}
              {confirmation.withoutAssessment ? " · sem Avaliação do Jev" : ""}
            </span>
          </span>
          {confirmation.justification && (
            <span className="text-muted-foreground text-xs whitespace-pre-wrap">Justificativa: {confirmation.justification}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
