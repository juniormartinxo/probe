// Substitui src/ai-study/fixture.mjs por uma versão cujo transporte Jev se declara live.
export async function load(url, context, nextLoad) {
  if (!url.endsWith('/src/ai-study/fixture.mjs')) return nextLoad(url, context);
  const real = `${url}?real`;
  const source = `
    import { createFixtureTransports as createReal } from ${JSON.stringify(real)};
    export * from ${JSON.stringify(real)};
    export function createFixtureTransports(options) {
      const transports = createReal(options);
      return { ...transports, jev: { ...transports.jev, provenance: 'live' } };
    }
  `;
  return { format: 'module', source, shortCircuit: true };
}
