import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequestRunner } from "../ai/ai-requests.ts";
import type { Assistant, Cli, GeneratedResolutionQuestion, ResolutionQuestionInput } from "../ai/assistant.ts";
import { failureOnThrow, type Assessor, type AssessorOutcome, type ConflictInput, type Verdict } from "../assessments/assessor.ts";
import {
  conflictAssessmentsOf,
  conflictDecidesAlone,
  type ConflictAssessment,
  type ConflictVerdict,
} from "../assessments/conflict-assessments.ts";
import { CONFLICT_RUBRIC_REVISION } from "../assessments/conflict-rubric.ts";
import { verdictProblem } from "../assessments/impact-assessments.ts";
import type { SettingsModule } from "../settings/settings.ts";
import { confirmedVersionIdsOf } from "./answers.ts";
import {
  clarificationsOf,
  conflictingAnswerOf,
  conflictPairsOf,
  resolutionQuestionOf,
  RESOLUTION_QUESTION_OPERATION,
  type ConflictPairRef,
  type ResolutionQuestion,
} from "./conflict-pairs.ts";
import {
  constraintsAndPreferencesOf,
  inForceOf,
  reviseConstraintIn,
  statementsOf,
  type ConstraintRevisionError,
  type ConstraintRevisionRequest,
} from "./constraints-and-preferences.ts";
import { listPendencies, stagesUpTo, type Pendency } from "./pendencies.ts";
import { confirmedStatementOf } from "./problem-statement.ts";
import { lockOpenProcess } from "./process.ts";
import type { Stage } from "./stage.ts";

// Em que pé está cada par: ainda sem Avaliação, com a Avaliação falha ou incerta à espera do usuário,
// sem conflito segundo o Jev, descartado pelo usuário, com a Pendência de conflito aberta ou resolvida,
// ou superado (uma das respostas já tem uma Versão mais nova, e o par deixou de valer).
export type ConflictPairStatus =
  | "not_assessed"
  | "assessment_failed"
  | "awaiting_decision"
  | "no_conflict"
  | "dismissed"
  | "pendency_open"
  | "pendency_resolved"
  | "superseded";

const undecidedStatuses: ConflictPairStatus[] = ["not_assessed", "assessment_failed", "awaiting_decision"];

export interface ConflictPair extends Omit<ConflictPairRef, "checkId"> {
  status: ConflictPairStatus;
  // O julgamento da Avaliação que vale, se ela foi concluída.
  verdict: ConflictVerdict | null;
  pendencyId: string | null;
}

export type ConflictCheckStatus = "not_assessed" | "assessment_failed" | "awaiting_decision" | "decided";

// Verificação de conflito: as respostas recém-confirmadas, em pares entre si e com as já confirmadas,
// e as Avaliações de conflito do Jev sobre eles, na ordem; a última é a que vale. Fica sem decisão
// enquanto algum par que ainda vale espera o Jev ou o usuário.
export interface ConflictCheck {
  id: string;
  createdAt: Date;
  status: ConflictCheckStatus;
  pairs: ConflictPair[];
  assessments: ConflictAssessment[];
}

type CheckError = "process_not_found" | "process_not_open" | "conflict_check_not_found";

export type ConflictRetryError = CheckError | "conflict_assessed";

export type ConflictDecisionError =
  | CheckError
  | "conflict_pair_not_found"
  | "conflict_decided"
  | "assessment_required"
  | "unknown_assessment";

type PendencyError = "process_not_found" | "process_not_open" | "pendency_not_found" | "pendency_resolved";

export type ClarificationError = PendencyError;

export type ConflictConstraintRevisionError = PendencyError | ConstraintRevisionError;

export type ResolutionQuestionError = PendencyError | "attempt_in_progress" | "resolution_question_generated" | "cli_model_not_configured";

// O que o usuário decide sobre pares em que o Jev não teve certeza ou não respondeu, sobre a
// Avaliação que ele viu: abrir a Pendência de conflito ou descartar o conflito.
export interface ConflictDecision {
  conflictAssessmentId: string;
  pairIds: string[];
  decision: "open_pendency" | "dismiss";
}

