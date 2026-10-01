import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { fileHash, JUDGMENT_IDS } from './corpus.mjs';
import { IncompleteError, UsageError } from './errors.mjs';
import { createRunDir, SCHEMA_VERSION, writeJsonAtomic } from './evidence.mjs';
import { publicConfig } from './manifest.mjs';

// Ordem da coleta: cada caso R traduz PT→EN e avalia os braços alternando a ordem; depois T01–T06 EN→PT.
export function planItems(corpus) {
  const items = [];
  corpus.relational_cases.forEach((c, index) => {
    items.push({ id: `${c.id}-translate-pt-en`, kind: 'translation', case_id: c.id, direction: 'pt->en', service: 'local' });
    for (const arm of index % 2 === 0 ? ['pt', 'en'] : ['en', 'pt']) {
      items.push({ id: `${c.id}-evaluate-${arm}`, kind: 'evaluation', case_id: c.id, arm, service: 'jev' });
    }
  });
  for (const c of corpus.translation_cases) {
    items.push({ id: `${c.id}-translate-en-pt`, kind: 'translation', case_id: c.id, direction: 'en->pt', service: 'local' });
  }
  return items;
}

// Somente contexto, perguntas, respostas e mudança proposta; gabarito e títulos ficam fora.
export function caseText(c) {
  return [
    `Contexto: ${c.context}`,
    `A — Pergunta: ${c.a.question} Resposta: ${c.a.answer}`,
    `B — Pergunta: ${c.b.question} Resposta: ${c.b.answer}`,
    `Mudança proposta em A: ${c.proposed_change_a}`,
  ].join('\n');
}

function generateRunId(now) {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
}

export async function runCollection({ config, corpusInfo, transports, evidenceDir, now = () => new Date() }) {
  const runId = config.runId ?? generateRunId(now());
  const runDir = join(evidenceDir, runId);
  const items = planItems(corpusInfo.corpus);
  const cases = new Map(
    [...corpusInfo.corpus.relational_cases, ...corpusInfo.corpus.translation_cases].map((c) => [c.id, c]),
  );
  const translations = new Map();

  createRunDir(evidenceDir, runDir, runId);
  const manifest = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    mode: config.mode,
    provenance: config.mode,
    status: 'running',
    reason: null,
    started_at: now().toISOString(),
    finished_at: null,
    corpus: {
      path: config.corpusDisplay,
      revision: corpusInfo.revision,
      corpus_hash: corpusInfo.corpusHash,
      gabarito_hash: corpusInfo.gabaritoHash,
    },
    config: { ...publicConfig(config), run_id: runId },
    limits: { local_calls: config.limits.localCalls, jev_calls: config.limits.jevCalls },
    planned_items: items.map((i) => i.id),
    completed_items: [],
    not_executed_items: items.map((i) => i.id),
  };
  const manifestPath = join(runDir, 'manifest.json');
  const save = () => {
    const completed = new Set(manifest.completed_items);
    manifest.not_executed_items = manifest.planned_items.filter((id) => !completed.has(id));
    writeJsonAtomic(manifestPath, manifest);
  };
  const finish = (status, reason) => {
    manifest.status = status;
    manifest.reason = reason;
    manifest.finished_at = now().toISOString();
    save();
  };
  const ensureCorpusUnchanged = () => {
    if (fileHash(corpusInfo.path) === corpusInfo.fileHash) return;
    finish('rejected', 'corpus_changed');
    throw new UsageError('CORPUS alterado durante a coleta; resultados de revisões diferentes não são comparáveis');
  };
  const rejectMixedProvenance = (provenance, item) => {
    if (provenance === config.mode) return;
    finish('rejected', 'provenance_mismatch');
    throw new UsageError(
      `proveniência ${JSON.stringify(provenance ?? null)} incompatível com MODE=${config.mode} em ${item.id}; ` +
        'respostas simuladas e reais não se misturam numa execução',
    );
  };
  save();

  try {
    for (const [index, item] of items.entries()) {
      ensureCorpusUnchanged();
      const payload = buildPayload(item, cases.get(item.case_id), translations);
      const transport = item.kind === 'translation' ? transports.local : transports.jev;
      // A proveniência vem do transporte construído para o modo; a resposta só pode confirmá-la.
      rejectMixedProvenance(transport.provenance, item);
      let response;
      try {
        response =
          item.kind === 'translation'
            ? await transport.translate({ item, ...payload })
            : await transport.evaluate({ item, ...payload });
      } catch (error) {
        finish('incomplete', 'transport_error');
        throw new IncompleteError(`falha em ${item.id}: ${error.message}; coleta incompleta, prefixo preservado`);
      }
      rejectMixedProvenance(response?.provenance, item);
      ensureCorpusUnchanged();
      if (item.kind === 'translation') translations.set(item.case_id, response.output);
      writeJsonAtomic(join(runDir, 'results', `${String(index + 1).padStart(3, '0')}-${item.id}.json`), {
        schema_version: SCHEMA_VERSION,
        run_id: runId,
        mode: config.mode,
        provenance: transport.provenance,
        corpus_hash: corpusInfo.corpusHash,
        gabarito_hash: corpusInfo.gabaritoHash,
        sequence: index + 1,
        item,
        request: payload,
        response,
      });
      manifest.completed_items.push(item.id);
      save();
    }
  } catch (error) {
    // Erro inesperado (disco, permissão): o manifesto não fica preso em `running`.
    if (manifest.status === 'running') finish('incomplete', 'internal_error');
    throw error;
  }

  finish('completed', null);
  return { runId, runDir, manifest };
}

// Conteúdo enviado ao serviço; o item identifica a chamada e não entra no texto.
function buildPayload(item, source, translations) {
  if (item.kind === 'translation') {
    return { direction: item.direction, text: item.direction === 'pt->en' ? caseText(source) : source.original };
  }
  const text = item.arm === 'pt' ? caseText(source) : translations.get(item.case_id);
  return { arm: item.arm, text, judgments: [...JUDGMENT_IDS] };
}
