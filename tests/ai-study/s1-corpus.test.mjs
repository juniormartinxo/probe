import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { runCollection } from '../../src/ai-study/collect.mjs';
import { resolveConfig } from '../../src/ai-study/config.mjs';
import { assertSameReference, JUDGMENT_IDS, loadCorpus } from '../../src/ai-study/corpus.mjs';
import { UsageError } from '../../src/ai-study/errors.mjs';
import { createFixtureTransports } from '../../src/ai-study/fixture.mjs';
import {
  defaultCorpusPath,
  loadDefaultCorpus,
  makeSandbox,
  readRun,
  repoRoot,
  runMake,
  writeCorpusVariant,
} from './helpers.mjs';

const R_IDS = Array.from({ length: 12 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);
const T_IDS = Array.from({ length: 6 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);

// Dry-run e coleta usam o mesmo carregamento do corpus; as duas fronteiras recusam antes de coletar.
function expectInvalidCorpus(sandbox, name, mutate, pattern) {
  const path = writeCorpusVariant(sandbox, name, mutate);
  for (const target of ['ai-study-dry-run', 'ai-study-run']) {
    const label = `${name} (${target})`;
    const run = runMake(sandbox, target, { vars: { CORPUS: path, RUN_ID: name } });
    assert.equal(run.status, 2, `${label}: ${run.output}`);
    assert.equal(run.nodeStatus, 2, `${label}: código do Node`);
    assert.match(run.stderr, /CORPUS/, `${label}: diagnóstico nomeia CORPUS`);
    assert.match(run.stderr, pattern, `${label}: diagnóstico específico`);
    assert.doesNotMatch(run.stdout, /hash do corpus/, `${label}: sem manifesto`);
    assert.ok(!existsSync(join(sandbox.evidenceDir, name)), `${label}: nenhuma execução criada`);
  }
}

test('corpus estruturado preserva os textos e gabaritos de corpus.md revisão 1', () => {
  const md = readFileSync(join(repoRoot, '.specs/features/jev-translation-feasibility/corpus.md'), 'utf8');
  const corpus = loadDefaultCorpus();
  assert.equal(corpus.revision, 1);
  // Hashes da revisão 1: qualquer mudança de texto, gabarito ou canonicalização exige nova revisão.
  const info = loadCorpus(defaultCorpusPath);
  assert.equal(info.corpusHash, 'sha256:d9c2884c1d23e58ab35020b65e1d7d25422ae74a879cc0f7824a028887b1e5c0');
  assert.equal(info.gabaritoHash, 'sha256:729e6e209c3e2e5f7a014b772ed52b3f26e2b783b7848835626f70f00be2c297');
  for (const j of corpus.judgments) assert.ok(md.includes(`| \`${j.id}\` | ${j.question} | ${j.scope} |`), j.id);
  for (const r of corpus.relational_cases) {
    for (const line of [
      `### ${r.id} — ${r.title}`,
      `- Contexto: ${r.context}`,
      `- A — Pergunta: ${r.a.question} Resposta: ${r.a.answer}`,
      `- B — Pergunta: ${r.b.question} Resposta: ${r.b.answer}`,
      `- Mudança proposta em A: ${r.proposed_change_a}`,
      ...r.expectations.map((e) => `| \`${e.judgment}\` | ${e.expected} | ${e.justification} |`),
    ]) {
      assert.ok(md.includes(line), `${r.id}: ${line}`);
    }
  }
  for (const t of corpus.translation_cases) {
    assert.ok(md.includes(`### ${t.id} — ${t.title}`), t.id);
    assert.ok(md.includes(`Original: “${t.original}”`), `${t.id} original`);
    assert.ok(md.includes(`Invariantes: ${t.invariants}`), `${t.id} invariantes`);
  }
});

test('C6: corpus apresenta exatamente R01–R12 e T01–T06 em ordem e rejeita IDs ausentes, extras ou repetidos', () => {
  const info = loadCorpus(defaultCorpusPath);
  assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS);
  assert.deepEqual(info.corpus.translation_cases.map((t) => t.id), T_IDS);

  const sandbox = makeSandbox();
  const cases = [
    ['r-ausente', (c) => c.relational_cases.splice(4, 1), /R05/],
    ['r-extra', (c) => c.relational_cases.push({ ...c.relational_cases[0], id: 'R13' }), /R13/],
    ['r-repetido', (c) => (c.relational_cases[3] = { ...c.relational_cases[2] }), /R03/],
    ['r-fora-de-ordem', (c) => c.relational_cases.reverse(), /ordem/],
    ['t-ausente', (c) => c.translation_cases.pop(), /T06/],
    ['t-extra', (c) => c.translation_cases.push({ ...c.translation_cases[0], id: 'T07' }), /T07/],
    ['t-repetido', (c) => (c.translation_cases[1] = { ...c.translation_cases[0] }), /T01/],
    ['t-fora-de-ordem', (c) => c.translation_cases.reverse(), /ordem/],
  ];
  for (const [name, mutate, pattern] of cases) expectInvalidCorpus(sandbox, name, mutate, pattern);
});

test('C7: cada caso R tem os seis julgamentos com rótulo válido e justificativa; violações invalidam o corpus com código 2', () => {
  const { corpus } = loadCorpus(defaultCorpusPath);
  for (const r of corpus.relational_cases) {
    assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id);
    for (const e of r.expectations) {
      assert.ok(['yes', 'no', 'insufficient'].includes(e.expected), `${r.id}/${e.judgment}`);
      assert.ok(e.justification.trim().length > 0, `${r.id}/${e.judgment}`);
    }
  }

  const sandbox = makeSandbox();
  const cases = [
    ['julgamento-ausente', (c) => c.relational_cases[0].expectations.pop(), /answers_conflict/],
    [
      'julgamento-extra',
      (c) => c.relational_cases[1].expectations.push({ judgment: 'same_topic', expected: 'no', justification: 'x' }),
      /same_topic/,
    ],
    [
      'julgamento-duplicado',
      (c) => (c.relational_cases[2].expectations[1] = { ...c.relational_cases[2].expectations[0] }),
      /b_depends_on_a/,
    ],
    ['rotulo-invalido', (c) => (c.relational_cases[3].expectations[0].expected = 'maybe'), /R04/],
    ['justificativa-vazia', (c) => (c.relational_cases[4].expectations[2].justification = '   '), /R05/],
    ['justificativa-ausente', (c) => delete c.relational_cases[5].expectations[0].justification, /justification/],
    ['campo-extra', (c) => (c.relational_cases[6].expectations[0].weight = 1), /weight/],
    ['expectativas-nao-lista', (c) => (c.relational_cases[7].expectations = {}), /R08/],
  ];
  for (const [name, mutate, pattern] of cases) expectInvalidCorpus(sandbox, name, mutate, pattern);
});

