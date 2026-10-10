import type { Db } from "../../db/database.ts";
import { impactAssessmentsOf, type DependentConfirmation, type ImpactAssessment } from "../assessments/impact-assessments.ts";
import type { ProcessPoints } from "./stage-point-coverage.ts";
import { namedStagePoint } from "./stage-points.ts";
import { stages, type Stage } from "./stage.ts";

// Motivos de Pendência: informação desconhecida e reavaliação. O de conflito chega com a Avaliação
// de conflito entre respostas.
export type PendencyReason = "unknown_information" | "reassessment";

// Como a Pendência se resolveu: a de informação desconhecida, respondida; a de reavaliação,
// reconfirmada (a Confirmação vale com a Versão nova) ou corrigida (uma Versão nova da resposta).
export type PendencyResolution = "answered" | "reconfirmed" | "corrected";

// Pendência de reavaliação: a Versão nova de uma resposta afeta a Confirmação que dependia da Versão
// anterior, segundo o Jev (`openedBy: "jev"`) ou segundo o usuário, quando o Jev não teve certeza ou
// não respondeu.
export interface ReassessmentDetail {
  answerVersionId: string;
  previousAnswerVersionId: string;
  confirmation: DependentConfirmation;
  openedBy: "jev" | "user";
  // A Avaliação de impacto que a originou (no caso do usuário, a que ele viu, concluída ou falha).
  impactAssessment: ImpactAssessment;
}

// Impedimento visível numa Pergunta, que bloqueia as Confirmações que dependem dele. A de informação
// desconhecida fica até uma resposta à Pergunta resolvê-la; a de reavaliação, até o usuário
// reconfirmar a Confirmação afetada ou corrigir a resposta.
export interface Pendency {
  id: string;
  reason: PendencyReason;
  question: { id: string; wording: string; stage: Stage; blockNumber: number; number: number };
  stagePoints: { key: string; name: string }[];
  openedAt: Date;
  resolvedAt: Date | null;
  resolvedByAnswerVersionId: string | null;
  resolution: PendencyResolution | null;
  // Só nas de reavaliação.
  reassessment: ReassessmentDetail | null;
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
      resolution: "answered" as const,
    }))
    .where("questionId", "=", questionId)
    .where("reason", "=", "unknown_information")
    .where("resolvedAt", "is", null)
    .execute();
}

// Uma Versão nova corrige a resposta: resolve as Pendências de reavaliação abertas na Pergunta, que
// diziam respeito à Versão anterior; a nova passa pela própria Avaliação de impacto. Chamar na
// transação que grava a Versão.
export async function resolveReassessmentsByCorrection(trx: Db, questionId: string, answerVersionId: string): Promise<void> {
  await trx
    .updateTable("pendencies")
    .set((eb) => ({
      resolvedAt: eb.selectFrom("answerVersions").select("createdAt").where("id", "=", answerVersionId),
      resolvedByAnswerVersionId: answerVersionId,
      resolution: "corrected" as const,
    }))
    .where("questionId", "=", questionId)
    .where("reason", "=", "reassessment")
    .where("resolvedAt", "is", null)
    .execute();
}

// As Etapas até a dada, inclusive: as que a Confirmação dela tem por base.
export const stagesUpTo = (stage: Stage): Stage[] => stages.slice(0, stages.indexOf(stage) + 1);

// As Pendências que bloqueiam a Confirmação da Etapa: as de informação desconhecida nas Perguntas
// dela, de que a Confirmação depende, e as de reavaliação nas Perguntas dela ou das anteriores, cujas
// Confirmações estão em revisão e são a base desta.
export async function pendenciesBlockingStage(db: Db, processId: string, stage: Stage): Promise<string[]> {
  const rows = await db
    .selectFrom("pendencies")
    .innerJoin("questions", "questions.id", "pendencies.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select("pendencies.id")
    .where("pendencies.processId", "=", processId)
    .where("pendencies.resolvedAt", "is", null)
    .where((eb) =>
      eb.or([
        eb.and([eb("pendencies.reason", "=", "unknown_information"), eb("blocks.stage", "=", stage)]),
        eb.and([eb("pendencies.reason", "=", "reassessment"), eb("blocks.stage", "in", stagesUpTo(stage))]),
      ]),
    )
    .orderBy("pendencies.openedAt")
    .orderBy("pendencies.id")
    .execute();
  return rows.map((row) => row.id);
}

export async function listPendencies(db: Db, process: ProcessPoints, ids?: string[]): Promise<Pendency[]> {
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
      "pendencies.resolution",
      "pendencies.answerVersionId",
      "pendencies.impactAssessmentId",
      "pendencies.openedBy",
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
  const assessments = rows.some((row) => row.impactAssessmentId !== null) ? await impactAssessmentsOf(db, process.id) : [];
  return rows.map((row) => {
    const impactAssessment = assessments.find((assessment) => assessment.id === row.impactAssessmentId);
    return {
      id: row.id,
      reason: row.reason,
      question: { id: row.questionId, wording: row.wording, stage: row.stage, blockNumber: row.blockNumber, number: row.position + 1 },
      stagePoints: row.stagePoints.map((key) => namedStagePoint(process.stagePointsVersion, row.stage, key)),
      openedAt: row.openedAt,
      resolvedAt: row.resolvedAt,
      resolvedByAnswerVersionId: row.resolvedByAnswerVersionId,
      resolution: row.resolution,
      reassessment: impactAssessment
        ? {
            answerVersionId: row.answerVersionId!,
            previousAnswerVersionId: impactAssessment.previousAnswerVersionId,
            confirmation: impactAssessment.confirmation,
            openedBy: row.openedBy!,
            impactAssessment,
          }
        : null,
    };
  });
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
          .where("reason", "=", "unknown_information")
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
