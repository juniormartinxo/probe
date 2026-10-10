import { sql } from "kysely";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequestRunner, type Attempt, type AttemptStatus, type OnCompleted } from "../ai/ai-requests.ts";
import type { Assistant, Cli, GeneratedOptions, KnownOption, OptionProposalInput } from "../ai/assistant.ts";
import { failureOnThrow, type Assessor, type AssessorOutcome, type OptionViolationInput, type Verdict } from "../assessments/assessor.ts";
import { verdictProblem } from "../assessments/impact-assessments.ts";
import { OPTION_RUBRIC_REVISION } from "../assessments/option-rubric.ts";
import type { SettingsModule } from "../settings/settings.ts";
import { constraintsAndPreferencesOf, inForceOf, statementsInForceOf, type StatedItem } from "./constraints-and-preferences.ts";
import { optionChecksOf, optionPairRowsOf, undecidedOptionStatuses, type OptionCheck, type OptionConstraintPair } from "./option-checks.ts";
import { confirmedStatementOf } from "./problem-statement.ts";
import { lockOpenProcess } from "./process.ts";
import { confirmedStagesOf } from "./stage-readiness.ts";
import { askedQuestionOf, currentVersionsOf, stageQuestions } from "./stage-questions.ts";
import { namedStagePoint, stagePointsOf } from "./stage-points.ts";
import type { Stage } from "./stage.ts";

// Opção: caminho concreto para o problema, registrado na Etapa O. A da IA é sugestão até o usuário
// aceitá-la (como veio ou editada) ou descartá-la; a do usuário já nasce aceita. Aceita, não se
// edita; descartada, fica no histórico.
export type OptionOrigin = "ai" | "user";

export type OptionStatus = "suggested" | "accepted" | "discarded";

export interface Option {
  id: string;
  statement: string;
  description: string | null;
  // As perspectivas da Etapa O que a Opção representa, se alguma.
  stagePoints: { key: string; name: string }[];
  origin: OptionOrigin;
  // A sugestão como a IA a fez, que o texto que vale pode ter editado; null na do usuário.
  suggestion: { statement: string; description: string | null } | null;
  status: OptionStatus;
  createdAt: Date;
  acceptedAt: Date | null;
  discardedAt: Date | null;
  // Só nas aceitas: viável, inviável (viola uma Restrição em vigor) ou ainda sem decisão.
  viability: OptionViability | null;
  // As Restrições em vigor que a Opção viola.
  violations: OptionViolation[];
}

export type OptionViability = "viable" | "inviable" | "undecided";

export interface OptionViolation {
  constraintId: string;
  statement: string;
  // Quem decidiu a violação: o Jev, com confiança, ou o usuário.
  decidedBy: "jev" | "user";
}

// Proposta de Opções pedida à IA; `optionIds` são as Opções que a tentativa concluída sugeriu.
export interface OptionProposal {
  id: string;
  status: AttemptStatus;
  optionIds: string[];
  attempts: Attempt[];
}

const PROPOSAL_OPERATION = "propose_options";

// A Etapa em que as Opções são registradas.
const OPTIONS_STAGE = "O";

type ProposalClosed = "process_not_found" | "process_not_open" | "stage_not_current";

export type OptionProposalError = ProposalClosed | "option_proposal_already_requested" | "cli_model_not_configured";

export type NewProposalAttemptError =
  | ProposalClosed
  | "option_proposal_not_found"
  | "attempt_in_progress"
  | "options_proposed"
  | "cli_model_not_configured";

// O que o usuário diz de uma Opção: ao acrescentá-la, ou ao aceitar uma sugestão editada.
export interface OptionStatement {
  statement: string;
  description: string | null;
}

export interface UserOption extends OptionStatement {
  stagePoints: string[];
}

type OptionClosed = ProposalClosed | "option_not_found";

export type OptionAdditionError = ProposalClosed | "invalid_stage_points";

