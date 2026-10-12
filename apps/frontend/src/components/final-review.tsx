import { useEffect, useState } from "react";
import { ApiError, finalizeProcess, getFinalReview, type FinalizationBlocker, type FinalReview, type ProcessDetail } from "@/api";
import {
  ChoiceSection,
  ConstraintsAndPreferencesSection,
  DiscardsSection,
  PlanSection,
  ProblemSection,
  ReportView,
} from "@/components/report-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const blockerText: Record<FinalizationBlocker["reason"], string> = {
  blocking_pendencies: "Há Pendências abertas: resolva-as antes de finalizar.",
  undecided_reassessments: "Uma mudança ainda espera a decisão sobre o impacto dela numa Confirmação.",
  undecided_conflicts: "Respostas confirmadas ainda esperam a verificação de conflito.",
  undecided_options: "Alguma Opção aceita ainda está sem decisão de viabilidade.",
  choice_required: "Não há Escolha.",
  chosen_option_not_viable: "A Opção escolhida deixou de ser viável: escolha outra no Balanceamento.",
  discard_reasons_required: "Falta o motivo de descarte de alguma Opção viável.",
  execution_plan_incomplete: "Falta um elemento do plano de execução.",
  undecided_plan_compatibility: "Algum elemento do plano está sem compatibilidade decidida com a Escolha em vigor.",
  ai_request_in_progress: "Uma solicitação à IA ainda está em andamento.",
};

const errorText: Record<string, string> = {
  ...blockerText,
  final_review_outdated: "Algo mudou desde que a Revisão final foi apresentada. Ela foi atualizada: confira de novo antes de finalizar.",
  process_not_open: "O Processo já foi finalizado.",
};

// Revisão final: com a Etapa E confirmada, o problema, as Restrições e Preferências, a Escolha com as
// concessões e o plano, como ficarão congelados. A Finalização é um ato seu, sobre exatamente o que
// está na tela: se algo mudar antes da confirmação, ela é recusada.
export function FinalReviewSection({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const [review, setReview] = useState<FinalReview>();
  const [loadError, setLoadError] = useState(false);
  // A confirmação vale para a Revisão que estava na tela: uma Revisão nova pede outra.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // A cada recarga do Processo (uma ação em qualquer parte da tela), a Revisão é apresentada de novo.
  useEffect(() => {
    let current = true;
    getFinalReview(process.id).then(
      (loaded) => {
        if (!current) return;
        setReview(loaded);
        setLoadError(false);
      },
      () => current && setLoadError(true),
    );
    return () => {
      current = false;
    };
  }, [process]);

  const confirmed = review !== undefined && confirmedFor === review.fingerprint;

  async function finalize() {
    if (!review) return;
    setSaving(true);
    setError(undefined);
    try {
      await finalizeProcess(process.id, review.fingerprint);
    } catch (caught) {
      setError((caught instanceof ApiError && caught.code && errorText[caught.code]) || "Não foi possível finalizar. Tente de novo.");
    } finally {
      setSaving(false);
      onChange();
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 p-4 text-sm">
      <div>
        <h2 className="text-sm font-semibold">Revisão final</h2>
        <p className="text-muted-foreground text-xs">
          Confira o que será congelado. Depois da Finalização, o Processo fica somente leitura e o relatório pode ser consultado aqui.
        </p>
      </div>
      {loadError && <p className="text-destructive text-xs">Não foi possível carregar a Revisão final.</p>}
      {!review && !loadError && <p className="text-muted-foreground text-xs">Carregando…</p>}
      {review && (
        <>
          <ProblemSection report={review.report} />
          <ConstraintsAndPreferencesSection report={review.report} />
          <ChoiceSection report={review.report} />
          <DiscardsSection report={review.report} />
          <PlanSection report={review.report} />
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-xs font-medium">Prévia do relatório completo</summary>
            <div className="mt-3">
              <ReportView report={review.report} />
            </div>
          </details>
          {review.blockers.length > 0 ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="text-xs font-medium">O que ainda impede a Finalização</p>
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs">
                {review.blockers.map((blocker) => (
                  <li key={blocker.reason}>{blockerText[blocker.reason]}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Checkbox id="final-review-confirmed" checked={confirmed} disabled={saving} onCheckedChange={(checked) => setConfirmedFor(checked === true ? review.fingerprint : null)} />
                <Label htmlFor="final-review-confirmed" className="font-normal">
                  Revisei o problema, as Restrições, a Escolha, as concessões e o plano, e quero congelar esta Decisão.
                </Label>
              </div>
              <Button className="self-start" disabled={!confirmed || saving} onClick={finalize}>
                {saving ? "Finalizando…" : "Finalizar o Processo"}
              </Button>
            </div>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </>
      )}
    </section>
  );
}
