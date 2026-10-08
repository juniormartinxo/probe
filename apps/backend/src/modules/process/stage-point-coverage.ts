import type { Db } from "../../db/database.ts";
import { stagePointsOf, type StagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";

// Um Ponto deixa de estar aberto quando o usuário o confirma coberto, com a síntese de um Bloco, ou
// o declara inaplicável, com justificativa. Sugestão da IA nunca cobre nada sozinha.
export type CoverageStatus = "covered" | "inapplicable";

export interface StagePointState extends StagePoint {
  status: "open" | CoverageStatus;
  // O Bloco cuja síntese confirmou a cobertura.
  blockId: string | null;
  justification: string | null;
  recordedAt: Date | null;
}

interface ProcessPoints {
  id: string;
  stagePointsVersion: number;
}

export async function stagePointStates(db: Db, process: ProcessPoints, stage: Stage): Promise<StagePointState[]> {
  const rows = await db
    .selectFrom("stagePointCoverage")
    .select(["stagePoint", "status", "blockId", "justification", "recordedAt"])
    .where("processId", "=", process.id)
    .where("stage", "=", stage)
    .execute();
  return stagePointsOf(process.stagePointsVersion, stage).map((point) => {
    const row = rows.find((item) => item.stagePoint === point.key);
    return {
      ...point,
      status: row?.status ?? "open",
      blockId: row?.blockId ?? null,
      justification: row?.justification ?? null,
      recordedAt: row?.recordedAt ?? null,
    };
  });
}

export async function openStagePointsOf(db: Db, process: ProcessPoints, stage: Stage): Promise<StagePoint[]> {
  return (await stagePointStates(db, process, stage))
    .filter((point) => point.status === "open")
    .map(({ key, name, description }) => ({ key, name, description }));
}

export type InapplicabilityError = "process_not_found" | "process_not_open" | "stage_point_not_found" | "stage_point_closed";

export interface StagePointCoverage {
  // Declara inaplicável um Ponto aberto da Etapa atual; a justificativa é obrigatória.
  declareInapplicable(
    processId: string,
    key: string,
    justification: string,
  ): Promise<{ ok: true; stagePoint: StagePointState } | { ok: false; error: InapplicabilityError }>;
}

export function stagePointCoverage({ db }: { db: Db }): StagePointCoverage {
  return {
    async declareInapplicable(processId, key, justification) {
      return db.transaction().execute(async (trx) => {
        const process = await trx
          .selectFrom("processes")
          .select(["id", "status", "currentStage", "stagePointsVersion"])
          .where("id", "=", processId)
          .forUpdate()
          .executeTakeFirst();
        if (!process) return { ok: false, error: "process_not_found" } as const;
        if (process.status !== "open") return { ok: false, error: "process_not_open" } as const;
        const point = (await stagePointStates(trx, process, process.currentStage)).find((item) => item.key === key);
        if (!point) return { ok: false, error: "stage_point_not_found" } as const;
        if (point.status !== "open") return { ok: false, error: "stage_point_closed" } as const;
        const row = await trx
          .insertInto("stagePointCoverage")
          .values({
            processId,
            stage: process.currentStage,
            stagePoint: key,
            status: "inapplicable",
            blockId: null,
            justification: justification.trim(),
          })
          .returning(["status", "blockId", "justification", "recordedAt"])
          .executeTakeFirstOrThrow();
        return { ok: true, stagePoint: { ...point, ...row } } as const;
      });
    },
  };
}
