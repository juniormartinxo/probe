import type { Db } from "../../db/database.ts";
import { conflictAssessmentsOf, type ConflictAssessment } from "../assessments/conflict-assessments.ts";
import { impactAssessmentsOf, type DependentConfirmation, type ImpactAssessment } from "../assessments/impact-assessments.ts";
import { conflictPairsOf, resolutionQuestionOf, type ConflictingAnswerRef, type ResolutionQuestion } from "./conflict-pairs.ts";
import type { ItemKind } from "./constraints-and-preferences.ts";
import type { ProcessPoints } from "./stage-point-coverage.ts";
import { namedStagePoint } from "./stage-points.ts";
import { stages, type Stage } from "./stage.ts";

// Motivos de Pendência: informação desconhecida, reavaliação e conflito.
export type PendencyReason = "unknown_information" | "reassessment" | "conflict";

// Como a Pendência se resolveu: a de informação desconhecida, respondida; a de reavaliação,
// reconfirmada (a Confirmação vale com a Versão nova) ou corrigida (uma Versão nova da resposta); a
// de conflito, corrigida (uma Versão nova de uma das respostas), com uma revisão de Restrição ou com
// um esclarecimento do usuário.
export type PendencyResolution = "answered" | "reconfirmed" | "corrected" | "clarified" | "constraint_revised";

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

// Pendência de conflito: duas respostas confirmadas são incompatíveis entre si, segundo o Jev
// (`openedBy: "jev"`) ou segundo o usuário, quando o Jev não teve certeza ou não respondeu.
export interface ConflictDetail {
  checkId: string;
  pairId: string;
  // A resposta que acabou de ser confirmada e a outra.
  answers: [ConflictingAnswerRef, ConflictingAnswerRef];
  openedBy: "jev" | "user";
  // A Avaliação de conflito que a originou (no caso do usuário, a que ele viu, concluída ou falha).
  conflictAssessment: ConflictAssessment;
  // A pergunta com que a IA orienta a resolução; null enquanto não foi pedida.
  resolutionQuestion: ResolutionQuestion | null;
  // O esclarecimento do usuário, ou a nota da revisão de Restrição.
  note: string | null;
  // Na revisão de Restrição: a retirada e a que a substituiu, se houver.
  constraintRevision: { revisedConstraintId: string; replacement: { kind: ItemKind; id: string } | null } | null;
}

// Impedimento visível numa Pergunta, que bloqueia as Confirmações que dependem dele. A de informação
// desconhecida fica até uma resposta à Pergunta resolvê-la; a de reavaliação, até o usuário
// reconfirmar a Confirmação afetada ou corrigir a resposta; a de conflito, que fica na Pergunta da
// resposta confirmada por último, até o usuário corrigir uma das respostas, rever uma Restrição ou esclarecer.
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
  // Só nas de conflito.
  conflict: ConflictDetail | null;
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

// Uma Versão nova de uma das respostas de um par em conflito resolve a Pendência dele: o par deixa de
// existir, e a Versão nova passa pela própria Avaliação de conflito quando for confirmada. Chamar na
// transação que grava a Versão.
export async function resolveConflictsByCorrection(trx: Db, questionId: string, answerVersionId: string): Promise<void> {
  await trx
    .updateTable("pendencies")
    .set((eb) => ({
      resolvedAt: eb.selectFrom("answerVersions").select("createdAt").where("id", "=", answerVersionId),
      resolvedByAnswerVersionId: answerVersionId,
      resolution: "corrected" as const,
    }))
    .where("reason", "=", "conflict")
    .where("resolvedAt", "is", null)
    .where("conflictPairId", "in", (eb) =>
      eb
        .selectFrom("conflictPairs")
        .innerJoin("answerVersions", (join) =>
          join.on((on) =>
            on.or([
              on("answerVersions.id", "=", on.ref("conflictPairs.answerVersionId")),
              on("answerVersions.id", "=", on.ref("conflictPairs.otherAnswerVersionId")),
            ]),
          ),
        )
        .select("conflictPairs.id")
        .where("answerVersions.questionId", "=", questionId),
    )
    .execute();
}

