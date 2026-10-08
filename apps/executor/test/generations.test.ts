import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOKEN,
  claudeResult,
  createTestExecutor,
  createWorkDir,
  installFakeClaude,
  installFakeCloak,
  removeTemporaryDirs,
  waitFor,
  type FakeClaudeBehavior,
} from "./support/test-executor.ts";

let executor: FastifyInstance | undefined;

afterEach(async () => {
  await executor?.close();
  executor = undefined;
  removeTemporaryDirs();
});

// O executor acha o `cloak` e o `claude` falsos pelo PATH; o `cloak` chama o `claude`.
function startExecutor(behavior: FakeClaudeBehavior, options: { timeoutMs?: number; workDir?: string } = {}) {
  const claude = installFakeClaude(behavior);
  const cloak = installFakeCloak();
  executor = createTestExecutor({ pathDirs: [claude.dir, cloak.dir], ...options });
  return Object.assign(claude, { cloak });
}

function generationRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "solicitacao-1",
    operation: "generate_text",
    model: "sonnet",
    cloakProfile: null,
    prompt: "Proponha um enunciado mais claro para o problema.",
    ...overrides,
  };
}

const claudeArgs = (model: string) => [
  "-p",
  "--output-format",
  "json",
  "--model",
  model,
  "--tools",
  "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--safe-mode",
];

function generate(payload: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return executor!.inject({ method: "POST", url: "/generations", payload: payload as object, headers });
}

describe("generation", () => {
  it("completes with the output captured from claude", async () => {
    startExecutor({ stdout: claudeResult("O deploy leva 40 minutos e bloqueia o time.") });

    const response = await generate(generationRequest());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "solicitacao-1",
      status: "completed",
      output: "O deploy leva 40 minutos e bloqueia o time.",
    });
  });

  it("hands the user's content to claude only on stdin, never as a shell command", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok") });
    const marker = path.join(claude.dir, "interpolado");
    const prompt = `Prazo: "duas semanas"; $(touch ${marker}) \`touch ${marker}\` && touch ${marker} | cat > ${marker}\n--tools Bash`;

    const response = await generate(generationRequest({ prompt, model: "claude-opus-5-5" }));

    expect(response.json().status).toBe("completed");
    const invocation = claude.invocation()!;
    expect(invocation.stdin).toBe(prompt);
    expect(invocation.argv).toEqual(claudeArgs("claude-opus-5-5"));
    expect(claude.cloak.invocations().map(({ argv }) => argv)).toEqual([["exec", "claude", ...claudeArgs("claude-opus-5-5")]]);
    expect(existsSync(marker)).toBe(false);
  });

  it("runs claude in an empty directory of its own, away from any project instructions", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok") });

    await generate(generationRequest());

    const { cwd, cwdEntries } = claude.invocation()!;
    expect(cwd).not.toBe(process.cwd());
    expect(cwdEntries).toEqual([]);
    expect(existsSync(cwd)).toBe(false);
  });
});

describe("failure", () => {
  it("is reported when claude exits with an error, with what it wrote on stderr", async () => {
    startExecutor({ stderr: "Error: Invalid API key · Please run /login\n", exitCode: 1 });

    const response = await generate(generationRequest());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "Error: Invalid API key · Please run /login" },
      usage: null,
    });
  });

  it("is reported when claude returns an error result, keeping the usage it reported", async () => {
    startExecutor({
      stdout: claudeResult("API Error: 429 rate_limit_error", { is_error: true, usage: { input_tokens: 10 } }),
      exitCode: 1,
    });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "API Error: 429 rate_limit_error" },
      usage: { inputTokens: 10, outputTokens: null },
    });
  });

  it("is reported when claude flags the result as an error even with exit code 0", async () => {
    startExecutor({ stdout: claudeResult("Prompt is too long", { is_error: true }) });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({
      status: "failed",
      error: { reason: "cli_error", exitCode: 0, message: "Prompt is too long" },
    });
  });

  it("is reported when claude's output is not the expected result", async () => {
    startExecutor({ stdout: "Olá! Como posso ajudar?" });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({ status: "failed", error: { reason: "invalid_output", exitCode: 0 } });
  });

  it("is reported when claude is killed by a signal", async () => {
    startExecutor({ killSignal: "SIGKILL" });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({
      status: "failed",
      error: { reason: "cli_error", exitCode: null, message: "claude foi encerrado pelo sinal SIGKILL." },
    });
  });

  it("is reported when claude is not installed", async () => {
    const cloak = installFakeCloak();
    executor = createTestExecutor({ pathDirs: [cloak.dir] });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({ status: "failed", error: { reason: "cli_unavailable" }, usage: null });
  });
});

