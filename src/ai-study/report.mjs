import { ARMS } from './comparison.mjs';
import { REPORT_TEXT, text } from './report-text.mjs';
import { MAX_INPUT_TOKENS, CANDIDATE_QUANTIZATION } from './translation.mjs';
import { outputHash, REVIEW_FILE } from './review.mjs';
import { templateRevision, TRANSLATION_TEMPLATE } from './template.mjs';

// Relatório de uma execução, derivado só das evidências lidas por `loadRun` e da revisão humana.
// Não chama modelos nem rede, não altera evidências e não promove configurações do produto: a
// recomendação é a registrada pelo humano, nunca inferida. Casos, julgamentos e denominadores vêm do
// que a execução gravou, nunca do corpus ou das constantes atuais. Todo texto fixo vem do catálogo
// aprovado (`report-text.mjs`); este módulo só monta.

export const SECTIONS = REPORT_TEXT.sections;
const { arms: ARM_LABELS, outcomes: OUTCOME_LABELS, statuses: STATUS_LABELS, reasons: REASON_LABELS } = REPORT_TEXT;

const SIMULATED_NOTICE = text('simulatedNotice');

export const translationsOf = (loaded) => loaded.results.filter((r) => r.item.kind === 'translation');
const evaluationsOf = (loaded) => loaded.results.filter((r) => r.item.kind === 'evaluation');

export const isSimulated = (manifest) => manifest.mode !== 'live' || manifest.provenance !== 'live';

// Texto livre vindo das evidências ou da revisão numa linha: quebras não abrem títulos nem seções.
const inline = (value) => String(value ?? '').replace(/\s*\n\s*/g, ' ');
const code = (value) => `\`${value}\``;
const list = (items, empty = text('none')) => (items.length > 0 ? items.map(code).join(', ') : empty);
const reasonLabel = (reason) => (REASON_LABELS[reason] ? `${REASON_LABELS[reason]} (${code(reason)})` : code(inline(reason)));

// Casos planejados na execução, pelo sufixo do item de tradução (`R01-translate-pt-en`, `T01-translate-en-pt`).
function plannedCases(manifest, direction) {
  const suffix = `-translate-${direction}`;
  return (manifest.planned_items ?? []).filter((id) => id.endsWith(suffix)).map((id) => id.slice(0, -suffix.length));
}

// Live real exige o template versionado do repositório, adotado como oficial (Decisão 1). Uma coleta
// com serviços e template confirmados só num teste grava a mesma revisão, mas o template versionado não
// é oficial: a evidência não fecha C50/C51 enquanto o oficial não for adotado na bancada.
function templateProblem(manifest, official) {
  const recorded = manifest.translation?.template;
  if (!recorded?.official) return text('templateNotConfirmed');
  if (!official.official || recorded.revision !== templateRevision(official)) return text('templateNotAdopted');
  return null;
}

// Estado de revisão de cada tradução concluída: sem entrada na revisão humana, `pending`.
export function reviewStates(loaded, review) {
  return translationsOf(loaded).map((r) => {
    const entry = review.translations.get(r.item.id);
    const reviewed = entry && entry.status !== 'pending';
    return {
      item: r.item.id,
      case_id: r.item.case_id,
      output_sha256: outputHash(r.translation.derived_text),
      status: entry?.status ?? 'pending',
      reviewer: reviewed ? entry.reviewer : null,
      justification: reviewed ? entry.justification : null,
    };
  });
}

