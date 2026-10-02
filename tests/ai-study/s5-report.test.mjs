import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { createCallBudget } from '../../src/ai-study/calls.mjs';
import { planItems, runCollection } from '../../src/ai-study/collect.mjs';
import { JEV_ENDPOINT, resolveConfig } from '../../src/ai-study/config.mjs';
import { JUDGMENT_IDS, loadCorpus, sha256 } from '../../src/ai-study/corpus.mjs';
import { createJevTransport } from '../../src/ai-study/jev.mjs';
import { createLmStudioTransport } from '../../src/ai-study/lmstudio.mjs';
import { proveLiveRelational, proveLiveTranslation, SECTIONS } from '../../src/ai-study/report.mjs';
import { REPORT_TEXT } from '../../src/ai-study/report-text.mjs';
import { RECOMMENDATIONS } from '../../src/ai-study/review.mjs';
import { loadRun } from '../../src/ai-study/run-reader.mjs';
import { TRANSLATION_TEMPLATE } from '../../src/ai-study/template.mjs';
import {
  fsTrace,
  liveServices,
  listRuns,
  loadDefaultCorpus,
  makeSandbox,
  readFsTrace,
  readJson,
  readRun,
  repoRoot,
  runMake,
  snapshotFiles,
  validLive,
  variant,
  writeCorpusVariant,
} from './helpers.mjs';
import { sourceLiterals } from './support/source-literals.mjs';

const KEY = 'sentinela-chave-jev-s5-4c1a';
const LOCAL_MODEL = validLive.LOCAL_MODEL;
const JEV_MODEL = validLive.JEV_MODEL;
const corpus = loadDefaultCorpus();
const PLANNED = planItems(corpus);
const EVALUATION_ITEMS = PLANNED.filter((i) => i.kind === 'evaluation');
const TRANSLATION_ITEMS = PLANNED.filter((i) => i.kind === 'translation').map((i) => i.id);
const expectedOf = (caseId, judgment) =>
  corpus.relational_cases.find((c) => c.id === caseId).expectations.find((e) => e.judgment === judgment).expected;
// Template confirmado só no teste: o template versionado ainda não é o oficial (AC 12).
const confirmedTemplate = Object.freeze({ ...TRANSLATION_TEMPLATE, official: true, justification: 'confirmado somente neste teste' });
const otherChoice = (choice) => (choice === 'yes' ? 'no' : 'yes');

// LM Studio e Jev controlados, sem rede. O Jev responde o gabarito, salvo `choose`; `invalid` devolve
// uma resposta sem um dos julgamentos e `fail` uma falha de transporte, no item indicado.
function services({ choose = (_item, _judgment, expected) => expected, invalid = null, fail = null, onCall = () => {} } = {}) {
  let jevCalls = 0;
  let localPosts = 0;
  return async (url, init = {}) => {
    const href = new URL(url).href;
    const body = init.body ? JSON.parse(init.body) : null;
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (href === JEV_ENDPOINT) {
      const item = EVALUATION_ITEMS[jevCalls++];
      onCall(item.id);
      if (fail === item.id) throw new TypeError('fetch failed');
      const answers = Object.fromEntries(
        JUDGMENT_IDS.filter((j) => !(invalid === item.id && j === 'answers_conflict')).map((j) => {
          const choice = choose(item, j, expectedOf(item.case_id, j));
          const probabilities = { yes: 0.1, no: 0.1, insufficient: 0.1, [choice]: 0.8 };
          return [j, { type: 'choice', choice, probabilities, confidence: 0.7 }];
        }),
      );
      return Response.json({ model: JEV_MODEL, answers, usage: { input_tokens: 400, output_tokens: 12 } });
    }
    if ((init.method ?? 'GET') === 'GET') return Response.json({ id: LOCAL_MODEL, quantization: 'Q6_K', state: 'loaded' });
    const item = PLANNED.filter((i) => i.kind === 'translation')[localPosts++];
    onCall(item.id);
    if (fail === item.id) throw new TypeError('fetch failed');
    return Response.json({
      model: body.model,
      choices: [{ text: `Controlled translation of ${item.case_id} (${item.direction}).`, finish_reason: 'stop' }],
      usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 },
    });
  };
}

// Coleta live com adaptadores reais, fetch controlado e o orçamento compartilhado, gravada no diretório
// de evidências do sandbox; o relatório é gerado depois pela fronteira `make`.
async function liveCollection(sandbox, runId, { fetch = services(), corpusPath, signal } = {}) {
  const env = { MODE: 'live', RUN_ID: runId, ...validLive, TYPESAFE_API_KEY: KEY, ...(corpusPath ? { CORPUS: corpusPath } : {}) };
  const config = resolveConfig('run', env, { repoRoot });
  const budget = createCallBudget(config.limits, { signal });
  const local = createLmStudioTransport(config, { fetch, budget });
  const transports = {
    budget,
    local: { ...local, countTokens: async () => ({ count: 100, tokenizer: LOCAL_MODEL }) },
    jev: createJevTransport(config, { fetch, budget }),
  };
  let error = null;
  try {
    await runCollection({
      config,
      corpusInfo: loadCorpus(config.corpusPath),
      transports,
      evidenceDir: sandbox.evidenceDir,
      translationTemplate: confirmedTemplate,
      signal,
    });
  } catch (caught) {
    error = caught;
  }
  return { error, run: readRun(sandbox, runId) };
}

function fixtureRun(sandbox, runId, vars = {}) {
  const run = runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: runId, ...vars } });
  assert.equal(run.status, 0, run.output);
  return readRun(sandbox, runId);
}

const reportPath = (sandbox, runId) => join(sandbox.repo, 'artifacts', 'ai-study-reports', `${runId}.md`);