describe("Cloak", () => {
  it("runs claude with the profile Cloak binds to the executor's work directory", async () => {
    const workDir = createWorkDir({ profile: "trabalho" });
    const claude = startExecutor({ stdout: claudeResult("ok") }, { workDir });

    const response = await generate(generationRequest({ cloakProfile: null }));

    expect(response.json().status).toBe("completed");
    const [exec] = claude.cloak.invocations();
    expect(exec).toMatchObject({ argv: ["exec", "claude", ...claudeArgs("sonnet")], profile: "trabalho" });
    const invocation = claude.invocation()!;
    expect(invocation.configDir).toBe(claude.cloak.configDirOf("trabalho"));
    // Cloak e claude rodam num diretório vazio próprio, dentro do diretório de trabalho.
    expect(exec!.cwd).toBe(invocation.cwd);
    expect(path.dirname(invocation.cwd)).toBe(workDir);
    expect(invocation.cwdEntries).toEqual([]);
    expect(existsSync(invocation.cwd)).toBe(false);
  });

  it("runs claude with the profile chosen explicitly, over the work directory's", async () => {
    const workDir = createWorkDir({ profile: "trabalho" });
    const claude = startExecutor({ stdout: claudeResult("ok") }, { workDir });

    const response = await generate(generationRequest({ cloakProfile: "pessoal" }));

    expect(response.json().status).toBe("completed");
    expect(claude.cloak.invocations().at(-1)).toMatchObject({
      argv: ["exec", "--profile", "pessoal", "claude", ...claudeArgs("sonnet")],
      profile: "pessoal",
    });
    expect(claude.invocation()!.configDir).toBe(claude.cloak.configDirOf("pessoal"));
  });

  it("reports a profile that does not exist as a Cloak failure, without running claude", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok") });

    const response = await generate(generationRequest({ cloakProfile: "inexistente" }));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "failed",
      error: {
        reason: "cloak_profile_not_found",
        exitCode: 1,
        message: `O perfil "inexistente" não foi encontrado no Cloak.\nprofile 'inexistente' does not exist`,
      },
      usage: null,
    });
    expect(claude.invocation()).toBeUndefined();
    // Nem chega ao `cloak exec`, que perguntaria pelo stdin (o prompt) se deve criar o perfil.
    expect(claude.cloak.invocations().map(({ argv }) => argv[0])).not.toContain("exec");
  });

  it("is reported as unavailable when cloak is not installed", async () => {
    const claude = installFakeClaude({ stdout: claudeResult("ok") });
    executor = createTestExecutor({ pathDirs: [claude.dir] });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({ status: "failed", error: { reason: "cloak_unavailable" }, usage: null });
    expect(claude.invocation()).toBeUndefined();
  });

  it("passes on claude's own failure when the profile is not logged in", async () => {
    startExecutor({ stderr: "Not logged in · Please run /login\n", exitCode: 1 });

    const response = await generate(generationRequest({ cloakProfile: "pessoal" }));

    expect(response.json()).toMatchObject({
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "Not logged in · Please run /login" },
    });
  });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("timeout", () => {
  it("stops claude and is reported as timed out, without partial output", async () => {
    const claude = startExecutor({ stdout: claudeResult("tarde demais"), delayMs: 30_000 }, { timeoutMs: 300 });

    const response = await generate(generationRequest());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "solicitacao-1", status: "timed_out", timeoutMs: 300 });
    expect(isRunning(claude.invocation()!.pid)).toBe(false);
  });
});

function cancel(id: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return executor!.inject({ method: "POST", url: `/generations/${id}/cancel`, headers });
}

