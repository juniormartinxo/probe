import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';

import { UsageError } from './errors.mjs';

export const SCHEMA_VERSION = 1;

// Substituição atômica: o destino contém o JSON anterior ou o novo, nunca um parcial.
export function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
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
