import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { UsageError } from './errors.mjs';

export const JUDGMENT_IDS = Object.freeze([
  'b_depends_on_a',
  'a_depends_on_b',
  'complements',
  'change_a_affects_b',
  'same_block',
  'answers_conflict',
]);
export const CHOICES = Object.freeze(['yes', 'no', 'insufficient']);
export const RELATIONAL_IDS = Object.freeze(sequence('R', 12));
export const TRANSLATION_IDS = Object.freeze(sequence('T', 6));

function sequence(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
}

// Lê, valida e identifica o corpus. Qualquer problema é configuração inválida (código 2).
export function loadCorpus(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new UsageError(`CORPUS ilegível (${path}): ${error.code ?? error.message}`);
  }
  let corpus;
  try {
    corpus = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new UsageError(`CORPUS inválido (${path}): JSON malformado`);
  }
  const problems = validateCorpus(corpus);
  if (problems.length > 0) {
    throw new UsageError(`CORPUS inválido (${path}):\n  - ${problems.join('\n  - ')}`);
  }
  return {
    path,
    corpus,
    revision: corpus.revision,
    fileHash: sha256(bytes),
    corpusHash: sha256(canonicalJson(corpusContent(corpus))),
    gabaritoHash: sha256(canonicalJson(gabaritoContent(corpus))),
  };
}

export function fileHash(path) {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

// Textos e estrutura, sem as referências de avaliação.
function corpusContent(corpus) {
  return {
    ...corpus,
    relational_cases: corpus.relational_cases.map(({ expectations, ...rest }) => rest),
    translation_cases: corpus.translation_cases.map(({ invariants, ...rest }) => rest),
  };
}

// Gabarito: expectativas com justificativas e invariantes de revisão das traduções.
function gabaritoContent(corpus) {
  return {
    revision: corpus.revision,
    relational_cases: corpus.relational_cases.map(({ id, expectations }) => ({ id, expectations })),
    translation_cases: corpus.translation_cases.map(({ id, invariants }) => ({ id, invariants })),
  };
}

// Resultados comparados precisam do mesmo corpus e gabarito.
export function assertSameReference(records) {
  const keys = new Set(records.map((r) => `${r.corpus_hash}|${r.gabarito_hash}`));
  if (keys.size > 1) {
    throw new UsageError('resultados de corpus ou gabarito diferentes não podem ser comparados');
  }
}

export function sha256(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateCorpus(corpus) {
  const problems = [];
  if (!isObject(corpus)) return ['o corpus deve ser um objeto JSON'];
  exactKeys(corpus, ['schema_version', 'revision', 'source', 'judgments', 'relational_cases', 'translation_cases'], 'corpus', problems);
  if (corpus.schema_version !== 1) problems.push('schema_version deve ser 1');
  if (!Number.isInteger(corpus.revision) || corpus.revision < 1) problems.push('revision deve ser inteiro positivo');
  if (typeof corpus.source !== 'string') problems.push('source deve ser texto');

  const judgments = listOf(corpus.judgments, 'judgments', problems);
  checkIds(judgments.map((j) => j?.id), JUDGMENT_IDS, 'judgments', problems);
  for (const j of judgments) {
    exactKeys(j, ['id', 'question', 'scope'], `judgments/${j?.id}`, problems);
    nonEmpty(j, ['question', 'scope'], `judgments/${j?.id}`, problems);
  }

  const relational = listOf(corpus.relational_cases, 'relational_cases', problems);
  checkIds(relational.map((r) => r?.id), RELATIONAL_IDS, 'relational_cases', problems);
  for (const r of relational) {
    const where = `relational_cases/${r?.id}`;
    exactKeys(r, ['id', 'title', 'context', 'a', 'b', 'proposed_change_a', 'expectations'], where, problems);
    nonEmpty(r, ['title', 'context', 'proposed_change_a'], where, problems);
    for (const side of ['a', 'b']) {
      exactKeys(r?.[side], ['question', 'answer'], `${where}/${side}`, problems);
      nonEmpty(r?.[side], ['question', 'answer'], `${where}/${side}`, problems);
    }
    validateExpectations(r?.expectations, where, problems);
  }

  const translation = listOf(corpus.translation_cases, 'translation_cases', problems);
  checkIds(translation.map((t) => t?.id), TRANSLATION_IDS, 'translation_cases', problems);
  for (const t of translation) {
    const where = `translation_cases/${t?.id}`;
    exactKeys(t, ['id', 'title', 'source_language', 'target_language', 'original', 'invariants'], where, problems);
    nonEmpty(t, ['title', 'original', 'invariants'], where, problems);
    if (t?.source_language !== 'en' || t?.target_language !== 'pt') problems.push(`${where}: direção deve ser en→pt`);
  }
  return problems;
}

function validateExpectations(expectations, where, problems) {
  if (!Array.isArray(expectations)) {
    problems.push(`${where}: expectations deve ser uma lista`);
    return;
  }
  const seen = new Map();
  for (const e of expectations) {
    const label = `${where}/${e?.judgment}`;
    exactKeys(e, ['judgment', 'expected', 'justification'], label, problems);
    if (!JUDGMENT_IDS.includes(e?.judgment)) problems.push(`${where}: julgamento desconhecido ${e?.judgment}`);
    seen.set(e?.judgment, (seen.get(e?.judgment) ?? 0) + 1);
    if (!CHOICES.includes(e?.expected)) problems.push(`${label}: expected deve ser yes, no ou insufficient`);
    if (typeof e?.justification !== 'string' || e.justification.trim() === '') {
      problems.push(`${label}: justification vazia ou ausente`);
    }
  }
  for (const id of JUDGMENT_IDS) {
    const count = seen.get(id) ?? 0;
    if (count === 0) problems.push(`${where}: julgamento ausente ${id}`);
    if (count > 1) problems.push(`${where}: julgamento duplicado ${id}`);
  }
}

function checkIds(ids, expected, where, problems) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = expected.filter((id) => !counts.has(id));
  const extra = [...counts.keys()].filter((id) => !expected.includes(id));
  const repeated = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  if (missing.length) problems.push(`${where}: IDs ausentes ${missing.join(', ')}`);
  if (extra.length) problems.push(`${where}: IDs extras ${extra.join(', ')}`);
  if (repeated.length) problems.push(`${where}: IDs repetidos ${repeated.join(', ')}`);
  if (!missing.length && !extra.length && !repeated.length && ids.some((id, i) => id !== expected[i])) {
    problems.push(`${where}: IDs fora da ordem numérica`);
  }
}

function listOf(value, where, problems) {
  if (Array.isArray(value)) return value;
  problems.push(`${where} deve ser uma lista`);
  return [];
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, where, problems) {
  if (!isObject(value)) {
    problems.push(`${where}: deve ser um objeto`);
    return;
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) problems.push(`${where}: campo ausente ${key}`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) problems.push(`${where}: campo extra ${key}`);
}

function nonEmpty(value, keys, where, problems) {
  if (!isObject(value)) return;
  for (const key of keys) {
    if (typeof value[key] !== 'string' || value[key].trim() === '') problems.push(`${where}: ${key} vazio`);
  }
}