export type OptionAcceptanceError = OptionClosed | "option_not_suggested";

export type OptionDiscardError = OptionClosed | "option_discarded";

type CheckError = "process_not_found" | "process_not_open" | "option_check_not_found";

export type OptionRetryError = CheckError | "option_check_assessed";

export type OptionDecisionError = CheckError | "option_pair_not_found" | "option_pair_decided" | "assessment_required" | "unknown_assessment";

// O que o usuário decide sobre pares em que o Jev não teve certeza ou não respondeu, sobre a
// Avaliação que ele viu: a Opção viola a Restrição ou a cumpre.
export interface OptionDecision {
  optionAssessmentId: string;
  pairIds: string[];
  decision: "violates" | "complies";
}

export interface Options {
  // Pede à IA Opções para o problema, enquanto a Etapa O é a atual.
  requestProposal(processId: string): Promise<{ ok: true; optionProposal: OptionProposal } | { ok: false; error: OptionProposalError }>;
  // Nova tentativa da mesma proposta, depois de uma que não trouxe Opções. Sem `cli`, com a CLI da
  // tentativa anterior; com ela, com a que o usuário escolheu.
  newProposalAttempt(
    processId: string,
    proposalId: string,
    cli?: Cli,
  ): Promise<{ ok: true; optionProposal: OptionProposal } | { ok: false; error: NewProposalAttemptError }>;
  // Acrescenta uma Opção do usuário, já aceita.
  add(processId: string, option: UserOption): Promise<{ ok: true; option: Option } | { ok: false; error: OptionAdditionError }>;
  // Aceita uma sugestão da IA, como veio ou com o texto editado.
  accept(
    processId: string,
    optionId: string,
    edited: OptionStatement | null,
  ): Promise<{ ok: true; option: Option } | { ok: false; error: OptionAcceptanceError }>;
  // Descarta uma Opção, sugerida ou aceita; ela fica no histórico.
  discard(processId: string, optionId: string): Promise<{ ok: true; option: Option } | { ok: false; error: OptionDiscardError }>;
  // Forma os pares de Opções aceitas e Restrições em vigor ainda não avaliados e pede ao Jev a
  // Avaliação deles: depois de uma Opção aceita e de uma Revisão de Restrição. Não lança: uma falha
  // fica no log.
  assessMissing(processId: string): Promise<void>;
  // Nova tentativa, quando a Avaliação de violação falhou (ou se perdeu).
  retry(processId: string, checkId: string): Promise<{ ok: true; optionCheck: OptionCheck } | { ok: false; error: OptionRetryError }>;
  decide(
    processId: string,
    checkId: string,
    decision: OptionDecision,
  ): Promise<{ ok: true; optionCheck: OptionCheck } | { ok: false; error: OptionDecisionError }>;
}

const optionStatus = (row: { acceptedAt: Date | null; discardedAt: Date | null }): OptionStatus =>
  row.discardedAt !== null ? "discarded" : row.acceptedAt !== null ? "accepted" : "suggested";

// A viabilidade de uma Opção aceita, pelos pares dela com cada Restrição em vigor: inviável se viola
// alguma, sem decisão se algum par ainda espera o Jev ou o usuário (ou nem foi formado), viável se
// cumpre todas. Nenhuma vantagem em outra dimensão entra na conta (ADR 0006).
function viabilityOf(
  optionId: string,
  pairs: OptionConstraintPair[],
  constraintsInForce: StatedItem[],
): { viability: OptionViability; violations: OptionViolation[] } {
  const own = constraintsInForce.map((constraint) => ({
    constraint,
    pair: pairs.find((pair) => pair.option.id === optionId && pair.constraint.id === constraint.id),
  }));
  const violations = own.flatMap(({ constraint, pair }) =>
    pair?.status === "violates" ? [{ constraintId: constraint.id, statement: constraint.statement, decidedBy: pair.decidedBy! }] : [],
  );
  if (violations.length > 0) return { viability: "inviable", violations };
  const undecided = own.some(({ pair }) => !pair || undecidedOptionStatuses.includes(pair.status));
  return { viability: undecided ? "undecided" : "viable", violations };
}

