import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { caseText, runCollection } from '../../src/ai-study/collect.mjs';
import { buildComparison, compareChoice, pairCase, scoreEvaluation } from '../../src/ai-study/comparison.mjs';
import { JEV_ENDPOINT, resolveConfig } from '../../src/ai-study/config.mjs';
import { CHOICES, JUDGMENT_IDS, loadCorpus } from '../../src/ai-study/corpus.mjs';
import { IncompleteError } from '../../src/ai-study/errors.mjs';
import { buildJevBody, createJevTransport, JEV_RUBRIC, questionHashes, validateEvaluation } from '../../src/ai-study/jev.mjs';
import { createLmStudioTransport } from '../../src/ai-study/lmstudio.mjs';
import { TRANSLATION_TEMPLATE } from '../../src/ai-study/template.mjs';
import {
  liveServices,
  liveServicesFixtureJev,
  liveServicesFixtureJevResponse,
  listRuns,
  loadDefaultCorpus,
  makeSandbox,
  readRun,
  readServices,
  repoRoot,
  runMake,
  validLive,
  writeCorpusVariant,
} from './helpers.mjs';

const KEY = 'sentinela-chave-jev-41c9';
const LOCAL_MODEL = validLive.LOCAL_MODEL;
const JEV_MODEL = validLive.JEV_MODEL;
const corpus = loadDefaultCorpus();
const relational = corpus.relational_cases;
// Template confirmado só no teste: o template versionado ainda não é o oficial (AC 12).
// Ordem das avaliações (C24): R ímpar PT/EN, R par EN/PT; a n-ésima chamada Jev é ORDER[n - 1].
const ORDER = relational.flatMap((c, i) => (i % 2 === 0 ? [[c.id, 'pt'], [c.id, 'en']] : [[c.id, 'en'], [c.id, 'pt']]));
const confirmedTemplate = Object.freeze({ ...TRANSLATION_TEMPLATE, official: true, justification: 'confirmado somente neste teste' });

function liveConfig(runId, env = {}) {
  return resolveConfig('run', { MODE: 'live', RUN_ID: runId, ...validLive, TYPESAFE_API_KEY: KEY, ...env }, { repoRoot });
}

const expectedOf = (caseId, judgment) =>
  relational.find((c) => c.id === caseId).expectations.find((e) => e.judgment === judgment).expected;

function answer(choice = 'no', overrides = {}) {
  const probabilities = Object.fromEntries(CHOICES.map((c) => [c, c === choice ? 0.8 : 0.1]));
  return { type: 'choice', choice, probabilities, confidence: 0.6, ...overrides };
}

const allAnswers = (pick = () => answer()) => Object.fromEntries(JUDGMENT_IDS.map((id) => [id, pick(id)]));

// fetch controlado de LM Studio e Jev: registra cada pedido HTTP completo; `jev` decide a resposta por chamada.
function services({ jev = () => ({ body: { model: JEV_MODEL, answers: allAnswers(), usage: { input_tokens: 400, output_tokens: 12 } } }), translation = (body) => `English text ${createHash('sha256').update(body.prompt).digest('hex').slice(0, 12)}` } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const call = {
      href: parsed.href,
      path: parsed.pathname,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      rawBody: init.body ?? null,
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    if (call.href === JEV_ENDPOINT) {
      const { status, body, delayMs } = jev(call, calls.filter((c) => c.href === JEV_ENDPOINT).length);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return reply(body, status);
    }
    if (call.method === 'GET' && call.path === `/api/v0/models/${encodeURIComponent(LOCAL_MODEL)}`) {
      return reply({ id: LOCAL_MODEL, quantization: 'Q6_K', state: 'loaded' });
    }
    if (call.method === 'POST' && call.path === '/api/v0/completions') {
      return reply({ model: LOCAL_MODEL, choices: [{ text: translation(call.body), finish_reason: 'stop' }], usage: null });
    }
    return reply({ error: 'rota inesperada' }, 500);
  };
  return { fetch, calls, jevCalls: () => calls.filter((c) => c.href === JEV_ENDPOINT), lmCalls: () => calls.filter((c) => c.href !== JEV_ENDPOINT) };
}

// Adaptadores reais com fetch controlado; a contagem de tokens é controlada (C16: o LM Studio não a expõe).
function adapters(config, fetch) {
  const local = createLmStudioTransport(config, { fetch });
  return {
    local: { ...local, countTokens: async () => ({ count: 100, tokenizer: LOCAL_MODEL }) },
    jev: createJevTransport(config, { fetch }),
  };
}

