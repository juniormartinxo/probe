// fetch controlado do LM Studio e do Jev para os processos da bancada; nenhum socket é aberto.
// Cada pedido (método, URL, cabeçalhos sem valores de credencial e corpo) vai para AI_STUDY_SERVICES_LOG.
// AI_STUDY_TEST_FAIL=<local|jev>:<n>:<network|http|invalid|hang> faz o n-ésimo POST do serviço falhar
// (`hang`: nunca responde, nem ao cancelamento).
// AI_STUDY_TEST_ECHO=1 faz os serviços ecoarem o cabeçalho de autenticação nas respostas, inclusive de erro.
import { appendFileSync } from 'node:fs';

const logPath = process.env.AI_STUDY_SERVICES_LOG;
const JEV = 'https://api.typesafe.ai/v1/systemone';
const [failService, failAt, failKind] = (process.env.AI_STUDY_TEST_FAIL ?? '').split(':');
const echo = process.env.AI_STUDY_TEST_ECHO === '1';
const posts = { local: 0, jev: 0 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function failure(kind, auth) {
  const echoed = echo ? ` ${auth}` : '';
  if (kind === 'network') throw new TypeError(`fetch failed${echoed}`);
  if (kind === 'hang') return new Promise(() => {});
  if (kind === 'http') return new Response(`erro interno${echoed}`, { status: 500 });
  return new Response(`<html>resposta fora do contrato${echoed}</html>`, { status: 200 });
}

function route(url, method, body, auth) {
  const echoed = echo ? { echo: auth } : {};
  const modelMatch = url.pathname.match(/\/api\/v0\/models\/(.+)$/);
  if (method === 'GET' && modelMatch) {
    const id = decodeURIComponent(modelMatch[1]);
    return json({ id, object: 'model', type: 'llm', quantization: 'Q6_K', state: 'loaded', max_context_length: 8192 });
  }
  const service = method === 'POST' && url.href === JEV ? 'jev' : method === 'POST' && url.pathname.endsWith('/api/v0/completions') ? 'local' : null;
  if (service) {
    posts[service] += 1;
    if (service === failService && posts[service] === Number(failAt)) return failure(failKind, auth);
  }
  if (service === 'local') {
    return json({
      model: body.model,
      choices: [{ index: 0, text: 'Controlled English translation.', finish_reason: 'stop' }],
      usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 },
      ...(echo ? { stats: echoed } : {}),
    });
  }
  if (service === 'jev') {
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((id) => [
        id,
        { type: 'choice', choice: 'no', probabilities: { yes: 0.1, no: 0.8, insufficient: 0.1 }, confidence: 0.6 },
      ]),
    );
    return json({ model: body.model, answers, usage: { input_tokens: 400, output_tokens: 12, ...echoed } });
  }
  return json({ error: 'rota inesperada' }, 500);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  const headers = Object.keys(init.headers ?? {});
  if (logPath) appendFileSync(logPath, `${JSON.stringify({ pid: process.pid, method, url: url.href, headers, body })}\n`);
  return route(url, method, body, init.headers?.authorization ?? '');
};
