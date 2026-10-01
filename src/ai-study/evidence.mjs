import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.mjs';

export const SCHEMA_VERSION = 1;
export const LOCK_NAME = '.collection.lock';
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TEMPORARY = /\.tmp$/;

// Substituição atômica: o destino contém o JSON anterior ou o novo, nunca um parcial. O temporário é
// gravado e sincronizado por inteiro antes da troca; uma interrupção pode deixá-lo para trás, mas ele
// nunca é lido como evidência (loadRun).
export function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx');
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

// Uma execução existente nunca é reaproveitada nem sobrescrita.
export function createRunDir(evidenceDir, runDir, runId) {
  mkdirSync(evidenceDir, { recursive: true });
  try {
    mkdirSync(runDir);
  } catch (error) {
    if (error.code === 'EEXIST') throw new UsageError(`RUN_ID ${runId} já existe; a execução anterior não será sobrescrita`);
    throw error;
  }
  mkdirSync(`${runDir}/results`);
}

// Exclusão mútua local: uma coleta por diretório de evidências. A trava é criada de forma exclusiva
// (O_EXCL) e só o dono a remove. Uma trava de processo encerrado sem liberá-la não é tomada
// automaticamente: tomá-la sem corrida exigiria um protocolo que o Node não oferece, então a coleta
// recusa e o diagnóstico indica a remoção manual.
export function acquireCollectionLock(evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, LOCK_NAME);
  const owner = { pid: process.pid, token: randomUUID(), acquired_at: new Date().toISOString() };
  try {
    writeFileSync(path, JSON.stringify(owner), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new UsageError(describeLockHolder(path));
    throw error;
  }
  return function release() {
    try {
      if (JSON.parse(readFileSync(path, 'utf8')).token === owner.token) rmSync(path);
    } catch {
      // Trava já ausente ou de outro dono: nada a liberar.
    }
  };
}

function describeLockHolder(path) {
  let holder = null;
  try {
    holder = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Trava ainda sendo criada por outra coleta.
  }
  if (holder && Number.isInteger(holder.pid) && !isAlive(holder.pid)) {
    return (
      `a trava ${path} pertence ao processo ${holder.pid}, que terminou sem liberá-la; ` +
      'confira que nenhuma coleta está em andamento e remova o arquivo para coletar de novo'
    );
  }
  return `outra coleta${holder?.pid ? ` (processo ${holder.pid})` : ''} está em andamento neste diretório de evidências; aguarde seu término`;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

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
    if (TEMPORARY.test(file)) {
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
    if (comparison) sameRun('comparison.json', comparison);
  }
  for (const file of readdirSync(runDir).filter((f) => TEMPORARY.test(f))) ignored.push({ file, reason: 'temporary' });

  if (problems.length > 0) throw refused(runId, problems);
  return { runDir, manifest, results, comparison, ignored };
}

function refused(runId, problems) {
  return new UsageError(`evidências de ${runId} recusadas:\n  - ${problems.join('\n  - ')}`);
}
