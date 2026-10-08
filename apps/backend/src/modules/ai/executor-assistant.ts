import http from "node:http";
import type { Assistant, AssistantOutcome, FailureReason, AttemptContext, Usage } from "./assistant.ts";
import { blockPrompt, parseGeneratedBlock } from "./generate-block.ts";
import { parseStatementProposal, refinementPrompt } from "./refine-problem-statement.ts";

export interface ExecutorSettings {
  url: string;
  // Credencial técnica combinada com o executor; sem ela, nenhuma geração é enviada.
  token: string | undefined;
  // Quanto o backend espera por uma geração antes de dá-la por interrompida. Fica acima do tempo
  // máximo do executor, que normalmente encerra a CLI e responde "timed_out" antes.
  deadlineMs: number;
}

const HEALTH_TIMEOUT_MS = 5_000;

// Prompt do teste de conexão: o menor pedido que ainda passa pela CLI e pelo modelo.
export const CONNECTION_TEST_PROMPT = "Teste de conexão do PROBE. Responda apenas: ok";

// Pela conexão não dá para saber se o executor chegou a receber uma geração (no WSL, uma porta
// sem serviço também aceita e derruba a conexão). Por isso o executor é consultado antes: se não
// responde, a geração não é enviada; se cai depois, a geração fica interrompida.
async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

type Response = { status: number; body: unknown };

type Sent = { ok: true; response: Response } | { ok: false; outcome: AssistantOutcome<never> };

// node:http em vez de fetch: o fetch do Node desiste de esperar a resposta depois de 300 s, o
// mesmo tempo máximo padrão de uma geração no executor. O prazo do backend é `deadline`.
function post(
  url: URL,
  token: string,
  body: unknown,
  { signal, deadline }: { signal: AbortSignal; deadline: AbortSignal },
): Promise<Sent> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const request = http.request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
      signal: AbortSignal.any([signal, deadline]),
    });
    // A conexão pode cair antes da resposta ou no meio dela; o resultado da geração fica desconhecido.
    const fail = (error: Error) => {
      if (signal.aborted) return resolve({ ok: false, outcome: { status: "canceled" } });
      const message = deadline.aborted
        ? "O executor não respondeu dentro do prazo do backend; o resultado não foi recebido."
        : `A conexão com o executor caiu: ${error.message}`;
      resolve({ ok: false, outcome: { status: "interrupted", message } });
    };
    request.on("response", (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (text += chunk));
      response.on("error", fail);
      response.on("aborted", () => fail(new Error("resposta incompleta")));
      response.on("end", () => {
        if (!response.complete) return fail(new Error("resposta incompleta"));
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        resolve({ ok: true, response: { status: response.statusCode ?? 0, body: parsed } });
      });
    });
    request.on("error", fail);
    request.end(payload);
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function usageFrom(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  return {
    inputTokens: numberOrNull(value.inputTokens),
    outputTokens: numberOrNull(value.outputTokens),
    cacheCreationInputTokens: numberOrNull(value.cacheCreationInputTokens),
    cacheReadInputTokens: numberOrNull(value.cacheReadInputTokens),
    costUsd: numberOrNull(value.costUsd),
  };
}

// O executor só distingue "a CLI falhou"; limite de uso e autenticação são lidos da mensagem.
function cliFailureReason(reason: unknown, message: string): FailureReason {
  if (reason === "cli_unavailable" || reason === "invalid_output") return reason;
  if (/\b429\b|rate[_ ]?limit|usage limit/i.test(message)) return "cli_rate_limited";
  if (/\b401\b|invalid api key|\/login|not logged in|authenticat|oauth token/i.test(message)) return "cli_unauthenticated";
  return "cli_error";
}

function outcomeOf({ status, body }: Response): AssistantOutcome<string> {
  const executorError = (detail: string): AssistantOutcome<string> => ({
    status: "failed",
    reason: "executor_error",
    message: `O executor recusou a solicitação (${detail}).`,
    usage: null,
  });
  if (status !== 200 || !isRecord(body)) {
    const code = isRecord(body) && typeof body.error === "string" ? ` ${body.error}` : "";
    return executorError(`HTTP ${status}${code}`);
  }
  switch (body.status) {
    case "completed":
      if (typeof body.output !== "string") return executorError("resultado sem saída");
      return { status: "completed", result: body.output, usage: usageFrom(body.usage) };
    case "failed": {
      const error = isRecord(body.error) ? body.error : {};
      const message = typeof error.message === "string" ? error.message : "A CLI falhou.";
      return { status: "failed", reason: cliFailureReason(error.reason, message), message, usage: usageFrom(body.usage) };
    }
    case "timed_out":
      return { status: "timed_out" };
    case "canceled":
      return { status: "canceled" };
    default:
      return executorError("desfecho desconhecido");
  }
}

export function createExecutorAssistant({ url, token, deadlineMs }: ExecutorSettings): Assistant {
  async function generateText(prompt: string, { id, model, signal }: AttemptContext): Promise<AssistantOutcome<string>> {
    if (!token) {
      return {
        status: "failed",
        reason: "executor_unavailable",
        message: "PROBE_EXECUTOR_TOKEN não definida no backend; defina-a no .env.local e reinicie (make up).",
        usage: null,
      };
    }
    if (!(await isReachable(url))) {
      return {
        status: "failed",
        reason: "executor_unavailable",
        message: `O executor não respondeu em ${url}. Ele está rodando (make executor)?`,
        usage: null,
      };
    }
    const sent = await post(new URL("/generations", url), token, { id, operation: "generate_text", model, prompt }, {
      signal,
      deadline: AbortSignal.timeout(deadlineMs),
    });
    return sent.ok ? outcomeOf(sent.response) : sent.outcome;
  }

  // Gera o texto e o lê no formato da operação; o que não se lê nunca chega como concluído.
  async function generate<T>(
    prompt: string,
    parse: (output: string) => T | undefined,
    context: AttemptContext,
  ): Promise<AssistantOutcome<T>> {
    const outcome = await generateText(prompt, context);
    if (outcome.status !== "completed") return outcome;
    const result = parse(outcome.result);
    if (!result) {
      return {
        status: "failed",
        reason: "invalid_output",
        message: "A resposta da IA veio incompleta ou fora do formato esperado.",
        usage: outcome.usage,
      };
    }
    return { status: "completed", result, usage: outcome.usage };
  }

  return {
    cli: "claude",
    refineProblemStatement({ originalDescription }, context) {
      return generate(refinementPrompt(originalDescription), parseStatementProposal, context);
    },
    generateBlock(input, context) {
      const openKeys = input.openStagePoints.map((point) => point.key);
      return generate(blockPrompt(input), (output) => parseGeneratedBlock(output, openKeys), context);
    },
    testConnection(context) {
      // Qualquer resposta não vazia mostra que a CLI respondeu com o modelo pedido.
      return generate(CONNECTION_TEST_PROMPT, (output) => output.trim() || undefined, context);
    },
  };
}
