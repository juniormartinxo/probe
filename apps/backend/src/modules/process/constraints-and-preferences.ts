import { sql } from "kysely";
import type { Db } from "../../db/database.ts";
import { stagePointStates } from "./stage-point-coverage.ts";
import { findStagePoint } from "./stage-points.ts";
import { stages, type Stage } from "./stage.ts";

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

// O que o item diz, como o usuário o registra e como a IA e o Jev o recebem.
export interface ItemStatement {
  statement: string;
  scope: string | null;
  unit: string | null;
}

// Restrições e Preferências, sempre separadas.
export interface ConstraintsAndPreferencesOf<T> {
  constraints: T[];
  preferences: T[];
}

export type ConstraintsAndPreferencesState = ConstraintsAndPreferencesOf<StatedItem>;

export type ItemStatements = ConstraintsAndPreferencesOf<ItemStatement>;

type ItemClosed = "process_not_found" | "process_not_open" | "stage_not_current";

export type ItemNotFound = "constraint_not_found" | "preference_not_found";

// O Ponto que distingue Restrições de Preferências está coberto e ficaria sem nenhuma delas.
export type ItemsRequired = "no_constraint_or_preference";

export type WithdrawalError = ItemClosed | ItemNotFound | "already_withdrawn" | ItemsRequired;

export interface ConstraintsAndPreferences {
  // Registra uma Restrição ou Preferência enquanto a Etapa R é a atual.
  register(processId: string, kind: ItemKind, item: ItemStatement): Promise<{ ok: true; item: StatedItem } | { ok: false; error: ItemClosed }>;
  withdraw(processId: string, kind: ItemKind, itemId: string): Promise<{ ok: true; item: StatedItem } | { ok: false; error: WithdrawalError }>;
}

// Tabela, e caminho na API, de cada tipo de item.
export const itemPaths = { constraint: "constraints", preference: "preferences" } as const;

const columns = ["id", "statement", "scope", "unit", "registeredAt", "withdrawnAt"] as const;

// Os itens existem a partir da Etapa R; as anteriores não os têm como contexto.
export const itemsApplyTo = (stage: Stage): boolean => stages.indexOf(stage) >= stages.indexOf("R");

async function itemsOf(db: Db, kind: ItemKind, processId: string): Promise<StatedItem[]> {
  return db
    .selectFrom(itemPaths[kind])
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

const inForce = (items: StatedItem[]): StatedItem[] => items.filter((item) => item.withdrawnAt === null);

// As Restrições e Preferências em vigor.
export const inForceOf = ({ constraints, preferences }: ConstraintsAndPreferencesState): ConstraintsAndPreferencesState => ({
  constraints: inForce(constraints),
  preferences: inForce(preferences),
});

export const hasAny = ({ constraints, preferences }: ConstraintsAndPreferencesOf<unknown>): boolean =>
  constraints.length + preferences.length > 0;

export const statementOf = ({ statement, scope, unit }: ItemStatement): ItemStatement => ({ statement, scope, unit });

export const statementsOf = ({ constraints, preferences }: ConstraintsAndPreferencesOf<ItemStatement>): ItemStatements => ({
  constraints: constraints.map(statementOf),
  preferences: preferences.map(statementOf),
});

// As Restrições e Preferências em vigor, como a IA as recebe.
export async function statementsInForceOf(db: Db, processId: string): Promise<ItemStatements> {
  return statementsOf(inForceOf(await constraintsAndPreferencesOf(db, processId)));
}

const optionalText = (value: string | null): string | null => value?.trim() || null;

// Trava o Processo para a transação; Restrições e Preferências só mudam enquanto R é a Etapa atual.
async function lockStageR(
  trx: Db,
  processId: string,
): Promise<{ ok: true; process: { id: string; stagePointsVersion: number } } | { ok: false; error: ItemClosed }> {
  const process = await trx
    .selectFrom("processes")
    .select(["id", "status", "currentStage", "stagePointsVersion"])
    .where("id", "=", processId)
    .forUpdate()
    .executeTakeFirst();
  if (!process) return { ok: false, error: "process_not_found" };
  if (process.status !== "open") return { ok: false, error: "process_not_open" };
  if (process.currentStage !== "R") return { ok: false, error: "stage_not_current" };
  return { ok: true, process };
}

export function constraintsAndPreferences({ db }: { db: Db }): ConstraintsAndPreferences {
  return {
    async register(processId, kind, { statement, scope, unit }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageR(trx, processId);
        if (!locked.ok) return locked;
        const item = await trx
          .insertInto(itemPaths[kind])
          .values({ processId, statement: statement.trim(), scope: optionalText(scope), unit: optionalText(unit) })
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
          .selectFrom(itemPaths[kind])
          .select("withdrawnAt")
          .where("id", "=", itemId)
          .where("processId", "=", processId)
          .executeTakeFirst();
        if (!found) return { ok: false, error: `${kind}_not_found` } as const;
        if (found.withdrawnAt !== null) return { ok: false, error: "already_withdrawn" } as const;
        // Coberto, o Ponto que distingue Restrições de Preferências não fica sem nenhuma delas.
        const { constraints, preferences } = inForceOf(await constraintsAndPreferencesOf(trx, processId));
        const lastOne = constraints.length + preferences.length === 1;
        const covered = (await stagePointStates(trx, locked.process, "R")).some(
          (point) => point.status === "covered" && findStagePoint(locked.process.stagePointsVersion, "R", point.key)?.needsConstraintsOrPreferences,
        );
        if (lastOne && covered) return { ok: false, error: "no_constraint_or_preference" } as const;
        const item = await trx
          .updateTable(itemPaths[kind])
          .set({ withdrawnAt: sql<Date>`clock_timestamp()` })
          .where("id", "=", itemId)
          .returning(columns)
          .executeTakeFirstOrThrow();
        return { ok: true, item } as const;
      });
    },
  };
}