function report(sandbox, runId, { env = {}, preload = [], expect = 0 } = {}) {
  const vars = runId === undefined ? {} : { RUN_ID: runId };
  const result = runMake(sandbox, 'ai-study-report', { vars, env, preload });
  assert.equal(result.nodeStatus, expect, `${runId}: ${result.output}`);
  if (expect === 0) result.markdown = readFileSync(reportPath(sandbox, runId), 'utf8');
  return result;
}

function writeReview(sandbox, runId, review) {
  writeFileSync(join(sandbox.evidenceDir, runId, 'review.json'), JSON.stringify({ schema_version: 1, run_id: runId, ...review }, null, 2));
}

// Revisão de cada tradução concluída, vinculada ao hash da saída gravada.
function reviewAll(run, status = 'faithful', { except = [] } = {}) {
  return run.results
    .filter((r) => r.item.kind === 'translation' && !except.includes(r.item.id))
    .map((r) => ({
      item: r.item.id,
      output_sha256: sha256(r.translation.derived_text),
      status,
      reviewer: 'Revisora Humana',
      justification: `Significado, valores, negações e condições preservados em ${r.item.case_id}.`,
    }));
}

function section(markdown, title) {
  const start = markdown.indexOf(`\n## ${title}\n`);
  assert.ok(start >= 0, `seção ${title}`);
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next < 0 ? undefined : next);
}

// Linhas de uma tabela de contagens sob um título `###`, indexadas pelo julgamento.
function countsTable(markdown, heading) {
  const start = markdown.indexOf(`### ${heading}`);
  assert.ok(start >= 0, heading);
  const rows = {};
  for (const line of markdown.slice(start).split('\n').slice(1)) {
    if (line.startsWith('###')) break;
    const match = line.match(/^\| `(\w+)` \| (.*) \|$/);
    if (match) rows[match[1]] = match[2].split(' | ').map(Number);
  }
  return rows;
}

const header = (markdown) => markdown.slice(0, markdown.indexOf('\n## '));
// Códigos gravados nas evidências só aparecem como código (entre crases), ao lado de um rótulo em português.
const EVIDENCE_CODES = /\b(pt_missing|en_missing|pt_invalid|en_invalid|reference_mismatch|instructions_mismatch|criteria_mismatch|jev_model_mismatch|jev_model_unknown|invalid_translation|temporary|not_evidence|not_in_manifest)\b/;
function assertNoBareCodes(markdown) {
  const prose = withoutFences(markdown).replace(/`[^`\n]*`/g, '');
  assert.doesNotMatch(prose, EVIDENCE_CODES, 'código em inglês solto na prosa');
}
const withoutFences = (markdown) => markdown.replace(/^(`{3,})text\n[\s\S]*?\n\1$/gm, '');
// Prosa do relatório (AC 33): todo texto fixo vem do catálogo `report-text.mjs`, fixado pelo hash abaixo.
// Português aprovado pelo usuário (revisão humana) em 02/10/2026, no PR #7 (PRB-7), para este hash. Mudar
// qualquer texto do catálogo exige nova revisão e novo hash aqui.
const APPROVED_REPORT_TEXT = 'sha256:e9a1e00ae3811fa4d02bbf761d83ad2db9652b7760db53f827f368a7c03b327b';
// Literais com letras que `report.mjs` pode ter fora de `text('<chave>')`: códigos gravados nas
// evidências (comparados ou mostrados entre crases), fragmentos de ID de item e o rótulo da cerca.
const REPORT_CODE_LITERALS = new Set([
  'translation', 'evaluation', 'live', 'valid', 'complete', 'completed', 'pending', 'faithful', 'meaning_changed',
  'simulated', 'collection_incomplete', 'items_not_executed', 'items_skipped', 'comparison_missing', 'review_pending',
  'inconclusive', 'evidence_complete', 'hit', 'miss', 'absent', 'recommendation',
  'en-pt', 'pt-en', 'en->pt', '-translate-', '-translate-en-pt', '-translate-pt-en', '-evaluate-', 'text\\n',
]);
// O gerador não tem prosa própria: cada literal com letras é chave existente do catálogo, código listado
// acima ou caminho de import. Toda chave do catálogo é usada.
function assertReportTextFromCatalogue() {
  const source = readFileSync(join(repoRoot, 'src', 'ai-study', 'report.mjs'), 'utf8');
  const literals = sourceLiterals(source);
  const keys = literals.filter((l) => l.before.endsWith('text(')).map((l) => l.value);
  const prose = literals
    .filter((l) => !l.before.endsWith('text(') && !l.before.endsWith('from ') && /\p{L}/u.test(l.value.replace(/\\./g, '')))
    .map((l) => l.value)
    .filter((value) => !REPORT_CODE_LITERALS.has(value));
  assert.deepEqual(prose, [], 'texto fora do catálogo em report.mjs');
  assert.deepEqual(keys.filter((key) => !(key in REPORT_TEXT.lines)), [], 'chave inexistente no catálogo');
  assert.deepEqual(Object.keys(REPORT_TEXT.lines).filter((key) => !keys.includes(key)), [], 'chave do catálogo sem uso');
  assert.equal(sha256(JSON.stringify(REPORT_TEXT)), APPROVED_REPORT_TEXT, 'catálogo do relatório diferente do aprovado');
}

