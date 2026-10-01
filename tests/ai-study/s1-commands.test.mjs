import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { runCollection } from '../../src/ai-study/collect.mjs';
import { selectTransports } from '../../src/ai-study/cli.mjs';
import { LIMITS, redact, resolveConfig } from '../../src/ai-study/config.mjs';
import { loadCorpus } from '../../src/ai-study/corpus.mjs';
import { UsageError } from '../../src/ai-study/errors.mjs';
import { createFixtureTransports } from '../../src/ai-study/fixture.mjs';
import {
  defaultCorpusPath,
  excludedClis,
  liveJevInFixture,
  listRuns,
  makeSandbox,
  parseManifest,
  readRun,
  repoRoot,
  runCli,
  runMake,
  validLive,
} from './helpers.mjs';

const SECRET = 'sentinela-secreta-7f3a9c';
const liveEnv = { TYPESAFE_API_KEY: SECRET };
const HASH = /^sha256:[0-9a-f]{64}$/;

function assertNoSecret(run, secret = SECRET) {
  assert.ok(!run.stdout.includes(secret), 'segredo no stdout');
  assert.ok(!run.stderr.includes(secret), 'segredo no stderr');
}

function assertUsageFailure(run, pattern, label) {
  assert.equal(run.status, 2, `${label}: ${run.output}`);
  assert.equal(run.nodeStatus ?? run.status, 2, `${label}: código do Node`);
  assert.match(run.stderr, pattern, `${label}: diagnóstico`);
}

function forbiddenTransports() {
  const fail = (name) => async () => {
    throw new Error(`transporte ${name} usado`);
  };
  return { local: { provenance: 'live', translate: fail('local') }, jev: { provenance: 'live', evaluate: fail('jev') } };
}

test('C1: dry-run imprime manifesto com modo, hashes, modelos, limites 20/24 e destinos sem credenciais', () => {
  const sandbox = makeSandbox();
  const corpus = loadCorpus(defaultCorpusPath);

  const fixture = runMake(sandbox, 'ai-study-dry-run');
  assert.equal(fixture.status, 0, fixture.output);
  const f = parseManifest(fixture.stdout);
  assert.equal(f['modo'], 'fixture');
  assert.equal(f['hash do corpus'], corpus.corpusHash);
  assert.equal(f['hash do gabarito'], corpus.gabaritoHash);
  assert.match(f['hash do corpus'], HASH);
  assert.equal(f['máximo de chamadas locais'], '20');
  assert.equal(f['máximo de chamadas Jev'], '24');
  assert.match(f['modelo local solicitado'], /não configurado/);
  assert.match(f['destino local'], /nenhum/);
  assert.match(f['destino Jev'], /nenhum/);

  const live = runMake(sandbox, 'ai-study-dry-run', {
    vars: { MODE: 'live', ...validLive, LOCAL_BASE_URL: `http://operador:${SECRET}@127.0.0.1:1234/v1?token=${SECRET}` },
    env: { ...liveEnv, LOCAL_API_TOKEN: `${SECRET}-local` },
  });
  assert.equal(live.status, 0, live.output);
  assertNoSecret(live);
  const l = parseManifest(live.stdout);
  assert.equal(l['modo'], 'live');
  assert.equal(l['hash do corpus'], corpus.corpusHash);
  assert.equal(l['hash do gabarito'], corpus.gabaritoHash);
  assert.equal(l['modelo local solicitado'], validLive.LOCAL_MODEL);
  assert.equal(l['modelo Jev solicitado'], validLive.JEV_MODEL);
  assert.equal(l['máximo de chamadas locais'], '20');
  assert.equal(l['máximo de chamadas Jev'], '24');
  assert.equal(l['destino local'], 'http://127.0.0.1:1234/v1');
  assert.equal(l['destino Jev'], 'https://api.typesafe.ai/v1/systemone');
  assert.equal(l['chave Jev'], 'configurada (valor omitido)');
  assert.equal(l['token local'], 'configurado (valor omitido)');

  assert.deepEqual(listRuns(sandbox), [], 'dry-run não cria evidências');
});