async function collect(sandbox, runId, { svc = services(), env, transports } = {}) {
  const config = liveConfig(runId, env);
  const corpusInfo = loadCorpus(config.corpusPath);
  let error = null;
  try {
    await runCollection({
      config,
      corpusInfo,
      transports: transports ?? adapters(config, svc.fetch),
      evidenceDir: sandbox.evidenceDir,
      translationTemplate: confirmedTemplate,
    });
  } catch (caught) {
    error = caught;
  }
  const run = readRun(sandbox, runId);
  return { error, run, svc, comparison: JSON.parse(readFileSync(join(run.runDir, 'comparison.json'), 'utf8')) };
}

const evaluationResults = (run) => run.results.filter((r) => r.item.kind === 'evaluation');

test('C21: o adaptador Jev envia os seis julgamentos como perguntas Choice independentes yes/no/insufficient na mesma chamada', async () => {
  const sandbox = makeSandbox();
  const { error, run, svc } = await collect(sandbox, 'c21');
  assert.equal(error, null);
  assert.equal(run.manifest.status, 'completed');

  const jevCalls = svc.jevCalls();
  assert.equal(jevCalls.length, 24, 'uma chamada por braço: 12 casos × 2 braços');
  const evaluations = evaluationResults(run);
  assert.equal(evaluations.length, 24);
  for (const [index, call] of jevCalls.entries()) {
    assert.equal(call.method, 'POST');
    assert.equal(call.href, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
    assert.deepEqual(Object.keys(call.body), ['state', 'model', 'questions'], 'corpo completo');
    assert.equal(call.body.model, JEV_MODEL);
    assert.deepEqual(Object.keys(call.body.questions), [...JUDGMENT_IDS], 'os seis julgamentos na mesma chamada');
    for (const id of JUDGMENT_IDS) {
      const question = call.body.questions[id];
      assert.deepEqual(Object.keys(question), ['type', 'instructions', 'criteria'], id);
      assert.equal(question.type, 'choice', id);
      assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id);
      assert.ok(Object.values(question.criteria).every((d) => typeof d === 'string' && d.length > 0), id);
      assert.ok(question.instructions.includes(JEV_RUBRIC.instructions[id]), `${id}: rubrica própria`);
    }
    // Perguntas independentes: nenhuma instrução cita outro julgamento ou depende de resultado anterior.
    for (const id of JUDGMENT_IDS) {
      for (const other of JUDGMENT_IDS.filter((o) => o !== id)) {
        assert.ok(!call.body.questions[id].instructions.includes(other), `${id} não referencia ${other}`);
      }
    }
    // Pedido persistido igual ao corpo HTTP enviado.
    assert.deepEqual(evaluations[index].request.body, call.body);
    assert.equal(JSON.stringify(evaluations[index].request.body), call.rawBody);
  }
});

test('C22: payloads de tradução e Jev contêm zero gabaritos, justificativas de referência ou revisões humanas', async () => {
  const sandbox = makeSandbox();
  const SENTINEL = 'GABARITO-SENTINELA';
  // Mesmo corpus com gabarito trocado: rótulos rotacionados, justificativas, invariantes e títulos sentinela.
  const rotate = { yes: 'no', no: 'insufficient', insufficient: 'yes' };
  const altered = writeCorpusVariant(sandbox, 'gabarito-alterado', (c) => {
    for (const r of c.relational_cases) {
      r.title = `${SENTINEL}-titulo-${r.id}`;
      for (const e of r.expectations) {
        e.expected = rotate[e.expected];
        e.justification = `${SENTINEL}-justificativa-${r.id}-${e.judgment}`;
      }
    }
    for (const t of c.translation_cases) {
      t.title = `${SENTINEL}-titulo-${t.id}`;
      t.invariants = `${SENTINEL}-invariantes-${t.id}`;
    }
  });
  // Revisão humana de outra execução no diretório de evidências: nunca é lida nem enviada.
  mkdirSync(join(sandbox.evidenceDir, 'anterior'), { recursive: true });
  writeFileSync(
    join(sandbox.evidenceDir, 'anterior', 'semantic-review.json'),
    JSON.stringify({ reviews: [{ case_id: 'R01', status: 'meaning_changed', reviewer: 'humano', justification: `${SENTINEL}-revisao` }] }),
  );

  const base = await collect(sandbox, 'c22-base');
  const alt = await collect(sandbox, 'c22-alt', { env: { CORPUS: altered } });
  for (const outcome of [base, alt]) {
    assert.equal(outcome.error, null);
    assert.equal(outcome.svc.lmCalls().filter((c) => c.method === 'POST').length, 18);
    assert.equal(outcome.svc.jevCalls().length, 24);
  }
  assert.notEqual(alt.run.manifest.corpus.gabarito_hash, base.run.manifest.corpus.gabarito_hash, 'gabaritos diferentes');

  const sent = (outcome) => outcome.svc.calls.map((c) => `${c.method} ${c.href}\n${c.rawBody ?? ''}`);
  for (const payload of sent(alt)) assert.ok(!payload.includes(SENTINEL), 'sentinela em payload enviado');
  // Payloads byte a byte iguais com gabaritos diferentes: nada do gabarito chega aos modelos.
  assert.deepEqual(sent(alt), sent(base));
  for (const r of base.run.results) {
    const keys = Object.keys(r.request).sort();
    if (r.item.kind === 'translation') assert.deepEqual(keys, ['direction', 'prompt', 'text']);
    else assert.deepEqual(keys, ['arm', 'body', 'judgments', 'text']);
  }
});