test('C41: make ai-study-report gera Markdown só das evidências da execução, sem rede ou modelos; RUN_ID ausente ou inválido encerra com código 2', () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c41');
  fixtureRun(sandbox, 'c41-outra');

  const done = report(sandbox, 'c41', { preload: [fsTrace] });
  assert.match(done.stdout, /^relatório: artifacts\/ai-study-reports\/c41\.md$/m);
  assert.match(done.markdown, /^# Relatório do estudo de tradução e Jev — execução c41$/m);
  assert.ok(done.guard.loaded > 0, 'guarda carregada');
  assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos');

  // Leituras de dados: só a execução identificada; nem o corpus atual nem outra execução.
  const runDir = join(sandbox.evidenceDir, 'c41');
  const reads = readFsTrace(sandbox).filter((e) => !e.path.startsWith(join(sandbox.repo, 'src')) && !e.path.includes('/tests/ai-study/support/'));
  assert.ok(reads.some((e) => e.path === join(runDir, 'manifest.json')), 'manifesto lido');
  const outside = reads.filter((e) => relative(runDir, e.path).startsWith('..') && relative(join(sandbox.repo, 'artifacts', 'ai-study-reports'), e.path).startsWith('..'));
  assert.deepEqual(outside, [], 'nenhuma leitura fora da execução e do relatório');
  assert.ok(readFsTrace(sandbox).every((e) => !e.path.endsWith('revision-1.json')), 'corpus atual não lido');

  for (const [label, runId, pattern] of [
    ['omitido', undefined, /RUN_ID obrigatório para o relatório/],
    ['vazio', '', /RUN_ID inválido/],
    ['caminho', '../c41', /RUN_ID inválido/],
    ['65 caracteres', 'a'.repeat(65), /RUN_ID inválido/],
    ['não ASCII', 'execução', /RUN_ID inválido/],
    ['inexistente', 'c41-inexistente', /RUN_ID c41-inexistente não tem evidências/],
  ]) {
    const refused = report(sandbox, runId, { expect: 2 });
    assert.match(refused.stderr, pattern, label);
    assert.deepEqual(refused.guard.attempts, [], label);
  }
  assert.ok(!existsSync(reportPath(sandbox, 'c41-inexistente')));
});

test('C42: o Markdown apresenta as seis seções na ordem aprovada, em português, com originais e traduções literais', () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c42-base');
  // Saída com crases e barras: aparece literal, sem escapes, numa cerca mais longa.
  variant(sandbox, 'c42-base', 'c42', ({ edit }) => {
    edit('results/001-R01-translate-pt-en.json', (r) => ({ ...r, translation: { ...r.translation, derived_text: 'Text with ``` fence | pipe\n**not bold**' } }));
    // Texto livre das evidências com quebra de linha e título: fica numa linha.
    edit('manifest.json', (m) => ({
      ...m,
      reason: 'motivo\n## Seção falsa do motivo',
      skipped_items: [{ item: 'R12-evaluate-en', reason: 'invalid_translation\n## Seção falsa do item' }],
      translation: { ...m.translation, template: { ...m.translation.template, justification: 'adaptação\n\n## Seção falsa do template' } },
    }));
  });
  // Texto livre do revisor com quebra de linha e título: fica numa linha e não abre seção.
  const [r01] = reviewAll(readRun(sandbox, 'c42'));
  writeReview(sandbox, 'c42', {
    translations: [{ ...r01, justification: 'Preservado.\n## Seção falsa' }],
    recommendation: { decision: 'expand_study', reviewer: 'Revisora', justification: 'Ampliar.\n\n## Outra seção falsa' },
  });
  const { markdown } = report(sandbox, 'c42');
  assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => `## ${s}`));
  assert.ok(markdown.includes('  - Justificativa: Preservado. ## Seção falsa'));
  assert.ok(markdown.includes('(adaptação ## Seção falsa do template)'));
  assertReportTextFromCatalogue();
  assertNoBareCodes(markdown);
  assert.deepEqual(SECTIONS, ['Configuração e proveniência', 'Completude', 'Originais e traduções', 'Revisão semântica', 'Comparação Jev', 'Limitações']);
  for (const label of ['Estado técnico', 'Conclusão', 'Recomendação humana']) assert.match(header(markdown), new RegExp(`^- ${label}: `, 'm'));

  const translations = section(markdown, 'Originais e traduções');
  const records = readRun(sandbox, 'c42').results.filter((r) => r.item.kind === 'translation');
  assert.equal(records.length, 18);
  let cursor = 0;
  for (const r of records) {
    const at = translations.indexOf(`### ${r.item.id}`);
    assert.ok(at > cursor, `${r.item.id} na ordem`);
    cursor = at;
    assert.ok(translations.includes(`\n${r.translation.original}\n`), `${r.item.id}: original literal`);
    assert.ok(translations.includes(`\n${r.translation.derived_text}\n`), `${r.item.id}: tradução literal`);
  }
  assert.ok(translations.includes('````text\nText with ``` fence | pipe\n**not bold**\n````'));
});

test('C43: o relatório mostra acertos, erros e ausências por julgamento em cada braço e as contagens dos pares completos, com denominadores distintos', async () => {
  const sandbox = makeSandbox();
  // R01: par completo, com um erro no braço inglês. R02: braço inglês isolado; o português é uma resposta inválida.
  const fetch = services({
    choose: (item, judgment, expected) => (item.id === 'R01-evaluate-en' && judgment === 'answers_conflict' ? otherChoice(expected) : expected),
    invalid: 'R02-evaluate-pt',
  });
  const { error, run } = await liveCollection(sandbox, 'c43', { fetch });
  assert.match(error.message, /resposta Jev inválida/);
  assert.deepEqual(run.manifest.completed_items, ['R01-translate-pt-en', 'R01-evaluate-pt', 'R01-evaluate-en', 'R02-translate-pt-en', 'R02-evaluate-en', 'R02-evaluate-pt']);

  const jev = section(report(sandbox, 'c43').markdown, 'Comparação Jev');
  assert.match(jev, /^- Casos relacionais: 12$/m);
  assert.match(jev, /^- Avaliações válidas PT \(original\): 1 de 12$/m);
  assert.match(jev, /^- Avaliações válidas EN \(tradução\): 2 de 12$/m);
  assert.match(jev, /^- Pares completos: 1 de 12 \(`R01`\)$/m);

  // Colunas: PT acertos, erros, sem avaliação; EN acertos, erros, sem avaliação.
  const individual = countsTable(jev, 'Por braço e julgamento');
  const paired = countsTable(jev, 'Pares completos (denominador 1)');
  for (const j of JUDGMENT_IDS) {
    const conflict = j === 'answers_conflict';
    assert.deepEqual(individual[j], conflict ? [1, 0, 11, 1, 1, 10] : [1, 0, 11, 2, 0, 10], `individual ${j}`);
    assert.deepEqual(paired[j], conflict ? [1, 0, 0, 0, 1, 0] : [1, 0, 0, 1, 0, 0], `pareado ${j}`);
  }
  assert.match(jev, /^- `R02`: braço PT inválido \(`pt_invalid`\)$/m);
  assert.match(jev, /^- `R03`: braço PT ausente \(`pt_missing`\), braço EN ausente \(`en_missing`\)$/m);
  assertNoBareCodes(jev);
  assert.match(jev, /^- `R02-evaluate-pt`: `invalid_response`, .*problemas: ID ausente answers_conflict/m);
  assert.match(jev, /^\| `answers_conflict` \| no \| no \(acerto\) \| yes \(erro\) \|$/m);
});

