import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { createCallBudget, ServiceCallError } from '../../src/ai-study/calls.mjs';
import { selectTransports } from '../../src/ai-study/cli.mjs';
import { caseText, planItems, runCollection } from '../../src/ai-study/collect.mjs';
import { evidenceDirFor, JEV_ENDPOINT, LIMITS, resolveConfig } from '../../src/ai-study/config.mjs';
import { JUDGMENT_IDS, loadCorpus } from '../../src/ai-study/corpus.mjs';
import { IncompleteError, UsageError } from '../../src/ai-study/errors.mjs';
import { LOCK_NAME } from '../../src/ai-study/evidence.mjs';
import { loadRun } from '../../src/ai-study/run-reader.mjs';
import { createFixtureTransports } from '../../src/ai-study/fixture.mjs';
import { createJevTransport } from '../../src/ai-study/jev.mjs';
import { createLmStudioTransport } from '../../src/ai-study/lmstudio.mjs';
import { TRANSLATION_TEMPLATE } from '../../src/ai-study/template.mjs';
import {
  defaultCorpusPath,
  fixtureBarrier,
  fsTrace,
  interruptOnRename,
  liveServices,
  listRuns,
  loadDefaultCorpus,
  makeSandbox,
  readFsTrace,
  readJson,
  readRun,
  readServices,
  repoRoot,
  runCli,
  runMake,
  snapshotFiles,
  startMake,
  supportDir,
  validLive,
  writeCorpusVariant,
} from './helpers.mjs';

const KEY = 'sentinela-chave-jev-7d2e91';
const LOCAL_MODEL = validLive.LOCAL_MODEL;
const JEV_MODEL = validLive.JEV_MODEL;
const corpus = loadDefaultCorpus();
const PLANNED = planItems(corpus).map((i) => i.id);
// Template confirmado só no teste: o template versionado ainda não é o oficial (AC 12).
const confirmedTemplate = Object.freeze({ ...TRANSLATION_TEMPLATE, official: true, justification: 'confirmado somente neste teste' });

function liveConfig(runId, env = {}) {
  return resolveConfig('run', { MODE: 'live', RUN_ID: runId, ...validLive, TYPESAFE_API_KEY: KEY, ...env }, { repoRoot });
}

const jevAnswers = () =>
  Object.fromEntries(
    JUDGMENT_IDS.map((id) => [id, { type: 'choice', choice: 'no', probabilities: { yes: 0.1, no: 0.8, insufficient: 0.1 }, confidence: 0.6 }]),
  );

// fetch controlado de LM Studio e Jev: registra cada pedido e o intervalo em que esteve em andamento.
// `reply(call, n)` pode substituir a resposta da n-ésima chamada do serviço (`call.service`).
function services({ reply = () => null, delayMs = 0 } = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const events = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const service = parsed.href === JEV_ENDPOINT ? 'jev' : 'local';
    const call = {
      service,
      href: parsed.href,
      path: parsed.pathname,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null,
      signal: init.signal,
      startedAt: performance.now(),
    };
    calls.push(call);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    events.push(['start', calls.length]);
    try {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const custom = reply(call, calls.filter((c) => c.service === service).length);
      if (custom) return await custom;
      if (service === 'jev') return Response.json({ model: JEV_MODEL, answers: jevAnswers(), usage: null });
      if (call.method === 'GET') return Response.json({ id: LOCAL_MODEL, quantization: 'Q6_K', state: 'loaded' });
      return Response.json({ model: LOCAL_MODEL, choices: [{ text: `English ${call.body.prompt.length}`, finish_reason: 'stop' }] });
    } finally {
      inFlight -= 1;
      events.push(['end', calls.length]);
    }
  };
  return {
    fetch,
    calls,
    events,
    maxInFlight: () => maxInFlight,
    count: (service) => calls.filter((c) => c.service === service).length,
  };
}

// Adaptadores reais com fetch controlado e o orçamento compartilhado da execução, como na CLI.
function adapters(config, fetch, budget = createCallBudget(config.limits)) {
  const local = createLmStudioTransport(config, { fetch, budget });
  return {
    budget,
    local: { ...local, countTokens: async () => ({ count: 100, tokenizer: LOCAL_MODEL }) },
    jev: createJevTransport(config, { fetch, budget }),
  };
}

async function collect(sandbox, runId, { svc = services(), env, wrap = (t) => t } = {}) {
  const config = liveConfig(runId, env);
  let error = null;
  try {
    await runCollection({
      config,
      corpusInfo: loadCorpus(config.corpusPath),
      transports: wrap(adapters(config, svc.fetch)),
      evidenceDir: sandbox.evidenceDir,
      translationTemplate: confirmedTemplate,
    });
  } catch (caught) {
    error = caught;
  }
  return { error, run: readRun(sandbox, runId), svc };
}

const remainingAfter = (itemId) => PLANNED.slice(PLANNED.indexOf(itemId) + 1);