test('C2: dry-run nos dois modos e coleta fixture fazem zero acessos de rede ou chamadas de modelos', async () => {
  const sandbox = makeSandbox();
  const runs = [
    runMake(sandbox, 'ai-study-dry-run'),
    runMake(sandbox, 'ai-study-dry-run', { vars: { MODE: 'live', ...validLive }, env: liveEnv }),
    runMake(sandbox, 'ai-study-run', { vars: { MODE: 'fixture', RUN_ID: 'c2-fixture' } }),
  ];
  for (const run of runs) assert.equal(run.status, 0, run.output);
  const guard = runs.at(-1).guard;
  assert.equal(guard.loaded, 3, 'guarda carregada em cada processo');
  assert.deepEqual(guard.attempts, []);

  // Transportes que falham se usados: a coleta fixture nunca constrói nem chama os transportes live.
  const config = resolveConfig('run', { RUN_ID: 'c2-module' }, { repoRoot });
  const corpusInfo = loadCorpus(config.corpusPath);
  let liveFactoryCalls = 0;
  const transports = selectTransports(config, {
    env: {},
    createLiveTransports: () => {
      liveFactoryCalls += 1;
      return forbiddenTransports();
    },
  });
  const outcome = await runCollection({ config, corpusInfo, transports, evidenceDir: sandbox.evidenceDir });
  assert.equal(outcome.manifest.status, 'completed');
  assert.equal(liveFactoryCalls, 0);
});

test('C3: preparação e coleta fixture invocam zero processos Codex, Claude, Grok, agy ou Cloak', () => {
  const sandbox = makeSandbox();
  const runs = [
    runMake(sandbox, 'ai-study-dry-run'),
    runMake(sandbox, 'ai-study-dry-run', { vars: { MODE: 'live', ...validLive }, env: liveEnv }),
    runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c3-fixture' } }),
    runMake(sandbox, 'ai-study-run', { vars: { MODE: 'live', ...validLive }, env: liveEnv }),
  ];
  for (const run of runs.slice(0, 3)) assert.equal(run.status, 0, run.output);
  const last = runs.at(-1);
  // Coleta live ainda não existe nesta entrega: recusada antes de construir transportes.
  assertUsageFailure(last, /coleta live ainda não está disponível/, 'run live');
  assert.deepEqual(listRuns(sandbox), ['c3-fixture']);
  assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada');
  assert.deepEqual(last.guard.attempts.filter((a) => a.kind === 'process'), []);

  // Nenhum módulo da bancada importa criação de processos.
  const srcDir = join(repoRoot, 'src/ai-study');
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.mjs'))) {
    const source = readFileSync(join(srcDir, file), 'utf8');
    assert.doesNotMatch(source, /child_process|worker_threads/, file);
    for (const cli of excludedClis) assert.doesNotMatch(source, new RegExp(`['"\`]${cli}['"\` ]`), `${file}: ${cli}`);
  }
});

test('C4: somente os modos fixture e live são aceitos, fixture por omissão', () => {
  const sandbox = makeSandbox();
  for (const target of ['ai-study-dry-run', 'ai-study-run']) {
    const omitted = runMake(sandbox, target);
    assert.equal(omitted.status, 0, `${target}: ${omitted.output}`);
    assert.match(omitted.stdout, /^modo: fixture$/m, target);
    const explicit = runMake(sandbox, target, { vars: { MODE: 'fixture' } });
    assert.equal(explicit.status, 0, `${target}: ${explicit.output}`);
    for (const mode of ['FIXTURE', 'Live', 'simulated', 'dry-run', '']) {
      const run = runMake(sandbox, target, { vars: { MODE: mode, ...validLive }, env: liveEnv });
      assertUsageFailure(run, /MODE/, `${target} MODE=${mode}`);
      assert.match(run.stderr, /fixture.*live/);
    }
  }
  const live = runMake(sandbox, 'ai-study-dry-run', { vars: { MODE: 'live', ...validLive }, env: liveEnv });
  assert.equal(live.status, 0, live.output);
  assert.match(live.stdout, /^modo: live$/m);
});