// As Opções do Processo, na ordem em que foram registradas, inclusive as descartadas.
export async function optionsOf(db: Db, process: { id: string; stagePointsVersion: number }): Promise<Option[]> {
  const rows = await db
    .selectFrom("options")
    .selectAll()
    .where("processId", "=", process.id)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  if (rows.length === 0) return [];
  const pairs = (await optionChecksOf(db, process.id)).flatMap((check) => check.pairs);
  const { constraints } = inForceOf(await constraintsAndPreferencesOf(db, process.id));
  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    description: row.description,
    stagePoints: row.stagePoints.map((key) => namedStagePoint(process.stagePointsVersion, OPTIONS_STAGE, key)),
    origin: row.origin,
    suggestion: row.suggestedStatement === null ? null : { statement: row.suggestedStatement, description: row.suggestedDescription },
    status: optionStatus(row),
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    discardedAt: row.discardedAt,
    ...(optionStatus(row) === "accepted" ? viabilityOf(row.id, pairs, constraints) : { viability: null, violations: [] }),
  }));
}

// A Opção como a IA a recebe: o estado e as Restrições que ela viola.
export const knownOptionOf = ({ statement, description, status, violations }: Option): KnownOption => ({
  statement,
  description,
  status,
  violatedConstraints: violations.map((violation) => violation.statement),
});

const optionalText = (value: string | null): string | null => value?.trim() || null;

// Trava o Processo aberto na Etapa O para a transação: as Opções só mudam enquanto ela é a atual.
async function lockStageO(trx: Db, processId: string) {
  const locked = await lockOpenProcess(trx, processId);
  if (!locked.ok) return locked;
  if (locked.process.currentStage !== OPTIONS_STAGE) return { ok: false, error: "stage_not_current" } as const;
  return locked;
}

// A Opção do Processo, para mudá-la; chamar com o Processo travado.
async function optionIn(trx: Db, process: { id: string; stagePointsVersion: number }, optionId: string) {
  const option = (await optionsOf(trx, process)).find((item) => item.id === optionId);
  return option ? ({ ok: true, option } as const) : ({ ok: false, error: "option_not_found" } as const);
}

// Impedimento de uma Opção aceita: as Restrições em vigor que ela viola.
export interface OptionImpediment {
  option: { id: string; statement: string };
  violations: OptionViolation[];
}

// O que segura a Confirmação da Etapa O: sugestões da IA ainda sem resposta do usuário (ou uma
// proposta em andamento), pares Opção × Restrição sem decisão ou nenhuma Opção viável, com os
// impedimentos de cada Opção aceita. Null quando as Opções não seguram nada (ADR 0006).
export type OptionsNotReady =
  | { error: "pending_option_suggestions" }
  | { error: "undecided_options" }
  | { error: "no_viable_option"; impediments: OptionImpediment[] };

export async function optionsBlockingStage(
  db: Db,
  process: { id: string; stagePointsVersion: number },
  stage: Stage,
): Promise<OptionsNotReady | null> {
  if (stage !== OPTIONS_STAGE) return null;
  const all = await optionsOf(db, process);
  const proposing = (await listAiRequests(db, process.id, PROPOSAL_OPERATION)).some((request) => request.status === "running");
  if (proposing || all.some((option) => option.status === "suggested")) return { error: "pending_option_suggestions" };
  const accepted = all.filter((option) => option.status === "accepted");
  if (accepted.some((option) => option.viability === "undecided")) return { error: "undecided_options" };
  if (accepted.some((option) => option.viability === "viable")) return null;
  return {
    error: "no_viable_option",
    impediments: accepted.map(({ id, statement, violations }) => ({ option: { id, statement }, violations })),
  };
}