test('C31: a execução envia no máximo 20 chamadas locais e 24 Jev, contando falhas, e bloqueia a 21ª/25ª sem retries', async () => {
  // Bordas do orçamento: 20/24 admitidas, 21/25 bloqueadas antes de executar a operação.
  const budget = createCallBudget(LIMITS);
  let executed = 0;
  const op = async () => (executed += 1);
  for (let i = 0; i < 20; i += 1) await budget.call('local', null, op);
  for (let i = 0; i < 24; i += 1) await budget.call('jev', null, op);
  for (const service of ['local', 'jev']) {
    await assert.rejects(budget.call(service, null, op), (e) => e instanceof ServiceCallError && e.reason === 'call_limit' && !e.requestSent);
  }
  assert.equal(executed, 44, 'a tentativa além do limite não executa');
  assert.deepEqual(budget.snapshot(), { local: { used: 20, limit: 20 }, jev: { used: 24, limit: 24 } });

  // Coleta completa: 1 verificação do candidato + 18 traduções e 24 avaliações, registradas no manifesto.
  const sandbox = makeSandbox();
  const full = await collect(sandbox, 'c31-full');
  assert.equal(full.error, null);
  assert.equal(full.svc.count('local'), 19);
  assert.equal(full.svc.count('jev'), 24);
  assert.deepEqual(full.run.manifest.calls, { local: { used: 19, limit: 20 }, jev: { used: 24, limit: 24 } });

  // Uma camada que repete cada pedido (como um SDK com retry) esbarra no limite: a 21ª local não sai.
  const retryingLocal = await collect(sandbox, 'c31-local', {
    wrap: (t) => ({
      ...t,
      local: { ...t.local, translate: async (request) => (await t.local.translate(request), t.local.translate(request)) },
    }),
  });
  assert.ok(retryingLocal.error instanceof IncompleteError);
  assert.equal(retryingLocal.svc.count('local'), 20, 'exatamente 20 pedidos locais saíram');
  assert.equal(retryingLocal.run.manifest.reason, 'call_limit');
  assert.deepEqual(retryingLocal.run.manifest.calls.local, { used: 20, limit: 20 });
  assert.equal(retryingLocal.run.manifest.failure.item, 'R10-translate-pt-en');
  assert.equal(retryingLocal.run.manifest.failure.request_sent, false);
  assert.equal(retryingLocal.run.manifest.failure.remote_outcome, 'not_sent');
  // Bloqueado antes do envio: o item continua entre os não executados, com todos os restantes.
  assert.deepEqual(retryingLocal.run.manifest.not_executed_items, PLANNED.slice(PLANNED.indexOf('R10-translate-pt-en')));

  // O mesmo para o Jev: a 25ª avaliação (R07 PT, primeiro braço da 13ª chamada) não sai.
  const retryingJev = await collect(sandbox, 'c31-jev', {
    wrap: (t) => ({ ...t, jev: { ...t.jev, evaluate: async (request) => (await t.jev.evaluate(request), t.jev.evaluate(request)) } }),
  });
  assert.equal(retryingJev.svc.count('jev'), 24, 'exatamente 24 pedidos Jev saíram');
  assert.equal(retryingJev.run.manifest.reason, 'call_limit');
  assert.equal(retryingJev.run.manifest.failure.item, 'R07-evaluate-pt');
  assert.deepEqual(retryingJev.run.manifest.calls.jev, { used: 24, limit: 24 });

  // Zero retries automáticos: cada falha é um único pedido, que conta no orçamento, e a coleta para.
  for (const [label, service, nth, response, expectedReason] of [
    ['local-http', 'local', 2, () => new Response('erro', { status: 503, headers: { 'retry-after': '1' } }), 'http_error'],
    ['local-rede', 'local', 2, () => Promise.reject(new TypeError('fetch failed')), 'transport_error'],
    ['jev-http', 'jev', 1, () => new Response('erro', { status: 429, headers: { 'retry-after': '1' } }), 'http_error'],
    ['jev-rede', 'jev', 1, () => Promise.reject(new TypeError('fetch failed')), 'transport_error'],
  ]) {
    const svc = services({ reply: (call, n) => (call.service === service && n === nth ? response() : null) });
    const outcome = await collect(sandbox, `c31-${label}`, { svc });
    assert.ok(outcome.error instanceof IncompleteError, label);
    assert.equal(svc.count(service), nth, `${label}: nenhum pedido repetido`);
    assert.equal(svc.calls.length, svc.calls.indexOf(svc.calls.findLast((c) => c.service === service)) + 1, `${label}: nada depois da falha`);
    assert.equal(outcome.run.manifest.reason, expectedReason, label);
    assert.equal(outcome.run.manifest.calls[service].used, nth, `${label}: falha contada`);
  }

  // Orçamento obrigatório: sem ele, cada transporte contaria sozinho e o limite da execução se perderia.
  const bare = liveConfig('c31-sem-orcamento');
  assert.throws(() => createLmStudioTransport(bare, { fetch: full.svc.fetch }), /orçamento compartilhado/);
  assert.throws(() => createJevTransport(bare, { fetch: full.svc.fetch }), /orçamento compartilhado/);
  assert.throws(() => createFixtureTransports(), /orçamento compartilhado/);
  const { budget: _, ...unbudgeted } = adapters(bare, full.svc.fetch);
  await assert.rejects(
    runCollection({ config: bare, corpusInfo: loadCorpus(bare.corpusPath), transports: unbudgeted, evidenceDir: sandbox.evidenceDir }),
    /orçamento compartilhado/,
  );
  assert.ok(!existsSync(join(sandbox.evidenceDir, 'c31-sem-orcamento')), 'recusa antes de criar a execução');

  // Coleta fixture: as chamadas simuladas também passam pelo orçamento.
  const config = resolveConfig('run', { RUN_ID: 'c31-fixture' }, { repoRoot });
  const fixture = await runCollection({
    config,
    corpusInfo: loadCorpus(config.corpusPath),
    transports: selectTransports(config),
    evidenceDir: sandbox.evidenceDir,
  });
  assert.deepEqual(fixture.manifest.calls, { local: { used: 18, limit: 20 }, jev: { used: 24, limit: 24 } });
});

test('C32: a coleta mantém no máximo uma chamada em andamento, inclusive na verificação do candidato, traduções e braços alternados', async () => {
  // Garantia estrutural: o orçamento recusa uma segunda chamada enquanto outra está em andamento.
  const budget = createCallBudget(LIMITS);
  let release;
  const first = budget.call('local', null, () => new Promise((resolve) => (release = resolve)));
  let started = 0;
  for (const service of ['local', 'jev']) {
    await assert.rejects(
      budget.call(service, null, async () => (started += 1)),
      (e) => e instanceof ServiceCallError && e.reason === 'concurrent_call' && e.requestSent === false && /uma por vez/.test(e.message),
    );
  }
  assert.equal(started, 0, 'a segunda chamada não começou');
  release('ok');
  assert.equal(await first, 'ok');
  assert.equal(await budget.call('jev', null, async () => 'depois'), 'depois');

  // Coleta live com latência: nenhum pedido se sobrepõe a outro em toda a sequência.
  const sandbox = makeSandbox();
  const svc = services({ delayMs: 3 });
  const { error, run } = await collect(sandbox, 'c32', { svc });
  assert.equal(error, null);
  assert.equal(svc.calls.length, 43, 'verificação do candidato, 18 traduções e 24 avaliações');
  assert.equal(svc.maxInFlight(), 1);
  for (let i = 0; i < svc.events.length; i += 2) {
    assert.deepEqual([svc.events[i], svc.events[i + 1]], [['start', i / 2 + 1], ['end', i / 2 + 1]], 'início e fim alternam');
  }
  assert.deepEqual(svc.calls.slice(0, 4).map((c) => `${c.method} ${c.service}`), ['GET local', 'POST local', 'POST jev', 'POST jev']);
  assert.deepEqual(
    run.results.filter((r) => r.item.case_id === 'R02').map((r) => r.item.id),
    ['R02-translate-pt-en', 'R02-evaluate-en', 'R02-evaluate-pt'],
    'braços alternados também em série',
  );
});

test('C33: timeout local ou Jev encerra a espera no limite e a coleta incomplete, com restantes não executados e resultado remoto desconhecido', async () => {
  const sandbox = makeSandbox();
  for (const [label, env, service, nth, honorsAbort, item, prefix] of [
    // O servidor local nunca responde nem observa o cancelamento: a espera termina pelo prazo da bancada.
    ['local', { LOCAL_TIMEOUT_SECONDS: '1' }, 'local', 2, false, 'R01-translate-pt-en', []],
    ['jev', { JEV_TIMEOUT_SECONDS: '1' }, 'jev', 2, true, 'R01-evaluate-en', ['R01-translate-pt-en', 'R01-evaluate-pt']],
  ]) {
    let hanging = null;
    const svc = services({
      reply: (call, n) => {
        if (call.service !== service || n !== nth) return null;
        hanging = call;
        return new Promise((_, reject) => {
          if (honorsAbort) call.signal.addEventListener('abort', () => reject(call.signal.reason));
        });
      },
    });
    const { error, run } = await collect(sandbox, `c33-${label}`, { svc, env });
    const waited = performance.now() - hanging.startedAt;
    assert.ok(error instanceof IncompleteError, label);
    assert.ok(waited >= 990 && waited < 1900, `${label}: espera encerrada no limite de 1 s (${Math.round(waited)} ms)`);
    assert.equal(hanging.signal.aborted, true, `${label}: pedido abortado do lado da bancada`);
    assert.equal(svc.calls.at(-1), hanging, `${label}: nenhuma chamada depois do timeout`);
    const { manifest } = run;
    assert.equal(manifest.status, 'incomplete', label);
    assert.equal(manifest.reason, 'timeout', label);
    assert.deepEqual(manifest.failure, {
      item,
      service,
      reason: 'timeout',
      request_sent: true,
      remote_outcome: 'unknown',
      message: manifest.failure.message,
      timeout_seconds: 1,
    });
    assert.match(manifest.failure.message, /cancelamento da inferência remota não foi confirmado/);
    assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/);
    assert.deepEqual(manifest.completed_items, prefix, label);
    assert.deepEqual(run.results.map((r) => r.item.id), prefix, label);
    assert.deepEqual(manifest.not_executed_items, remainingAfter(item), `${label}: restantes não executados`);
    assert.match(error.message, /coleta incompleta, prefixo preservado/);
  }

  // Falha sem envio confirmado (aqui, na contagem de tokens, antes do pedido): o item continua não executado.
  const { error, run } = await collect(sandbox, 'c33-sem-envio', {
    wrap: (t) => ({ ...t, local: { ...t.local, countTokens: async () => Promise.reject(new Error('tokenizer indisponível')) } }),
  });
  assert.ok(error instanceof IncompleteError);
  assert.deepEqual(
    [run.manifest.failure.item, run.manifest.failure.request_sent, run.manifest.failure.remote_outcome],
    ['R01-translate-pt-en', null, 'unknown'],
  );
  assert.deepEqual(run.manifest.not_executed_items, PLANNED, 'nenhum item tentado com envio confirmado');
});

