import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantOutcome } from "../src/modules/ai/assistant.ts";
import { FakeAssistant } from "./support/fake-assistant.ts";
import { processApi } from "./support/process-api.ts";
import { TEST_MODEL, createTestApp, resetDatabase, waitFor, type TestApp } from "./support/test-app.ts";

let assistant: FakeAssistant;
let testApp: TestApp;

beforeEach(async () => {
  assistant = new FakeAssistant();
  testApp = await createTestApp({ assistant });
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

const api = processApi(() => testApp);

const directoryProfile = { source: "directory" } as const;
const pessoal = { source: "explicit", name: "pessoal" } as const;

// Um modelo para cada CLI: assim a CLI de cada tentativa sai do modelo que ela registrou.
const models = { claude: "opus", codex: "gpt-6-astra", grok: "grok-4.7", agy: "gemini-3.6-flash-low" };

function saveSettings(payload: Record<string, unknown>) {
  return api.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { cli: "claude", models, cloakProfile: directoryProfile, ...payload },
  });
}

async function choose(cli: string, payload: Record<string, unknown> = {}) {
  const response = await saveSettings({ cli, ...payload });
  expect(response.statusCode).toBe(200);
}

const refinementUrl = (id: string) => `/api/processes/${id}/problem-statement/refinement`;

// Espera a última tentativa do refinamento sair de "running" e devolve as tentativas.
async function settledRefinement(id: string) {
  let attempts: Record<string, unknown>[] = [];
  await waitFor(async () => {
    const { refinement } = await api.getProcess(id);
    attempts = refinement.attempts;
    return refinement.status !== "running";
  });
  return attempts;
}

async function refine(id: string) {
  expect((await api.inject({ method: "POST", url: refinementUrl(id) })).statusCode).toBe(202);
  return settledRefinement(id);
}

function retryRefinement(id: string, payload?: Record<string, unknown>) {
  return api.inject({ method: "POST", url: `${refinementUrl(id)}/attempts`, ...(payload ? { payload } : {}) });
}

const failure: AssistantOutcome<never> = {
  status: "failed",
  reason: "cli_rate_limited",
  message: "429: Rate limit reached.",
  usage: null,
};

describe("CLI settings", () => {
  it("start with Claude Code, the backend's default model for it and no model chosen for the other CLIs", async () => {
    const response = await api.inject({ method: "GET", url: "/api/settings" });

    expect(response.json()).toEqual({
      settings: {
        cli: "claude",
        models: { claude: TEST_MODEL, codex: null, grok: null, agy: null },
        cloakProfile: directoryProfile,
      },
    });
  });

  it("keep the chosen CLI, a model for each CLI and the Cloak profile", async () => {
    const response = await saveSettings({ cli: "grok", cloakProfile: pessoal });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ settings: { cli: "grok", models, cloakProfile: pessoal } });
    expect((await api.inject({ method: "GET", url: "/api/settings" })).json()).toEqual({
      settings: { cli: "grok", models, cloakProfile: pessoal },
    });
  });

  it.each([
    ["a CLI that is not supported", { cli: "bash" }, "invalid_cli"],
    ["no CLI", { cli: undefined }, "invalid_cli"],
    ["no models", { models: undefined }, "invalid_model"],
    ["an invalid model for a CLI that is not chosen", { models: { ...models, grok: "--yolo" } }, "invalid_model"],
    ["no model for the chosen CLI", { cli: "agy", models: { ...models, agy: null } }, "model_required"],
  ])("refuse %s and keep the previous settings", async (_case, payload, error) => {
    await choose("codex");

    const response = await saveSettings(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect((await api.inject({ method: "GET", url: "/api/settings" })).json().settings.cli).toBe("codex");
  });

  it("accept no model for a CLI that is not chosen, Claude Code included", async () => {
    const response = await saveSettings({ cli: "codex", models: { ...models, claude: null, agy: null } });

    expect(response.statusCode).toBe(200);
    expect(response.json().settings.models).toEqual({ ...models, claude: null, agy: null });
  });
});

describe("each CLI", () => {
  it.each(["claude", "codex", "grok", "agy"] as const)(
    "%s is used, with its model and the Cloak profile, in new requests; earlier ones keep their record",
    async (cli) => {
      const earlier = await api.createProcess();
      await refine(earlier);

      await choose(cli, { cloakProfile: pessoal });
      const later = await api.createProcess();
      const attempts = await refine(later);

      expect(attempts).toMatchObject([{ cli, model: models[cli], cloakProfile: pessoal, status: "completed" }]);
      expect(assistant.refinement.attempts.at(-1)!.context).toMatchObject({ cli, model: models[cli], cloakProfile: pessoal });
      expect((await api.getProcess(earlier)).refinement.attempts).toMatchObject([
        { cli: "claude", model: TEST_MODEL, cloakProfile: directoryProfile },
      ]);
    },
  );

  it("is the one the connection test goes through", async () => {
    await choose("agy");

    const response = await api.inject({ method: "POST", url: "/api/settings/connection-test" });

    expect(response.json().connectionTest).toMatchObject({ cli: "agy", model: models.agy, status: "completed" });
    expect(assistant.connection.attempts[0]!.context).toMatchObject({ cli: "agy", model: models.agy });
  });
});