// Conclusão: `inconclusive` com qualquer coleta faltante, revisão pendente ou resultado simulado.
// A concordância com o gabarito nunca torna uma evidência incompleta conclusiva.
export function assessConclusion(loaded, reviews, simulated = isSimulated(loaded.manifest)) {
  const { manifest } = loaded;
  const reasons = [];
  if (simulated) reasons.push({ code: 'simulated', detail: text('reasonSimulated') });
  if (manifest.status !== 'completed') {
    reasons.push({
      code: 'collection_incomplete',
      detail: text('reasonCollectionIncomplete', { status: code(manifest.status), reason: manifest.reason ? ` (${code(inline(manifest.reason))})` : '' }),
    });
  }
  const notExecuted = manifest.not_executed_items ?? [];
  if (notExecuted.length > 0) reasons.push({ code: 'items_not_executed', detail: text('reasonItemsNotExecuted', { count: notExecuted.length }) });
  const skipped = manifest.skipped_items ?? [];
  if (skipped.length > 0) reasons.push({ code: 'items_skipped', detail: text('reasonItemsSkipped', { count: skipped.length }) });
  if (!loaded.comparison) reasons.push({ code: 'comparison_missing', detail: text('reasonComparisonMissing') });
  const pending = reviews.filter((r) => r.status === 'pending');
  if (pending.length > 0) {
    reasons.push({ code: 'review_pending', detail: text('reasonReviewPending', { items: pending.map((r) => r.item).join(', ') }) });
  }
  return { conclusion: reasons.length > 0 ? 'inconclusive' : 'evidence_complete', reasons };
}

// C50: integração local real com os casos T planejados (T01–T06). Fixture nunca supre esses registros.
export function proveLiveTranslation(loaded, { officialTemplate = TRANSLATION_TEMPLATE } = {}) {
  const { manifest, byItem } = loaded;
  const problems = [];
  if (isSimulated(manifest)) {
    problems.push(text('liveFixtureTranslation'));
    return { proven: false, problems };
  }
  const t = manifest.translation ?? {};
  const model = t.returned_model;
  const template = templateProblem(manifest, officialTemplate);
  if (template) problems.push(template);
  if (!manifest.config?.local?.base_url) problems.push(text('liveNoServer'));
  if (!model) problems.push(text('liveNoModel'));
  else if (model !== t.requested_model) problems.push(text('liveModelMismatch', { returned: model, requested: t.requested_model }));
  if (String(t.quantization ?? '').toUpperCase() !== CANDIDATE_QUANTIZATION) {
    problems.push(text('liveQuantization', { quantization: t.quantization ?? text('liveNotInformed'), expected: CANDIDATE_QUANTIZATION }));
  }
  const cases = plannedCases(manifest, 'en-pt');
  if (cases.length === 0) problems.push(text('liveNoTCases'));
  for (const id of cases) {
    const r = byItem.get(`${id}-translate-en-pt`);
    if (!r) {
      problems.push(text('liveTMissing', { id }));
      continue;
    }
    const tr = r.translation;
    if (r.provenance !== 'live') problems.push(text('liveProvenance', { id, provenance: r.provenance }));
    if (tr.direction !== 'en->pt') problems.push(text('liveDirection', { id, direction: tr.direction }));
    if (tr.status !== 'valid') problems.push(text('liveTranslationStatus', { id, status: tr.status }));
    const returned = tr.runtime?.model?.value;
    if (!returned) problems.push(text('liveOutputNoModel', { id }));
    else if (model && returned !== model) problems.push(text('liveOutputOtherModel', { id, returned, model }));
    const tokens = tr.input_tokens;
    if (!tokens || !Number.isInteger(tokens.count)) problems.push(text('liveNoTokenCount', { id }));
    else if (tokens.tokenizer !== model) problems.push(text('liveOtherTokenizer', { id, tokenizer: tokens.tokenizer, model }));
    else if (tokens.count > MAX_INPUT_TOKENS) problems.push(text('liveTooManyTokens', { id, count: tokens.count, max: MAX_INPUT_TOKENS }));
    if (!Number.isInteger(tr.duration_ms) || tr.duration_ms <= 0) problems.push(text('liveNoDuration', { id }));
  }
  return { proven: problems.length === 0, problems };
}