test('C5: configuração inválida encerra com código 2 antes de coletar, nomeando a configuração sem revelar segredos', () => {
  const sandbox = makeSandbox();
  const live = { MODE: 'live', ...validLive };
  const rows = [
    ['LOCAL_BASE_URL ausente', { ...live, LOCAL_BASE_URL: undefined }, liveEnv, /LOCAL_BASE_URL/],
    ['LOCAL_MODEL ausente', { ...live, LOCAL_MODEL: undefined }, liveEnv, /LOCAL_MODEL/],
    ['JEV_MODEL ausente', { ...live, JEV_MODEL: undefined }, liveEnv, /JEV_MODEL/],
    ['TYPESAFE_API_KEY ausente', live, {}, /TYPESAFE_API_KEY/],
    ['TYPESAFE_API_KEY vazia', live, { TYPESAFE_API_KEY: '' }, /TYPESAFE_API_KEY/],
    ['LOCAL_BASE_URL inválida', { ...live, LOCAL_BASE_URL: `nao-e-url-${SECRET}` }, liveEnv, /LOCAL_BASE_URL/],
    ['LOCAL_BASE_URL sem http', { ...live, LOCAL_BASE_URL: `ftp://${SECRET}@host/` }, liveEnv, /LOCAL_BASE_URL/],
    ['RUN_ID vazio explícito', { RUN_ID: '' }, {}, /RUN_ID/],
    ['RUN_ID com 65 caracteres', { RUN_ID: 'a'.repeat(65) }, {}, /RUN_ID/],
    ['RUN_ID caminho relativo', { RUN_ID: '../fora' }, {}, /RUN_ID/],
    ['RUN_ID caminho', { RUN_ID: 'a/b' }, {}, /RUN_ID/],
    ['RUN_ID absoluto', { RUN_ID: '/tmp/x' }, {}, /RUN_ID/],
    ['RUN_ID não ASCII', { RUN_ID: 'execução' }, {}, /RUN_ID/],
    ['RUN_ID com espaço', { RUN_ID: 'a b' }, {}, /RUN_ID/],
    ['argumento desconhecido', { RETRY: '1' }, {}, /RETRY/],
    ['segredo na linha de comando', { ...live, TYPESAFE_API_KEY: SECRET }, {}, /TYPESAFE_API_KEY/],
    ['corpus ilegível', { CORPUS: join(sandbox.dir, 'inexistente.json') }, {}, /CORPUS/],
    ['corpus diretório', { CORPUS: sandbox.dir }, {}, /CORPUS/],
    ['corpus vazio explícito', { CORPUS: '' }, {}, /CORPUS/],
    ['URL com senha mal codificada', { MODE: 'bogus', LOCAL_BASE_URL: `http://operador:%zz${SECRET}@127.0.0.1:1234/v1` }, {}, /MODE/],
  ];
  for (const name of ['LOCAL_TIMEOUT_SECONDS', 'JEV_TIMEOUT_SECONDS']) {
    for (const value of ['0', '-1', '1.5', 'abc', '', '1e2']) {
      rows.push([`${name}=${JSON.stringify(value)}`, { [name]: value }, {}, new RegExp(name)]);
    }
  }
  for (const value of ['0', '2049', '1.5', 'abc', '']) {
    rows.push([`LOCAL_MAX_OUTPUT_TOKENS=${value}`, { LOCAL_MAX_OUTPUT_TOKENS: value }, {}, /LOCAL_MAX_OUTPUT_TOKENS/]);
  }
  const corrupt = join(sandbox.dir, 'corrompido.json');
  writeFileSync(corrupt, '{"schema_version": 1,');
  rows.push(['corpus JSON inválido', { CORPUS: corrupt }, {}, /CORPUS/]);

  for (const [label, rawVars, env, pattern] of rows) {
    const vars = Object.fromEntries(Object.entries(rawVars).filter(([, v]) => v !== undefined));
    const run = runMake(sandbox, 'ai-study-run', { vars, env });
    assertUsageFailure(run, pattern, label);
    assertNoSecret(run);
    assert.deepEqual(listRuns(sandbox), [], `${label}: nada coletado`);
  }

  const argv = runCli(sandbox, ['run', `--api-key=${SECRET}`]);
  assertUsageFailure(argv, /argumento desconhecido: --api-key/, 'argumento CLI');
  assertNoSecret(argv);
  const command = runCli(sandbox, ['collect']);
  assertUsageFailure(command, /comando/, 'comando desconhecido');
  const badUrl = runCli(sandbox, ['collect'], { env: { LOCAL_BASE_URL: `http://operador:%zz${SECRET}@127.0.0.1/` } });
  assertUsageFailure(badUrl, /^ai-study: comando inválido/m, 'redação com URL mal codificada');
  assertNoSecret(badUrl);

  // Credenciais curtas na URL não corrompem o diagnóstico nem escondem o nome da configuração.
  const shortUser = runMake(sandbox, 'ai-study-run', { vars: { MODE: 'xpto', LOCAL_BASE_URL: 'http://MODE:pw@127.0.0.1/' } });
  assertUsageFailure(shortUser, /MODE inválido: use fixture ou live/, 'usuário igual ao nome da configuração');
  const oneLetter = runCli(sandbox, ['collect'], { env: { LOCAL_BASE_URL: 'http://u:e@127.0.0.1/' } });
  assertUsageFailure(oneLetter, /^ai-study: comando inválido: use dry-run ou run$/m, 'credencial de uma letra');

  // Rede de segurança: URLs com credenciais em mensagens perdem usuário, senha e query.
  const env = { TYPESAFE_API_KEY: SECRET, LOCAL_BASE_URL: `http://op:${SECRET}-pw@127.0.0.1:1234/v1?token=${SECRET}-q` };
  const redacted = redact(`falha em http://op:${SECRET}-pw@127.0.0.1:1234/v1/completions?token=${SECRET}-q (chave ${SECRET})`, env);
  assert.equal(redacted, 'falha em http://[omitido]@127.0.0.1:1234/v1/completions?[omitido] (chave [omitido])');
  // O Node aceita `@` sem codificação na senha: a omissão vai até o último `@` antes do caminho.
  assert.equal(redact('erro: http://u:p@ss@h/v1 falhou', {}), 'erro: http://[omitido]@h/v1 falhou');
});