test('C23: cada par mantém instruções em inglês, rubricas, IDs, critérios e modelo Jev iguais; só o texto varia', async () => {
  const sandbox = makeSandbox();
  const translated = (caseId) => `Translated case text number ${caseId.length}`;
  const svc = services({ translation: () => translated('x') });
  const { error, run } = await collect(sandbox, 'c23', { svc });
  assert.equal(error, null);
  const byItem = new Map(evaluationResults(run).map((r) => [r.item.id, r]));
  const jevBodies = svc.jevCalls().map((c) => c.body);
  const reference = buildJevBody({ model: JEV_MODEL, text: '' });
  for (const body of jevBodies) {
    assert.deepEqual(body.questions, reference.questions, 'mesmas instruções e critérios em todas as chamadas');
    assert.equal(body.model, JEV_MODEL);
  }
  for (const c of relational) {
    const pt = byItem.get(`${c.id}-evaluate-pt`);
    const en = byItem.get(`${c.id}-evaluate-en`);
    assert.deepEqual(pt.request.body.questions, en.request.body.questions, c.id);
    assert.deepEqual(Object.keys(pt.request.body.questions), Object.keys(en.request.body.questions), `${c.id}: IDs`);
    assert.equal(pt.request.body.model, en.request.body.model, c.id);
    assert.equal(pt.evaluation.instructions_hash, en.evaluation.instructions_hash, c.id);
    assert.equal(pt.evaluation.criteria_hash, en.evaluation.criteria_hash, c.id);
    assert.equal(pt.evaluation.returned_model, en.evaluation.returned_model, c.id);
    // A única variação: original versus tradução.
    assert.equal(pt.request.body.state, caseText(c), c.id);
    assert.equal(en.request.body.state, translated('x'), c.id);
    assert.notEqual(pt.request.body.state, en.request.body.state, c.id);
    // IDs do caso, do item e dos julgamentos ficam fora do texto avaliado e do texto traduzido.
    for (const state of [pt.request.body.state, en.request.body.state]) {
      for (const id of [c.id, pt.item.id, en.item.id, ...JUDGMENT_IDS]) assert.ok(!state.includes(id), `${c.id}: ${id} no estado`);
    }
  }
  const prompts = svc.lmCalls().filter((c) => c.method === 'POST').map((c) => c.body.prompt);
  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /\b[RT]\d{2}\b/, 'ID de caso no texto traduzido');
    for (const id of JUDGMENT_IDS) assert.ok(!prompt.includes(id), `${id} no texto traduzido`);
  }
  // Instruções em inglês: a rubrica não carrega as perguntas em português do corpus.
  for (const question of Object.values(reference.questions)) {
    assert.match(question.instructions, /^The state is a working note/);
    for (const j of corpus.judgments) assert.ok(!question.instructions.includes(j.question), 'rubrica em português');
    assert.doesNotMatch(question.instructions, /[ãçõáéíóúâê]/i, 'acentuação do português nas instruções');
  }
});

test('C24: na ordem do corpus os braços alternam PT/EN e EN/PT, preservando caso e braço em cada resultado', async () => {
  const sandbox = makeSandbox();
  const { error, run, svc } = await collect(sandbox, 'c24');
  assert.equal(error, null);
  const expectedOrder = ORDER;
  assert.equal(expectedOrder[0].join(), 'R01,pt');
  assert.equal(expectedOrder[2].join(), 'R02,en');
  assert.equal(expectedOrder.at(-1).join(), 'R12,pt');
  // Ordem real das chamadas HTTP, identificada pelo estado enviado (o caso não vai no corpo).
  const translations = new Map(
    run.results.filter((r) => r.item.kind === 'translation' && r.item.direction === 'pt->en').map((r) => [r.translation.derived_text, r.item.case_id]),
  );
  const ptTexts = new Map(relational.map((c) => [caseText(c), c.id]));
  const sentOrder = svc.jevCalls().map((c) =>
    ptTexts.has(c.body.state) ? [ptTexts.get(c.body.state), 'pt'] : [translations.get(c.body.state), 'en'],
  );
  // Traduções distintas por caso, para o estado identificar o braço EN.
  assert.equal(translations.size, 12);
  assert.deepEqual(sentOrder, expectedOrder);
  const persisted = evaluationResults(run).map((r) => [r.item.case_id, r.item.arm]);
  assert.deepEqual(persisted, expectedOrder);
  for (const r of evaluationResults(run)) {
    assert.equal(r.evaluation.case_id, r.item.case_id);
    assert.equal(r.evaluation.arm, r.item.arm);
    assert.equal(r.item.id, `${r.item.case_id}-evaluate-${r.item.arm}`);
  }
});