// Executa a coleta fixture pela CLI com interrupção (SIGKILL) na n-ésima troca do destino escolhido.
function interrupted(sandbox, runId, spec) {
  const result = runCli(sandbox, ['run'], {
    env: { RUN_ID: runId, AI_STUDY_TEST_INTERRUPT: spec },
    preload: [interruptOnRename],
  });
  assert.equal(result.signal, 'SIGKILL', `${spec}: processo interrompido`);
  // Queda sem limpeza deixa a trava; ela não é tomada automaticamente e sai por remoção manual (C29).
  const lock = join(sandbox.evidenceDir, LOCK_NAME);
  assert.equal(readJson(lock).pid > 0, true, `${spec}: trava do processo interrompido`);
  rmSync(lock);
  const runDir = join(sandbox.evidenceDir, runId);
  return { runDir, manifest: readJson(join(runDir, 'manifest.json')), files: snapshotFiles(runDir) };
}

const temporaries = (files) => Object.keys(files).filter((f) => f.endsWith('.tmp'));

test('C35: interrupção antes e depois da troca de manifesto ou resultado deixa o destino anterior ou novo íntegro; temporário e JSON parcial não são evidência', () => {
  const sandbox = makeSandbox();
  // Manifesto: 1ª gravação no início, 2ª após o resultado 001, 3ª após o 002.
  const manifestBefore = interrupted(sandbox, 'c35-manifesto-antes', 'before:^manifest\\.json$:3');
  assert.deepEqual(manifestBefore.manifest.completed_items, ['R01-translate-pt-en'], 'manifesto anterior íntegro');
  assert.equal(temporaries(manifestBefore.files).length, 1);
  assert.ok(temporaries(manifestBefore.files)[0].startsWith('manifest.json.'));
  const manifestAfter = interrupted(sandbox, 'c35-manifesto-depois', 'after:^manifest\\.json$:3');
  assert.deepEqual(manifestAfter.manifest.completed_items, ['R01-translate-pt-en', 'R01-evaluate-pt'], 'manifesto novo íntegro');
  assert.deepEqual(temporaries(manifestAfter.files), []);

  const resultBefore = interrupted(sandbox, 'c35-resultado-antes', 'before:^\\d{3}-.*\\.json$:2');
  assert.ok(!('results/002-R01-evaluate-pt.json' in resultBefore.files), 'destino novo ainda inexistente');
  assert.deepEqual(temporaries(resultBefore.files).map((f) => f.split('.json.')[0]), ['results/002-R01-evaluate-pt']);
  const resultAfter = interrupted(sandbox, 'c35-resultado-depois', 'after:^\\d{3}-.*\\.json$:2');
  assert.equal(readJson(join(resultAfter.runDir, 'results/002-R01-evaluate-pt.json')).item.id, 'R01-evaluate-pt', 'resultado novo íntegro');
  assert.deepEqual(resultAfter.manifest.completed_items, ['R01-translate-pt-en'], 'manifesto ainda não o confirmou');

  // Todo destino presente é JSON completo; o leitor de evidências ignora temporários e o que o manifesto não confirmou.
  for (const scenario of [manifestBefore, manifestAfter, resultBefore, resultAfter]) {
    for (const [file, content] of Object.entries(scenario.files).filter(([f]) => f.endsWith('.json'))) {
      assert.doesNotThrow(() => JSON.parse(content), file);
    }
    const runId = relative(sandbox.evidenceDir, scenario.runDir);
    const loaded = loadRun(sandbox.evidenceDir, runId);
    assert.deepEqual(loaded.results.map((r) => r.item.id), scenario.manifest.completed_items, runId);
    for (const tmp of temporaries(scenario.files)) {
      assert.ok(loaded.ignored.some((i) => i.file === tmp && i.reason === 'temporary'), `${runId}: ${tmp} ignorado`);
    }
  }
  assert.deepEqual(loadRun(sandbox.evidenceDir, 'c35-manifesto-antes').ignored.map((i) => i.reason).sort(), ['not_in_manifest', 'temporary']);
  assert.deepEqual(loadRun(sandbox.evidenceDir, 'c35-resultado-depois').ignored, [
    { file: 'results/002-R01-evaluate-pt.json', reason: 'not_in_manifest' },
  ]);

  // JSON parcial no lugar do destino nunca é aceito: nem resultado confirmado nem manifesto.
  const partial = join(sandbox.evidenceDir, variant(sandbox, 'c35-manifesto-depois', 'c35-parcial'));
  assert.equal(loadRun(sandbox.evidenceDir, 'c35-parcial').results.length, 2, 'cópia íntegra aceita');
  const resultPath = join(partial, 'results/002-R01-evaluate-pt.json');
  const full = readFileSync(resultPath, 'utf8');
  writeFileSync(resultPath, full.slice(0, Math.floor(full.length / 2)));
  assert.throws(() => loadRun(sandbox.evidenceDir, 'c35-parcial'), (e) => e instanceof UsageError && /002-R01-evaluate-pt\.json: JSON inválido ou parcial/.test(e.message));
  writeFileSync(resultPath, full);
  const manifestPath = join(partial, 'manifest.json');
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').slice(0, 40));
  assert.throws(() => loadRun(sandbox.evidenceDir, 'c35-parcial'), /manifest\.json: JSON inválido ou parcial/);
});

// Cópia de uma execução sob outro RUN_ID, com todos os vínculos reescritos; `mutate` estraga um deles.
function variant(sandbox, sourceId, runId, mutate = () => {}) {
  const dir = join(sandbox.evidenceDir, runId);
  cpSync(join(sandbox.evidenceDir, sourceId), dir, { recursive: true });
  const rewrite = (path, change = (x) => x) => {
    const value = readJson(path);
    value.run_id = runId;
    if (value.config) value.config.run_id = runId;
    if (value.translation) value.translation.run_id = runId;
    if (value.evaluation) value.evaluation.run_id = runId;
    writeFileSync(path, JSON.stringify(change(value), null, 2));
  };
  rewrite(join(dir, 'manifest.json'));
  if (existsSync(join(dir, 'comparison.json'))) rewrite(join(dir, 'comparison.json'));
  for (const f of readdirSync(join(dir, 'results'))) rewrite(join(dir, 'results', f));
  mutate({ dir, edit: (file, change) => writeFileSync(join(dir, file), JSON.stringify(change(readJson(join(dir, file))), null, 2)) });
  return runId;
}

