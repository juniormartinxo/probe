import { useState, type FormEvent } from "react";
import {
  acceptOption,
  addOption,
  ApiError,
  decideOptions,
  discardOption,
  newOptionProposalAttempt,
  requestOptionProposal,
  retryOptionAssessment,
  reviseConstraint,
  undecidedOptionStatuses,
  type AssessmentChoice,
  type Option,
  type OptionCheck,
  type OptionProposal,
  type OptionViability,
  type ProcessDetail,
} from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { ConstraintRevisionForm } from "@/components/constraints-and-preferences";
import { NewAttempt } from "@/components/new-attempt";
import { FailedJudgment, JudgmentLine } from "@/components/reassessments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attemptProblem } from "@/refinement";

const violationText: Record<AssessmentChoice, string> = {
  yes: "viola a Restrição",
  no: "cumpre a Restrição",
  insufficient: "informação insuficiente",
};

const viabilityText: Record<OptionViability, string> = {
  viable: "Viável",
  inviable: "Inviável",
  undecided: "Viabilidade sem decisão",
};

const errorText: Record<string, string> = {
  stage_not_current: "A Etapa O já não é a atual.",
  option_not_suggested: "Esta sugestão já foi aceita ou descartada.",
  option_discarded: "Esta Opção já foi descartada.",
  option_pair_decided: "Este par já foi decidido.",
  unknown_assessment: "Há uma Avaliação mais recente do que a que você viu. Confira-a antes de decidir.",
  option_check_assessed: "O Jev já avaliou estes pares.",
  option_proposal_already_requested: "Já há uma proposta de Opções em andamento.",
};

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

