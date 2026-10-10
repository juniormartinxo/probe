import { useState, type FormEvent } from "react";
import {
  ApiError,
  clarifyConflict,
  decideConflict,
  requestResolutionQuestion,
  retryConflictAssessment,
  reviseConstraintForConflict,
  type AssessmentChoice,
  type ConflictAssessment,
  type ConflictCheck,
  type ConflictingAnswer,
  type ConflictPair,
  type ConflictVerdict,
  type ItemKind,
  type Pendency,
  type ProcessDetail,
} from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { itemDetails } from "@/components/constraints-and-preferences";
import { NewAttempt } from "@/components/new-attempt";
import { failureText } from "@/components/stage-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attemptProblem } from "@/refinement";

const conflictText: Record<AssessmentChoice, string> = {
  yes: "são incompatíveis",
  no: "são compatíveis",
  insufficient: "informação insuficiente",
};

const errorText: Record<string, string> = {
  conflict_decided: "Este par já foi decidido; a resposta pode ter mudado.",
  unknown_assessment: "Há uma Avaliação mais recente do que a que você viu. Confira-a antes de decidir.",
  conflict_assessed: "O Jev já avaliou estes pares.",
  pendency_resolved: "Esta Pendência já foi resolvida.",
  stage_not_current: "Restrições só são revistas enquanto a Etapa R é a atual.",
  already_withdrawn: "Esta Restrição já foi retirada.",
  no_constraint_or_preference: "Sem substituta, o Ponto que distingue Restrições de Preferências ficaria sem nenhuma.",
  resolution_question_generated: "A IA já formulou a pergunta.",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

const undecided = (pair: ConflictPair) =>
  pair.status === "awaiting_decision" || pair.status === "assessment_failed" || pair.status === "not_assessed";

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

// Respostas confirmadas que podem não valer ao mesmo tempo: o Jev avalia cada par; quem decide é o
// usuário. Uma Pendência de conflito bloqueia só a Confirmação das Etapas em que as respostas estão
// (e das seguintes); o resto da coleta segue.
export function Conflicts({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const checks = process.conflictChecks.filter((check) => check.status !== "decided");
  const pendencies = process.pendencies.filter((pendency) => pendency.reason === "conflict" && pendency.resolvedAt === null);
  if (checks.length === 0 && pendencies.length === 0) return null;
  return (
    <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div>
        <p className="text-xs font-medium">Respostas em conflito</p>
        <p className="text-muted-foreground text-xs">
          O Jev avalia se respostas confirmadas podem valer ao mesmo tempo; quem decide é você. Enquanto houver conflito, a
          Confirmação da Etapa espera; você pode seguir respondendo as outras Perguntas.
        </p>
      </div>
      {checks.map((check) => (
        <UndecidedCheck key={check.id} processId={process.id} check={check} onChange={onChange} />
      ))}
      {pendencies.map((pendency) => (
        <ConflictPendency key={pendency.id} process={process} pendency={pendency} onChange={onChange} />
      ))}
    </div>
  );
}

function AnswerLine({ answer }: { answer: ConflictingAnswer }) {
  return (
    <li>
      <span className="text-muted-foreground">
        Pergunta {answer.question.number} do Bloco {answer.question.blockNumber} (Etapa {answer.question.stage}) · {answer.question.wording}
      </span>
      <br />“{answer.answer}”{answer.superseded && <span className="text-muted-foreground"> · já substituída por uma Versão nova</span>}
    </li>
  );
}

export function VerdictLine({ verdict }: { verdict: ConflictVerdict }) {
  const { yes, no, insufficient } = verdict.probabilities;
  return (
    <p className="text-xs">
      <span className="text-muted-foreground">Jev: </span>
      <span className="font-medium">{conflictText[verdict.choice]}</span> · confiança {percent(verdict.confidence)}
      <span className="text-muted-foreground">
        {" "}
        · sim {percent(yes)} · não {percent(no)} · insuficiente {percent(insufficient)}
      </span>
    </p>
  );
}

function FailureLine({ assessment }: { assessment: ConflictAssessment }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span>{assessment.failureReason ? failureText[assessment.failureReason] : "A Avaliação de conflito falhou."}</span>
      {assessment.message && <span className="text-muted-foreground whitespace-pre-wrap">{assessment.message}</span>}
    </div>
  );
}

// Uma verificação à espera: o Jev não avaliou, falhou ou não teve certeza em algum par.
function UndecidedCheck({ processId, check, onChange }: { processId: string; check: ConflictCheck; onChange: () => void }) {
  const { saving, error, act } = useAction(onChange);
  const latest = check.assessments.at(-1) ?? null;
  const pending = check.pairs.filter(undecided);
  const decide = (pairIds: string[], decision: "open_pendency" | "dismiss") =>
    act(
      () => decideConflict(processId, check.id, { conflictAssessmentId: latest!.id, pairIds, decision }),
      "Não foi possível registrar a sua decisão; tente de novo.",
    );
  const retry = () => act(() => retryConflictAssessment(processId, check.id), "Não foi possível pedir a Avaliação de conflito.");

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {check.status === "not_assessed" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">O Jev ainda não avaliou se as respostas recém-confirmadas conflitam com as outras.</p>
          <Button variant="outline" size="sm" disabled={saving} onClick={retry}>
            {saving ? "Avaliando…" : "Avaliar conflito"}
          </Button>
        </div>
      )}
      {check.status === "assessment_failed" && latest && (
        <div className="flex flex-col gap-2">
          <FailureLine assessment={latest} />
          <p className="text-muted-foreground text-xs">
            {pending.length === 1 ? "Um par de respostas" : `${pending.length} pares de respostas`} sem Avaliação. Tente de novo ou siga
            sem o Jev; a decisão fica registrada.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={retry}>
              Tentar de novo
            </Button>
            <Button size="sm" disabled={saving} onClick={() => decide(pending.map((pair) => pair.id), "dismiss")}>
              Seguir sem a Avaliação
            </Button>
          </div>
        </div>
      )}
      {check.status === "awaiting_decision" && (
        <ul className="flex flex-col gap-3">
          {pending.map((pair) => (
            <li key={pair.id} className="flex flex-col gap-2">
              <ul className="flex flex-col gap-1 text-xs">
                <AnswerLine answer={pair.answer} />
                <AnswerLine answer={pair.other} />
              </ul>
              {pair.verdict && <VerdictLine verdict={pair.verdict} />}
              <p className="text-muted-foreground text-xs">O Jev não tem certeza. Decida se estas respostas estão em conflito.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={saving} onClick={() => decide([pair.id], "open_pendency")}>
                  Abrir Pendência de conflito
                </Button>
                <Button size="sm" disabled={saving} onClick={() => decide([pair.id], "dismiss")}>
                  Não é conflito
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

// A Pendência de conflito aberta: as duas respostas, o julgamento, a pergunta da IA e as três formas de
// resolver (corrigir uma resposta, rever uma Restrição ou esclarecer).
function ConflictPendency({ process, pendency, onChange }: { process: ProcessDetail; pendency: Pendency; onChange: () => void }) {
  const conflict = pendency.conflict!;
  const verdict = conflict.conflictAssessment.verdicts.find((item) => item.pairId === conflict.pairId);
  const constraints = process.constraints.filter((item) => item.withdrawnAt === null);
  const canRevise = process.currentStage === "R" && constraints.length > 0;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">Pendência de conflito</Badge>
        <span className="text-muted-foreground text-xs">
          {conflict.openedBy === "jev" ? "O Jev avaliou que as respostas são incompatíveis." : "Você abriu esta Pendência."}
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        <AnswerLine answer={conflict.answers[0]} />
        <AnswerLine answer={conflict.answers[1]} />
      </ul>
      {verdict ? <VerdictLine verdict={verdict} /> : <FailureLine assessment={conflict.conflictAssessment} />}
      <ResolutionQuestionView processId={process.id} pendency={pendency} onChange={onChange} />
      <p className="text-muted-foreground text-xs">
        Para resolver, corrija uma das respostas na Pergunta (uma Versão nova substitui esta Pendência), reveja uma Restrição ou
        registre um esclarecimento.
      </p>
      <Clarification processId={process.id} pendencyId={pendency.id} onChange={onChange} />
      {canRevise && <ConstraintRevision processId={process.id} pendencyId={pendency.id} constraints={constraints} onChange={onChange} />}
    </div>
  );
}

function ResolutionQuestionView({ processId, pendency, onChange }: { processId: string; pendency: Pendency; onChange: () => void }) {
  const question = pendency.conflict!.resolutionQuestion;
  const { saving, error, act } = useAction(onChange);
  if (question === null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">A IA ainda não formulou a pergunta de resolução.</p>
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => act(() => requestResolutionQuestion(processId, pendency.id), "Não foi possível pedir a pergunta à IA.")}
        >
          Pedir pergunta à IA
        </Button>
        {error && <p className="text-destructive w-full text-xs">{error}</p>}
      </div>
    );
  }
  const last = question.attempts.at(-1)!;
  return (
    <div className="flex flex-col gap-2">
      {question.status === "running" && <p className="text-muted-foreground text-xs">A IA está formulando a pergunta de resolução…</p>}
      {question.question && (
        <p className="bg-muted rounded-md p-2 text-sm">
          <span className="text-muted-foreground text-xs">Pergunta da IA: </span>
          {question.question}
        </p>
      )}
      {question.status !== "running" && question.status !== "completed" && (
        <>
          <p className="text-xs">{attemptProblem(last)}</p>
          <NewAttempt last={last} open={(cli) => requestResolutionQuestion(processId, pendency.id, cli)} onChange={onChange} />
        </>
      )}
      <AttemptList attempts={question.attempts} />
    </div>
  );
}

function Clarification({ processId, pendencyId, onChange }: { processId: string; pendencyId: string; onChange: () => void }) {
  const [text, setText] = useState("");
  const { saving, error, act } = useAction(onChange);
  const id = `clarification-${pendencyId}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await act(() => clarifyConflict(processId, pendencyId, text), "Não foi possível registrar o esclarecimento; tente de novo.")) {
      setText("");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal">
        Esclarecimento: há uma alternativa provisória, ou algo foi mal entendido?
      </Label>
      <Textarea id={id} value={text} rows={2} disabled={saving} onChange={(event) => setText(event.target.value)} />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving || text.trim() === ""}>
          {saving ? "Registrando…" : "Registrar esclarecimento"}
        </Button>
      </div>
    </form>
  );
}

function ConstraintRevision({
  processId,
  pendencyId,
  constraints,
  onChange,
}: {
  processId: string;
  pendencyId: string;
  constraints: ProcessDetail["constraints"];
  onChange: () => void;
}) {
  const [constraintId, setConstraintId] = useState(constraints[0]!.id);
  const [kind, setKind] = useState<ItemKind | "none">("constraint");
  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const { saving, error, act } = useAction(onChange);
  const prefix = `revision-${pendencyId}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await act(
      () =>
        reviseConstraintForConflict(processId, pendencyId, {
          constraintId,
          replacement: kind === "none" ? null : { kind, statement, scope: null, unit: null },
          note: note.trim() === "" ? null : note,
        }),
      "Não foi possível rever a Restrição; tente de novo.",
    );
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer">Rever uma Restrição</summary>
      <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-constraint`} className="text-xs font-normal">
            Restrição a retirar (fica no histórico)
          </Label>
          <select
            id={`${prefix}-constraint`}
            value={constraintId}
            disabled={saving}
            onChange={(event) => setConstraintId(event.target.value)}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          >
            {constraints.map((item) => (
              <option key={item.id} value={item.id}>
                {item.statement}
                {itemDetails(item) ? ` (${itemDetails(item)})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-kind`} className="text-xs font-normal">
            Substituir por
          </Label>
          <select
            id={`${prefix}-kind`}
            value={kind}
            disabled={saving}
            onChange={(event) => setKind(event.target.value as ItemKind | "none")}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          >
            <option value="constraint">Uma Restrição revista</option>
            <option value="preference">Uma Preferência (deixa de ser inegociável)</option>
            <option value="none">Nada: só retirar</option>
          </select>
          {kind !== "none" && (
            <Input
              aria-label="O que a substituta diz"
              value={statement}
              disabled={saving}
              placeholder="Por exemplo: entregar em cinco semanas"
              onChange={(event) => setStatement(event.target.value)}
            />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-note`} className="text-xs font-normal">
            Nota (opcional)
          </Label>
          <Textarea id={`${prefix}-note`} value={note} rows={2} disabled={saving} onChange={(event) => setNote(event.target.value)} />
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving || (kind !== "none" && statement.trim() === "")}>
            {saving ? "Revendo…" : "Rever a Restrição"}
          </Button>
        </div>
      </form>
    </details>
  );
}