function validResults() {
  return JUDGMENT_IDS.map((judgment) => ({ judgment, ...answer('yes') }));
}

function mutateFirst(mutate) {
  const results = validResults();
  mutate(results[0], results);
  return results;
}

test('C25: a validação Jev só aceita seis resultados choice válidos e gera invalid_response sem inferir escolha', async () => {
  const accepted = [
    ['válido', validResults()],
    ['probabilidade 0 e 1', mutateFirst((r) => (r.probabilities = { yes: 1, no: 0, insufficient: 0 }))],
    ['soma a menos de 0,000001', mutateFirst((r) => (r.probabilities = { yes: 0.5, no: 0.25, insufficient: 0.2500005 }))],
    ['soma a exatamente 0,000001 acima', mutateFirst((r) => (r.probabilities = { yes: 0.5, no: 0.25, insufficient: 0.250001 }))],
    ['soma a exatamente 0,000001 abaixo', mutateFirst((r) => (r.probabilities = { yes: 0.5, no: 0.25, insufficient: 0.249999 }))],
    ['confiança 0', mutateFirst((r) => (r.confidence = 0))],
    ['confiança 1', mutateFirst((r) => (r.confidence = 1))],
    ['escolha insufficient', mutateFirst((r) => (r.choice = 'insufficient'))],
  ];
  for (const [label, results] of accepted) assert.deepEqual(validateEvaluation(results), [], label);

  const rejected = [
    ['lista ausente', null, /lista de resultados/],
    ['ID ausente', validResults().slice(1), /ID ausente b_depends_on_a/],
    ['ID extra', [...validResults(), { judgment: 'other', ...answer() }], /ID extra other/],
    ['ID repetido', [...validResults(), { judgment: 'complements', ...answer() }], /ID repetido complements/],
    ['tipo score', mutateFirst((r) => (r.type = 'score')), /não é choice/],
    ['tipo ausente', mutateFirst((r) => delete r.type), /não é choice/],
    ['escolha fora do domínio', mutateFirst((r) => (r.choice = 'maybe')), /fora do domínio/],
    ['escolha em maiúscula', mutateFirst((r) => (r.choice = 'Yes')), /fora do domínio/],
    ['escolha em prosa', mutateFirst((r) => (r.choice = 'yes, because A qualifies B')), /fora do domínio/],
    ['escolha ausente com prosa', mutateFirst((r) => { delete r.choice; r.text = 'yes'; }), /fora do domínio/],
    ['probabilidades ausentes', mutateFirst((r) => delete r.probabilities), /probabilidades ausentes/],
    ['probabilidade ausente', mutateFirst((r) => delete r.probabilities.insufficient), /probabilidade de insufficient/],
    ['probabilidade extra', mutateFirst((r) => (r.probabilities.maybe = 0)), /probabilidade extra maybe/],
    ['probabilidade NaN', mutateFirst((r) => (r.probabilities.yes = Number.NaN)), /probabilidade de yes/],
    ['probabilidade infinita', mutateFirst((r) => (r.probabilities.yes = Number.POSITIVE_INFINITY)), /probabilidade de yes/],
    ['probabilidade texto', mutateFirst((r) => (r.probabilities.yes = '0.8')), /probabilidade de yes/],
    ['probabilidade abaixo de 0', mutateFirst((r) => (r.probabilities = { yes: 1.1, no: -0.1, insufficient: 0 })), /probabilidade de no/],
    ['probabilidade acima de 1', mutateFirst((r) => (r.probabilities = { yes: 1.1, no: 0, insufficient: 0 })), /probabilidade de yes/],
    ['soma acima da tolerância', mutateFirst((r) => (r.probabilities = { yes: 0.5, no: 0.25, insufficient: 0.2500011 })), /soma/],
    ['soma abaixo da tolerância', mutateFirst((r) => (r.probabilities = { yes: 0.5, no: 0.25, insufficient: 0.2499989 })), /soma/],
    ['confiança ausente', mutateFirst((r) => delete r.confidence), /confiança/],
    ['confiança abaixo de 0', mutateFirst((r) => (r.confidence = -0.01)), /confiança/],
    ['confiança acima de 1', mutateFirst((r) => (r.confidence = 1.01)), /confiança/],
    ['confiança NaN', mutateFirst((r) => (r.confidence = Number.NaN)), /confiança/],
    ['confiança infinita', mutateFirst((r) => (r.confidence = Number.NEGATIVE_INFINITY)), /confiança/],
    ['confiança texto', mutateFirst((r) => (r.confidence = '0.5')), /confiança/],
  ];
  for (const [label, results, pattern] of rejected) {
    const problems = validateEvaluation(results);
    assert.ok(problems.length > 0, label);
    assert.match(problems.join('\n'), pattern, label);
  }

  // Pela fronteira do adaptador e do coletor: resposta inválida vira invalid_response persistida, sem escolha.
  const sandbox = makeSandbox();
  const scenarios = [
    ['c25-missing', { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(allAnswers()).slice(1)) }, /ID ausente/],
    ['c25-prose', { model: JEV_MODEL, answers: allAnswers((id) => (id === 'same_block' ? { type: 'choice', text: 'yes' } : answer())) }, /same_block: escolha null/],
    ['c25-no-answers', { model: JEV_MODEL, output: 'yes, yes, no, yes, no, insufficient' }, /lista de resultados/],
    ['c25-not-json', 'yes', /lista de resultados/],
    ['c25-sum', { model: JEV_MODEL, answers: allAnswers(() => answer('no', { probabilities: { yes: 0.5, no: 0.5, insufficient: 0.1 } })) }, /soma/],
  ];
  for (const [runId, body, pattern] of scenarios) {
    // Primeira avaliação (R01 PT) válida; a segunda (R01 EN) é a resposta inválida.
    const svc = services({ jev: (_, n) => (n === 2 ? { body } : { body: { model: JEV_MODEL, answers: allAnswers() } }) });
    const { error, run, comparison } = await collect(sandbox, runId, { svc });
    assert.ok(error instanceof IncompleteError, runId);
    assert.equal(error.exitCode, 1, runId);
    assert.equal(run.manifest.status, 'incomplete', runId);
    assert.equal(run.manifest.reason, 'invalid_response', runId);
    const invalid = evaluationResults(run).at(-1);
    assert.equal(invalid.item.id, 'R01-evaluate-en', runId);
    assert.equal(invalid.evaluation.status, 'invalid_response', runId);
    assert.equal(invalid.evaluation.results, null, `${runId}: nenhuma escolha inferida`);
    assert.match(invalid.evaluation.problems.join('\n'), pattern, runId);
    assert.equal(evaluationResults(run)[0].evaluation.status, 'valid', `${runId}: braço anterior preservado`);
    assert.equal(svc.jevCalls().length, 2, `${runId}: coleta encerrada`);
    // Fora das comparações completas.
    const pair = comparison.pairs.find((p) => p.case_id === 'R01');
    assert.equal(pair.status, 'incomplete', runId);
    assert.ok(pair.reasons.includes('en_invalid'), `${runId}: ${pair.reasons}`);
    assert.equal(comparison.counts.paired.denominator, 0, runId);
    const enJudgments = comparison.evaluations.find((e) => e.item === 'R01-evaluate-en').judgments;
    assert.ok(enJudgments.every((j) => j.choice === null && j.outcome === 'absent'), runId);
  }
});