test('C40: manifesto e registros schema_version 1 mantêm as relações da execução; o leitor recusa vínculo a outra execução, revisão ou versão de schema', async () => {
  const sandbox = makeSandbox();
  const fixtureRun = async (runId) => {
    const config = resolveConfig('run', { RUN_ID: runId }, { repoRoot });
    const corpusInfo = loadCorpus(config.corpusPath);
    await runCollection({ config, corpusInfo, transports: createFixtureTransports({ budget: createCallBudget() }), evidenceDir: sandbox.evidenceDir });
    return corpusInfo;
  };
  const corpusInfo = await fixtureRun('c40');
  await fixtureRun('c40-outra');

  const loaded = loadRun(sandbox.evidenceDir, 'c40', { corpusInfo });
  const { manifest, results, comparison } = loaded;
  // Execução → configuração, corpus e itens.
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.run_id, 'c40');
  assert.equal(manifest.config.run_id, 'c40');
  assert.deepEqual(manifest.corpus, {
    path: 'src/ai-study/corpus/revision-1.json',
    revision: 1,
    corpus_hash: corpusInfo.corpusHash,
    gabarito_hash: corpusInfo.gabaritoHash,
  });
  assert.deepEqual(manifest.planned_items, PLANNED);
  assert.deepEqual(results.map((r) => r.item.id), PLANNED);
  assert.deepEqual(loaded.ignored, []);
  const cases = new Map([...corpus.relational_cases, ...corpus.translation_cases].map((c) => [c.id, c]));
  for (const r of results) {
    assert.equal(r.schema_version, 1);
    assert.equal(r.run_id, 'c40');
    assert.deepEqual([r.corpus_hash, r.gabarito_hash], [corpusInfo.corpusHash, corpusInfo.gabaritoHash]);
    if (r.item.kind === 'translation') {
      // Tradução → original e caso.
      const source = cases.get(r.item.case_id);
      assert.equal(r.translation.case_id, r.item.case_id);
      assert.equal(r.translation.original, r.item.direction === 'pt->en' ? caseText(source) : source.original);
    } else {
      // Avaliação → caso e braço; o braço inglês aponta para a tradução do mesmo caso.
      assert.deepEqual([r.evaluation.run_id, r.evaluation.case_id, r.evaluation.arm], ['c40', r.item.case_id, r.item.arm]);
      if (r.item.arm === 'en') assert.equal(r.derived_from, `${r.item.case_id}-translate-pt-en`);
    }
  }
  assert.deepEqual([comparison.schema_version, comparison.run_id], [1, 'c40']);

  // Cópia íntegra sob outro RUN_ID é aceita: a recusa vem só dos vínculos estragados.
  assert.equal(loadRun(sandbox.evidenceDir, variant(sandbox, 'c40', 'c40-copia')).results.length, 42);
  const otherRun = readFileSync(join(sandbox.evidenceDir, 'c40-outra/results/003-R01-evaluate-en.json'), 'utf8');
  const altered = loadCorpus(writeCorpusVariant(sandbox, 'revisao-2', (c) => (c.revision = 2)));
  for (const [runId, mutate, pattern] of [
    ['c40-manifesto-outra', ({ edit }) => edit('manifest.json', (m) => ({ ...m, run_id: 'c40' })), /manifest\.json: pertence à execução c40$/m],
    ['c40-resultado-outra', ({ dir }) => writeFileSync(join(dir, 'results/003-R01-evaluate-en.json'), otherRun), /003-R01-evaluate-en\.json: pertence à execução c40-outra/],
    ['c40-comparacao-outra', ({ edit }) => edit('comparison.json', (c) => ({ ...c, run_id: 'c40-outra' })), /comparison\.json: pertence à execução c40-outra/],
    ['c40-revisao', ({ edit }) => edit('results/001-R01-translate-pt-en.json', (r) => ({ ...r, corpus_hash: altered.corpusHash })), /001-R01-translate-pt-en\.json: revisão de corpus/],
    ['c40-gabarito', ({ edit }) => edit('comparison.json', (c) => ({ ...c, gabarito_hash: 'sha256:outro' })), /comparison\.json: revisão de corpus/],
    ['c40-schema-resultado', ({ edit }) => edit('results/002-R01-evaluate-pt.json', (r) => ({ ...r, schema_version: 2 })), /002-R01-evaluate-pt\.json: schema_version 2 não é 1/],
    ['c40-schema-manifesto', ({ edit }) => edit('manifest.json', (m) => ({ ...m, schema_version: 2 })), /manifest\.json: schema_version 2 não é 1/],
    ['c40-schema-comparacao', ({ edit }) => edit('comparison.json', (c) => ({ ...c, schema_version: '1' })), /comparison\.json: schema_version "1" não é 1/],
    ['c40-traducao-caso', ({ edit }) => edit('results/001-R01-translate-pt-en.json', (r) => ({ ...r, translation: { ...r.translation, case_id: 'R02' } })), /tradução não vinculada/],
    ['c40-avaliacao-braco', ({ edit }) => edit('results/002-R01-evaluate-pt.json', (r) => ({ ...r, evaluation: { ...r.evaluation, arm: 'en' } })), /avaliação não vinculada/],
    ['c40-origem-en', ({ edit }) => edit('results/003-R01-evaluate-en.json', (r) => ({ ...r, derived_from: 'R02-translate-pt-en' })), /R01-evaluate-en: braço inglês sem tradução de origem/],
    ['c40-item-fora', ({ edit }) => edit('results/002-R01-evaluate-pt.json', (r) => ({ ...r, item: { ...r.item, id: 'R99-evaluate-pt' } })), /item R99-evaluate-pt fora dos itens planejados/],
  ]) {
    variant(sandbox, 'c40', runId, mutate);
    assert.throws(() => loadRun(sandbox.evidenceDir, runId), (e) => e instanceof UsageError && pattern.test(e.message), runId);
  }
  // Execução íntegra, mas de outra revisão do corpus que a esperada pelo relatório.
  assert.throws(() => loadRun(sandbox.evidenceDir, 'c40', { corpusInfo: altered }), /revisão de corpus ou gabarito diferente da esperada/);
  assert.throws(() => loadRun(sandbox.evidenceDir, '../c40'), /RUN_ID inválido/);
});

const liveRun = (sandbox, runId, { vars = {}, env = {}, preload = [liveServices] } = {}) =>
  runMake(sandbox, 'ai-study-run', {
    vars: { MODE: 'live', RUN_ID: runId, ...validLive, ...vars },
    env: { TYPESAFE_API_KEY: KEY, ...env },
    preload,
  });

