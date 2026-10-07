import type { Db } from "../../db/database.ts";

// As mensagens chegam com a primeira fatia que conversa com a IA; por ora a Conversa nasce vazia.
export interface Conversation {
  id: string;
}

// Cada Processo tem exatamente uma Conversa, aberta junto com ele.
export async function startConversation(db: Db, processId: string): Promise<Conversation> {
  return db.insertInto("conversations").values({ processId }).returning("id").executeTakeFirstOrThrow();
}

export async function findConversationOfProcess(db: Db, processId: string): Promise<Conversation> {
  return db
    .selectFrom("conversations")
    .select("id")
    .where("processId", "=", processId)
    .executeTakeFirstOrThrow();
}
