import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Generation } from "../src/modules/ai/assistant.ts";
import { createExecutorAssistant } from "../src/modules/ai/executor-assistant.ts";
import { waitFor } from "./support/test-app.ts";

const TOKEN = "credencial-de-teste-0123456789abcdef";
const description = "Nosso deploy demora demais e o time perde a manhã.";

type Handler = (request: FastifyRequest, reply: FastifyReply) => unknown;

let executor: FastifyInstance | undefined;

afterEach(async () => {
  await executor?.close();
  executor = undefined;
});

// Executor falso, no contrato HTTP do executor real: POST /generations devolve o desfecho.
async function startExecutor(handler: Handler): Promise<{ url: string; requests: FastifyRequest[] }> {
  const requests: FastifyRequest[] = [];
  executor = Fastify();
  executor.get("/health", async () => ({ status: "ok" }));
  executor.post("/generations", async (request, reply) => {
    requests.push(request);
    return handler(request, reply);
  });
  const url = await executor.listen({ host: "127.0.0.1", port: 0 });
  return { url, requests };
}

function generation(overrides: Partial<Generation> = {}): Generation {
  return { id: "tentativa-1", model: "sonnet", signal: new AbortController().signal, ...overrides };
}

const proposalJson = JSON.stringify({
  statement: "O deploy leva 40 minutos e bloqueia o time de manhã.",
  ambiguities: ["Os 40 minutos incluem os testes?"],
  missingInformation: ["Frequência dos deploys."],
});

function refine(url: string, overrides: Partial<Generation> = {}, token = TOKEN) {
  return createExecutorAssistant({ url, token }).refineProblemStatement(
    { originalDescription: description },
    generation(overrides),
  );
}

describe("refinement through the executor", () => {
  it("sends the predefined operation with the attempt id, the model, the description and the credential", async () => {
    const { url, requests } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output: proposalJson, usage: null }));

    await refine(url, { id: "tentativa-7", model: "claude-opus-5-5" });

    const [request] = requests;
    expect(request!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request!.body).toMatchObject({ id: "tentativa-7", operation: "generate_text", model: "claude-opus-5-5" });
    expect((request!.body as { prompt: string }).prompt).toContain(description);
  });

  it("brings the proposal and the usage the executor reported", async () => {
    const usage = { inputTokens: 812, outputTokens: 95, cacheCreationInputTokens: null, cacheReadInputTokens: 0, costUsd: 0.0123 };
    const { url } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output: proposalJson, usage }));

    const outcome = await refine(url);

    expect(outcome).toEqual({
      status: "completed",
      result: {
        statement: "O deploy leva 40 minutos e bloqueia o time de manhã.",
        ambiguities: ["Os 40 minutos incluem os testes?"],
        missingInformation: ["Frequência dos deploys."],
      },
      usage,
    });
  });

  it("accepts the JSON inside a Markdown code block", async () => {
    const { url } = await startExecutor(() => ({
      id: "tentativa-1",
      status: "completed",
      output: "```json\n" + proposalJson + "\n```",
      usage: null,
    }));

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "completed", result: { ambiguities: ["Os 40 minutos incluem os testes?"] } });
  });

  it.each([
    ["a truncated answer", proposalJson.slice(0, 60)],
    ["an answer without the statement", JSON.stringify({ ambiguities: [], missingInformation: [] })],
    ["a blank statement", JSON.stringify({ statement: " ", ambiguities: [], missingInformation: [] })],
    ["lists that are not of text", JSON.stringify({ statement: "Enunciado.", ambiguities: [1], missingInformation: [] })],
    ["prose instead of JSON", "Claro! O problema é que o deploy é lento."],
  ])("never takes %s as a completed proposal", async (_case, output) => {
    const usage = { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: null };
    const { url } = await startExecutor(() => ({ id: "tentativa-1", status: "completed", output, usage }));

    const outcome = await refine(url);

    expect(outcome).toEqual({ status: "failed", reason: "invalid_output", message: expect.any(String), usage });
  });
});

