import { sql } from "kysely";
import type { Db } from "../../db/database.ts";
import { lockOpenProcess } from "./process.ts";
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
  // Revisão de Restrição avulsa, sem Pendência de conflito, depois da Etapa R (nela, o registro e a
  // retirada bastam); as Confirmações de Etapa que sustentavam a Restrição passam pela Avaliação de impacto.
  revise(
    processId: string,
    constraintId: string,
    revision: ConstraintRevisionRequest,
  ): Promise<{ ok: true; revision: ConstraintRevision } | { ok: false; error: ItemClosed | ConstraintRevisionError }>;
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

// Trava o Processo para a transação. O registro e a retirada avulsos só valem enquanto R é a Etapa
// atual; depois, uma Restrição só muda pela Revisão de Restrição.
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

// Registra o item; chamar com o Processo travado.
async function registerIn(trx: Db, processId: string, kind: ItemKind, { statement, scope, unit }: ItemStatement): Promise<StatedItem> {
  return trx
    .insertInto(itemPaths[kind])
    .values({ processId, statement: statement.trim(), scope: optionalText(scope), unit: optionalText(unit) })
    .returning(columns)
    .executeTakeFirstOrThrow();
}

// Retira o item em vigor; chamar com o Processo travado.
async function withdrawIn(
  trx: Db,
  process: { id: string; stagePointsVersion: number },
  kind: ItemKind,
  itemId: string,
): Promise<{ ok: true; item: StatedItem } | { ok: false; error: ItemNotFound | "already_withdrawn" | ItemsRequired }> {
  const found = await trx
    .selectFrom(itemPaths[kind])
    .select("withdrawnAt")
    .where("id", "=", itemId)
    .where("processId", "=", process.id)
    .executeTakeFirst();
  if (!found) return { ok: false, error: `${kind}_not_found` };
  if (found.withdrawnAt !== null) return { ok: false, error: "already_withdrawn" };
  // Coberto, o Ponto que distingue Restrições de Preferências não fica sem nenhuma delas.
  const { constraints, preferences } = inForceOf(await constraintsAndPreferencesOf(trx, process.id));
  const lastOne = constraints.length + preferences.length === 1;
  const covered = (await stagePointStates(trx, process, "R")).some(
    (point) => point.status === "covered" && findStagePoint(process.stagePointsVersion, "R", point.key)?.needsConstraintsOrPreferences,
  );
  if (lastOne && covered) return { ok: false, error: "no_constraint_or_preference" };
  const item = await trx
    .updateTable(itemPaths[kind])
    .set({ withdrawnAt: sql<Date>`clock_timestamp()` })
    .where("id", "=", itemId)
    .returning(columns)
    .executeTakeFirstOrThrow();
  return { ok: true, item };
}

// O que substitui a Restrição revista: uma Restrição nova ou uma Preferência.
export interface ItemReplacement {
  kind: ItemKind;
  item: ItemStatement;
}

// Revisão de Restrição: o usuário retirou uma Restrição em vigor e registrou a que a substitui, se
// houver (uma Restrição nova ou uma Preferência), com uma nota; as duas ficam no histórico. Vale em
// qualquer Etapa a partir de R: como resolução de uma Pendência de conflito ou avulsa.
export interface ConstraintRevision {
  id: string;
  constraint: StatedItem;
  replacement: { kind: ItemKind; item: StatedItem } | null;
  note: string | null;
  // A Pendência de conflito que ela resolveu.
  conflictPendencyId: string | null;
  revisedAt: Date;
}

// As Revisões de Restrição do Processo, na ordem em que foram feitas. Com `ids`, só essas.
export async function constraintRevisionsOf(db: Db, processId: string, ids?: string[]): Promise<ConstraintRevision[]> {
  if (ids?.length === 0) return [];
  let query = db
    .selectFrom("constraintRevisions")
    .selectAll()
    .where("processId", "=", processId)
    .orderBy("revisedAt")
    .orderBy("id");
  if (ids) query = query.where("id", "in", ids);
  const rows = await query.execute();
  if (rows.length === 0) return [];
  const { constraints, preferences } = await constraintsAndPreferencesOf(db, processId);
  const constraintOf = (id: string) => constraints.find((item) => item.id === id)!;
  return rows.map((row) => ({
    id: row.id,
    constraint: constraintOf(row.constraintId),
    replacement:
      row.replacementConstraintId !== null
        ? { kind: "constraint", item: constraintOf(row.replacementConstraintId) }
        : row.replacementPreferenceId !== null
          ? { kind: "preference", item: preferences.find((item) => item.id === row.replacementPreferenceId)! }
          : null,
    note: row.note,
    conflictPendencyId: row.conflictPendencyId,
    revisedAt: row.revisedAt,
  }));
}