// As propostas de Opções do Processo, na ordem em que foram pedidas.
export async function optionProposalsOf(db: Db, processId: string): Promise<OptionProposal[]> {
  const requests = await listAiRequests<GeneratedOptions>(db, processId, PROPOSAL_OPERATION);
  const suggested = await db
    .selectFrom("options")
    .select(["id", "proposalAttemptId"])
    .where("processId", "=", processId)
    .where("origin", "=", "ai")
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  return requests.map(({ id, status, attempts, result }) => ({
    id,
    status,
    optionIds: suggested.filter((option) => option.proposalAttemptId === result?.attemptId).map((option) => option.id),
    attempts,
  }));
}

interface PreparedProposal {
  input: OptionProposalInput;
  // As Versões de resposta que o pedido envia à IA: as confirmadas das Etapas anteriores e as da Etapa O.
  usedVersionIds: string[];
}

// O que a IA recebe para propor Opções; chamar com o Processo travado.
async function prepareProposal(trx: Db, process: { id: string; stagePointsVersion: number }): Promise<PreparedProposal> {
  const { originalDescription } = await trx
    .selectFrom("processes")
    .select("originalDescription")
    .where("id", "=", process.id)
    .executeTakeFirstOrThrow();
  const questions = await stageQuestions(trx, process.id, OPTIONS_STAGE);
  const options = await optionsOf(trx, process);
  return {
    input: {
      originalDescription,
      problemStatement: await confirmedStatementOf(trx, process.id),
      confirmedStages: await confirmedStagesOf(trx, process.id, OPTIONS_STAGE),
      ...(await statementsInForceOf(trx, process.id)),
      stagePoints: stagePointsOf(process.stagePointsVersion, OPTIONS_STAGE),
      askedQuestions: questions.map(askedQuestionOf),
      options: options.map(knownOptionOf),
    },
    usedVersionIds: currentVersionsOf(questions),
  };
}

// Grava as Opções que a tentativa concluída sugeriu, na ordem em que a IA as propôs.
const saveSuggestions =
  (processId: string): OnCompleted<GeneratedOptions> =>
  async (trx, attemptId, { options }) => {
    if (options.length === 0) return;
    await trx
      .insertInto("options")
      .values(
        options.map(({ statement, description, stagePoints }) => ({
          processId,
          statement,
          description,
          stagePoints,
          origin: "ai" as const,
          proposalAttemptId: attemptId,
          suggestedStatement: statement,
          suggestedDescription: description,
          acceptedAt: null,
          discardedAt: null,
        })),
      )
      .execute();
  };

const pairKey = (position: number) => `par_${position}`;

// O que o Jev recebe sobre os pares da verificação: a Opção pela ordem em que foi registrada no Processo
// ("O1") e a Restrição também ("R1").
async function violationInputOf(db: Db, processId: string, checkId: string): Promise<{ input: OptionViolationInput; pairIds: Map<string, string> }> {
  const rows = await optionPairRowsOf(db, processId);
  const optionIds = (await db.selectFrom("options").select("id").where("processId", "=", processId).orderBy("createdAt").orderBy("id").execute()).map(
    (row) => row.id,
  );
  const constraintIds = (await constraintsAndPreferencesOf(db, processId)).constraints.map((item) => item.id);
  const own = rows.filter((row) => row.checkId === checkId);
  return {
    input: {
      problemStatement: await confirmedStatementOf(db, processId),
      pairs: own.map((row) => ({
        key: pairKey(row.position),
        option: { ref: `O${optionIds.indexOf(row.optionId) + 1}`, statement: row.optionStatement, description: row.optionDescription },
        constraint: { ref: `R${constraintIds.indexOf(row.constraintId) + 1}`, statement: row.constraintStatement, scope: row.scope, unit: row.unit },
      })),
    },
    pairIds: new Map(own.map((row) => [pairKey(row.position), row.id])),
  };
}