// Revisão de Restrição como resolução: a Restrição retirada, a que a substitui (se houver) e uma nota.
export interface ConflictConstraintRevision extends ConstraintRevisionRequest {
  constraintId: string;
}

export interface Conflicts {
  // Depois de respostas serem confirmadas (pela síntese do Bloco ou depois de uma mudança), avalia
  // conflito entre elas e as respostas já confirmadas. Só avalia as Versões confirmadas que valem e
  // ainda não foram avaliadas. Não lança: uma falha fica no log.
  assessConfirmed(processId: string, answerVersionIds: string[]): Promise<void>;
  // Nova tentativa, quando a Avaliação de conflito falhou (ou se perdeu).
  retry(processId: string, checkId: string): Promise<{ ok: true; conflictCheck: ConflictCheck } | { ok: false; error: ConflictRetryError }>;
  decide(
    processId: string,
    checkId: string,
    decision: ConflictDecision,
  ): Promise<{ ok: true; pendencies: Pendency[] } | { ok: false; error: ConflictDecisionError }>;
  // Resolve a Pendência de conflito com o esclarecimento do usuário.
  clarify(processId: string, pendencyId: string, clarification: string): Promise<{ ok: true; pendency: Pendency } | { ok: false; error: ClarificationError }>;
  // Resolve a Pendência de conflito com uma Revisão de Restrição, em qualquer Etapa a partir de R (antes
  // dela não há Restrição); as Confirmações de Etapa que sustentavam a Restrição passam pela Avaliação de impacto.
  reviseConstraint(
    processId: string,
    pendencyId: string,
    revision: ConflictConstraintRevision,
  ): Promise<{ ok: true; pendency: Pendency } | { ok: false; error: ConflictConstraintRevisionError }>;
  // Pede à IA a pergunta de resolução, ou uma nova tentativa dela. Sem `cli`, com a CLI da tentativa
  // anterior (ou a da configuração); com ela, com a que o usuário escolheu.
  requestResolutionQuestion(
    processId: string,
    pendencyId: string,
    cli?: Cli,
  ): Promise<{ ok: true; resolutionQuestion: ResolutionQuestion } | { ok: false; error: ResolutionQuestionError }>;
}

const pairKey = (position: number) => `par_${position}`;

// As Versões confirmadas que valem: a mais recente de cada Pergunta, se confirmada, na ordem dos
// Blocos e das Perguntas.
async function confirmedInForceOf(db: Db, processId: string): Promise<string[]> {
  const latest = await db
    .selectFrom("answerVersions")
    .innerJoin("questions", "questions.id", "answerVersions.questionId")
    .innerJoin("blocks", "blocks.id", "questions.blockId")
    .select(["answerVersions.id", "blocks.number as blockNumber", "questions.position"])
    .distinctOn("answerVersions.questionId")
    .where("blocks.processId", "=", processId)
    .orderBy("answerVersions.questionId")
    .orderBy("answerVersions.number", "desc")
    .execute();
  const confirmed = await confirmedVersionIdsOf(
    db,
    latest.map((row) => row.id),
  );
  return latest
    .filter((row) => confirmed.has(row.id))
    .toSorted((a, b) => a.blockNumber - b.blockNumber || a.position - b.position)
    .map((row) => row.id);
}

function pairStatus(
  pair: ConflictPairRef,
  last: ConflictAssessment | undefined,
  pendency: { resolvedAt: Date | null } | undefined,
  dismissed: boolean,
): ConflictPairStatus {
  if (pendency) return pendency.resolvedAt === null ? "pendency_open" : "pendency_resolved";
  if (dismissed) return "dismissed";
  if (pair.answer.superseded || pair.other.superseded) return "superseded";
  if (!last) return "not_assessed";
  if (last.status === "failed") return "assessment_failed";
  const verdict = last.verdicts.find((item) => item.pairId === pair.id);
  // Um `yes` confiante sempre abre a Pendência; sem ela, o par só pode estar superado.
  return verdict && !verdict.needsDecision && verdict.choice === "no" ? "no_conflict" : "awaiting_decision";
}

