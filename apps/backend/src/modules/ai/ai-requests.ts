import type { FastifyBaseLogger } from "fastify";
import { sql, type Selectable } from "kysely";
import type { AiRequestAttemptTable, Db } from "../../db/database.ts";
import {
  cloakProfileName,
  cloakProfileNamed,
  type AssistantOutcome,
  type Cli,
  type CloakProfile,
  type FailureReason,
  type AttemptContext,
  type Usage,
} from "./assistant.ts";

// Operações que o backend pede à IA. Cada uma tem a sua solicitação; uma nova chance depois de
// uma falha é uma nova tentativa da mesma solicitação.
export type Operation = "refine_problem_statement" | "generate_block" | "synthesize_block" | "formulate_resolution_question";

export type AttemptStatus = "running" | "completed" | "failed" | "timed_out" | "canceled" | "interrupted";

export interface Attempt {
  id: string;
  number: number;
  status: AttemptStatus;
  cli: Cli;
  model: string;
  // Perfil do Cloak com que a CLI foi chamada; null nas tentativas anteriores ao Cloak.
  cloakProfile: CloakProfile | null;
  usage: Usage | null;
  failureReason: FailureReason | null;
  message: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface AiRequest<T> {
  id: string;
  operation: Operation;
  // Estado da solicitação: o da tentativa mais recente.
  status: AttemptStatus;
  attempts: Attempt[];
  // Resultado da tentativa concluída, se houver.
  result: { attemptId: string; finishedAt: Date; value: T } | null;
}

type AttemptRow = Selectable<AiRequestAttemptTable>;

function usageOf(row: AttemptRow): Usage | null {
  const usage = {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    costUsd: row.costUsd,
  };
  return Object.values(usage).every((value) => value === null) ? null : usage;
}

// Tentativas anteriores ao Cloak não têm perfil.
const cloakProfileOf = (row: AttemptRow): CloakProfile | null =>
  row.cloakProfileSource === null ? null : cloakProfileNamed(row.cloakProfileName);

function attemptOf(row: AttemptRow): Attempt {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    cli: row.cli,
    model: row.model,
    cloakProfile: cloakProfileOf(row),
    usage: usageOf(row),
    failureReason: row.failureReason,
    message: row.message,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

async function withAttempts<T>(db: Db, request: { id: string; operation: Operation }): Promise<AiRequest<T>> {
  const rows = await db
    .selectFrom("aiRequestAttempts")
    .selectAll()
    .where("aiRequestId", "=", request.id)
    .orderBy("number")
    .execute();
  const completed = rows.find((row) => row.status === "completed");
  return {
    ...request,
    status: rows.at(-1)!.status,
    attempts: rows.map(attemptOf),
    result: completed ? { attemptId: completed.id, finishedAt: completed.finishedAt!, value: completed.result as T } : null,
  };
}

// O tipo de `result` é o que a própria operação validou antes de gravar.
export async function findAiRequest<T>(db: Db, processId: string, operation: Operation): Promise<AiRequest<T> | null> {
  const request = await db
    .selectFrom("aiRequests")
    .select(["id", "operation"])
    .where("processId", "=", processId)
    .where("operation", "=", operation)
    .executeTakeFirst();
  return request ? withAttempts<T>(db, request) : null;
}

// Para operações que um Processo pede mais de uma vez, na ordem em que foram pedidas. Com
// `blockId`, só as do Bloco; com `pendencyId`, só as da Pendência.
export async function listAiRequests<T>(
  db: Db,
  processId: string,
  operation: Operation,
  { blockId, pendencyId }: { blockId?: string; pendencyId?: string } = {},
): Promise<AiRequest<T>[]> {
  let query = db
    .selectFrom("aiRequests")
    .select(["id", "operation"])
    .where("processId", "=", processId)
    .where("operation", "=", operation);
  if (blockId) query = query.where("blockId", "=", blockId);
  if (pendencyId) query = query.where("pendencyId", "=", pendencyId);
  const requests = await query.orderBy("createdAt").orderBy("id").execute();
  return Promise.all(requests.map((request) => withAttempts<T>(db, request)));
}

function usageColumns(usage: Usage | null) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? null,
    costUsd: usage?.costUsd ?? null,
  };
}

function outcomeColumns(outcome: AssistantOutcome<unknown>) {
  switch (outcome.status) {
    case "completed":
      return { status: outcome.status, result: JSON.stringify(outcome.result), ...usageColumns(outcome.usage) };
    case "failed":
      return {
        status: outcome.status,
        failureReason: outcome.reason,
        message: outcome.message,
        ...usageColumns(outcome.usage),
      };
    case "interrupted":
      return { status: outcome.status, message: outcome.message };
    case "timed_out":
    case "canceled":
      return { status: outcome.status };
  }
}

const SHUTDOWN_MESSAGE = "O backend foi encerrado durante a geração; o resultado não foi recebido.";
const ABANDONED_MESSAGE = "O backend reiniciou durante a geração; o resultado não foi recebido.";

export interface AttemptSettings {
  cli: Cli;
  model: string;
  cloakProfile: CloakProfile;
}

export type OnCompleted<T> = (trx: Db, attemptId: string, result: T) => Promise<void>;

export interface OpenedAttempt {
  id: string;
  cli: Cli;
  model: string;
  cloakProfile: CloakProfile;
}