test('C9: ai-study-run com modo omitido conclui com código 0 e artefatos fixture schema_version 1', () => {
  const sandbox = makeSandbox();
  const run = runMake(sandbox, 'ai-study-run');
  assert.equal(run.status, 0, run.output);
  const [runId] = listRuns(sandbox);
  assert.ok(runId, 'execução criada');
  assert.match(run.stdout, new RegExp(`artifacts/ai-study/${runId}`));
  assert.match(run.stdout, /simulad/);

  const evidence = readRun(sandbox, runId);
  assert.equal(evidence.manifest.schema_version, 1);
  assert.equal(evidence.manifest.run_id, runId);
  assert.equal(evidence.manifest.mode, 'fixture');
  assert.equal(evidence.manifest.provenance, 'fixture');
  assert.equal(evidence.manifest.status, 'completed');
  assert.deepEqual(evidence.manifest.not_executed_items, []);
  assert.equal(evidence.results.length, 42);
  assert.equal(evidence.results.filter((r) => r.item.kind === 'translation').length, 18);
  assert.equal(evidence.results.filter((r) => r.item.kind === 'evaluation').length, 24);
  for (const result of evidence.results) {
    assert.equal(result.schema_version, 1);
    assert.equal(result.run_id, runId);
    assert.equal(result.provenance, 'fixture');
    assert.equal(result.response.provenance, 'fixture');
  }
  assert.ok(!existsSync(join(repoRoot, 'artifacts', 'ai-study', runId)), 'isolado do repositório');
});

