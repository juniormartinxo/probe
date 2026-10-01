// Hooks de carregamento só de teste: envolve os transportes fixture para coletas concorrentes reais.
// Cada chamada vai para AI_STUDY_SERVICES_LOG com o pid. A primeira cria `started-<pid>` em
// AI_STUDY_TEST_BARRIER_DIR e espera o arquivo `release` (no máximo 30 s) antes de seguir.
export async function load(url, context, nextLoad) {
  if (!url.endsWith('/src/ai-study/fixture.mjs')) return nextLoad(url, context);
  const real = JSON.stringify(`${url}?real`);
  const source = `
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { createFixtureTransports as createReal } from ${real};
    export * from ${real};

    const barrier = process.env.AI_STUDY_TEST_BARRIER_DIR;
    const log = (entry) =>
      appendFileSync(process.env.AI_STUDY_SERVICES_LOG, JSON.stringify({ pid: process.pid, ...entry }) + '\\n');

    export function createFixtureTransports(options) {
      const transports = createReal(options);
      let first = true;
      const wrap = (service, operation) => async (request) => {
        log({ service, item: request.item.id });
        if (first) {
          first = false;
          writeFileSync(join(barrier, 'started-' + process.pid), '');
          // Limite de 30 s: um teste que falhe sem liberar a barreira não deixa processos presos.
          const deadline = Date.now() + 30000;
          while (!existsSync(join(barrier, 'release')) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        return operation(request);
      };
      return {
        ...transports,
        local: { ...transports.local, translate: wrap('local', transports.local.translate) },
        jev: { ...transports.jev, evaluate: wrap('jev', transports.jev.evaluate) },
      };
    }
  `;
  return { format: 'module', source, shortCircuit: true };
}