// As verificações de conflito do Processo, na ordem em que foram feitas.
export async function conflictChecksOf(db: Db, processId: string): Promise<ConflictCheck[]> {
  const checks = await db
    .selectFrom("conflictChecks")
    .select(["id", "createdAt"])
    .where("processId", "=", processId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  if (checks.length === 0) return [];
  const pairs = await conflictPairsOf(db, processId);
  const assessments = await conflictAssessmentsOf(db, processId);
  const pendencies = await db
    .selectFrom("pendencies")
    .select(["id", "conflictPairId", "resolvedAt"])
    .where("processId", "=", processId)
    .where("reason", "=", "conflict")
    .execute();
  const dismissed = new Set(
    (
      await db
        .selectFrom("conflictDismissals")
        .innerJoin("conflictPairs", "conflictPairs.id", "conflictDismissals.pairId")
        .innerJoin("conflictChecks", "conflictChecks.id", "conflictPairs.checkId")
        .select("conflictDismissals.pairId")
        .where("conflictChecks.processId", "=", processId)
        .execute()
    ).map((row) => row.pairId),
  );
  return checks.map((check) => {
    const own = assessments.filter((assessment) => assessment.checkId === check.id);
    const last = own.at(-1);
    const checkPairs = pairs
      .filter((pair) => pair.checkId === check.id)
      .map(({ checkId: _, ...pair }) => {
        const pendency = pendencies.find((item) => item.conflictPairId === pair.id);
        return {
          ...pair,
          status: pairStatus({ ...pair, checkId: check.id }, last, pendency, dismissed.has(pair.id)),
          verdict: last?.verdicts.find((item) => item.pairId === pair.id) ?? null,
          pendencyId: pendency?.id ?? null,
        };
      });
    const undecided = checkPairs.some((pair) => undecidedStatuses.includes(pair.status));
    const status: ConflictCheckStatus = !undecided
      ? "decided"
      : !last
        ? "not_assessed"
        : last.status === "failed"
          ? "assessment_failed"
          : "awaiting_decision";
    return { id: check.id, createdAt: check.createdAt, status, pairs: checkPairs, assessments: own };
  });
}

// As verificações ainda sem decisão com um par sem decisão em Perguntas da Etapa ou das anteriores:
// enquanto não se sabe se as respostas são compatíveis, a Confirmação da Etapa espera.
export async function undecidedConflictsBlocking(db: Db, processId: string, stage: Stage): Promise<ConflictCheck[]> {
  const upTo = stagesUpTo(stage);
  return (await conflictChecksOf(db, processId)).filter((check) =>
    check.pairs.some(
      (pair) =>
        undecidedStatuses.includes(pair.status) && (upTo.includes(pair.answer.question.stage) || upTo.includes(pair.other.question.stage)),
    ),
  );
}

// A Pendência de conflito aberta do Processo, para resolvê-la; chamar com o Processo travado.
async function openConflictPendency(trx: Db, processId: string, pendencyId: string) {
  const pendency = await trx
    .selectFrom("pendencies")
    .select(["id", "resolvedAt", "conflictPairId"])
    .where("id", "=", pendencyId)
    .where("processId", "=", processId)
    .where("reason", "=", "conflict")
    .executeTakeFirst();
  if (!pendency) return { ok: false, error: "pendency_not_found" } as const;
  if (pendency.resolvedAt !== null) return { ok: false, error: "pendency_resolved" } as const;
  return { ok: true, pairId: pendency.conflictPairId! } as const;
}

// `afterConstraintRevision`: chamado depois de uma Revisão de Restrição; quem o recebe avalia o impacto
// dela sobre as Confirmações de Etapa. Não lança.
export function conflicts(deps: {
  db: Db;
  assessor: Assessor;
  assistant: Assistant;
  runner: AiRequestRunner;
  settings: SettingsModule;
  log: FastifyBaseLogger;
  afterConstraintRevision: (processId: string) => Promise<void>;
}): Conflicts {
  const { db, assessor, assistant, runner, settings, log, afterConstraintRevision } = deps;

  // Um julgamento válido para cada par, ou a falha, qualquer que seja o Assessor.
  async function judge(input: ConflictInput): Promise<AssessorOutcome<Record<string, Verdict>>> {
    const outcome = await failureOnThrow(() => assessor.assessConflicts(input));
    if (outcome.status !== "completed") return outcome;
    for (const { key } of input.pairs) {
      const verdict = outcome.result[key];
      const problem = verdict ? verdictProblem(verdict) : "O Jev não julgou todos os pares.";
      if (problem) return { status: "failed", reason: "invalid_output", message: problem };
    }
    return outcome;
  }

  // Chama o Jev fora da transação (o Processo não fica travado enquanto ele responde) e grava a
  // Avaliação. Um `yes` confiante abre a Pendência de conflito do par, se ele ainda vale.
  async function assess(processId: string, checkId: string): Promise<{ ok: true } | { ok: false; error: CheckError }> {
    const pairs = (await conflictPairsOf(db, processId)).filter((pair) => pair.checkId === checkId);
    const items = inForceOf(await constraintsAndPreferencesOf(db, processId));
    const input: ConflictInput = {
      problemStatement: await confirmedStatementOf(db, processId),
      ...statementsOf(items),
      clarifications: await clarificationsOf(db, processId),
      pairs: pairs.map((pair) => ({ key: pairKey(pair.position), answer: conflictingAnswerOf(pair.answer), other: conflictingAnswerOf(pair.other) })),
    };
    const outcome = await judge(input);

    const saved = await db.transaction().execute(async (trx) => {
      const locked = await lockOpenProcess(trx, processId);
      if (!locked.ok) return locked;
      const { id } = await trx
        .insertInto("conflictAssessments")
        .values({
          processId,
          checkId,
          status: outcome.status,
          requestedModel: assessor.model,
          jevModel: outcome.status === "completed" ? outcome.model : null,
          rubricRevision: CONFLICT_RUBRIC_REVISION,
          analyzedConstraintIds: items.constraints.map((item) => item.id),
          analyzedPreferenceIds: items.preferences.map((item) => item.id),
          failureReason: outcome.status === "failed" ? outcome.reason : null,
          message: outcome.status === "failed" ? outcome.message : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (outcome.status !== "completed") return { ok: true, pendencyIds: [] as string[] } as const;
      await trx
        .insertInto("conflictVerdicts")
        .values(
          pairs.map((pair) => {
            const { choice, confidence, probabilities } = outcome.result[pairKey(pair.position)]!;
            return { assessmentId: id, pairId: pair.id, choice, confidence, probabilities: JSON.stringify(probabilities) };
          }),
        )
        .execute();
      // Uma Versão mais nova de uma das respostas, no meio-tempo, torna o julgamento só histórico.
      const check = (await conflictChecksOf(trx, processId)).find((item) => item.id === checkId)!;
      const conflicting = check.pairs.filter(
        (pair) => pair.status === "awaiting_decision" && pair.verdict?.choice === "yes" && conflictDecidesAlone(pair.verdict),
      );
      const pendencyIds: string[] = [];
      for (const pair of conflicting) {
        const pendency = await trx
          .insertInto("pendencies")
          .values({
            processId,
            reason: "conflict",
            questionId: pair.answer.question.id,
            conflictPairId: pair.id,
            conflictAssessmentId: id,
            openedBy: "jev",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        pendencyIds.push(pendency.id);
      }
      return { ok: true, pendencyIds } as const;
    });
    if (!saved.ok) return saved;
    await askResolutionQuestions(processId, saved.pendencyIds);
    return { ok: true };
  }

  // Ao abrir uma Pendência de conflito, a IA formula a pergunta de resolução. Sem CLI configurada ou
  // com outra recusa, o usuário a pede depois; nada disso desfaz a Pendência.
  async function askResolutionQuestions(processId: string, pendencyIds: string[]): Promise<void> {
    for (const pendencyId of pendencyIds) {
      const requested = await requestResolutionQuestion(processId, pendencyId).catch((error: unknown) => {
        log.error({ err: error, processId, pendencyId }, "Não foi possível pedir a pergunta de resolução do conflito.");
        return null;
      });
      if (requested && !requested.ok) log.info({ processId, pendencyId, error: requested.error }, "Pergunta de resolução não pedida.");
    }
  }

  async function requestResolutionQuestion(
    processId: string,
    pendencyId: string,
    cli?: Cli,
  ): Promise<{ ok: true; resolutionQuestion: ResolutionQuestion } | { ok: false; error: ResolutionQuestionError }> {
    const opened = await db.transaction().execute(async (trx) => {
      const locked = await lockOpenProcess(trx, processId);
      if (!locked.ok) return locked;
      const pendency = await openConflictPendency(trx, processId, pendencyId);
      if (!pendency.ok) return pendency;
      const latest = (await listAiRequests<GeneratedResolutionQuestion>(trx, processId, RESOLUTION_QUESTION_OPERATION, { pendencyId })).at(-1);
      if (latest?.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
      if (latest?.status === "completed") return { ok: false, error: "resolution_question_generated" } as const;
      // Antes de gravar a solicitação: uma recusa aqui não deixa solicitação sem tentativa.
      const attemptSettings = await settings.forNewAttempt(trx, cli ?? latest?.attempts.at(-1)!.cli);
      if (!attemptSettings.ok) return attemptSettings;
      const aiRequestId =
        latest?.id ??
        (
          await trx
            .insertInto("aiRequests")
            .values({ processId, operation: RESOLUTION_QUESTION_OPERATION, blockId: null, pendencyId })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      const [pair] = await conflictPairsOf(trx, processId, [pendency.pairId]);
      const input: ResolutionQuestionInput = {
        problemStatement: await confirmedStatementOf(trx, processId),
        ...statementsOf(inForceOf(await constraintsAndPreferencesOf(trx, processId))),
        answers: [conflictingAnswerOf(pair!.answer), conflictingAnswerOf(pair!.other)],
        clarifications: await clarificationsOf(trx, processId),
      };
      const attempt = await runner.openAttempt(trx, aiRequestId, attemptSettings.settings);
      return { ok: true, attempt, input } as const;
    });
    if (!opened.ok) return opened;
    try {
      // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
      return { ok: true, resolutionQuestion: (await resolutionQuestionOf(db, processId, pendencyId))! };
    } finally {
      // Aberta, a tentativa sempre segue, mesmo que a leitura falhe: nunca fica "running" à toa.
      runner.run(opened.attempt, (context) => assistant.formulateResolutionQuestion(opened.input, context));
    }
  }

  return {
    async assessConfirmed(processId, answerVersionIds) {
      try {
        const checkId = await db.transaction().execute(async (trx) => {
          const locked = await lockOpenProcess(trx, processId);
          if (!locked.ok) return null;
          const inForce = await confirmedInForceOf(trx, processId);
          // Avaliadas uma vez: cada par de respostas confirmadas é avaliado quando a mais nova delas é confirmada.
          const assessed = new Set(
            (await trx.selectFrom("conflictChecks").select("subjectAnswerVersionIds").where("processId", "=", processId).execute()).flatMap(
              (row) => row.subjectAnswerVersionIds,
            ),
          );
          const subjects = inForce.filter((id) => answerVersionIds.includes(id) && !assessed.has(id));
          if (subjects.length === 0) return null;
          const others = inForce.filter((id) => !subjects.includes(id));
          const pairs = [
            ...subjects.flatMap((answer, index) => subjects.slice(index + 1).map((other) => [answer, other] as const)),
            ...subjects.flatMap((answer) => others.map((other) => [answer, other] as const)),
          ];
          if (pairs.length === 0) return null;
          const { id } = await trx
            .insertInto("conflictChecks")
            .values({ processId, subjectAnswerVersionIds: subjects })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("conflictPairs")
            .values(pairs.map(([answer, other], position) => ({ checkId: id, position, answerVersionId: answer, otherAnswerVersionId: other })))
            .execute();
          return id;
        });
        if (checkId) await assess(processId, checkId);
      } catch (error) {
        // A verificação gravada fica "não avaliada", e o usuário pede uma nova tentativa.
        log.error({ err: error, processId, answerVersionIds }, "Não foi possível avaliar conflito entre as respostas confirmadas.");
      }
    },

    async retry(processId, checkId) {
      const process = await db.selectFrom("processes").select("status").where("id", "=", processId).executeTakeFirst();
      if (!process) return { ok: false, error: "process_not_found" };
      if (process.status !== "open") return { ok: false, error: "process_not_open" };
      const check = (await conflictChecksOf(db, processId)).find((item) => item.id === checkId);
      if (!check) return { ok: false, error: "conflict_check_not_found" };
      if (check.status !== "not_assessed" && check.status !== "assessment_failed") return { ok: false, error: "conflict_assessed" };
      const assessed = await assess(processId, checkId);
      if (!assessed.ok) return assessed;
      return { ok: true, conflictCheck: (await conflictChecksOf(db, processId)).find((item) => item.id === checkId)! };
    },

    async decide(processId, checkId, { conflictAssessmentId, pairIds, decision }) {
      const decided = await db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const check = (await conflictChecksOf(trx, processId)).find((item) => item.id === checkId);
        if (!check) return { ok: false, error: "conflict_check_not_found" } as const;
        const last = check.assessments.at(-1);
        if (!last) return { ok: false, error: "assessment_required" } as const;
        // A decisão vale sobre a Avaliação que o usuário viu, e a mais recente.
        if (last.id !== conflictAssessmentId) return { ok: false, error: "unknown_assessment" } as const;
        const pairs = [...new Set(pairIds)].map((pairId) => check.pairs.find((pair) => pair.id === pairId));
        if (pairs.some((pair) => !pair)) return { ok: false, error: "conflict_pair_not_found" } as const;
        const chosen = pairs as ConflictPair[];
        if (chosen.some((pair) => pair.status !== "awaiting_decision" && pair.status !== "assessment_failed")) {
          return { ok: false, error: "conflict_decided" } as const;
        }
        if (decision === "dismiss") {
          await trx
            .insertInto("conflictDismissals")
            .values(chosen.map((pair) => ({ pairId: pair.id, conflictAssessmentId })))
            .execute();
          return { ok: true, pendencyIds: [] as string[], process: locked.process } as const;
        }
        const opened = await trx
          .insertInto("pendencies")
          .values(
            chosen.map((pair) => ({
              processId,
              reason: "conflict" as const,
              questionId: pair.answer.question.id,
              conflictPairId: pair.id,
              conflictAssessmentId,
              openedBy: "user" as const,
            })),
          )
          .returning("id")
          .execute();
        return { ok: true, pendencyIds: opened.map((row) => row.id), process: locked.process } as const;
      });
      if (!decided.ok) return decided;
      await askResolutionQuestions(processId, decided.pendencyIds);
      return { ok: true, pendencies: await listPendencies(db, decided.process, decided.pendencyIds) };
    },

    async clarify(processId, pendencyId, clarification) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const pendency = await openConflictPendency(trx, processId, pendencyId);
        if (!pendency.ok) return pendency;
        await trx
          .updateTable("pendencies")
          .set((eb) => ({ resolvedAt: eb.fn<Date>("clock_timestamp"), resolution: "clarified" as const, clarification: clarification.trim() }))
          .where("id", "=", pendencyId)
          .execute();
        const [resolved] = await listPendencies(trx, locked.process, [pendencyId]);
        return { ok: true, pendency: resolved! } as const;
      });
    },

    async reviseConstraint(processId, pendencyId, { constraintId, replacement, note }) {
      const revised = await db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const pendency = await openConflictPendency(trx, processId, pendencyId);
        if (!pendency.ok) return pendency;
        const revision = await reviseConstraintIn(trx, locked.process, constraintId, { replacement, note, conflictPendencyId: pendencyId });
        if (!revision.ok) return revision;
        await trx
          .updateTable("pendencies")
          .set((eb) => ({ resolvedAt: eb.fn<Date>("clock_timestamp"), resolution: "constraint_revised" as const }))
          .where("id", "=", pendencyId)
          .execute();
        const [resolved] = await listPendencies(trx, locked.process, [pendencyId]);
        return { ok: true, pendency: resolved! } as const;
      });
      if (!revised.ok) return revised;
      await afterConstraintRevision(processId);
      return { ok: true, pendency: revised.pendency };
    },

    requestResolutionQuestion,
  };
}
