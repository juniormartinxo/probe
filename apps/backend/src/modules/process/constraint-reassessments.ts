import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../db/database.ts";
import type { Assessor, ConstraintImpactInput } from "../assessments/assessor.ts";
import {
  decidesAlone,
  impactAssessmentsOf,
  impactOutcomeColumns,
  judgedImpact,
  type ImpactAssessment,
} from "../assessments/impact-assessments.ts";
import { CONSTRAINT_IMPACT_RUBRIC_REVISION } from "../assessments/impact-rubric.ts";
import { constraintRevisionsOf, statementOf, type ConstraintRevision } from "./constraints-and-preferences.ts";
import { listPendencies, stagesUpTo, type Pendency } from "./pendencies.ts";
import { confirmedStatementOf } from "./problem-statement.ts";
import { lockOpenProcess } from "./process.ts";
import {
  impactedConfirmationOf,
  reassessmentStatus,
  type ImpactDecisionError,
  type ImpactRetryError,
  type ReassessmentError,
  type ReassessmentStatus,
} from "./reassessments.ts";
import { stages, type Stage } from "./stage.ts";

// Reavaliação de uma Revisão de Restrição: uma Confirmação de Etapa sustentava a Restrição revista. Fica
// aberta até a Confirmação passar a sustentar a revisão; enquanto isso, bloqueia a Confirmação da Etapa
// atual, que se apoia nela.
export interface ConstraintReassessment {
  confirmation: { kind: "stage"; stage: Stage };
  revision: ConstraintRevision;
  status: ReassessmentStatus;
  // As Avaliações de impacto da revisão sobre a Confirmação, na ordem; a última é a que vale.
  impactAssessments: ImpactAssessment[];
  pendencyId: string | null;
}

// O que o usuário decide quando o Jev não teve certeza ou não respondeu, sobre a Avaliação que ele viu.
export interface ConstraintImpactDecision {
  constraintRevisionId: string;
  stage: Stage;
  impactAssessmentId: string;
  decision: "open_pendency" | "keep_confirmation";
}

export interface ConstraintReassessments {
  // Depois de uma Revisão de Restrição, avalia o impacto dela sobre cada Confirmação de Etapa que
  // sustentava a Restrição revista. Não lança: uma falha fica no log e a reavaliação, "não avaliada".
  assessRevision(processId: string, revision: ConstraintRevision): Promise<void>;
  // Nova tentativa, quando a Avaliação de impacto falhou (ou se perdeu).
  retry(
    processId: string,
    constraintRevisionId: string,
    stage: Stage,
  ): Promise<{ ok: true; impactAssessment: ImpactAssessment } | { ok: false; error: ImpactRetryError }>;
  decide(
    processId: string,
    decision: ConstraintImpactDecision,
  ): Promise<{ ok: true; pendency: Pendency | null } | { ok: false; error: ImpactDecisionError }>;
}

// As Restrições que cada Confirmação de Etapa sustenta: as em vigor quando ela foi feita, com as
// Revisões que ela passou a sustentar depois (a retirada sai; a Restrição substituta, se houver, entra).
async function heldConstraintsOf(db: Db, processId: string, revisions: ConstraintRevision[]): Promise<Map<Stage, Set<string>>> {
  const inForceThen = await db
    .selectFrom("stageConfirmations")
    .innerJoin("constraints", (join) =>
      join
        .onRef("constraints.processId", "=", "stageConfirmations.processId")
        .onRef("constraints.registeredAt", "<=", "stageConfirmations.confirmedAt")
        .on((eb) => eb.or([eb("constraints.withdrawnAt", "is", null), eb("constraints.withdrawnAt", ">", eb.ref("stageConfirmations.confirmedAt"))])),
    )
    .select(["stageConfirmations.stage", "constraints.id"])
    .where("stageConfirmations.processId", "=", processId)
    .execute();
  const carried = await db
    .selectFrom("confirmationConstraintRevisions")
    .select(["stage", "constraintRevisionId"])
    .where("processId", "=", processId)
    .orderBy("recordedAt")
    .orderBy("id")
    .execute();
  const held = new Map<Stage, Set<string>>();
  const of = (stage: Stage) => held.get(stage) ?? held.set(stage, new Set()).get(stage)!;
  for (const { stage, id } of inForceThen) of(stage).add(id);
  for (const { stage, constraintRevisionId } of carried) {
    const { constraint, replacement } = revisions.find((revision) => revision.id === constraintRevisionId)!;
    of(stage).delete(constraint.id);
    if (replacement?.kind === "constraint") of(stage).add(replacement.item.id);
  }
  return held;
}

