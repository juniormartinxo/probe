import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequestRunner, type Attempt, type AttemptStatus, type OnCompleted } from "../ai/ai-requests.ts";
import type {
  AnswerType,
  Assistant,
  AssistantOutcome,
  AttemptContext,
  BlockInput,
  GeneratedBlock,
} from "../ai/assistant.ts";
import type { SettingsModule } from "../settings/settings.ts";
import { answersOf, type AnswerDraft, type Answer } from "./answers.ts";
import { findStagePoint, stagePointsOf, type StagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";

// Solicitação à IA de um Bloco de Perguntas; `blockId` é o Bloco que a tentativa concluída gerou.
export interface BlockRequest {
  id: string;
  status: AttemptStatus;
  blockId: string | null;
  attempts: Attempt[];
}

// Pergunta como foi apresentada, com a resposta e o rascunho do usuário.
export interface Question {
  id: string;
  wording: string;
  subject: string;
  contextRelation: string;
  rationale: string | null;
  stagePoints: Pick<StagePoint, "key" | "name">[];
  answerType: AnswerType;
  choices: string[];
  answer: Answer | null;
  draft: AnswerDraft | null;
}

export interface Block {
  id: string;
  number: number;
  stage: Stage;
  createdAt: Date;
  questions: Question[];
}

export interface StageWork {
  // Pontos da Etapa atual ainda não cobertos.
  openStagePoints: StagePoint[];
  blockRequests: BlockRequest[];
  blocks: Block[];
}

export type BlocksClosed = "process_not_found" | "process_not_open";

export type BlockRequestError = BlocksClosed | "problem_statement_not_confirmed" | "block_already_requested";

export type NewBlockAttemptError = BlocksClosed | "block_request_not_found" | "attempt_in_progress" | "block_generated";

export interface Blocks {
  // Pede à IA um Bloco para os Pontos abertos da Etapa atual. Nesta fatia, só o primeiro Bloco.
  request(processId: string): Promise<{ ok: true; blockRequest: BlockRequest } | { ok: false; error: BlockRequestError }>;
  // Nova tentativa da mesma solicitação, depois de uma tentativa que não trouxe Bloco.
  newAttempt(
    processId: string,
    blockRequestId: string,
  ): Promise<{ ok: true; blockRequest: BlockRequest } | { ok: false; error: NewBlockAttemptError }>;
  find(process: { id: string; currentStage: Stage; stagePointsVersion: number }): Promise<StageWork>;
}

const OPERATION = "generate_block";

// Trava o Processo para a transação e monta o que a IA recebe para gerar o Bloco; `blockInput` é
// null enquanto o enunciado do problema não foi confirmado.
async function lockOpenProcess(
  trx: Db,
  processId: string,
): Promise<{ ok: true; blockInput: BlockInput | null } | { ok: false; error: BlocksClosed }> {
  const process = await trx
    .selectFrom("processes")
    .select(["status", "currentStage", "stagePointsVersion", "originalDescription"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  const confirmed = await trx
    .selectFrom("problemStatements")
    .select("statement")
    .where("processId", "=", processId)
    .executeTakeFirst();
  return {
    ok: true,
    blockInput: confirmed
      ? {
          stage: process.currentStage,
          originalDescription: process.originalDescription,
          problemStatement: confirmed.statement,
          // A cobertura de Pontos chega com a síntese do Bloco; até lá, todos seguem abertos.
          openStagePoints: stagePointsOf(process.stagePointsVersion, process.currentStage),
        }
      : null,
  };
}

// Grava o Bloco que a tentativa concluída trouxe, na ordem em que a IA formulou as Perguntas.
const saveBlock =
  (processId: string, stage: Stage): OnCompleted<GeneratedBlock> =>
  async (trx, attemptId, { questions }) => {
    const previous = await trx
      .selectFrom("blocks")
      .select((eb) => eb.fn.max("number").as("number"))
      .where("processId", "=", processId)
      .executeTakeFirst();
    const block = await trx
      .insertInto("blocks")
      .values({ processId, number: (previous?.number ?? 0) + 1, stage, attemptId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("questions")
      .values(questions.map((question, position) => ({ blockId: block.id, position, ...question })))
      .execute();
  };

export function blocks(deps: { db: Db; assistant: Assistant; runner: AiRequestRunner; settings: SettingsModule }): Blocks {
  const { db, assistant, runner, settings } = deps;

  async function findBlockRequests(processId: string): Promise<BlockRequest[]> {
    const requests = await listAiRequests<GeneratedBlock>(db, processId, OPERATION);
    const generated = await db
      .selectFrom("blocks")
      .select(["id", "attemptId"])
      .where("processId", "=", processId)
      .execute();
    return requests.map(({ id, status, attempts, result }) => ({
      id,
      status,
      blockId: generated.find((block) => block.attemptId === result?.attemptId)?.id ?? null,
      attempts,
    }));
  }

  // Os Pontos são da aplicação, não da IA (ADR 0002): um Bloco com Pergunta que sirva a um Ponto
  // fora dos abertos é recusado, qualquer que seja a implementação do Assistant.
  async function generateBlock(input: BlockInput, context: AttemptContext): Promise<AssistantOutcome<GeneratedBlock>> {
    const outcome = await assistant.generateBlock(input, context);
    if (outcome.status !== "completed") return outcome;
    const open = new Set(input.openStagePoints.map((point) => point.key));
    const outside = outcome.result.questions.flatMap((question) => question.stagePoints).filter((key) => !open.has(key));
    if (outside.length === 0) return outcome;
    return {
      status: "failed",
      reason: "invalid_output",
      message: `A IA indicou Pontos da etapa que não estão em aberto: ${outside.join(", ")}.`,
      usage: outcome.usage,
    };
  }

  // Abre uma tentativa, com o Processo travado até a transação terminar, e só depois de gravá-la
  // dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    prepare: (
      trx: Db,
      blockInput: BlockInput | null,
    ) => Promise<{ ok: true; aiRequestId: string; input: BlockInput } | { ok: false; error: E }>,
  ): Promise<{ ok: true; blockRequest: BlockRequest } | { ok: false; error: E | BlocksClosed }> {
    const opened = await db.transaction().execute(async (trx) => {
      const process = await lockOpenProcess(trx, processId);
      if (!process.ok) return process;
      const prepared = await prepare(trx, process.blockInput);
      if (!prepared.ok) return prepared;
      // O modelo é o configurado no momento em que a tentativa abre; as já abertas guardam o seu.
      const { claudeModel } = await settings.find();
      const attempt = await runner.openAttempt(trx, prepared.aiRequestId, { cli: assistant.cli, model: claudeModel });
      return { ok: true, attempt, aiRequestId: prepared.aiRequestId, input: prepared.input } as const;
    });
    if (!opened.ok) return opened;
    const { attempt, aiRequestId, input } = opened;
    try {
      // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
      const blockRequest = (await findBlockRequests(processId)).find((request) => request.id === aiRequestId)!;
      return { ok: true, blockRequest };
    } finally {
      // Aberta, a tentativa sempre segue, mesmo que a leitura falhe: nunca fica "running" à toa.
      runner.run(attempt, (context) => generateBlock(input, context), saveBlock(processId, input.stage));
    }
  }

  return {
    async request(processId) {
      return startAttempt(processId, async (trx, input) => {
        if (!input) return { ok: false, error: "problem_statement_not_confirmed" } as const;
        if ((await listAiRequests(trx, processId, OPERATION)).length > 0) {
          return { ok: false, error: "block_already_requested" } as const;
        }
        const request = await trx
          .insertInto("aiRequests")
          .values({ processId, operation: OPERATION })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, aiRequestId: request.id, input } as const;
      });
    },

    async newAttempt(processId, blockRequestId) {
      return startAttempt(processId, async (trx, input) => {
        const request = (await listAiRequests(trx, processId, OPERATION)).find(({ id }) => id === blockRequestId);
        // Uma solicitação de Bloco só existe depois da Confirmação do enunciado: sem ela, não há o que tentar.
        if (!request || !input) return { ok: false, error: "block_request_not_found" } as const;
        if (request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (request.status === "completed") return { ok: false, error: "block_generated" } as const;
        return { ok: true, aiRequestId: request.id, input } as const;
      });
    },

    async find(process) {
      // As solicitações antes dos Blocos: o Bloco é gravado na mesma transação que conclui a
      // tentativa, então uma solicitação lida como concluída já tem o seu Bloco na leitura seguinte.
      const blockRequests = await findBlockRequests(process.id);
      const blockRows = await db
        .selectFrom("blocks")
        .select(["id", "number", "stage", "createdAt"])
        .where("processId", "=", process.id)
        .orderBy("number")
        .execute();
      const questionRows = blockRows.length
        ? await db
            .selectFrom("questions")
            .select(["id", "blockId", "wording", "subject", "contextRelation", "rationale", "stagePoints", "answerType", "choices"])
            .where(
              "blockId",
              "in",
              blockRows.map((block) => block.id),
            )
            .orderBy("position")
            .execute()
        : [];
      const answers = await answersOf(
        db,
        questionRows.map((question) => question.id),
      );
      return {
        openStagePoints: stagePointsOf(process.stagePointsVersion, process.currentStage),
        blockRequests,
        blocks: blockRows.map((block) => {
          return {
            ...block,
            questions: questionRows
              .filter((question) => question.blockId === block.id)
              .map(({ blockId: _blockId, stagePoints, ...question }) => ({
                ...question,
                stagePoints: stagePoints.map((key) => ({
                  key,
                  name: findStagePoint(process.stagePointsVersion, block.stage, key)?.name ?? key,
                })),
                ...answers.get(question.id)!,
              })),
          };
        }),
      };
    },
  };
}