test('C44: a revisão semântica aceita só pending, faithful ou meaning_changed; os dois últimos exigem revisor, justificativa e a saída concreta', () => {
  const sandbox = makeSandbox();
  const run = fixtureRun(sandbox, 'c44');
  const [r01, r02, t01] = ['R01-translate-pt-en', 'R02-translate-pt-en', 'T01-translate-en-pt'].map((id) => reviewAll(run).find((e) => e.item === id));
  writeReview(sandbox, 'c44', {
    translations: [
      r01,
      { ...t01, status: 'meaning_changed', justification: 'A negação do original foi invertida.' },
      { item: r02.item, status: 'pending' },
    ],
  });
  const valid = report(sandbox, 'c44');
  const review = section(valid.markdown, 'Revisão semântica');
  assert.match(review, /^- `pending`: 16; `faithful`: 1; `meaning_changed`: 1$/m);
  assert.ok(review.includes(`- \`${r01.item}\` — \`faithful\` — saída \`${r01.output_sha256}\`\n  - Revisor: Revisora Humana\n  - Justificativa: ${r01.justification}`));
  assert.ok(review.includes(`- \`${t01.item}\` — \`meaning_changed\` — saída \`${t01.output_sha256}\`\n  - Revisor: Revisora Humana\n  - Justificativa: A negação do original foi invertida.`));
  for (const id of TRANSLATION_ITEMS.filter((i) => i !== r01.item && i !== t01.item)) assert.match(review, new RegExp(`^- \`${id}\` — \`pending\` — saída \`sha256:`, 'm'));

  // Revisão recusada (código 2) não substitui o relatório anterior.
  for (const [label, translations, pattern] of [
    ['estado fora do domínio', [{ ...r01, status: 'approved' }], /status "approved" fora de pending, faithful, meaning_changed/],
    ['faithful sem revisor', [{ ...r01, reviewer: ' ' }], /faithful exige revisor/],
    ['meaning_changed sem justificativa', [{ ...t01, status: 'meaning_changed', justification: undefined }], /meaning_changed exige justificativa/],
    ['sem vínculo à saída', [{ ...r01, output_sha256: undefined }], /output_sha256 não corresponde à saída gravada/],
    ['saída de outro caso', [{ ...r01, output_sha256: r02.output_sha256 }], /output_sha256 não corresponde à saída gravada/],
    ['item que não é tradução', [{ ...r01, item: 'R01-evaluate-pt' }], /não é uma tradução concluída desta execução/],
    ['revisão repetida', [r01, r01], /revisão repetida/],
    ['campo extra', [{ ...r01, case_id: 'R01' }], /campo extra case_id/],
  ]) {
    writeReview(sandbox, 'c44', { translations });
    const refused = report(sandbox, 'c44', { expect: 2 });
    assert.match(refused.stderr, pattern, label);
    assert.equal(readFileSync(reportPath(sandbox, 'c44'), 'utf8'), valid.markdown, `${label}: relatório anterior intacto`);
  }
  writeReview(sandbox, 'c44', { run_id: 'outra-execucao', translations: [r01] });
  assert.match(report(sandbox, 'c44', { expect: 2 }).stderr, /pertence à execução outra-execucao/);
  writeFileSync(join(sandbox.evidenceDir, 'c44', 'review.json'), '{"schema_version": 1,');
  assert.match(report(sandbox, 'c44', { expect: 2 }).stderr, /review\.json de c44 recusado:\n {2}- JSON inválido/);
  rmSync(join(sandbox.evidenceDir, 'c44', 'review.json'));
  mkdirSync(join(sandbox.evidenceDir, 'c44', 'review.json'));
  assert.match(report(sandbox, 'c44', { expect: 2 }).stderr, /review\.json de c44 ilegível: EISDIR/);
});

