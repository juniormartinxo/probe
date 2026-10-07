import type { Db } from "../../db/database.ts";
import {
  findConversationOfProcess,
  startConversation,
  type Conversation,
} from "../conversation/conversation.ts";
import type { Stage } from "./stage.ts";

export interface Process {
  id: string;
  originalDescription: string;
  status: "open" | "finalized";
  currentStage: Stage;
  createdAt: Date;
}

export interface ProcessWithConversation extends Process {
  conversation: Conversation;
}

// O Processo nasce aberto, na Etapa P, com a descrição original intacta e uma Conversa vazia.
export async function createProcess(db: Db, originalDescription: string): Promise<ProcessWithConversation> {
  return db.transaction().execute(async (trx) => {
    const process = await trx
      .insertInto("processes")
      .values({ originalDescription })
      .returningAll()
      .executeTakeFirstOrThrow();
    const conversation = await startConversation(trx, process.id);
    return { ...process, conversation };
  });
}

export async function findProcess(db: Db, id: string): Promise<ProcessWithConversation | undefined> {
  const process = await db.selectFrom("processes").selectAll().where("id", "=", id).executeTakeFirst();
  if (!process) return undefined;
  return { ...process, conversation: await findConversationOfProcess(db, id) };
}

export async function listProcesses(db: Db): Promise<Process[]> {
  return db.selectFrom("processes").selectAll().orderBy("createdAt", "desc").orderBy("id", "desc").execute();
}
