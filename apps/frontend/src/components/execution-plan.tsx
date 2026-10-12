import { useState, type FormEvent } from "react";
import {
  ApiError,
  assessExecutionPlan,
  keepPlanElement,
  recordPlanElement,
  type AssessmentChoice,
  type ExecutionPlanElement,
  type PlanAssessment,
  type ProcessDetail,
} from "@/api";
import { failureText } from "@/components/stage-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";

const choiceText: Record<AssessmentChoice, string> = {
  yes: "compatível",
  no: "incompatível",
  insufficient: "informação insuficiente",
};

const errorText: Record<string, string> = {
  execution_confirmed: "A Etapa E já foi confirmada: o plano não muda mais.",
  stage_not_current: "O Processo ainda não chegou à Etapa E.",
  unknown_assessment: "Há uma Avaliação mais recente do que a que você viu. Confira-a antes de decidir.",
  justification_required: "Diga por que mantém o elemento contra a Avaliação do Jev.",
  plan_element_decided: "Este elemento já está decidido.",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

// A ação do usuário, com o erro que ela devolver traduzido; recarrega o Processo no fim.
function useAction(onChange: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function act(action: () => Promise<unknown>, failure: string): Promise<boolean> {
    setSaving(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (caught) {
      setError((caught instanceof ApiError && caught.code && errorText[caught.code]) || failure);
      return false;
    } finally {
      setSaving(false);
      onChange();
    }
  }
  return { saving, error, act };
}

// Plano de execução (Etapa E): o primeiro passo concreto, como reconhecer sucesso e o plano B, que
// você escreve. Cada elemento cobre o seu Ponto, e o Jev avalia se ele é compatível com a Escolha em
// vigor; a Avaliação informa, e quem decide é você.
export function ExecutionPlan({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  if (process.currentStage !== "E") return null;
  const editable = process.status === "open" && !process.readyForFinalReview;
  const chosen = process.chosenOptions.at(-1) ?? null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div>
        <p className="text-xs font-medium">Plano de execução</p>
        <p className="text-muted-foreground text-xs">
          Escreva o primeiro passo concreto, como você vai reconhecer que deu certo e o plano B; os três são obrigatórios para confirmar
          a Etapa E. O Jev avalia se cada um é compatível com a Escolha{chosen ? ` (“${chosen.option.statement}”)` : ""}.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {process.executionPlan.map((element) => (
          <PlanElement key={element.key} processId={process.id} element={element} editable={editable} onChange={onChange} />
        ))}
      </ul>
      {process.readyForFinalReview && (
        <p className="rounded-md border border-dashed p-3 text-sm">
          A Etapa E está confirmada: o Processo está pronto para a Revisão final. O plano e a Escolha não mudam mais.
        </p>
      )}
    </div>
  );
}

function PlanElement({
  processId,
  element,
  editable,
  onChange,
}: {
  processId: string;
  element: ExecutionPlanElement;
  editable: boolean;
  onChange: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const { saving, error, act } = useAction(onChange);

  function startWriting() {
    setText(element.current?.text ?? "");
    setWriting(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await act(
      () => recordPlanElement(processId, element.key, text),
      "Não foi possível gravar o elemento. O que você escreveu continua aqui; tente de novo.",
    );
    if (done) setWriting(false);
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium" title={element.description}>
          {element.name}
        </span>
        {editable && !writing && (
          <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-xs" onClick={startWriting}>
            {element.current ? "Reescrever" : "Escrever"}
          </Button>
        )}
      </div>
      {element.current ? (
        <p className="whitespace-pre-wrap">{element.current.text}</p>
      ) : (
        !writing && <p className="text-muted-foreground text-xs">Ainda não escrito. {element.description}</p>
      )}
      {writing && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor={`plan-${element.key}`} className="text-xs font-normal">
            {element.description}
          </Label>
          <Textarea id={`plan-${element.key}`} rows={3} value={text} disabled={saving} onChange={(event) => setText(event.target.value)} />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setWriting(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || text.trim() === ""}>
              {saving ? "Gravando e avaliando…" : "Gravar"}
            </Button>
          </div>
        </form>
      )}
      {element.current && !writing && <Compatibility processId={processId} element={element} editable={editable} onChange={onChange} />}
      {element.history.length > 0 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Versões anteriores ({element.history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {element.history.map((item) => (
              <li key={item.id} className="whitespace-pre-wrap">
                {formatDate(item.recordedAt)}: {item.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

// A compatibilidade do elemento com a Escolha em vigor: o julgamento do Jev como veio, e a sua decisão
// quando ele não confirma, não tem certeza ou falhou.
function Compatibility({
  processId,
  element,
  editable,
  onChange,
}: {
  processId: string;
  element: ExecutionPlanElement;
  editable: boolean;
  onChange: () => void;
}) {
  const [justification, setJustification] = useState("");
  const { saving, error, act } = useAction(onChange);
  const { status, assessment, decision } = element.compatibility;

  const assess = () => act(() => assessExecutionPlan(processId), "Não foi possível pedir a Avaliação do Jev.");
  const keep = (planAssessmentId: string, withJustification: boolean) =>
    act(
      () => keepPlanElement(processId, element.key, { planAssessmentId, justification: withJustification ? justification : null }),
      "Não foi possível registrar a decisão. A justificativa continua aqui; tente de novo.",
    );

  return (
    <div className="flex flex-col gap-2 text-xs">
      {status === "compatible" && (
        <p>
          <Badge variant="secondary">Compatível com a Escolha</Badge>
        </p>
      )}
      {status === "kept" && (
        <p className="flex flex-col gap-0.5">
          <span>
            <Badge variant="secondary">Mantido por você</Badge>
            {assessment?.status === "failed" && <span className="text-muted-foreground"> · sem Avaliação do Jev</span>}
          </span>
          {decision?.justification && <span className="text-muted-foreground whitespace-pre-wrap">Justificativa: {decision.justification}</span>}
        </p>
      )}
      {assessment?.status === "completed" && <Verdict assessment={assessment} />}
      {status === "not_assessed" && <p className="text-muted-foreground">Sem Avaliação do Jev.</p>}
      {status === "outdated" && <p className="text-muted-foreground">A Escolha mudou depois da Avaliação deste elemento: peça uma nova.</p>}
      {status === "assessment_failed" && assessment && (
        <div className="flex flex-col gap-1">
          <p>{assessment.failureReason ? failureText[assessment.failureReason] : "A Avaliação falhou."}</p>
          {assessment.message && <p className="text-muted-foreground whitespace-pre-wrap">{assessment.message}</p>}
          <p className="text-muted-foreground">Você pode tentar de novo ou manter o elemento sem Avaliação; isso fica registrado.</p>
        </div>
      )}
      {editable && (status === "not_assessed" || status === "outdated" || status === "assessment_failed") && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={assess}>
            {saving ? "Avaliando…" : status === "assessment_failed" ? "Tentar de novo" : "Pedir Avaliação do Jev"}
          </Button>
          {status === "assessment_failed" && assessment && (
            <Button size="sm" disabled={saving} onClick={() => keep(assessment.id, false)}>
              Manter sem Avaliação
            </Button>
          )}
        </div>
      )}
      {editable && status === "awaiting_decision" && assessment && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void keep(assessment.id, true);
          }}
        >
          <Label htmlFor={`plan-justification-${element.key}`} className="text-xs font-normal">
            O Jev não confirma que este elemento é compatível com a Escolha. Reescreva-o ou mantenha-o, dizendo por quê (obrigatório).
          </Label>
          <Textarea
            id={`plan-justification-${element.key}`}
            rows={2}
            value={justification}
            disabled={saving}
            onChange={(event) => setJustification(event.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={saving || justification.trim() === ""}>
              {saving ? "Registrando…" : "Manter o elemento"}
            </Button>
          </div>
        </form>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}

// O julgamento como veio, sem limiar escondido: a confiança aparece, alta ou baixa.
function Verdict({ assessment }: { assessment: PlanAssessment }) {
  const { yes, no, insufficient } = assessment.probabilities!;
  return (
    <p className="text-muted-foreground">
      Jev: <span className="text-foreground font-medium">{choiceText[assessment.choice!]}</span> · confiança {percent(assessment.confidence!)} ·
      sim {percent(yes)} · não {percent(no)} · insuficiente {percent(insufficient)} · modelo {assessment.jevModel} ·{" "}
      {formatDate(assessment.createdAt)}
    </p>
  );
}