test('C26: a avaliação persistida identifica execução, caso, braço, escolha, distribuição, confiança, modelo, uso e duração', async () => {
  const sandbox = makeSandbox();
  const usage = { input_tokens: 512, output_tokens: 18 };
  const pick = (id) => answer(id === 'complements' ? 'insufficient' : 'yes', { confidence: 0.42 });
  // Primeira chamada informa uso e modelo retornado; a segunda omite o uso.
  const svc = services({
    jev: (_, n) => ({
      delayMs: 30,
      body: n === 2 ? { model: 'jev-test-model-2026-09', answers: allAnswers(pick) } : { model: 'jev-test-model-2026-09', answers: allAnswers(pick), usage },
    }),
  });
  const { error, run } = await collect(sandbox, 'c26', { svc });
  assert.equal(error, null);
  const [first, second] = evaluationResults(run);
  for (const r of [first, second]) {
    const e = r.evaluation;
    assert.equal(r.run_id, 'c26');
    assert.equal(e.run_id, 'c26');
    assert.equal(e.case_id, 'R01');
    assert.equal(e.requested_model, JEV_MODEL);
    assert.equal(e.returned_model, 'jev-test-model-2026-09', 'modelo retornado, não o solicitado');
    assert.equal(e.status, 'valid');
    assert.deepEqual(e.results.map((x) => x.judgment), [...JUDGMENT_IDS]);
    for (const x of e.results) {
      const expected = pick(x.judgment);
      assert.equal(x.choice, expected.choice);
      assert.deepEqual(x.probabilities, expected.probabilities);
      assert.equal(x.confidence, 0.42);
    }
    assert.ok(Number.isInteger(e.duration_ms) && e.duration_ms >= 25, `duração em ms: ${e.duration_ms}`);
  }
  assert.deepEqual([first.evaluation.arm, second.evaluation.arm], ['pt', 'en']);
  assert.deepEqual(first.evaluation.usage, { available: true, value: usage });
  // Ausência de uso fica identificada, sem virar zero.
  assert.equal(second.evaluation.usage.available, false);
  assert.ok(!('value' in second.evaluation.usage));
  assert.match(second.evaluation.usage.justification, /não é custo zero/);
  assert.ok(!JSON.stringify(second.evaluation.usage).includes(':0'), 'uso ausente não vira zero');
  assert.equal(second.derived_from, 'R01-translate-pt-en');
  assert.equal(run.manifest.evaluation.requested_model, JEV_MODEL);
  assert.equal(run.manifest.evaluation.rubric_revision, first.evaluation.rubric_revision);
});

