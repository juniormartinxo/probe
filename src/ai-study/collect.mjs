import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { requireBudget, ServiceCallError } from './calls.mjs';
import { buildComparison } from './comparison.mjs';
import { redactText, redactValue, secretValues } from './config.mjs';
import { fileHash, JUDGMENT_IDS } from './corpus.mjs';
import { IncompleteError, UsageError } from './errors.mjs';
import { acquireCollectionLock, createRunDir, SCHEMA_VERSION, writeJsonAtomic } from './evidence.mjs';
import { buildJevBody, evaluationRecord, JEV_RUBRIC, rubricRevision } from './jev.mjs';
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

// Uma coleta por diretório de evidências: a trava é tomada antes de qualquer arquivo ou chamada e
// liberada em qualquer término.
export async function runCollection(options) {
  requireBudget(options.transports.budget, 'runCollection');
  const release = acquireCollectionLock(options.evidenceDir);
  try {
    return await collect(options);
  } finally {
    release();
  }
}

async function collect({
  config,
  corpusInfo,
  transports,
  evidenceDir,
  translationTemplate = TRANSLATION_TEMPLATE,
  now = () => new Date(),
  signal = null,
}) {
  const runId = config.runId ?? generateRunId(now());
  const runDir = join(evidenceDir, runId);
  const items = planItems(corpusInfo.corpus);
  const cases = new Map(
    [...corpusInfo.corpus.relational_cases, ...corpusInfo.corpus.translation_cases].map((c) => [c.id, c]),
  );
  // Derivações válidas por caso: item de origem e texto literal enviado ao braço inglês.
  const translations = new Map();
  const invalidTranslations = new Set();
  const evaluations = [];
  const template = {
    id: translationTemplate.id,
    revision: templateRevision(translationTemplate),
    official: translationTemplate.official,
    justification: translationTemplate.justification,
  };

  // Segredos vão só em cabeçalhos; se um serviço os ecoar, a evidência gravada os omite.
  const secrets = secretValues(config);
  const writeEvidence = (path, value) => writeJsonAtomic(path, redactValue(value, secrets));
  const callsUsed = () => transports.budget.snapshot();

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
    // Chamadas tentadas por serviço, falhas inclusive.
    calls: callsUsed(),
    planned_items: items.map((i) => i.id),
    completed_items: [],
    not_executed_items: items.map((i) => i.id),
    skipped_items: [],
    blocked: null,
    // Chamada que encerrou a coleta, com o que se sabe do serviço. Só com envio confirmado
    // (`request_sent: true`) ela sai de `not_executed_items`; bloqueada ou sem envio confirmado, continua lá.
    failure: null,
    translation: {
      requested_model: config.local.model,
      returned_model: null,
      quantization: null,
      model_state: null,
      template,
    },
    evaluation: {
      requested_model: config.jev.model,
      rubric_id: JEV_RUBRIC.id,
      rubric_revision: rubricRevision(JEV_RUBRIC),
    },
  };
  const manifestPath = join(runDir, 'manifest.json');
  const save = () => {
    const attempted = manifest.failure?.request_sent === true ? manifest.failure.item : null;
    const finished = new Set([...manifest.completed_items, attempted]);
    manifest.not_executed_items = manifest.planned_items.filter((id) => !finished.has(id));
    manifest.calls = callsUsed();
    writeEvidence(manifestPath, manifest);
  };
  // A comparação acompanha qualquer término: resultados individuais concluídos continuam visíveis.
  // Se ela não puder ser gravada, o manifesto nunca fica `running` nem `completed`: uma coleta que
  // terminaria concluída vira `incomplete` com `internal_error`; um término já incompleto ou rejeitado
  // conserva seu motivo original e registra o erro da comparação.
  const finish = (status, reason) => {
    manifest.finished_at = now().toISOString();
    const reference = { corpus_hash: corpusInfo.corpusHash, gabarito_hash: corpusInfo.gabaritoHash };
    try {
      writeEvidence(
        join(runDir, 'comparison.json'),
        buildComparison({ runId, corpus: corpusInfo.corpus, reference, records: evaluations }),
      );
    } catch (error) {
      Object.assign(
        manifest,
        status === 'completed' ? { status: 'incomplete', reason: 'internal_error' } : { status, reason },
        { comparison_error: redactText(error.message, secrets) },
      );
      save();
      throw error;
    }
    Object.assign(manifest, { status, reason });
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
  // Falha de chamada encerra a coleta sem retry nem troca de provedor ou idioma (AC 28–29).
  const call = async (label, service, operation) => {
    try {
      return await operation();
    } catch (error) {
      const failure = ServiceCallError.from(error);
      const message = redactText(failure.message, secrets);
      manifest.failure = {
        item: label,
        service,
        reason: failure.reason,
        request_sent: failure.requestSent,
        remote_outcome: failure.remoteOutcome,
        message,
        ...failure.details,
      };
      finish('incomplete', manifest.failure.reason);
      throw new IncompleteError(`falha em ${label}: ${message}; coleta incompleta, prefixo preservado`);
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
    const started = performance.now();
    const inspection = await call('model-check', 'local', () => transports.local.inspect());
    const durationMs = Math.round(performance.now() - started);
    rejectMixedProvenance(inspection?.provenance, { id: 'model-check' });
    const model = inspection.model ?? null;
    Object.assign(manifest.translation, {
      returned_model: model?.id ?? null,
      quantization: model?.quantization ?? null,
      model_state: model?.state ?? null,
      model_check: { duration_ms: durationMs, model },
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
      if (signal?.aborted) stop('interrupted', `coleta interrompida antes de ${item.id}`);
      ensureCorpusUnchanged();
      if (item.kind === 'evaluation' && item.arm === 'en' && invalidTranslations.has(item.case_id)) {
        manifest.skipped_items.push({ item: item.id, reason: 'invalid_translation' });
        save();
        continue;
      }
      const payload = buildPayload(item, cases.get(item.case_id), translations, config.jev.model);
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
          const count = await call(item.id, 'local', () =>
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
      const response = await call(item.id, item.service, () =>
        item.kind === 'translation' ? transport.translate({ item, ...payload }) : transport.evaluate({ item, ...payload }),
      );
      const durationMs = Math.round(performance.now() - started);
      rejectMixedProvenance(response?.provenance, item);
      ensureCorpusUnchanged();
      // Cada resposta live precisa identificar o candidato; ausente ou outro modelo, a saída não é aceita.
      if (item.kind === 'translation' && candidateModel && response.model !== candidateModel) {
        const { id, run_id: _, ...traceable } = prepared;
        const returned = response.model ?? null;
        stop('model_mismatch', `${id}: resposta ${returned ? `gerada por ${returned}` : 'sem identificação do modelo'}, não ${candidateModel}`, {
          item: id,
          ...traceable,
          reason: 'model_mismatch',
          returned_model: returned,
          duration_ms: durationMs,
          runtime: runtimeInfo(response),
        });
      }
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
        else translations.set(item.case_id, { item: item.id, text: response.output });
      } else {
        if (item.arm === 'en') record.derived_from = translations.get(item.case_id).item;
        record.evaluation = evaluationRecord({
          runId,
          item,
          body: payload.body,
          response,
          judgments: payload.judgments,
          durationMs,
        });
        evaluations.push(record);
      }
      writeEvidence(join(runDir, 'results', `${String(index + 1).padStart(3, '0')}-${item.id}.json`), record);
      manifest.completed_items.push(item.id);
      save();
      if (record.evaluation?.status === 'invalid_response') {
        stop('invalid_response', `${item.id}: resposta Jev inválida (${record.evaluation.problems.join('; ')})`);
      }
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
// Na avaliação, `body` é o corpo HTTP do Jev: estado do braço, modelo e as seis perguntas Choice.
function buildPayload(item, source, translations, jevModel) {
  if (item.kind === 'translation') {
    return { direction: item.direction, text: item.direction === 'pt->en' ? caseText(source) : source.original };
  }
  const text = item.arm === 'pt' ? caseText(source) : translations.get(item.case_id)?.text;
  const judgments = [...JUDGMENT_IDS];
  return { arm: item.arm, text, judgments, body: buildJevBody({ model: jevModel, text, judgments }) };
}