// Opções da Etapa O: a IA propõe, identificadas como sugestão; você aceita (como vieram ou editadas),
// descarta ou acrescenta as suas. O Jev avalia cada Opção aceita contra cada Restrição em vigor, e a
// que viola uma Restrição fica inviável, por melhor que seja no resto. Depois da Etapa O, só leitura.
export function Options({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const editable = process.status === "open" && process.currentStage === "O";
  if (!editable && process.options.length === 0) return null;
  const accepted = process.options.filter((option) => option.status === "accepted");
  const suggested = process.options.filter((option) => option.status === "suggested");
  const discarded = process.options.filter((option) => option.status === "discarded");
  const checks = process.optionChecks.filter((check) => check.status !== "decided");
  const noneViable =
    accepted.length > 0 && accepted.every((option) => option.viability === "inviable");
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div>
        <p className="text-xs font-medium">Opções</p>
        <p className="text-muted-foreground text-xs">
          Caminhos concretos para o problema, inclusive eliminá-lo ou resolvê-lo à mão. Não é preciso ter uma Opção por Ponto:
          um Ponto sem caminho sensato pode ser declarado inaplicável. Uma Opção que viola uma Restrição fica inviável.
        </p>
      </div>
      {accepted.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma Opção aceita ainda.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accepted.map((option) => (
            <AcceptedOption key={option.id} processId={process.id} option={option} editable={editable} onChange={onChange} />
          ))}
        </ul>
      )}
      {checks.map((check) => (
        <UndecidedCheck key={check.id} processId={process.id} check={check} editable={editable} onChange={onChange} />
      ))}
      {editable && noneViable && <NoViableOption process={process} accepted={accepted} onChange={onChange} />}
      {suggested.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">Sugestões da IA</p>
          <ul className="flex flex-col gap-2">
            {suggested.map((option) => (
              <SuggestedOption key={option.id} processId={process.id} option={option} editable={editable} onChange={onChange} />
            ))}
          </ul>
        </div>
      )}
      {editable && <ProposalStatus processId={process.id} proposal={process.optionProposals.at(-1) ?? null} onChange={onChange} />}
      {editable && <NewOption processId={process.id} onChange={onChange} />}
      {discarded.length > 0 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Opções descartadas ({discarded.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {discarded.map((option) => (
              <li key={option.id} className="line-through">
                {option.statement}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function OptionText({ option }: { option: Option }) {
  const edited =
    option.suggestion !== null &&
    (option.suggestion.statement !== option.statement || option.suggestion.description !== option.description);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-pre-wrap">{option.statement}</span>
      {option.description && <span className="text-muted-foreground text-xs whitespace-pre-wrap">{option.description}</span>}
      <span className="flex flex-wrap gap-1">
        {option.stagePoints.map((point) => (
          <Badge key={point.key} variant="outline" className="text-[10px]">
            {point.name}
          </Badge>
        ))}
        {option.status === "accepted" && (
          <span className="text-muted-foreground text-xs">
            {option.origin === "user" ? "Sua" : edited ? "Sugerida pela IA, editada por você" : "Sugerida pela IA"}
          </span>
        )}
      </span>
      {edited && option.suggestion && (
        <span className="text-muted-foreground text-xs">Sugestão original: “{option.suggestion.statement}”</span>
      )}
    </div>
  );
}

function AcceptedOption({
  processId,
  option,
  editable,
  onChange,
}: {
  processId: string;
  option: Option;
  editable: boolean;
  onChange: () => void;
}) {
  const { saving, error, act } = useAction(onChange);
  return (
    <li className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <OptionText option={option} />
        <div className="ml-auto flex items-center gap-1">
          {option.viability && (
            <Badge variant={option.viability === "inviable" ? "destructive" : option.viability === "viable" ? "secondary" : "outline"}>
              {viabilityText[option.viability]}
            </Badge>
          )}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => act(() => discardOption(processId, option.id), "Não foi possível descartar a Opção.")}
            >
              {saving ? "Descartando…" : "Descartar"}
            </Button>
          )}
        </div>
      </div>
      {option.violations.length > 0 && (
        <ul className="text-destructive text-xs">
          {option.violations.map((violation) => (
            <li key={violation.constraintId}>
              Viola a Restrição “{violation.statement}” ({violation.decidedBy === "jev" ? "segundo o Jev" : "segundo você"}).
            </li>
          ))}
        </ul>
      )}
      {option.viability === "undecided" && (
        <p className="text-muted-foreground text-xs">O Jev ainda avalia, ou espera a sua decisão abaixo, se ela cumpre as Restrições.</p>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </li>
  );
}

function SuggestedOption({
  processId,
  option,
  editable,
  onChange,
}: {
  processId: string;
  option: Option;
  editable: boolean;
  onChange: () => void;
}) {
  const { saving, error, act } = useAction(onChange);
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(option.statement);
  const [description, setDescription] = useState(option.description ?? "");

  async function acceptEdited(event: FormEvent) {
    event.preventDefault();
    const done = await act(
      () => acceptOption(processId, option.id, { statement, description: description.trim() === "" ? null : description }),
      "Não foi possível aceitar a Opção. O que você escreveu continua aqui; tente de novo.",
    );
    if (done) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant="outline">Sugestão da IA</Badge>
        {!editing && <OptionText option={option} />}
      </div>
      {editable && !editing && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => act(() => discardOption(processId, option.id), "Não foi possível descartar a sugestão.")}
          >
            Descartar
          </Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button size="sm" disabled={saving} onClick={() => act(() => acceptOption(processId, option.id), "Não foi possível aceitar a Opção.")}>
            {saving ? "Salvando…" : "Aceitar"}
          </Button>
        </div>
      )}
      {editing && (
        <form onSubmit={acceptEdited} className="flex flex-col gap-2">
          <Label htmlFor={`option-statement-${option.id}`} className="text-xs font-normal">
            Opção
          </Label>
          <Input
            id={`option-statement-${option.id}`}
            value={statement}
            disabled={saving}
            onChange={(event) => setStatement(event.target.value)}
          />
          <Label htmlFor={`option-description-${option.id}`} className="text-xs font-normal">
            O que ela envolve (opcional)
          </Label>
          <Textarea
            id={`option-description-${option.id}`}
            value={description}
            rows={2}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={saving || statement.trim() === ""}>
              {saving ? "Salvando…" : "Aceitar editada"}
            </Button>
          </div>
        </form>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </li>
  );
}

// Uma verificação à espera: o Jev não avaliou, falhou ou não teve certeza em algum par Opção × Restrição.
function UndecidedCheck({
  processId,
  check,
  editable,
  onChange,
}: {
  processId: string;
  check: OptionCheck;
  editable: boolean;
  onChange: () => void;
}) {
  const { saving, error, act } = useAction(onChange);
  const latest = check.assessments.at(-1) ?? null;
  const pending = check.pairs.filter((pair) => undecidedOptionStatuses.includes(pair.status));
  const decide = (pairIds: string[], decision: "violates" | "complies") =>
    act(
      () => decideOptions(processId, check.id, { optionAssessmentId: latest!.id, pairIds, decision }),
      "Não foi possível registrar a sua decisão; tente de novo.",
    );
  const retry = () => act(() => retryOptionAssessment(processId, check.id), "Não foi possível pedir a Avaliação ao Jev.");

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {check.status === "not_assessed" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">O Jev ainda não avaliou se as Opções aceitas cumprem as Restrições.</p>
          {editable && (
            <Button variant="outline" size="sm" disabled={saving} onClick={retry}>
              {saving ? "Avaliando…" : "Avaliar"}
            </Button>
          )}
        </div>
      )}
      {check.status === "assessment_failed" && latest && (
        <div className="flex flex-col gap-2">
          <FailedJudgment failureReason={latest.failureReason} message={latest.message} fallback="A Avaliação das Opções falhou." />
          <p className="text-muted-foreground text-xs">
            Tente de novo ou decida sem o Jev, par a par; a decisão fica registrada.
          </p>
          {editable && (
            <div>
              <Button variant="outline" size="sm" disabled={saving} onClick={retry}>
                Tentar de novo
              </Button>
            </div>
          )}
        </div>
      )}
      {latest && (check.status === "assessment_failed" || check.status === "awaiting_decision") && (
        <ul className="flex flex-col gap-3">
          {pending.map((pair) => (
            <li key={pair.id} className="flex flex-col gap-1.5">
              <p className="text-xs">
                Opção “{pair.option.statement}” × Restrição “{pair.constraint.statement}”
              </p>
              {pair.verdict && <JudgmentLine {...pair.verdict} texts={violationText} />}
              <p className="text-muted-foreground text-xs">
                {pair.verdict ? "O Jev não tem certeza." : "Sem Avaliação do Jev."} Decida se a Opção viola a Restrição.
              </p>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={saving} onClick={() => decide([pair.id], "violates")}>
                    Viola a Restrição
                  </Button>
                  <Button size="sm" disabled={saving} onClick={() => decide([pair.id], "complies")}>
                    Cumpre a Restrição
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

// Nenhuma Opção aceita atende às Restrições: os impedimentos de cada uma e os dois caminhos, pedir
// novas Opções ou rever uma Restrição. O Processo continua aberto; não há escolha forçada.
function NoViableOption({ process, accepted, onChange }: { process: ProcessDetail; accepted: Option[]; onChange: () => void }) {
  const constraints = process.constraints.filter((item) => item.withdrawnAt === null);
  return (
    <div className="border-destructive/40 flex flex-col gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">Nenhuma Opção atende às Restrições</p>
      <ul className="flex flex-col gap-1 text-xs">
        {accepted.map((option) => (
          <li key={option.id}>
            “{option.statement}” viola {option.violations.map((violation) => `“${violation.statement}”`).join(", ")}.
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        A Etapa O só se confirma com uma Opção viável. Peça novas Opções à IA, acrescente uma sua ou reveja uma Restrição, se ela
        não for de fato inegociável.
      </p>
      {constraints.length > 0 && (
        <ConstraintRevisionForm
          idPrefix={`options-revision-${process.id}`}
          constraints={constraints}
          revise={(constraintId, revision) => reviseConstraint(process.id, constraintId, revision)}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function ProposalStatus({ processId, proposal, onChange }: { processId: string; proposal: OptionProposal | null; onChange: () => void }) {
  const { saving, error, act } = useAction(onChange);
  if (proposal?.status === "running") {
    return <p className="text-muted-foreground rounded-md border p-3 text-sm">A IA está propondo Opções…</p>;
  }
  const last = proposal?.attempts.at(-1);
  return (
    <div className="flex flex-col gap-2">
      {proposal && proposal.status !== "completed" && last ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm">{attemptProblem(last)}</p>
          {last.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{last.message}</p>}
          <NewAttempt last={last} open={(cli) => newOptionProposalAttempt(processId, proposal.id, cli)} onChange={onChange} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {proposal?.status === "completed" && proposal.optionIds.length === 0
              ? "A IA não encontrou outra Opção sensata na última proposta."
              : "A IA propõe Opções a partir do problema e das Restrições, sem inventar só para atingir uma quantidade."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => act(() => requestOptionProposal(processId), "Não foi possível pedir Opções à IA.")}
          >
            {saving ? "Pedindo…" : proposal ? "Explorar novas Opções" : "Pedir Opções à IA"}
          </Button>
        </div>
      )}
      {proposal && <AttemptList attempts={proposal.attempts} />}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function NewOption({ processId, onChange }: { processId: string; onChange: () => void }) {
  const [statement, setStatement] = useState("");
  const [description, setDescription] = useState("");
  const { saving, error, act } = useAction(onChange);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await act(
      () => addOption(processId, { statement, description: description.trim() === "" ? null : description }),
      "Não foi possível acrescentar a Opção. O que você escreveu continua aqui; tente de novo.",
    );
    if (done) {
      setStatement("");
      setDescription("");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <Label htmlFor={`new-option-${processId}`} className="text-xs font-normal">
        Nova Opção sua
      </Label>
      <Input id={`new-option-${processId}`} value={statement} disabled={saving} onChange={(event) => setStatement(event.target.value)} />
      <Input
        aria-label="O que ela envolve (opcional)"
        placeholder="O que ela envolve (opcional)"
        value={description}
        disabled={saving}
        onChange={(event) => setDescription(event.target.value)}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button type="submit" variant="outline" size="sm" className="self-end" disabled={saving || statement.trim() === ""}>
        {saving ? "Acrescentando…" : "Acrescentar"}
      </Button>
    </form>
  );
}
