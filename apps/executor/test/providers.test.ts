import { existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOKEN,
  claudeResult,
  createTestExecutor,
  createWorkDir,
  installFakeCli,
  installFakeCloak,
  removeTemporaryDirs,
  type Cli,
  type FakeCliBehavior,
} from "./support/test-executor.ts";

let executor: FastifyInstance | undefined;

afterEach(async () => {
  await executor?.close();
  executor = undefined;
  removeTemporaryDirs();
});

// O executor acha o `cloak` e a CLI falsos pelo PATH; o `cloak` chama a CLI.
function startExecutor(cli: Cli, behavior: FakeCliBehavior, options: { workDir?: string } = {}) {
  const fake = installFakeCli(cli, behavior);
  const cloak = installFakeCloak();
  executor = createTestExecutor({ pathDirs: [fake.dir, cloak.dir], ...options });
  return Object.assign(fake, { cloak });
}

const PROMPT = `Prazo: "duas semanas"; $(touch /tmp/probe-interpolado) && echo {"event":"x"}\n--model outro`;

function generate(cli: Cli, overrides: Record<string, unknown> = {}) {
  return executor!.inject({
    method: "POST",
    url: "/generations",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: {
      id: "solicitacao-1",
      operation: "generate_text",
      cli,
      model: "modelo-x",
      cloakProfile: null,
      prompt: PROMPT,
      ...overrides,
    },
  });
}

const jsonLines = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

// Saída de `codex exec --json`: eventos JSONL, a resposta no último `agent_message`.
function codexEvents(text: string, usage: Record<string, unknown> = {}) {
  return jsonLines(
    { type: "thread.started", thread_id: "t-1" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "item_0", type: "reasoning", text: "Pensando no deploy." } },
    { type: "item.completed", item: { id: "item_1", type: "agent_message", text } },
    { type: "turn.completed", usage },
  );
}

// Saída de `grok --output-format json`: um único objeto, a resposta em `text`.
function grokResult(text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ text, stopReason: "end_turn", sessionId: "s-1", requestId: "r-1", num_turns: 1, ...extra });
}

// Saída de `agy --output-format stream-json`: eventos NDJSON, o desfecho no evento `result`.
function agyEvents(result: Record<string, unknown>) {
  return jsonLines(
    { event: "init", conversation_id: "c-1", init: { model: "modelo-x" } },
    { event: "step_update", step_update: { step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "parcial" } },
    { event: "result", result: { conversation_id: "c-1", num_turns: 1, ...result } },
  );
}

const codexArgs = (model: string) => [
  "exec",
  "--json",
  "--model",
  model,
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--color",
  "never",
  "-",
];

const agyArgs = (model: string) => [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--model",
  model,
  "--disable-slash-commands",
  "--sandbox",
  "-p=",
];

