import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssistant, completed } from "./support/fake-assistant.ts";
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

async function getSettings(app = testApp) {
  const response = await app.app.inject({ method: "GET", url: "/api/settings" });
  expect(response.statusCode).toBe(200);
  return response.json();
}

const directoryProfile = { source: "directory" } as const;

// Sem perfil do Cloak no pedido, salva o do diretório: a escolha é sempre explícita no corpo.
function saveSettings(payload: Record<string, unknown>) {
  return testApp.app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { cloakProfile: directoryProfile, ...payload },
  });
}

async function createProcess(): Promise<string> {
  const response = await testApp.app.inject({
    method: "POST",
    url: "/api/processes",
    payload: { description: "Nosso deploy demora demais e o time perde a manhã." },
  });
  expect(response.statusCode).toBe(201);
  return response.json().process.id;
}

async function getProcess(id: string) {
  const response = await testApp.app.inject({ method: "GET", url: `/api/processes/${id}` });
  expect(response.statusCode).toBe(200);
  return response.json().process;
}

// Pede o refinamento e espera a tentativa sair de "running"; devolve as tentativas registradas.
async function refine(id: string, url = `/api/processes/${id}/problem-statement/refinement`) {
  const response = await testApp.app.inject({ method: "POST", url });
  expect(response.statusCode).toBe(202);
  let attempts: { model: string; cli: string; status: string }[] = [];
  await waitFor(async () => {
    const { refinement } = await getProcess(id);
    attempts = refinement.attempts;
    return refinement.status !== "running";
  });
  return attempts;
}

