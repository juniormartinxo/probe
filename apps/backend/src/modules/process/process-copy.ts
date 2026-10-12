import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Db } from "../../db/database.ts";

// Cada tabela que a cópia de um Processo leva, pela coluna que liga o registro ao dono: o Processo ou
// um registro de uma tabela anterior da lista.
const copiedTables: { table: string; owner: { column: string; table: string } }[] = [
  ...["ai_requests", "problem_statements", "blocks", "stage_point_coverage", "pendencies", "stage_assessments", "stage_confirmations"].map(
    (table) => ({ table, owner: { column: "process_id", table: "processes" } }),
  ),
  { table: "ai_request_attempts", owner: { column: "ai_request_id", table: "ai_requests" } },
  { table: "questions", owner: { column: "block_id", table: "blocks" } },
  { table: "answer_versions", owner: { column: "question_id", table: "questions" } },
  { table: "attempt_answer_versions", owner: { column: "attempt_id", table: "ai_request_attempts" } },
  { table: "block_syntheses", owner: { column: "block_id", table: "blocks" } },
  { table: "stage_assessment_answer_versions", owner: { column: "stage_assessment_id", table: "stage_assessments" } },
  { table: "assessments", owner: { column: "stage_assessment_id", table: "stage_assessments" } },
  ...[
    "constraints",
    "preferences",
    "impact_assessments",
    "confirmation_answer_versions",
    "conflict_checks",
    "conflict_assessments",
    "constraint_revisions",
    "confirmation_constraint_revisions",
    "options",
    "option_checks",
    "option_assessments",
    "chosen_options",
    "execution_plan_elements",
    "plan_assessments",
  ].map((table) => ({ table, owner: { column: "process_id", table: "processes" } })),
  { table: "conflict_pairs", owner: { column: "check_id", table: "conflict_checks" } },
  { table: "conflict_verdicts", owner: { column: "assessment_id", table: "conflict_assessments" } },
  { table: "conflict_dismissals", owner: { column: "pair_id", table: "conflict_pairs" } },
  { table: "option_constraint_pairs", owner: { column: "check_id", table: "option_checks" } },
  { table: "option_verdicts", owner: { column: "assessment_id", table: "option_assessments" } },
  { table: "option_decisions", owner: { column: "pair_id", table: "option_constraint_pairs" } },
  { table: "option_comparisons", owner: { column: "option_id", table: "options" } },
  { table: "choice_discards", owner: { column: "chosen_option_id", table: "chosen_options" } },
  { table: "plan_decisions", owner: { column: "plan_assessment_id", table: "plan_assessments" } },
];

// As tabelas ligadas ao Processo que a cópia deixa de fora: a Conversa (a cópia abre a sua), os
// rascunhos (o que o usuário não salvou), a Finalização (a cópia nasce aberta) e a própria Derivação.
const leftOutTables = new Set(["conversations", "answer_drafts", "finalizations", "derivations", "derivation_copies"]);

interface ForeignKey {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

// As chaves estrangeiras e os tipos das colunas, como o banco os declara: a cópia segue o esquema, e
// uma tabela nova ligada ao Processo que não estiver classificada acima faz a cópia falhar.
async function schemaOf(db: Kysely<any>) {
  const { rows: foreignKeys } = await sql<ForeignKey>`
    select t.relname as "table", r.relname as "refTable",
      array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, i)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.i) as "columns",
      array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, i)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.i) as "refColumns"
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class r on r.oid = c.confrelid
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = current_schema()`.execute(db);
  const { rows: columns } = await sql<{ table: string; column: string; type: string }>`
    select table_name as "table", column_name as "column", udt_name as "type"
    from information_schema.columns where table_schema = current_schema()`.execute(db);
  const types = new Map<string, Map<string, string>>();
  for (const { table, column, type } of columns) types.set(table, (types.get(table) ?? new Map()).set(column, type));
  return { foreignKeys, types };
}

// Toda tabela que depende do Processo ou de uma tabela copiada precisa estar classificada.
function checkClassified(foreignKeys: ForeignKey[]): void {
  const copied = new Set(["processes", ...copiedTables.map(({ table }) => table)]);
  const unclassified = foreignKeys
    .filter((fk) => copied.has(fk.refTable) && !copied.has(fk.table) && !leftOutTables.has(fk.table))
    .map((fk) => fk.table);
  if (unclassified.length > 0) throw new Error(`Tabelas ligadas ao Processo fora da cópia: ${[...new Set(unclassified)].join(", ")}.`);
}

type Row = Record<string, unknown>;

// O id no lugar de cada id copiado, em qualquer ponto de um JSON (o resultado de uma tentativa da IA
// guarda Opções pelos ids, por exemplo).
function remapJson(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapJson(item, ids));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapJson(item, ids)]));
  }
  return value;
}

