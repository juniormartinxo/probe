import { useState, type FormEvent } from "react";
import {
  ApiError,
  chooseOption,
  newRecommendationAttempt,
  recordComparison,
  requestRecommendation,
  type ComparisonCells,
  type ComparisonMatrixRow,
  type ProcessDetail,
  type Recommendation,
} from "@/api";
import { AttemptList } from "@/components/attempt-list";
import { NewAttempt } from "@/components/new-attempt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { attemptProblem } from "@/refinement";
import { stages } from "@/stages";

const dimensions: { key: keyof ComparisonCells; name: string }[] = [
  { key: "gains", name: "Ganhos" },
  { key: "losses", name: "Perdas" },
  { key: "effort", name: "Esforço" },
  { key: "scalability", name: "Escala" },
  { key: "maintenance", name: "Manutenção" },
  { key: "reversibility", name: "Reversibilidade" },
];

const emptyCells: ComparisonCells = { gains: "", losses: "", effort: "", scalability: "", maintenance: "", reversibility: "" };

const errorText: Record<string, string> = {
  stage_not_current: "A Etapa B já não é a atual.",
  option_not_choosable: "Esta Opção não pode ser escolhida: ela não é viável.",
  option_inviable: "Esta Opção é inviável: ela não entra na comparação.",
  invalid_discards: "Os descartes não batem com as Opções viáveis. Recarregue e tente de novo.",
  discard_reasons_required: "Diga por que descarta cada outra Opção viável.",
  recommendation_already_requested: "Já há uma Recomendação em andamento.",
  unknown_recommendation: "Esta Recomendação não sugeriu linha para a Opção.",
  no_viable_option: "Nenhuma Opção aceita é viável: não há o que recomendar.",
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

const fromStageB = (process: ProcessDetail) =>
  stages.findIndex((item) => item.stage === process.currentStage) >= stages.findIndex((item) => item.stage === "B");

// Balanceamento (Etapa B): a matriz qualitativa das Opções aceitas, a Recomendação da IA e a sua
// Escolha com os motivos dos descartes. A Escolha continua revisável enquanto o Processo estiver aberto.
export function Balancing({ process, onChange }: { process: ProcessDetail; onChange: () => void }) {
  if (!fromStageB(process) || process.comparisonMatrix.length === 0) return null;
  const open = process.status === "open";
  const latest = process.recommendations.at(-1) ?? null;
  // A Recomendação mais recente que veio: as linhas que ela sugere aparecem onde você ainda não escreveu.
  const made = process.recommendations.findLast((item) => item.recommendation !== null)?.recommendation ?? null;
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4 text-sm">
      <div>
        <p className="text-xs font-medium">Balanceamento</p>
        <p className="text-muted-foreground text-xs">
          Compare as Opções aceitas sem notas nem pesos: o que cada uma ganha e perde, o esforço, a escala, a manutenção e a
          reversibilidade. Uma Opção que viola uma Restrição é inviável e não pode ser escolhida, por melhor que seja no resto.
        </p>
      </div>
      <Matrix process={process} suggested={made} editable={open} onChange={onChange} />
      {process.currentStage === "B" && open && <RecommendationStatus processId={process.id} recommendation={latest} onChange={onChange} />}
      {made && <RecommendationView recommendation={made} matrix={process.comparisonMatrix} />}
      {process.recommendations.length > 1 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Recomendações anteriores ({process.recommendations.length - 1})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {process.recommendations.slice(0, -1).map((item) => (
              <li key={item.id}>
                {item.recommendation ? `“${item.recommendation.option.statement}”: ${item.recommendation.rationale}` : "Não veio."}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Choice process={process} editable={open} onChange={onChange} />
    </div>
  );
}

type Suggested = NonNullable<Recommendation["recommendation"]>;

function Matrix({
  process,
  suggested,
  editable,
  onChange,
}: {
  process: ProcessDetail;
  suggested: Suggested | null;
  editable: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const recommendationId = process.recommendations.findLast((item) => item.recommendation !== null)?.id ?? null;
  const editingRow = process.comparisonMatrix.find((row) => row.option.id === editing);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-xs">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="border-b p-2 font-medium">Opção</th>
              <th className="border-b p-2 font-medium">Restrições</th>
              {dimensions.map((dimension) => (
                <th key={dimension.key} className="border-b p-2 font-medium">
                  {dimension.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {process.comparisonMatrix.map((row) => (
              <MatrixRow
                key={row.option.id}
                row={row}
                suggestion={suggested?.comparisons.find((item) => item.option.id === row.option.id) ?? null}
                editable={editable}
                onEdit={() => setEditing(row.option.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {editingRow && (
        <ComparisonForm
          key={editingRow.option.id}
          processId={process.id}
          row={editingRow}
          suggestion={suggested?.comparisons.find((item) => item.option.id === editingRow.option.id) ?? null}
          recommendationId={recommendationId}
          onDone={() => setEditing(null)}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function MatrixRow({
  row,
  suggestion,
  editable,
  onEdit,
}: {
  row: ComparisonMatrixRow;
  suggestion: (ComparisonCells & { option: { id: string } }) | null;
  editable: boolean;
  onEdit: () => void;
}) {
  const inviable = row.viability === "inviable";
  // Sem linha sua, a sugerida pela IA aparece identificada, até você aceitá-la ou escrever a sua.
  const shown = row.comparison ?? (inviable ? null : suggestion);
  const fromAi = row.comparison === null && shown !== null;
  return (
    <tr className={inviable ? "text-muted-foreground" : undefined}>
      <td className="border-b p-2 align-top">
        <span className={inviable ? "block line-through" : "block"}>{row.option.statement}</span>
        {fromAi && (
          <Badge variant="outline" className="mt-1 block w-fit text-[10px]">
            Sugestão da IA
          </Badge>
        )}
        {row.history.length > 0 && <span className="text-muted-foreground mt-1 block">{row.history.length} versão(ões) anterior(es)</span>}
        {editable && !inviable && (
          <Button variant="link" size="sm" className="mt-1 block h-auto p-0 text-xs" onClick={onEdit}>
            {row.comparison ? "Reescrever" : fromAi ? "Revisar" : "Escrever"}
          </Button>
        )}
      </td>
      <td className="border-b p-2 align-top">
        {row.viability === "viable" && "Atende"}
        {row.viability === "undecided" && "Sem decisão"}
        {inviable && (
          <span className="text-destructive">
            Inviável: viola {row.violations.map((violation) => `“${violation.statement}”`).join(", ")}
          </span>
        )}
      </td>
      {dimensions.map((dimension) => (
        <td key={dimension.key} className={`border-b p-2 align-top whitespace-pre-wrap ${fromAi ? "italic" : ""}`}>
          {shown ? shown[dimension.key] : "—"}
        </td>
      ))}
    </tr>
  );
}

// A linha de uma Opção: parte da sua, se houver, ou da sugerida pela IA; grava como veio ou editada.
function ComparisonForm({
  processId,
  row,
  suggestion,
  recommendationId,
  onDone,
  onChange,
}: {
  processId: string;
  row: ComparisonMatrixRow;
  suggestion: ComparisonCells | null;
  recommendationId: string | null;
  onDone: () => void;
  onChange: () => void;
}) {
  const start = row.comparison ?? suggestion ?? emptyCells;
  const [cells, setCells] = useState<ComparisonCells>(pick(start));
  const { saving, error, act } = useAction(onChange);
  // Só quando parte da sugestão (não de uma linha sua) a linha fica ligada à Recomendação.
  const [fromSuggestion, setFromSuggestion] = useState(row.comparison === null && suggestion !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await act(
      () => recordComparison(processId, row.option.id, { ...cells, recommendationId: fromSuggestion ? recommendationId : null }),
      "Não foi possível gravar a linha. O que você escreveu continua aqui; tente de novo.",
    );
    if (done) onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">
        Linha de “{row.option.statement}”
        {fromSuggestion && <span className="text-muted-foreground font-normal"> · a partir da sugestão da IA</span>}
      </p>
      {row.comparison && suggestion && !fromSuggestion && row.comparison.recommendationId !== recommendationId && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">A Recomendação mais recente sugere outra linha para esta Opção.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              setCells(pick(suggestion));
              setFromSuggestion(true);
            }}
          >
            Usar a sugestão da IA
          </Button>
        </div>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {dimensions.map((dimension) => (
          <div key={dimension.key} className="flex flex-col gap-1">
            <Label htmlFor={`comparison-${row.option.id}-${dimension.key}`} className="text-xs font-normal">
              {dimension.name}
            </Label>
            <Textarea
              id={`comparison-${row.option.id}-${dimension.key}`}
              rows={2}
              value={cells[dimension.key]}
              disabled={saving}
              onChange={(event) => setCells({ ...cells, [dimension.key]: event.target.value })}
            />
          </div>
        ))}
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={saving || dimensions.some((dimension) => cells[dimension.key].trim() === "")}>
          {saving ? "Gravando…" : "Gravar linha"}
        </Button>
      </div>
    </form>
  );
}

const pick = (source: ComparisonCells): ComparisonCells => ({
  gains: source.gains,
  losses: source.losses,
  effort: source.effort,
  scalability: source.scalability,
  maintenance: source.maintenance,
  reversibility: source.reversibility,
});

function RecommendationStatus({
  processId,
  recommendation,
  onChange,
}: {
  processId: string;
  recommendation: Recommendation | null;
  onChange: () => void;
}) {
  const { saving, error, act } = useAction(onChange);
  if (recommendation?.status === "running") {
    return <p className="text-muted-foreground rounded-md border p-3 text-sm">A IA está comparando as Opções…</p>;
  }
  const last = recommendation?.attempts.at(-1);
  return (
    <div className="flex flex-col gap-2">
      {recommendation && recommendation.status !== "completed" && last ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm">{attemptProblem(last)}</p>
          {last.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{last.message}</p>}
          <NewAttempt last={last} open={(cli) => newRecommendationAttempt(processId, recommendation.id, cli)} onChange={onChange} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            A IA sugere a matriz das Opções viáveis, partindo das linhas que você já escreveu, e recomenda uma. A Escolha continua sua.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => act(() => requestRecommendation(processId), "Não foi possível pedir a Recomendação à IA.")}
          >
            {saving ? "Pedindo…" : recommendation ? "Pedir nova Recomendação" : "Pedir Recomendação à IA"}
          </Button>
        </div>
      )}
      {recommendation && <AttemptList attempts={recommendation.attempts} />}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function RecommendationView({ recommendation, matrix }: { recommendation: Suggested; matrix: ComparisonMatrixRow[] }) {
  const now = matrix.find((row) => row.option.id === recommendation.option.id)?.viability;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Recomendação da IA</Badge>
        <span className="font-medium">{recommendation.option.statement}</span>
      </div>
      <p className="text-xs whitespace-pre-wrap">{recommendation.rationale}</p>
      {now !== "viable" && (
        <p className="text-destructive text-xs">Esta Opção deixou de ser viável depois da Recomendação. Peça uma nova, se quiser.</p>
      )}
      <p className="text-muted-foreground text-xs">É uma sugestão: ela só vira Escolha se você a registrar abaixo.</p>
    </div>
  );
}

// A Escolha: uma Opção viável e o motivo de descarte de cada outra viável. As inviáveis já estão
// descartadas pela Restrição que violam. Trocar de Escolha registra uma nova; a anterior fica no histórico.
function Choice({ process, editable, onChange }: { process: ProcessDetail; editable: boolean; onChange: () => void }) {
  const viable = process.comparisonMatrix.filter((row) => row.viability === "viable");
  const current = process.chosenOptions.at(-1) ?? null;
  const chosenViability = current && process.comparisonMatrix.find((row) => row.option.id === current.option.id)?.viability;
  // O formulário parte da Escolha em vigor só enquanto ela é viável: uma Opção que uma Revisão de
  // Restrição tornou inviável não pode ser escolhida de novo.
  const startingOptionId = chosenViability === "viable" ? current!.option.id : null;
  const [choosing, setChoosing] = useState(current === null);
  const [optionId, setOptionId] = useState<string | null>(startingOptionId);
  const [reasons, setReasons] = useState<Record<string, string>>(
    Object.fromEntries(current?.discards.map((discard) => [discard.option.id, discard.reason]) ?? []),
  );
  const { saving, error, act } = useAction(onChange);
  const others = viable.filter((row) => row.option.id !== optionId);

  function startChoosing() {
    // A viabilidade pode ter mudado desde que a tela abriu (uma Revisão de Restrição).
    setOptionId(startingOptionId);
    setChoosing(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!optionId) return;
    const done = await act(
      () => chooseOption(process.id, { optionId, discards: others.map((row) => ({ optionId: row.option.id, reason: reasons[row.option.id] ?? "" })) }),
      "Não foi possível registrar a Escolha. O que você escreveu continua aqui; tente de novo.",
    );
    if (done) setChoosing(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">Escolha</p>
      {current && (
        <div className="flex flex-col gap-1">
          <p>
            <span className="font-medium">{current.option.statement}</span>
            <span className="text-muted-foreground text-xs"> · escolhida em {formatDate(current.chosenAt)}</span>
          </p>
          {chosenViability !== "viable" && (
            <p className="text-destructive text-xs">
              Esta Opção não é mais viável (uma Restrição foi revista). Registre uma nova Escolha.
            </p>
          )}
          {current.discards.length > 0 && (
            <ul className="text-muted-foreground text-xs">
              {current.discards.map((discard) => (
                <li key={discard.option.id}>
                  Descartada “{discard.option.statement}”: {discard.reason}
                </li>
              ))}
            </ul>
          )}
          {viable.some((row) => row.option.id !== current.option.id && !current.discards.some((discard) => discard.option.id === row.option.id)) && (
            <p className="text-destructive text-xs">Há uma Opção viável sem motivo de descarte. Registre a Escolha de novo.</p>
          )}
        </div>
      )}
      {editable && !choosing && (
        <div>
          <Button variant="outline" size="sm" onClick={startChoosing}>
            Trocar a Escolha
          </Button>
        </div>
      )}
      {editable && choosing && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          {viable.length === 0 && <p className="text-muted-foreground text-xs">Nenhuma Opção aceita é viável agora.</p>}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted-foreground mb-1 text-xs">Qual Opção você escolhe?</legend>
            {viable.map((row) => (
              <label key={row.option.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`choice-${process.id}`}
                  checked={optionId === row.option.id}
                  disabled={saving}
                  onChange={() => setOptionId(row.option.id)}
                />
                {row.option.statement}
              </label>
            ))}
          </fieldset>
          {process.comparisonMatrix.some((row) => row.viability !== "viable") && (
            <p className="text-muted-foreground text-xs">
              Opções inviáveis ou sem decisão de viabilidade não podem ser escolhidas.
            </p>
          )}
          {optionId &&
            others.map((row) => (
              <div key={row.option.id} className="flex flex-col gap-1">
                <Label htmlFor={`discard-${row.option.id}`} className="text-xs font-normal">
                  Por que descartar “{row.option.statement}”?
                </Label>
                <Textarea
                  id={`discard-${row.option.id}`}
                  rows={2}
                  value={reasons[row.option.id] ?? ""}
                  disabled={saving}
                  onChange={(event) => setReasons({ ...reasons, [row.option.id]: event.target.value })}
                />
              </div>
            ))}
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex justify-end gap-2">
            {current && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setChoosing(false)}>
                Cancelar
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={saving || !optionId || others.some((row) => (reasons[row.option.id] ?? "").trim() === "")}
            >
              {saving ? "Registrando…" : current ? "Registrar nova Escolha" : "Registrar Escolha"}
            </Button>
          </div>
        </form>
      )}
      {process.chosenOptions.length > 1 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Escolhas anteriores ({process.chosenOptions.length - 1})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {process.chosenOptions.slice(0, -1).map((item) => (
              <li key={item.id}>
                “{item.option.statement}”, de {formatDate(item.chosenAt)} a {formatDate(item.supersededAt!)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