// As Etapas até a dada, inclusive: as que a Confirmação dela tem por base.
export const stagesUpTo = (stage: Stage): Stage[] => stages.slice(0, stages.indexOf(stage) + 1);

// As Pendências que bloqueiam a Confirmação da Etapa: as de informação desconhecida nas Perguntas
// dela, de que a Confirmação depende; as de reavaliação nas Perguntas dela ou das anteriores, cujas
// Confirmações estão em revisão e são a base desta; e as de conflito com uma das respostas na Etapa
// ou nas anteriores, que a Confirmação daria por compatíveis.
export async function pendenciesBlockingStage(db: Db, processId: string, stage: Stage): Promise<string[]> {
  const upTo = stagesUpTo(stage);
  const rows = await db
    .selectFrom("pendencies")
    .innerJoin("questions", "questions.id", "pendencies.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .leftJoin("conflictPairs", "conflictPairs.id", "pendencies.conflictPairId")
    .leftJoin("answerVersions as other", "other.id", "conflictPairs.otherAnswerVersionId")
    .leftJoin("questions as otherQuestion", "otherQuestion.id", "other.questionId")
    .leftJoin("blocks as otherBlock", "otherBlock.id", "otherQuestion.blockId")
    .select("pendencies.id")
    .where("pendencies.processId", "=", processId)
    .where("pendencies.resolvedAt", "is", null)
    .where((eb) =>
      eb.or([
        eb.and([eb("pendencies.reason", "=", "unknown_information"), eb("blocks.stage", "=", stage)]),
        eb.and([eb("pendencies.reason", "=", "reassessment"), eb("blocks.stage", "in", upTo)]),
        eb.and([eb("pendencies.reason", "=", "conflict"), eb.or([eb("blocks.stage", "in", upTo), eb("otherBlock.stage", "in", upTo)])]),
      ]),
    )
    .orderBy("pendencies.openedAt")
    .orderBy("pendencies.id")
    .execute();
  return rows.map((row) => row.id);
}

export async function listPendencies(db: Db, process: ProcessPoints, ids?: string[]): Promise<Pendency[]> {
  if (ids?.length === 0) return [];
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
      "pendencies.conflictPairId",
      "pendencies.conflictAssessmentId",
      "pendencies.resolutionNote",
      "pendencies.revisedConstraintId",
      "pendencies.replacementConstraintId",
      "pendencies.replacementPreferenceId",
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
  const conflicts = rows.filter((row) => row.conflictPairId !== null);
  const conflictAssessments = conflicts.length > 0 ? await conflictAssessmentsOf(db, process.id) : [];
  const pairs = await conflictPairsOf(
    db,
    process.id,
    conflicts.map((row) => row.conflictPairId!),
  );
  const questions = new Map(
    await Promise.all(conflicts.map(async (row) => [row.id, await resolutionQuestionOf(db, process.id, row.id)] as const)),
  );
  const conflictOf = (row: (typeof rows)[number]): ConflictDetail | null => {
    if (row.conflictPairId === null) return null;
    const pair = pairs.find((item) => item.id === row.conflictPairId)!;
    const replacement =
      row.replacementConstraintId !== null
        ? { kind: "constraint" as const, id: row.replacementConstraintId }
        : row.replacementPreferenceId !== null
          ? { kind: "preference" as const, id: row.replacementPreferenceId }
          : null;
    return {
      checkId: pair.checkId,
      pairId: pair.id,
      answers: [pair.answer, pair.other],
      openedBy: row.openedBy!,
      conflictAssessment: conflictAssessments.find((assessment) => assessment.id === row.conflictAssessmentId)!,
      resolutionQuestion: questions.get(row.id) ?? null,
      note: row.resolutionNote,
      constraintRevision: row.revisedConstraintId !== null ? { revisedConstraintId: row.revisedConstraintId, replacement } : null,
    };
  };
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
      conflict: conflictOf(row),
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
