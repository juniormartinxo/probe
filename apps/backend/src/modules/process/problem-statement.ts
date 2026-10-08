import type { Db } from "../../db/database.ts";
import { findAiRequest, type AiRequestRunner, type Attempt, type AttemptStatus } from "../ai/ai-requests.ts";
import type { Assistant, StatementProposal } from "../ai/assistant.ts";

// Como o enunciado confirmado nasceu: aceito como a IA propôs, corrigido a partir da proposta ou
// escrito pelo usuário sem proposta.
export type StatementOrigin = "proposal" | "corrected" | "written";

export interface ProblemStatement {
  statement: string;
  origin: StatementOrigin;
  proposalId: string | null;
  confirmedAt: Date;
}

// Proposta da IA: sugestão até o usuário confirmá-la. O id é o da tentativa que a produziu.
// Uma proposta que chega depois da Confirmação fica registrada, mas não muda o enunciado.
export interface Proposal extends StatementProposal {
  id: string;
  arrivedAfterConfirmation: boolean;
}

export interface Refinement {
  id: string;
  status: AttemptStatus;
  proposal: Proposal | null;
  attempts: Attempt[];
}

export type RefinementError =
  | "process_not_found"
  | "process_not_open"
  | "problem_statement_confirmed"
  | "refinement_already_requested";

export type RetryError =
  | "process_not_found"
  | "process_not_open"
  | "problem_statement_confirmed"
  | "refinement_not_requested"
  | "attempt_in_progress"
  | "refinement_completed";

export type ConfirmationError = "process_not_found" | "process_not_open" | "problem_statement_confirmed" | "unknown_proposal";

// O texto que o usuário confirmou e, se partiu de uma, a proposta da IA que ele viu.
export interface StatementConfirmation {
  statement: string;
  proposalId: string | null;
}

export interface ProblemStatements {
  requestRefinement(processId: string): Promise<{ ok: true; refinement: Refinement } | { ok: false; error: RefinementError }>;
  // Nova tentativa da mesma solicitação, depois de uma tentativa que não trouxe proposta.
  retryRefinement(processId: string): Promise<{ ok: true; refinement: Refinement } | { ok: false; error: RetryError }>;
  confirm(
    processId: string,
    confirmation: StatementConfirmation,
  ): Promise<{ ok: true; problemStatement: ProblemStatement } | { ok: false; error: ConfirmationError }>;
  find(processId: string): Promise<{ problemStatement: ProblemStatement | null; refinement: Refinement | null }>;
}

const OPERATION = "refine_problem_statement";

// Trava o Processo para a transação e verifica que o enunciado ainda está por confirmar.
async function lockOpenProcess(
  trx: Db,
  processId: string,
): Promise<
  | { ok: true; originalDescription: string }
  | { ok: false; error: "process_not_found" | "process_not_open" | "problem_statement_confirmed" }
> {
  const process = await trx
    .selectFrom("processes")
    .select(["status", "originalDescription"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  const confirmed = await trx
    .selectFrom("problemStatements")
    .select("processId")
    .where("processId", "=", processId)
    .executeTakeFirst();
  if (confirmed) return { ok: false, error: "problem_statement_confirmed" };
  return { ok: true, originalDescription: process.originalDescription };
}

export function problemStatements(deps: {
  db: Db;
  assistant: Assistant;
  runner: AiRequestRunner;
  aiModel: string;
}): ProblemStatements {
  const { db, assistant, runner, aiModel } = deps;

  async function findRefinement(processId: string, confirmedAt: Date | null): Promise<Refinement | null> {
    const request = await findAiRequest<StatementProposal>(db, processId, OPERATION);
    if (!request) return null;
    const { result } = request;
    return {
      id: request.id,
      status: request.status,
      proposal: result && {
        id: result.attemptId,
        ...result.value,
        arrivedAfterConfirmation: confirmedAt !== null && result.finishedAt > confirmedAt,
      },
      attempts: request.attempts,
    };
  }

  // Abre uma tentativa, com o Processo travado até a transação terminar, e só depois de gravá-la
  // dispara a geração. `prepare` diz a que solicitação ela pertence, ou por que não pode abrir.
  async function startAttempt<E extends string>(
    processId: string,
    prepare: (trx: Db) => Promise<{ ok: true; aiRequestId: string } | { ok: false; error: E }>,
  ): Promise<
    { ok: true; refinement: Refinement } | { ok: false; error: E | "process_not_found" | "process_not_open" | "problem_statement_confirmed" }
  > {
    const opened = await db.transaction().execute(async (trx) => {
      const process = await lockOpenProcess(trx, processId);
      if (!process.ok) return process;
      const prepared = await prepare(trx);
      if (!prepared.ok) return prepared;
      const attemptId = await runner.openAttempt(trx, prepared.aiRequestId, { cli: assistant.cli, model: aiModel });
      return { ok: true, attemptId, originalDescription: process.originalDescription } as const;
    });
    if (!opened.ok) return opened;
    // Lido antes de disparar a geração: a resposta mostra a tentativa recém-aberta.
    const refinement = (await findRefinement(processId, null))!;
    runner.run(opened.attemptId, aiModel, (generation) =>
      assistant.refineProblemStatement({ originalDescription: opened.originalDescription }, generation),
    );
    return { ok: true, refinement };
  }

  return {
    async requestRefinement(processId) {
      return startAttempt(processId, async (trx) => {
        const existing = await trx
          .selectFrom("aiRequests")
          .select("id")
          .where("processId", "=", processId)
          .where("operation", "=", OPERATION)
          .executeTakeFirst();
        if (existing) return { ok: false, error: "refinement_already_requested" } as const;
        const request = await trx
          .insertInto("aiRequests")
          .values({ processId, operation: OPERATION })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { ok: true, aiRequestId: request.id } as const;
      });
    },

    async retryRefinement(processId) {
      return startAttempt(processId, async (trx) => {
        const request = await findAiRequest<StatementProposal>(trx, processId, OPERATION);
        if (!request) return { ok: false, error: "refinement_not_requested" } as const;
        if (request.status === "running") return { ok: false, error: "attempt_in_progress" } as const;
        if (request.status === "completed") return { ok: false, error: "refinement_completed" } as const;
        return { ok: true, aiRequestId: request.id } as const;
      });
    },

    async confirm(processId, { statement, proposalId }) {
      return db.transaction().execute(async (trx) => {
        const process = await lockOpenProcess(trx, processId);
        if (!process.ok) return process;

        let origin: StatementOrigin = "written";
        if (proposalId !== null) {
          const request = await findAiRequest<StatementProposal>(trx, processId, OPERATION);
          const proposal = request?.result;
          if (!proposal || proposal.attemptId !== proposalId) return { ok: false, error: "unknown_proposal" } as const;
          origin = proposal.value.statement === statement ? "proposal" : "corrected";
        }
        const problemStatement = await trx
          .insertInto("problemStatements")
          .values({ processId, statement, origin, proposalId })
          .returning(["statement", "origin", "proposalId", "confirmedAt"])
          .executeTakeFirstOrThrow();
        return { ok: true, problemStatement } as const;
      });
    },

    async find(processId) {
      const problemStatement =
        (await db
          .selectFrom("problemStatements")
          .select(["statement", "origin", "proposalId", "confirmedAt"])
          .where("processId", "=", processId)
          .executeTakeFirst()) ?? null;
      return { problemStatement, refinement: await findRefinement(processId, problemStatement?.confirmedAt ?? null) };
    },
  };
}
