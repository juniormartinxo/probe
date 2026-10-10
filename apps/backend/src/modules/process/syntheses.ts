import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequest, type AiRequestRunner, type Attempt, type AttemptStatus } from "../ai/ai-requests.ts";
import type { Assistant, AssistantOutcome, AttemptContext, Cli, GeneratedSynthesis, SynthesisInput } from "../ai/assistant.ts";
import { synthesisProblem } from "../ai/synthesize-block.ts";
import type { SettingsModule } from "../settings/settings.ts";
import { openStagePointsOf, type ProcessPoints } from "./stage-point-coverage.ts";
import { constraintsAndPreferencesOf, hasAny, inForceOf, type ItemsRequired } from "./constraints-and-preferences.ts";
import { confirmedStagesOf } from "./stage-readiness.ts";
import { askedQuestionOf, currentVersionsOf, stageQuestions } from "./stage-questions.ts";
import { findStagePoint, namedStagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";

// Como a síntese confirmada nasceu: aceita como a IA propôs ou corrigida pelo usuário.
export type SynthesisOrigin = "proposal" | "corrected";

type NamedStagePoint = ReturnType<typeof namedStagePoint>;

// Proposta de síntese da IA: sugestão até o usuário confirmá-la. O id é o da tentativa que a
// produziu. `outdated`: uma resposta do Bloco mudou depois que a IA a recebeu; a proposta não pode
// mais ser confirmada, e uma nova síntese pode ser pedida.
export interface SynthesisProposal {
  id: string;
  synthesis: string;
  coverage: { stagePoint: NamedStagePoint; covered: boolean; reason: string }[];
  ambiguousAnswers: { questionId: string; reason: string }[];
  outdated: boolean;
}

export interface SynthesisRequest {
  id: string;
  status: AttemptStatus;
  proposal: SynthesisProposal | null;
  attempts: Attempt[];
}

// Texto da síntese corrigido pelo usuário ao reconfirmá-la, numa Pendência de reavaliação.
export interface SynthesisCorrection {
  synthesis: string;
  correctedAt: Date;
}

// Confirmação da síntese de bloco: confirma em conjunto as respostas que a proposta sintetizou e os
// Pontos que o usuário deu por cobertos. `synthesis` é o texto confirmado; as correções feitas ao
// reconfirmá-la vêm na ordem, e a última é a que vale.
export interface ConfirmedSynthesis {
  synthesis: string;
  origin: SynthesisOrigin;
  proposalId: string;
  confirmedAt: Date;
  coveredStagePoints: NamedStagePoint[];
  corrections: SynthesisCorrection[];
}

// O texto da síntese confirmada que vale: a última correção, ou o confirmado.
export const synthesisInForce = ({ synthesis, corrections }: Pick<ConfirmedSynthesis, "synthesis" | "corrections">): string =>
  corrections.at(-1)?.synthesis ?? synthesis;

// As correções de síntese de cada Bloco, na ordem.
export async function synthesisCorrectionsOf(db: Db, blockIds: string[]): Promise<Map<string, SynthesisCorrection[]>> {
  const found = new Map<string, SynthesisCorrection[]>(blockIds.map((id) => [id, []]));
  if (blockIds.length === 0) return found;
  const rows = await db
    .selectFrom("confirmationAnswerVersions")
    .select(["blockId", "correctedSynthesis", "recordedAt"])
    .where("blockId", "in", blockIds)
    .where("correctedSynthesis", "is not", null)
    .orderBy("recordedAt")
    .orderBy("id")
    .execute();
  for (const row of rows) found.get(row.blockId!)!.push({ synthesis: row.correctedSynthesis!, correctedAt: row.recordedAt });
  return found;
}

export interface BlockSynthesisState {
  synthesis: ConfirmedSynthesis | null;
  synthesisRequests: SynthesisRequest[];
}

// O texto que o usuário confirmou, a proposta que ele viu e os Pontos que ele dá por cobertos.
export interface SynthesisConfirmation {
  proposalId: string;
  synthesis: string;
  coveredStagePoints: string[];
}

type BlockClosed = "process_not_found" | "process_not_open" | "block_not_found" | "synthesis_confirmed";

export type SynthesisRequestError =
  | BlockClosed
  | "block_incomplete"
  | "synthesis_already_requested"
  | "cli_model_not_configured";

export type NewSynthesisAttemptError =
  | BlockClosed
  | "block_incomplete"
  | "synthesis_request_not_found"
  | "attempt_in_progress"
  | "synthesis_generated"
  | "cli_model_not_configured";

export type SynthesisConfirmationError =
  | BlockClosed
  | "unknown_synthesis"
  | "synthesis_outdated"
  | "invalid_coverage"
  | ItemsRequired;

export interface Syntheses {
  // Pede à IA a síntese de um Bloco cujas Perguntas foram todas respondidas ou declaradas desconhecidas.
  request(
    processId: string,
    blockId: string,
  ): Promise<{ ok: true; synthesisRequest: SynthesisRequest } | { ok: false; error: SynthesisRequestError }>;
  // Nova tentativa da mesma solicitação. Sem `cli`, com a CLI da tentativa anterior; com ela, com a
  // que o usuário escolheu.
  newAttempt(
    processId: string,
    blockId: string,
    requestId: string,
    cli?: Cli,
  ): Promise<{ ok: true; synthesisRequest: SynthesisRequest } | { ok: false; error: NewSynthesisAttemptError }>;
  confirm(
    processId: string,
    blockId: string,
    confirmation: SynthesisConfirmation,
  ): Promise<{ ok: true; synthesis: ConfirmedSynthesis } | { ok: false; error: SynthesisConfirmationError }>;
}

const OPERATION = "synthesize_block";

interface LockedBlock {
  stage: Stage;
  stagePointsVersion: number;
  input: SynthesisInput;
  // As Versões que valem nas Perguntas enviadas à IA: as do Bloco e as dos Blocos anteriores.
  currentVersionIds: string[];
  complete: boolean;
}

// Trava o Processo para a transação, encontra nele o Bloco ainda sem síntese confirmada e monta o
// que a IA recebe para sintetizá-lo.
async function lockBlock(
  trx: Db,
  processId: string,
  blockId: string,
): Promise<{ ok: true; block: LockedBlock } | { ok: false; error: BlockClosed }> {
  const process = await trx
    .selectFrom("processes")
    .select(["id", "status", "stagePointsVersion", "originalDescription"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  const block = await trx
    .selectFrom("blocks")
    .select(["number", "stage"])
    .where("id", "=", blockId)
    .where("processId", "=", processId)
    .executeTakeFirst();
  if (!block) return { ok: false, error: "block_not_found" };
  const confirmed = await trx.selectFrom("blockSyntheses").select("blockId").where("blockId", "=", blockId).executeTakeFirst();
  if (confirmed) return { ok: false, error: "synthesis_confirmed" };
  // Um Bloco só existe depois da Confirmação do enunciado.
  const { statement } = await trx
    .selectFrom("problemStatements")
    .select("statement")
    .where("processId", "=", processId)
    .executeTakeFirstOrThrow();
  const questions = (await stageQuestions(trx, processId, block.stage)).filter(
    (question) => question.blockNumber <= block.number,
  );
  const own = questions.filter((question) => question.blockId === blockId);
  return {
    ok: true,
    block: {
      stage: block.stage,
      stagePointsVersion: process.stagePointsVersion,
      input: {
        stage: block.stage,
        originalDescription: process.originalDescription,
        problemStatement: statement,
        confirmedStages: await confirmedStagesOf(trx, processId, block.stage),
        openStagePoints: await openStagePointsOf(trx, process, block.stage),
        blockNumber: block.number,
        questions: own.map(askedQuestionOf),
        earlierQuestions: questions.filter((question) => question.blockId !== blockId).map(askedQuestionOf),
      },
      currentVersionIds: currentVersionsOf(questions),
      complete: own.every((question) => question.currentVersionId !== null || question.unknown),
    },
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));

// As Versões que cada tentativa enviou à IA.
async function usedVersionsOf(db: Db, attemptIds: string[]): Promise<Map<string, string[]>> {
  const used = new Map<string, string[]>(attemptIds.map((id) => [id, []]));
  if (attemptIds.length === 0) return used;
  const rows = await db
    .selectFrom("attemptAnswerVersions")
    .select(["attemptId", "answerVersionId"])
    .where("attemptId", "in", attemptIds)
    .execute();
  for (const row of rows) used.get(row.attemptId)!.push(row.answerVersionId);
  return used;
}

interface BlockOfProcess {
  id: string;
  number: number;
  stage: Stage;
}

// Estado da síntese de cada Bloco: a Confirmação, se houver, e as solicitações à IA, na ordem.
export async function synthesesOf(
  db: Db,
  process: ProcessPoints,
  blocks: BlockOfProcess[],
): Promise<Map<string, BlockSynthesisState>> {
  const states = new Map<string, BlockSynthesisState>();
  if (blocks.length === 0) return states;
  const stagesOfBlocks = [...new Set(blocks.map((block) => block.stage))];
  const questionsByStage = new Map(
    await Promise.all(stagesOfBlocks.map(async (stage) => [stage, await stageQuestions(db, process.id, stage)] as const)),
  );
  const requests = await listRequestsByBlock(db, process.id);
  const confirmedRows = await db
    .selectFrom("blockSyntheses")
    .select(["blockId", "synthesis", "origin", "proposalId", "confirmedAt"])
    .where(
      "blockId",
      "in",
      blocks.map((block) => block.id),
    )
    .execute();
  const coverageRows = await db
    .selectFrom("stagePointCoverage")
    .select(["blockId", "stagePoint"])
    .where("processId", "=", process.id)
    .where("status", "=", "covered")
    .execute();
  const corrections = await synthesisCorrectionsOf(
    db,
    blocks.map((block) => block.id),
  );
  const proposalIds = [...requests.values()].flat().flatMap((request) => (request.result ? [request.result.attemptId] : []));
  const used = await usedVersionsOf(db, proposalIds);

  for (const block of blocks) {
    const pointRef = (key: string) => namedStagePoint(process.stagePointsVersion, block.stage, key);
    // O que a síntese do Bloco recebe: as Perguntas dele e as dos Blocos anteriores da Etapa.
    const sent = questionsByStage.get(block.stage)!.filter((question) => question.blockNumber <= block.number);
    const own = sent.filter((question) => question.blockId === block.id);
    const current = currentVersionsOf(sent);
    const refToId = (ref: string) => own.find((question) => question.ref === ref)?.id ?? ref;
    const confirmed = confirmedRows.find((row) => row.blockId === block.id);
    states.set(block.id, {
      synthesis: confirmed
        ? {
            synthesis: confirmed.synthesis,
            origin: confirmed.origin,
            proposalId: confirmed.proposalId,
            confirmedAt: confirmed.confirmedAt,
            coveredStagePoints: coverageRows.filter((row) => row.blockId === block.id).map((row) => pointRef(row.stagePoint)),
            corrections: corrections.get(block.id)!,
          }
        : null,
      synthesisRequests: (requests.get(block.id) ?? []).map(({ id, status, attempts, result }) => ({
        id,
        status,
        attempts,
        proposal: result && {
          id: result.attemptId,
          synthesis: result.value.synthesis,
          coverage: result.value.coverage.map(({ stagePoint, covered, reason }) => ({
            stagePoint: pointRef(stagePoint),
            covered,
            reason,
          })),
          ambiguousAnswers: result.value.ambiguousAnswers.map(({ question, reason }) => ({
            questionId: refToId(question),
            reason,
          })),
          // Depois da Confirmação, a proposta confirmada é a que vale; mudanças posteriores são
          // assunto da reavaliação.
          outdated: !confirmed && !sameSet(used.get(result.attemptId)!, current),
        },
      })),
    });
  }
  return states;
}

async function listRequestsByBlock(db: Db, processId: string): Promise<Map<string, AiRequest<GeneratedSynthesis>[]>> {
  const owners = await db
    .selectFrom("aiRequests")
    .select(["id", "blockId"])
    .where("processId", "=", processId)
    .where("operation", "=", OPERATION)
    .execute();
  const requests = await listAiRequests<GeneratedSynthesis>(db, processId, OPERATION);
  const byBlock = new Map<string, AiRequest<GeneratedSynthesis>[]>();
  for (const request of requests) {
    const blockId = owners.find((owner) => owner.id === request.id)!.blockId!;
    byBlock.set(blockId, [...(byBlock.get(blockId) ?? []), request]);
  }
  return byBlock;
}

export function syntheses(deps: { db: Db; assistant: Assistant; runner: AiRequestRunner; settings: SettingsModule }): Syntheses {
  const { db, assistant, runner, settings } = deps;

  async function findRequest(processId: string, blockId: string, requestId: string): Promise<SynthesisRequest> {
    const block = await db
      .selectFrom("blocks")
      .select(["id", "number", "stage"])
      .where("id", "=", blockId)
      .executeTakeFirstOrThrow();
    const process = await db
      .selectFrom("processes")
      .select(["id", "stagePointsVersion"])
      .where("id", "=", processId)
      .executeTakeFirstOrThrow();
    const states = await synthesesOf(db, process, [block]);
    return states.get(blockId)!.synthesisRequests.find((request) => request.id === requestId)!;
  }

  // Os Pontos são da aplicação, não da IA (ADR 0002): uma síntese que sugira cobertura fora dos
  // Pontos abertos, ou deixe algum sem sugestão, é recusada, qualquer que seja a implementação.
  async function synthesize(input: SynthesisInput, context: AttemptContext): Promise<AssistantOutcome<GeneratedSynthesis>> {
    const outcome = await assistant.synthesizeBlock(input, context);
    if (outcome.status !== "completed") return outcome;
    const problem = synthesisProblem(input, outcome.result);
    if (!problem) return outcome;
    return { status: "failed", reason: "invalid_output", message: problem, usage: outcome.usage };
  }

  // Abre uma tentativa, com o Processo travado até a transação terminar, e só depois de gravá-la
  // dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    blockId: string,
    prepare: (trx: Db, block: LockedBlock) => Promise<{ ok: true; aiRequestId: string; cli?: Cli } | { ok: false; error: E }>,
  ): Promise<
    | { ok: true; synthesisRequest: SynthesisRequest }
    | { ok: false; error: E | BlockClosed | "block_incomplete" | "cli_model_not_configured" }
  > {
    const opened = await db.transaction().execute(async (trx) => {
      const locked = await lockBlock(trx, processId, blockId);
      if (!locked.ok) return locked;
      if (!locked.block.complete) return { ok: false, error: "block_incomplete" } as const;
      const prepared = await prepare(trx, locked.block);
      if (!prepared.ok) return prepared;
      const attemptSettings = await settings.forNewAttempt(trx, prepared.cli);
      if (!attemptSettings.ok) return attemptSettings;
      const attempt = await runner.openAttempt(trx, prepared.aiRequestId, attemptSettings.settings, locked.block.currentVersionIds);
      return { ok: true, attempt, aiRequestId: prepared.aiRequestId, input: locked.block.input } as const;
    });
    if (!opened.ok) return opened;
    const { attempt, aiRequestId, input } = opened;
    try {
      // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
      return { ok: true, synthesisRequest: await findRequest(processId, blockId, aiRequestId) };
    } finally {
      // Aberta, a tentativa sempre segue, mesmo que a leitura falhe: nunca fica "running" à toa.
      runner.run(attempt, (context) => synthesize(input, context));
    }
  }

  // A última solicitação do Bloco e se a proposta dela, se houver, ainda corresponde às respostas.
  async function latestRequest(trx: Db, processId: string, blockId: string, block: LockedBlock) {
    const request = (await listAiRequests<GeneratedSynthesis>(trx, processId, OPERATION, { blockId })).at(-1);
    if (!request) return undefined;
    const used = request.result ? (await usedVersionsOf(trx, [request.result.attemptId])).get(request.result.attemptId)! : [];
    return { request, outdated: request.result !== null && !sameSet(used, block.currentVersionIds) };
  }

  return {
    async request(processId, blockId) {
      return startAttempt(processId, blockId, async (trx, block) => {
        const latest = await latestRequest(trx, processId, blockId, block);
        // Uma nova solicitação só quando não há nenhuma ou a última proposta ficou desatualizada;
        // depois de uma falha, a chance seguinte é uma nova tentativa da mesma solicitação.
        if (latest && !latest.outdated) return { ok: false, error: "synthesis_already_requested" } as const;
        const request = await trx
          .insertInto("aiRequests")
          .values({ processId, operation: OPERATION, blockId })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, aiRequestId: request.id } as const;
      });
    },

    async newAttempt(processId, blockId, requestId, cli) {
      return startAttempt(processId, blockId, async (trx, block) => {
        const latest = await latestRequest(trx, processId, blockId, block);
        if (!latest || latest.request.id !== requestId) return { ok: false, error: "synthesis_request_not_found" } as const;
        if (latest.request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (latest.request.status === "completed") return { ok: false, error: "synthesis_generated" } as const;
        return { ok: true, aiRequestId: requestId, cli: cli ?? latest.request.attempts.at(-1)!.cli } as const;
      });
    },

    async confirm(processId, blockId, confirmation) {
      const synthesis = confirmation.synthesis.trim();
      return db.transaction().execute(async (trx) => {
        const locked = await lockBlock(trx, processId, blockId);
        if (!locked.ok) return locked;
        const { block } = locked;
        const latest = await latestRequest(trx, processId, blockId, block);
        const proposal = latest?.request.result;
        if (!proposal || proposal.attemptId !== confirmation.proposalId) {
          return { ok: false, error: "unknown_synthesis" } as const;
        }
        if (latest.outdated) return { ok: false, error: "synthesis_outdated" } as const;
        const open = block.input.openStagePoints.map((point) => point.key);
        const covered = [...new Set(confirmation.coveredStagePoints)];
        if (covered.some((key) => !open.includes(key))) return { ok: false, error: "invalid_coverage" } as const;
        // Distinguir Restrições de Preferências é registrá-las: sem nenhuma em vigor, o Ponto não se cobre.
        const needsItems = covered.some((key) => findStagePoint(block.stagePointsVersion, block.stage, key)?.needsConstraintsOrPreferences);
        if (needsItems && !hasAny(inForceOf(await constraintsAndPreferencesOf(trx, processId)))) {
          return { ok: false, error: "no_constraint_or_preference" } as const;
        }

        const row = await trx
          .insertInto("blockSyntheses")
          .values({
            blockId,
            synthesis,
            origin: proposal.value.synthesis === synthesis ? "proposal" : "corrected",
            proposalId: proposal.attemptId,
          })
          .returning(["synthesis", "origin", "proposalId", "confirmedAt"])
          .executeTakeFirstOrThrow();
        if (covered.length > 0) {
          await trx
            .insertInto("stagePointCoverage")
            .values(
              covered.map((stagePoint) => ({
                processId,
                stage: block.stage,
                stagePoint,
                status: "covered" as const,
                blockId,
              })),
            )
            .execute();
        }
        return {
          ok: true,
          synthesis: {
            ...row,
            coveredStagePoints: covered.map((key) => namedStagePoint(block.stagePointsVersion, block.stage, key)),
            corrections: [],
          },
        } as const;
      });
    },
  };
}