test('C45: coleta com item faltante ou tradução pendente é inconclusive mesmo com todos os pares avaliados de acordo com o gabarito', async () => {
  const sandbox = makeSandbox();
  const conclusion = (markdown) => header(markdown).match(/^- Conclusão: `(\w+)`$/m)[1];
  const reasons = (markdown) => [...section(markdown, 'Completude').matchAll(/^ {2}- `(\w+)`: /gm)].map((m) => m[1]);

  // Controle: coleta completa, todas as escolhas iguais ao gabarito e todas as traduções revisadas.
  const complete = await liveCollection(sandbox, 'c45-completa');
  assert.equal(complete.error, null);
  writeReview(sandbox, 'c45-completa', { translations: reviewAll(complete.run) });
  let markdown = report(sandbox, 'c45-completa').markdown;
  assert.equal(conclusion(markdown), 'evidence_complete');
  assert.deepEqual(countsTable(markdown, 'Pares completos (denominador 12)').same_block, [12, 0, 0, 12, 0, 0]);

  // Uma única tradução pendente.
  writeReview(sandbox, 'c45-completa', { translations: reviewAll(complete.run, 'faithful', { except: ['T06-translate-en-pt'] }) });
  markdown = report(sandbox, 'c45-completa').markdown;
  assert.equal(conclusion(markdown), 'inconclusive');
  assert.deepEqual(reasons(markdown), ['review_pending']);
  assert.match(markdown, /`review_pending`: revisão semântica pendente em T06-translate-en-pt$/m);

  // Coleta interrompida por falha e por sinal: pares avaliados todos de acordo, traduções concluídas revisadas.
  const failed = await liveCollection(sandbox, 'c45-falha', { fetch: services({ fail: 'R03-evaluate-pt' }) });
  const interrupt = new AbortController();
  const interrupted = await liveCollection(sandbox, 'c45-interrompida', {
    fetch: services({ onCall: (id) => id === 'R02-evaluate-pt' && interrupt.abort() }),
    signal: interrupt.signal,
  });
  for (const [runId, collected, reason] of [['c45-falha', failed, 'transport_error'], ['c45-interrompida', interrupted, 'interrupted']]) {
    assert.equal(collected.run.manifest.reason, reason, runId);
    writeReview(sandbox, runId, { translations: reviewAll(collected.run) });
    markdown = report(sandbox, runId).markdown;
    assert.equal(conclusion(markdown), 'inconclusive', runId);
    assert.deepEqual(reasons(markdown), ['collection_incomplete', 'items_not_executed'], runId);
    const paired = countsTable(markdown, 'Pares completos');
    for (const j of JUDGMENT_IDS) assert.deepEqual([paired[j][1], paired[j][4]], [0, 0], `${runId} ${j}: nenhum erro`);
  }
});

test('C46: estado técnico e recomendação humana são campos distintos; as recomendações só aparecem registradas por humano, sem mudar o produto', () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c46');
  const productBefore = snapshotFiles(sandbox.repo);
  delete productBefore[relative(sandbox.repo, join(sandbox.evidenceDir, 'c46', 'review.json'))];
  const technical = (markdown) => header(markdown).match(/^- Estado técnico: .*$/m)[0];

  const none = report(sandbox, 'c46');
  assert.match(header(none.markdown), /^- Recomendação humana: não registrada/m);
  assert.match(none.stdout, /^recomendação humana: não registrada$/m);
  for (const decision of RECOMMENDATIONS) assert.ok(!none.output.includes(decision) && !none.markdown.includes(decision), decision);

  for (const decision of RECOMMENDATIONS) {
    writeReview(sandbox, 'c46', { translations: [], recommendation: { decision, reviewer: 'Decisora Humana', justification: `Escolha registrada: ${decision}.` } });
    const recorded = report(sandbox, 'c46');
    assert.equal(technical(recorded.markdown), technical(none.markdown), `${decision}: estado técnico inalterado`);
    assert.match(header(recorded.markdown), new RegExp(`^- Recomendação humana: \`${decision}\`, registrada por Decisora Humana: Escolha registrada: ${decision}\\.$`, 'm'));
    assert.match(recorded.stdout, new RegExp(`^recomendação humana: ${decision}$`, 'm'));
    for (const other of RECOMMENDATIONS.filter((d) => d !== decision)) assert.ok(!recorded.markdown.includes(other), `${decision}: ${other} ausente`);
  }
  for (const [label, recommendation, pattern] of [
    ['decisão fora do domínio', { decision: 'promote_candidate', reviewer: 'D', justification: 'J' }, /decisão "promote_candidate" fora de keep_candidate, reject_candidate, expand_study/],
    ['sem revisor', { decision: 'keep_candidate', justification: 'J' }, /recommendation: exige revisor/],
    ['sem justificativa', { decision: 'keep_candidate', reviewer: 'D' }, /recommendation: exige justificativa/],
  ]) {
    writeReview(sandbox, 'c46', { translations: [], recommendation });
    assert.match(report(sandbox, 'c46', { expect: 2 }).stderr, pattern, label);
  }

  // Nenhuma configuração do produto muda: só o relatório derivado é escrito.
  const productAfter = snapshotFiles(sandbox.repo);
  delete productAfter[relative(sandbox.repo, join(sandbox.evidenceDir, 'c46', 'review.json'))];
  delete productAfter['artifacts/ai-study-reports/c46.md'];
  assert.deepEqual(productAfter, productBefore);
});

test('C47: correção de gabarito gera revisão identificada sem alterar as métricas de evidência anterior; a nova comparação registra a revisão usada', () => {
  const sandbox = makeSandbox();
  const before = loadCorpus(join(sandbox.repo, 'src/ai-study/corpus/revision-1.json'));
  fixtureRun(sandbox, 'c47-r1');
  const first = report(sandbox, 'c47-r1').markdown;
  const pt = (markdown) => countsTable(section(markdown, 'Comparação Jev'), 'Por braço e julgamento').b_depends_on_a;
  // Fixture escolhe sempre `insufficient`: corrigir R01 para `insufficient` acrescenta um acerto.
  assert.equal(expectedOf('R01', 'b_depends_on_a'), 'yes');
  const corrected = writeCorpusVariant(sandbox, 'revisao-2', (c) => {
    c.revision = 2;
    const e = c.relational_cases[0].expectations.find((x) => x.judgment === 'b_depends_on_a');
    Object.assign(e, { expected: 'insufficient', justification: 'Correção fundamentada da revisão 2.' });
  });
  const after = loadCorpus(corrected);
  assert.notEqual(after.gabaritoHash, before.gabaritoHash);

  fixtureRun(sandbox, 'c47-r2', { CORPUS: corrected });
  const second = report(sandbox, 'c47-r2').markdown;
  assert.match(second, new RegExp(`^- Corpus: \`${corrected}\`, revisão 2$`, 'm'));
  assert.ok(second.includes(`Gabarito usado: revisão 2, hash \`${after.gabaritoHash}\``));
  assert.deepEqual(pt(second), [pt(first)[0] + 1, pt(first)[1] - 1, 0, pt(first)[0] + 1, pt(first)[1] - 1, 0]);

  // Substituir o corpus versionado pela correção não reescreve a evidência anterior nem suas métricas.
  writeFileSync(join(sandbox.repo, 'src/ai-study/corpus/revision-1.json'), readFileSync(corrected));
  const again = report(sandbox, 'c47-r1').markdown;
  assert.equal(again, first, 'relatório da execução anterior idêntico');
  assert.ok(again.includes(`Gabarito usado: revisão 1, hash \`${before.gabaritoHash}\``));
});

