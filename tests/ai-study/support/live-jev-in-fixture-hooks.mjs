// Substitui src/ai-study/fixture.mjs por uma versão cujo Jev mistura proveniência live na coleta fixture.
let variant = 'transport';

export function initialize(data) {
  variant = data?.variant ?? variant;
}

const replacements = {
  transport: `{ ...transports.jev, provenance: 'live' }`,
  response: `{
    provenance: 'fixture',
    evaluate: async (request) => ({ ...(await transports.jev.evaluate(request)), provenance: 'live' }),
  }`,
};

export async function load(url, context, nextLoad) {
  if (!url.endsWith('/src/ai-study/fixture.mjs')) return nextLoad(url, context);
  const real = `${url}?real`;
  const source = `
    import { createFixtureTransports as createReal } from ${JSON.stringify(real)};
    export * from ${JSON.stringify(real)};
    export function createFixtureTransports(options) {
      const transports = createReal(options);
      return { ...transports, jev: ${replacements[variant]} };
    }
  `;
  return { format: 'module', source, shortCircuit: true };
}
