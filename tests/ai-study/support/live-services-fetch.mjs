// fetch controlado do LM Studio e do Jev para os processos da bancada; nenhum socket é aberto.
// Cada pedido (método, URL, cabeçalhos sem valores de credencial e corpo) vai para AI_STUDY_SERVICES_LOG.
import { appendFileSync } from 'node:fs';

const logPath = process.env.AI_STUDY_SERVICES_LOG;
const JEV = 'https://api.typesafe.ai/v1/systemone';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function route(url, method, body) {
  const modelMatch = url.pathname.match(/\/api\/v0\/models\/(.+)$/);
  if (method === 'GET' && modelMatch) {
    const id = decodeURIComponent(modelMatch[1]);
    return json({ id, object: 'model', type: 'llm', quantization: 'Q6_K', state: 'loaded', max_context_length: 8192 });
  }
  if (method === 'POST' && url.pathname.endsWith('/api/v0/completions')) {
    return json({
      model: body.model,
      choices: [{ index: 0, text: 'Controlled English translation.', finish_reason: 'stop' }],
      usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 },
    });
  }
  if (method === 'POST' && url.href === JEV) {
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((id) => [
        id,
        { type: 'choice', choice: 'no', probabilities: { yes: 0.1, no: 0.8, insufficient: 0.1 }, confidence: 0.6 },
      ]),
    );
    return json({ model: body.model, answers, usage: { input_tokens: 400, output_tokens: 12 } });
  }
  return json({ error: 'rota inesperada' }, 500);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  const headers = Object.keys(init.headers ?? {});
  if (logPath) appendFileSync(logPath, `${JSON.stringify({ method, url: url.href, headers, body })}\n`);
  return route(url, method, body);
};