test('C10: resposta com proveniência diferente do modo é rejeitada com código 2, preservando evidências anteriores', async () => {
  // Fronteira make: um transporte Jev live dentro da coleta fixture (injetado só pela pré-carga de teste).
  const sandbox = makeSandbox();
  const run = runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c10-fixture' }, preload: [liveJevInFixture] });
  assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, 'live em fixture');
  assert.deepEqual(run.guard.attempts, [], 'o transporte live nem chega a ser chamado');
  const evidence = readRun(sandbox, 'c10-fixture');
  assert.equal(evidence.manifest.status, 'rejected');
  assert.equal(evidence.manifest.reason, 'provenance_mismatch');
  assert.deepEqual(evidence.results.map((r) => r.item.id), ['R01-translate-pt-en']);
  assert.equal(evidence.results[0].provenance, 'fixture');
  assert.ok(evidence.manifest.not_executed_items.includes('R01-evaluate-pt'));

  // Coletor em modo live: transporte simulado ou resposta que se declara simulada são rejeitados.
  const fixture = createFixtureTransports();
  const liveLocal = {
    provenance: 'live',
    translate: async (r) => ({ ...(await fixture.local.translate(r)), provenance: 'live' }),
  };
  const liveConfig = (runId) =>
    resolveConfig('run', { MODE: 'live', RUN_ID: runId, ...validLive, TYPESAFE_API_KEY: SECRET }, { repoRoot });
  const corpusInfo = loadCorpus(defaultCorpusPath);
  let snapshot;
  let fixtureJevCalls = 0;
  const scenarios = [
    ['c10-live-transport', { provenance: 'fixture', evaluate: async (r) => (fixtureJevCalls += 1, fixture.jev.evaluate(r)) }],
    [
      'c10-live-response',
      {
        provenance: 'live',
        async evaluate(request) {
          snapshot = readRun(sandbox, 'c10-live-response').rawResults;
          return fixture.jev.evaluate(request);
        },
      },
    ],
  ];
  for (const [runId, jev] of scenarios) {
    await assert.rejects(
      runCollection({ config: liveConfig(runId), corpusInfo, transports: { local: liveLocal, jev }, evidenceDir: sandbox.evidenceDir }),
      (error) => error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/.test(error.message),
      runId,
    );
    const rejected = readRun(sandbox, runId);
    assert.equal(rejected.manifest.reason, 'provenance_mismatch', runId);
    assert.deepEqual(rejected.results.map((r) => r.provenance), ['live'], runId);
  }
  assert.equal(fixtureJevCalls, 0, 'transporte simulado não é chamado em execução live');
  assert.deepEqual(readRun(sandbox, 'c10-live-response').rawResults, snapshot, 'prefixo intacto byte a byte');

  // Coletor em modo fixture: resposta que se declara live é rejeitada mesmo vinda do transporte fixture.
  const fixtureConfig = resolveConfig('run', { RUN_ID: 'c10-fixture-response' }, { repoRoot });
  const lying = { ...fixture, jev: { provenance: 'fixture', evaluate: async (r) => ({ ...(await fixture.jev.evaluate(r)), provenance: 'live' }) } };
  await assert.rejects(
    runCollection({ config: fixtureConfig, corpusInfo, transports: lying, evidenceDir: sandbox.evidenceDir }),
    (error) => error instanceof UsageError && /proveniência "live"/.test(error.message),
  );
  assert.equal(readRun(sandbox, 'c10-fixture-response').results.length, 1);
});

test('C11: configuração válida aceita RUN_ID de 1 e 64 caracteres, timeout inteiro positivo e saída de 1 e 2048 tokens', () => {
  const sandbox = makeSandbox();
  const longId = `${'A1_-'.repeat(16)}`;
  assert.equal(longId.length, 64);
  for (const [vars, expected] of [
    [{ RUN_ID: 'x', LOCAL_MAX_OUTPUT_TOKENS: '1' }, { run_id: 'x', 'saída local máxima (tokens)': '1' }],
    [
      { RUN_ID: longId, LOCAL_MAX_OUTPUT_TOKENS: '2048', LOCAL_TIMEOUT_SECONDS: '1', JEV_TIMEOUT_SECONDS: '600' },
      { run_id: longId, 'saída local máxima (tokens)': '2048', 'timeout local (s)': '1', 'timeout Jev (s)': '600' },
    ],
  ]) {
    const dry = runMake(sandbox, 'ai-study-dry-run', { vars });
    assert.equal(dry.status, 0, dry.output);
    const manifest = parseManifest(dry.stdout);
    for (const [key, value] of Object.entries(expected)) assert.equal(manifest[key], value, key);
    assert.equal(manifest['máximo de chamadas locais'], '20');
    assert.equal(manifest['máximo de chamadas Jev'], '24');
  }
  for (const runId of ['x', longId]) {
    const run = runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: runId } });
    assert.equal(run.status, 0, run.output);
    const evidence = readRun(sandbox, runId);
    assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 });
  }
  assert.deepEqual(LIMITS, { localCalls: 20, jevCalls: 24 });
});

