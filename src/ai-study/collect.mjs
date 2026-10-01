import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { fileHash, JUDGMENT_IDS } from './corpus.mjs';
import { IncompleteError, UsageError } from './errors.mjs';
import { createRunDir, SCHEMA_VERSION, writeJsonAtomic } from './evidence.mjs';
import { publicConfig } from './manifest.mjs';
import { renderPrompt, templateRevision, TRANSLATION_TEMPLATE } from './template.mjs';
import { checkIdentity, checkInputTokens, invalidTranslationReason, runtimeInfo } from './translation.mjs';

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

export async function runCollection({
  config,
  corpusInfo,
  transports,
  evidenceDir,
  translationTemplate = TRANSLATION_TEMPLATE,
  now = () => new Date(),
}) {
  const runId = config.runId ?? generateRunId(now());
  const runDir = join(evidenceDir, runId);
  const items = planItems(corpusInfo.corpus);
  const cases = new Map(
    [...corpusInfo.corpus.relational_cases, ...corpusInfo.corpus.translation_cases].map((c) => [c.id, c]),
  );
  const translations = new Map();
  const invalidTranslations = new Set();
  const template = {
    id: translationTemplate.id,
    revision: templateRevision(translationTemplate),
    official: translationTemplate.official,
    justification: translationTemplate.justification,
  };

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
    skipped_items: [],
    blocked: null,
    translation: {
      requested_model: config.local.model,
      returned_model: null,
      quantization: null,
      model_state: null,
      template,
    },
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
  const stop = (reason, message, blocked = null) => {
    manifest.blocked = blocked;
    finish('incomplete', reason);
    throw new IncompleteError(`${message}; coleta incompleta, prefixo preservado`);
  };
  const call = async (label, operation) => {
    try {
      return await operation();
    } catch (error) {
      finish('incomplete', 'transport_error');
      throw new IncompleteError(`falha em ${label}: ${error.message}; coleta incompleta, prefixo preservado`);
    }
  };
  // Live: template oficial e identidade do candidato confirmados antes de qualquer tradução do corpus.
  // Fixture não tem runtime nem tokenizer do candidato: não há o que confirmar ou contar.
  const prepareTranslation = async () => {
    if (config.mode !== 'live') return null;
    if (!translationTemplate.official) {
      stop('template_unverified', `template oficial não confirmado (${template.justification}); nenhuma tradução enviada`);
    }
    rejectMixedProvenance(transports.local.provenance, { id: 'model-check' });
    const inspection = await call('model-check', () => transports.local.inspect({ model: config.local.model }));
    rejectMixedProvenance(inspection?.provenance, { id: 'model-check' });
    const model = inspection.model ?? null;
    Object.assign(manifest.translation, {
      returned_model: model?.id ?? null,
      quantization: model?.quantization ?? null,
      model_state: model?.state ?? null,
    });
    const problem = checkIdentity(model, config.local.model);
    if (problem) stop(problem.reason, `candidato não confirmado: ${problem.justification}; nenhum outro modelo foi selecionado`);
    save();
    return model.id;
  };
  save();

  try {
    const candidateModel = await prepareTranslation();
    for (const [index, item] of items.entries()) {
      ensureCorpusUnchanged();
      if (item.kind === 'evaluation' && item.arm === 'en' && invalidTranslations.has(item.case_id)) {
        manifest.skipped_items.push({ item: item.id, reason: 'invalid_translation' });
        save();
        continue;
      }
      const payload = buildPayload(item, cases.get(item.case_id), translations);
      const transport = item.kind === 'translation' ? transports.local : transports.jev;
      // A proveniência vem do transporte construído para o modo; a resposta só pode confirmá-la.
      rejectMixedProvenance(transport.provenance, item);
      let prepared = null;
      if (item.kind === 'translation') {
        prepared = {
          id: item.id,
          run_id: runId,
          case_id: item.case_id,
          direction: item.direction,
          original: payload.text,
          requested_model: config.local.model,
          template_id: template.id,
          template_revision: template.revision,
        };
        payload.prompt = renderPrompt(translationTemplate, item.direction, payload.text);
        let inputTokens = null;
        if (candidateModel) {
          const count = await call(item.id, () =>
            transport.countTokens({ item, model: config.local.model, prompt: payload.prompt }),
          );
          const blocked = checkInputTokens(count, candidateModel);
          if (blocked) {
            const { id, run_id: _, ...traceable } = prepared;
            stop(blocked.reason, `${id} não enviado: ${blocked.justification}`, { item: id, ...traceable, ...blocked });
          }
          inputTokens = { count: count.count, tokenizer: count.tokenizer };
        }
        prepared.input_tokens = inputTokens;
      }
      const started = performance.now();
      const response = await call(item.id, () =>
        item.kind === 'translation' ? transport.translate({ item, ...payload }) : transport.evaluate({ item, ...payload }),
      );
      const durationMs = Math.round(performance.now() - started);
      rejectMixedProvenance(response?.provenance, item);
      ensureCorpusUnchanged();
      const record = {
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
      };
      if (item.kind === 'translation') {
        // Derivação literal ao lado do original; o original nunca é substituído.
        const invalidReason = invalidTranslationReason(response);
        record.translation = {
          ...prepared,
          derived_text: response.output,
          status: invalidReason ? 'invalid_translation' : 'valid',
          invalid_reason: invalidReason,
          duration_ms: durationMs,
          runtime: runtimeInfo(response),
        };
        if (invalidReason) invalidTranslations.add(item.case_id);
        else translations.set(item.case_id, response.output);
      } else if (item.arm === 'en') {
        record.derived_from = `${item.case_id}-translate-pt-en`;
      }
      writeJsonAtomic(join(runDir, 'results', `${String(index + 1).padStart(3, '0')}-${item.id}.json`), record);
      manifest.completed_items.push(item.id);
      save();
    }
  } catch (error) {
    // Erro inesperado (disco, permissão): o manifesto não fica preso em `running`.
    if (manifest.status === 'running') finish('incomplete', 'internal_error');
    throw error;
  }

  if (invalidTranslations.size > 0) {
    finish('incomplete', 'invalid_translation');
    throw new IncompleteError(
      `tradução inválida em ${[...invalidTranslations].join(', ')}; braços ingleses correspondentes não avaliados`,
    );
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
