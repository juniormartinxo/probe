import assert from 'node:assert/strict';
import test from 'node:test';

import { createCallBudget } from '../../src/ai-study/calls.mjs';
import { caseText, runCollection } from '../../src/ai-study/collect.mjs';
import { resolveConfig } from '../../src/ai-study/config.mjs';
import { fileHash, loadCorpus } from '../../src/ai-study/corpus.mjs';
import { IncompleteError } from '../../src/ai-study/errors.mjs';
import { createLmStudioTransport } from '../../src/ai-study/lmstudio.mjs';
import { renderPrompt, templateRevision, TRANSLATION_TEMPLATE } from '../../src/ai-study/template.mjs';
import { defaultCorpusPath, loadDefaultCorpus, makeSandbox, readRun, repoRoot, validLive } from './helpers.mjs';

const MODEL = validLive.LOCAL_MODEL;
// Template confirmado só no teste: o template versionado ainda não é o oficial (AC 12).
const confirmedTemplate = Object.freeze({
  ...TRANSLATION_TEMPLATE,
  id: 'test/confirmed-template',
  official: true,
  justification: 'confirmado somente neste teste',
});

function liveConfig(runId, env = {}) {
  return resolveConfig('run', { MODE: 'live', RUN_ID: runId, ...validLive, TYPESAFE_API_KEY: 'chave-de-teste-s2', ...env }, { repoRoot });
}

// Transportes controlados de proveniência live; cada chamada fica registrada com o pedido completo.
function controlled(overrides = {}) {
  const calls = [];
  const call = (service, op, request, fallback) => {
    calls.push({ service, op, request });
    return overrides[op] ? overrides[op](request) : fallback();
  };
  return {
    calls,
    transports: {
      local: {
        provenance: 'live',
        inspect: async (request) =>
          call('local', 'inspect', request, () => ({
            provenance: 'live',
            model: { id: MODEL, quantization: 'Q6_K', state: 'loaded' },
          })),
        countTokens: async (request) => call('local', 'countTokens', request, () => ({ count: 100, tokenizer: MODEL })),
        translate: async (request) =>
          call('local', 'translate', request, () => ({
            provenance: 'live',
            output: `English text of ${request.item.case_id}`,
            finish_reason: 'stop',
            model: MODEL,
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            memory: null,
          })),
      },
      jev: {
        provenance: 'live',
        evaluate: async (request) =>
          // Desde a S3 a resposta Jev é validada: seis resultados choice válidos para a coleta seguir.
          call('jev', 'evaluate', request, () => ({
            provenance: 'live',
            model: 'jev-test-model',
            results: request.judgments.map((judgment) => ({
              judgment,
              type: 'choice',
              choice: 'yes',
              probabilities: { yes: 0.8, no: 0.1, insufficient: 0.1 },
              confidence: 0.7,
            })),
            usage: null,
          })),
      },
    },
  };
}

async function collect(sandbox, runId, { transports, template = confirmedTemplate, env } = {}) {
  const config = liveConfig(runId, env);
  const corpusInfo = loadCorpus(config.corpusPath);
  let error = null;
  try {
    // Dublês sem orçamento recebem um da execução; adaptadores reais trazem o seu (o mesmo dos dois serviços).
    const budgeted = { budget: createCallBudget(config.limits), ...transports };
    await runCollection({ config, corpusInfo, transports: budgeted, evidenceDir: sandbox.evidenceDir, translationTemplate: template });
  } catch (caught) {
    error = caught;
  }
  return { error, run: readRun(sandbox, runId) };
}

function assertIncomplete({ error, run }, reason) {
  assert.ok(error instanceof IncompleteError, `esperado IncompleteError, veio ${error}`);
  assert.equal(error.exitCode, 1);
  assert.equal(run.manifest.status, 'incomplete');
  assert.equal(run.manifest.reason, reason);
}

const only = (calls, op) => calls.filter((c) => c.op === op);
const translationResults = (run) => run.results.filter((r) => r.item.kind === 'translation');