test('C48: o relatório identifica a amostra de 12 casos sem alegar acurácia geral; uso indisponível não é custo zero e não há conversão monetária sem tarifa', async () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c48-fixture');
  await liveCollection(sandbox, 'c48-live');
  for (const runId of ['c48-fixture', 'c48-live']) {
    const { markdown } = report(sandbox, runId);
    const limitations = section(markdown, 'Limitações');
    assert.match(limitations, /^- Amostra de 12 casos relacionais: não estabelece acurácia geral nem calibração de confiança\./m, runId);
    assert.match(limitations, /^- Uso indisponível não é custo zero\. Sem tarifa identificada nas evidências, nenhum uso é convertido em dinheiro/m, runId);
    const prose = withoutFences(markdown);
    assert.equal(prose.match(/acurácia/g).length, 1, `${runId}: nenhuma outra alegação de acurácia`);
    assert.doesNotMatch(prose, /R\$|US\$|USD|BRL|€|custo: 0|economia de/, `${runId}: sem conversão monetária`);
  }
  const fixtureJev = section(report(sandbox, 'c48-fixture').markdown, 'Comparação Jev');
  assert.equal(fixtureJev.match(/uso: indisponível — ausência de uso informado não é custo zero/g).length, 24);
  const liveJev = section(report(sandbox, 'c48-live').markdown, 'Comparação Jev');
  assert.equal(liveJev.match(/uso informado: \{"input_tokens":400,"output_tokens":12\}/g).length, 24);
  // Tradução sem uso informado também não vira custo zero.
  const fixtureTranslations = section(report(sandbox, 'c48-fixture').markdown, 'Originais e traduções');
  assert.equal(fixtureTranslations.match(/tokens: indisponível — [^;]+; ausência de uso informado não é custo zero/g).length, 18);
  // Distribuições e confianças descritas são as gravadas, por julgamento.
  assert.match(liveJev, /Distribuições e confianças são descritivas, não limiares de produção\./);
  assert.equal(liveJev.match(/^ {2}- `\w+`: escolha (yes|no|insufficient); distribuição yes [\d.]+ \/ no [\d.]+ \/ insufficient [\d.]+; confiança 0\.7$/gm).length, 24 * 6);
});

test('C49: todo relatório fixture identifica os resultados como simulados, sem apresentá-los como validação real, VRAM ou ganho de tradução', async () => {
  const sandbox = makeSandbox();
  const run = fixtureRun(sandbox, 'c49');
  // Mesmo com todas as traduções revisadas, a simulação não conclui.
  writeReview(sandbox, 'c49', { translations: reviewAll(run) });
  const fixture = report(sandbox, 'c49');
  const banner = '> **Resultados simulados (fixture).** Não são validação real do candidato, medição de VRAM nem ganho de tradução.';
  assert.ok(header(fixture.markdown).includes(banner));
  assert.match(fixture.stdout, /^Relatório gerado de evidências simuladas \(fixture\): não comprova tradução real, avaliação Jev, VRAM ou ganho de tradução\.$/m);
  assert.match(section(fixture.markdown, 'Limitações'), /^- Resultados simulados \(fixture\): não são validação real do candidato, medição de VRAM nem ganho de tradução\./m);
  assert.match(fixture.markdown, /^- Modo e proveniência: `fixture` \/ `fixture` \(simulado\)$/m);
  const completeness = section(fixture.markdown, 'Completude');
  assert.match(completeness, /^- Integração local real dos casos T \(EN→PT\): sem prova — evidência fixture/m);
  assert.match(completeness, /^- Integração real tradução PT→EN e Jev pareado: sem prova — evidência fixture/m);
  assert.match(header(fixture.markdown), /^- Conclusão: `inconclusive`$/m);
  assert.match(completeness, /^ {2}- `simulated`: resultados simulados \(fixture\) não decidem sobre o candidato$/m);
  assert.doesNotMatch(fixture.markdown, /comprovada|VRAM medida|ganho de tradução de/);

  await liveCollection(sandbox, 'c49-live');
  const live = report(sandbox, 'c49-live');
  assert.ok(!live.markdown.includes('Resultados simulados'), 'live sem marca de simulação');
});

