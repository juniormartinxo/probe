import { sql } from "kysely";
import type { Db } from "../../db/database.ts";

// Restrição (inegociável) ou Preferência (negociável): itens distintos do Processo, registrados pelo
// usuário na Etapa R. As duas têm a mesma forma.
export type ItemKind = "constraint" | "preference";

export interface StatedItem {
  id: string;
  statement: string;
  // A que o item se aplica, quando isso precisa ser dito.
  scope: string | null;
  // Em que unidade o que ele diz é medido (dias úteis, reais por mês), quando há medida.
  unit: string | null;
  registeredAt: Date;
  // Retirado pelo usuário: deixa de valer e continua no histórico.
  withdrawnAt: Date | null;
}

export type Constraint = StatedItem;
export type Preference = StatedItem;

export interface ItemStatement {
  statement: string;
  scope: string | null;
  unit: string | null;
}

export interface ConstraintsAndPreferencesState {
  constraints: Constraint[];
  preferences: Preference[];
}

type ItemClosed = "process_not_found" | "process_not_open" | "stage_not_current";

export type ItemNotFound = "constraint_not_found" | "preference_not_found";

export type WithdrawalError = ItemClosed | ItemNotFound | "already_withdrawn";

export interface ConstraintsAndPreferences {
  // Registra uma Restrição ou Preferência enquanto a Etapa R é a atual.
  register(processId: string, kind: ItemKind, item: ItemStatement): Promise<{ ok: true; item: StatedItem } | { ok: false; error: ItemClosed }>;
  withdraw(processId: string, kind: ItemKind, itemId: string): Promise<{ ok: true; item: StatedItem } | { ok: false; error: WithdrawalError }>;
}

const tables = { constraint: "constraints", preference: "preferences" } as const;

const columns = ["id", "statement", "scope", "unit", "registeredAt", "withdrawnAt"] as const;

async function itemsOf(db: Db, kind: ItemKind, processId: string): Promise<StatedItem[]> {
  return db
    .selectFrom(tables[kind])
    .select(columns)
    .where("processId", "=", processId)
    .orderBy("registeredAt")
    .orderBy("id")
    .execute();
}

// Restrições e Preferências do Processo, na ordem em que foram registradas, inclusive as retiradas.
export async function constraintsAndPreferencesOf(db: Db, processId: string): Promise<ConstraintsAndPreferencesState> {
  return { constraints: await itemsOf(db, "constraint", processId), preferences: await itemsOf(db, "preference", processId) };
}

export const inForce = (items: StatedItem[]): StatedItem[] => items.filter((item) => item.withdrawnAt === null);

const statementOf = ({ statement, scope, unit }: StatedItem): ItemStatement => ({ statement, scope, unit });

// As Restrições e Preferências em vigor, como a IA e o Jev as recebem.
export async function statementsInForceOf(
  db: Db,
  processId: string,
): Promise<{ constraints: ItemStatement[]; preferences: ItemStatement[] }> {
  const { constraints, preferences } = await constraintsAndPreferencesOf(db, processId);
  return { constraints: inForce(constraints).map(statementOf), preferences: inForce(preferences).map(statementOf) };
}

// Trava o Processo para a transação; Restrições e Preferências só mudam enquanto R é a Etapa atual.
async function lockStageR(trx: Db, processId: string): Promise<{ ok: true } | { ok: false; error: ItemClosed }> {
  const process = await trx
    .selectFrom("processes")
    .select(["status", "currentStage"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  if (process.currentStage !== "R") return { ok: false, error: "stage_not_current" };
  return { ok: true };
}

export function constraintsAndPreferences({ db }: { db: Db }): ConstraintsAndPreferences {
  return {
    async register(processId, kind, { statement, scope, unit }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageR(trx, processId);
        if (!locked.ok) return locked;
        const item = await trx
          .insertInto(tables[kind])
          .values({ processId, statement: statement.trim(), scope: scope?.trim() || null, unit: unit?.trim() || null })
          .returning(columns)
          .executeTakeFirstOrThrow();
        return { ok: true, item } as const;
      });
    },

    async withdraw(processId, kind, itemId) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageR(trx, processId);
        if (!locked.ok) return locked;
        const found = await trx
          .selectFrom(tables[kind])
          .select("withdrawnAt")
          .where("id", "=", itemId)
          .where("processId", "=", processId)
          .executeTakeFirst();
        if (!found) return { ok: false, error: `${kind}_not_found` } as const;
        if (found.withdrawnAt !== null) return { ok: false, error: "already_withdrawn" } as const;
        const item = await trx
          .updateTable(tables[kind])
          .set({ withdrawnAt: sql<Date>`clock_timestamp()` })
          .where("id", "=", itemId)
          .returning(columns)
          .executeTakeFirstOrThrow();
        return { ok: true, item } as const;
      });
    },
  };
}