async function until(condition, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`tempo esgotado esperando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('C29: duas coletas simultâneas no mesmo diretório de evidências admitem só uma; a segunda é rejeitada antes de chamar modelos', async () => {
  const sandbox = makeSandbox();
  const barrier = join(sandbox.dir, 'barrier');
  mkdirSync(barrier);
  const env = { AI_STUDY_TEST_BARRIER_DIR: barrier };
  const started = () => readdirSync(barrier).filter((f) => f.startsWith('started-'));

  // A primeira coleta (processo real) fica parada na primeira chamada, com a trava tomada.
  const first = startMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c29-primeira' }, env, preload: [fixtureBarrier] });
  await until(() => started().length === 1, 'a primeira coleta chegar à primeira chamada');
  const firstPid = Number(started()[0].slice('started-'.length));
  const lock = readJson(join(sandbox.evidenceDir, LOCK_NAME));
  assert.equal(lock.pid, firstPid, 'a trava pertence à primeira coleta');
  const firstBefore = snapshotFiles(join(sandbox.evidenceDir, 'c29-primeira'));

  // Segundas coletas concorrentes, com outro RUN_ID, o mesmo RUN_ID e em modo live: todas recusadas.
  for (const [label, vars, extra] of [
    ['outro RUN_ID', { RUN_ID: 'c29-segunda' }, {}],
    ['mesmo RUN_ID', { RUN_ID: 'c29-primeira' }, {}],
    ['live', { MODE: 'live', RUN_ID: 'c29-live', ...validLive }, { TYPESAFE_API_KEY: KEY }],
  ]) {
    const second = runMake(sandbox, 'ai-study-run', { vars, env: { ...env, ...extra }, preload: [fixtureBarrier, liveServices], timeout: 10000 });
    assert.equal(second.status, 2, `${label}: ${second.output}`);
    assert.equal(second.nodeStatus, 2, `${label}: código do Node`);
    assert.match(second.stderr, new RegExp(`outra coleta \\(processo ${firstPid}\\) está em andamento`), label);
  }
  assert.equal(started().length, 1, 'nenhuma segunda coleta chegou a uma chamada');
  assert.ok(readServices(sandbox).every((entry) => entry.pid === firstPid), 'nenhuma chamada fixture ou HTTP das segundas coletas');
  assert.deepEqual(listRuns(sandbox).sort(), [LOCK_NAME, 'c29-primeira'], 'nenhuma execução criada pelas segundas');
  assert.deepEqual(snapshotFiles(join(sandbox.evidenceDir, 'c29-primeira')), firstBefore, 'a primeira execução não foi alterada');

  writeFileSync(join(barrier, 'release'), '');
  const firstResult = await first.done;
  assert.equal(firstResult.status, 0, firstResult.output);
  const evidence = readRun(sandbox, 'c29-primeira');
  assert.equal(evidence.manifest.status, 'completed');
  assert.equal(evidence.results.length, 42);
  assert.deepEqual(listRuns(sandbox), ['c29-primeira'], 'trava liberada no término');

  // Chamadas concorrentes no mesmo processo: a segunda coleta é recusada antes de usar seus transportes.
  const config = resolveConfig('run', { RUN_ID: 'c29-modulo-a' }, { repoRoot });
  const corpusInfo = loadCorpus(config.corpusPath);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const slow = createFixtureTransports({ budget: createCallBudget() });
  const running = runCollection({
    config,
    corpusInfo,
    transports: { ...slow, local: { ...slow.local, translate: async (r) => (await gate, slow.local.translate(r)) } },
    evidenceDir: sandbox.evidenceDir,
  });
  let used = 0;
  const counted = createFixtureTransports({ budget: createCallBudget() });
  const spy = { ...counted, local: { ...counted.local, translate: async (r) => ((used += 1), counted.local.translate(r)) } };
  const configB = resolveConfig('run', { RUN_ID: 'c29-modulo-b' }, { repoRoot });
  await assert.rejects(
    runCollection({ config: configB, corpusInfo, transports: spy, evidenceDir: sandbox.evidenceDir }),
    (e) => e instanceof UsageError && /outra coleta \(processo \d+\) está em andamento/.test(e.message),
  );
  assert.equal(used, 0);
  release();
  assert.equal((await running).manifest.status, 'completed');

  // Trava vazia (queda entre criar e escrever): recusa com código 2 e indica a remoção manual.
  writeFileSync(join(sandbox.evidenceDir, LOCK_NAME), '');
  const empty = runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c29-trava-vazia' } });
  assert.equal(empty.nodeStatus, 2, empty.output);
  assert.match(empty.stderr, /está vazia ou ilegível: .*se nenhuma estiver em andamento, remova o arquivo/);
  assert.ok(!existsSync(join(sandbox.evidenceDir, 'c29-trava-vazia')));

  // Trava de um processo encerrado sem liberá-la: recusa com código 2 e indica a remoção manual.
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  writeFileSync(join(sandbox.evidenceDir, LOCK_NAME), JSON.stringify({ pid: dead, token: 'antiga' }));
  const stale = runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c29-trava-antiga' } });
  assert.equal(stale.nodeStatus, 2, stale.output);
  assert.match(stale.stderr, new RegExp(`processo ${dead}, que terminou sem liberá-la; .*remova o arquivo`));
  assert.ok(!existsSync(join(sandbox.evidenceDir, 'c29-trava-antiga')));
  assert.ok(existsSync(join(sandbox.evidenceDir, LOCK_NAME)), 'a trava antiga não é removida automaticamente');
});

test('C30: coleta com RUN_ID existente encerra com código 2 e mantém os bytes de todos os arquivos anteriores, inclusive de execução incompleta', () => {
  const sandbox = makeSandbox();
  assert.equal(runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c30-concluida' } }).status, 0);
  const incomplete = liveRun(sandbox, 'c30-incompleta', { env: { AI_STUDY_TEST_FAIL: 'jev:2:http' } });
  assert.equal(incomplete.nodeStatus, 1, incomplete.output);
  const before = snapshotFiles(sandbox.evidenceDir);
  assert.equal(readJson(join(sandbox.evidenceDir, 'c30-incompleta/manifest.json')).status, 'incomplete');
  const requestsBefore = readServices(sandbox).length;

  for (const runId of ['c30-concluida', 'c30-incompleta']) {
    for (const [label, run] of [
      ['fixture', () => runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: runId } })],
      ['live', () => liveRun(sandbox, runId)],
    ]) {
      const again = run();
      assert.equal(again.status, 2, `${runId} ${label}: ${again.output}`);
      assert.equal(again.nodeStatus, 2, `${runId} ${label}: código do Node`);
      assert.match(again.stderr, new RegExp(`RUN_ID ${runId} já existe; a execução anterior não será sobrescrita`));
    }
  }
  assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before, 'bytes de todos os arquivos anteriores preservados');
  assert.equal(readServices(sandbox).length, requestsBefore, 'nenhuma chamada nas tentativas recusadas');
});

// Registros comparáveis entre execuções: sem durações e com o RUN_ID neutralizado.
function comparable(record, runId) {
  return JSON.parse(JSON.stringify(record, (key, value) => (key === 'duration_ms' ? undefined : value)).replaceAll(runId, '<run>'));
}

test('C34: falha de transporte, HTTP ou resposta inválida após dois resultados conclui com código 1, preserva o prefixo e lista os restantes', () => {
  const sandbox = makeSandbox();
  const reference = liveRun(sandbox, 'c34-referencia');
  assert.equal(reference.status, 0, reference.output);
  const referenceRun = readRun(sandbox, 'c34-referencia');
  const prefix = ['R01-translate-pt-en', 'R01-evaluate-pt'];

  for (const [label, fail, reason, failedItem, completed] of [
    ['jev-transporte', 'jev:2:network', 'transport_error', 'R01-evaluate-en', prefix],
    ['jev-http', 'jev:2:http', 'http_error', 'R01-evaluate-en', prefix],
    // Resposta Jev inválida é registrada como `invalid_response` (AC 21) e encerra a coleta.
    ['jev-invalida', 'jev:2:invalid', 'invalid_response', null, [...prefix, 'R01-evaluate-en']],
    ['local-transporte', 'local:2:network', 'transport_error', 'R02-translate-pt-en', [...prefix, 'R01-evaluate-en']],
    ['local-http', 'local:2:http', 'http_error', 'R02-translate-pt-en', [...prefix, 'R01-evaluate-en']],
    ['local-invalida', 'local:2:invalid', 'invalid_response', 'R02-translate-pt-en', [...prefix, 'R01-evaluate-en']],
  ]) {
    const runId = `c34-${label}`;
    const requestsBefore = readServices(sandbox).length;
    const run = liveRun(sandbox, runId, { env: { AI_STUDY_TEST_FAIL: fail } });
    assert.equal(run.status, 2, `${label}: o make falha`);
    assert.equal(run.nodeStatus, 1, `${label}: código 1 do Node na linha "Error 1" (${run.stderr})`);
    assert.match(run.stderr, /coleta incompleta, prefixo preservado/, label);

    const evidence = readRun(sandbox, runId);
    const { manifest } = evidence;
    assert.equal(manifest.status, 'incomplete', label);
    assert.equal(manifest.reason, reason, label);
    assert.deepEqual(manifest.completed_items, completed, label);
    assert.deepEqual(evidence.results.map((r) => r.item.id), completed, label);
    const last = failedItem ?? completed.at(-1);
    assert.deepEqual(manifest.not_executed_items, remainingAfter(last), `${label}: todos os restantes não executados`);
    if (failedItem) assert.equal(manifest.failure.item, failedItem, label);
    // Prefixo íntegro: bytes do JSON completo e conteúdo igual ao da coleta de referência.
    for (const [index, raw] of evidence.rawResults.entries()) {
      assert.equal(raw, `${JSON.stringify(JSON.parse(raw), null, 2)}\n`, `${label}: ${evidence.resultFiles[index]} íntegro`);
    }
    for (const id of prefix) {
      const own = evidence.results.find((r) => r.item.id === id);
      const ref = referenceRun.results.find((r) => r.item.id === id);
      assert.deepEqual(comparable(own, runId), comparable(ref, 'c34-referencia'), `${label}: ${id} preservado`);
    }
    assert.equal(loadRun(sandbox.evidenceDir, runId).results.length, completed.length, `${label}: evidência aceita`);

    // Nada depois da falha: nenhum outro provedor, idioma ou nova tentativa.
    const requests = readServices(sandbox).slice(requestsBefore);
    const posts = requests.filter((r) => r.method === 'POST');
    assert.equal(posts.length, completed.length + (failedItem ? 1 : 0), `${label}: pedidos até a falha`);
    assert.deepEqual([...new Set(requests.map((r) => new URL(r.url).origin))].sort(), ['http://127.0.0.1:1234', 'https://api.typesafe.ai']);
    assert.ok(posts.filter((r) => r.url === JEV_ENDPOINT).every((r) => r.body.model === JEV_MODEL), label);
  }
});

test('C36: chave, token, URL credenciada e cabeçalho de autenticação não aparecem em stdout, stderr, manifesto, resultados nem comparação', () => {
  const sandbox = makeSandbox();
  const secrets = {
    key: 'sentinela-chave-jev-c36',
    token: 'sentinela-token-local-c36',
    user: 'sentinela-usuario-c36',
    password: 'sentinela-senha-c36',
    query: 'sentinela-query-c36',
  };
  const vars = { LOCAL_BASE_URL: `http://${secrets.user}:${secrets.password}@127.0.0.1:1234/v1?token=${secrets.query}` };
  const env = { TYPESAFE_API_KEY: secrets.key, LOCAL_API_TOKEN: secrets.token, AI_STUDY_TEST_ECHO: '1' };
  // Serviços ecoam o cabeçalho de autenticação nas respostas, nos erros HTTP e nos corpos fora de JSON.
  const runs = [
    runMake(sandbox, 'ai-study-dry-run', { vars: { MODE: 'live', ...validLive, ...vars }, env }),
    liveRun(sandbox, 'c36-concluida', { vars, env }),
    liveRun(sandbox, 'c36-jev-http', { vars, env: { ...env, AI_STUDY_TEST_FAIL: 'jev:1:http' } }),
    liveRun(sandbox, 'c36-jev-parsing', { vars, env: { ...env, AI_STUDY_TEST_FAIL: 'jev:1:invalid' } }),
    liveRun(sandbox, 'c36-jev-transporte', { vars, env: { ...env, AI_STUDY_TEST_FAIL: 'jev:1:network' } }),
    liveRun(sandbox, 'c36-local-http', { vars, env: { ...env, AI_STUDY_TEST_FAIL: 'local:1:http' } }),
    liveRun(sandbox, 'c36-local-parsing', { vars, env: { ...env, AI_STUDY_TEST_FAIL: 'local:1:invalid' } }),
  ];
  assert.deepEqual(runs.map((r) => r.nodeStatus), [0, 0, 1, 1, 1, 1, 1], runs.map((r) => r.stderr).join('\n'));

  // O eco chegou às respostas e às mensagens: a ausência dos segredos vem da redação, não de falta de exposição.
  const done = readRun(sandbox, 'c36-concluida');
  assert.equal(done.results[0].response.runtime_details.stats.echo, 'Bearer [omitido]');
  assert.equal(done.results[1].response.usage.echo, 'Bearer [omitido]');
  assert.match(readRun(sandbox, 'c36-jev-parsing').results.at(-1).response.raw_body, /\[omitido\]/);
  assert.match(readRun(sandbox, 'c36-jev-transporte').manifest.failure.message, /fetch failed Bearer \[omitido\]/);
  assert.match(runs[4].stderr, /Bearer \[omitido\]/);
  const requests = readServices(sandbox);
  assert.ok(requests.some((r) => r.url.startsWith('http://127.0.0.1:1234/api/v0/')), 'servidor local chamado');
  assert.ok(requests.every((r) => !r.url.includes(secrets.user) && !r.url.includes(secrets.query)), 'URL enviada sem credenciais');

  // Chave ou token curtos demais para serem omitidos são recusados na configuração (código 2), sem chamadas.
  const shortSecret = 'zQ7wX9';
  const requestsBefore = readServices(sandbox).length;
  for (const [name, extra] of [
    ['TYPESAFE_API_KEY', { TYPESAFE_API_KEY: shortSecret }],
    ['LOCAL_API_TOKEN', { LOCAL_API_TOKEN: shortSecret }],
  ]) {
    for (const target of ['ai-study-dry-run', 'ai-study-run']) {
      const short = runMake(sandbox, target, {
        vars: { MODE: 'live', RUN_ID: `c36-curto-${name}`, ...validLive },
        env: { TYPESAFE_API_KEY: secrets.key, ...extra },
        preload: [liveServices],
      });
      assert.equal(short.nodeStatus, 2, `${name} ${target}: ${short.output}`);
      assert.match(short.stderr, new RegExp(`${name} curto demais: use ao menos 8 caracteres`), `${name} ${target}`);
      assert.ok(!short.output.includes(shortSecret), `${name} ${target}: valor fora da saída`);
      assert.ok(!existsSync(join(sandbox.evidenceDir, `c36-curto-${name}`)), `${name} ${target}: nenhuma execução`);
    }
  }
  assert.equal(readServices(sandbox).length, requestsBefore, 'nenhuma chamada com segredo curto');

  const outputs = runs.flatMap((r) => [['stdout', r.stdout], ['stderr', r.stderr]]);
  const files = Object.entries(snapshotFiles(sandbox.evidenceDir));
  assert.ok(files.some(([f]) => f.endsWith('comparison.json')) && files.some(([f]) => f.endsWith('manifest.json')));
  for (const [where, text] of [...outputs, ...files]) {
    for (const [name, secret] of Object.entries(secrets)) {
      assert.ok(!text.includes(secret), `${name} em ${where}`);
    }
    assert.doesNotMatch(text, /authorization"\s*:\s*"Bearer (?!\[omitido\])/i, `cabeçalho de autenticação em ${where}`);
  }
});

