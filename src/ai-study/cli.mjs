// Fronteira dos comandos `make ai-study-dry-run`, `make ai-study-run` e `make ai-study-report`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCallBudget } from './calls.mjs';
import { runCollection, planItems } from './collect.mjs';
import { displayPath, evidenceDirFor, redact, redactValue, reportDirFor, resolveConfig, SECRET_NAMES } from './config.mjs';
import { loadCorpus } from './corpus.mjs';
import { IncompleteError, UsageError } from './errors.mjs';
import { writeTextAtomic } from './evidence.mjs';
import { createFixtureTransports } from './fixture.mjs';
import { createJevTransport } from './jev.mjs';
import { createLmStudioTransport } from './lmstudio.mjs';
import { formatDryRun, formatRunSummary } from './manifest.mjs';
import { buildReport, formatReportSummary, translationsOf } from './report.mjs';
import { loadReview } from './review.mjs';
import { loadRun } from './run-reader.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const COMMANDS = ['dry-run', 'run', 'report'];

// Live usa somente o servidor local configurado e o endpoint oficial do Jev.
function createLiveTransports(config, budget) {
  return { budget, local: createLmStudioTransport(config, { budget }), jev: createJevTransport(config, { budget }) };
}

// Fixture nunca constrói transportes live, e não há opção para injetar respostas. Os dois serviços
// compartilham um orçamento: limites 20/24 e uma chamada em andamento na execução inteira.
export function selectTransports(config, { createLiveTransports: createLive = createLiveTransports, signal } = {}) {
  const budget = createCallBudget(config.limits, { signal });
  return config.mode === 'live' ? createLive(config, budget) : createFixtureTransports({ budget });
}

export async function main(argv, env, io, { signal } = {}) {
  try {
    const [command, ...rest] = argv;
    if (!COMMANDS.includes(command)) throw new UsageError(`comando inválido: use ${COMMANDS.slice(0, -1).join(', ')} ou ${COMMANDS.at(-1)}`);
    if (rest.length > 0) {
      const name = rest[0].startsWith('-') ? rest[0].split('=')[0] : '(posicional)';
      throw new UsageError(`argumento desconhecido: ${name} (não há seleção parcial, retry ou paralelismo)`);
    }
    const commandLineNames = (env.AI_STUDY_MAKE_OVERRIDES ?? '').split(/\s+/).filter(Boolean);
    const config = resolveConfig(command, env, { repoRoot, commandLineNames });
    if (command === 'report') return writeReport(config.runId, env, io);
    const corpusInfo = loadCorpus(config.corpusPath);

    if (command === 'dry-run') {
      io.stdout.write(formatDryRun(config, corpusInfo, planItems(corpusInfo.corpus)));
      return 0;
    }
    const transports = selectTransports(config, { signal });
    const outcome = await runCollection({ config, corpusInfo, transports, evidenceDir: evidenceDirFor(repoRoot), signal });
    io.stdout.write(formatRunSummary(outcome, displayPath(repoRoot, outcome.runDir)));
    return 0;
  } catch (error) {
    const known = error instanceof UsageError || error instanceof IncompleteError;
    io.stderr.write(`ai-study: ${known ? '' : 'erro interno: '}${redact(error.message, env)}\n`);
    return known ? error.exitCode : 1;
  }
}

// Relatório só das evidências da execução e da revisão humana: sem corpus atual, modelos ou rede. A
// métrica usa o gabarito gravado na execução, nunca uma revisão posterior do corpus.
function writeReport(runId, env, io) {
  const loaded = loadRun(evidenceDirFor(repoRoot), runId);
  const review = loadReview(loaded.runDir, runId, translationsOf(loaded).map((r) => r.translation));
  const { markdown, summary } = buildReport(loaded, review);
  // Evidências já omitem segredos; a revisão humana ou um arquivo editado podem não omitir.
  const secrets = SECRET_NAMES.map((name) => env[name]);
  const reportDir = reportDirFor(repoRoot);
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${runId}.md`);
  writeTextAtomic(reportPath, redactValue(markdown, secrets));
  io.stdout.write(redactValue(formatReportSummary(summary, displayPath(repoRoot, reportPath)), secrets));
  return 0;
}

// O primeiro SIGINT ou SIGTERM encerra a espera e a coleta como `interrupted`, liberando a trava;
// um segundo sinal, de qualquer dos dois tipos, segue o comportamento padrão.
const INTERRUPT_SIGNALS = ['SIGINT', 'SIGTERM'];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const interrupt = new AbortController();
  // Remove os dois listeners no primeiro sinal: com um por tipo, um segundo sinal do outro tipo seria engolido.
  const onSignal = () => {
    for (const name of INTERRUPT_SIGNALS) process.off(name, onSignal);
    interrupt.abort();
  };
  for (const name of INTERRUPT_SIGNALS) process.on(name, onSignal);
  process.exitCode = await main(process.argv.slice(2), process.env, process, { signal: interrupt.signal });
}
