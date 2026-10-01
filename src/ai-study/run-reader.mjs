import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARMS } from './comparison.mjs';
import { isObject } from './corpus.mjs';
import { UsageError } from './errors.mjs';
import { SCHEMA_VERSION } from './evidence.mjs';

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TEMPORARY_FILE = /\.tmp$/;

function readJsonFile(path, label, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${label}: ${error.code === 'ENOENT' ? 'ausente' : 'JSON inválido ou parcial'}`);
    return null;
  }
}

// Leitura das evidências de uma execução, para o relatório: só aceita arquivos JSON íntegros com
// `schema_version: 1` vinculados a esta execução e à revisão do corpus do manifesto. Temporários e
// resultados que o manifesto não confirma ficam em `ignored`, nunca como evidência. Qualquer vínculo a
// outra execução, revisão ou versão de schema recusa a execução inteira (código 2).
export function loadRun(evidenceDir, runId, { corpusInfo = null } = {}) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) throw new UsageError('RUN_ID inválido para leitura de evidências');
  const runDir = join(evidenceDir, runId);
  if (!existsSync(runDir)) throw new UsageError(`RUN_ID ${runId} não tem evidências em ${runDir}`);
  const problems = [];
  const ignored = [];
  const manifest = readJsonFile(join(runDir, 'manifest.json'), 'manifest.json', problems);
  if (!manifest) throw refused(runId, problems);

  if (manifest.schema_version !== SCHEMA_VERSION) problems.push(`manifest.json: schema_version ${JSON.stringify(manifest.schema_version)} não é ${SCHEMA_VERSION}`);
  if (manifest.run_id !== runId) problems.push(`manifest.json: pertence à execução ${manifest.run_id}`);
  const reference = { corpus_hash: manifest.corpus?.corpus_hash, gabarito_hash: manifest.corpus?.gabarito_hash };
  if (corpusInfo && (reference.corpus_hash !== corpusInfo.corpusHash || reference.gabarito_hash !== corpusInfo.gabaritoHash)) {
    problems.push('manifest.json: revisão de corpus ou gabarito diferente da esperada');
  }
  const planned = new Map((manifest.planned_items ?? []).map((id, index) => [id, index + 1]));
  const completed = new Set(manifest.completed_items ?? []);

  const sameRun = (label, record) => {
    if (record.schema_version !== SCHEMA_VERSION) problems.push(`${label}: schema_version ${JSON.stringify(record.schema_version)} não é ${SCHEMA_VERSION}`);
    if (record.run_id !== runId) problems.push(`${label}: pertence à execução ${record.run_id}`);
    if (record.corpus_hash !== reference.corpus_hash || record.gabarito_hash !== reference.gabarito_hash) {
      problems.push(`${label}: revisão de corpus ou gabarito diferente da execução`);
    }
  };

  const results = [];
  const resultsDir = join(runDir, 'results');
  for (const file of existsSync(resultsDir) ? readdirSync(resultsDir).sort() : []) {
    if (TEMPORARY_FILE.test(file)) {
      ignored.push({ file: `results/${file}`, reason: 'temporary' });
      continue;
    }
    if (!file.endsWith('.json')) {
      ignored.push({ file: `results/${file}`, reason: 'not_evidence' });
      continue;
    }
    const label = `results/${file}`;
    const record = readJsonFile(join(resultsDir, file), label, problems);
    if (!record) continue;
    sameRun(label, record);
    const item = record.item ?? {};
    if (!planned.has(item.id)) {
      problems.push(`${label}: item ${item.id} fora dos itens planejados`);
      continue;
    }
    if (file !== `${String(planned.get(item.id)).padStart(3, '0')}-${item.id}.json` || record.sequence !== planned.get(item.id)) {
      problems.push(`${label}: nome ou sequência não correspondem ao item ${item.id}`);
    }
    if (!completed.has(item.id)) {
      ignored.push({ file: label, reason: 'not_in_manifest' });
      continue;
    }
    if (item.kind === 'translation') {
      const t = record.translation;
      if (!t || t.id !== item.id || t.run_id !== runId || t.case_id !== item.case_id || t.direction !== item.direction || typeof t.original !== 'string') {
        problems.push(`${label}: tradução não vinculada ao item, caso, direção e original desta execução`);
      }
    } else {
      const e = record.evaluation;
      if (!e || e.run_id !== runId || e.case_id !== item.case_id || e.arm !== item.arm) {
        problems.push(`${label}: avaliação não vinculada ao caso e braço desta execução`);
      }
    }
    results.push(record);
  }

  const byItem = new Map(results.map((r) => [r.item.id, r]));
  for (const id of completed) if (!byItem.has(id)) problems.push(`item concluído ${id} sem resultado`);
  for (const r of results.filter((x) => x.item.kind === 'evaluation' && x.item.arm === 'en')) {
    const source = byItem.get(r.derived_from);
    if (!source || source.item.kind !== 'translation' || source.item.case_id !== r.item.case_id) {
      problems.push(`${r.item.id}: braço inglês sem tradução de origem do mesmo caso nesta execução`);
    }
  }

  let comparison = null;
  if (existsSync(join(runDir, 'comparison.json'))) {
    comparison = readJsonFile(join(runDir, 'comparison.json'), 'comparison.json', problems);
    if (comparison) {
      sameRun('comparison.json', comparison);
      problems.push(...comparisonShapeProblems(comparison, byItem));
    }
  }
  for (const file of readdirSync(runDir).filter((f) => TEMPORARY_FILE.test(f))) ignored.push({ file, reason: 'temporary' });

  if (problems.length > 0) throw refused(runId, problems);
  return { runDir, manifest, results, byItem, comparison, ignored };
}

// Forma que o relatório lê da comparação: avaliações das evidências desta execução, contagens inteiras
// pelos mesmos julgamentos nos dois braços e pares completos com os dois braços avaliados. Comparação
// malformada é evidência recusada (código 2), não erro interno.
function comparisonShapeProblems(comparison, byItem) {
  const problems = [];
  const label = 'comparison.json';
  const evaluations = Array.isArray(comparison.evaluations) ? comparison.evaluations : null;
  if (!evaluations) problems.push(`${label}: evaluations deve ser uma lista`);
  for (const e of evaluations ?? []) {
    const record = byItem.get(e?.item);
    if (!record || record.item.kind !== 'evaluation' || record.item.case_id !== e.case_id || record.item.arm !== e.arm || record.evaluation.status !== e.status) {
      problems.push(`${label}: avaliação ${e?.item} não corresponde a um resultado desta execução`);
    } else if (!Array.isArray(e.judgments) || e.judgments.some((j) => !isObject(j) || typeof j.judgment !== 'string')) {
      problems.push(`${label}: avaliação ${e.item} sem a lista de julgamentos`);
    }
  }
  if (!Array.isArray(comparison.pairs) || comparison.pairs.some((p) => !isObject(p) || !Array.isArray(p.reasons))) {
    problems.push(`${label}: pairs deve ser uma lista de pares com motivos`);
  }
  const { individual, paired } = comparison.counts ?? {};
  const judgments = Object.keys(individual?.by_arm?.[ARMS[0]] ?? {});
  const countsOk = (counts) =>
    ARMS.every((arm) =>
      isObject(counts?.by_arm?.[arm]) &&
      Object.keys(counts.by_arm[arm]).join() === judgments.join() &&
      judgments.every((j) => ['hit', 'miss', 'absent'].every((k) => Number.isInteger(counts.by_arm[arm][j]?.[k]))),
    );
  if (!Number.isInteger(individual?.denominator) || judgments.length === 0 || !countsOk(individual) || !countsOk(paired)) {
    problems.push(`${label}: contagens ausentes ou malformadas`);
  } else if (!Array.isArray(paired.cases) || paired.denominator !== paired.cases.length) {
    problems.push(`${label}: pares completos inconsistentes com o denominador pareado`);
  } else {
    for (const caseId of paired.cases) {
      const armsOk = ARMS.every((arm) => (evaluations ?? []).some((e) => e?.case_id === caseId && e.arm === arm && Array.isArray(e.judgments)));
      if (!armsOk) problems.push(`${label}: par completo ${caseId} sem os dois braços avaliados`);
    }
  }
  return problems;
}

function refused(runId, problems) {
  return new UsageError(`evidências de ${runId} recusadas:\n  - ${problems.join('\n  - ')}`);
}
