// Transporte live do LM Studio: REST v0 do servidor configurado, sem SDK e sem retries.
// Só consulta e usa o modelo solicitado: não carrega outro, não instala runtime, não baixa pesos.
const COUNT_UNAVAILABLE =
  'o LM Studio não expõe contagem de tokens por HTTP antes do envio, e a bancada não tem tokenizer correspondente configurado';

export function createLmStudioTransport(config, { fetch = globalThis.fetch } = {}) {
  const { baseUrl, model, apiToken, timeoutSeconds, maxOutputTokens } = config.local;
  // REST v0 fica na raiz do servidor: preserva o prefixo de um proxy e tira só o sufixo /v1 da API compatível.
  // Origem e caminho descartam usuário, senha e query da URL; o token vai só no cabeçalho.
  const root = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
  const request = (path, init = {}) =>
    fetch(`${root}/api/v0/${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}) },
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
  const failure = (response, what) => new Error(`LM Studio respondeu HTTP ${response.status} ${what}`);

  return {
    provenance: 'live',
    async inspect() {
      const response = await request(`models/${encodeURIComponent(model)}`);
      if (response.status === 404) return { provenance: 'live', model: null };
      if (!response.ok) throw failure(response, 'ao consultar o modelo');
      const body = await response.json();
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
    },
    async countTokens() {
      return { count: null, tokenizer: null, justification: COUNT_UNAVAILABLE };
    },
    async translate({ prompt }) {
      const response = await request('completions', {
        method: 'POST',
        body: JSON.stringify({ model, prompt, max_tokens: maxOutputTokens, temperature: 0, stream: false }),
      });
      if (!response.ok) throw failure(response, 'na tradução');
      const body = await response.json();
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
    },
  };
}
