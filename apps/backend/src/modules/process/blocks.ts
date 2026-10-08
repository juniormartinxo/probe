import type { Db } from "../../db/database.ts";
import { listAiRequests, type AiRequestRunner, type Attempt, type AttemptStatus, type OnCompleted } from "../ai/ai-requests.ts";
import type {
  AmbiguousAnswer,
  AnswerType,
  Assistant,
  AssistantOutcome,
  AttemptContext,
  BlockInput,
  GeneratedBlock,
  GeneratedSynthesis,
} from "../ai/assistant.ts";
import type { SettingsModule } from "../settings/settings.ts";
import { answersOf, type AnswerDraft, type Answer } from "./answers.ts";
import { openPoints, stagePointStates, type StagePointState } from "./stage-point-coverage.ts";
import { askedQuestionOf, currentVersionsOf, stageQuestions } from "./stage-questions.ts";
import { namedStagePoint, type StagePoint } from "./stage-points.ts";
import type { Stage } from "./stage.ts";
import { synthesesOf, type BlockSynthesisState } from "./syntheses.ts";

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
  // A Pergunta original, quando esta é uma reformulação dela.
  reformulates: { questionId: string; blockNumber: number; number: number; wording: string } | null;
  answerType: AnswerType;
  choices: string[];
  answer: Answer | null;
  draft: AnswerDraft | null;
  // O usuário registrou que não sabe a informação (há uma Pendência aberta).
  unknown: boolean;
}

export interface Block extends BlockSynthesisState {
  id: string;
  number: number;
  stage: Stage;
  createdAt: Date;
  questions: Question[];
}

export interface StageWork {
  // Pontos da Etapa atual, cada um aberto, coberto ou inaplicável.
  stagePoints: StagePointState[];
  // Os Pontos da Etapa atual ainda abertos.
  openStagePoints: StagePoint[];
  blockRequests: BlockRequest[];
  blocks: Block[];
}

export type BlocksClosed = "process_not_found" | "process_not_open";

export type BlockRequestError =
  | BlocksClosed
  | "problem_statement_not_confirmed"
  | "block_already_requested"
  | "synthesis_not_confirmed"
  | "no_open_stage_points";

export type NewBlockAttemptError = BlocksClosed | "block_request_not_found" | "attempt_in_progress" | "block_generated";

export interface Blocks {
  // Pede à IA um Bloco novo para os Pontos abertos da Etapa atual, depois de confirmada a síntese de
  // cada Bloco anterior da Etapa.
  request(processId: string): Promise<{ ok: true; blockRequest: BlockRequest } | { ok: false; error: BlockRequestError }>;
  // Nova tentativa da mesma solicitação, depois de uma tentativa que não trouxe Bloco.
  newAttempt(
    processId: string,
    blockRequestId: string,
  ): Promise<{ ok: true; blockRequest: BlockRequest } | { ok: false; error: NewBlockAttemptError }>;
  find(process: { id: string; currentStage: Stage; stagePointsVersion: number }): Promise<StageWork>;
}

const OPERATION = "generate_block";

interface PreparedBlock {
  input: BlockInput;
  // As Versões de resposta que o pedido envia à IA.
  usedVersionIds: string[];
  // Referência ("1.2") de cada Pergunta já feita na Etapa, para ligar as reformulações.
  questionIdsByRef: Map<string, string>;
  // Blocos da Etapa ainda sem síntese confirmada.
  unsynthesized: number;
}