test('verificadores de C50 e C51: evidência live com o template oficial adotado passa; fixture, template não adotado, quantização e coleta parcial não passam', async () => {
  const sandbox = makeSandbox();
  await liveCollection(sandbox, 'v-live');
  const live = loadRun(sandbox.evidenceDir, 'v-live');
  // Template confirmado só no teste: com o versionado da bancada, ainda não oficial, nada fecha C50/C51.
  const adopted = { officialTemplate: confirmedTemplate };
  assert.deepEqual(proveLiveTranslation(live, adopted), { proven: true, problems: [] });
  assert.deepEqual(proveLiveRelational(live, adopted).cases, corpus.relational_cases.map((c) => c.id));
  assert.deepEqual(proveLiveTranslation(live).problems, ['template gravado não é o template oficial adotado na bancada']);
  assert.deepEqual(proveLiveRelational(live), { proven: false, cases: [], problems: ['template gravado não é o template oficial adotado na bancada'] });

  fixtureRun(sandbox, 'v-fixture');
  const fixture = loadRun(sandbox.evidenceDir, 'v-fixture');
  assert.deepEqual(proveLiveTranslation(fixture).problems, ['evidência fixture: simulação não comprova a integração local']);
  assert.equal(proveLiveRelational(fixture).proven, false);

  variant(sandbox, 'v-live', 'v-template', ({ edit }) => edit('manifest.json', (m) => ({ ...m, translation: { ...m.translation, template: { ...m.translation.template, official: false } } })));
  variant(sandbox, 'v-live', 'v-q4', ({ edit }) => edit('manifest.json', (m) => ({ ...m, translation: { ...m.translation, quantization: 'Q4_K_M' } })));
  variant(sandbox, 'v-live', 'v-tokens', ({ edit }) =>
    edit('results/037-T01-translate-en-pt.json', (r) => ({ ...r, translation: { ...r.translation, input_tokens: { count: 100, tokenizer: 'outro' } } })),
  );
  for (const [runId, pattern] of [
    ['v-template', /template oficial não confirmado/],
    ['v-q4', /quantização Q4_K_M, não Q6_K/],
    ['v-tokens', /T01: contagem pelo tokenizer outro, não translategemma-12b-it@q6_k/],
  ]) {
    const proof = proveLiveTranslation(loadRun(sandbox.evidenceDir, runId), adopted);
    assert.equal(proof.proven, false, runId);
    assert.match(proof.problems.join('\n'), pattern, runId);
  }

  // Coleta que parou no braço inglês de R01: nenhuma tradução T e nenhum par válido.
  await liveCollection(sandbox, 'v-parcial', { fetch: services({ fail: 'R01-evaluate-en' }) });
  const partial = loadRun(sandbox.evidenceDir, 'v-parcial');
  assert.match(proveLiveTranslation(partial, adopted).problems.join('\n'), /T01: tradução EN→PT ausente/);
  assert.deepEqual(proveLiveRelational(partial, adopted), { proven: false, cases: [], problems: ['R01: braço en ausente'] });
  // Discordância com o gabarito não afeta a prova de integração.
  await liveCollection(sandbox, 'v-discorda', { fetch: services({ choose: (_i, _j, expected) => otherChoice(expected) }) });
  assert.equal(proveLiveRelational(loadRun(sandbox.evidenceDir, 'v-discorda'), adopted).proven, true);
});

test('C54: make ai-study-report invoca zero processos Codex, Claude, Grok, agy ou Cloak', async () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c54-fixture');
  await liveCollection(sandbox, 'c54-live');
  for (const runId of ['c54-fixture', 'c54-live', 'c54-inexistente']) {
    const result = report(sandbox, runId, { expect: runId === 'c54-inexistente' ? 2 : 0 });
    assert.equal(result.shimCalls, '', `${runId}: nenhuma CLI excluída`);
    assert.ok(result.guard.loaded > 0, runId);
    assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], `${runId}: nenhum processo`);
  }
});

test('C56: o relatório sobre evidências com segredos sentinela, inclusive de erros HTTP e de parsing, sai sem nenhum segredo', () => {
  const sandbox = makeSandbox();
  const secrets = { key: 'sentinela-chave-jev-c56', token: 'sentinela-token-local-c56', user: 'sentinela-usuario-c56', password: 'sentinela-senha-c56', query: 'sentinela-query-c56' };
  const vars = { MODE: 'live', ...validLive, LOCAL_BASE_URL: `http://${secrets.user}:${secrets.password}@127.0.0.1:1234/v1?token=${secrets.query}` };
  const env = { TYPESAFE_API_KEY: secrets.key, LOCAL_API_TOKEN: secrets.token, AI_STUDY_TEST_ECHO: '1' };
  const runs = { 'c56-concluida': null, 'c56-jev-http': 'jev:1:http', 'c56-jev-parsing': 'jev:1:invalid', 'c56-local-http': 'local:1:http', 'c56-local-parsing': 'local:1:invalid' };
  for (const [runId, fail] of Object.entries(runs)) {
    const run = runMake(sandbox, 'ai-study-run', { vars: { ...vars, RUN_ID: runId }, env: { ...env, ...(fail ? { AI_STUDY_TEST_FAIL: fail } : {}) }, preload: [liveServices] });
    assert.equal(run.nodeStatus, fail ? 1 : 0, `${runId}: ${run.output}`);
  }
  // Segredos que não vieram da coleta: numa revisão humana e numa evidência editada à mão.
  variant(sandbox, 'c56-concluida', 'c56-editada', ({ edit }) =>
    edit('results/001-R01-translate-pt-en.json', (r) => ({ ...r, translation: { ...r.translation, derived_text: `Bearer ${secrets.key}` } })),
  );
  writeReview(sandbox, 'c56-concluida', { translations: [], recommendation: { decision: 'expand_study', reviewer: 'Revisora', justification: `copiou ${secrets.key} e ${secrets.token}` } });
  writeReview(sandbox, 'c56-jev-http', { run_id: secrets.key, translations: [] });

  const outputs = [];
  for (const runId of [...Object.keys(runs), 'c56-editada']) {
    const result = report(sandbox, runId, { env, expect: runId === 'c56-jev-http' ? 2 : 0 });
    outputs.push([`${runId} stdout`, result.stdout], [`${runId} stderr`, result.stderr]);
    if (result.markdown) outputs.push([`${runId} relatório`, result.markdown]);
  }
  assert.match(outputs.find(([where]) => where === 'c56-jev-http stderr')[1], /pertence à execução \[omitido\]/);
  assert.match(outputs.find(([where]) => where === 'c56-editada relatório')[1], /Bearer \[omitido\]/);
  assert.match(outputs.find(([where]) => where === 'c56-concluida relatório')[1], /copiou \[omitido\] e \[omitido\]/);
  for (const [where, text] of outputs) {
    for (const [name, secret] of Object.entries(secrets)) assert.ok(!text.includes(secret), `${name} em ${where}`);
  }
});