const keyOf = (table: string, columns: string[], values: unknown[]) => `${table}(${columns.join(",")})=${values.join(",")}`;

// Até quantas linhas vão num único insert: o PostgreSQL aceita até 65535 parâmetros por comando.
const INSERT_CHUNK = 500;

export interface CopiedRecord {
  table: string;
  originId: string;
  copyId: string;
}

// Copia os registros do Processo de origem para o Processo novo, já criado: cada registro ganha um id
// novo, e toda referência a outro registro da origem passa a apontar para a cópia dele. Nada da cópia
// aponta para a origem. Devolve, de cada registro com id, o id na origem e o da cópia.
export async function copyProcessRecords(trx: Db, originId: string, copyId: string): Promise<CopiedRecord[]> {
  const raw = trx.withoutPlugins() as unknown as Kysely<any>;
  const { foreignKeys, types } = await schemaOf(raw);
  checkClassified(foreignKeys);

  const rowsByTable = new Map<string, Row[]>([["processes", [{ id: originId }]]]);
  for (const { table, owner } of copiedTables) {
    const ownerIds = rowsByTable.get(owner.table)!.map((row) => row.id);
    const rows = ownerIds.length === 0 ? [] : await raw.selectFrom(table).selectAll().where(owner.column, "in", ownerIds).execute();
    rowsByTable.set(table, rows);
  }

  const ids = new Map<string, string>([[originId, copyId]]);
  const copied: CopiedRecord[] = [];
  for (const { table } of copiedTables) {
    if (types.get(table)?.get("id") !== "uuid") continue;
    for (const row of rowsByTable.get(table)!) {
      const id = randomUUID();
      ids.set(row.id as string, id);
      copied.push({ table, originId: row.id as string, copyId: id });
    }
  }

  const remap = (table: string, row: Row): Row =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => {
        const type = types.get(table)!.get(column);
        if (value === null) return [column, value];
        const mapped = (id: string) => {
          const found = ids.get(id);
          if (!found) throw new Error(`${table}.${column} aponta para um registro fora do Processo copiado.`);
          return found;
        };
        if (type === "uuid") return [column, mapped(value as string)];
        if (type === "_uuid") return [column, (value as string[]).map(mapped)];
        if (type === "jsonb" || type === "json") return [column, JSON.stringify(remapJson(value, ids))];
        return [column, value];
      }),
    );

  // As chaves por que outras tabelas referenciam cada uma (o id, ou o Processo e a Etapa numa
  // Confirmação de Etapa, por exemplo).
  const referencedBy = new Map<string, string[][]>();
  for (const fk of foreignKeys) {
    const keys = referencedBy.get(fk.refTable) ?? [];
    if (!keys.some((columns) => columns.join() === fk.refColumns.join())) keys.push(fk.refColumns);
    referencedBy.set(fk.refTable, keys);
  }

  // Cada registro entra depois dos que ele referencia: a ordem sai dos próprios registros, porque entre
  // tabelas há ciclos (uma Pendência de conflito e a Revisão de Restrição que a resolve, por exemplo).
  const inserted = new Set((referencedBy.get("processes") ?? []).map((columns) => keyOf("processes", columns, columns.map(() => originId))));
  let pending = copiedTables.flatMap(({ table }) =>
    rowsByTable.get(table)!.map((row) => ({
      table,
      row,
      needs: foreignKeys
        .filter((fk) => fk.table === table && fk.columns.every((column) => row[column] !== null))
        .map((fk) => keyOf(fk.refTable, fk.refColumns, fk.columns.map((column) => row[column]))),
      provides: (referencedBy.get(table) ?? []).map((columns) => keyOf(table, columns, columns.map((column) => row[column]))),
    })),
  );
  while (pending.length > 0) {
    const ready = pending.filter((item) => item.needs.every((key) => inserted.has(key)));
    if (ready.length === 0) throw new Error(`Registros sem como entrar na cópia: ${[...new Set(pending.map((item) => item.table))].join(", ")}.`);
    for (const { table } of copiedTables) {
      const rows = ready.filter((item) => item.table === table).map((item) => remap(table, item.row));
      for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
        await raw.insertInto(table).values(rows.slice(start, start + INSERT_CHUNK)).execute();
      }
    }
    for (const item of ready) for (const key of item.provides) inserted.add(key);
    const done = new Set(ready);
    pending = pending.filter((item) => !done.has(item));
  }
  return copied;
}