test('C27: escolha válida igual ao gabarito conta acerto, diferente conta erro, sem escolha válida conta ausência', async () => {
  const rows = [
    ['yes', 'yes', 'hit'],
    ['no', 'no', 'hit'],
    ['insufficient', 'insufficient', 'hit'],
    ['no', 'yes', 'miss'],
    ['yes', 'insufficient', 'miss'],
    ['insufficient', 'no', 'miss'],
    [null, 'yes', 'absent'],
    [undefined, 'insufficient', 'absent'],
  ];
  for (const [choice, expected, outcome] of rows) assert.equal(compareChoice(choice, expected), outcome, `${choice} × ${expected}`);
  const expectations = relational[0].expectations;
  assert.ok(scoreEvaluation({ status: 'invalid_response', results: null }, expectations).every((j) => j.outcome === 'absent'));
  assert.ok(scoreEvaluation(null, expectations).every((j) => j.outcome === 'absent'), 'braço não executado');

  // Pela coleta: PT responde o gabarito, EN responde sempre `insufficient`; o gabarito só é conhecido pelo teste.
  const sandbox = makeSandbox();
  const svc = services({
    jev: (call, n) => {
      const [caseId, arm] = ORDER[n - 1];
      assert.equal(arm === 'pt', call.body.state === caseText(relational.find((c) => c.id === caseId)), `chamada ${n}`);
      return { body: { model: JEV_MODEL, answers: allAnswers((id) => answer(arm === 'pt' ? expectedOf(caseId, id) : 'insufficient')) } };
    },
  });
  const { error, comparison } = await collect(sandbox, 'c27', { svc });
  assert.equal(error, null);
  assert.equal(comparison.counts.paired.denominator, 12);
  for (const judgment of JUDGMENT_IDS) {
    const insufficientExpected = relational.filter((c) => expectedOf(c.id, judgment) === 'insufficient').length;
    assert.deepEqual(comparison.counts.individual.by_arm.pt[judgment], { hit: 12, miss: 0, absent: 0 }, judgment);
    assert.deepEqual(
      comparison.counts.individual.by_arm.en[judgment],
      { hit: insufficientExpected, miss: 12 - insufficientExpected, absent: 0 },
      `${judgment}: insufficient é escolha, não ausência`,
    );
    assert.deepEqual(comparison.counts.paired.by_arm.en[judgment], comparison.counts.individual.by_arm.en[judgment]);
  }
  const r08 = comparison.evaluations.find((e) => e.item === 'R08-evaluate-en');
  for (const j of r08.judgments) {
    assert.equal(j.choice, 'insufficient');
    assert.equal(j.expected, expectedOf('R08', j.judgment));
    assert.equal(j.outcome, j.expected === 'insufficient' ? 'hit' : 'miss');
  }
});

function record(caseId, arm, overrides = {}) {
  const body = buildJevBody({ model: JEV_MODEL, text: `${caseId}-${arm}` });
  return {
    corpus_hash: 'sha256:corpus',
    gabarito_hash: 'sha256:gabarito',
    item: { id: `${caseId}-evaluate-${arm}`, kind: 'evaluation', case_id: caseId, arm },
    evaluation: {
      status: 'valid',
      returned_model: 'jev-v1',
      ...questionHashes(body),
      results: JUDGMENT_IDS.map((judgment) => ({ judgment, choice: 'yes' })),
      ...overrides.evaluation,
    },
    ...overrides.record,
  };
}

