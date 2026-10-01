// Pré-carga só de teste (NODE_OPTIONS=--import): interrompe o processo com SIGKILL na n-ésima troca
// atômica cujo destino casa com o padrão, antes ou depois do rename. Sem limpeza possível: simula queda.
// AI_STUDY_TEST_INTERRUPT=<before|after>:<regex do nome do destino>:<n>
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';

const [when, pattern, nth] = (process.env.AI_STUDY_TEST_INTERRUPT ?? '').split(':');
const target = new RegExp(pattern);
const realRename = fs.renameSync;
let seen = 0;

fs.renameSync = function renameSync(from, to) {
  if (target.test(basename(String(to)))) seen += 1;
  const hit = seen === Number(nth) && target.test(basename(String(to)));
  if (hit && when === 'before') process.kill(process.pid, 'SIGKILL');
  const result = realRename(from, to);
  if (hit && when === 'after') process.kill(process.pid, 'SIGKILL');
  return result;
};
syncBuiltinESMExports();