// C51: ao menos um caso R com tradução PT→EN e dois braços Jev válidos da mesma versão. Prova integração,
// não concordância com o gabarito, que é contada à parte. Os problemas dos demais casos ficam visíveis.
export function proveLiveRelational(loaded, { officialTemplate = TRANSLATION_TEMPLATE } = {}) {
  const { manifest, byItem } = loaded;
  if (isSimulated(manifest)) return { proven: false, cases: [], problems: [text('liveFixtureRelational')] };
  const template = templateProblem(manifest, officialTemplate);
  if (template) return { proven: false, cases: [], problems: [template] };
  const problems = [];
  const cases = [];
  for (const id of plannedCases(manifest, 'pt-en')) {
    const translation = byItem.get(`${id}-translate-pt-en`);
    const arms = ARMS.map((arm) => byItem.get(`${id}-evaluate-${arm}`));
    if (!translation && arms.every((a) => !a)) continue;
    const caseProblems = [];
    if (!translation || translation.provenance !== 'live' || translation.translation.status !== 'valid') caseProblems.push(text('liveNoTranslation'));
    for (const [i, arm] of ARMS.entries()) {
      const r = arms[i];
      const sent = r?.request?.judgments?.length;
      if (!r) caseProblems.push(text('liveArmMissing', { arm }));
      else if (r.provenance !== 'live' || r.evaluation.status !== 'valid' || !sent || r.evaluation.results?.length !== sent) {
        caseProblems.push(text('liveArmInvalid', { arm }));
      }
    }
    const [pt, en] = arms;
    if (pt && en && (!pt.evaluation.returned_model || pt.evaluation.returned_model !== en.evaluation.returned_model)) {
      caseProblems.push(text('liveArmsVersion'));
    }
    if (en && translation && en.derived_from !== translation.item.id) caseProblems.push(text('liveEnNotDerived'));
    if (caseProblems.length === 0) cases.push(id);
    else problems.push(text('liveCaseProblems', { id, problems: caseProblems.join('; ') }));
  }
  if (cases.length === 0 && problems.length === 0) problems.push(text('liveNoRCases'));
  return { proven: cases.length > 0, cases, problems };
}

