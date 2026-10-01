// Pré-carga só de teste (NODE_OPTIONS=--import): registra em AI_STUDY_FS_LOG cada caminho que a bancada
// abre, lê, lista ou consulta pelo módulo fs, para provar que ela não lê chats, perfis ou credenciais.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const logPath = process.env.AI_STUDY_FS_LOG;
const append = fs.appendFileSync;

function record(fn, target) {
  if (!logPath) return;
  const path = target instanceof URL ? fileURLToPath(target) : typeof target === 'string' ? target : null;
  if (path) append(logPath, `${JSON.stringify({ fn, path })}\n`);
}

const wrap = (owner, names, prefix = '') => {
  for (const name of names) {
    const original = owner[name];
    if (typeof original !== 'function') continue;
    owner[name] = function traced(target, ...rest) {
      record(`${prefix}${name}`, target);
      return original.call(this, target, ...rest);
    };
  }
};

wrap(fs, [
  'readFileSync', 'openSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'accessSync', 'opendirSync',
  'createReadStream', 'readFile', 'readdir', 'stat', 'lstat', 'open', 'access', 'opendir', 'realpathSync',
]);
wrap(fs.promises, ['readFile', 'open', 'readdir', 'stat', 'lstat', 'access', 'opendir'], 'promises.');
syncBuiltinESMExports();
