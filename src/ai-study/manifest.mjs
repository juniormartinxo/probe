import { displayUrl } from './config.mjs';

// Configuração publicável: modelos e destinos sem credenciais, segredos só como presença.
export function publicConfig(config) {
  return {
    mode: config.mode,
    run_id: config.runId,
    corpus: config.corpusDisplay,
    local: {
      base_url: displayUrl(config.local.baseUrl),
      model: config.local.model,
      api_token_configured: config.local.apiToken !== null,
      timeout_seconds: config.local.timeoutSeconds,
      max_output_tokens: config.local.maxOutputTokens,
    },
    jev: {
      endpoint: config.jev.endpoint,
      model: config.jev.model,
      api_key_configured: config.jev.apiKey !== null,
      timeout_seconds: config.jev.timeoutSeconds,
    },
  };
}

export function formatDryRun(config, corpusInfo, items) {
  const live = config.mode === 'live';
  const model = (value) => value ?? 'não configurado (fixture não chama modelos)';
  const translations = items.filter((i) => i.kind === 'translation').length;
  const lines = [
    'Manifesto da bancada ai-study (dry-run: nada é executado, nenhuma evidência é criada)',
    `modo: ${config.mode}`,
    `run_id: ${config.runId ?? 'gerado na coleta'}`,
    `corpus: ${config.corpusDisplay} (revisão ${corpusInfo.revision})`,
    `hash do corpus: ${corpusInfo.corpusHash}`,
    `hash do gabarito: ${corpusInfo.gabaritoHash}`,
    `modelo local solicitado: ${model(config.local.model)}`,
    `modelo Jev solicitado: ${model(config.jev.model)}`,
    `máximo de chamadas locais: ${config.limits.localCalls}`,
    `máximo de chamadas Jev: ${config.limits.jevCalls}`,
    `timeout local (s): ${config.local.timeoutSeconds}`,
    `timeout Jev (s): ${config.jev.timeoutSeconds}`,
    `saída local máxima (tokens): ${config.local.maxOutputTokens}`,
    `destino local: ${live ? displayUrl(config.local.baseUrl) : 'nenhum (fixture não acessa a rede)'}`,
    `destino Jev: ${live ? config.jev.endpoint : 'nenhum (fixture não acessa a rede)'}`,
    `chave Jev: ${config.jev.apiKey ? 'configurada (valor omitido)' : 'não configurada'}`,
    `token local: ${config.local.apiToken ? 'configurado (valor omitido)' : 'não configurado'}`,
    `itens planejados: ${items.length} (${translations} traduções, ${items.length - translations} avaliações)`,
  ];
  return `${lines.join('\n')}\n`;
}

export function formatRunSummary(outcome, runDirDisplay) {
  const { manifest } = outcome;
  const lines = [
    manifest.mode === 'fixture'
      ? 'Coleta fixture concluída: resultados simulados; não comprovam tradução real, avaliação Jev, VRAM ou ganho de tradução.'
      : 'Coleta live concluída: a conclusão técnica não indica qualidade das traduções nem concordância com o gabarito.',
    `modo: ${manifest.mode}`,
    `run_id: ${manifest.run_id}`,
    `estado: ${manifest.status}`,
    `itens concluídos: ${manifest.completed_items.length} de ${manifest.planned_items.length}`,
    `evidências: ${runDirDisplay}`,
  ];
  return `${lines.join('\n')}\n`;
}
