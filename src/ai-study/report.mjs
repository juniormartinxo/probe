import { ARMS } from './comparison.mjs';
import { MAX_INPUT_TOKENS, CANDIDATE_QUANTIZATION } from './translation.mjs';
import { outputHash, REVIEW_FILE } from './review.mjs';
import { templateRevision, TRANSLATION_TEMPLATE } from './template.mjs';

// Relatório de uma execução, derivado só das evidências lidas por `loadRun` e da revisão humana.
// Não chama modelos nem rede, não altera evidências e não promove configurações do produto: a
// recomendação é a registrada pelo humano, nunca inferida. Casos, julgamentos e denominadores vêm do
// que a execução gravou, nunca do corpus ou das constantes atuais.

export const SECTIONS = Object.freeze([
  'Configuração e proveniência',
  'Completude',
  'Originais e traduções',
  'Revisão semântica',
  'Comparação Jev',
  'Limitações',
]);

const ARM_LABELS = Object.freeze({ pt: 'PT (original)', en: 'EN (tradução)' });
const OUTCOME_LABELS = Object.freeze({ hit: 'acerto', miss: 'erro', absent: 'sem avaliação' });
const STATUS_LABELS = Object.freeze({
  completed: 'coleta concluída',
  incomplete: 'coleta incompleta',
  rejected: 'coleta rejeitada',
  running: 'sem término registrado (processo encerrado durante a coleta)',
});
// Códigos gravados nas evidências, apresentados em português com o código ao lado.
const REASON_LABELS = Object.freeze({
  pt_missing: 'braço PT ausente',
  en_missing: 'braço EN ausente',
  pt_invalid: 'braço PT inválido',
  en_invalid: 'braço EN inválido',
  reference_mismatch: 'corpus ou gabarito divergente',
  instructions_mismatch: 'instruções divergentes',
  criteria_mismatch: 'critérios divergentes',
  jev_model_mismatch: 'versão Jev divergente',
  jev_model_unknown: 'versão Jev não identificada',
  invalid_translation: 'tradução inválida',
  temporary: 'arquivo temporário',
  not_evidence: 'não é evidência',
  not_in_manifest: 'não confirmado pelo manifesto',
});

const SIMULATED_NOTICE = 'não são validação real do candidato, medição de VRAM nem ganho de tradução';

export const translationsOf = (loaded) => loaded.results.filter((r) => r.item.kind === 'translation');
const evaluationsOf = (loaded) => loaded.results.filter((r) => r.item.kind === 'evaluation');

export const isSimulated = (manifest) => manifest.mode !== 'live' || manifest.provenance !== 'live';

// Texto livre vindo das evidências ou da revisão numa linha: quebras não abrem títulos nem seções.
const inline = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ');
const code = (value) => `\`${value}\``;
const list = (items, empty = 'nenhum') => (items.length > 0 ? items.map(code).join(', ') : empty);
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
  if (!recorded?.official) return 'template oficial não confirmado';
  if (!official.official || recorded.revision !== templateRevision(official)) {
    return 'template gravado não é o template oficial adotado na bancada';
  }
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
  if (simulated) reasons.push({ code: 'simulated', detail: 'resultados simulados (fixture) não decidem sobre o candidato' });
  if (manifest.status !== 'completed') {
    reasons.push({ code: 'collection_incomplete', detail: `estado técnico ${code(manifest.status)}${manifest.reason ? ` (${code(inline(manifest.reason))})` : ''}` });
  }
  const notExecuted = manifest.not_executed_items ?? [];
  if (notExecuted.length > 0) reasons.push({ code: 'items_not_executed', detail: `${notExecuted.length} itens não executados` });
  const skipped = manifest.skipped_items ?? [];
  if (skipped.length > 0) reasons.push({ code: 'items_skipped', detail: `${skipped.length} itens não avaliados` });
  if (!loaded.comparison) reasons.push({ code: 'comparison_missing', detail: 'comparison.json ausente' });
  const pending = reviews.filter((r) => r.status === 'pending');
  if (pending.length > 0) {
    reasons.push({ code: 'review_pending', detail: `revisão semântica pendente em ${pending.map((r) => r.item).join(', ')}` });
  }
  return { conclusion: reasons.length > 0 ? 'inconclusive' : 'evidence_complete', reasons };
}

