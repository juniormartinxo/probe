import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../db/database.ts";
import type { Assessor, AssessorOutcome, ImpactedConfirmation, ImpactInput, Verdict } from "../assessments/assessor.ts";
import {
  confirmationColumnsOf,
  confirmationKey,
  confirmationRefOf,
  decidesAlone,
  impactAssessmentsOf,
  verdictProblem,
  type ConfirmationRef,
  type DependentConfirmation,
  type ImpactAssessment,
} from "../assessments/impact-assessments.ts";
import { IMPACT_RUBRIC_REVISION } from "../assessments/impact-rubric.ts";
import { describeAnswer } from "./answers.ts";
import { listPendencies, stagesUpTo, type Pendency } from "./pendencies.ts";
import { findStagePoint, stagePointsOf, type StagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";
import { synthesisCorrectionsOf, synthesisInForce } from "./syntheses.ts";

// Por que uma Confirmação passou a sustentar uma Versão nova: sem impacto, segundo o Jev; mantida pelo
// usuário, quando o Jev não teve certeza ou não respondeu; ou reconfirmada, resolvendo a Pendência.
export type ConfirmationBasis = "no_impact" | "kept" | "reconfirmed";

// Em que pé está a reavaliação: o Jev ainda não avaliou o impacto (a chamada se perdeu), a Avaliação
// falhou, o Jev não teve certeza e o usuário decide, ou a Pendência de reavaliação está aberta.
export type ReassessmentStatus = "not_assessed" | "assessment_failed" | "awaiting_decision" | "pendency_open";

interface VersionOfAnswer {
  id: string;
  number: number;
  // A resposta como o usuário a vê.
  answer: string;
}

// Reavaliação: uma Confirmação dependia de uma Versão que já não vale. Fica aberta até a Confirmação
// passar a sustentar a Versão nova; enquanto isso, bloqueia as Confirmações de Etapa que dependem dela.
export interface Reassessment {
  confirmation: DependentConfirmation;
  question: { id: string; wording: string; stage: Stage; blockNumber: number; number: number };
  // A Versão que a Confirmação sustenta e a que vale agora.
  previousVersion: VersionOfAnswer;
  newVersion: VersionOfAnswer;
  status: ReassessmentStatus;
  // As Avaliações de impacto da Versão nova sobre a Confirmação, na ordem; a última é a que vale.
  impactAssessments: ImpactAssessment[];
  pendencyId: string | null;
}

export type ReassessmentError = "process_not_found" | "process_not_open" | "reassessment_not_found";

export type ImpactRetryError = ReassessmentError | "impact_assessed";

export type ImpactDecisionError = ReassessmentError | "reassessment_decided" | "assessment_required" | "unknown_assessment";

export type ReconfirmationError =
  | "process_not_found"
  | "process_not_open"
  | "pendency_not_found"
  | "pendency_resolved"
  | "synthesis_not_applicable";

// O que o usuário decide quando o Jev não teve certeza ou não respondeu, sobre a Avaliação que ele viu.
export interface ImpactDecision {
  answerVersionId: string;
  confirmation: ConfirmationRef;
  impactAssessmentId: string;
  decision: "open_pendency" | "keep_confirmation";
}

export interface Reassessments {
  // Depois de uma Versão nova, avalia o impacto dela sobre cada Confirmação que dependia da anterior.
  // Não lança: uma falha fica no log e a reavaliação, "não avaliada".
  assessChange(processId: string, questionId: string): Promise<void>;
  // Nova tentativa, quando a Avaliação de impacto falhou (ou se perdeu).
  retry(
    processId: string,
    answerVersionId: string,
    confirmation: ConfirmationRef,
  ): Promise<{ ok: true; impactAssessment: ImpactAssessment } | { ok: false; error: ImpactRetryError }>;
  decide(processId: string, decision: ImpactDecision): Promise<{ ok: true; pendency: Pendency | null } | { ok: false; error: ImpactDecisionError }>;
  // Reconfirma a Confirmação afetada com a Versão nova; numa síntese de bloco, com o texto corrigido, se houver.
  reconfirm(
    processId: string,
    pendencyId: string,
    correctedSynthesis: string | null,
  ): Promise<{ ok: true; pendency: Pendency } | { ok: false; error: ReconfirmationError }>;
}

interface PreparedImpact {
  input: ImpactInput;
  analyzedAnswerVersionIds: string[];
}

interface StoredVersion {
  id: string;
  questionId: string;
  number: number;
  selectedChoices: number[] | null;
  text: string | null;
}

const versionColumns = [
  "answerVersions.id",
  "answerVersions.questionId",
  "answerVersions.number",
  "answerVersions.selectedChoices",
  "answerVersions.text",
] as const;

// A Versão de cada Pergunta que cada Confirmação sustenta: a mais recente entre as que ela usou (as
// que a proposta de síntese recebeu; as que a Avaliação de cobertura da Etapa analisou) e as que
// passou a sustentar depois de uma mudança.
async function heldVersionsOf(db: Db, processId: string) {
  const synthesized = await db
    .selectFrom("blockSyntheses")
    .innerJoin("blocks", "blocks.id", "blockSyntheses.blockId")
    .innerJoin("attemptAnswerVersions", "attemptAnswerVersions.attemptId", "blockSyntheses.proposalId")
    .innerJoin("answerVersions", "answerVersions.id", "attemptAnswerVersions.answerVersionId")
    .select(["blockSyntheses.blockId", ...versionColumns])
    .where("blocks.processId", "=", processId)
    .execute();
  const assessed = await db
    .selectFrom("stageConfirmations")
    .innerJoin("stageAssessmentAnswerVersions", "stageAssessmentAnswerVersions.stageAssessmentId", "stageConfirmations.stageAssessmentId")
    .innerJoin("answerVersions", "answerVersions.id", "stageAssessmentAnswerVersions.answerVersionId")
    .select(["stageConfirmations.stage", ...versionColumns])
    .where("stageConfirmations.processId", "=", processId)
    .execute();
  const carried = await db
    .selectFrom("confirmationAnswerVersions")
    .innerJoin("answerVersions", "answerVersions.id", "confirmationAnswerVersions.answerVersionId")
    .select(["confirmationAnswerVersions.blockId", "confirmationAnswerVersions.stage", ...versionColumns])
    .where("confirmationAnswerVersions.processId", "=", processId)
    .execute();
  const held = new Map<string, { confirmation: ConfirmationRef; version: StoredVersion }>();
  const hold = (confirmation: ConfirmationRef, version: StoredVersion) => {
    const key = `${confirmationKey(confirmation)}|${version.questionId}`;
    const current = held.get(key);
    if (!current || current.version.number < version.number) held.set(key, { confirmation, version });
  };
  for (const { blockId, ...version } of synthesized) hold({ kind: "block_synthesis", blockId }, version);
  for (const { stage, ...version } of assessed) hold({ kind: "stage", stage }, version);
  for (const { blockId, stage, ...version } of carried) hold(confirmationRefOf({ blockId, stage }), version);
  return [...held.values()];
}

// As reavaliações abertas do Processo: as Confirmações cuja Versão sustentada numa Pergunta foi
// superada, na ordem das Perguntas.
export async function reassessmentsOf(db: Db, processId: string): Promise<Reassessment[]> {
  const held = await heldVersionsOf(db, processId);
  if (held.length === 0) return [];
  const questionIds = [...new Set(held.map((item) => item.version.questionId))];
  const latest = await db
    .selectFrom("answerVersions")
    .select(["id", "questionId", "number", "selectedChoices", "text"])
    .distinctOn("questionId")
    .where("questionId", "in", questionIds)
    .orderBy("questionId")
    .orderBy("number", "desc")
    .execute();
  const open = held.filter(({ version }) => latest.find((item) => item.questionId === version.questionId)!.number > version.number);
  if (open.length === 0) return [];

  const questions = await db
    .selectFrom("questions")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select(["questions.id", "questions.wording", "questions.choices", "questions.position", "blocks.number as blockNumber", "blocks.stage"])
    .where("questions.id", "in", questionIds)
    .execute();
  const blocks = await db.selectFrom("blocks").select(["id", "number", "stage"]).where("processId", "=", processId).execute();
  const assessments = await impactAssessmentsOf(db, processId);
  const pendencies = await db
    .selectFrom("pendencies")
    .select(["id", "answerVersionId", "blockId", "stage"])
    .where("processId", "=", processId)
    .where("reason", "=", "reassessment")
    .where("resolvedAt", "is", null)
    .execute();

  return open
    .map(({ confirmation, version }) => {
      const question = questions.find((item) => item.id === version.questionId)!;
      const current = latest.find((item) => item.questionId === version.questionId)!;
      const key = confirmationKey(confirmation);
      const own = assessments.filter((item) => item.answerVersionId === current.id && confirmationKey(item.confirmation) === key);
      const pendency = pendencies.find(
        (item) => item.answerVersionId === current.id && confirmationKey(confirmationRefOf(item)) === key,
      );
      const last = own.at(-1);
      const status: ReassessmentStatus = pendency
        ? "pendency_open"
        : !last
          ? "not_assessed"
          : last.status === "failed"
            ? "assessment_failed"
            : "awaiting_decision";
      const block = confirmation.kind === "block_synthesis" ? blocks.find((item) => item.id === confirmation.blockId)! : undefined;
      return {
        confirmation: block
          ? { kind: "block_synthesis" as const, blockId: block.id, blockNumber: block.number, stage: block.stage }
          : (confirmation as DependentConfirmation),
        question: {
          id: question.id,
          wording: question.wording,
          stage: question.stage,
          blockNumber: question.blockNumber,
          number: question.position + 1,
        },
        previousVersion: { id: version.id, number: version.number, answer: describeAnswer(question, version) },
        newVersion: { id: current.id, number: current.number, answer: describeAnswer(question, current) },
        status,
        impactAssessments: own,
        pendencyId: pendency?.id ?? null,
      };
    })
    .toSorted(
      (a, b) =>
        a.question.blockNumber - b.question.blockNumber ||
        a.question.number - b.question.number ||
        // A síntese de bloco antes da Etapa que se apoia nela.
        Number(a.confirmation.kind === "stage") - Number(b.confirmation.kind === "stage") ||
        (a.confirmation.kind === "block_synthesis" && b.confirmation.kind === "block_synthesis"
          ? a.confirmation.blockNumber - b.confirmation.blockNumber
          : 0),
    );
}

// As reavaliações ainda sem decisão (sem Pendência aberta) nas Perguntas da Etapa ou das anteriores:
// enquanto o impacto não está decidido, a Confirmação da Etapa espera.
export async function undecidedReassessmentsBlocking(db: Db, processId: string, stage: Stage): Promise<Reassessment[]> {
  const upTo = stagesUpTo(stage);
  return (await reassessmentsOf(db, processId)).filter((item) => item.status !== "pendency_open" && upTo.includes(item.question.stage));
}

const sameConfirmation = (a: ConfirmationRef, b: ConfirmationRef) => confirmationKey(a) === confirmationKey(b);

async function findReassessment(db: Db, processId: string, answerVersionId: string, confirmation: ConfirmationRef) {
  return (await reassessmentsOf(db, processId)).find(
    (item) => item.newVersion.id === answerVersionId && sameConfirmation(item.confirmation, confirmation),
  );
}

// Trava o Processo aberto para a transação.
async function lockOpenProcess(trx: Db, processId: string) {
  const process = await trx
    .selectFrom("processes")
    .select(["id", "status", "stagePointsVersion"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" } as const;
  if (process.status !== "open") return { ok: false, error: "process_not_open" } as const;
  return { ok: true, process } as const;
}

const pointOf = (version: number, stage: Stage, key: string): StagePoint => {
  const { name, description } = findStagePoint(version, stage, key)!;
  return { key, name, description };
};

// A Confirmação como o Jev a recebe, como está: a síntese que vale, com os Pontos que ela cobriu, ou a
// Etapa, com os Pontos e as respostas que ela sustenta (as Versões, para gravar o que o Jev recebeu).
async function impactedConfirmationOf(
  db: Db,
  process: { id: string; stagePointsVersion: number },
  confirmation: DependentConfirmation,
): Promise<{ confirmation: ImpactedConfirmation; analyzedAnswerVersionIds: string[] }> {
  if (confirmation.kind === "stage") {
    const held = (await heldVersionsOf(db, process.id))
      .filter((item) => item.confirmation.kind === "stage" && item.confirmation.stage === confirmation.stage)
      .map((item) => item.version);
    const questions = held.length
      ? await db
          .selectFrom("questions")
          .innerJoin("blocks", "blocks.id", "questions.blockId")
          .select(["questions.id", "questions.wording", "questions.choices", "questions.position", "blocks.number as blockNumber"])
          .where(
            "questions.id",
            "in",
            held.map((version) => version.questionId),
          )
          .execute()
      : [];
    const answers = held
      .map((version) => ({ version, question: questions.find((item) => item.id === version.questionId)! }))
      .toSorted((a, b) => a.question.blockNumber - b.question.blockNumber || a.question.position - b.question.position);
    return {
      confirmation: {
        kind: "stage",
        stage: confirmation.stage,
        stagePoints: stagePointsOf(process.stagePointsVersion, confirmation.stage).map(({ key, name, description }) => ({ key, name, description })),
        answers: answers.map(({ version, question }) => ({
          ref: `${question.blockNumber}.${question.position + 1}`,
          wording: question.wording,
          answer: describeAnswer(question, version),
        })),
      },
      analyzedAnswerVersionIds: answers.map(({ version }) => version.id),
    };
  }
  const { synthesis } = await db
    .selectFrom("blockSyntheses")
    .select("synthesis")
    .where("blockId", "=", confirmation.blockId)
    .executeTakeFirstOrThrow();
  const corrections = (await synthesisCorrectionsOf(db, [confirmation.blockId])).get(confirmation.blockId)!;
  const covered = await db
    .selectFrom("stagePointCoverage")
    .select("stagePoint")
    .where("blockId", "=", confirmation.blockId)
    .where("status", "=", "covered")
    .execute();
  return {
    confirmation: {
      kind: "block_synthesis",
      stage: confirmation.stage,
      blockNumber: confirmation.blockNumber,
      synthesis: synthesisInForce({ synthesis, corrections }),
      coveredStagePoints: covered.map((row) => pointOf(process.stagePointsVersion, confirmation.stage, row.stagePoint)),
    },
    analyzedAnswerVersionIds: [],
  };
}

export function reassessments({ db, assessor, log }: { db: Db; assessor: Assessor; log: FastifyBaseLogger }): Reassessments {
  async function judge(input: ImpactInput): Promise<AssessorOutcome<Verdict>> {
    const outcome = await assessor.assessImpact(input).catch(
      (error: unknown): AssessorOutcome<never> => ({
        status: "failed",
        reason: "jev_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    if (outcome.status !== "completed") return outcome;
    const problem = verdictProblem(outcome.result);
    return problem ? { status: "failed", reason: "invalid_output", message: problem } : outcome;
  }

  // O que o Jev recebe: a Confirmação como está e a mudança.
  async function impactInputOf(processId: string, reassessment: Reassessment): Promise<PreparedImpact> {
    const process = await db.selectFrom("processes").select(["id", "stagePointsVersion"]).where("id", "=", processId).executeTakeFirstOrThrow();
    const { statement } = await db
      .selectFrom("problemStatements")
      .select("statement")
      .where("processId", "=", processId)
      .executeTakeFirstOrThrow();
    const { question } = reassessment;
    const { confirmation, analyzedAnswerVersionIds } = await impactedConfirmationOf(db, process, reassessment.confirmation);
    return {
      input: {
        problemStatement: statement,
        confirmation,
        question: { ref: `${question.blockNumber}.${question.number}`, wording: question.wording },
        previousAnswer: reassessment.previousVersion.answer,
        newAnswer: reassessment.newVersion.answer,
      },
      analyzedAnswerVersionIds,
    };
  }

  // Chama o Jev fora da transação (o Processo não fica travado enquanto ele responde) e grava a
  // Avaliação. Com `yes` ou `no` confiantes, o julgamento decide: abre a Pendência ou mantém a
  // Confirmação com a Versão nova, se a reavaliação ainda estiver aberta para esta Versão.
  async function assess(
    processId: string,
    reassessment: Reassessment,
    { input, analyzedAnswerVersionIds }: PreparedImpact,
  ): Promise<{ ok: true; impactAssessment: ImpactAssessment } | { ok: false; error: ReassessmentError }> {
    const { question } = reassessment;
    const outcome = await judge(input);

    const saved = await db.transaction().execute(async (trx) => {
      const locked = await lockOpenProcess(trx, processId);
      if (!locked.ok) return locked;
      const confirmation = confirmationColumnsOf(reassessment.confirmation);
      const { id } = await trx
        .insertInto("impactAssessments")
        .values({
          processId,
          answerVersionId: reassessment.newVersion.id,
          previousAnswerVersionId: reassessment.previousVersion.id,
          analyzedAnswerVersionIds,
          ...confirmation,
          status: outcome.status,
          requestedModel: assessor.model,
          jevModel: outcome.status === "completed" ? outcome.model : null,
          rubricRevision: IMPACT_RUBRIC_REVISION,
          choice: outcome.status === "completed" ? outcome.result.choice : null,
          confidence: outcome.status === "completed" ? outcome.result.confidence : null,
          probabilities: outcome.status === "completed" ? JSON.stringify(outcome.result.probabilities) : null,
          failureReason: outcome.status === "failed" ? outcome.reason : null,
          message: outcome.status === "failed" ? outcome.message : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (outcome.status !== "completed" || !decidesAlone(outcome.result)) return { ok: true, id } as const;
      // Uma Versão mais nova, ou uma decisão gravada no meio-tempo, torna o julgamento só histórico.
      const still = await findReassessment(trx, processId, reassessment.newVersion.id, reassessment.confirmation);
      if (!still || still.status === "pendency_open") return { ok: true, id } as const;
      if (outcome.result.choice === "yes") {
        await trx
          .insertInto("pendencies")
          .values({
            processId,
            reason: "reassessment",
            questionId: question.id,
            answerVersionId: reassessment.newVersion.id,
            impactAssessmentId: id,
            openedBy: "jev",
            ...confirmation,
          })
          .execute();
      } else {
        await trx
          .insertInto("confirmationAnswerVersions")
          .values({ processId, answerVersionId: reassessment.newVersion.id, basis: "no_impact", impactAssessmentId: id, ...confirmation })
          .execute();
      }
      return { ok: true, id } as const;
    });
    if (!saved.ok) return saved;
    const impactAssessment = (await impactAssessmentsOf(db, processId)).find((item) => item.id === saved.id)!;
    return { ok: true, impactAssessment };
  }

  return {
    async assessChange(processId, questionId) {
      // Nunca lança: a Versão nova já está gravada. Uma Avaliação que não chega a ser gravada deixa a
      // reavaliação "não avaliada", e o usuário pede uma nova tentativa; o erro fica no log.
      try {
        const pending = (await reassessmentsOf(db, processId)).filter(
          (item) => item.question.id === questionId && item.status === "not_assessed",
        );
        const failed = (item: Reassessment) => (error: unknown) => {
          log.error(
            { err: error, processId, questionId, confirmation: item.confirmation },
            "Não foi possível avaliar o impacto da Versão nova.",
          );
          return null;
        };
        // Todas as entradas antes de chamar o Jev: as chamadas saem na ordem das reavaliações.
        const prepared = await Promise.all(pending.map((item) => impactInputOf(processId, item).catch(failed(item))));
        await Promise.all(
          pending.map((item, index) => {
            const input = prepared[index];
            return input ? assess(processId, item, input).catch(failed(item)) : null;
          }),
        );
      } catch (error) {
        log.error({ err: error, processId, questionId }, "Não foi possível encontrar as Confirmações a reavaliar.");
      }
    },

    async retry(processId, answerVersionId, confirmation) {
      const process = await db.selectFrom("processes").select("status").where("id", "=", processId).executeTakeFirst();
      if (!process) return { ok: false, error: "process_not_found" };
      if (process.status !== "open") return { ok: false, error: "process_not_open" };
      const found = await findReassessment(db, processId, answerVersionId, confirmation);
      if (!found) return { ok: false, error: "reassessment_not_found" };
      if (found.status !== "not_assessed" && found.status !== "assessment_failed") return { ok: false, error: "impact_assessed" };
      return assess(processId, found, await impactInputOf(processId, found));
    },

    async decide(processId, { answerVersionId, confirmation, impactAssessmentId, decision }) {
      const decided = await db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const found = await findReassessment(trx, processId, answerVersionId, confirmation);
        if (!found) return { ok: false, error: "reassessment_not_found" } as const;
        if (found.status === "pendency_open") return { ok: false, error: "reassessment_decided" } as const;
        if (found.status === "not_assessed") return { ok: false, error: "assessment_required" } as const;
        // A decisão vale sobre a Avaliação que o usuário viu, e a mais recente.
        if (found.impactAssessments.at(-1)!.id !== impactAssessmentId) return { ok: false, error: "unknown_assessment" } as const;
        const columns = confirmationColumnsOf(confirmation);
        if (decision === "keep_confirmation") {
          await trx
            .insertInto("confirmationAnswerVersions")
            .values({ processId, answerVersionId, basis: "kept", impactAssessmentId, ...columns })
            .execute();
          return { ok: true, pendencyId: null, process: locked.process } as const;
        }
        const { id } = await trx
          .insertInto("pendencies")
          .values({
            processId,
            reason: "reassessment",
            questionId: found.question.id,
            answerVersionId,
            impactAssessmentId,
            openedBy: "user",
            ...columns,
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

    async reconfirm(processId, pendencyId, correctedSynthesis) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const pendency = await trx
          .selectFrom("pendencies")
          .select(["answerVersionId", "impactAssessmentId", "blockId", "stage", "resolvedAt"])
          .where("id", "=", pendencyId)
          .where("processId", "=", processId)
          .where("reason", "=", "reassessment")
          .executeTakeFirst();
        if (!pendency) return { ok: false, error: "pendency_not_found" } as const;
        if (pendency.resolvedAt !== null) return { ok: false, error: "pendency_resolved" } as const;
        const confirmation = confirmationRefOf(pendency);
        let correction: string | null = null;
        if (correctedSynthesis !== null) {
          if (confirmation.kind !== "block_synthesis") return { ok: false, error: "synthesis_not_applicable" } as const;
          const { synthesis } = await trx
            .selectFrom("blockSyntheses")
            .select("synthesis")
            .where("blockId", "=", confirmation.blockId)
            .executeTakeFirstOrThrow();
          const corrections = (await synthesisCorrectionsOf(trx, [confirmation.blockId])).get(confirmation.blockId)!;
          const text = correctedSynthesis.trim();
          // O mesmo texto que vale não é correção.
          if (text !== synthesisInForce({ synthesis, corrections })) correction = text;
        }
        const { recordedAt } = await trx
          .insertInto("confirmationAnswerVersions")
          .values({
            processId,
            answerVersionId: pendency.answerVersionId!,
            basis: "reconfirmed",
            impactAssessmentId: pendency.impactAssessmentId!,
            correctedSynthesis: correction,
            ...confirmationColumnsOf(confirmation),
          })
          .returning("recordedAt")
          .executeTakeFirstOrThrow();
        await trx
          .updateTable("pendencies")
          .set({ resolvedAt: recordedAt, resolution: "reconfirmed" })
          .where("id", "=", pendencyId)
          .execute();
        const [resolved] = await listPendencies(trx, locked.process, [pendencyId]);
        return { ok: true, pendency: resolved! } as const;
      });
    },
  };
}