test('C12: preparação resolve os defaults publicados e não oferece seleção parcial, retry ou paralelismo', () => {
  const sandbox = makeSandbox();
  const dry = runMake(sandbox, 'ai-study-dry-run');
  assert.equal(dry.status, 0, dry.output);
  const manifest = parseManifest(dry.stdout);
  assert.equal(manifest['corpus'], 'src/ai-study/corpus/revision-1.json (revisão 1)');
  assert.equal(manifest['run_id'], 'gerado na coleta');
  assert.equal(manifest['timeout local (s)'], '120');
  assert.equal(manifest['timeout Jev (s)'], '30');
  assert.equal(manifest['saída local máxima (tokens)'], '2048');

  const run = runMake(sandbox, 'ai-study-run');
  assert.equal(run.status, 0, run.output);
  const [generated] = listRuns(sandbox);
  assert.match(generated, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(readRun(sandbox, generated).manifest.run_id, generated);

  const defaults = resolveConfig('run', {}, { repoRoot });
  assert.equal(defaults.mode, 'fixture');
  assert.equal(defaults.runId, null);
  assert.equal(defaults.corpusPath, defaultCorpusPath);
  assert.equal(defaults.local.timeoutSeconds, 120);
  assert.equal(defaults.jev.timeoutSeconds, 30);
  assert.equal(defaults.local.maxOutputTokens, 2048);

  assert.throws(() => resolveConfig('report', {}, { repoRoot }), (e) => e instanceof UsageError && /RUN_ID/.test(e.message));
  assert.equal(resolveConfig('report', { RUN_ID: 'r1' }, { repoRoot }).runId, 'r1');

  const liveBase = { MODE: 'live', ...validLive, TYPESAFE_API_KEY: SECRET };
  for (const missing of ['LOCAL_BASE_URL', 'LOCAL_MODEL', 'TYPESAFE_API_KEY', 'JEV_MODEL']) {
    const env = { ...liveBase };
    delete env[missing];
    assert.throws(
      () => resolveConfig('run', env, { repoRoot }),
      (e) => e instanceof UsageError && e.message.includes(missing) && !e.message.includes(SECRET),
      missing,
    );
  }
  const noToken = resolveConfig('run', liveBase, { repoRoot });
  assert.equal(noToken.local.apiToken, null, 'token local opcional');

  for (const name of ['CASES', 'ONLY', 'RETRY', 'RETRIES', 'PARALLEL', 'CONCURRENCY']) {
    const flagged = runMake(sandbox, 'ai-study-run', { vars: { [name]: '2' } });
    assertUsageFailure(flagged, new RegExp(name), `make ${name}`);
  }
  const ownKnob = runMake(sandbox, 'ai-study-dry-run', { vars: { NODE: process.execPath, PYTHON: 'python3' } });
  assert.equal(ownKnob.status, 0, `variáveis do próprio Makefile: ${ownKnob.output}`);
  for (const flag of ['--only=R01', '--retry', '--parallel=2']) {
    assertUsageFailure(runCli(sandbox, ['run', flag]), /argumento desconhecido/, flag);
  }
  assert.equal(listRuns(sandbox).length, 1, 'somente a coleta válida criou evidências');

  // Variáveis não publicadas não alteram destino nem respostas da coleta.
  const elsewhere = join(sandbox.dir, 'outro-destino');
  const injected = join(sandbox.dir, 'respostas.json');
  writeFileSync(injected, JSON.stringify({ responses: { 'R01-evaluate-pt': { provenance: 'fixture', model: 'jev-real' } } }));
  const seams = runMake(sandbox, 'ai-study-run', {
    vars: { RUN_ID: 'c12-seams' },
    env: { AI_STUDY_ARTIFACTS_ROOT: elsewhere, AI_STUDY_FIXTURE_RESPONSES: injected },
  });
  assert.equal(seams.status, 0, seams.output);
  assert.ok(!existsSync(elsewhere), 'AI_STUDY_ARTIFACTS_ROOT ignorada');
  const seamRun = readRun(sandbox, 'c12-seams');
  assert.ok(seamRun.results.every((r) => r.response.model === 'fixture'), 'AI_STUDY_FIXTURE_RESPONSES ignorada');
});