// C50: integração local real com os casos T planejados (T01–T06). Fixture nunca supre esses registros.
export function proveLiveTranslation(loaded, { officialTemplate = TRANSLATION_TEMPLATE } = {}) {
  const { manifest, byItem } = loaded;
  const problems = [];
  if (isSimulated(manifest)) {
    problems.push('evidência fixture: simulação não comprova a integração local');
    return { proven: false, problems };
  }
  const t = manifest.translation ?? {};
  const model = t.returned_model;
  const template = templateProblem(manifest, officialTemplate);
  if (template) problems.push(template);
  if (!manifest.config?.local?.base_url) problems.push('servidor local não identificado');
  if (!model) problems.push('modelo retornado pelo runtime não identificado');
  else if (model !== t.requested_model) problems.push(`modelo retornado ${model} diferente do solicitado ${t.requested_model}`);
  if (String(t.quantization ?? '').toUpperCase() !== CANDIDATE_QUANTIZATION) problems.push(`quantização ${t.quantization ?? 'não informada'}, não ${CANDIDATE_QUANTIZATION}`);
  const cases = plannedCases(manifest, 'en-pt');
  if (cases.length === 0) problems.push('nenhuma tradução EN→PT planejada');
  for (const id of cases) {
    const r = byItem.get(`${id}-translate-en-pt`);
    if (!r) {
      problems.push(`${id}: tradução EN→PT ausente`);
      continue;
    }
    const tr = r.translation;
    if (r.provenance !== 'live') problems.push(`${id}: proveniência ${r.provenance}`);
    if (tr.direction !== 'en->pt') problems.push(`${id}: direção ${tr.direction}`);
    if (tr.status !== 'valid') problems.push(`${id}: tradução ${tr.status}`);
    const returned = tr.runtime?.model?.value;
    if (!returned) problems.push(`${id}: saída sem modelo identificado pelo runtime`);
    else if (model && returned !== model) problems.push(`${id}: saída gerada por ${returned}, não ${model}`);
    const tokens = tr.input_tokens;
    if (!tokens || !Number.isInteger(tokens.count)) problems.push(`${id}: sem contagem de tokens da entrada`);
    else if (tokens.tokenizer !== model) problems.push(`${id}: contagem pelo tokenizer ${tokens.tokenizer}, não ${model}`);
    else if (tokens.count > MAX_INPUT_TOKENS) problems.push(`${id}: entrada com ${tokens.count} tokens acima de ${MAX_INPUT_TOKENS}`);
    if (!Number.isInteger(tr.duration_ms) || tr.duration_ms <= 0) problems.push(`${id}: sem duração real medida`);
  }
  return { proven: problems.length === 0, problems };
}

// C51: ao menos um caso R com tradução PT→EN e dois braços Jev válidos da mesma versão. Prova integração,
// não concordância com o gabarito, que é contada à parte. Os problemas dos demais casos ficam visíveis.
export function proveLiveRelational(loaded, { officialTemplate = TRANSLATION_TEMPLATE } = {}) {
  const { manifest, byItem } = loaded;
  if (isSimulated(manifest)) {
    return { proven: false, cases: [], problems: ['evidência fixture: simulação não comprova a avaliação Jev real'] };
  }
  const template = templateProblem(manifest, officialTemplate);
  if (template) return { proven: false, cases: [], problems: [template] };
  const problems = [];
  const cases = [];
  for (const id of plannedCases(manifest, 'pt-en')) {
    const translation = byItem.get(`${id}-translate-pt-en`);
    const arms = ARMS.map((arm) => byItem.get(`${id}-evaluate-${arm}`));
    if (!translation && arms.every((a) => !a)) continue;
    const caseProblems = [];
    if (!translation || translation.provenance !== 'live' || translation.translation.status !== 'valid') caseProblems.push('sem tradução PT→EN live válida');
    for (const [i, arm] of ARMS.entries()) {
      const r = arms[i];
      const sent = r?.request?.judgments?.length;
      if (!r) caseProblems.push(`braço ${arm} ausente`);
      else if (r.provenance !== 'live' || r.evaluation.status !== 'valid' || !sent || r.evaluation.results?.length !== sent) {
        caseProblems.push(`braço ${arm} sem resultados válidos live para todos os julgamentos enviados`);
      }
    }
    const [pt, en] = arms;
    if (pt && en && (!pt.evaluation.returned_model || pt.evaluation.returned_model !== en.evaluation.returned_model)) {
      caseProblems.push('braços sem a mesma versão Jev identificada');
    }
    if (en && translation && en.derived_from !== translation.item.id) caseProblems.push('braço en não deriva da tradução do caso');
    if (caseProblems.length === 0) cases.push(id);
    else problems.push(`${id}: ${caseProblems.join('; ')}`);
  }
  if (cases.length === 0 && problems.length === 0) problems.push('nenhum caso R executado');
  return { proven: cases.length > 0, cases, problems };
}