describe("settings", () => {
  it("start with the backend's default model for the claude and the directory's Cloak profile", async () => {
    expect(await getSettings()).toEqual({ settings: { claudeModel: TEST_MODEL, cloakProfile: directoryProfile } });
  });

  it("keep the chosen model in the database, across restarts of the backend", async () => {
    const response = await saveSettings({ claudeModel: "claude-opus-5-5" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ settings: { claudeModel: "claude-opus-5-5", cloakProfile: directoryProfile } });
    const restarted = await createTestApp();
    try {
      expect(await getSettings(restarted)).toEqual({
        settings: { claudeModel: "claude-opus-5-5", cloakProfile: directoryProfile },
      });
    } finally {
      await restarted.close();
    }
  });

  it("accept a new choice over the previous one", async () => {
    await saveSettings({ claudeModel: "opus" });
    await saveSettings({ claudeModel: "haiku" });

    expect(await getSettings()).toEqual({ settings: { claudeModel: "haiku", cloakProfile: directoryProfile } });
  });

  it.each([
    ["missing", {}],
    ["empty", { claudeModel: "" }],
    ["not text", { claudeModel: 5 }],
    ["read as a CLI option", { claudeModel: "--dangerously-skip-permissions" }],
    ["with spaces", { claudeModel: "sonnet opus" }],
  ])("refuse a model %s and keep the previous one", async (_case, payload) => {
    await saveSettings({ claudeModel: "opus" });

    const response = await saveSettings(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_model" });
    expect(await getSettings()).toEqual({ settings: { claudeModel: "opus", cloakProfile: directoryProfile } });
  });

  it("keep a Cloak profile chosen explicitly, and go back to the directory's", async () => {
    const explicit = await saveSettings({ claudeModel: "opus", cloakProfile: { source: "explicit", name: "pessoal" } });

    expect(explicit.statusCode).toBe(200);
    expect(await getSettings()).toEqual({
      settings: { claudeModel: "opus", cloakProfile: { source: "explicit", name: "pessoal" } },
    });

    await saveSettings({ claudeModel: "opus", cloakProfile: directoryProfile });
    expect(await getSettings()).toEqual({ settings: { claudeModel: "opus", cloakProfile: directoryProfile } });
  });

  it.each([
    ["missing", { cloakProfile: undefined }],
    ["of an unknown source", { cloakProfile: { source: "host" } }],
    ["explicit without a name", { cloakProfile: { source: "explicit" } }],
    ["read as a CLI option", { cloakProfile: { source: "explicit", name: "--profile" } }],
    ["with a path", { cloakProfile: { source: "explicit", name: "../pessoal" } }],
    ["with spaces", { cloakProfile: { source: "explicit", name: "meu perfil" } }],
  ])("refuse a Cloak profile %s and keep the previous settings", async (_case, payload) => {
    await saveSettings({ claudeModel: "opus", cloakProfile: { source: "explicit", name: "pessoal" } });

    const response = await saveSettings({ claudeModel: "haiku", ...payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cloak_profile" });
    expect(await getSettings()).toEqual({
      settings: { claudeModel: "opus", cloakProfile: { source: "explicit", name: "pessoal" } },
    });
  });

  it("send the chosen Cloak profile only in new requests; earlier ones keep the profile they used", async () => {
    const earlier = await createProcess();
    await refine(earlier);

    await saveSettings({ claudeModel: TEST_MODEL, cloakProfile: { source: "explicit", name: "pessoal" } });
    const later = await createProcess();
    const attempts = await refine(later);

    expect(attempts).toMatchObject([{ cloakProfile: { source: "explicit", name: "pessoal" }, status: "completed" }]);
    expect(assistant.refinement.attempts.map((attempt) => attempt.context.cloakProfile)).toEqual([
      directoryProfile,
      { source: "explicit", name: "pessoal" },
    ]);
    expect((await getProcess(earlier)).refinement.attempts).toMatchObject([{ cloakProfile: directoryProfile }]);
  });

  it("send the chosen model to the AI only in new requests; earlier ones keep the CLI and model they used", async () => {
    const earlier = await createProcess();
    await refine(earlier);

    await saveSettings({ claudeModel: "claude-opus-5-5" });
    const later = await createProcess();
    const attempts = await refine(later);

    expect(attempts).toMatchObject([{ cli: "claude", model: "claude-opus-5-5", status: "completed" }]);
    expect(assistant.refinement.attempts.map((attempt) => attempt.context.model)).toEqual([TEST_MODEL, "claude-opus-5-5"]);
    expect((await getProcess(earlier)).refinement.attempts).toMatchObject([{ cli: "claude", model: TEST_MODEL }]);
  });

  it("send the chosen model in a new attempt opened after the change, keeping the earlier attempt's record", async () => {
    assistant.refinement.willRespond({ status: "timed_out" });
    const id = await createProcess();
    await refine(id);

    await saveSettings({ claudeModel: "haiku" });
    const attempts = await refine(id, `/api/processes/${id}/problem-statement/refinement/attempts`);

    expect(attempts).toMatchObject([
      { number: 1, model: TEST_MODEL, status: "timed_out" },
      { number: 2, model: "haiku", status: "completed" },
    ]);
  });

  it("send the chosen model when asking for a Block", async () => {
    const id = await createProcess();
    await refine(id);
    const { refinement } = await getProcess(id);
    await testApp.app.inject({
      method: "POST",
      url: `/api/processes/${id}/problem-statement/confirmation`,
      payload: { statement: "O deploy é lento.", proposalId: refinement.proposal.id },
    });

    await saveSettings({ claudeModel: "opus" });
    const response = await testApp.app.inject({ method: "POST", url: `/api/processes/${id}/block-requests` });

    expect(response.statusCode).toBe(202);
    expect(response.json().blockRequest.attempts).toMatchObject([{ cli: "claude", model: "opus" }]);
  });

});

describe("connection test", () => {
  function testConnection() {
    return testApp.app.inject({ method: "POST", url: "/api/settings/connection-test" });
  }

  it("never happens just by opening the settings", async () => {
    await getSettings();

    expect(assistant.connection.attempts).toHaveLength(0);
  });

  it("asks the AI, through the executor, with the chosen model, and reports what the CLI used", async () => {
    const usage = { inputTokens: 12, outputTokens: 1, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: 0.0002 };
    assistant.connection.willRespond(completed("ok", usage));
    await saveSettings({ claudeModel: "haiku" });

    const response = await testConnection();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      connectionTest: {
        cli: "claude",
        model: "haiku",
        cloakProfile: directoryProfile,
        status: "completed",
        failureReason: null,
        message: null,
        usage,
      },
    });
    expect(assistant.connection.attempts).toHaveLength(1);
    expect(assistant.connection.attempts[0]!.context.model).toBe("haiku");
  });

  it("goes through the chosen Cloak profile", async () => {
    await saveSettings({ claudeModel: TEST_MODEL, cloakProfile: { source: "explicit", name: "pessoal" } });

    const response = await testConnection();

    expect(response.json().connectionTest).toMatchObject({ cloakProfile: { source: "explicit", name: "pessoal" } });
    expect(assistant.connection.attempts[0]!.context.cloakProfile).toEqual({ source: "explicit", name: "pessoal" });
  });

  it("reports why the connection failed", async () => {
    assistant.connection.willRespond({
      status: "failed",
      reason: "cloak_unauthenticated",
      message: "Not logged in · Please run /login",
      usage: null,
    });

    const response = await testConnection();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      connectionTest: {
        cli: "claude",
        model: TEST_MODEL,
        cloakProfile: directoryProfile,
        status: "failed",
        failureReason: "cloak_unauthenticated",
        message: "Not logged in · Please run /login",
        usage: null,
      },
    });
  });

  it.each([
    [{ status: "timed_out" } as const, null],
    [{ status: "interrupted", message: "A conexão com o executor caiu." } as const, "A conexão com o executor caiu."],
  ])("reports a connection that did not finish ($status)", async (outcome, message) => {
    assistant.connection.willRespond(outcome);

    const response = await testConnection();

    expect(response.json().connectionTest).toMatchObject({ status: outcome.status, failureReason: null, message, usage: null });
  });

  it("does not open a request in any Process", async () => {
    const id = await createProcess();

    await testConnection();

    expect((await getProcess(id)).refinement).toBeNull();
  });
});
