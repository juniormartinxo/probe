import type { Db } from "../../db/database.ts";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  messages: Message[];
}

// Cada Processo tem exatamente uma Conversa, aberta junto com ele.
export async function startConversation(db: Db, processId: string): Promise<Conversation> {
  const { id } = await db
    .insertInto("conversations")
    .values({ processId })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id, messages: [] };
}

export async function findConversationOfProcess(db: Db, processId: string): Promise<Conversation> {
  const { id } = await db
    .selectFrom("conversations")
    .select("id")
    .where("processId", "=", processId)
    .executeTakeFirstOrThrow();
  const messages = await db
    .selectFrom("messages")
    .select(["id", "role", "content", "createdAt"])
    .where("conversationId", "=", id)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  return { id, messages };
}