// Trava o Processo para a transação e monta o que a IA recebe para gerar o Bloco: os Pontos ainda
// abertos e o que já foi perguntado, respondido e sintetizado na Etapa. `prepared` é null enquanto o
// enunciado do problema não foi confirmado.
async function lockOpenProcess(
  trx: Db,
  processId: string,
): Promise<{ ok: true; prepared: PreparedBlock | null } | { ok: false; error: BlocksClosed }> {
  const process = await trx
    .selectFrom("processes")
    .select(["id", "status", "currentStage", "stagePointsVersion", "originalDescription"])
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
  if (!confirmed) return { ok: true, prepared: null };
  const stage = process.currentStage;
  const questions = await stageQuestions(trx, processId, stage);
  const syntheses = await trx
    .selectFrom("blocks")
    .leftJoin("blockSyntheses", "blockSyntheses.blockId", "blocks.id")
    .leftJoin("aiRequestAttempts", "aiRequestAttempts.id", "blockSyntheses.proposalId")
    .select(["blocks.number", "blockSyntheses.synthesis", "aiRequestAttempts.result"])
    .where("blocks.processId", "=", processId)
    .where("blocks.stage", "=", stage)
    .orderBy("blocks.number")
    .execute();
  const confirmedSyntheses = syntheses.filter((row) => row.synthesis !== null);
  const openStagePoints = openPoints(await stagePointStates(trx, process, stage));
  const open = new Set(openStagePoints.map((point) => point.key));
  // Uma resposta ambígua só é oferecida para reformular enquanto não ganhou reformulação e ainda
  // serve a algum Ponto aberto: a reformulação também precisa servir a um Ponto aberto.
  const reformulated = new Set(questions.flatMap((question) => question.reformulatesQuestionId ?? []));
  const ambiguousAnswers: AmbiguousAnswer[] = confirmedSyntheses
    // O resultado foi validado como GeneratedSynthesis antes de a tentativa ser gravada.
    .flatMap((row) => (row.result as GeneratedSynthesis).ambiguousAnswers)
    .filter((item) => {
      const question = questions.find((asked) => asked.ref === item.question);
      return (
        question !== undefined &&
        !reformulated.has(question.id) &&
        question.stagePoints.some((key) => open.has(key))
      );
    });
  return {
    ok: true,
    prepared: {
      input: {
        stage,
        originalDescription: process.originalDescription,
        problemStatement: confirmed.statement,
        openStagePoints,
        askedQuestions: questions.map(askedQuestionOf),
        confirmedSyntheses: confirmedSyntheses.map((row) => row.synthesis!),
        ambiguousAnswers,
      },
      usedVersionIds: currentVersionsOf(questions),
      questionIdsByRef: new Map(questions.map((question) => [question.ref, question.id])),
      unsynthesized: syntheses.length - confirmedSyntheses.length,
    },
  };
}