describe("codex", () => {
  it("completes with the last agent message, the prompt on stdin and its own predefined arguments", async () => {
    const codex = startExecutor("codex", {
      stdout: codexEvents("O deploy leva 40 minutos.", {
        input_tokens: 16710,
        cached_input_tokens: 12288,
        cache_write_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 0,
      }),
    });

    const response = await generate("codex");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "completed",
      output: "O deploy leva 40 minutos.",
      // O codex conta as entradas lidas do cache dentro de input_tokens; aqui elas ficam à parte.
      usage: { inputTokens: 4422, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 12288, costUsd: null },
    });
    const invocation = codex.invocation()!;
    expect(invocation.stdin).toBe(PROMPT);
    expect(invocation.argv).toEqual(codexArgs("modelo-x"));
    expect(codex.cloak.invocations().map(({ argv }) => argv)).toEqual([["exec", "codex", ...codexArgs("modelo-x")]]);
  });

  it("is reported as failed with the message of the failed turn", async () => {
    startExecutor("codex", {
      stdout: jsonLines(
        { type: "thread.started", thread_id: "t-1" },
        { type: "turn.started" },
        {
          type: "error",
          message: '{"type":"error","status":429,"error":{"type":"rate_limit_error","message":"Rate limit reached."}}',
        },
        {
          type: "turn.failed",
          error: { message: '{"type":"error","status":429,"error":{"type":"rate_limit_error","message":"Rate limit reached."}}' },
        },
      ),
      exitCode: 1,
    });

    const response = await generate("codex");

    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "429: Rate limit reached." },
      usage: null,
    });
  });

  it("is reported as failed with what it wrote on stderr when it gives no event", async () => {
    startExecutor("codex", { stderr: "Error: not logged in\n", exitCode: 1 });

    const response = await generate("codex");

    expect(response.json()).toMatchObject({
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "Error: not logged in" },
    });
  });

  it("is reported as invalid output when the turn completes without an agent message", async () => {
    startExecutor("codex", {
      stdout: jsonLines({ type: "turn.started" }, { type: "turn.completed", usage: { output_tokens: 3 } }),
    });

    const response = await generate("codex");

    expect(response.json()).toMatchObject({
      status: "failed",
      error: { reason: "invalid_output", exitCode: 0 },
      usage: { outputTokens: 3, inputTokens: null },
    });
  });
});

describe("grok", () => {
  it("completes with the response text, the prompt in a file outside its working directory", async () => {
    const grok = startExecutor("grok", {
      stdout: grokResult("O deploy leva 40 minutos.", {
        usage: { input_tokens: 7210, cache_read_input_tokens: 41000, cache_creation_input_tokens: 0, output_tokens: 1893 },
        total_cost_usd: 0.0127,
      }),
    });

    const response = await generate("grok");

    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "completed",
      output: "O deploy leva 40 minutos.",
      usage: { inputTokens: 7210, outputTokens: 1893, cacheCreationInputTokens: 0, cacheReadInputTokens: 41000, costUsd: 0.0127 },
    });
    const invocation = grok.invocation()!;
    const promptFile = invocation.promptFile!;
    expect(promptFile.content).toBe(PROMPT);
    expect(invocation.argv).toEqual([
      "--prompt-file",
      promptFile.path,
      "--output-format",
      "json",
      "--model",
      "modelo-x",
      "--tools",
      "",
      "--disallowed-tools",
      "Agent",
      "--disable-web-search",
      "--no-subagents",
    ]);
    // O grok não lê o prompt do stdin, e o arquivo nunca fica no diretório de trabalho dele.
    expect(invocation.stdin).toBe("");
    expect(invocation.cwdEntries).toEqual([]);
    expect(path.dirname(promptFile.path)).not.toBe(invocation.cwd);
    expect(existsSync(promptFile.path)).toBe(false);
  });

  it("is reported as failed with the message of its error object", async () => {
    startExecutor("grok", {
      stdout: JSON.stringify({ type: "error", message: "Not signed in. To authenticate without a browser, run: grok login" }),
      stderr: "Error: Not signed in.\n",
      exitCode: 1,
    });

    const response = await generate("grok");

    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "Not signed in. To authenticate without a browser, run: grok login" },
      usage: null,
    });
  });

  it("keeps a missing usage as null, never zero", async () => {
    startExecutor("grok", { stdout: grokResult("ok", { usage_is_incomplete: true }) });

    const response = await generate("grok");

    expect(response.json()).toMatchObject({ status: "completed", output: "ok", usage: null });
  });
});

