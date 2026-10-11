import type { Db } from "../../db/database.ts";
import { listAiRequests } from "../ai/ai-requests.ts";
import { comparisonCellsOf, comparisonDimensions, type ComparisonCells } from "../ai/assistant.ts";
import { optionsOf, type OptionViability, type OptionViolation } from "./options.ts";
import { lockOpenProcessFrom } from "./process.ts";
import type { RecommendationResult } from "./recommendations.ts";

// Linha da matriz qualitativa que o usuário gravou para uma Opção: texto em cada dimensão, sem
// pontuação nem peso. Escrita do zero ou a partir da linha que uma Recomendação sugeriu.
export interface OptionComparison extends ComparisonCells {
  id: string;
  // A Recomendação de que a linha partiu, como veio ou editada.
  recommendationId: string | null;
  recordedAt: Date;
}

// Matriz qualitativa: uma linha por Opção aceita. O atendimento às Restrições vem dos pares Opção ×
// Restrição (a viabilidade e as violações), nunca da IA nem do usuário; uma Opção inviável aparece
// como tal. As outras células são a linha que vale; as reescritas ficam no histórico.
export interface ComparisonMatrixRow {
  option: { id: string; statement: string; description: string | null };
  viability: OptionViability;
  violations: OptionViolation[];
  comparison: OptionComparison | null;
  // As linhas anteriores à que vale, da mais antiga à mais recente.
  history: OptionComparison[];
}

const comparisonColumns = ["id", "optionId", ...comparisonDimensions, "recommendationId", "recordedAt"] as const;

const comparisonOf = ({ optionId: _, ...row }: OptionComparison & { optionId: string }): OptionComparison => row;

export async function comparisonMatrixOf(db: Db, process: { id: string; stagePointsVersion: number }): Promise<ComparisonMatrixRow[]> {
  const accepted = (await optionsOf(db, process)).filter((option) => option.status === "accepted");
  if (accepted.length === 0) return [];
  const rows = await db
    .selectFrom("optionComparisons")
    .select(comparisonColumns)
    .where(
      "optionId",
      "in",
      accepted.map((option) => option.id),
    )
    .orderBy("recordedAt")
    .orderBy("id")
    .execute();
  return accepted.map(({ id, statement, description, viability, violations }) => {
    const own = rows.filter((row) => row.optionId === id).map(comparisonOf);
    return { option: { id, statement, description }, viability: viability!, violations, comparison: own.at(-1) ?? null, history: own.slice(0, -1) };
  });
}

// O que o usuário grava numa linha: as células e, se partiu de uma, a Recomendação que a sugeriu.
export interface ComparisonRecord {
  cells: ComparisonCells;
  recommendationId: string | null;
}

export type ComparisonError =
  | "process_not_found"
  | "process_not_open"
  | "stage_not_current"
  | "option_not_found"
  | "option_not_accepted"
  | "option_inviable"
  | "unknown_recommendation";

export interface ComparisonMatrix {
  // Grava a linha de uma Opção aceita e não inviável, da Etapa B em diante, enquanto o Processo está aberto.
  record(
    processId: string,
    optionId: string,
    record: ComparisonRecord,
  ): Promise<{ ok: true; comparison: OptionComparison } | { ok: false; error: ComparisonError }>;
}

export function comparisonMatrix({ db }: { db: Db }): ComparisonMatrix {
  return {
    async record(processId, optionId, { cells, recommendationId }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcessFrom(trx, processId, "B");
        if (!locked.ok) return locked;
        const option = (await optionsOf(trx, locked.process)).find((item) => item.id === optionId);
        if (!option) return { ok: false, error: "option_not_found" } as const;
        if (option.status !== "accepted") return { ok: false, error: "option_not_accepted" } as const;
        // Uma Opção inviável não se compara: nenhuma vantagem compensa a Restrição que ela viola.
        if (option.viability === "inviable") return { ok: false, error: "option_inviable" } as const;
        if (recommendationId !== null) {
          // A linha parte de uma Recomendação do Processo que sugeriu uma linha para esta Opção.
          const made = (await listAiRequests<RecommendationResult>(trx, processId, "recommend_option")).find((item) => item.id === recommendationId);
          if (!made?.result?.value.comparisons.some((row) => row.optionId === optionId)) return { ok: false, error: "unknown_recommendation" } as const;
        }
        const trimmed = comparisonCellsOf((dimension) => cells[dimension].trim());
        const row = await trx
          .insertInto("optionComparisons")
          .values({ optionId, ...trimmed, recommendationId })
          .returning(comparisonColumns)
          .executeTakeFirstOrThrow();
        return { ok: true, comparison: comparisonOf(row) } as const;
      });
    },
  };
}