test('C37: nova tentativa explícita usa nova execução e não importa resultados nem caches de execução anterior', () => {
  const sandbox = makeSandbox();
  const first = liveRun(sandbox, 'c37-anterior', { env: { AI_STUDY_TEST_FAIL: 'jev:3:http' } });
  assert.equal(first.nodeStatus, 1, first.output);
  // Material da execução anterior que uma retomada silenciosa poderia aproveitar.
  const SENTINEL = 'SENTINELA-EXECUCAO-ANTERIOR';
  const previousDir = join(sandbox.evidenceDir, 'c37-anterior');
  for (const f of readdirSync(join(previousDir, 'results'))) {
    const path = join(previousDir, 'results', f);
    const record = readJson(path);
    if (record.translation) record.translation.derived_text = SENTINEL;
    writeFileSync(path, JSON.stringify(record, null, 2));
  }
  writeFileSync(join(previousDir, 'cache.json'), JSON.stringify({ translations: { R01: SENTINEL } }));
  writeFileSync(join(sandbox.evidenceDir, 'cache.json'), JSON.stringify({ R01: SENTINEL }));
  const previousBytes = snapshotFiles(previousDir);

  const requestsBefore = readServices(sandbox).length;
  const retry = liveRun(sandbox, 'c37-nova', { preload: [liveServices, fsTrace] });
  assert.equal(retry.status, 0, retry.output);
  const requests = readServices(sandbox).slice(requestsBefore);
  assert.equal(requests.filter((r) => r.url.endsWith('/api/v0/completions')).length, 18, 'todas as traduções refeitas');
  assert.equal(requests.filter((r) => r.url === JEV_ENDPOINT).length, 24, 'todas as avaliações refeitas');
  const evidence = readRun(sandbox, 'c37-nova');
  assert.equal(evidence.manifest.status, 'completed');
  assert.ok(evidence.results.every((r) => r.run_id === 'c37-nova'));
  assert.ok(!JSON.stringify(evidence.results).includes(SENTINEL) && !JSON.stringify(evidence.manifest).includes('c37-anterior'));
  assert.ok(requests.every((r) => !JSON.stringify(r.body ?? '').includes(SENTINEL)), 'nada da execução anterior enviado');
  // A nova execução não lê a anterior nem caches no diretório de evidências.
  const evidenceReads = readFsTrace(sandbox)
    .map((e) => relative(sandbox.evidenceDir, e.path))
    .filter((rel) => !rel.startsWith('..'));
  assert.ok(evidenceReads.length > 0, 'o rastreio registrou o diretório de evidências');
  assert.deepEqual(evidenceReads.filter((rel) => !rel.startsWith('c37-nova') && rel !== LOCK_NAME && rel !== ''), []);

  // Executar de novo com o ID anterior segue C30.
  const again = liveRun(sandbox, 'c37-anterior');
  assert.equal(again.nodeStatus, 2, again.output);
  assert.deepEqual(snapshotFiles(previousDir), previousBytes);
});