test('C8: resultados de uma execução ficam vinculados aos mesmos hashes e alteração do corpus durante a coleta impede a comparação', async () => {
  // Hashes separados: alterar o gabarito não muda o hash do corpus, e vice-versa.
  const sandbox = makeSandbox();
  const base = loadCorpus(defaultCorpusPath);
  const gabaritoChanged = loadCorpus(
    writeCorpusVariant(sandbox, 'gabarito', (c) => (c.relational_cases[0].expectations[5].expected = 'yes')),
  );
  assert.equal(gabaritoChanged.corpusHash, base.corpusHash);
  assert.notEqual(gabaritoChanged.gabaritoHash, base.gabaritoHash);
  const textChanged = loadCorpus(writeCorpusVariant(sandbox, 'texto', (c) => (c.relational_cases[0].a.answer = 'R$ 9.000.')));
  assert.notEqual(textChanged.corpusHash, base.corpusHash);
  assert.equal(textChanged.gabaritoHash, base.gabaritoHash);

  // Coleta fixture completa: todos os resultados carregam os hashes do manifesto.
  const run = runMake(sandbox, 'ai-study-run', { vars: { RUN_ID: 'c8-complete' } });
  assert.equal(run.status, 0, run.output);
  const complete = readRun(sandbox, 'c8-complete');
  assert.equal(complete.manifest.corpus.corpus_hash, base.corpusHash);
  assert.equal(complete.manifest.corpus.gabarito_hash, base.gabaritoHash);
  for (const result of complete.results) {
    assert.equal(result.corpus_hash, base.corpusHash);
    assert.equal(result.gabarito_hash, base.gabaritoHash);
  }
  assert.doesNotThrow(() => assertSameReference(complete.results));
  const mixed = [...complete.results.slice(0, 2), { ...complete.results[2], gabarito_hash: gabaritoChanged.gabaritoHash }];
  assert.throws(() => assertSameReference(mixed), UsageError);

  // Corpus alterado no meio da coleta: a execução é rejeitada e o prefixo é preservado.
  const corpusPath = writeCorpusVariant(sandbox, 'mutavel', () => {});
  const config = resolveConfig('run', { CORPUS: corpusPath, RUN_ID: 'c8-changed' }, { repoRoot });
  const corpusInfo = loadCorpus(config.corpusPath);
  const fixture = createFixtureTransports();
  let calls = 0;
  const transports = {
    local: {
      provenance: 'fixture',
      async translate(request) {
        calls += 1;
        if (calls === 2) {
          const changed = JSON.parse(readFileSync(corpusPath, 'utf8'));
          changed.relational_cases[0].expectations[0].justification += ' (editado)';
          writeFileSync(corpusPath, JSON.stringify(changed));
        }
        return fixture.local.translate(request);
      },
    },
    jev: fixture.jev,
  };
  await assert.rejects(
    runCollection({ config, corpusInfo, transports, evidenceDir: sandbox.evidenceDir }),
    (error) => error instanceof UsageError && error.exitCode === 2 && /CORPUS/.test(error.message),
  );
  const changed = readRun(sandbox, 'c8-changed');
  assert.equal(changed.manifest.status, 'rejected');
  assert.equal(changed.manifest.reason, 'corpus_changed');
  assert.ok(changed.results.length >= 1);
  assert.ok(changed.manifest.not_executed_items.length > 0);
  for (const result of changed.results) assert.equal(result.gabarito_hash, corpusInfo.gabaritoHash);
});
