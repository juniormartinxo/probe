import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultCorpusPath = join(repoRoot, 'src/ai-study/corpus/revision-1.json');
export const excludedClis = ['codex', 'claude', 'grok', 'agy', 'cloak'];

const guardPath = fileURLToPath(new URL('./support/guard.mjs', import.meta.url));

export const validLive = Object.freeze({
  LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1',
  LOCAL_MODEL: 'translategemma-12b-it@q6_k',
  JEV_MODEL: 'jev-test-model',
});

const sandboxes = [];
process.on('exit', () => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// Diretório isolado: evidências, registro da guarda e shims das CLIs excluídas.
export function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-study-test-'));
  sandboxes.push(dir);
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
    guardLog: join(dir, 'guard.log'),
    evidenceDir: join(dir, 'artifacts', 'ai-study'),
  };
}

function baseEnv(sandbox, env) {
  return {
    PATH: `${sandbox.shimDir}:${process.env.PATH}`,
    HOME: sandbox.dir,
    LANG: 'C.UTF-8',
    AI_STUDY_ARTIFACTS_ROOT: sandbox.dir,
    AI_STUDY_GUARD_LOG: sandbox.guardLog,
    NODE_OPTIONS: `--import=${guardPath}`,
    ...env,
  };
}

function finish(result, sandbox) {
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
    guard: readGuard(sandbox),
    shimCalls: existsSync(sandbox.shimLog) ? readFileSync(sandbox.shimLog, 'utf8') : '',
  };
}

// Atravessa a fronteira publicada: `make <target> VAR=valor`, sem herdar o ambiente do teste.
export function runMake(sandbox, target, { vars = {}, env = {} } = {}) {
  const args = ['-s', '--no-print-directory', '-C', repoRoot, target];
  for (const [name, value] of Object.entries(vars)) args.push(`${name}=${value}`);
  const result = spawnSync('make', args, { env: baseEnv(sandbox, env), encoding: 'utf8' });
  return { ...finish(result, sandbox), nodeStatus: nodeStatusFromMake(result) };
}

export function runCli(sandbox, argv, { env = {} } = {}) {
  const result = spawnSync(process.execPath, [join(repoRoot, 'src/ai-study/cli.mjs'), ...argv], {
    env: baseEnv(sandbox, env),
    encoding: 'utf8',
  });
  return finish(result, sandbox);
}

// GNU Make sempre sai com 2 quando o recipe falha; o código real do Node aparece em "Error N".
function nodeStatusFromMake(result) {
  if (result.status === 0) return 0;
  const match = result.stderr.match(/\] Error (\d+)$/m);
  return match ? Number(match[1]) : null;
}

export function readGuard(sandbox) {
  if (!existsSync(sandbox.guardLog)) return { loaded: 0, attempts: [] };
  const entries = readFileSync(sandbox.guardLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    loaded: entries.filter((e) => e.kind === 'loaded').length,
    attempts: entries.filter((e) => e.kind !== 'loaded'),
  };
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
