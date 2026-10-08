import { useState, type FormEvent } from "react";
import {
  ApiError,
  confirmProblemStatement,
  requestRefinement,
  newRefinementAttempt,
  type ProblemStatement,
  type ProcessDetail,
  type Proposal,
  type Refinement,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { attemptProblem, attemptStatusName, originName, usageSummary } from "@/refinement";

// Enunciado do problema: a proposta da IA aparece como sugestão até o usuário confirmar o texto,
// como veio ou corrigido. `onChange` recarrega o Processo depois de cada ação.
export function ProblemStatementSection({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const { problemStatement, refinement } = process;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Enunciado do problema</h2>
      {problemStatement ? (
        <ConfirmedStatement statement={problemStatement} lateProposal={refinement?.proposal?.arrivedAfterConfirmation} />
      ) : (
        <>
          <RefinementStatus processId={process.id} refinement={refinement} onChange={onChange} />
          <StatementForm
            processId={process.id}
            proposal={refinement?.proposal ?? null}
            onChange={onChange}
          />
        </>
      )}
      {refinement && <AttemptList refinement={refinement} />}
    </section>
  );
}

function ConfirmedStatement({ statement, lateProposal }: { statement: ProblemStatement; lateProposal?: boolean }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge>Confirmado</Badge>
          <CardDescription>
            {originName(statement.origin)} · {formatDate(statement.confirmedAt)}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm whitespace-pre-wrap">{statement.statement}</p>
        {lateProposal && (
          <p className="text-muted-foreground text-xs">
            Uma proposta da IA chegou depois da Confirmação e não alterou o enunciado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RefinementStatus({
  processId,
  refinement,
  onChange,
}: {
  processId: string;
  refinement: Refinement | null;
  onChange: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function send(action: (processId: string) => Promise<Refinement>) {
    setSending(true);
    setError(undefined);
    try {
      await action(processId);
    } catch (caught) {
      // Outra aba pode ter pedido antes; o estado recarregado mostra o que vale.
      if (!(caught instanceof ApiError && caught.status === 409)) setError("Não foi possível pedir a proposta à IA.");
    } finally {
      setSending(false);
      onChange();
    }
  }

  if (!refinement) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">Peça à IA uma proposta de enunciado, ou escreva o seu abaixo.</p>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => send(requestRefinement)}>
          {sending ? "Pedindo…" : "Pedir proposta à IA"}
        </Button>
        {error && <p className="text-destructive w-full text-sm">{error}</p>}
      </div>
    );
  }

  if (refinement.status === "running") {
    return <p className="text-muted-foreground rounded-lg border p-4 text-sm">A IA está preparando uma proposta de enunciado…</p>;
  }

  if (refinement.proposal) return <ProposalCard proposal={refinement.proposal} />;

  const last = refinement.attempts.at(-1)!;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm">{attemptProblem(last)}</p>
      {last.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{last.message}</p>}
      <p className="text-muted-foreground text-xs">Seu progresso continua salvo. Você pode tentar de novo ou escrever o enunciado.</p>
      <div>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => send(newRefinementAttempt)}>
          {sending ? "Pedindo…" : "Tentar novamente"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  return (
    <Card className="gap-3 border-dashed">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Sugestão da IA</Badge>
          <CardDescription>ainda não confirmada</CardDescription>
        </div>
        <CardTitle className="text-sm font-normal whitespace-pre-wrap">{proposal.statement}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ProposalList title="Ambiguidades encontradas" items={proposal.ambiguities} empty="Nenhuma ambiguidade apontada." />
        <ProposalList
          title="Informações faltantes"
          items={proposal.missingInformation}
          empty="Nenhuma informação faltante apontada."
        />
      </CardContent>
    </Card>
  );
}

function ProposalList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="list-disc pl-5">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatementForm({
  processId,
  proposal,
  onChange,
}: {
  processId: string;
  proposal: Proposal | null;
  onChange: () => void;
}) {
  const [draft, setDraft] = useState(proposal?.statement ?? "");
  // O rascunho só conta como vindo da proposta se foi preenchido com ela; o que o usuário escreveu
  // antes de a proposta chegar continua sendo dele.
  const [fromProposal, setFromProposal] = useState(proposal !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const corrected = proposal !== null && fromProposal && draft.trim() !== proposal.statement;

  function adoptProposal(statement: string) {
    setDraft(statement);
    setFromProposal(true);
  }

  // A proposta entra no campo quando chega, sem apagar o que o usuário já tenha escrito
  // (estado ajustado durante a renderização, sem efeito).
  const [seenProposalId, setSeenProposalId] = useState(proposal?.id ?? null);
  if (proposal && proposal.id !== seenProposalId) {
    setSeenProposalId(proposal.id);
    if (draft.trim() === "") adoptProposal(proposal.statement);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await confirmProblemStatement(processId, draft, fromProposal ? (proposal?.id ?? null) : null);
      onChange();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) return onChange();
      // O rascunho fica no campo para uma nova tentativa.
      setError("Não foi possível salvar o enunciado. Seu texto continua aqui; tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-3">
      <form onSubmit={handleSubmit} className="contents">
        <CardHeader>
          <CardTitle className="text-sm">Seu enunciado</CardTitle>
          <CardDescription>
            {proposal
              ? "Confirme a proposta como veio ou corrija o texto antes de confirmar."
              : "Escreva o enunciado do problema. Ele só passa a valer depois da sua Confirmação."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="statement" className="sr-only">
            Enunciado do problema
          </Label>
          <Textarea id="statement" value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {proposal && (corrected || !fromProposal) && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => adoptProposal(proposal.statement)}>
              {fromProposal ? "Voltar à proposta" : "Usar a proposta"}
            </Button>
          )}
          <Button type="submit" disabled={saving || draft.trim() === ""}>
            {saving ? "Confirmando…" : corrected ? "Confirmar enunciado corrigido" : "Confirmar enunciado"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function AttemptList({ refinement }: { refinement: Refinement }) {
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer">Solicitações à IA ({refinement.attempts.length})</summary>
      <ol className="mt-2 flex flex-col gap-1">
        {refinement.attempts.map((attempt) => (
          <li key={attempt.id}>
            Tentativa {attempt.number} · {attempt.cli} · {attempt.model} · {attemptStatusName(attempt.status)} ·{" "}
            {usageSummary(attempt.usage)} · {formatDate(attempt.startedAt)}
          </li>
        ))}
      </ol>
    </details>
  );
}