test('C28: par sem braço válido ou com configuração divergente fica incompleto e fora do denominador pareado', async () => {
  const reference = { corpus_hash: 'sha256:corpus', gabarito_hash: 'sha256:gabarito' };
  const otherBody = buildJevBody({ model: JEV_MODEL, text: 'x', rubric: { ...JEV_RUBRIC, instructions: { ...JEV_RUBRIC.instructions, same_block: 'Other.' } } });
  const otherCriteria = buildJevBody({ model: JEV_MODEL, text: 'x', rubric: { ...JEV_RUBRIC, criteria: { ...JEV_RUBRIC.criteria, no: 'Other.' } } });
  const table = [
    ['par completo', [record('R01', 'pt'), record('R01', 'en')], []],
    ['braço PT ausente', [record('R01', 'en')], ['pt_missing']],
    ['braço EN ausente', [record('R01', 'pt')], ['en_missing']],
    ['braço inválido', [record('R01', 'pt'), record('R01', 'en', { evaluation: { status: 'invalid_response', results: null } })], ['en_invalid']],
    ['corpus divergente', [record('R01', 'pt'), record('R01', 'en', { record: { corpus_hash: 'sha256:outro' } })], ['reference_mismatch']],
    ['gabarito divergente', [record('R01', 'pt', { record: { gabarito_hash: 'sha256:outro' } }), record('R01', 'en')], ['reference_mismatch']],
    ['instruções divergentes', [record('R01', 'pt'), record('R01', 'en', { evaluation: { instructions_hash: questionHashes(otherBody).instructions_hash } })], ['instructions_mismatch']],
    ['critérios divergentes', [record('R01', 'pt'), record('R01', 'en', { evaluation: { criteria_hash: questionHashes(otherCriteria).criteria_hash } })], ['criteria_mismatch']],
    ['versão Jev divergente', [record('R01', 'pt'), record('R01', 'en', { evaluation: { returned_model: 'jev-v2' } })], ['jev_model_mismatch']],
    ['versão Jev não identificada', [record('R01', 'pt', { evaluation: { returned_model: null } }), record('R01', 'en')], ['jev_model_unknown']],
  ];
  assert.notEqual(questionHashes(otherBody).instructions_hash, questionHashes(buildJevBody({ model: JEV_MODEL, text: 'x' })).instructions_hash);
  assert.notEqual(questionHashes(otherCriteria).criteria_hash, questionHashes(buildJevBody({ model: JEV_MODEL, text: 'x' })).criteria_hash);
  for (const [label, records, reasons] of table) {
    const pair = pairCase('R01', records, reference);
    assert.deepEqual(pair.reasons, reasons, label);
    assert.equal(pair.status, reasons.length === 0 ? 'complete' : 'incomplete', label);
    const comparison = buildComparison({ runId: 'c28', corpus, reference, records });
    assert.equal(comparison.counts.paired.denominator, reasons.length === 0 ? 1 : 0, `${label}: denominador`);
    // O resultado individual concluído continua visível e contado.
    for (const r of records) {
      const visible = comparison.evaluations.find((e) => e.item === r.item.id);
      assert.ok(visible, `${label}: ${r.item.id} visível`);
      if (r.evaluation.status === 'valid') {
        const hits = comparison.counts.individual.by_arm[r.item.arm];
        assert.equal(JUDGMENT_IDS.reduce((n, j) => n + hits[j].hit + hits[j].miss, 0), 6, `${label}: ${r.item.arm} contado`);
      }
    }
  }

  // Pela coleta: R01 sem tradução válida (EN não avaliado) e R02 com versão Jev diferente no braço EN.
  const sandbox = makeSandbox();
  const r02Pt = caseText(relational[1]);
  let r02Seen = 0;
  const svc = services({
    translation: (body) => (body.prompt.includes(caseText(relational[0])) ? '   ' : 'Translated.'),
    jev: (call, n) => {
      // R02 começa por EN (C24): a chamada logo antes do PT de R02 é o seu braço EN.
      if (call.body.state === r02Pt) r02Seen = n;
      return { body: { model: n === 2 ? 'jev-v2' : 'jev-v1', answers: allAnswers() } };
    },
  });
  const { error, run, comparison } = await collect(sandbox, 'c28-collect', { svc });
  assert.ok(error instanceof IncompleteError);
  assert.equal(run.manifest.reason, 'invalid_translation');
  assert.equal(r02Seen, 3, 'chamadas: R01 PT, R02 EN, R02 PT');
  const r01 = comparison.pairs.find((p) => p.case_id === 'R01');
  assert.deepEqual([r01.status, r01.reasons, r01.arms], ['incomplete', ['en_missing'], { pt: 'R01-evaluate-pt', en: null }]);
  const r02 = comparison.pairs.find((p) => p.case_id === 'R02');
  assert.deepEqual([r02.status, r02.reasons], ['incomplete', ['jev_model_mismatch']]);
  assert.equal(comparison.counts.paired.denominator, 10);
  assert.ok(!comparison.counts.paired.cases.includes('R01') && !comparison.counts.paired.cases.includes('R02'));
  for (const item of ['R01-evaluate-pt', 'R02-evaluate-en', 'R02-evaluate-pt']) {
    const visible = comparison.evaluations.find((e) => e.item === item);
    assert.equal(visible.status, 'valid', `${item} visível`);
  }
  assert.equal(comparison.counts.individual.by_arm.en.complements.absent, 1, 'R01 EN ausente');
  assert.equal(comparison.counts.individual.by_arm.pt.complements.absent, 0);
});

