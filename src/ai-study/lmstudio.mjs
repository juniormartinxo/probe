import { httpError, readJsonBody, requireBudget } from './calls.mjs';

// Transporte live do LM Studio: REST v0 do servidor configurado, sem SDK e sem retries.
// Só consulta e usa o modelo solicitado: não carrega outro, não instala runtime, não baixa pesos.
// Cada operação é um único pedido HTTP contado no orçamento da execução, com o prazo local.
const COUNT_UNAVAILABLE =
  'o LM Studio não expõe contagem de tokens por HTTP antes do envio, e a bancada não tem tokenizer correspondente configurado';

export function createLmStudioTransport(config, { fetch = globalThis.fetch, budget } = {}) {
  requireBudget(budget, 'createLmStudioTransport');
  const { baseUrl, model, apiToken, timeoutSeconds, maxOutputTokens } = config.local;
  // REST v0 fica na raiz do servidor: preserva o prefixo de um proxy e tira só o sufixo /v1 da API compatível.
  // Origem e caminho descartam usuário, senha e query da URL; o token vai só no cabeçalho.
  const root = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
  const request = (signal, path, init = {}) =>
    fetch(`${root}/api/v0/${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}) },
      signal,
    });
  const call = (operation) => budget.call('local', timeoutSeconds, operation);

  return {
    provenance: 'live',
    inspect: () =>
      call(async (signal) => {
        const response = await request(signal, `models/${encodeURIComponent(model)}`);
        if (response.status === 404) return { provenance: 'live', model: null };
        if (!response.ok) throw httpError('LM Studio', response.status, 'ao consultar o modelo');
        const body = await readJsonBody(response, 'LM Studio');
        return {
          provenance: 'live',
          model: {
            id: body.id ?? null,
            quantization: body.quantization ?? null,
            compatibility_type: body.compatibility_type ?? null,
            state: body.state ?? null,
            max_context_length: body.max_context_length ?? null,
          },
        };
      }),
    // Sem pedido HTTP: não consome chamada do orçamento.
    async countTokens() {
      return { count: null, tokenizer: null, justification: COUNT_UNAVAILABLE };
    },
    translate: ({ prompt }) =>
      call(async (signal) => {
        const response = await request(signal, 'completions', {
          method: 'POST',
          body: JSON.stringify({ model, prompt, max_tokens: maxOutputTokens, temperature: 0, stream: false }),
        });
        if (!response.ok) throw httpError('LM Studio', response.status, 'na tradução');
        const body = await readJsonBody(response, 'LM Studio');
        const choice = body.choices?.[0];
        return {
          provenance: 'live',
          output: choice?.text ?? null,
          finish_reason: choice?.finish_reason ?? null,
          model: body.model ?? null,
          usage: body.usage ?? null,
          memory: null,
          runtime_details: { stats: body.stats ?? null, model_info: body.model_info ?? null, runtime: body.runtime ?? null },
        };
      }),
  };
}
