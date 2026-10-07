import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDatabase, type TestApp } from "./support/test-app.ts";

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

async function createProcess(description: string) {
  const response = await testApp.app.inject({
    method: "POST",
    url: "/api/processes",
    payload: { description },
  });
  expect(response.statusCode).toBe(201);
  return response.json().process;
}

describe("Process", () => {
  it("is reopened with the original description exactly as typed", async () => {
    const typed = "  Nosso deploy leva 40 minutos.\n\nO time perde a manhã esperando — e ninguém sabe por quê.  \n";
    const created = await createProcess(typed);

    const response = await testApp.app.inject({ method: "GET", url: `/api/processes/${created.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().process.originalDescription).toBe(typed);
  });

  it("is reopened after the backend restarts", async () => {
    const created = await createProcess("Decidir se reescrevemos o módulo de cobrança.");
    await testApp.close();
    testApp = await createTestApp();

    const response = await testApp.app.inject({ method: "GET", url: `/api/processes/${created.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().process).toMatchObject({
      originalDescription: "Decidir se reescrevemos o módulo de cobrança.",
      currentStage: "P",
      conversation: { id: created.conversation.id },
    });
  });

  it("starts open, in Stage P, with an empty Conversation", async () => {
    const created = await createProcess("Precisamos decidir onde hospedar o banco.");

    const response = await testApp.app.inject({ method: "GET", url: `/api/processes/${created.id}` });

    const { process } = response.json();
    expect(process.status).toBe("open");
    expect(process.currentStage).toBe("P");
    expect(process.conversation).toEqual({ id: expect.any(String) });
  });

  it("is listed with the existing Processes, most recent first", async () => {
    const first = await createProcess("Escolher fornecedor de e-mail.");
    const second = await createProcess("Migrar a fila de jobs.");

    const response = await testApp.app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(response.json().processes).toEqual([
      expect.objectContaining({
        id: second.id,
        originalDescription: "Migrar a fila de jobs.",
        status: "open",
        currentStage: "P",
      }),
      expect.objectContaining({ id: first.id, originalDescription: "Escolher fornecedor de e-mail." }),
    ]);
  });

  it.each([
    ["an empty description", { description: "" }],
    ["a blank description", { description: "  \n\t " }],
    ["a missing description", {}],
    ["a non-text description", { description: 42 }],
  ])("is not created from %s", async (_case, payload) => {
    const response = await testApp.app.inject({ method: "POST", url: "/api/processes", payload });

    expect(response.statusCode).toBe(400);
    const list = await testApp.app.inject({ method: "GET", url: "/api/processes" });
    expect(list.json().processes).toEqual([]);
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a malformed id", "not-a-process"],
  ])("cannot be reopened with %s", async (_case, id) => {
    const response = await testApp.app.inject({ method: "GET", url: `/api/processes/${id}` });

    expect(response.statusCode).toBe(404);
  });

  it("lists nothing when no Process exists", async () => {
    const response = await testApp.app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(response.json().processes).toEqual([]);
  });
});