test('C52: make ai-study-run MODE=live com LM Studio e Jev controlados invoca zero processos Codex, Claude, Grok, agy ou Cloak', () => {
  const sandbox = makeSandbox();
  const run = runMake(sandbox, 'ai-study-run', {
    vars: { MODE: 'live', RUN_ID: 'c52-live', ...validLive },
    env: { TYPESAFE_API_KEY: KEY },
    preload: [liveServices],
  });
  assert.equal(run.status, 0, run.output);
  assert.match(run.stdout, /Coleta live concluída/);
  const evidence = readRun(sandbox, 'c52-live');
  assert.equal(evidence.manifest.mode, 'live');
  assert.equal(evidence.manifest.status, 'completed');
  assert.equal(evidence.results.length, 42, '18 traduções e 24 avaliações');
  assert.ok(evidence.results.every((r) => r.provenance === 'live'));
  assert.ok(evaluationResults(evidence).every((r) => r.evaluation.status === 'valid'));

  assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada');
  assert.deepEqual(run.guard.attempts, [], 'nenhum processo nem socket');
  // Somente o servidor local configurado e o endpoint oficial do Jev foram chamados.
  const requests = readServices(sandbox);
  const destinations = [...new Set(requests.map((r) => new URL(r.url).origin))].sort();
  assert.deepEqual(destinations, ['http://127.0.0.1:1234', 'https://api.typesafe.ai']);
  assert.equal(requests.filter((r) => r.url === JEV_ENDPOINT).length, 24);
  assert.equal(requests.filter((r) => r.url.endsWith('/api/v0/completions')).length, 18);
  assert.ok(!readFileSync(sandbox.servicesLog, 'utf8').includes(KEY), 'chave fora do registro');
});

test('C53: na fronteira make MODE=live, transporte ou resposta fixture do Jev é rejeitado com código 2, preservando evidências', () => {
  const sandbox = makeSandbox();
  const previous = runMake(sandbox, 'ai-study-run', { vars: { MODE: 'live', RUN_ID: 'c53-anterior', ...validLive }, env: { TYPESAFE_API_KEY: KEY }, preload: [liveServices] });
  assert.equal(previous.status, 0, previous.output);
  const before = readRun(sandbox, 'c53-anterior');

  for (const [runId, preload, jevCalled] of [
    ['c53-transport', liveServicesFixtureJev, false],
    ['c53-response', liveServicesFixtureJevResponse, true],
  ]) {
    const callsBefore = readServices(sandbox).length;
    const run = runMake(sandbox, 'ai-study-run', { vars: { MODE: 'live', RUN_ID: runId, ...validLive }, env: { TYPESAFE_API_KEY: KEY }, preload: [preload] });
    assert.equal(run.status, 2, `${runId}: ${run.output}`);
    assert.equal(run.nodeStatus, 2, `${runId}: código do Node`);
    assert.match(run.stderr, /proveniência "fixture" incompatível com MODE=live em R01-evaluate-pt/, runId);
    const evidence = readRun(sandbox, runId);
    assert.equal(evidence.manifest.status, 'rejected', runId);
    assert.equal(evidence.manifest.reason, 'provenance_mismatch', runId);
    // Prefixo live preservado; a avaliação rejeitada não vira evidência.
    assert.deepEqual(evidence.results.map((r) => [r.item.id, r.provenance]), [['R01-translate-pt-en', 'live']], runId);
    assert.ok(evidence.manifest.not_executed_items.includes('R01-evaluate-pt'), runId);
    const jevRequests = readServices(sandbox).slice(callsBefore).filter((r) => r.url === JEV_ENDPOINT);
    assert.equal(jevRequests.length, jevCalled ? 1 : 0, `${runId}: chamadas Jev`);
    assert.equal(run.shimCalls, '', runId);
  }
  // Execução anterior intacta byte a byte.
  const after = readRun(sandbox, 'c53-anterior');
  assert.deepEqual(after.rawResults, before.rawResults);
  assert.deepEqual(after.manifest, before.manifest);
  assert.deepEqual(listRuns(sandbox).sort(), ['c53-anterior', 'c53-response', 'c53-transport']);
});