function failedWith(reason: string, message: string) {
  return () => ({ id: "tentativa-1", status: "failed", error: { reason, exitCode: 1, message }, usage: null });
}

describe("CLI failure reported by the executor", () => {
  it.each([
    ["claude is not installed", failedWith("cli_unavailable", "spawn claude ENOENT"), "cli_unavailable"],
    ["the usage limit is reached", failedWith("cli_error", "API Error: 429 rate_limit_error"), "cli_rate_limited"],
    ["claude is not logged in", failedWith("cli_error", "Invalid API key · Please run /login"), "cli_unauthenticated"],
    ["claude fails otherwise", failedWith("cli_error", "claude terminou com código 1."), "cli_error"],
    ["claude's output is unrecognizable", failedWith("invalid_output", "claude não devolveu um resultado."), "invalid_output"],
  ])("is reported when %s", async (_case, handler, reason) => {
    const { url } = await startExecutor(handler);

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason, message: expect.any(String) });
  });

  it("keeps the message and the usage the CLI reported", async () => {
    const usage = { inputTokens: 10, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: null };
    const { url } = await startExecutor(() => ({
      id: "tentativa-1",
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "API Error: 429 rate_limit_error" },
      usage,
    }));

    const outcome = await refine(url);

    expect(outcome).toEqual({ status: "failed", reason: "cli_rate_limited", message: "API Error: 429 rate_limit_error", usage });
  });

  it("is reported as timed out when the executor stopped claude for taking too long", async () => {
    const { url } = await startExecutor(() => ({ id: "tentativa-1", status: "timed_out", timeoutMs: 300_000 }));

    expect(await refine(url)).toEqual({ status: "timed_out" });
  });
});

describe("executor failure", () => {
  it("is reported as unavailable, without sending the generation, when the executor is not running", async () => {
    const { url } = await startExecutor(() => ({}));
    await executor!.close();
    executor = undefined;

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_unavailable", usage: null });
  });

  it("is reported as unavailable, without sending the generation, when the executor does not answer its health check", async () => {
    const requests: FastifyRequest[] = [];
    executor = Fastify();
    executor.get("/health", (_request, reply) => reply.code(503).send());
    executor.post("/generations", async (request) => requests.push(request));
    const url = await executor.listen({ host: "127.0.0.1", port: 0 });

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_unavailable" });
    expect(requests).toHaveLength(0);
  });

  it("is reported as unavailable when the backend has no credential for it", async () => {
    const { url, requests } = await startExecutor(() => ({}));

    const outcome = await refine(url, {}, "");

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_unavailable", message: expect.stringContaining("PROBE_EXECUTOR_TOKEN") });
    expect(requests).toHaveLength(0);
  });

  it("is reported when the executor refuses the request", async () => {
    const { url } = await startExecutor((_request, reply) => reply.code(401).send({ error: "credential_required" }));

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "failed", reason: "executor_error", message: expect.stringContaining("credential_required") });
  });

  it("is reported as interrupted when the executor drops the connection mid-generation", async () => {
    const { url } = await startExecutor((request) => {
      request.raw.socket.destroy();
      return new Promise(() => {});
    });

    const outcome = await refine(url);

    expect(outcome).toMatchObject({ status: "interrupted", message: expect.any(String) });
  });
});

describe("cancellation", () => {
  it("drops the connection, so the executor stops claude, and reports the generation as canceled", async () => {
    let connectionClosed = false;
    const { url, requests } = await startExecutor((request) => {
      request.raw.socket.on("close", () => (connectionClosed = true));
      return new Promise(() => {});
    });
    const cancellation = new AbortController();
    const pending = refine(url, { signal: cancellation.signal });
    await waitFor(() => requests.length === 1);

    cancellation.abort();

    expect(await pending).toEqual({ status: "canceled" });
    await waitFor(() => connectionClosed);
  });
});