// Cerca maior que qualquer sequência de crases do texto: o texto aparece literal, sem escapes.
function fenced(value) {
  const longest = Math.max(2, ...[...String(value).matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${value}\n${fence}`;
}

function availability(info, label, { usage = false } = {}) {
  if (!info) return text('availabilityMissing', { label });
  if (info.available) return text('availabilityValue', { label, value: JSON.stringify(info.value) });
  return text('availabilityUnavailable', { label, justification: inline(info.justification), usage: usage ? `; ${text('notZeroCost')}` : '' });
}

function usageLine(usage) {
  return usage?.available ? text('usageInformed', { value: JSON.stringify(usage.value) }) : text('usageUnavailable', { notZeroCost: text('notZeroCost') });
}

function countsTable(byArm) {
  const judgments = Object.keys(byArm[ARMS[0]]);
  const header = [
    text('tableJudgment'),
    ...ARMS.flatMap((arm) => [text('tableHits', { arm: ARM_LABELS[arm] }), text('tableMisses', { arm: ARM_LABELS[arm] }), text('tableAbsent', { arm: ARM_LABELS[arm] })]),
  ];
  const rows = judgments.map((j) => [code(j), ...ARMS.flatMap((arm) => ['hit', 'miss', 'absent'].map((k) => String(byArm[arm][j][k])))]);
  return [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
}

function configurationSection(loaded, simulated) {
  const { manifest } = loaded;
  const t = manifest.translation ?? {};
  const e = manifest.evaluation ?? {};
  const local = manifest.config?.local ?? {};
  const jev = manifest.config?.jev ?? {};
  const optional = (value, missing) => (value ? code(value) : missing);
  return [
    text('configRun', { run: code(manifest.run_id) }),
    text('configMode', { mode: code(manifest.mode), provenance: code(manifest.provenance), simulated: simulated ? text('configSimulated') : '' }),
    text('configTimes', { started: manifest.started_at ?? text('notRecorded'), finished: manifest.finished_at ?? text('notRecorded') }),
    text('configCorpus', { path: code(manifest.corpus?.path), revision: manifest.corpus?.revision }),
    text('configCorpusHash', { hash: code(manifest.corpus?.corpus_hash) }),
    text('configGabaritoHash', { hash: code(manifest.corpus?.gabarito_hash) }),
    text('configServer', { server: optional(local.base_url, text('configNoServer')) }),
    text('configLocalModel', {
      requested: optional(t.requested_model, text('configNotConfigured')),
      returned: optional(t.returned_model, text('configNotIdentified')),
      quantization: t.quantization ?? text('liveNotInformed'),
    }),
    text('configTemplate', {
      id: code(t.template?.id),
      revision: code(t.template?.revision),
      official: t.template?.official
        ? text('configTemplateOfficial')
        : text('configTemplateNotOfficial', { justification: inline(t.template?.justification ?? text('configNoJustification')) }),
    }),
    text('configJev', { endpoint: optional(jev.endpoint, text('notRecorded')), model: optional(e.requested_model, text('configNotConfigured')) }),
    text('configRubric', { id: code(e.rubric_id), revision: code(e.rubric_revision) }),
    text('configLimits', { local: manifest.limits?.local_calls, jev: manifest.limits?.jev_calls, calls: JSON.stringify(manifest.calls ?? {}) }),
    text('configTimeouts', { local: local.timeout_seconds, jev: jev.timeout_seconds, tokens: local.max_output_tokens }),
  ].join('\n');
}

function completenessSection(loaded, assessment, liveProofs) {
  const { manifest } = loaded;
  const skipped = manifest.skipped_items ?? [];
  const lines = [
    text('completenessState', {
      status: code(manifest.status),
      label: STATUS_LABELS[manifest.status] ?? text('completenessUnknownState'),
      reason: manifest.reason ? text('completenessReason', { reason: code(inline(manifest.reason)) }) : '',
    }),
    text('completenessItems', { planned: (manifest.planned_items ?? []).length, completed: (manifest.completed_items ?? []).length }),
    text('completenessNotExecuted', { items: list(manifest.not_executed_items ?? []) }),
    text('completenessSkipped', {
      items: skipped.length > 0 ? skipped.map((s) => text('completenessSkippedItem', { item: code(s.item), reason: reasonLabel(s.reason) })).join(', ') : text('none'),
    }),
  ];
  if (manifest.failure) {
    const f = manifest.failure;
    lines.push(
      text('completenessFailure', {
        item: code(f.item),
        service: code(f.service),
        reason: code(f.reason),
        sent: JSON.stringify(f.request_sent),
        outcome: code(f.remote_outcome),
        message: inline(f.message),
      }),
    );
  }
  if (manifest.blocked) {
    lines.push(
      text('completenessBlocked', {
        item: code(manifest.blocked.item ?? '-'),
        reason: code(manifest.blocked.reason ?? '-'),
        justification: inline(manifest.blocked.justification),
      }),
    );
  }
  if (manifest.comparison_error) lines.push(text('completenessComparisonError', { error: inline(manifest.comparison_error) }));
  if (loaded.ignored.length > 0) {
    lines.push(
      text('completenessIgnored', {
        files: loaded.ignored.map((i) => text('completenessSkippedItem', { item: code(i.file), reason: reasonLabel(i.reason) })).join(', '),
      }),
    );
  }
  const proof = (label, p) => {
    const status = p.proven ? text('proofProven', { cases: p.cases ? text('proofCases', { cases: list(p.cases) }) : '' }) : text('proofUnproven');
    return text('proofLine', { label, status, problems: p.problems.length > 0 ? ` — ${inline(p.problems.join('; '))}` : '' });
  };
  lines.push(proof(text('proofTranslation'), liveProofs.translation));
  lines.push(proof(text('proofRelational'), liveProofs.relational));
  lines.push(text('completenessConclusion', { conclusion: code(assessment.conclusion) }));
  for (const reason of assessment.reasons) lines.push(text('completenessConclusionReason', { code: code(reason.code), detail: reason.detail }));
  return lines.join('\n');
}

function translationsSection(loaded) {
  const translations = translationsOf(loaded);
  if (translations.length === 0) return text('noTranslations');
  return translations
    .map((r) => {
      const t = r.translation;
      const tokens = t.input_tokens
        ? text('translationTokens', { count: t.input_tokens.count, tokenizer: code(t.input_tokens.tokenizer) })
        : text('translationNoTokens');
      return [
        `### ${r.item.id}`,
        '',
        text('translationCase', { case: code(t.case_id), direction: code(t.direction), provenance: code(r.provenance) }),
        text('translationState', { status: code(t.status), invalid: t.invalid_reason ? ` (${code(t.invalid_reason)})` : '' }),
        text('translationDuration', { duration: t.duration_ms, tokens }),
        text('translationRuntime', {
          model: availability(t.runtime?.model, text('runtimeModel')),
          tokens: availability(t.runtime?.tokens, text('runtimeTokens'), { usage: true }),
          memory: availability(t.runtime?.memory, text('runtimeMemory')),
        }),
        text('translationOutput', { hash: code(outputHash(t.derived_text) ?? text('noOutput')) }),
        '',
        text('original'),
        '',
        fenced(t.original),
        '',
        text('literalTranslation'),
        '',
        fenced(t.derived_text ?? ''),
      ].join('\n');
    })
    .join('\n\n');
}

