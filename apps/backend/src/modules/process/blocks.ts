import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequestRunner, type Attempt, type AttemptStatus, type OnCompleted } from "../ai/ai-requests.ts";
import type { AnswerType, Assistant, BlockInput, GeneratedBlock } from "../ai/assistant.ts";
import { answersOf, type AnswerDraft, type Answer } from "./answers.ts";
import { stagePointsOf, type StagePoint } from "./stage-points.ts";
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
  subject: string;
  contextRelation: string;
  rationale: string | null;
  stagePoints: Pick<StagePoint, "key" | "name">[];
  answerType: AnswerType;
  options: string[];
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

type Result<T, E> = { ok: true } & T | { ok: false; error: E };

export interface Blocks {
  // Pede à IA um Bloco para os Pontos abertos da Etapa atual. Nesta fatia, só o primeiro Bloco.
  request(processId: string): Promise<Result<{ blockRequest: BlockRequest }, BlockRequestError>>;
  // Nova tentativa da mesma solicitação, depois de uma tentativa que não trouxe Bloco.
  newAttempt(processId: string, blockRequestId: string): Promise<Result<{ blockRequest: BlockRequest }, NewBlockAttemptError>>;
  find(process: { id: string; currentStage: Stage; stagePointsVersion: number }): Promise<StageWork>;
}

const OPERATION = "generate_block";

// Trava o Processo para a transação e monta o que a IA recebe para gerar o Bloco.
async function lockOpenProcess(
  trx: Db,
  processId: string,
): Promise<Result<{ input: BlockInput | null }, BlocksClosed>> {
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
    input: confirmed
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

export function blocks(deps: { db: Db; assistant: Assistant; runner: AiRequestRunner; aiModel: string }): Blocks {
  const { db, assistant, runner, aiModel } = deps;

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

  // Abre uma tentativa, com o Processo travado até a transação terminar, e só depois de gravá-la
  // dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    prepare: (trx: Db, input: BlockInput | null) => Promise<Result<{ aiRequestId: string; input: BlockInput }, E>>,
  ): Promise<Result<{ blockRequest: BlockRequest }, E | BlocksClosed>> {
    const opened = await db.transaction().execute(async (trx) => {
      const process = await lockOpenProcess(trx, processId);
      if (!process.ok) return process;
      const prepared = await prepare(trx, process.input);
      if (!prepared.ok) return prepared;
      const attempt = await runner.openAttempt(trx, prepared.aiRequestId, { cli: assistant.cli, model: aiModel });
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
      runner.run(attempt, (context) => assistant.generateBlock(input, context), saveBlock(processId, input.stage));
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
        // Uma solicitação de Bloco só existe depois da Confirmação do enunciado.
        if (!request || !input) return { ok: false, error: "block_request_not_found" } as const;
        if (request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (request.status === "completed") return { ok: false, error: "block_generated" } as const;
        return { ok: true, aiRequestId: request.id, input } as const;
      });
    },

    async find(process) {
      const blockRows = await db
        .selectFrom("blocks")
        .select(["id", "number", "stage", "createdAt"])
        .where("processId", "=", process.id)
        .orderBy("number")
        .execute();
      const questionRows = blockRows.length
        ? await db
            .selectFrom("questions")
            .select(["id", "blockId", "subject", "contextRelation", "rationale", "stagePoints", "answerType", "options"])
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
        blockRequests: await findBlockRequests(process.id),
        blocks: blockRows.map((block) => {
          const points = stagePointsOf(process.stagePointsVersion, block.stage);
          return {
            ...block,
            questions: questionRows
              .filter((question) => question.blockId === block.id)
              .map(({ blockId: _blockId, stagePoints, ...question }) => ({
                ...question,
                stagePoints: stagePoints.map((key) => {
                  const point = points.find((candidate) => candidate.key === key);
                  return { key, name: point?.name ?? key };
                }),
                ...answers.get(question.id)!,
              })),
          };
        }),
      };
    },
  };
}
