import type { Db } from "../../db/database.ts";
import { stagePointsOf, type StagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";

// Um Ponto deixa de estar aberto quando o usuário o confirma coberto, com a síntese de um Bloco; o
// declara inaplicável, com justificativa; ou registra explicitamente a ausência do que ele pede (não
// há prazo, nenhum sistema envolvido), o que também conta como cobertura. Sugestão da IA nunca cobre
// nada sozinha.
export type CoverageStatus = "covered" | "inapplicable" | "absent";

export interface StagePointState extends Omit<StagePoint, "absence"> {
  // Como se diz a ausência, nos Pontos que a admitem; null nos outros.
  absence: string | null;
  status: "open" | CoverageStatus;
  // O Bloco cuja síntese confirmou a cobertura.
  blockId: string | null;
  justification: string | null;
  recordedAt: Date | null;
}

// O Processo pelo que basta para ler os seus Pontos: o id e a versão da lista que ele segue.
export interface ProcessPoints {
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
      absence: point.absence ?? null,
      status: row?.status ?? "open",
      blockId: row?.blockId ?? null,
      justification: row?.justification ?? null,
      recordedAt: row?.recordedAt ?? null,
    };
  });
}

export const openPoints = (states: StagePointState[]): StagePoint[] =>
  states.filter((point) => point.status === "open").map(({ key, name, description }) => ({ key, name, description }));

export async function openStagePointsOf(db: Db, process: ProcessPoints, stage: Stage): Promise<StagePoint[]> {
  return openPoints(await stagePointStates(db, process, stage));
}

export type InapplicabilityError = "process_not_found" | "process_not_open" | "stage_point_not_found" | "stage_point_closed";

export type AbsenceError = InapplicabilityError | "absence_not_allowed";

export interface StagePointCoverage {
  // Declara inaplicável um Ponto aberto da Etapa atual; a justificativa é obrigatória.
  declareInapplicable(
    processId: string,
    key: string,
    justification: string,
  ): Promise<{ ok: true; stagePoint: StagePointState } | { ok: false; error: InapplicabilityError }>;
  // Registra que não há o que o Ponto aberto da Etapa atual pede, nos Pontos que admitem ausência.
  recordAbsence(processId: string, key: string): Promise<{ ok: true; stagePoint: StagePointState } | { ok: false; error: AbsenceError }>;
}

// Trava o Processo para a transação e encontra o Ponto aberto da Etapa atual.
async function lockOpenPoint(
  trx: Db,
  processId: string,
  key: string,
): Promise<{ ok: true; stage: Stage; point: StagePointState } | { ok: false; error: InapplicabilityError }> {
  const process = await trx
    .selectFrom("processes")
    .select(["id", "status", "currentStage", "stagePointsVersion"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  const point = (await stagePointStates(trx, process, process.currentStage)).find((item) => item.key === key);
  if (!point) return { ok: false, error: "stage_point_not_found" };
  if (point.status !== "open") return { ok: false, error: "stage_point_closed" };
  return { ok: true, stage: process.currentStage, point };
}

const coverageColumns = ["status", "blockId", "justification", "recordedAt"] as const;

export function stagePointCoverage({ db }: { db: Db }): StagePointCoverage {
  return {
    async declareInapplicable(processId, key, justification) {
      return db.transaction().execute(async (trx) => {
        const found = await lockOpenPoint(trx, processId, key);
        if (!found.ok) return found;
        const row = await trx
          .insertInto("stagePointCoverage")
          .values({
            processId,
            stage: found.stage,
            stagePoint: key,
            status: "inapplicable",
            blockId: null,
            justification: justification.trim(),
          })
          .returning(coverageColumns)
          .executeTakeFirstOrThrow();
        return { ok: true, stagePoint: { ...found.point, ...row } } as const;
      });
    },

    async recordAbsence(processId, key) {
      return db.transaction().execute(async (trx) => {
        const found = await lockOpenPoint(trx, processId, key);
        if (!found.ok) return found;
        if (found.point.absence === null) return { ok: false, error: "absence_not_allowed" } as const;
        const row = await trx
          .insertInto("stagePointCoverage")
          .values({ processId, stage: found.stage, stagePoint: key, status: "absent", blockId: null, justification: null })
          .returning(coverageColumns)
          .executeTakeFirstOrThrow();
        return { ok: true, stagePoint: { ...found.point, ...row } } as const;
      });
    },
  };
}
