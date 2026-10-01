// Provas de C50 e C51: leem a coleta live real identificada por RUN_ID no repositório. Fora do glob da
// suíte padrão; `make check-proof` só inclui este arquivo com RUN_ID, e sem ele nenhuma prova é encontrada.
import assert from 'node:assert/strict';
import test from 'node:test';

import { evidenceDirFor } from '../../../src/ai-study/config.mjs';
import { proveLiveRelational, proveLiveTranslation } from '../../../src/ai-study/report.mjs';
import { loadRun } from '../../../src/ai-study/run-reader.mjs';
import { repoRoot } from '../helpers.mjs';

const loadLiveRun = () => {
  const runId = process.env.RUN_ID ?? '';
  assert.ok(runId, 'RUN_ID de uma coleta live real ausente: fixture não supre esta prova');
  return loadRun(evidenceDirFor(repoRoot), runId);
};

test('C50: evidência live de T01–T06 identifica servidor e modelo Q6_K, template confirmado, contagem correspondente, seis traduções EN→PT e durações reais', () => {
  const loaded = loadLiveRun();
  const proof = proveLiveTranslation(loaded);
  assert.deepEqual(proof.problems, []);
  assert.equal(proof.proven, true);
  const cases = loaded.manifest.planned_items.filter((id) => id.endsWith('-translate-en-pt'));
  assert.deepEqual(cases, ['T01', 'T02', 'T03', 'T04', 'T05', 'T06'].map((id) => `${id}-translate-en-pt`));
});

test('C51: evidência live de ao menos um caso R tem tradução PT→EN e duas respostas Jev da mesma versão com seis resultados válidos cada', () => {
  const loaded = loadLiveRun();
  const proof = proveLiveRelational(loaded);
  assert.equal(proof.proven, true, proof.problems.join('\n'));
  for (const caseId of proof.cases) {
    for (const arm of ['pt', 'en']) assert.equal(loaded.byItem.get(`${caseId}-evaluate-${arm}`).evaluation.results.length, 6, `${caseId} ${arm}`);
  }
});