export function options(deps: {
  db: Db;
  assistant: Assistant;
  assessor: Assessor;
  runner: AiRequestRunner;
  settings: SettingsModule;
  log: FastifyBaseLogger;
}): Options {
  const { db, assistant, assessor, runner, settings, log } = deps;

  // Um julgamento válido para cada par, ou a falha, qualquer que seja o Assessor.
  async function judge(input: OptionViolationInput): Promise<AssessorOutcome<Record<string, Verdict>>> {
    const outcome = await failureOnThrow(() => assessor.assessOptions(input));
    if (outcome.status !== "completed") return outcome;
    for (const { key } of input.pairs) {
      const verdict = outcome.result[key];
      const problem = verdict ? verdictProblem(verdict) : "O Jev não julgou todos os pares.";
      if (problem) return { status: "failed", reason: "invalid_output", message: problem };
    }
    return outcome;
  }

  // Chama o Jev fora da transação (o Processo não fica travado enquanto ele responde) e grava a
  // Avaliação, concluída ou falha.
  async function assess(processId: string, checkId: string): Promise<{ ok: true } | { ok: false; error: CheckError }> {
    const { input, pairIds } = await violationInputOf(db, processId, checkId);
    const outcome = await judge(input);
    return db.transaction().execute(async (trx) => {
      const locked = await lockOpenProcess(trx, processId);
      if (!locked.ok) return locked;
      const { id } = await trx
        .insertInto("optionAssessments")
        .values({
          processId,
          checkId,
          status: outcome.status,
          requestedModel: assessor.model,
          jevModel: outcome.status === "completed" ? outcome.model : null,
          rubricRevision: OPTION_RUBRIC_REVISION,
          failureReason: outcome.status === "failed" ? outcome.reason : null,
          message: outcome.status === "failed" ? outcome.message : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (outcome.status === "completed") {
        await trx
          .insertInto("optionVerdicts")
          .values(
            input.pairs.map(({ key }) => {
              const { choice, confidence, probabilities } = outcome.result[key]!;
              return { assessmentId: id, pairId: pairIds.get(key)!, choice, confidence, probabilities: JSON.stringify(probabilities) };
            }),
          )
          .execute();
      }
      return { ok: true } as const;
    });
  }

  async function assessMissing(processId: string): Promise<void> {
    try {
      const checkId = await db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return null;
        const accepted = (await optionsOf(trx, locked.process)).filter((option) => option.status === "accepted");
        const { constraints } = inForceOf(await constraintsAndPreferencesOf(trx, processId));
        // Avaliados uma vez: cada par é formado quando a Opção é aceita ou a Restrição entra em vigor.
        const formed = new Set((await optionPairRowsOf(trx, processId)).map((row) => `${row.optionId}:${row.constraintId}`));
        const missing = accepted.flatMap((option) =>
          constraints.filter((constraint) => !formed.has(`${option.id}:${constraint.id}`)).map((constraint) => [option.id, constraint.id] as const),
        );
        if (missing.length === 0) return null;
        const { id } = await trx.insertInto("optionChecks").values({ processId }).returning("id").executeTakeFirstOrThrow();
        await trx
          .insertInto("optionConstraintPairs")
          .values(missing.map(([optionId, constraintId], position) => ({ checkId: id, position, optionId, constraintId })))
          .execute();
        return id;
      });
      if (checkId) await assess(processId, checkId);
    } catch (error) {
      // A verificação gravada fica "não avaliada", e o usuário pede uma nova tentativa.
      log.error({ err: error, processId }, "Não foi possível avaliar as Opções contra as Restrições.");
    }
  }

  // A Opção depois de avaliada contra as Restrições em vigor.
  async function assessed(processId: string, optionId: string): Promise<{ ok: true; option: Option }> {
    await assessMissing(processId);
    const process = await db.selectFrom("processes").select(["id", "stagePointsVersion"]).where("id", "=", processId).executeTakeFirstOrThrow();
    return { ok: true, option: (await optionsOf(db, process)).find((option) => option.id === optionId)! };
  }

  // Os Pontos são da aplicação, não da IA (ADR 0002): uma Opção ligada a um Ponto fora da Etapa O é
  // recusada, qualquer que seja a implementação do Assistant.
  async function propose(input: OptionProposalInput, context: Parameters<Assistant["proposeOptions"]>[1]) {
    const outcome = await assistant.proposeOptions(input, context);
    if (outcome.status !== "completed") return outcome;
    const keys = new Set(input.stagePoints.map((point) => point.key));
    const outside = outcome.result.options.flatMap((option) => option.stagePoints).filter((key) => !keys.has(key));
    if (outside.length === 0) return outcome;
    return {
      status: "failed",
      reason: "invalid_output",
      message: `A IA indicou Pontos que não são da Etapa O: ${outside.join(", ")}.`,
      usage: outcome.usage,
    } as const;
  }

  // Abre uma tentativa, com o Processo travado na Etapa O até a transação terminar, e só depois de
  // gravá-la dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    prepare: (trx: Db) => Promise<{ ok: true; aiRequestId: string; cli?: Cli } | { ok: false; error: E }>,
  ): Promise<{ ok: true; optionProposal: OptionProposal } | { ok: false; error: E | ProposalClosed | "cli_model_not_configured" }> {
    const opened = await db.transaction().execute(async (trx) => {
      const locked = await lockStageO(trx, processId);
      if (!locked.ok) return locked;
      const ready = await prepare(trx);
      if (!ready.ok) return ready;
      const attemptSettings = await settings.forNewAttempt(trx, ready.cli);
      if (!attemptSettings.ok) return attemptSettings;
      const prepared = await prepareProposal(trx, locked.process);
      const attempt = await runner.openAttempt(trx, ready.aiRequestId, attemptSettings.settings, prepared.usedVersionIds);
      return { ok: true, attempt, aiRequestId: ready.aiRequestId, input: prepared.input } as const;
    });
    if (!opened.ok) return opened;
    try {
      // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
      const optionProposal = (await optionProposalsOf(db, processId)).find((proposal) => proposal.id === opened.aiRequestId)!;
      return { ok: true, optionProposal };
    } finally {
      // Aberta, a tentativa sempre segue, mesmo que a leitura falhe: nunca fica "running" à toa.
      runner.run(opened.attempt, (context) => propose(opened.input, context), saveSuggestions(processId));
    }
  }

  return {
    async requestProposal(processId) {
      return startAttempt(processId, async (trx) => {
        // Uma proposta que ainda não trouxe Opções segue com novas tentativas, não com outra proposta.
        const requests = await listAiRequests(trx, processId, PROPOSAL_OPERATION);
        if (requests.some((request) => request.status !== "completed")) {
          return { ok: false, error: "option_proposal_already_requested" } as const;
        }
        const request = await trx
          .insertInto("aiRequests")
          .values({ processId, operation: PROPOSAL_OPERATION, blockId: null })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, aiRequestId: request.id } as const;
      });
    },

    async add(processId, { statement, description, stagePoints }) {
      const added = await db.transaction().execute(async (trx) => {
        const locked = await lockStageO(trx, processId);
        if (!locked.ok) return locked;
        const keys = new Set(stagePointsOf(locked.process.stagePointsVersion, OPTIONS_STAGE).map((point) => point.key));
        if (stagePoints.some((key) => !keys.has(key))) return { ok: false, error: "invalid_stage_points" } as const;
        const { id } = await trx
          .insertInto("options")
          .values({
            processId,
            statement: statement.trim(),
            description: optionalText(description),
            stagePoints: [...new Set(stagePoints)],
            origin: "user",
            proposalAttemptId: null,
            suggestedStatement: null,
            suggestedDescription: null,
            acceptedAt: sql<Date>`clock_timestamp()`,
            discardedAt: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, id } as const;
      });
      if (!added.ok) return added;
      return assessed(processId, added.id);
    },

    async accept(processId, optionId, edited) {
      const accepted = await db.transaction().execute(async (trx) => {
        const locked = await lockStageO(trx, processId);
        if (!locked.ok) return locked;
        const found = await optionIn(trx, locked.process, optionId);
        if (!found.ok) return found;
        if (found.option.status !== "suggested") return { ok: false, error: "option_not_suggested" } as const;
        await trx
          .updateTable("options")
          .set({
            acceptedAt: sql<Date>`clock_timestamp()`,
            ...(edited && { statement: edited.statement.trim(), description: optionalText(edited.description) }),
          })
          .where("id", "=", optionId)
          .execute();
        return { ok: true } as const;
      });
      if (!accepted.ok) return accepted;
      return assessed(processId, optionId);
    },

    async discard(processId, optionId) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageO(trx, processId);
        if (!locked.ok) return locked;
        const found = await optionIn(trx, locked.process, optionId);
        if (!found.ok) return found;
        if (found.option.status === "discarded") return { ok: false, error: "option_discarded" } as const;
        await trx.updateTable("options").set({ discardedAt: sql<Date>`clock_timestamp()` }).where("id", "=", optionId).execute();
        return optionIn(trx, locked.process, optionId);
      });
    },

    assessMissing,

    async retry(processId, checkId) {
      const process = await db.selectFrom("processes").select("status").where("id", "=", processId).executeTakeFirst();
      if (!process) return { ok: false, error: "process_not_found" };
      if (process.status !== "open") return { ok: false, error: "process_not_open" };
      const check = (await optionChecksOf(db, processId)).find((item) => item.id === checkId);
      if (!check) return { ok: false, error: "option_check_not_found" };
      if (check.status !== "not_assessed" && check.status !== "assessment_failed") return { ok: false, error: "option_check_assessed" };
      const done = await assess(processId, checkId);
      if (!done.ok) return done;
      return { ok: true, optionCheck: (await optionChecksOf(db, processId)).find((item) => item.id === checkId)! };
    },

    async decide(processId, checkId, { optionAssessmentId, pairIds, decision }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        const check = (await optionChecksOf(trx, processId)).find((item) => item.id === checkId);
        if (!check) return { ok: false, error: "option_check_not_found" } as const;
        const last = check.assessments.at(-1);
        if (!last) return { ok: false, error: "assessment_required" } as const;
        // A decisão vale sobre a Avaliação que o usuário viu, e a mais recente.
        if (last.id !== optionAssessmentId) return { ok: false, error: "unknown_assessment" } as const;
        const pairs = [...new Set(pairIds)].map((pairId) => check.pairs.find((pair) => pair.id === pairId));
        if (pairs.some((pair) => !pair)) return { ok: false, error: "option_pair_not_found" } as const;
        const chosen = pairs as OptionConstraintPair[];
        if (chosen.some((pair) => pair.status !== "awaiting_decision" && pair.status !== "assessment_failed")) {
          return { ok: false, error: "option_pair_decided" } as const;
        }
        await trx
          .insertInto("optionDecisions")
          .values(chosen.map((pair) => ({ pairId: pair.id, optionAssessmentId, violates: decision === "violates" })))
          .execute();
        return { ok: true, optionCheck: (await optionChecksOf(trx, processId)).find((item) => item.id === checkId)! } as const;
      });
    },

    async newProposalAttempt(processId, proposalId, cli) {
      return startAttempt(processId, async (trx) => {
        const request = (await listAiRequests(trx, processId, PROPOSAL_OPERATION)).find(({ id }) => id === proposalId);
        if (!request) return { ok: false, error: "option_proposal_not_found" } as const;
        if (request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (request.status === "completed") return { ok: false, error: "options_proposed" } as const;
        return { ok: true, aiRequestId: request.id, cli: cli ?? request.attempts.at(-1)!.cli } as const;
      });
    },
  };
}
