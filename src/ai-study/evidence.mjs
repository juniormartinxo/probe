import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.mjs';

export const SCHEMA_VERSION = 1;
export const LOCK_NAME = '.collection.lock';

// Substituição atômica: o destino contém o JSON anterior ou o novo, nunca um parcial. O temporário é
// gravado e sincronizado por inteiro antes da troca; uma interrupção pode deixá-lo para trás, mas ele
// nunca é lido como evidência (loadRun). Escopo: queda do processo (AC 30). O diretório não é
// sincronizado depois do rename, então uma queda do sistema logo após a troca pode voltar ao arquivo anterior,
// que continua íntegro.
export function writeJsonAtomic(path, value) {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(path, text) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx');
  try {
    writeSync(fd, text);
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
  if (!holder) {
    // A trava é criada antes de receber o conteúdo: vazia, outra coleta pode estar começando agora, ou uma
    // coleta caiu entre criar e escrever.
    return (
      `a trava ${path} está vazia ou ilegível: outra coleta pode estar começando agora; ` +
      'se nenhuma estiver em andamento, remova o arquivo para coletar de novo'
    );
  }
  return `outra coleta (processo ${holder.pid}) está em andamento neste diretório de evidências; aguarde seu término`;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