// fetch controlado do LM Studio: registra método, caminho, cabeçalhos e corpo de cada pedido.
function fakeFetch(route) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const call = {
      href: parsed.href,
      path: parsed.pathname,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const { status = 200, body } = route(call);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

const modelInfo = (overrides = {}) => ({
  id: MODEL,
  object: 'model',
  type: 'llm',
  arch: 'gemma3',
  compatibility_type: 'gguf',
  quantization: 'Q6_K',
  state: 'loaded',
  max_context_length: 8192,
  ...overrides,
});

const completion = (text, overrides = {}) => ({
  id: 'cmpl-1',
  object: 'text_completion',
  model: MODEL,
  choices: [{ index: 0, text, logprobs: null, finish_reason: 'stop' }],
  usage: { prompt_tokens: 90, completion_tokens: 30, total_tokens: 120 },
  stats: { tokens_per_second: 40, time_to_first_token: 0.1, generation_time: 0.7, stop_reason: 'eosFound' },
  model_info: { arch: 'gemma3', quant: 'Q6_K', format: 'gguf', context_length: 8192 },
  runtime: { name: 'llama.cpp-linux-x86_64-nvidia-cuda', version: '1.0.0', supported_formats: ['gguf'] },
  ...overrides,
});

function lmStudioRoute(call) {
  if (call.method === 'GET' && call.path === `/api/v0/models/${encodeURIComponent(MODEL)}`) return { body: modelInfo() };
  if (call.method === 'POST' && call.path === '/api/v0/completions') return { body: completion('Translated text') };
  return { status: 500, body: { error: `rota inesperada ${call.method} ${call.path}` } };
}

// Adaptador LM Studio real com contagem controlada: o LM Studio não expõe contagem por HTTP (C16).
function lmStudioWithCount(config, fetch, jev) {
  const budget = createCallBudget(config.limits);
  const local = createLmStudioTransport(config, { fetch, budget });
  return { budget, local: { ...local, countTokens: async () => ({ count: 100, tokenizer: MODEL }) }, jev };
}

test('C13: toda tradução preparada registra original, direção, modelo solicitado e revisão do template, vinculados ao caso e à execução', async () => {
  const sandbox = makeSandbox();
  const { transports } = controlled();
  const { error, run } = await collect(sandbox, 'c13', { transports });
  assert.equal(error, null);

  const corpus = loadDefaultCorpus();
  const revision = templateRevision(confirmedTemplate);
  assert.match(revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(run.manifest.translation.requested_model, MODEL);
  assert.equal(run.manifest.translation.template.id, confirmedTemplate.id);
  assert.equal(run.manifest.translation.template.revision, revision);

  const results = translationResults(run);
  assert.equal(results.length, 18);
  for (const result of results) {
    const t = result.translation;
    assert.equal(result.run_id, 'c13');
    assert.equal(t.run_id, 'c13');
    assert.equal(t.case_id, result.item.case_id);
    assert.equal(t.requested_model, MODEL);
    assert.equal(t.template_id, confirmedTemplate.id);
    assert.equal(t.template_revision, revision);
    const relational = corpus.relational_cases.find((c) => c.id === t.case_id);
    if (relational) {
      assert.equal(t.direction, 'pt->en');
      assert.equal(t.original, caseText(relational));
    } else {
      const source = corpus.translation_cases.find((c) => c.id === t.case_id);
      assert.equal(t.direction, 'en->pt');
      assert.equal(t.original, source.original);
    }
  }
  assert.deepEqual(
    results.map((r) => r.translation.direction).reduce((acc, d) => ({ ...acc, [d]: (acc[d] ?? 0) + 1 }), {}),
    { 'pt->en': 12, 'en->pt': 6 },
  );

  // Pelo adaptador LM Studio: o pedido enviado carrega o modelo solicitado e o prompt renderizado do original.
  const lm = fakeFetch(lmStudioRoute);
  const config = liveConfig('c13-adapter');
  const adapterRun = await collect(sandbox, 'c13-adapter', {
    transports: lmStudioWithCount(config, lm.fetch, controlled().transports.jev),
  });
  assert.equal(adapterRun.error, null);
  const posts = lm.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 18);
  for (const [index, result] of translationResults(adapterRun.run).entries()) {
    const t = result.translation;
    assert.deepEqual(posts[index].body, {
      model: MODEL,
      prompt: renderPrompt(confirmedTemplate, t.direction, t.original),
      max_tokens: 2048,
      temperature: 0,
      stream: false,
    });
    assert.equal(result.request.prompt, posts[index].body.prompt, 'pedido persistido igual ao enviado');
    assert.equal(t.derived_text, 'Translated text');
    assert.equal(t.requested_model, MODEL);
    assert.equal(t.template_revision, revision);
  }
});

test('C14: template oficial não confirmado encerra a coleta incomplete com template_unverified, sem enviar tradução', async () => {
  const sandbox = makeSandbox();
  assert.equal(TRANSLATION_TEMPLATE.official, false, 'o template versionado é uma adaptação não confirmada');

  const { transports, calls } = controlled();
  const outcome = await collect(sandbox, 'c14', { transports, template: TRANSLATION_TEMPLATE });
  assertIncomplete(outcome, 'template_unverified');
  assert.match(outcome.error.message, /template/);
  assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev');
  assert.deepEqual(outcome.run.resultFiles, []);
  assert.deepEqual(outcome.run.manifest.not_executed_items, outcome.run.manifest.planned_items);
  const template = outcome.run.manifest.translation.template;
  assert.equal(template.id, TRANSLATION_TEMPLATE.id);
  assert.equal(template.revision, templateRevision(TRANSLATION_TEMPLATE));
  assert.equal(template.official, false);
  assert.ok(template.justification.length > 0);

  // Pelo adaptador LM Studio: zero pedidos HTTP.
  const lm = fakeFetch(lmStudioRoute);
  const config = liveConfig('c14-adapter');
  const budget = createCallBudget(config.limits);
  const adapter = await collect(sandbox, 'c14-adapter', {
    transports: { budget, local: createLmStudioTransport(config, { fetch: lm.fetch, budget }), jev: controlled().transports.jev },
    template: TRANSLATION_TEMPLATE,
  });
  assertIncomplete(adapter, 'template_unverified');
  assert.deepEqual(lm.calls, []);
});

test('C15: entrada formatada de 2048 tokens é admitida e 2049 é bloqueada com input_limit, sem envio nem truncamento', async () => {
  const sandbox = makeSandbox();

  const admitted = controlled({ countTokens: () => ({ count: 2048, tokenizer: MODEL }) });
  const ok = await collect(sandbox, 'c15-2048', { transports: admitted.transports });
  assert.equal(ok.error, null);
  const counted = only(admitted.calls, 'countTokens');
  const sent = only(admitted.calls, 'translate');
  assert.equal(sent.length, 18);
  for (const [index, call] of sent.entries()) {
    const t = translationResults(ok.run)[index].translation;
    const expected = renderPrompt(confirmedTemplate, t.direction, t.original);
    // A contagem inclui o template: o prompt contado é o prompt formatado completo, idêntico ao enviado.
    assert.equal(counted[index].request.prompt, expected);
    assert.equal(call.request.prompt, expected);
    assert.ok(expected.includes(t.original), 'original completo no prompt');
    assert.ok(expected.length > t.original.length, 'prompt inclui o template');
    assert.equal(t.input_tokens.count, 2048);
  }

  const blocked = controlled({ countTokens: () => ({ count: 2049, tokenizer: MODEL }) });
  const first = await collect(sandbox, 'c15-2049', { transports: blocked.transports });
  assertIncomplete(first, 'input_limit');
  assert.deepEqual(only(blocked.calls, 'translate'), []);
  assert.deepEqual(only(blocked.calls, 'evaluate'), []);
  assert.deepEqual(first.run.resultFiles, []);
  const r01 = loadDefaultCorpus().relational_cases[0];
  assert.deepEqual(
    { ...first.run.manifest.blocked },
    {
      item: 'R01-translate-pt-en',
      reason: 'input_limit',
      case_id: 'R01',
      direction: 'pt->en',
      original: caseText(r01),
      requested_model: MODEL,
      template_id: confirmedTemplate.id,
      template_revision: templateRevision(confirmedTemplate),
      token_count: 2049,
      tokenizer: MODEL,
      limit: 2048,
      justification: first.run.manifest.blocked.justification,
    },
  );

  // Bloqueio no meio: prefixo preservado, item bloqueado e restantes não executados.
  const late = controlled({
    countTokens: (request) => ({ count: request.item.case_id === 'T03' ? 2049 : 2048, tokenizer: MODEL }),
  });
  const middle = await collect(sandbox, 'c15-t03', { transports: late.transports });
  assertIncomplete(middle, 'input_limit');
  assert.equal(middle.run.manifest.blocked.item, 'T03-translate-en-pt');
  assert.ok(!only(late.calls, 'translate').some((c) => c.request.item.case_id === 'T03'));
  assert.deepEqual(middle.run.manifest.not_executed_items, [
    'T03-translate-en-pt',
    'T04-translate-en-pt',
    'T05-translate-en-pt',
    'T06-translate-en-pt',
  ]);
  assert.ok(middle.run.manifest.completed_items.includes('T02-translate-en-pt'));
});

test('C16: contagem indisponível ou de tokenizer não correspondente bloqueia o envio com token_count_unavailable', async () => {
  const sandbox = makeSandbox();
  const variants = {
    indisponivel: { count: null, tokenizer: null, justification: 'runtime sem contagem' },
    'tokenizer-diferente': { count: 10, tokenizer: 'outro-modelo' },
    'sem-tokenizer': { count: 10 },
    fracionario: { count: 10.5, tokenizer: MODEL },
    negativo: { count: -1, tokenizer: MODEL },
    nulo: null,
  };
  for (const [name, count] of Object.entries(variants)) {
    const { transports, calls } = controlled({ countTokens: () => count });
    const outcome = await collect(sandbox, `c16-${name}`, { transports });
    assertIncomplete(outcome, 'token_count_unavailable');
    assert.deepEqual(only(calls, 'translate'), [], name);
    assert.equal(outcome.run.manifest.blocked.item, 'R01-translate-pt-en', name);
    assert.equal(outcome.run.manifest.blocked.reason, 'token_count_unavailable', name);
    assert.ok(outcome.run.manifest.blocked.justification.length > 0, name);
  }

  // O adaptador LM Studio não tem contagem correspondente: bloqueia sem enviar a tradução.
  const lm = fakeFetch(lmStudioRoute);
  const config = liveConfig('c16-adapter');
  const budget = createCallBudget(config.limits);
  const local = createLmStudioTransport(config, { fetch: lm.fetch, budget });
  const count = await local.countTokens({ model: MODEL, prompt: 'x' });
  assert.equal(count.count, null);
  assert.ok(count.justification.length > 0);
  assert.deepEqual(lm.calls, [], 'contar não chama a rede');
  const adapter = await collect(sandbox, 'c16-adapter', { transports: { budget, local, jev: controlled().transports.jev } });
  assertIncomplete(adapter, 'token_count_unavailable');
  assert.deepEqual(
    lm.calls.map((c) => `${c.method} ${c.path}`),
    [`GET /api/v0/models/${encodeURIComponent(MODEL)}`],
  );
});

test('C17: saída da tradução é persistida literalmente como derivação vinculada ao original e usada no braço inglês', async () => {
  const sandbox = makeSandbox();
  const literal = (caseId) => `  Literal output for ${caseId}:\n\t"quoted" \\ ${caseId}  \n`;
  const { transports, calls } = controlled({
    translate: (request) => ({ provenance: 'live', output: literal(request.item.case_id), finish_reason: 'stop', model: MODEL }),
  });
  const corpusBefore = fileHash(defaultCorpusPath);
  const { error, run } = await collect(sandbox, 'c17', { transports });
  assert.equal(error, null);
  assert.equal(fileHash(defaultCorpusPath), corpusBefore, 'corpus original intacto');

  const corpus = loadDefaultCorpus();
  for (const result of translationResults(run)) {
    const t = result.translation;
    assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim');
    assert.equal(t.status, 'valid');
    assert.equal(t.id, result.item.id);
    assert.equal(t.run_id, 'c17');
    const source = [...corpus.relational_cases, ...corpus.translation_cases].find((c) => c.id === t.case_id);
    assert.equal(t.original, source.original ?? caseText(source), 'original preservado ao lado da derivação');
  }
  for (const c of corpus.relational_cases) {
    const evaluations = only(calls, 'evaluate').filter((call) => call.request.item.case_id === c.id);
    const en = evaluations.find((call) => call.request.arm === 'en');
    const pt = evaluations.find((call) => call.request.arm === 'pt');
    assert.equal(en.request.text, literal(c.id), `${c.id}: braço EN usa a derivação`);
    assert.equal(pt.request.text, caseText(c), `${c.id}: braço PT usa o original`);
    const enResult = run.results.find((r) => r.item.id === `${c.id}-evaluate-en`);
    assert.equal(enResult.derived_from, `${c.id}-translate-pt-en`);
  }

  // Pelo adaptador LM Studio: o texto da resposta HTTP chega literal à derivação e ao braço inglês.
  const raw = '\n  Raw LM Studio text \u00e9 "x"  \n';
  const lm = fakeFetch((call) => (call.method === 'POST' ? { body: completion(raw) } : lmStudioRoute(call)));
  const adapterJev = controlled();
  const adapter = await collect(sandbox, 'c17-adapter', {
    transports: lmStudioWithCount(liveConfig('c17-adapter'), lm.fetch, adapterJev.transports.jev),
  });
  assert.equal(adapter.error, null);
  for (const result of translationResults(adapter.run)) {
    assert.equal(result.translation.derived_text, raw);
    assert.equal(result.response.output, raw);
  }
  assert.ok(only(adapterJev.calls, 'evaluate').filter((c) => c.request.arm === 'en').every((c) => c.request.text === raw));
});

test('C18: tradução vazia, só espaços ou encerrada por limite vira invalid_translation, sem Jev do braço inglês', async () => {
  const sandbox = makeSandbox();
  const outputs = {
    R01: { output: '', finish_reason: 'stop' },
    R02: { output: ' \n\t ', finish_reason: 'stop' },
    R03: { output: 'Partial English text cut at the', finish_reason: 'length' },
    T01: { output: '', finish_reason: 'stop' },
  };
  const { transports, calls } = controlled({
    translate: (request) => ({
      provenance: 'live',
      model: MODEL,
      ...(outputs[request.item.case_id] ?? { output: `Valid ${request.item.case_id}`, finish_reason: 'stop' }),
    }),
  });
  const outcome = await collect(sandbox, 'c18', { transports });
  assertIncomplete(outcome, 'invalid_translation');

  const byCase = Object.fromEntries(translationResults(outcome.run).map((r) => [r.translation.case_id, r.translation]));
  for (const [caseId, expected] of Object.entries(outputs)) {
    assert.equal(byCase[caseId].status, 'invalid_translation', caseId);
    assert.equal(byCase[caseId].derived_text, expected.output, `${caseId}: saída preservada`);
    assert.equal(byCase[caseId].invalid_reason, expected.finish_reason === 'length' ? 'output_limit' : 'empty_output');
  }
  assert.equal(byCase.R04.status, 'valid');

  const evaluated = only(calls, 'evaluate').map((c) => `${c.request.item.case_id}-${c.request.arm}`);
  for (const caseId of ['R01', 'R02', 'R03']) {
    assert.ok(!evaluated.includes(`${caseId}-en`), `${caseId}: sem Jev EN`);
    assert.ok(evaluated.includes(`${caseId}-pt`), `${caseId}: braço PT segue visível`);
  }
  assert.ok(evaluated.includes('R04-en'));
  assert.deepEqual(outcome.run.manifest.skipped_items, [
    { item: 'R01-evaluate-en', reason: 'invalid_translation' },
    { item: 'R02-evaluate-en', reason: 'invalid_translation' },
    { item: 'R03-evaluate-en', reason: 'invalid_translation' },
  ]);
  assert.deepEqual(outcome.run.manifest.not_executed_items, ['R01-evaluate-en', 'R02-evaluate-en', 'R03-evaluate-en']);

  // Pelo adaptador LM Studio: finish_reason `length` da resposta real chega à classificação.
  const lm = fakeFetch((call) =>
    call.method === 'POST'
      ? { body: completion('Cut', { choices: [{ index: 0, text: 'Cut', finish_reason: 'length' }] }) }
      : lmStudioRoute(call),
  );
  const adapter = await collect(sandbox, 'c18-adapter', {
    transports: lmStudioWithCount(liveConfig('c18-adapter'), lm.fetch, controlled().transports.jev),
  });
  assertIncomplete(adapter, 'invalid_translation');
  for (const result of translationResults(adapter.run)) {
    assert.equal(result.translation.status, 'invalid_translation');
    assert.equal(result.translation.invalid_reason, 'output_limit');
    assert.equal(result.translation.derived_text, 'Cut');
  }
  assert.equal(adapter.run.manifest.skipped_items.length, 12, 'nenhum braço inglês avaliado');
});

test('C19: registro da tradução contém duração em ms e modelo/tokens/memória do runtime, com justificativa do que faltar', async () => {
  const sandbox = makeSandbox();
  const usage = { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 };
  const memory = { vram_used_bytes: 9_000_000_000 };
  const { transports } = controlled({
    translate: async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return request.item.case_id === 'R01'
        ? { provenance: 'live', output: 'Text', finish_reason: 'stop', model: MODEL, usage, memory }
        : { provenance: 'live', output: 'Text', finish_reason: 'stop', model: MODEL, usage: null, memory: null };
    },
  });
  const { error, run } = await collect(sandbox, 'c19', { transports });
  assert.equal(error, null);

  for (const result of translationResults(run)) {
    const { duration_ms: duration } = result.translation;
    assert.ok(Number.isInteger(duration) && duration >= 25, `${result.item.id}: duração medida em ms (${duration})`);
  }
  const [r01, r02] = translationResults(run).map((r) => r.translation.runtime);
  assert.deepEqual(r01.model, { available: true, value: MODEL });
  assert.deepEqual(r01.tokens, { available: true, value: usage });
  assert.deepEqual(r01.memory, { available: true, value: memory });
  assert.deepEqual(r02.model, { available: true, value: MODEL });
  for (const field of ['tokens', 'memory']) {
    assert.equal(r02[field].available, false, field);
    assert.ok(!('value' in r02[field]), `${field}: sem valor inventado`);
    assert.ok(r02[field].justification.length > 0, field);
  }
  assert.match(r02.memory.justification, /download/);
  assert.match(r02.memory.justification, /VRAM/);

  // Modelo não informado na resposta live: registrado como indisponível, com justificativa, e a coleta
  // para sem aceitar a saída (C20).
  const unnamed = controlled({
    translate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { provenance: 'live', output: 'Text', finish_reason: 'stop', model: null, usage: null, memory: null };
    },
  });
  const missing = await collect(sandbox, 'c19-sem-modelo', { transports: unnamed.transports });
  assertIncomplete(missing, 'model_mismatch');
  const blockedRuntime = missing.run.manifest.blocked.runtime;
  for (const field of ['model', 'tokens', 'memory']) {
    assert.equal(blockedRuntime[field].available, false, field);
    assert.ok(!('value' in blockedRuntime[field]), `${field}: sem valor inventado`);
    assert.ok(blockedRuntime[field].justification.length > 0, field);
  }
  assert.ok(missing.run.manifest.blocked.duration_ms >= 25);

  // Pelo adaptador LM Studio: modelo e tokens vêm da resposta; memória não é informada nem inferida.
  const lm = fakeFetch(lmStudioRoute);
  const adapter = await collect(sandbox, 'c19-adapter', {
    transports: lmStudioWithCount(liveConfig('c19-adapter'), lm.fetch, controlled().transports.jev),
  });
  assert.equal(adapter.error, null);
  const runtime = translationResults(adapter.run)[0].translation.runtime;
  assert.deepEqual(runtime.model, { available: true, value: MODEL });
  assert.deepEqual(runtime.tokens, { available: true, value: completion('').usage });
  assert.equal(runtime.memory.available, false);
  assert.match(runtime.memory.justification, /VRAM/);
  assert.ok(Number.isInteger(translationResults(adapter.run)[0].translation.duration_ms));
  // A consulta de identidade também é chamada ao runtime: duração e metadados retornados registrados.
  const check = adapter.run.manifest.translation.model_check;
  assert.ok(Number.isInteger(check.duration_ms) && check.duration_ms >= 0);
  assert.deepEqual(check.model, {
    id: MODEL,
    quantization: 'Q6_K',
    compatibility_type: 'gguf',
    state: 'loaded',
    max_context_length: 8192,
  });
});