// Relógio do banco no momento do comando (e não no início da transação), para que os instantes
// de Tentativas e Confirmações sejam comparáveis entre si.
const databaseClock = sql<Date>`clock_timestamp()`;

// Executa tentativas em segundo plano e grava o desfecho de cada uma. Uma tentativa só é
// encerrada uma vez: um desfecho que chega depois (por exemplo, de uma tentativa já marcada como
// interrompida) é descartado.
export class AiRequestRunner {
  private readonly inFlight = new Map<string, { cancellation: AbortController; done: Promise<void> }>();

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {}

  // Abre a tentativa seguinte da solicitação, já em andamento, e registra as Versões de resposta
  // que ela envia à IA. Chamar dentro da transação que verificou que a solicitação aceita uma nova
  // tentativa.
  async openAttempt(
    trx: Db,
    aiRequestId: string,
    settings: AttemptSettings,
    usedAnswerVersionIds: string[] = [],
  ): Promise<OpenedAttempt> {
    const previous = await trx
      .selectFrom("aiRequestAttempts")
      .select((eb) => eb.fn.max("number").as("number"))
      .where("aiRequestId", "=", aiRequestId)
      .executeTakeFirst();
    const { id } = await trx
      .insertInto("aiRequestAttempts")
      .values({
        aiRequestId,
        number: (previous?.number ?? 0) + 1,
        status: "running",
        cli: settings.cli,
        model: settings.model,
        cloakProfileSource: settings.cloakProfile.source,
        cloakProfileName: cloakProfileName(settings.cloakProfile),
        result: null,
        failureReason: null,
        message: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (usedAnswerVersionIds.length > 0) {
      await trx
        .insertInto("attemptAnswerVersions")
        .values(usedAnswerVersionIds.map((answerVersionId) => ({ attemptId: id, answerVersionId })))
        .execute();
    }
    return { id, cli: settings.cli, model: settings.model, cloakProfile: settings.cloakProfile };
  }

  // Dispara a geração de uma tentativa aberta, depois de a transação que a abriu ser gravada.
  // `onCompleted` grava o que o resultado produz na mesma transação que conclui a tentativa: ou os
  // dois ficam, ou a tentativa termina interrompida.
  run<T>(
    { id: attemptId, cli, model, cloakProfile }: OpenedAttempt,
    generate: (context: AttemptContext) => Promise<AssistantOutcome<T>>,
    onCompleted?: OnCompleted<T>,
  ): void {
    const cancellation = new AbortController();
    const done = generate({ id: attemptId, cli, model, cloakProfile, signal: cancellation.signal })
      .catch((error: unknown): AssistantOutcome<T> => {
        this.log.error({ err: error, attemptId }, "Geração falhou sem desfecho reconhecível.");
        return { status: "interrupted", message: error instanceof Error ? error.message : String(error) };
      })
      // Encerrada pelo desligamento do backend, a tentativa fica interrompida, qualquer que seja o desfecho.
      .then((outcome) => this.finish(attemptId, cancellation.signal.aborted ? shutdownOutcome : outcome, onCompleted))
      // Se o banco recusou o desfecho, a tentativa ao menos sai de "running" para aceitar uma nova;
      // se nem isso grava (banco fora do ar), o próximo início do backend a interrompe.
      .catch(async (error: unknown) => {
        this.log.error({ err: error, attemptId }, "Não foi possível gravar o desfecho.");
        await this.finish(attemptId, unsavedOutcome).catch((retryError: unknown) =>
          this.log.error({ err: retryError, attemptId }, "Não foi possível interromper a tentativa."),
        );
      })
      .finally(() => this.inFlight.delete(attemptId));
    this.inFlight.set(attemptId, { cancellation, done });
  }

  private async finish<T>(attemptId: string, outcome: AssistantOutcome<T>, onCompleted?: OnCompleted<T>): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const finished = await trx
        .updateTable("aiRequestAttempts")
        .set({ ...outcomeColumns(outcome), finishedAt: databaseClock })
        .where("id", "=", attemptId)
        .where("status", "=", "running")
        .returning("id")
        .executeTakeFirst();
      if (finished && outcome.status === "completed") await onCompleted?.(trx, attemptId, outcome.result);
    });
  }

  // Tentativas que ficaram "running" sem ninguém para recebê-las (o backend caiu) passam a
  // interrompidas. Nada é reenviado: uma nova tentativa depende do usuário. Supõe um único
  // backend por banco, como no uso local.
  async interruptAbandoned(): Promise<void> {
    await this.db
      .updateTable("aiRequestAttempts")
      .set({ status: "interrupted", message: ABANDONED_MESSAGE, finishedAt: databaseClock })
      .where("status", "=", "running")
      .execute();
  }

  // Ao desligar, cancela as gerações em andamento e espera seus desfechos serem gravados.
  async shutdown(): Promise<void> {
    const running = [...this.inFlight.values()];
    for (const { cancellation } of running) cancellation.abort();
    await Promise.all(running.map(({ done }) => done));
  }
}

const shutdownOutcome: AssistantOutcome<never> = { status: "interrupted", message: SHUTDOWN_MESSAGE };
const unsavedOutcome: AssistantOutcome<never> = {
  status: "interrupted",
  message: "O resultado da geração não pôde ser gravado no banco.",
};
