import { useState } from "react";
import { getUnderstanding, type Understanding } from "@/api";
import { itemDetails } from "@/components/constraints-and-preferences";
import { stageName, stagePointStatusText } from "@/stages";

// Resumo do entendimento atual do Processo, consultável a qualquer momento. É lido ao abrir o painel,
// a partir do que está gravado; não chama a IA.
export function UnderstandingPanel({ processId }: { processId: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" | "error" } | { kind: "loaded"; understanding: Understanding }>({
    kind: "idle",
  });

  function load() {
    setState({ kind: "loading" });
    getUnderstanding(processId).then(
      (understanding) => setState({ kind: "loaded", understanding }),
      () => setState({ kind: "error" }),
    );
  }

  return (
    <details
      className="rounded-lg border p-4 text-sm"
      onToggle={(event) => {
        if (event.currentTarget.open) load();
      }}
    >
      <summary className="cursor-pointer font-medium">Resumo do entendimento atual</summary>
      <div className="mt-3 flex flex-col gap-3">
        {state.kind === "loading" && <p className="text-muted-foreground text-xs">Carregando…</p>}
        {state.kind === "error" && <p className="text-destructive text-xs">Não foi possível carregar o resumo.</p>}
        {state.kind === "loaded" && <UnderstandingView understanding={state.understanding} />}
      </div>
    </details>
  );
}

function UnderstandingView({ understanding }: { understanding: Understanding }) {
  return (
    <>
      <div>
        <p className="text-muted-foreground text-xs">Enunciado do problema</p>
        <p className="whitespace-pre-wrap">{understanding.problemStatement ?? "Ainda não confirmado."}</p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs">
          Etapa {understanding.currentStage} · {stageName(understanding.currentStage)}
        </p>
        <ul className="flex flex-col gap-0.5">
          {understanding.stagePoints.map((point) => (
            <li key={point.key}>
              {point.name}: {stagePointStatusText[point.status]}
              {point.justification && <span className="text-muted-foreground"> ({point.justification})</span>}
              {point.status === "absent" && <span className="text-muted-foreground"> ({point.absence})</span>}
            </li>
          ))}
        </ul>
      </div>
      {understanding.constraints.length + understanding.preferences.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { title: "Restrições (inegociáveis)", items: understanding.constraints },
            { title: "Preferências (negociáveis)", items: understanding.preferences },
          ].map(({ title, items }) => (
            <div key={title}>
              <p className="text-muted-foreground text-xs">{title}</p>
              <ul className="flex flex-col gap-0.5">
                {items.length === 0 && <li className="text-muted-foreground">Nenhuma.</li>}
                {items.map((item, index) => (
                  <li key={index}>
                    {item.statement}
                    {itemDetails(item) && <span className="text-muted-foreground"> ({itemDetails(item)})</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {understanding.blocks.map((block) => (
        <div key={block.number} className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">Bloco {block.number}</p>
          <p className="whitespace-pre-wrap">
            {block.synthesis ?? <span className="text-muted-foreground">Síntese ainda não confirmada.</span>}
          </p>
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {block.answers.map((answer) => (
              <li key={answer.questionId}>
                {answer.wording} —{" "}
                {answer.unknown
                  ? "não sei (Pendência)"
                  : answer.answer === null
                    ? "sem resposta"
                    : `${answer.answer}${answer.confirmed ? "" : " (provisória)"}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {understanding.openPendencies.length > 0 && (
        <div>
          <p className="text-muted-foreground text-xs">Pendências abertas</p>
          <ul className="flex flex-col gap-0.5">
            {understanding.openPendencies.map((pendency) => (
              <li key={`${pendency.reason}-${pendency.wording}`}>
                {pendency.reason === "reassessment" ? "Reavaliação" : "Informação desconhecida"}: {pendency.wording}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
