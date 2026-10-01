import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extraKeys, isNonBlank, isObject, sha256 } from './corpus.mjs';
import { UsageError } from './errors.mjs';
import { SCHEMA_VERSION } from './evidence.mjs';

// Revisão humana de uma execução: arquivo preenchido pelo usuário no diretório da execução. O relatório
// só o lê; a bancada nunca o cria nem o altera.
export const REVIEW_FILE = 'review.json';
export const REVIEW_STATES = Object.freeze(['pending', 'faithful', 'meaning_changed']);
export const RECOMMENDATIONS = Object.freeze(['keep_candidate', 'reject_candidate', 'expand_study']);

// Vínculo à saída concreta: o hash do texto derivado literal, não só o ID do caso ou do item.
export function outputHash(text) {
  return typeof text === 'string' ? sha256(text) : null;
}

// Tradução sem entrada na revisão fica `pending`. Revisão de outra execução, de uma saída diferente da
// gravada ou fora do domínio recusa o relatório (código 2), sem adivinhar a intenção do revisor.
export function loadReview(runDir, runId, translations) {
  let raw;
  try {
    raw = readFileSync(join(runDir, REVIEW_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { present: false, translations: new Map(), recommendation: null };
    throw new UsageError(`${REVIEW_FILE} de ${runId} ilegível: ${error.code ?? error.message}`);
  }
  let review;
  try {
    review = JSON.parse(raw);
  } catch {
    throw new UsageError(`${REVIEW_FILE} de ${runId} recusado:\n  - JSON inválido`);
  }
  const problems = validateReview(review, runId, translations);
  if (problems.length > 0) throw new UsageError(`${REVIEW_FILE} de ${runId} recusado:\n  - ${problems.join('\n  - ')}`);
  return {
    present: true,
    translations: new Map((review.translations ?? []).map((entry) => [entry.item, entry])),
    recommendation: review.recommendation ?? null,
  };
}

export function validateReview(review, runId, translations) {
  if (!isObject(review)) return ['a revisão deve ser um objeto JSON'];
  const problems = [];
  extraKeys(review, ['schema_version', 'run_id', 'translations', 'recommendation'], 'revisão', problems);
  if (review.schema_version !== SCHEMA_VERSION) problems.push(`schema_version ${JSON.stringify(review.schema_version)} não é ${SCHEMA_VERSION}`);
  if (review.run_id !== runId) problems.push(`pertence à execução ${review.run_id}`);

  const outputs = new Map(translations.map((t) => [t.id, outputHash(t.derived_text)]));
  const entries = review.translations ?? [];
  if (!Array.isArray(entries)) problems.push('translations deve ser uma lista');
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const label = `translations/${entry?.item}`;
    if (!isObject(entry)) {
      problems.push(`${label}: deve ser um objeto`);
      continue;
    }
    extraKeys(entry, ['item', 'output_sha256', 'status', 'reviewer', 'justification'], label, problems);
    if (seen.has(entry.item)) problems.push(`${label}: revisão repetida`);
    seen.add(entry.item);
    if (!outputs.has(entry.item)) problems.push(`${label}: não é uma tradução concluída desta execução`);
    if (!REVIEW_STATES.includes(entry.status)) {
      problems.push(`${label}: status ${JSON.stringify(entry.status ?? null)} fora de ${REVIEW_STATES.join(', ')}`);
    }
    if (entry.status === 'pending' || !outputs.has(entry.item)) continue;
    if (!isNonBlank(entry.reviewer)) problems.push(`${label}: ${entry.status} exige revisor`);
    if (!isNonBlank(entry.justification)) problems.push(`${label}: ${entry.status} exige justificativa`);
    const expected = outputs.get(entry.item);
    if (expected === null) problems.push(`${label}: tradução sem saída para revisar`);
    else if (entry.output_sha256 !== expected) {
      problems.push(`${label}: output_sha256 não corresponde à saída gravada (${expected})`);
    }
  }

  const recommendation = review.recommendation ?? null;
  if (recommendation !== null) {
    if (!isObject(recommendation)) problems.push('recommendation deve ser um objeto ou null');
    else {
      extraKeys(recommendation, ['decision', 'reviewer', 'justification'], 'recommendation', problems);
      if (!RECOMMENDATIONS.includes(recommendation.decision)) {
        problems.push(`recommendation: decisão ${JSON.stringify(recommendation.decision ?? null)} fora de ${RECOMMENDATIONS.join(', ')}`);
      }
      if (!isNonBlank(recommendation.reviewer)) problems.push('recommendation: exige revisor');
      if (!isNonBlank(recommendation.justification)) problems.push('recommendation: exige justificativa');
    }
  }
  return problems;
}
