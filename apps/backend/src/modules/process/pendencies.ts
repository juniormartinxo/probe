import type { Db } from "../../db/database.ts";
import type { ProcessPoints } from "./stage-point-coverage.ts";
import { namedStagePoint } from "./stage-points.ts";

// Motivos de Pendência. Nesta fatia, só a de informação desconhecida; reavaliação e conflito
// chegam com as Avaliações do Jev.
export type PendencyReason = "unknown_information";

// Pendência de informação desconhecida: o usuário registrou que não sabe o que uma Pergunta pede.
// Fica visível até uma resposta à Pergunta resolvê-la.
export interface Pendency {
  id: string;
  reason: PendencyReason;
  question: { id: string; wording: string; blockNumber: number; number: number };
  stagePoints: { key: string; name: string }[];
  openedAt: Date;
  resolvedAt: Date | null;
  resolvedByAnswerVersionId: string | null;
}

export type UnknownInformationError =
  | "process_not_found"
  | "process_not_open"
  | "question_not_found"
  | "question_answered"
  | "already_unknown";

export interface Pendencies {
  // Registra que o usuário não sabe a informação que a Pergunta pede. Só numa Pergunta sem resposta:
  // a que já tem resposta é alterada com uma nova Versão.
  markUnknown(
    processId: string,
    questionId: string,
  ): Promise<{ ok: true; pendency: Pendency } | { ok: false; error: UnknownInformationError }>;
  list(process: ProcessPoints): Promise<Pendency[]>;
}

// Uma resposta à Pergunta resolve a Pendência de informação desconhecida que estiver aberta nela.
// Chamar na transação que grava a Versão.
export async function resolveUnknownInformation(trx: Db, questionId: string, answerVersionId: string): Promise<void> {
  await trx
    .updateTable("pendencies")
    // Resolvida no instante em que a Versão foi registrada.
    .set((eb) => ({
      resolvedAt: eb.selectFrom("answerVersions").select("createdAt").where("id", "=", answerVersionId),
      resolvedByAnswerVersionId: answerVersionId,
    }))
    .where("questionId", "=", questionId)
    .where("reason", "=", "unknown_information")
    .where("resolvedAt", "is", null)
    .execute();
}

async function listPendencies(db: Db, process: ProcessPoints, ids?: string[]): Promise<Pendency[]> {
  let query = db
    .selectFrom("pendencies")
    .innerJoin("questions", "questions.id", "pendencies.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select([
      "pendencies.id",
      "pendencies.reason",
      "pendencies.openedAt",
      "pendencies.resolvedAt",
      "pendencies.resolvedByAnswerVersionId",
      "questions.id as questionId",
      "questions.wording",
      "questions.position",
      "questions.stagePoints",
      "blocks.number as blockNumber",
      "blocks.stage",
    ])
    .where("pendencies.processId", "=", process.id)
    .orderBy("pendencies.openedAt")
    .orderBy("pendencies.id");
  if (ids) query = query.where("pendencies.id", "in", ids);
  const rows = await query.execute();
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    question: { id: row.questionId, wording: row.wording, blockNumber: row.blockNumber, number: row.position + 1 },
    stagePoints: row.stagePoints.map((key) => namedStagePoint(process.stagePointsVersion, row.stage, key)),
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
    resolvedByAnswerVersionId: row.resolvedByAnswerVersionId,
  }));
}

export function pendencies({ db }: { db: Db }): Pendencies {
  return {
    async markUnknown(processId, questionId) {
      return db.transaction().execute(async (trx) => {
        const process = await trx
          .selectFrom("processes")
          .select(["id", "status", "stagePointsVersion"])
          .where("id", "=", processId)
          .forUpdate()
          .executeTakeFirst();
        if (!process) return { ok: false, error: "process_not_found" } as const;
        if (process.status !== "open") return { ok: false, error: "process_not_open" } as const;
        const question = await trx
          .selectFrom("questions")
          .innerJoin("blocks", "blocks.id", "questions.blockId")
          .select("questions.id")
          .where("questions.id", "=", questionId)
          .where("blocks.processId", "=", processId)
          .executeTakeFirst();
        if (!question) return { ok: false, error: "question_not_found" } as const;
        const answered = await trx.selectFrom("answerVersions").select("id").where("questionId", "=", questionId).executeTakeFirst();
        if (answered) return { ok: false, error: "question_answered" } as const;
        const open = await trx
          .selectFrom("pendencies")
          .select("id")
          .where("questionId", "=", questionId)
          .where("resolvedAt", "is", null)
          .executeTakeFirst();
        if (open) return { ok: false, error: "already_unknown" } as const;
        const { id } = await trx
          .insertInto("pendencies")
          .values({ processId, reason: "unknown_information", questionId })
          .returning("id")
          .executeTakeFirstOrThrow();
        const [pendency] = await listPendencies(trx, process, [id]);
        return { ok: true, pendency: pendency! } as const;
      });
    },

    list(process) {
      return listPendencies(db, process);
    },
  };
}