// As reavaliações abertas: as Confirmações de Etapa que sustentam uma Restrição já revista, na ordem
// das Etapas e das revisões.
export async function constraintReassessmentsOf(db: Db, processId: string): Promise<ConstraintReassessment[]> {
  const revisions = await constraintRevisionsOf(db, processId);
  if (revisions.length === 0) return [];
  const held = await heldConstraintsOf(db, processId, revisions);
  const open = [...held].flatMap(([stage, ids]) =>
    revisions.filter((revision) => ids.has(revision.constraint.id)).map((revision) => ({ stage, revision })),
  );
  if (open.length === 0) return [];
  const assessments = await impactAssessmentsOf(db, processId);
  const pendencies = await db
    .selectFrom("pendencies")
    .select(["id", "constraintRevisionId", "stage"])
    .where("processId", "=", processId)
    .where("reason", "=", "reassessment")
    .where("constraintRevisionId", "is not", null)
    .where("resolvedAt", "is", null)
    .execute();
  return open
    .map(({ stage, revision }) => {
      const own = assessments.filter(
        (item) => item.constraintRevisionId === revision.id && item.confirmation.kind === "stage" && item.confirmation.stage === stage,
      );
      const pendency = pendencies.find((item) => item.constraintRevisionId === revision.id && item.stage === stage);
      return {
        confirmation: { kind: "stage" as const, stage },
        revision,
        status: reassessmentStatus(pendency, own.at(-1)),
        impactAssessments: own,
        pendencyId: pendency?.id ?? null,
      };
    })
    .toSorted(
      (a, b) =>
        stages.indexOf(a.confirmation.stage) - stages.indexOf(b.confirmation.stage) ||
        a.revision.revisedAt.getTime() - b.revision.revisedAt.getTime(),
    );
}

// As reavaliações ainda sem decisão (sem Pendência aberta) de Confirmações da Etapa ou das anteriores:
// enquanto o impacto não está decidido, a Confirmação da Etapa espera.
export async function undecidedConstraintReassessmentsBlocking(db: Db, processId: string, stage: Stage): Promise<ConstraintReassessment[]> {
  const upTo = stagesUpTo(stage);
  return (await constraintReassessmentsOf(db, processId)).filter(
    (item) => item.status !== "pendency_open" && upTo.includes(item.confirmation.stage),
  );
}

async function findConstraintReassessment(db: Db, processId: string, constraintRevisionId: string, stage: Stage) {
  return (await constraintReassessmentsOf(db, processId)).find(
    (item) => item.revision.id === constraintRevisionId && item.confirmation.stage === stage,
  );
}