function reviewSection(reviews, review, reviewPath) {
  const count = (status) => reviews.filter((r) => r.status === status).length;
  const lines = [
    text('reviewIntro', { path: code(reviewPath), missing: review.present ? '' : text('reviewMissing') }),
    '',
    `- ${code('pending')}: ${count('pending')}; ${code('faithful')}: ${count('faithful')}; ${code('meaning_changed')}: ${count('meaning_changed')}`,
  ];
  for (const r of reviews) {
    lines.push(text('reviewItem', { item: code(r.item), status: code(r.status), hash: code(r.output_sha256 ?? text('noOutput')) }));
    if (r.status !== 'pending') {
      lines.push(text('reviewReviewer', { reviewer: inline(r.reviewer) }), text('reviewJustification', { justification: inline(r.justification) }));
    }
  }
  return lines.join('\n');
}

// Distribuição e confiança de cada julgamento de uma avaliação válida, como gravadas.
function distributionLines(evaluation) {
  return (evaluation.results ?? []).map((r) => {
    const distribution = Object.entries(r.probabilities ?? {}).map(([choice, p]) => `${choice} ${p}`).join(' / ');
    return text('jevDistribution', { judgment: code(r.judgment), choice: r.choice, distribution, confidence: r.confidence });
  });
}

function jevSection(loaded) {
  const { comparison, manifest } = loaded;
  if (!comparison) return text('jevNoComparison');
  const valid = (arm) => comparison.evaluations.filter((e) => e.arm === arm && e.status === 'valid').length;
  const { individual, paired } = comparison.counts;
  const lines = [
    text('jevGabarito', { revision: manifest.corpus?.revision, hash: code(comparison.gabarito_hash) }),
    '',
    text('jevDescriptive'),
    '',
    text('jevCases', { count: individual.denominator }),
    ...ARMS.map((arm) => text('jevValid', { arm: ARM_LABELS[arm], valid: valid(arm), total: individual.denominator })),
    text('jevPairs', { pairs: paired.denominator, total: individual.denominator, cases: paired.cases.length > 0 ? ` (${list(paired.cases)})` : '' }),
    '',
    text('jevByArm'),
    '',
    text('jevDenominator', { count: individual.denominator }),
    '',
    countsTable(individual.by_arm),
    '',
    text('jevPairedHeading', { count: paired.denominator }),
    '',
    countsTable(paired.by_arm),
    '',
    text('jevIncompleteHeading'),
    '',
  ];
  const incomplete = comparison.pairs.filter((p) => p.status !== 'complete');
  lines.push(
    incomplete.length > 0
      ? incomplete.map((p) => text('jevIncomplete', { case: code(p.case_id), reasons: p.reasons.map(reasonLabel).join(', ') })).join('\n')
      : text('jevNone'),
  );
  lines.push('', text('jevPairedResults'), '');
  if (paired.cases.length === 0) lines.push(text('jevNoPairs'));
  for (const caseId of paired.cases) {
    const judgments = (arm) => comparison.evaluations.find((e) => e.case_id === caseId && e.arm === arm).judgments;
    const [pt, en] = ARMS.map(judgments);
    lines.push(`#### ${caseId}`, '', text('jevPairHeader'), '| --- | --- | --- | --- |');
    for (const [i, j] of pt.entries()) lines.push(`| ${code(j.judgment)} | ${j.expected} | ${j.choice} (${OUTCOME_LABELS[j.outcome]}) | ${en[i].choice} (${OUTCOME_LABELS[en[i].outcome]}) |`);
    lines.push('');
  }
  lines.push(text('jevIndividual'), '', text('jevDistributionsNote'), '');
  const evaluations = evaluationsOf(loaded);
  if (evaluations.length === 0) lines.push(text('jevNoEvaluations'));
  for (const r of evaluations) {
    const e = r.evaluation;
    lines.push(
      text('jevEvaluation', {
        item: code(r.item.id),
        status: code(e.status),
        model: e.returned_model ? code(e.returned_model) : text('configNotIdentified'),
        duration: e.duration_ms,
        usage: usageLine(e.usage),
        problems: e.problems?.length ? text('jevProblems', { problems: inline(e.problems.join('; ')) }) : '',
      }),
      ...distributionLines(e),
    );
  }
  return lines.join('\n');
}

