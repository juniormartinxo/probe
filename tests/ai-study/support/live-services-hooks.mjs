// Hooks de carregamento só de teste para `make ai-study-run MODE=live` com serviços controlados.
// O template e a contagem de tokens ainda não existem na bancada (STATE.md, Decisões 1 e 2): aqui são
// confirmados só no teste para a coleta chegar ao Jev. A variante pode trocar a proveniência do Jev.
let variant = 'controlled';

export function initialize(data) {
  variant = data?.variant ?? variant;
}

const jevReplacements = {
  controlled: null,
  'fixture-transport': `{ ...transport, provenance: 'fixture' }`,
  'fixture-response': `{ ...transport, evaluate: async (request) => ({ ...(await transport.evaluate(request)), provenance: 'fixture' }) }`,
};

const wrappers = {
  'template.mjs': (real) => `
    import { TRANSLATION_TEMPLATE as REAL } from ${real};
    export * from ${real};
    export const TRANSLATION_TEMPLATE = Object.freeze({ ...REAL, official: true, justification: 'confirmado somente no teste' });
  `,
  'lmstudio.mjs': (real) => `
    import { createLmStudioTransport as createReal } from ${real};
    export * from ${real};
    export function createLmStudioTransport(config, options) {
      const transport = createReal(config, options);
      return { ...transport, countTokens: async () => ({ count: 100, tokenizer: config.local.model }) };
    }
  `,
  'jev.mjs': (real) =>
    jevReplacements[variant] &&
    `
    import { createJevTransport as createReal } from ${real};
    export * from ${real};
    export function createJevTransport(config, options) {
      const transport = createReal(config, options);
      return ${jevReplacements[variant]};
    }
  `,
};

export async function load(url, context, nextLoad) {
  const name = Object.keys(wrappers).find((file) => url.endsWith(`/src/ai-study/${file}`));
  const source = name && wrappers[name](JSON.stringify(`${url}?real`));
  if (!source) return nextLoad(url, context);
  return { format: 'module', source, shortCircuit: true };
}