describe("after a failure", () => {
  it("no new attempt is opened by itself, with this CLI or another", async () => {
    await choose("codex");
    assistant.refinement.willRespond(failure);
    const id = await api.createProcess();

    const attempts = await refine(id);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(attempts).toMatchObject([{ cli: "codex", status: "failed", failureReason: "cli_rate_limited" }]);
    expect((await api.getProcess(id)).refinement.attempts).toHaveLength(1);
    expect(assistant.refinement.attempts).toHaveLength(1);
  });

  it("a new attempt without a choice keeps the failed attempt's CLI, even after the configured CLI changed", async () => {
    await choose("codex");
    assistant.refinement.willRespond(failure);
    const id = await api.createProcess();
    await refine(id);

    await choose("claude", { models: { ...models, codex: "gpt-6-astra-mini" } });
    expect((await retryRefinement(id)).statusCode).toBe(202);
    const attempts = await settledRefinement(id);

    // A CLI só muda pelo usuário; o modelo é o que a configuração tem agora para ela.
    expect(attempts).toMatchObject([
      { number: 1, cli: "codex", model: "gpt-6-astra", status: "failed" },
      { number: 2, cli: "codex", model: "gpt-6-astra-mini", status: "completed" },
    ]);
  });

  it("the user can choose another CLI for the new attempt of the same request", async () => {
    await choose("codex", { cloakProfile: pessoal });
    assistant.refinement.willRespond(failure);
    const id = await api.createProcess();
    await refine(id);

    const response = await retryRefinement(id, { cli: "grok" });

    expect(response.statusCode).toBe(202);
    const { refinement } = response.json();
    const attempts = await settledRefinement(id);
    expect(attempts).toMatchObject([
      { number: 1, cli: "codex", model: models.codex, cloakProfile: pessoal, status: "failed" },
      { number: 2, cli: "grok", model: models.grok, cloakProfile: pessoal, status: "completed" },
    ]);
    // A nova tentativa pertence à solicitação original, e a configuração continua como estava.
    expect((await api.getProcess(id)).refinement.id).toBe(refinement.id);
    expect(assistant.refinement.attempts.map((attempt) => attempt.context.cli)).toEqual(["codex", "grok"]);
    expect((await api.inject({ method: "GET", url: "/api/settings" })).json().settings.cli).toBe("codex");
  });

  it("refuses another CLI that has no model chosen, without opening an attempt", async () => {
    await choose("codex", { models: { ...models, agy: null } });
    assistant.refinement.willRespond(failure);
    const id = await api.createProcess();
    await refine(id);

    const response = await retryRefinement(id, { cli: "agy" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "cli_model_not_configured" });
    expect((await api.getProcess(id)).refinement.attempts).toHaveLength(1);
  });

  it.each([
    ["a CLI that is not supported", { cli: "bash" }],
    ["a CLI that is not text", { cli: 7 }],
  ])("refuses %s for the new attempt", async (_case, payload) => {
    assistant.refinement.willRespond(failure);
    const id = await api.createProcess();
    await refine(id);

    const response = await retryRefinement(id, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cli" });
    expect((await api.getProcess(id)).refinement.attempts).toHaveLength(1);
  });

  it("a Block request can be retried with another CLI", async () => {
    await choose("claude");
    assistant.block.willRespond(failure);
    const id = await api.createProcess();
    await api.confirmStatement(id);
    expect((await api.requestBlock(id)).statusCode).toBe(202);
    const failed = (await api.settledBlockRequest(id)).blockRequests.at(-1);

    const response = await api.inject({
      method: "POST",
      url: `/api/processes/${id}/block-requests/${failed.id}/attempts`,
      payload: { cli: "codex" },
    });

    expect(response.statusCode).toBe(202);
    const process = await api.settledBlockRequest(id);
    expect(process.blockRequests).toHaveLength(1);
    expect(process.blockRequests[0].attempts).toMatchObject([
      { cli: "claude", status: "failed" },
      { cli: "codex", model: models.codex, status: "completed" },
    ]);
    expect(process.blocks).toHaveLength(1);
  });

  it("a synthesis request can be retried with another CLI", async () => {
    await choose("grok");
    const { id, block } = await api.processWithAnsweredBlock();
    assistant.synthesis.willRespond(failure);
    expect((await api.requestSynthesis(id, block.id)).statusCode).toBe(202);
    const failed = (await api.settledSynthesis(id, block.id)).synthesisRequests.at(-1);

    const response = await api.inject({
      method: "POST",
      url: `/api/processes/${id}/blocks/${block.id}/synthesis-requests/${failed.id}/attempts`,
      payload: { cli: "agy" },
    });

    expect(response.statusCode).toBe(202);
    const settled = await api.settledSynthesis(id, block.id);
    expect(settled.synthesisRequests).toHaveLength(1);
    expect(settled.synthesisRequests[0].attempts).toMatchObject([
      { cli: "grok", status: "failed" },
      { cli: "agy", model: models.agy, status: "completed" },
    ]);
  });
});
