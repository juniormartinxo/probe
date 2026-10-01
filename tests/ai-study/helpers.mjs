import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultCorpusPath = join(repoRoot, 'src/ai-study/corpus/revision-1.json');
export const excludedClis = ['codex', 'claude', 'grok', 'agy', 'cloak'];

const guardPath = fileURLToPath(new URL('./support/guard.mjs', import.meta.url));
// Pré-cargas só de teste: transporte Jev live, ou resposta Jev live de um transporte fixture, na coleta fixture.
export const liveJevInFixture = fileURLToPath(new URL('./support/live-jev-in-fixture.mjs', import.meta.url));
export const liveJevResponseInFixture = fileURLToPath(new URL('./support/live-jev-response-in-fixture.mjs', import.meta.url));
// Pré-cargas só de teste: LM Studio e Jev controlados na coleta live; as variantes declaram o Jev como fixture.
export const liveServices = fileURLToPath(new URL('./support/live-services.mjs', import.meta.url));
export const liveServicesFixtureJev = fileURLToPath(new URL('./support/live-services-fixture-jev.mjs', import.meta.url));
export const liveServicesFixtureJevResponse = fileURLToPath(
  new URL('./support/live-services-fixture-jev-response.mjs', import.meta.url),
);
// Pré-cargas só de teste da S4: barreira na primeira chamada fixture, interrupção na troca de arquivo e
// registro das leituras do sistema de arquivos.
export const fixtureBarrier = fileURLToPath(new URL('./support/fixture-barrier.mjs', import.meta.url));
export const interruptOnRename = fileURLToPath(new URL('./support/interrupt-on-rename.mjs', import.meta.url));
export const fsTrace = fileURLToPath(new URL('./support/fs-trace.mjs', import.meta.url));
export const supportDir = fileURLToPath(new URL('./support/', import.meta.url));

export const validLive = Object.freeze({
  LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1',
  LOCAL_MODEL: 'translategemma-12b-it@q6_k',
  JEV_MODEL: 'jev-test-model',
});

const sandboxes = [];
process.on('exit', () => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// Diretório isolado: cópia da bancada (evidências no caminho publicado), registro da guarda e
// shims das CLIs excluídas.
export function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-study-test-'));
  sandboxes.push(dir);
  const repo = join(dir, 'repo');
  cpSync(join(repoRoot, 'Makefile'), join(repo, 'Makefile'));
  cpSync(join(repoRoot, 'src'), join(repo, 'src'), { recursive: true });
  const shimDir = join(dir, 'bin');
  mkdirSync(shimDir);
  const shimLog = join(dir, 'shim.log');
  for (const cli of excludedClis) {
    const shim = join(shimDir, cli);
    writeFileSync(shim, `#!/bin/sh\necho "${cli} $*" >> "${shimLog}"\nexit 97\n`);
    chmodSync(shim, 0o755);
  }
  return {
    dir,
    shimDir,
    shimLog,
    repo,
    guardLog: join(dir, 'guard.log'),
    servicesLog: join(dir, 'services.log'),
    fsLog: join(dir, 'fs.log'),
    evidenceDir: join(repo, 'artifacts', 'ai-study'),
  };
}

function baseEnv(sandbox, env, preload) {
  return {
    PATH: `${sandbox.shimDir}:${process.env.PATH}`,
    HOME: sandbox.dir,
    LANG: 'C.UTF-8',
    AI_STUDY_GUARD_LOG: sandbox.guardLog,
    AI_STUDY_SERVICES_LOG: sandbox.servicesLog,
    AI_STUDY_FS_LOG: sandbox.fsLog,
    NODE_OPTIONS: [guardPath, ...preload].map((path) => `--import=${path}`).join(' '),
    ...env,
  };
}

function finish(result, sandbox) {
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
    guard: readGuard(sandbox),
    shimCalls: existsSync(sandbox.shimLog) ? readFileSync(sandbox.shimLog, 'utf8') : '',
  };
}