export function constraintReassessments({
  db,
  assessor,
  log,
}: {
  db: Db;
  assessor: Assessor;
  log: FastifyBaseLogger;
}): ConstraintReassessments {
  // O que o Jev recebe: a Confirmação da Etapa como está e a revisão.
  async function inputOf(processId: string, { confirmation, revision }: ConstraintReassessment) {
    const process = await db.selectFrom("processes").select(["id", "stagePointsVersion"]).where("id", "=", processId).executeTakeFirstOrThrow();
    const impacted = await impactedConfirmationOf(db, process, confirmation);
    if (impacted.confirmation.kind !== "stage") throw new Error("A Revisão de Restrição só reavalia Confirmações de Etapa.");
    const input: ConstraintImpactInput = {
      problemStatement: await confirmedStatementOf(db, processId),
      confirmation: impacted.confirmation,
      revision: {
        constraint: statementOf(revision.constraint),
        replacement: revision.replacement && { kind: revision.replacement.kind, item: statementOf(revision.replacement.item) },
        note: revision.note,
      },
    };
    return { input, analyzedAnswerVersionIds: impacted.analyzedAnswerVersionIds };
  }

  // Chama o Jev fora da transação e grava a Avaliação. Com `yes` ou `no` confiantes, o julgamento
  // decide: abre a Pendência ou mantém a Confirmação com a revisão, se a reavaliação ainda estiver aberta.
  async function assess(
    processId: string,
    reassessment: ConstraintReassessment,
  ): Promise<{ ok: true; impactAssessment: ImpactAssessment } | { ok: false; error: ReassessmentError }> {
    const { input, analyzedAnswerVersionIds } = await inputOf(processId, reassessment);
    const outcome = await judgedImpact(() => assessor.assessConstraintImpact(input));
    const { revision, confirmation } = reassessment;

    const saved = await db.transaction().execute(async (trx) => {
      const locked = await lockOpenProcess(trx, processId);
      if (!locked.ok) return locked;
      const { id } = await trx
        .insertInto("impactAssessments")
        .values({
          processId,
          answerVersionId: null,
          previousAnswerVersionId: null,
          constraintRevisionId: revision.id,
          analyzedAnswerVersionIds,
          blockId: null,
          stage: confirmation.stage,
          ...impactOutcomeColumns(outcome, assessor.model),
          rubricRevision: CONSTRAINT_IMPACT_RUBRIC_REVISION,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (outcome.status !== "completed" || !decidesAlone(outcome.result)) return { ok: true, id } as const;
      // Uma decisão gravada no meio-tempo torna o julgamento só histórico.
      const still = await findConstraintReassessment(trx, processId, revision.id, confirmation.stage);
      if (!still || still.status === "pendency_open") return { ok: true, id } as const;
      if (outcome.result.choice === "yes") {
        await trx
          .insertInto("pendencies")
          .values({
            processId,
            reason: "reassessment",
            questionId: null,
            answerVersionId: null,
            constraintRevisionId: revision.id,
            impactAssessmentId: id,
            openedBy: "jev",
            blockId: null,
            stage: confirmation.stage,
          })
          .execute();
      } else {
        await trx
          .insertInto("confirmationConstraintRevisions")
          .values({ processId, constraintRevisionId: revision.id, stage: confirmation.stage, basis: "no_impact", impactAssessmentId: id })
          .execute();
      }
      return { ok: true, id } as const;
    });
    if (!saved.ok) return saved;
    const impactAssessment = (await impactAssessmentsOf(db, processId)).find((item) => item.id === saved.id)!;
    return { ok: true, impactAssessment };
  }

  return {
    async assessRevision(processId, revision) {
      try {
        const pending = (await constraintReassessmentsOf(db, processId)).filter(
          (item) => item.revision.id === revision.id && item.status === "not_assessed",
        );
        for (const item of pending) {
          await assess(processId, item).catch((error: unknown) => {
            log.error(
              { err: error, processId, constraintRevisionId: revision.id, stage: item.confirmation.stage },
              "Não foi possível avaliar o impacto da Revisão de Restrição.",
            );
          });
        }
      } catch (error) {
        log.error({ err: error, processId, constraintRevisionId: revision.id }, "Não foi possível encontrar as Confirmações a reavaliar.");
      }
    },

    async retry(processId, constraintRevisionId, stage) {
      const process = await db.selectFrom("processes").select("status").where("id", "=", processId).executeTakeFirst();
      if (!process) return { ok: false, error: "process_not_found" };
      if (process.status !== "open") return { ok: false, error: "process_not_open" };
      const found = await findConstraintReassessment(db, processId, constraintRevisionId, stage);
      if (!found) return { ok: false, error: "reassessment_not_found" };
      if (found.status !== "not_assessed" && found.status !== "assessment_failed") return { ok: false, error: "impact_assessed" };
      return assess(processId, found);
    },

    async decide(processId, { constraintRevisionId, stage, impactAssessmentId, decision }) {
      const decided = await db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const found = await findConstraintReassessment(trx, processId, constraintRevisionId, stage);
        if (!found) return { ok: false, error: "reassessment_not_found" } as const;
        if (found.status === "pendency_open") return { ok: false, error: "reassessment_decided" } as const;
        if (found.status === "not_assessed") return { ok: false, error: "assessment_required" } as const;
        // A decisão vale sobre a Avaliação que o usuário viu, e a mais recente.
        if (found.impactAssessments.at(-1)!.id !== impactAssessmentId) return { ok: false, error: "unknown_assessment" } as const;
        if (decision === "keep_confirmation") {
          await trx
            .insertInto("confirmationConstraintRevisions")
            .values({ processId, constraintRevisionId, stage, basis: "kept", impactAssessmentId })
            .execute();
          return { ok: true, pendencyId: null, process: locked.process } as const;
        }
        const { id } = await trx
          .insertInto("pendencies")
          .values({
            processId,
            reason: "reassessment",
            questionId: null,
            answerVersionId: null,
            constraintRevisionId,
            impactAssessmentId,
            openedBy: "user",
            blockId: null,
            stage,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, pendencyId: id, process: locked.process } as const;
      });
      if (!decided.ok) return decided;
      if (decided.pendencyId === null) return { ok: true, pendency: null };
      const [pendency] = await listPendencies(db, decided.process, [decided.pendencyId]);
      return { ok: true, pendency: pendency! };
    },
  };
}
