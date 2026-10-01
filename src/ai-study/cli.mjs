// Fronteira dos comandos `make ai-study-dry-run` e `make ai-study-run`.
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCollection, planItems } from './collect.mjs';
import { displayPath, evidenceDirFor, redact, resolveConfig } from './config.mjs';
import { loadCorpus } from './corpus.mjs';
import { IncompleteError, UsageError } from './errors.mjs';
import { createFixtureTransports } from './fixture.mjs';
import { createJevTransport } from './jev.mjs';
import { createLmStudioTransport } from './lmstudio.mjs';
import { formatDryRun, formatRunSummary } from './manifest.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const COMMANDS = ['dry-run', 'run'];

// Live usa somente o servidor local configurado e o endpoint oficial do Jev.
function createLiveTransports(config) {
  return { local: createLmStudioTransport(config), jev: createJevTransport(config) };
}

// Fixture nunca constrói transportes live, e não há opção para injetar respostas.
export function selectTransports(config, { createLiveTransports: createLive = createLiveTransports } = {}) {
  return config.mode === 'live' ? createLive(config) : createFixtureTransports();
}

export async function main(argv, env, io) {
  try {
    const [command, ...rest] = argv;
    if (!COMMANDS.includes(command)) throw new UsageError(`comando inválido: use ${COMMANDS.join(' ou ')}`);
    if (rest.length > 0) {
      const name = rest[0].startsWith('-') ? rest[0].split('=')[0] : '(posicional)';
      throw new UsageError(`argumento desconhecido: ${name} (não há seleção parcial, retry ou paralelismo)`);
    }
    const commandLineNames = (env.AI_STUDY_MAKE_OVERRIDES ?? '').split(/\s+/).filter(Boolean);
    const config = resolveConfig(command, env, { repoRoot, commandLineNames });
    const corpusInfo = loadCorpus(config.corpusPath);

    if (command === 'dry-run') {
      io.stdout.write(formatDryRun(config, corpusInfo, planItems(corpusInfo.corpus)));
      return 0;
    }
    const transports = selectTransports(config);
    const outcome = await runCollection({ config, corpusInfo, transports, evidenceDir: evidenceDirFor(repoRoot) });
    io.stdout.write(formatRunSummary(outcome, displayPath(repoRoot, outcome.runDir)));
    return 0;
  } catch (error) {
    const known = error instanceof UsageError || error instanceof IncompleteError;
    io.stderr.write(`ai-study: ${known ? '' : 'erro interno: '}${redact(error.message, env)}\n`);
    return known ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env, process);
}