// Atravessa a fronteira publicada: `make <target> VAR=valor`, sem herdar o ambiente do teste.
function makeArgs(sandbox, target, vars) {
  return ['-s', '--no-print-directory', '-C', sandbox.repo, target, ...Object.entries(vars).map(([name, value]) => `${name}=${value}`)];
}

// `timeout` (ms) encerra o make que não termina; o teste então falha em vez de travar.
export function runMake(sandbox, target, { vars = {}, env = {}, preload = [], timeout } = {}) {
  const result = spawnSync('make', makeArgs(sandbox, target, vars), { env: baseEnv(sandbox, env, preload), encoding: 'utf8', timeout });
  return { ...finish(result, sandbox), nodeStatus: nodeStatusFromMake(result) };
}

// Mesma fronteira, em segundo plano: para coletas concorrentes reais entre processos.
export function startMake(sandbox, target, { vars = {}, env = {}, preload = [] } = {}) {
  const child = spawn('make', makeArgs(sandbox, target, vars), { env: baseEnv(sandbox, env, preload) });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const done = new Promise((resolve) =>
    child.on('close', (status, signal) => {
      const result = { status, signal, stdout, stderr };
      resolve({ ...finish(result, sandbox), nodeStatus: nodeStatusFromMake(result) });
    }),
  );
  return { child, done };
}

export function runCli(sandbox, argv, { env = {}, preload = [] } = {}) {
  const result = spawnSync(process.execPath, [join(sandbox.repo, 'src/ai-study/cli.mjs'), ...argv], {
    env: baseEnv(sandbox, env, preload),
    encoding: 'utf8',
  });
  return finish(result, sandbox);
}

export function readFsTrace(sandbox) {
  if (!existsSync(sandbox.fsLog)) return [];
  return readFileSync(sandbox.fsLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Todos os arquivos de um diretório (relativos) com seus bytes, para provar preservação byte a byte.
export function snapshotFiles(root) {
  const files = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else files[rel] = readFileSync(join(dir, entry.name), 'utf8');
    }
  };
  if (existsSync(root)) walk(root, '');
  return files;
}

// GNU Make sempre sai com 2 quando o recipe falha; o código real do Node aparece em "Error N".
// Sem essa linha o teste não distingue o código do Node do 2 genérico do make, então falha.
function nodeStatusFromMake(result) {
  if (result.status === 0) return 0;
  const match = result.stderr.match(/\] Error (\d+)$/m);
  if (!match) throw new Error(`make falhou sem a linha "Error N" com o código do Node:\n${result.stderr}`);
  return Number(match[1]);
}

export function readGuard(sandbox) {
  if (!existsSync(sandbox.guardLog)) return { loaded: 0, attempts: [] };
  const entries = readFileSync(sandbox.guardLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    loaded: entries.filter((e) => e.kind === 'loaded').length,
    attempts: entries.filter((e) => e.kind !== 'loaded'),
  };
}

export function readServices(sandbox) {
  if (!existsSync(sandbox.servicesLog)) return [];
  return readFileSync(sandbox.servicesLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function parseManifest(stdout) {
  const fields = {};
  for (const line of stdout.split('\n')) {
    const match = line.match(/^([^:]+): (.*)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

export function listRuns(sandbox) {
  return existsSync(sandbox.evidenceDir) ? readdirSync(sandbox.evidenceDir) : [];
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readRun(sandbox, runId) {
  const runDir = join(sandbox.evidenceDir, runId);
  const resultsDir = join(runDir, 'results');
  const resultFiles = existsSync(resultsDir) ? readdirSync(resultsDir).sort() : [];
  return {
    runDir,
    manifest: readJson(join(runDir, 'manifest.json')),
    resultFiles,
    results: resultFiles.map((f) => readJson(join(resultsDir, f))),
    rawResults: resultFiles.map((f) => readFileSync(join(resultsDir, f), 'utf8')),
  };
}

export function loadDefaultCorpus() {
  return readJson(defaultCorpusPath);
}

export function writeCorpusVariant(sandbox, name, mutate) {
  const corpus = structuredClone(loadDefaultCorpus());
  mutate(corpus);
  const path = join(sandbox.dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(corpus, null, 2));
  return path;
}
