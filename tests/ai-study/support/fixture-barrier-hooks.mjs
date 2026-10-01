// Hooks de carregamento só de teste: envolve os transportes fixture para coletas concorrentes reais.
// Cada chamada vai para AI_STUDY_SERVICES_LOG com o pid. A primeira cria `started-<pid>` em
// AI_STUDY_TEST_BARRIER_DIR e espera o arquivo `release` (no máximo 30 s). A espera fica fora do orçamento:
// antes da chamada (padrão) ou, com AI_STUDY_TEST_BARRIER_AT=after, depois que ela terminou.
export async function load(url, context, nextLoad) {
  if (!url.endsWith('/src/ai-study/fixture.mjs')) return nextLoad(url, context);
  const real = JSON.stringify(`${url}?real`);
  const source = `
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { createFixtureTransports as createReal } from ${real};
    export * from ${real};

    const barrier = process.env.AI_STUDY_TEST_BARRIER_DIR;
    const after = process.env.AI_STUDY_TEST_BARRIER_AT === 'after';
    const log = (entry) =>
      appendFileSync(process.env.AI_STUDY_SERVICES_LOG, JSON.stringify({ pid: process.pid, ...entry }) + '\\n');

    export function createFixtureTransports(options) {
      const transports = createReal(options);
      let first = true;
      // Limite de 30 s: um teste que falhe sem liberar a barreira não deixa processos presos.
      const wait = async () => {
        writeFileSync(join(barrier, 'started-' + process.pid), '');
        const deadline = Date.now() + 30000;
        while (!existsSync(join(barrier, 'release')) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      const wrap = (service, operation) => async (request) => {
        log({ service, item: request.item.id });
        const hold = first;
        first = false;
        if (hold && !after) await wait();
        const response = await operation(request);
        if (hold && after) await wait();
        return response;
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