function limitationsSection(loaded, simulated) {
  const lines = [];
  if (simulated) lines.push(text('limitSimulated', { notice: SIMULATED_NOTICE }));
  lines.push(
    text('limitSample', { count: plannedCases(loaded.manifest, 'pt-en').length }),
    text('limitCost'),
    text('limitGain'),
    text('limitProduct'),
  );
  return lines.join('\n');
}

function recommendationLine(recommendation) {
  return recommendation
    ? text('recommendationRecorded', { decision: code(recommendation.decision), reviewer: inline(recommendation.reviewer), justification: inline(recommendation.justification) })
    : text('recommendationMissing', { field: code('recommendation'), file: code(REVIEW_FILE) });
}

// Markdown determinístico: as mesmas evidências e a mesma revisão geram os mesmos bytes.
// `reviewPath` é o caminho exibido do arquivo de revisão, resolvido pela CLI.
export function buildReport(loaded, review, { reviewPath = REVIEW_FILE } = {}) {
  const { manifest } = loaded;
  const simulated = isSimulated(manifest);
  const reviews = reviewStates(loaded, review);
  const assessment = assessConclusion(loaded, reviews, simulated);
  const liveProofs = { translation: proveLiveTranslation(loaded), relational: proveLiveRelational(loaded) };
  const header = [text('title', { run: manifest.run_id }), ''];
  if (simulated) header.push(text('simulatedBanner', { notice: `${SIMULATED_NOTICE[0].toUpperCase()}${SIMULATED_NOTICE.slice(1)}` }), '');
  header.push(
    text('headerState', { status: code(manifest.status), reason: manifest.reason ? ` (${code(inline(manifest.reason))})` : '' }),
    text('headerConclusion', { conclusion: code(assessment.conclusion) }),
    text('headerRecommendation', { recommendation: recommendationLine(review.recommendation) }),
  );
  const bodies = [
    configurationSection(loaded, simulated),
    completenessSection(loaded, assessment, liveProofs),
    translationsSection(loaded),
    reviewSection(reviews, review, reviewPath),
    jevSection(loaded),
    limitationsSection(loaded, simulated),
  ];
  const markdown = `${[header.join('\n'), ...SECTIONS.map((title, i) => `## ${title}\n\n${bodies[i]}`)].join('\n\n')}\n`;
  return {
    markdown,
    summary: {
      run_id: manifest.run_id,
      simulated,
      status: manifest.status,
      reason: manifest.reason,
      conclusion: assessment.conclusion,
      reasons: assessment.reasons,
      recommendation: review.recommendation,
      reviews,
      live: liveProofs,
    },
  };
}

export function formatReportSummary(summary, reportPath) {
  const lines = [
    summary.simulated ? text('summarySimulated') : text('summaryLive'),
    text('summaryRun', { run: summary.run_id }),
    text('summaryState', { status: summary.status, reason: summary.reason ? ` (${inline(summary.reason)})` : '' }),
    text('summaryConclusion', { conclusion: summary.conclusion }),
    text('summaryRecommendation', { recommendation: summary.recommendation ? summary.recommendation.decision : text('summaryNotRecorded') }),
    text('summaryReport', { path: reportPath }),
  ];
  return `${lines.join('\n')}\n`;
}