test('C38: a coleta usa só o corpus sintético e configurações explícitas, sem ler chats, perfis Cloak ou credenciais; o tráfego vai só aos destinos configurados', () => {
  const sandbox = makeSandbox();
  // HOME com chats, perfis Cloak e credenciais sentinela que a bancada não pode ler.
  const home = join(sandbox.dir, 'home');
  const planted = [
    '.config/cloak/profiles/amjr/claude/projects/chat/sessao.jsonl',
    '.claude/projects/chat/sessao.jsonl',
    '.codex/sessions/sessao.jsonl',
    '.ssh/id_ed25519',
    '.aws/credentials',
    '.config/gh/hosts.yml',
    '.env',
  ];
  for (const file of planted) {
    mkdirSync(join(home, file, '..'), { recursive: true });
    writeFileSync(join(home, file), 'SENTINELA-PRIVADA');
  }
  writeFileSync(join(sandbox.repo, '.env'), 'TYPESAFE_API_KEY=SENTINELA-PRIVADA');
  const local = 'http://lmstudio.interno:4321/proxy/v1';
  for (const [runId, vars, preload] of [
    ['c38-fixture', { MODE: 'fixture' }, [fsTrace]],
    ['c38-live', { LOCAL_BASE_URL: local }, [liveServices, fsTrace]],
  ]) {
    const run = liveRun(sandbox, runId, { vars, env: { HOME: home }, preload });
    assert.equal(run.status, 0, `${runId}: ${run.output}`);
  }

  const reads = readFsTrace(sandbox);
  assert.ok(reads.some((e) => e.path === join(sandbox.repo, 'src/ai-study/corpus/revision-1.json')), 'corpus versionado lido');
  const outside = reads.filter((e) => [sandbox.repo, supportDir].every((root) => relative(root, e.path).startsWith('..')));
  assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada');
  assert.ok(reads.every((e) => !e.path.endsWith('.env')), 'nenhum arquivo .env lido');
  assert.ok(reads.every((e) => !/cloak|\.claude|\.codex|\.ssh|\.aws|\/gh\//.test(e.path)), 'nenhum perfil, chat ou credencial');
  const evidence = JSON.stringify(snapshotFiles(sandbox.evidenceDir));
  assert.ok(!evidence.includes('SENTINELA-PRIVADA'));

  // Tráfego: somente o servidor local configurado e o destino oficial do Jev.
  const requests = readServices(sandbox);
  assert.deepEqual([...new Set(requests.map((r) => new URL(r.url).origin))].sort(), ['http://lmstudio.interno:4321', 'https://api.typesafe.ai']);
  assert.ok(requests.filter((r) => r.url.startsWith('http://lmstudio.interno')).every((r) => r.url.startsWith('http://lmstudio.interno:4321/proxy/api/v0/')));
  assert.ok(requests.filter((r) => r.url.includes('typesafe')).every((r) => r.url === 'https://api.typesafe.ai/v1/systemone'));
  assert.equal(readRun(sandbox, 'c38-fixture').manifest.corpus.path, 'src/ai-study/corpus/revision-1.json');
});

test('C39: evidências ficam fora dos arquivos rastreados pelo Git e sobrevivem a nova coleta e à leitura para o relatório, sem limpeza automática', () => {
  // No repositório real: o diretório publicado de evidências é ignorado e não tem arquivos rastreados.
  assert.equal(evidenceDirFor(repoRoot), join(repoRoot, 'artifacts', 'ai-study'));
  const git = (...args) => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  for (const path of [
    'artifacts/ai-study/qualquer-run/manifest.json',
    'artifacts/ai-study/qualquer-run/results/001-R01-translate-pt-en.json',
    'artifacts/ai-study/qualquer-run/comparison.json',
    `artifacts/ai-study/${LOCK_NAME}`,
  ]) {
    assert.equal(git('check-ignore', '-q', path).status, 0, `${path} ignorado pelo Git`);
  }
  assert.equal(git('ls-files', '--', 'artifacts').stdout, '', 'nenhuma evidência rastreada');

  const sandbox = makeSandbox();
  assert.equal(runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c39-primeira' } }).status, 0);
  const incomplete = liveRun(sandbox, 'c39-incompleta', { env: { AI_STUDY_TEST_FAIL: 'jev:1:http' } });
  assert.equal(incomplete.nodeStatus, 1);
  // Arquivos alheios à bancada também ficam: anotações humanas e um temporário de uma queda anterior.
  writeFileSync(join(sandbox.evidenceDir, 'c39-primeira', 'notas.md'), 'anotação humana');
  writeFileSync(join(sandbox.evidenceDir, 'c39-incompleta', 'manifest.json.123.abc.tmp'), '{"parcial"');
  const before = snapshotFiles(sandbox.evidenceDir);

  assert.equal(runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c39-segunda' } }).status, 0);
  for (const runId of ['c39-primeira', 'c39-incompleta', 'c39-segunda']) loadRun(sandbox.evidenceDir, runId);
  const after = snapshotFiles(sandbox.evidenceDir);
  for (const [file, content] of Object.entries(before)) assert.equal(after[file], content, `${file} preservado`);
  assert.deepEqual(listRuns(sandbox).sort(), ['c39-incompleta', 'c39-primeira', 'c39-segunda']);
});

// Coleta fixture presa na barreira da primeira chamada, fora do orçamento (antes dela ou depois que terminou).
async function heldAtBarrier(sandbox, runId, at) {
  const barrier = join(sandbox.dir, `barrier-${runId}`);
  mkdirSync(barrier);
  const running = startMake(sandbox, 'ai-study-run', {
    vars: { RUN_ID: runId },
    env: { AI_STUDY_TEST_BARRIER_DIR: barrier, AI_STUDY_TEST_BARRIER_AT: at },
    preload: [fixtureBarrier],
  });
  const started = () => readdirSync(barrier).filter((f) => f.startsWith('started-'));
  await until(() => started().length === 1, `${runId}: a coleta chegar à barreira`);
  return { running, pid: Number(started()[0].slice('started-'.length)), release: () => writeFileSync(join(barrier, 'release'), '') };
}

function assertInterrupted(sandbox, runId, label) {
  const { manifest } = readRun(sandbox, runId);
  assert.equal(manifest.status, 'incomplete', label);
  assert.equal(manifest.reason, 'interrupted', label);
  assert.ok(!existsSync(join(sandbox.evidenceDir, LOCK_NAME)), `${label}: trava liberada`);
  return manifest;
}

test('C55: o primeiro SIGINT ou SIGTERM encerra a espera e a coleta como interrupted, com código 1 e trava liberada; o segundo segue o padrão', async () => {
  const sandbox = makeSandbox();
  // Sinal durante uma chamada sem resposta: a espera termina sem alegar cancelamento remoto.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const runId = `c55-${signal.toLowerCase()}`;
    const before = readServices(sandbox).length;
    const running = startMake(sandbox, 'ai-study-run', {
      vars: { MODE: 'live', RUN_ID: runId, ...validLive },
      env: { TYPESAFE_API_KEY: KEY, AI_STUDY_TEST_FAIL: 'jev:2:hang' },
      preload: [liveServices],
    });
    const hanging = () => readServices(sandbox).slice(before).filter((r) => r.url === JEV_ENDPOINT)[1];
    await until(() => hanging() !== undefined, `${signal}: a chamada Jev sem resposta`);
    process.kill(hanging().pid, signal);
    const result = await running.done;
    assert.equal(result.nodeStatus, 1, `${signal}: código 1 na linha "Error 1" (${result.output})`);
    const manifest = assertInterrupted(sandbox, runId, signal);
    assert.deepEqual(
      [manifest.failure.item, manifest.failure.request_sent, manifest.failure.remote_outcome],
      ['R01-evaluate-en', true, 'unknown'],
      signal,
    );
    assert.match(manifest.failure.message, /cancelamento da inferência remota não foi confirmado/, signal);
    assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/, signal);
    assert.deepEqual(manifest.not_executed_items, remainingAfter('R01-evaluate-en'), signal);
  }

  // Sinal fora de uma chamada, entre itens: a coleta para antes do próximo, sem chamada em andamento.
  const between = await heldAtBarrier(sandbox, 'c55-entre-chamadas', 'after');
  process.kill(between.pid, 'SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 200));
  between.release();
  const betweenResult = await between.running.done;
  assert.equal(betweenResult.nodeStatus, 1, betweenResult.output);
  assert.match(betweenResult.stderr, /coleta interrompida antes de R01-evaluate-pt/);
  const betweenManifest = assertInterrupted(sandbox, 'c55-entre-chamadas', 'entre chamadas');
  assert.equal(betweenManifest.failure, null, 'nenhuma chamada interrompida');
  assert.deepEqual(betweenManifest.completed_items, ['R01-translate-pt-en']);
  assert.deepEqual(betweenManifest.not_executed_items, remainingAfter('R01-translate-pt-en'));
  assert.deepEqual(betweenManifest.calls.local, { used: 1, limit: 20 });

  // Sinal antes do envio: a chamada seguinte não sai e o item continua entre os não executados.
  const beforeSend = await heldAtBarrier(sandbox, 'c55-antes-do-envio', 'before');
  process.kill(beforeSend.pid, 'SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 200));
  beforeSend.release();
  const beforeResult = await beforeSend.running.done;
  assert.equal(beforeResult.nodeStatus, 1, beforeResult.output);
  const beforeManifest = assertInterrupted(sandbox, 'c55-antes-do-envio', 'antes do envio');
  assert.deepEqual(
    [beforeManifest.failure.item, beforeManifest.failure.request_sent, beforeManifest.failure.remote_outcome],
    ['R01-translate-pt-en', false, 'not_sent'],
  );
  assert.deepEqual(beforeManifest.not_executed_items, PLANNED);
  assert.deepEqual(beforeManifest.calls.local, { used: 0, limit: 20 });

  // Ctrl+C real: SIGINT no grupo inteiro, make inclusive. A coleta termina igual; o make morre pelo próprio
  // sinal ("Interrupt", sem linha "Error N"), e o término autoritativo é o do manifesto.
  const groupBefore = readServices(sandbox).length;
  const group = startMake(sandbox, 'ai-study-run', {
    vars: { MODE: 'live', RUN_ID: 'c55-grupo', ...validLive },
    env: { TYPESAFE_API_KEY: KEY, AI_STUDY_TEST_FAIL: 'jev:2:hang' },
    preload: [liveServices],
    processGroup: true,
  });
  await until(() => readServices(sandbox).slice(groupBefore).filter((r) => r.url === JEV_ENDPOINT).length === 2, 'a chamada Jev sem resposta');
  process.kill(-group.child.pid, 'SIGINT');
  const groupResult = await group.done;
  assert.deepEqual([groupResult.status, groupResult.signal, groupResult.nodeStatus], [null, 'SIGINT', null], groupResult.output);
  assert.match(groupResult.stderr, /coleta interrompida durante a espera/);
  assert.match(groupResult.stderr, /\] Interrupt$/m);
  const groupManifest = assertInterrupted(sandbox, 'c55-grupo', 'grupo');
  assert.deepEqual([groupManifest.failure.item, groupManifest.failure.remote_outcome], ['R01-evaluate-en', 'unknown']);

  // Segundo sinal: o primeiro já foi consumido (a coleta está presa fora de uma chamada, na barreira), e o
  // segundo encerra o processo pelo comportamento padrão, sem limpeza; a trava fica para remoção manual.
  const second = await heldAtBarrier(sandbox, 'c55-segundo', 'before');
  process.kill(second.pid, 'SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(second.running.child.exitCode, null, 'o primeiro sinal não encerra o processo fora de uma chamada');
  process.kill(second.pid, 'SIGINT');
  const result = await second.running.done;
  assert.equal(result.nodeStatus, 130, `encerrado pelo SIGINT (128 + 2), sem término da coleta: ${result.output}`);
  assert.equal(readJson(join(sandbox.evidenceDir, 'c55-segundo', 'manifest.json')).status, 'running', 'nenhuma limpeza');
  assert.equal(readJson(join(sandbox.evidenceDir, LOCK_NAME)).pid, second.pid, 'trava do processo encerrado pelo sinal');
});