export type ConstraintRevisionError = "constraint_not_found" | "already_withdrawn" | ItemsRequired;

// O que o usuário pede ao rever uma Restrição: a substituta, se houver, e uma nota.
export interface ConstraintRevisionRequest {
  replacement: ItemReplacement | null;
  note: string | null;
}

// Revisão de Restrição: retira a Restrição em vigor, registra a que a substitui, se houver, e grava a
// revisão, com a Pendência de conflito que ela resolve, se for o caso. Chamar com o Processo aberto
// travado; numa Etapa antes de R não há Restrição a rever.
export async function reviseConstraintIn(
  trx: Db,
  process: { id: string; stagePointsVersion: number },
  constraintId: string,
  { replacement, note, conflictPendencyId }: ConstraintRevisionRequest & { conflictPendencyId: string | null },
): Promise<{ ok: true; revision: ConstraintRevision } | { ok: false; error: ConstraintRevisionError }> {
  // Verificada antes de registrar a substituta: uma recusa não deixa nada gravado.
  const found = await trx
    .selectFrom("constraints")
    .select("withdrawnAt")
    .where("id", "=", constraintId)
    .where("processId", "=", process.id)
    .executeTakeFirst();
  if (!found) return { ok: false, error: "constraint_not_found" };
  if (found.withdrawnAt !== null) return { ok: false, error: "already_withdrawn" };
  // A substituta entra antes: com ela, a retirada não deixa o Ponto sem nenhuma Restrição ou Preferência.
  const registered = replacement && { kind: replacement.kind, item: await registerIn(trx, process.id, replacement.kind, replacement.item) };
  const withdrawn = await withdrawIn(trx, process, "constraint", constraintId);
  if (!withdrawn.ok) return { ok: false, error: withdrawn.error === "preference_not_found" ? "constraint_not_found" : withdrawn.error };
  const { id } = await trx
    .insertInto("constraintRevisions")
    .values({
      processId: process.id,
      constraintId,
      replacementConstraintId: registered?.kind === "constraint" ? registered.item.id : null,
      replacementPreferenceId: registered?.kind === "preference" ? registered.item.id : null,
      note: optionalText(note),
      conflictPendencyId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const [revision] = await constraintRevisionsOf(trx, process.id, [id]);
  return { ok: true, revision: revision! };
}

// `afterConstraintRevision`: chamado depois de uma Revisão de Restrição; quem o recebe avalia o impacto
// dela sobre as Confirmações de Etapa. Não lança.
export function constraintsAndPreferences({
  db,
  afterConstraintRevision,
}: {
  db: Db;
  afterConstraintRevision: (processId: string) => Promise<void>;
}): ConstraintsAndPreferences {
  return {
    async register(processId, kind, item) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageR(trx, processId);
        if (!locked.ok) return locked;
        return { ok: true, item: await registerIn(trx, processId, kind, item) } as const;
      });
    },

    async withdraw(processId, kind, itemId) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockStageR(trx, processId);
        if (!locked.ok) return locked;
        return withdrawIn(trx, locked.process, kind, itemId);
      });
    },

    async revise(processId, constraintId, revision) {
      const revised = await db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcess(trx, processId);
        if (!locked.ok) return locked;
        if (stages.indexOf(locked.process.currentStage) <= stages.indexOf("R")) return { ok: false, error: "stage_not_current" } as const;
        return reviseConstraintIn(trx, locked.process, constraintId, { ...revision, conflictPendencyId: null });
      });
      if (revised.ok) await afterConstraintRevision(processId);
      return revised;
    },
  };
}