test('C20: o adaptador registra identidade solicitada e retornada; indisponível ou incompatível não troca, instala nem baixa modelo', async () => {
  const sandbox = makeSandbox();
  const jev = () => controlled().transports.jev;
  const modelPath = `/api/v0/models/${encodeURIComponent(MODEL)}`;

  // Identidade confirmada: solicitada e retornada registradas; envios usam só o modelo solicitado.
  const ok = fakeFetch(lmStudioRoute);
  const config = liveConfig('c20-ok', { LOCAL_API_TOKEN: 'token-local' });
  const confirmed = await collect(sandbox, 'c20-ok', {
    transports: lmStudioWithCount(config, ok.fetch, jev()),
    env: { LOCAL_API_TOKEN: 'token-local' },
  });
  assert.equal(confirmed.error, null);
  const { template: _, model_check: check, ...identity } = confirmed.run.manifest.translation;
  assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' });
  assert.equal(check.model.id, MODEL);
  for (const result of translationResults(confirmed.run)) assert.equal(result.translation.runtime.model.value, MODEL);
  assert.equal(ok.calls[0].method, 'GET');
  assert.equal(ok.calls[0].path, modelPath);
  for (const call of ok.calls) {
    assert.equal(call.headers.authorization, 'Bearer token-local');
    assert.ok(call.path === modelPath || call.path === '/api/v0/completions', call.path);
    if (call.method === 'POST') {
      assert.deepEqual(Object.keys(call.body).sort(), ['max_tokens', 'model', 'prompt', 'stream', 'temperature']);
      assert.equal(call.body.model, MODEL);
      assert.equal(call.body.max_tokens, 2048);
      assert.equal(call.body.stream, false);
    }
  }

  const blockedCases = {
    'c20-404': { route: { status: 404, body: { error: 'model not found' } }, reason: 'model_unavailable', returned: null },
    'c20-other': { route: { body: modelInfo({ id: 'outro-modelo-q4' }) }, reason: 'model_mismatch', returned: 'outro-modelo-q4' },
    // Nome solicitado contém q6_k, mas a quantização retornada é outra: não se infere identidade do nome.
    'c20-quant': { route: { body: modelInfo({ quantization: 'Q4_K_M' }) }, reason: 'model_mismatch', returned: MODEL },
  };
  for (const [runId, { route, reason, returned }] of Object.entries(blockedCases)) {
    const lm = fakeFetch((call) => (call.method === 'GET' ? route : lmStudioRoute(call)));
    const outcome = await collect(sandbox, runId, { transports: lmStudioWithCount(liveConfig(runId), lm.fetch, jev()) });
    assertIncomplete(outcome, reason);
    assert.deepEqual(lm.calls.map((c) => `${c.method} ${c.path}`), [`GET ${modelPath}`], `${runId}: só a consulta de identidade`);
    assert.equal(outcome.run.manifest.translation.requested_model, MODEL);
    assert.equal(outcome.run.manifest.translation.returned_model, returned);
    assert.deepEqual(outcome.run.resultFiles, []);
  }
  // Resposta de tradução sem identificação do modelo: nada confirma o candidato, então bloqueia.
  const anonymous = fakeFetch((call) =>
    call.method === 'POST' ? { body: completion('Text', { model: undefined }) } : lmStudioRoute(call),
  );
  const unnamed = await collect(sandbox, 'c20-unnamed', {
    transports: lmStudioWithCount(liveConfig('c20-unnamed'), anonymous.fetch, jev()),
  });
  assertIncomplete(unnamed, 'model_mismatch');
  assert.equal(anonymous.calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(unnamed.run.manifest.blocked.returned_model, null);
  assert.deepEqual(unnamed.run.resultFiles, [], 'saída sem identidade não vira evidência válida');

  // Prefixo de LOCAL_BASE_URL (proxy) é preservado; só o sufixo /v1 da API compatível sai do caminho.
  for (const [base, prefix] of [
    ['http://gateway:8080/lmstudio', '/lmstudio'],
    ['http://gateway:8080/lmstudio/v1/', '/lmstudio'],
    ['http://usuario:senha@127.0.0.1:1234/v1?x=1', ''],
  ]) {
    const runId = `c20-base-${prefix.replace('/', '') || 'raiz'}-${base.length}`;
    const routed = fakeFetch((call) =>
      lmStudioRoute({ ...call, path: call.path.startsWith(prefix) ? call.path.slice(prefix.length) : call.path }),
    );
    const outcome = await collect(sandbox, runId, {
      transports: lmStudioWithCount(liveConfig(runId, { LOCAL_BASE_URL: base }), routed.fetch, jev()),
    });
    assert.equal(outcome.error, null, base);
    assert.equal(routed.calls[0].path, `${prefix}${modelPath}`, base);
    assert.ok(routed.calls.every((c) => c.path.startsWith(`${prefix}/api/v0/`)), base);
    assert.ok(routed.calls.every((c) => !c.href.includes('senha') && !c.href.includes('?')), `${base}: sem credencial/query`);
  }

  // Resposta de tradução gerada por outro modelo no meio da coleta: bloqueia, sem aceitar a troca.
  let posts = 0;
  const swapped = fakeFetch((call) => {
    if (call.method !== 'POST') return lmStudioRoute(call);
    posts += 1;
    return { body: completion('Text', posts === 3 ? { model: 'outro-modelo' } : {}) };
  });
  const swap = await collect(sandbox, 'c20-swap', { transports: lmStudioWithCount(liveConfig('c20-swap'), swapped.fetch, jev()) });
  assertIncomplete(swap, 'model_mismatch');
  assert.equal(swapped.calls.filter((c) => c.method === 'POST').length, 3, 'nenhum envio após a troca');
  assert.equal(swap.run.manifest.blocked.item, 'R03-translate-pt-en');
  assert.equal(swap.run.manifest.blocked.returned_model, 'outro-modelo');
  assert.ok(!swap.run.manifest.completed_items.includes('R03-translate-pt-en'));
  assert.ok(swap.run.manifest.completed_items.includes('R02-translate-pt-en'));

  assert.equal(
    (await collect(sandbox, 'c20-quant-check', {
      transports: lmStudioWithCount(
        liveConfig('c20-quant-check'),
        fakeFetch((call) => (call.method === 'GET' ? { body: modelInfo({ quantization: 'Q4_K_M' }) } : lmStudioRoute(call)))
          .fetch,
        jev(),
      ),
    })).run.manifest.translation.quantization,
    'Q4_K_M',
  );
});