describe("cancellation", () => {
  it("stops claude and the generation is reported as canceled", async () => {
    const claude = startExecutor({ stdout: claudeResult("tarde demais"), delayMs: 30_000 });
    const pending = generate(generationRequest());
    await waitFor(() => claude.invocation() !== undefined);

    const cancelResponse = await cancel("solicitacao-1");

    expect(cancelResponse.statusCode).toBe(202);
    const response = await pending;
    expect(response.json()).toEqual({ id: "solicitacao-1", status: "canceled" });
    expect(isRunning(claude.invocation()!.pid)).toBe(false);
  });

  it("is refused for a generation that is not running", async () => {
    startExecutor({ stdout: claudeResult("ok") });
    await generate(generationRequest());

    const response = await cancel("solicitacao-1");

    expect(response.statusCode).toBe(404);
  });

  it("requires the credential", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok"), delayMs: 500 });
    const pending = generate(generationRequest());
    await waitFor(() => claude.invocation() !== undefined);

    const response = await cancel("solicitacao-1", {});

    expect(response.statusCode).toBe(401);
    expect((await pending).json().status).toBe("completed");
  });

  it("happens when the backend drops the connection", async () => {
    const claude = startExecutor({ stdout: claudeResult("tarde demais"), delayMs: 30_000 });
    const address = await executor!.listen({ host: "127.0.0.1", port: 0 });
    const connection = new AbortController();
    const pending = fetch(`${address}/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(generationRequest()),
      signal: connection.signal,
    }).catch(() => undefined);
    await waitFor(() => claude.invocation() !== undefined);

    connection.abort();
    await pending;

    await waitFor(() => !isRunning(claude.invocation()!.pid));
  });
});

describe("request id", () => {
  it("cannot start a second generation while the first is running", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok"), delayMs: 300 });
    const first = generate(generationRequest());
    await waitFor(() => claude.invocation() !== undefined);

    const second = await generate(generationRequest({ prompt: "Outro pedido." }));

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "generation_in_progress" });
    expect((await first).json().status).toBe("completed");
    expect(claude.invocation()!.stdin).toBe(generationRequest().prompt);
  });

  it("is free again after a generation that could not even start", async () => {
    startExecutor({ stdout: claudeResult("ok") });
    const originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = path.join(tmpdir(), "probe-diretorio-que-nao-existe");
    let failed;
    try {
      failed = await generate(generationRequest());
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
    }

    const retry = await generate(generationRequest());

    expect(failed.statusCode).toBe(500);
    expect(retry.json()).toMatchObject({ id: "solicitacao-1", status: "completed" });
  });
});

describe("usage", () => {
  it("is passed on when claude reports it", async () => {
    startExecutor({
      stdout: claudeResult("ok", {
        total_cost_usd: 0.0123,
        usage: { input_tokens: 812, output_tokens: 95, cache_creation_input_tokens: 4096, cache_read_input_tokens: 0 },
      }),
    });

    const response = await generate(generationRequest());

    expect(response.json().usage).toEqual({
      inputTokens: 812,
      outputTokens: 95,
      cacheCreationInputTokens: 4096,
      cacheReadInputTokens: 0,
      costUsd: 0.0123,
    });
  });

  it("is null when claude does not report it", async () => {
    startExecutor({ stdout: claudeResult("ok") });

    const response = await generate(generationRequest());

    expect(response.json()).toMatchObject({ status: "completed", usage: null });
  });

  it("keeps each missing figure as null instead of zero", async () => {
    startExecutor({ stdout: claudeResult("ok", { usage: { output_tokens: 95, input_tokens: "?" } }) });

    const response = await generate(generationRequest());

    expect(response.json().usage).toEqual({
      inputTokens: null,
      outputTokens: 95,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
      costUsd: null,
    });
  });
});

describe("controlled arguments", () => {
  it.each([
    ["an operation that is not predefined", { operation: "run_command" }, "unknown_operation"],
    ["no operation", { operation: undefined }, "unknown_operation"],
    ["a model that looks like a flag", { model: "--dangerously-skip-permissions" }, "invalid_model"],
    ["a model with shell syntax", { model: "sonnet; rm -rf ~" }, "invalid_model"],
    ["no model", { model: undefined }, "invalid_model"],
    ["a Cloak profile that looks like a flag", { cloakProfile: "--profile" }, "invalid_cloak_profile"],
    ["a Cloak profile with a path", { cloakProfile: "../pessoal" }, "invalid_cloak_profile"],
    ["a Cloak profile with spaces", { cloakProfile: "meu perfil" }, "invalid_cloak_profile"],
    ["a Cloak profile that is not text", { cloakProfile: 7 }, "invalid_cloak_profile"],
    ["no Cloak profile, not even the directory's", { cloakProfile: undefined }, "invalid_cloak_profile"],
    ["a blank prompt", { prompt: " \n " }, "invalid_prompt"],
    ["a prompt that is not text", { prompt: 42 }, "invalid_prompt"],
    ["no request id", { id: undefined }, "invalid_id"],
    ["a request id with spaces", { id: "a b" }, "invalid_id"],
  ])("refuses %s, without calling claude", async (_case, overrides, error) => {
    const claude = startExecutor({ stdout: claudeResult("ok") });

    const response = await generate(generationRequest(overrides));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(claude.invocation()).toBeUndefined();
  });

  it("refuses a body that is not a generation request", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok") });

    const response = await generate(["generate_text"]);

    expect(response.statusCode).toBe(400);
    expect(claude.invocation()).toBeUndefined();
  });
});

describe("health", () => {
  it("answers without the credential, so the backend can check it is reachable", async () => {
    const claude = startExecutor({ stdout: claudeResult("ok") });

    const response = await executor!.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(claude.invocation()).toBeUndefined();
  });
});

describe("credential", () => {
  it.each([
    ["no credential", {}],
    ["a wrong credential", { authorization: `Bearer ${TOKEN}x` }],
    ["the credential without the Bearer scheme", { authorization: TOKEN }],
  ])("refuses a generation with %s, without calling claude", async (_case, headers) => {
    const claude = startExecutor({ stdout: claudeResult("ok") });

    const response = await generate(generationRequest(), headers);

    expect(response.statusCode).toBe(401);
    expect(claude.invocation()).toBeUndefined();
  });
});