// Cerca maior que qualquer sequência de crases do texto: o texto aparece literal, sem escapes.
function fenced(text) {
  const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

const NOT_ZERO_COST = 'ausência de uso informado não é custo zero';

function availability(info, label, { usage = false } = {}) {
  if (!info) return `${label}: não registrado`;
  if (info.available) return `${label}: ${JSON.stringify(info.value)}`;
  return `${label}: indisponível — ${inline(info.justification)}${usage ? `; ${NOT_ZERO_COST}` : ''}`;
}

function usageLine(usage) {
  return usage?.available ? `uso informado: ${JSON.stringify(usage.value)}` : `uso: indisponível — ${NOT_ZERO_COST}`;
}

function countsTable(byArm) {
  const judgments = Object.keys(byArm[ARMS[0]]);
  const header = ['Julgamento', ...ARMS.flatMap((arm) => [`${ARM_LABELS[arm]} acertos`, `${ARM_LABELS[arm]} erros`, `${ARM_LABELS[arm]} sem avaliação`])];
  const rows = judgments.map((j) => [code(j), ...ARMS.flatMap((arm) => ['hit', 'miss', 'absent'].map((k) => String(byArm[arm][j][k])))]);
  return [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
}

function configurationSection(loaded, simulated) {
  const { manifest } = loaded;
  const t = manifest.translation ?? {};
  const e = manifest.evaluation ?? {};
  const local = manifest.config?.local ?? {};
  const jev = manifest.config?.jev ?? {};
  return [
    `- Execução: ${code(manifest.run_id)}`,
    `- Modo e proveniência: ${code(manifest.mode)} / ${code(manifest.provenance)}${simulated ? ' (simulado)' : ''}`,
    `- Início e término: ${manifest.started_at ?? 'não registrado'} — ${manifest.finished_at ?? 'não registrado'}`,
    `- Corpus: ${code(manifest.corpus?.path)}, revisão ${manifest.corpus?.revision}`,
    `- Hash do corpus: ${code(manifest.corpus?.corpus_hash)}`,
    `- Hash do gabarito usado nesta execução: ${code(manifest.corpus?.gabarito_hash)}`,
    `- Servidor local: ${local.base_url ? code(local.base_url) : 'nenhum (fixture não acessa a rede)'}`,
    `- Modelo local solicitado: ${t.requested_model ? code(t.requested_model) : 'não configurado'}; retornado pelo runtime: ${t.returned_model ? code(t.returned_model) : 'não identificado'}; quantização: ${t.quantization ?? 'não informada'}`,
    `- Template de tradução: ${code(t.template?.id)}, revisão ${code(t.template?.revision)}, ${t.template?.official ? 'oficial confirmado' : `não confirmado como oficial (${inline(t.template?.justification ?? 'sem justificativa')})`}`,
    `- Jev: destino ${jev.endpoint ? code(jev.endpoint) : 'não registrado'}, modelo solicitado ${e.requested_model ? code(e.requested_model) : 'não configurado'}`,
    `- Rubrica Jev: ${code(e.rubric_id)}, revisão ${code(e.rubric_revision)}`,
    `- Limites de chamadas: ${manifest.limits?.local_calls} locais e ${manifest.limits?.jev_calls} Jev; usadas: ${JSON.stringify(manifest.calls ?? {})}`,
    `- Timeouts: local ${local.timeout_seconds} s, Jev ${jev.timeout_seconds} s; saída local máxima ${local.max_output_tokens} tokens`,
  ].join('\n');
}

function completenessSection(loaded, assessment, liveProofs) {
  const { manifest } = loaded;
  const skipped = manifest.skipped_items ?? [];
  const lines = [
    `- Estado técnico: ${code(manifest.status)} — ${STATUS_LABELS[manifest.status] ?? 'estado desconhecido'}${manifest.reason ? `, motivo ${code(inline(manifest.reason))}` : ''}`,
    `- Itens planejados: ${(manifest.planned_items ?? []).length}; concluídos: ${(manifest.completed_items ?? []).length}`,
    `- Não executados: ${list(manifest.not_executed_items ?? [])}`,
    `- Não avaliados: ${skipped.length > 0 ? skipped.map((s) => `${code(s.item)} — ${reasonLabel(s.reason)}`).join(', ') : 'nenhum'}`,
  ];
  if (manifest.failure) {
    const f = manifest.failure;
    lines.push(
      `- Falha que encerrou a coleta: item ${code(f.item)}, serviço ${code(f.service)}, motivo ${code(f.reason)}, pedido enviado ${JSON.stringify(f.request_sent)}, resultado remoto ${code(f.remote_outcome)}: ${inline(f.message)}`,
    );
  }
  if (manifest.blocked) lines.push(`- Bloqueio: ${code(manifest.blocked.item ?? '-')} ${code(manifest.blocked.reason ?? '-')}: ${inline(manifest.blocked.justification)}`);
  if (manifest.comparison_error) lines.push(`- Erro ao gravar a comparação: ${inline(manifest.comparison_error)}`);
  if (loaded.ignored.length > 0) lines.push(`- Arquivos ignorados (não são evidência): ${loaded.ignored.map((i) => `${code(i.file)} — ${reasonLabel(i.reason)}`).join(', ')}`);
  const proof = (label, p) => {
    const status = p.proven ? `comprovada${p.cases ? ` (casos ${list(p.cases)})` : ''}` : 'sem prova';
    return `- ${label}: ${status}${p.problems.length > 0 ? ` — ${inline(p.problems.join('; '))}` : ''}`;
  };
  lines.push(proof('Integração local real dos casos T (EN→PT)', liveProofs.translation));
  lines.push(proof('Integração real tradução PT→EN e Jev pareado', liveProofs.relational));
  lines.push(`- Conclusão: ${code(assessment.conclusion)}`);
  for (const reason of assessment.reasons) lines.push(`  - ${code(reason.code)}: ${reason.detail}`);
  return lines.join('\n');
}

function translationsSection(loaded) {
  const translations = translationsOf(loaded);
  if (translations.length === 0) return 'Nenhuma tradução concluída nesta execução.';
  return translations
    .map((r) => {
      const t = r.translation;
      const tokens = t.input_tokens ? `${t.input_tokens.count} tokens (tokenizer ${code(t.input_tokens.tokenizer)})` : 'sem contagem (fixture não tem tokenizer do candidato)';
      return [
        `### ${r.item.id}`,
        '',
        `- Caso ${code(t.case_id)}, direção ${code(t.direction)}, proveniência ${code(r.provenance)}`,
        `- Estado: ${code(t.status)}${t.invalid_reason ? ` (${code(t.invalid_reason)})` : ''}`,
        `- Duração: ${t.duration_ms} ms; entrada formatada: ${tokens}`,
        `- Runtime — ${availability(t.runtime?.model, 'modelo')}; ${availability(t.runtime?.tokens, 'tokens', { usage: true })}; ${availability(t.runtime?.memory, 'memória')}`,
        `- Saída (sha256): ${code(outputHash(t.derived_text) ?? 'sem saída')}`,
        '',
        'Original:',
        '',
        fenced(t.original),
        '',
        'Tradução literal:',
        '',
        fenced(t.derived_text ?? ''),
      ].join('\n');
    })
    .join('\n\n');
}

function reviewSection(reviews, review, reviewPath) {
  const count = (status) => reviews.filter((r) => r.status === status).length;
  const lines = [
    `Cada tradução é revisada pela saída concreta (hash sha256 da saída literal), por significado, entidades, valores, negações, condições e ambiguidades. Revisão registrada em ${code(reviewPath)}${review.present ? '' : ' (ainda inexistente)'}.`,
    '',
    `- ${code('pending')}: ${count('pending')}; ${code('faithful')}: ${count('faithful')}; ${code('meaning_changed')}: ${count('meaning_changed')}`,
  ];
  for (const r of reviews) {
    lines.push(`- ${code(r.item)} — ${code(r.status)} — saída ${code(r.output_sha256 ?? 'sem saída')}`);
    if (r.status !== 'pending') lines.push(`  - Revisor: ${inline(r.reviewer)}`, `  - Justificativa: ${inline(r.justification)}`);
  }
  return lines.join('\n');
}

// Distribuição e confiança de cada julgamento de uma avaliação válida, como gravadas.
function distributionLines(evaluation) {
  return (evaluation.results ?? []).map((r) => {
    const distribution = Object.entries(r.probabilities ?? {}).map(([choice, p]) => `${choice} ${p}`).join(' / ');
    return `  - ${code(r.judgment)}: escolha ${r.choice}; distribuição ${distribution}; confiança ${r.confidence}`;
  });
}

function jevSection(loaded) {
  const { comparison, manifest } = loaded;
  if (!comparison) return 'Comparação ausente: a coleta terminou sem gravar `comparison.json`. Nenhuma métrica é apresentada.';
  const valid = (arm) => comparison.evaluations.filter((e) => e.arm === arm && e.status === 'valid').length;
  const { individual, paired } = comparison.counts;
  const lines = [
    `Gabarito usado: revisão ${manifest.corpus?.revision}, hash ${code(comparison.gabarito_hash)}. Uma correção do gabarito gera nova revisão e nova comparação identificada; esta comparação não é recalculada com outra referência.`,
    '',
    'A concordância com o gabarito é medida descritiva, contada à parte do sucesso da integração.',
    '',
    `- Casos relacionais: ${individual.denominator}`,
    ...ARMS.map((arm) => `- Avaliações válidas ${ARM_LABELS[arm]}: ${valid(arm)} de ${individual.denominator}`),
    `- Pares completos: ${paired.denominator} de ${individual.denominator}${paired.cases.length > 0 ? ` (${list(paired.cases)})` : ''}`,
    '',
    '### Por braço e julgamento (todas as avaliações)',
    '',
    `Denominador por braço e julgamento: ${individual.denominator} casos; caso sem avaliação válida conta como sem avaliação.`,
    '',
    countsTable(individual.by_arm),
    '',
    `### Pares completos (denominador ${paired.denominator})`,
    '',
    countsTable(paired.by_arm),
    '',
    '### Pares incompletos',
    '',
  ];
  const incomplete = comparison.pairs.filter((p) => p.status !== 'complete');
  lines.push(incomplete.length > 0 ? incomplete.map((p) => `- ${code(p.case_id)}: ${p.reasons.map(reasonLabel).join(', ')}`).join('\n') : 'Nenhum.');
  lines.push('', '### Resultados dos pares completos', '');
  if (paired.cases.length === 0) lines.push('Nenhum par completo.');
  for (const caseId of paired.cases) {
    const judgments = (arm) => comparison.evaluations.find((e) => e.case_id === caseId && e.arm === arm).judgments;
    const [pt, en] = ARMS.map(judgments);
    lines.push(`#### ${caseId}`, '', '| Julgamento | Esperado | PT | EN |', '| --- | --- | --- | --- |');
    for (const [i, j] of pt.entries()) lines.push(`| ${code(j.judgment)} | ${j.expected} | ${j.choice} (${OUTCOME_LABELS[j.outcome]}) | ${en[i].choice} (${OUTCOME_LABELS[en[i].outcome]}) |`);
    lines.push('');
  }
  lines.push('### Avaliações individuais', '', 'Distribuições e confianças são descritivas, não limiares de produção.', '');
  const evaluations = evaluationsOf(loaded);
  if (evaluations.length === 0) lines.push('Nenhuma avaliação concluída.');
  for (const r of evaluations) {
    const e = r.evaluation;
    lines.push(
      `- ${code(r.item.id)}: ${code(e.status)}, modelo retornado ${e.returned_model ? code(e.returned_model) : 'não identificado'}, duração ${e.duration_ms} ms, ${usageLine(e.usage)}${e.problems?.length ? `; problemas: ${inline(e.problems.join('; '))}` : ''}`,
      ...distributionLines(e),
    );
  }
  return lines.join('\n');
}

function limitationsSection(loaded, simulated) {
  const lines = [];
  if (simulated) {
    lines.push(`- Resultados simulados (fixture): ${SIMULATED_NOTICE}. Traduções, escolhas e durações vêm de respostas controladas.`);
  }
  lines.push(
    `- Amostra de ${plannedCases(loaded.manifest, 'pt-en').length} casos relacionais: não estabelece acurácia geral nem calibração de confiança. Distribuições e confianças são descritivas, não limiares de produção.`,
    '- Uso indisponível não é custo zero. Sem tarifa identificada nas evidências, nenhum uso é convertido em dinheiro e nenhuma economia é estimada.',
    '- Não há meta mínima de ganho: a decisão considera regressões semânticas, exemplos, diferença observada e latência medida.',
    '- O relatório não altera configurações do produto; a recomendação é somente a registrada pelo humano.',
  );
  return lines.join('\n');
}

function recommendationLine(recommendation) {
  return recommendation
    ? `${code(recommendation.decision)}, registrada por ${inline(recommendation.reviewer)}: ${inline(recommendation.justification)}`
    : `não registrada (preencher ${code('recommendation')} em ${code(REVIEW_FILE)})`;
}

// Markdown determinístico: as mesmas evidências e a mesma revisão geram os mesmos bytes.
// `reviewPath` é o caminho exibido do arquivo de revisão, resolvido pela CLI.
export function buildReport(loaded, review, { reviewPath = REVIEW_FILE } = {}) {
  const { manifest } = loaded;
  const simulated = isSimulated(manifest);
  const reviews = reviewStates(loaded, review);
  const assessment = assessConclusion(loaded, reviews, simulated);
  const liveProofs = { translation: proveLiveTranslation(loaded), relational: proveLiveRelational(loaded) };
  const header = [`# Relatório do estudo de tradução e Jev — execução ${manifest.run_id}`, ''];
  if (simulated) {
    header.push(`> **Resultados simulados (fixture).** ${SIMULATED_NOTICE[0].toUpperCase()}${SIMULATED_NOTICE.slice(1)}.`, '');
  }
  header.push(
    `- Estado técnico: ${code(manifest.status)}${manifest.reason ? ` (${code(inline(manifest.reason))})` : ''}`,
    `- Conclusão: ${code(assessment.conclusion)}`,
    `- Recomendação humana: ${recommendationLine(review.recommendation)}`,
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
    summary.simulated
      ? 'Relatório gerado de evidências simuladas (fixture): não comprova tradução real, avaliação Jev, VRAM ou ganho de tradução.'
      : 'Relatório gerado: o estado técnico não indica qualidade das traduções nem concordância com o gabarito.',
    `run_id: ${summary.run_id}`,
    `estado técnico: ${summary.status}${summary.reason ? ` (${inline(summary.reason)})` : ''}`,
    `conclusão: ${summary.conclusion}`,
    `recomendação humana: ${summary.recommendation ? summary.recommendation.decision : 'não registrada'}`,
    `relatório: ${reportPath}`,
  ];
  return `${lines.join('\n')}\n`;
}
