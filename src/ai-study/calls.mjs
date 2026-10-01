import { LIMITS } from './config.mjs';

const SERVICE_NAMES = Object.freeze({ local: 'locais', jev: 'Jev' });

// Falha de uma chamada a modelo. `remoteOutcome` diz o que se sabe do outro lado:
// `not_sent` (bloqueada antes do envio), `failed` (o serviço respondeu com erro), `invalid` (respondeu fora do
// contrato) ou `unknown` (a espera terminou sem confirmação; o cancelamento remoto nunca é presumido).
export class ServiceCallError extends Error {
  name = 'ServiceCallError';

  constructor(reason, message, { requestSent, remoteOutcome, details = {} }) {
    super(message);
    this.reason = reason;
    this.requestSent = requestSent;
    this.remoteOutcome = remoteOutcome;
    this.details = details;
  }
}

export const httpError = (service, status, what) =>
  new ServiceCallError('http_error', `${service} respondeu HTTP ${status} ${what}`, {
    requestSent: true,
    remoteOutcome: 'failed',
  });

// O corpo nunca é repetido na mensagem: pode ecoar o pedido ou credenciais.
export async function readJsonBody(response, service) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new ServiceCallError('invalid_response', `${service} devolveu um corpo que não é JSON`, {
      requestSent: true,
      remoteOutcome: 'invalid',
    });
  }
}

// Orçamento de uma execução: 20 chamadas locais e 24 Jev contadas na tentativa (falhas inclusive),
// no máximo uma chamada em andamento entre os dois serviços e prazo por chamada. Não há retry:
// cada operação de transporte faz um único pedido, e a tentativa além do limite não é enviada.
// `signal` interrompe a espera em andamento (por exemplo, Ctrl+C) sem alegar cancelamento remoto.
export function createCallBudget(limits = LIMITS, { signal } = {}) {
  const max = { local: limits.localCalls, jev: limits.jevCalls };
  const used = { local: 0, jev: 0 };
  let inFlight = null;

  return {
    snapshot: () => ({
      local: { used: used.local, limit: max.local },
      jev: { used: used.jev, limit: max.jev },
    }),
    async call(service, timeoutSeconds, operation) {
      if (inFlight) throw new Error(`chamada ${service} iniciada com outra (${inFlight}) em andamento; a bancada admite uma por vez`);
      if (signal?.aborted) {
        throw new ServiceCallError('interrupted', 'coleta interrompida antes do envio', { requestSent: false, remoteOutcome: 'not_sent' });
      }
      if (used[service] >= max[service]) {
        throw new ServiceCallError(
          'call_limit',
          `limite de ${max[service]} chamadas ${SERVICE_NAMES[service]} atingido; a tentativa ${used[service] + 1} não foi enviada`,
          { requestSent: false, remoteOutcome: 'not_sent', details: { limit: max[service] } },
        );
      }
      used[service] += 1;
      inFlight = service;
      const controller = new AbortController();
      let timer;
      let onInterrupt;
      const ended = new Promise((_, reject) => {
        const end = (error) => {
          controller.abort(error);
          reject(error);
        };
        if (timeoutSeconds !== null) {
          timer = setTimeout(
            () =>
              end(
                new ServiceCallError(
                  'timeout',
                  `sem resposta em ${timeoutSeconds} s; a espera foi encerrada e o cancelamento da inferência remota não foi confirmado`,
                  { requestSent: true, remoteOutcome: 'unknown', details: { timeout_seconds: timeoutSeconds } },
                ),
              ),
            timeoutSeconds * 1000,
          );
        }
        onInterrupt = () =>
          end(
            new ServiceCallError('interrupted', 'coleta interrompida durante a espera; o cancelamento da inferência remota não foi confirmado', {
              requestSent: true,
              remoteOutcome: 'unknown',
            }),
          );
        signal?.addEventListener('abort', onInterrupt, { once: true });
      });
      try {
        return await Promise.race([operation(controller.signal), ended]);
      } catch (error) {
        if (error instanceof ServiceCallError) throw error;
        throw new ServiceCallError('transport_error', `falha de transporte (${error.message})`, {
          requestSent: true,
          remoteOutcome: 'unknown',
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onInterrupt);
        inFlight = null;
      }
    },
  };
}