describe("agy", () => {
  it("completes with the result's response, the prompt as a stream-json message on stdin", async () => {
    const agy = startExecutor("agy", {
      stdout: agyEvents({
        status: "SUCCESS",
        response: "O deploy leva 40 minutos.\n",
        usage: { input_tokens: 4984, output_tokens: 1, thinking_tokens: 52, cache_read_tokens: 8137, total_tokens: 4985 },
      }),
    });

    const response = await generate("agy");

    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "completed",
      output: "O deploy leva 40 minutos.\n",
      // O raciocínio conta como saída, como nas outras CLIs.
      usage: { inputTokens: 4984, outputTokens: 53, cacheCreationInputTokens: null, cacheReadInputTokens: 8137, costUsd: null },
    });
    const invocation = agy.invocation()!;
    expect(invocation.argv).toEqual(agyArgs("modelo-x"));
    expect(invocation.stdin).toBe(`${JSON.stringify({ event: "user", message: { content: PROMPT } })}\n`);
    expect(agy.cloak.invocations().map(({ argv }) => argv)).toEqual([["exec", "agy", ...agyArgs("modelo-x")]]);
  });

  it("is reported as failed with the result's error, without usage when no turn ran", async () => {
    startExecutor("agy", {
      stdout: agyEvents({
        status: "ERROR",
        response: "",
        error: "model not available",
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
      }),
      stderr: "error: model not available\n",
      exitCode: 1,
    });

    const response = await generate("agy");

    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "failed",
      error: { reason: "cli_error", exitCode: 1, message: "model not available" },
      usage: null,
    });
  });

  it("is reported as invalid output without a result event, even if parts of the answer arrived", async () => {
    startExecutor("agy", {
      stdout: jsonLines({ event: "step_update", step_update: { state: "ACTIVE", text_delta: "parcial" } }),
    });

    const response = await generate("agy");

    expect(response.json()).toMatchObject({ status: "failed", error: { reason: "invalid_output", exitCode: 0 } });
  });
});

describe("every CLI", () => {
  it.each(["claude", "codex", "grok", "agy"] as const)(
    "%s runs through Cloak with the chosen profile, in an empty directory inside the work directory",
    async (cli) => {
      const workDir = createWorkDir("trabalho");
      const fake = startExecutor(cli, { stdout: claudeResult("ok") }, { workDir });

      await generate(cli, { cloakProfile: "pessoal" });

      const exec = fake.cloak.invocations().find(({ argv }) => argv[0] === "exec")!;
      expect(exec.argv.slice(0, 4)).toEqual(["exec", "--profile", "pessoal", cli]);
      const invocation = fake.invocation()!;
      expect(invocation.configDir).toBe(fake.cloak.configDirOf("pessoal", cli));
      expect(path.dirname(invocation.cwd)).toBe(workDir);
      expect(invocation.cwdEntries).toEqual([]);
      expect(existsSync(invocation.cwd)).toBe(false);
    },
  );

  it("reports a CLI that Cloak does not have configured as unavailable, with Cloak's explanation", async () => {
    const agy = installFakeCli("agy", { stdout: "" });
    const cloak = installFakeCloak({ clis: ["claude", "codex", "grok"] });
    executor = createTestExecutor({ pathDirs: [agy.dir, cloak.dir] });

    const response = await generate("agy");

    expect(response.json()).toEqual({
      id: "solicitacao-1",
      status: "failed",
      error: { reason: "cli_unavailable", exitCode: 1, message: "CLI 'agy' not configured in config.toml" },
      usage: null,
    });
    expect(agy.invocation()).toBeUndefined();
  });

  it.each(["codex", "grok", "agy"] as const)("reports %s as unavailable when it is not installed", async (cli) => {
    const cloak = installFakeCloak();
    executor = createTestExecutor({ pathDirs: [cloak.dir] });

    const response = await generate(cli);

    expect(response.json()).toMatchObject({ status: "failed", error: { reason: "cli_unavailable" }, usage: null });
  });

  it("does not read one CLI's output in another's format", async () => {
    // Uma saída válida do claude não é resultado do codex.
    startExecutor("codex", { stdout: claudeResult("ok") });

    const response = await generate("codex");

    expect(response.json()).toMatchObject({ status: "failed", error: { reason: "invalid_output" } });
  });
});
