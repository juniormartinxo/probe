import { useState, type FormEvent } from "react";
import {
  ApiError,
  registerItem,
  reviseConstraint,
  withdrawItem,
  type ConstraintRevisionRequest,
  type ItemKind,
  type ItemStatement,
  type ProcessDetail,
  type StatedItem,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const kinds: { kind: ItemKind; title: string; hint: string; empty: string }[] = [
  {
    kind: "constraint",
    title: "Restrições",
    hint: "Inegociáveis: uma Opção que viole uma Restrição fica fora, por melhor que seja no resto.",
    empty: "Nenhuma Restrição registrada.",
  },
  {
    kind: "preference",
    title: "Preferências",
    hint: "Desejáveis, mas negociáveis: pesam no Balanceamento sem eliminar Opções.",
    empty: "Nenhuma Preferência registrada.",
  },
];

// Escopo e unidade, quando registrados, como aparecem ao lado do que o item diz.
export function itemDetails({ scope, unit }: Pick<ItemStatement, "scope" | "unit">): string {
  return [scope && `escopo: ${scope}`, unit && `unidade: ${unit}`].filter(Boolean).join(" · ");
}

// Restrições e Preferências do Processo, lado a lado. Enquanto R é a Etapa atual, o usuário registra
// e retira itens; depois, uma Restrição só muda por uma Revisão de Restrição, e as Confirmações de
// Etapa que a sustentavam são reavaliadas. `onChange` recarrega o Processo depois de cada ação.
export function ConstraintsAndPreferences({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  const editable = process.status === "open" && process.currentStage === "R";
  const inForce = process.constraints.filter((item) => item.withdrawnAt === null);
  // Depois de R: as Restrições já existem, e a Etapa R não é mais a atual.
  const revisable = process.status === "open" && !editable && inForce.length > 0;
  const itemsOf = (kind: ItemKind) => (kind === "constraint" ? process.constraints : process.preferences);
  if (!editable && process.constraints.length + process.preferences.length === 0) return null;
  return (
    <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
      {kinds.map(({ kind, title, hint, empty }) => (
        <div key={kind} className="flex flex-col gap-2">
          <div>
            <p className="text-xs font-medium">{title}</p>
            <p className="text-muted-foreground text-xs">{hint}</p>
          </div>
          <ItemList processId={process.id} kind={kind} items={itemsOf(kind)} empty={empty} editable={editable} onChange={onChange} />
          {editable && <NewItem processId={process.id} kind={kind} onChange={onChange} />}
          {revisable && kind === "constraint" && (
            <ConstraintRevisionForm
              idPrefix={`revision-${process.id}`}
              constraints={inForce}
              revise={(constraintId, revision) => reviseConstraint(process.id, constraintId, revision)}
              onChange={onChange}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ItemList({
  processId,
  kind,
  items,
  empty,
  editable,
  onChange,
}: {
  processId: string;
  kind: ItemKind;
  items: StatedItem[];
  empty: string;
  editable: boolean;
  onChange: () => void;
}) {
  const [withdrawing, setWithdrawing] = useState<string>();
  const [error, setError] = useState<string>();

  async function withdraw(item: StatedItem) {
    setWithdrawing(item.id);
    setError(undefined);
    try {
      await withdrawItem(processId, kind, item.id);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined;
      // Outra aba pode ter retirado antes; o estado recarregado mostra o que vale.
      if (code === "no_constraint_or_preference") {
        setError("O Ponto das Restrições e Preferências está coberto: registre outro item antes de retirar o último.");
      } else if (code !== "already_withdrawn") setError("Não foi possível retirar o item.");
    } finally {
      setWithdrawing(undefined);
      onChange();
    }
  }

  if (items.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-start gap-2">
          <div className={item.withdrawnAt ? "text-muted-foreground line-through" : undefined}>
            <span className="whitespace-pre-wrap">{item.statement}</span>
            {itemDetails(item) && <span className="text-muted-foreground block text-xs">{itemDetails(item)}</span>}
          </div>
          {item.withdrawnAt && <span className="text-muted-foreground text-xs">retirado</span>}
          {editable && !item.withdrawnAt && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 text-xs"
              disabled={withdrawing !== undefined}
              onClick={() => withdraw(item)}
            >
              {withdrawing === item.id ? "Retirando…" : "Retirar"}
            </Button>
          )}
        </li>
      ))}
      {error && <li className="text-destructive text-xs">{error}</li>}
    </ul>
  );
}

function NewItem({ processId, kind, onChange }: { processId: string; kind: ItemKind; onChange: () => void }) {
  const [statement, setStatement] = useState("");
  const [scope, setScope] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const id = (field: string) => `${kind}-${field}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await registerItem(processId, kind, { statement, scope: scope.trim() || null, unit: unit.trim() || null });
      setStatement("");
      setScope("");
      setUnit("");
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "stage_not_current"
          ? "A Etapa R já não é a atual."
          : "Não foi possível registrar. O que você escreveu continua aqui; tente de novo.",
      );
    } finally {
      setSaving(false);
      onChange();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <Label htmlFor={id("statement")} className="text-xs font-normal">
        {kind === "constraint" ? "Nova Restrição" : "Nova Preferência"}
      </Label>
      <Input id={id("statement")} value={statement} disabled={saving} onChange={(event) => setStatement(event.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Escopo (opcional)"
          placeholder="Escopo (opcional)"
          value={scope}
          disabled={saving}
          onChange={(event) => setScope(event.target.value)}
        />
        <Input
          aria-label="Unidade (opcional)"
          placeholder="Unidade (opcional)"
          value={unit}
          disabled={saving}
          onChange={(event) => setUnit(event.target.value)}
        />
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button type="submit" variant="outline" size="sm" className="self-end" disabled={saving || statement.trim() === ""}>
        {saving ? "Registrando…" : "Registrar"}
      </Button>
    </form>
  );
}

const revisionErrorText: Record<string, string> = {
  already_withdrawn: "Esta Restrição já foi retirada.",
  no_constraint_or_preference: "Sem substituta, o Ponto que distingue Restrições de Preferências ficaria sem nenhuma.",
  pendency_resolved: "Esta Pendência já foi resolvida.",
};

// Revisão de Restrição: retira uma Restrição em vigor e, se houver, registra a que a substitui, com
// uma nota. Serve à resolução de um conflito e à revisão avulsa depois da Etapa R.
export function ConstraintRevisionForm({
  idPrefix,
  constraints,
  revise,
  onChange,
}: {
  idPrefix: string;
  // As Restrições em vigor.
  constraints: StatedItem[];
  revise: (constraintId: string, revision: ConstraintRevisionRequest) => Promise<unknown>;
  onChange: () => void;
}) {
  const [chosen, setChosen] = useState(constraints[0]!.id);
  // A escolhida pode ter deixado de valer (revista em outra aba ou agora): cai na primeira em vigor.
  const constraintId = constraints.some((item) => item.id === chosen) ? chosen : constraints[0]!.id;
  const [kind, setKind] = useState<ItemKind | "none">("constraint");
  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const prefix = idPrefix;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await revise(constraintId, {
        replacement: kind === "none" ? null : { kind, statement, scope: null, unit: null },
        note: note.trim() === "" ? null : note,
      });
      setStatement("");
      setNote("");
    } catch (caught) {
      setError((caught instanceof ApiError && caught.code && revisionErrorText[caught.code]) || "Não foi possível rever a Restrição; tente de novo.");
    } finally {
      setSaving(false);
      onChange();
    }
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer">Rever uma Restrição</summary>
      <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
        <p className="text-muted-foreground">
          As Confirmações de Etapa que já valiam com a Restrição passam pela Avaliação de impacto do Jev, e você revê as afetadas.
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-constraint`} className="text-xs font-normal">
            Restrição a retirar (fica no histórico)
          </Label>
          <select
            id={`${prefix}-constraint`}
            value={constraintId}
            disabled={saving}
            onChange={(event) => setChosen(event.target.value)}
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