test('C57: make ai-study-report preserva byte a byte, sem limpeza, as evidências da execução relatada e das outras', () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c57');
  const incomplete = runMake(sandbox, 'ai-study-run', {
    vars: { MODE: 'live', RUN_ID: 'c57-incompleta', ...validLive },
    env: { TYPESAFE_API_KEY: KEY, AI_STUDY_TEST_FAIL: 'jev:2:http' },
    preload: [liveServices],
  });
  assert.equal(incomplete.nodeStatus, 1, incomplete.output);
  // Arquivos alheios à bancada: anotação humana, temporário de uma queda e a revisão.
  writeFileSync(join(sandbox.evidenceDir, 'c57', 'notas.md'), 'anotação humana');
  writeFileSync(join(sandbox.evidenceDir, 'c57-incompleta', 'manifest.json.123.abc.tmp'), '{"parcial"');
  writeReview(sandbox, 'c57', { translations: [] });
  const before = snapshotFiles(sandbox.evidenceDir);

  const first = report(sandbox, 'c57').markdown;
  assert.match(section(report(sandbox, 'c57-incompleta').markdown, 'Completude'), /`manifest\.json\.123\.abc\.tmp` — arquivo temporário \(`temporary`\)/);
  assert.equal(report(sandbox, 'c57').markdown, first, 'mesmas evidências, mesmo relatório');
  assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before);
  assert.deepEqual(listRuns(sandbox).sort(), ['c57', 'c57-incompleta']);
});

test('C58: make ai-study-report recusa com código 2 evidências de outra execução, de outra revisão de corpus ou gabarito, ou com schema_version diferente de 1', () => {
  const sandbox = makeSandbox();
  fixtureRun(sandbox, 'c58');
  fixtureRun(sandbox, 'c58-outra');
  const otherRun = readFileSync(join(sandbox.evidenceDir, 'c58-outra/results/003-R01-evaluate-en.json'), 'utf8');
  const altered = loadCorpus(writeCorpusVariant(sandbox, 'revisao-2', (c) => (c.revision = 2)));
  for (const [runId, mutate, pattern] of [
    ['c58-manifesto-outra', ({ edit }) => edit('manifest.json', (m) => ({ ...m, run_id: 'c58' })), /manifest\.json: pertence à execução c58$/m],
    ['c58-resultado-outra', ({ dir }) => writeFileSync(join(dir, 'results/003-R01-evaluate-en.json'), otherRun), /003-R01-evaluate-en\.json: pertence à execução c58-outra/],
    ['c58-comparacao-outra', ({ edit }) => edit('comparison.json', (c) => ({ ...c, run_id: 'c58-outra' })), /comparison\.json: pertence à execução c58-outra/],
    ['c58-corpus', ({ edit }) => edit('results/001-R01-translate-pt-en.json', (r) => ({ ...r, corpus_hash: altered.corpusHash })), /001-R01-translate-pt-en\.json: revisão de corpus ou gabarito diferente/],
    ['c58-gabarito', ({ edit }) => edit('comparison.json', (c) => ({ ...c, gabarito_hash: altered.gabaritoHash })), /comparison\.json: revisão de corpus ou gabarito diferente/],
    ['c58-schema-manifesto', ({ edit }) => edit('manifest.json', (m) => ({ ...m, schema_version: 2 })), /manifest\.json: schema_version 2 não é 1/],
    ['c58-schema-resultado', ({ edit }) => edit('results/002-R01-evaluate-pt.json', (r) => ({ ...r, schema_version: 2 })), /002-R01-evaluate-pt\.json: schema_version 2 não é 1/],
    ['c58-schema-comparacao', ({ edit }) => edit('comparison.json', (c) => ({ ...c, schema_version: '1' })), /comparison\.json: schema_version "1" não é 1/],
    ['c58-revisao-outra', ({ dir }) => writeFileSync(join(dir, 'review.json'), JSON.stringify({ schema_version: 1, run_id: 'c58', translations: [] })), /review\.json de c58-revisao-outra recusado:\n {2}- pertence à execução c58$/m],
    ['c58-sem-contagens', ({ edit }) => edit('comparison.json', ({ counts, ...c }) => c), /comparison\.json: contagens ausentes ou malformadas/],
    ['c58-par-sem-braco', ({ edit }) => edit('comparison.json', (c) => ({ ...c, evaluations: c.evaluations.filter((e) => e.item !== 'R01-evaluate-en') })), /comparison\.json: par completo R01 sem os dois braços avaliados/],
    ['c58-avaliacao-alheia', ({ edit }) => edit('comparison.json', (c) => ({ ...c, evaluations: [...c.evaluations, { ...c.evaluations[0], item: 'R99-evaluate-pt' }] })), /comparison\.json: avaliação R99-evaluate-pt não corresponde a um resultado desta execução/],
    ['c58-schema-revisao', ({ dir }) => writeFileSync(join(dir, 'review.json'), JSON.stringify({ schema_version: 2, run_id: 'c58-schema-revisao', translations: [] })), /review\.json de c58-schema-revisao recusado:\n {2}- schema_version 2 não é 1/],
  ]) {
    variant(sandbox, 'c58', runId, mutate);
    const refused = report(sandbox, runId, { expect: 2 });
    assert.match(refused.stderr, pattern, runId);
    assert.ok(!existsSync(reportPath(sandbox, runId)), `${runId}: nenhum relatório`);
  }
  // A cópia íntegra é aceita: a recusa vem só do vínculo estragado.
  report(sandbox, variant(sandbox, 'c58', 'c58-copia'));
  assert.equal(readJson(join(sandbox.evidenceDir, 'c58', 'manifest.json')).run_id, 'c58');
});