// Grava o Bloco que a tentativa concluída trouxe, na ordem em que a IA formulou as Perguntas, com
// cada reformulação ligada à Pergunta original.
const saveBlock =
  (processId: string, stage: Stage, questionIdsByRef: Map<string, string>): OnCompleted<GeneratedBlock> =>
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
      .values(
        questions.map(({ reformulates, ...question }, position) => ({
          blockId: block.id,
          position,
          ...question,
          reformulatesQuestionId: reformulates === null ? null : questionIdsByRef.get(reformulates)!,
        })),
      )
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
  // fora dos abertos, ou que reformule uma Pergunta que não foi feita, é recusado, qualquer que seja a
  // implementação do Assistant.
  async function generateBlock(input: BlockInput, context: AttemptContext): Promise<AssistantOutcome<GeneratedBlock>> {
    const outcome = await assistant.generateBlock(input, context);
    if (outcome.status !== "completed") return outcome;
    const failed = (message: string): AssistantOutcome<GeneratedBlock> => ({
      status: "failed",
      reason: "invalid_output",
      message,
      usage: outcome.usage,
    });
    const open = new Set(input.openStagePoints.map((point) => point.key));
    const outside = outcome.result.questions.flatMap((question) => question.stagePoints).filter((key) => !open.has(key));
    if (outside.length > 0) return failed(`A IA indicou Pontos da etapa que não estão em aberto: ${outside.join(", ")}.`);
    const asked = new Set(input.askedQuestions.map((question) => question.ref));
    const unknown = outcome.result.questions.flatMap(({ reformulates }) =>
      reformulates !== null && !asked.has(reformulates) ? [reformulates] : [],
    );
    if (unknown.length > 0) return failed(`A IA reformulou Perguntas que não foram feitas: ${unknown.join(", ")}.`);
    return outcome;
  }

  // Abre uma tentativa, com o Processo travado até a transação terminar, e só depois de gravá-la
  // dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    prepare: (
      trx: Db,
      prepared: PreparedBlock | null,
    ) => Promise<{ ok: true; aiRequestId: string; prepared: PreparedBlock } | { ok: false; error: E }>,
  ): Promise<{ ok: true; blockRequest: BlockRequest } | { ok: false; error: E | BlocksClosed }> {
    const opened = await db.transaction().execute(async (trx) => {
      const process = await lockOpenProcess(trx, processId);
      if (!process.ok) return process;
      const ready = await prepare(trx, process.prepared);
      if (!ready.ok) return ready;
      // O modelo é o configurado no momento em que a tentativa abre; as já abertas guardam o seu.
      const { claudeModel } = await settings.find(trx);
      const attempt = await runner.openAttempt(
        trx,
        ready.aiRequestId,
        { cli: assistant.cli, model: claudeModel },
        ready.prepared.usedVersionIds,
      );
      return { ok: true, attempt, aiRequestId: ready.aiRequestId, prepared: ready.prepared } as const;
    });
    if (!opened.ok) return opened;
    const { attempt, aiRequestId, prepared } = opened;
    const { input } = prepared;
    try {
      // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
      const blockRequest = (await findBlockRequests(processId)).find((request) => request.id === aiRequestId)!;
      return { ok: true, blockRequest };
    } finally {
      // Aberta, a tentativa sempre segue, mesmo que a leitura falhe: nunca fica "running" à toa.
      runner.run(
        attempt,
        (context) => generateBlock(input, context),
        saveBlock(processId, input.stage, prepared.questionIdsByRef),
      );
    }
  }

  return {
    async request(processId) {
      return startAttempt(processId, async (trx, prepared) => {
        if (!prepared) return { ok: false, error: "problem_statement_not_confirmed" } as const;
        // Uma solicitação que ainda não trouxe Bloco segue com novas tentativas, não com outra solicitação.
        const requests = await listAiRequests(trx, processId, OPERATION);
        if (requests.some((request) => request.status !== "completed")) {
          return { ok: false, error: "block_already_requested" } as const;
        }
        // Perguntas novas só depois de o usuário confirmar o que o Bloco anterior entendeu.
        if (prepared.unsynthesized > 0) return { ok: false, error: "synthesis_not_confirmed" } as const;
        if (prepared.input.openStagePoints.length === 0) return { ok: false, error: "no_open_stage_points" } as const;
        const request = await trx
          .insertInto("aiRequests")
          .values({ processId, operation: OPERATION })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, aiRequestId: request.id, prepared } as const;
      });
    },

    async newAttempt(processId, blockRequestId) {
      return startAttempt(processId, async (trx, prepared) => {
        const request = (await listAiRequests(trx, processId, OPERATION)).find(({ id }) => id === blockRequestId);
        // Uma solicitação de Bloco só existe depois da Confirmação do enunciado: sem ela, não há o que tentar.
        if (!request || !prepared) return { ok: false, error: "block_request_not_found" } as const;
        if (request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (request.status === "completed") return { ok: false, error: "block_generated" } as const;
        return { ok: true, aiRequestId: request.id, prepared } as const;
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
            .select([
              "id",
              "blockId",
              "position",
              "wording",
              "subject",
              "contextRelation",
              "rationale",
              "stagePoints",
              "reformulatesQuestionId",
              "answerType",
              "choices",
            ])
            .where(
              "blockId",
              "in",
              blockRows.map((block) => block.id),
            )
            .orderBy("position")
            .execute()
        : [];
      const questionIds = questionRows.map((question) => question.id);
      const answers = await answersOf(db, questionIds);
      const unknown = questionIds.length
        ? await db
            .selectFrom("pendencies")
            .select("questionId")
            .where("questionId", "in", questionIds)
            .where("reason", "=", "unknown_information")
            .where("resolvedAt", "is", null)
            .execute()
        : [];
      const syntheses = await synthesesOf(db, process, blockRows);
      const stagePoints = await stagePointStates(db, process, process.currentStage);
      const reformulated = (id: string | null): Question["reformulates"] => {
        const original = id === null ? undefined : questionRows.find((question) => question.id === id);
        if (!original) return null;
        const block = blockRows.find((item) => item.id === original.blockId)!;
        return { questionId: original.id, blockNumber: block.number, number: original.position + 1, wording: original.wording };
      };
      return {
        stagePoints,
        openStagePoints: openPoints(stagePoints),
        blockRequests,
        blocks: blockRows.map((block) => ({
          ...block,
          questions: questionRows
            .filter((question) => question.blockId === block.id)
            .map(({ blockId: _blockId, position: _position, stagePoints: keys, reformulatesQuestionId, ...question }) => ({
              ...question,
              stagePoints: keys.map((key) => namedStagePoint(process.stagePointsVersion, block.stage, key)),
              reformulates: reformulated(reformulatesQuestionId),
              ...answers.get(question.id)!,
              unknown: unknown.some((pendency) => pendency.questionId === question.id),
            })),
          ...syntheses.get(block.id)!,
        })),
      };
    },
  };
}
