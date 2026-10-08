import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { FakeAssistant, completed, defaultProposal } from "./support/fake-assistant.ts";
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

const description = "Nosso deploy demora demais e o time perde a manhã.";

async function createProcess(originalDescription = description): Promise<string> {
  const response = await testApp.app.inject({
    method: "POST",
    url: "/api/processes",
    payload: { description: originalDescription },
  });
  expect(response.statusCode).toBe(201);
  return response.json().process.id;
}

async function getProcess(id: string, app = testApp) {
  const response = await app.app.inject({ method: "GET", url: `/api/processes/${id}` });
  expect(response.statusCode).toBe(200);
  return response.json().process;
}

function requestRefinement(id: string) {
  return testApp.app.inject({ method: "POST", url: `/api/processes/${id}/problem-statement/refinement` });
}

// Espera a tentativa mais recente do refinamento sair de "running".
async function settledRefinement(id: string, app = testApp) {
  let process: Awaited<ReturnType<typeof getProcess>>;
  await waitFor(async () => {
    process = await getProcess(id, app);
    return process.refinement !== null && process.refinement.status !== "running";
  });
  return process!.refinement;
}

describe("refinement", () => {
  it("brings the AI's proposal, identified as a suggestion and not as the problem statement", async () => {
    const id = await createProcess();

    const response = await requestRefinement(id);

    expect(response.statusCode).toBe(202);
    expect(response.json().refinement.status).toBe("running");
    const refinement = await settledRefinement(id);
    expect(refinement).toMatchObject({
      status: "completed",
      proposal: {
        id: expect.any(String),
        statement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
        ambiguities: ["Não está claro se os 40 minutos incluem os testes."],
        missingInformation: ["Com que frequência o deploy é feito?"],
      },
    });
    expect(assistant.attempts[0]!.input).toEqual({ originalDescription: description });
    const process = await getProcess(id);
    expect(process.problemStatement).toBeNull();
    expect(process.originalDescription).toBe(description);
  });
});

function confirm(id: string, payload: Record<string, unknown>) {
  return testApp.app.inject({ method: "POST", url: `/api/processes/${id}/problem-statement/confirmation`, payload });
}

describe("confirmation", () => {
  it("makes the proposed statement the problem statement, keeping the original description", async () => {
    const id = await createProcess();
    await requestRefinement(id);
    const { proposal } = await settledRefinement(id);

    const response = await confirm(id, { statement: proposal.statement, proposalId: proposal.id });

    expect(response.statusCode).toBe(201);
    const process = await getProcess(id);
    expect(process.problemStatement).toEqual({
      statement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
      origin: "proposal",
      proposalId: proposal.id,
      confirmedAt: expect.any(String),
    });
    expect(process.originalDescription).toBe(description);
  });

  it("keeps the user's correction of the proposal, and the proposal as the AI made it", async () => {
    const id = await createProcess();
    await requestRefinement(id);
    const { proposal } = await settledRefinement(id);
    const corrected = "O deploy leva 40 minutos, incluindo os testes, e bloqueia o time de manhã.";

    const response = await confirm(id, { statement: corrected, proposalId: proposal.id });

    expect(response.statusCode).toBe(201);
    const process = await getProcess(id);
    expect(process.problemStatement).toMatchObject({ statement: corrected, origin: "corrected", proposalId: proposal.id });
    expect(process.refinement.proposal.statement).toBe("O deploy leva 40 minutos e bloqueia o time durante a manhã.");
    expect(process.originalDescription).toBe(description);
  });

  it("takes the proposal as accepted when only the surrounding whitespace differs", async () => {
    const id = await createProcess();
    await requestRefinement(id);
    const { proposal } = await settledRefinement(id);

    await confirm(id, { statement: `  ${proposal.statement}\n`, proposalId: proposal.id });

    expect((await getProcess(id)).problemStatement).toMatchObject({ statement: proposal.statement, origin: "proposal" });
  });

  it("accepts a statement the user wrote without any proposal", async () => {
    const id = await createProcess();

    const response = await confirm(id, { statement: "O deploy bloqueia o time de manhã." });

    expect(response.statusCode).toBe(201);
    expect((await getProcess(id)).problemStatement).toMatchObject({
      statement: "O deploy bloqueia o time de manhã.",
      origin: "written",
      proposalId: null,
    });
  });

  it("happens only once", async () => {
    const id = await createProcess();
    await confirm(id, { statement: "Primeiro enunciado." });

    const response = await confirm(id, { statement: "Segundo enunciado." });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "problem_statement_confirmed" });
    expect((await getProcess(id)).problemStatement.statement).toBe("Primeiro enunciado.");
  });

  it("is refused for a proposal that is not this Process's", async () => {
    const other = await createProcess("Outro problema.");
    await requestRefinement(other);
    const { proposal } = await settledRefinement(other);
    const id = await createProcess();

    const response = await confirm(id, { statement: proposal.statement, proposalId: proposal.id });

    expect(response.statusCode).toBe(422);
    expect((await getProcess(id)).problemStatement).toBeNull();
  });

  it.each([
    ["a blank statement", { statement: " \n " }],
    ["no statement", {}],
    ["a malformed proposal id", { statement: "Enunciado.", proposalId: "proposta" }],
  ])("is refused with %s", async (_case, payload) => {
    const id = await createProcess();

    const response = await confirm(id, payload);

    expect(response.statusCode).toBe(400);
    expect((await getProcess(id)).problemStatement).toBeNull();
  });

  it("does not report success when the database fails to save it", async () => {
    const id = await createProcess();
    await sql`create function probe_test_fail() returns trigger language plpgsql as
      $$ begin raise exception 'falha simulada do banco'; end $$`.execute(testApp.db);
    await sql`create trigger probe_test_fail before insert on problem_statements
      for each row execute function probe_test_fail()`.execute(testApp.db);
    let response;
    try {
      response = await confirm(id, { statement: "O deploy bloqueia o time de manhã." });
    } finally {
      await sql`drop trigger probe_test_fail on problem_statements`.execute(testApp.db);
      await sql`drop function probe_test_fail`.execute(testApp.db);
    }

    expect(response.statusCode).toBe(500);
    expect((await getProcess(id)).problemStatement).toBeNull();
  });
});

function newAttempt(id: string) {
  return testApp.app.inject({ method: "POST", url: `/api/processes/${id}/problem-statement/refinement/attempts` });
}

describe("AI request", () => {
  it("records the attempt with its CLI, model and the usage the CLI reported", async () => {
    const usage = { inputTokens: 812, outputTokens: 95, cacheCreationInputTokens: null, cacheReadInputTokens: 0, costUsd: 0.0123 };
    assistant.willRespond(completed(defaultProposal, usage));
    const id = await createProcess();

    await requestRefinement(id);

    const refinement = await settledRefinement(id);
    expect(refinement.attempts).toEqual([
      {
        id: refinement.proposal.id,
        number: 1,
        status: "completed",
        cli: "claude",
        model: TEST_MODEL,
        usage,
        failureReason: null,
        message: null,
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
      },
    ]);
    expect(assistant.attempts[0]!.context).toMatchObject({ id: refinement.proposal.id, model: TEST_MODEL });
  });

  it("keeps usage unknown, not zero, when the CLI does not report it", async () => {
    const id = await createProcess();

    await requestRefinement(id);

    expect((await settledRefinement(id)).attempts[0].usage).toBeNull();
  });

  it("cannot be requested twice for the same Process", async () => {
    const id = await createProcess();
    await requestRefinement(id);

    const response = await requestRefinement(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "refinement_already_requested" });
    await settledRefinement(id);
    expect(assistant.attempts).toHaveLength(1);
  });
});

describe("refinement request", () => {
  it("is refused once the problem statement is confirmed", async () => {
    const id = await createProcess();
    await confirm(id, { statement: "O deploy bloqueia o time de manhã." });

    const response = await requestRefinement(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "problem_statement_confirmed" });
    expect(assistant.attempts).toHaveLength(0);
  });

  it.each([
    ["an unknown Process", "00000000-0000-4000-8000-000000000000"],
    ["a malformed id", "not-a-process"],
  ])("is refused for %s", async (_case, id) => {
    const response = await requestRefinement(id);

    expect(response.statusCode).toBe(404);
    expect(assistant.attempts).toHaveLength(0);
  });
});

describe("CLI failure", () => {
  it.each([
    ["unavailable", "cli_unavailable", "spawn claude ENOENT"],
    ["rate limited", "cli_rate_limited", "API Error: 429 rate_limit_error"],
    ["not authenticated", "cli_unauthenticated", "Invalid API key · Please run /login"],
  ] as const)("when the CLI is %s, is reported and leaves the Process as it was", async (_case, reason, message) => {
    assistant.willRespond({ status: "failed", reason, message, usage: null });
    const id = await createProcess();

    await requestRefinement(id);

    const refinement = await settledRefinement(id);
    expect(refinement).toMatchObject({
      status: "failed",
      proposal: null,
      attempts: [{ number: 1, status: "failed", failureReason: reason, message }],
    });
    const process = await getProcess(id);
    expect(process.problemStatement).toBeNull();
    expect(process.originalDescription).toBe(description);
  });

  it("when the CLI times out, is reported as timed out", async () => {
    assistant.willRespond({ status: "timed_out" });
    const id = await createProcess();

    await requestRefinement(id);

    expect(await settledRefinement(id)).toMatchObject({ status: "timed_out", proposal: null });
  });

  it("accepts a new attempt of the same request", async () => {
    assistant.willRespond({ status: "timed_out" });
    const id = await createProcess();
    await requestRefinement(id);
    const failed = await settledRefinement(id);

    const response = await newAttempt(id);

    expect(response.statusCode).toBe(202);
    const refinement = await settledRefinement(id);
    expect(refinement).toMatchObject({ id: failed.id, status: "completed", proposal: { statement: defaultProposal.statement } });
    expect(refinement.attempts.map((attempt: { number: number; status: string }) => [attempt.number, attempt.status])).toEqual([
      [1, "timed_out"],
      [2, "completed"],
    ]);
    expect(refinement.proposal.id).toBe(refinement.attempts[1].id);
  });

  it("refuses a new attempt once a proposal was received, so it is never duplicated", async () => {
    const id = await createProcess();
    await requestRefinement(id);
    await settledRefinement(id);

    const response = await newAttempt(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "refinement_completed" });
    expect((await settledRefinement(id)).attempts).toHaveLength(1);
    expect(assistant.attempts).toHaveLength(1);
  });

  it("refuses a new attempt while an attempt is running", async () => {
    assistant.willHold();
    const id = await createProcess();
    await requestRefinement(id);

    const response = await newAttempt(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "attempt_in_progress" });
    expect(assistant.attempts).toHaveLength(1);
  });

  it("refuses a new attempt before a refinement was requested", async () => {
    const id = await createProcess();

    const response = await newAttempt(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "refinement_not_requested" });
  });

  it("refuses a new attempt once the problem statement is confirmed", async () => {
    assistant.willRespond({ status: "failed", reason: "cli_error", message: "erro", usage: null });
    const id = await createProcess();
    await requestRefinement(id);
    await settledRefinement(id);
    await confirm(id, { statement: "O deploy bloqueia o time de manhã." });

    const response = await newAttempt(id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "problem_statement_confirmed" });
  });
});

describe("interrupted request", () => {
  it("shows as interrupted after the backend shuts down mid-attempt, and is not sent again", async () => {
    assistant.willHold();
    const id = await createProcess();
    await requestRefinement(id);
    await waitFor(() => assistant.attempts.length === 1);

    await testApp.close();
    testApp = await createTestApp({ assistant });

    const process = await getProcess(id);
    expect(process.refinement).toMatchObject({
      status: "interrupted",
      proposal: null,
      attempts: [{ number: 1, status: "interrupted", message: expect.any(String), finishedAt: expect.any(String) }],
    });
    expect(assistant.attempts[0]!.context.signal.aborted).toBe(true);
    expect(assistant.attempts).toHaveLength(1);
  });

  it("shows as interrupted after the backend crashed mid-attempt, ignoring an answer that arrives later", async () => {
    assistant.willHold();
    const id = await createProcess();
    await requestRefinement(id);
    await waitFor(() => assistant.attempts.length === 1);
    const crashed = testApp;

    // Um backend novo sobe sem que o anterior tenha encerrado as suas tentativas.
    testApp = await createTestApp({ assistant: new FakeAssistant() });
    assistant.attempts[0]!.respond(completed());
    await crashed.close();

    const process = await getProcess(id);
    expect(process.refinement).toMatchObject({ status: "interrupted", proposal: null });
    expect(process.problemStatement).toBeNull();
  });

  it("accepts a new attempt of the same request", async () => {
    assistant.willHold();
    const id = await createProcess();
    await requestRefinement(id);
    await waitFor(() => assistant.attempts.length === 1);
    await testApp.close();
    testApp = await createTestApp({ assistant });

    const response = await newAttempt(id);

    expect(response.statusCode).toBe(202);
    const refinement = await settledRefinement(id);
    expect(refinement.status).toBe("completed");
    expect(refinement.attempts.map((attempt: { status: string }) => attempt.status)).toEqual(["interrupted", "completed"]);
  });
});

describe("result that cannot be saved", () => {
  it("leaves the attempt interrupted, open to a new one, instead of running forever", async () => {
    const id = await createProcess();
    await sql`create function probe_test_fail() returns trigger language plpgsql as
      $$ begin raise exception 'falha simulada do banco'; end $$`.execute(testApp.db);
    await sql`create trigger probe_test_fail before update on ai_request_attempts
      for each row when (new.status = 'completed') execute function probe_test_fail()`.execute(testApp.db);
    let refinement;
    try {
      await requestRefinement(id);
      refinement = await settledRefinement(id);
    } finally {
      await sql`drop trigger probe_test_fail on ai_request_attempts`.execute(testApp.db);
      await sql`drop function probe_test_fail`.execute(testApp.db);
    }

    expect(refinement).toMatchObject({
      status: "interrupted",
      proposal: null,
      attempts: [{ status: "interrupted", message: expect.any(String) }],
    });
    expect((await newAttempt(id)).statusCode).toBe(202);
  });
});

describe("late answer", () => {
  it("does not touch a problem statement the user confirmed while the AI was still working", async () => {
    assistant.willHold();
    const id = await createProcess();
    await requestRefinement(id);
    await waitFor(() => assistant.attempts.length === 1);
    await confirm(id, { statement: "O deploy bloqueia o time de manhã." });

    assistant.attempts[0]!.respond(completed());

    const refinement = await settledRefinement(id);
    expect(refinement).toMatchObject({
      status: "completed",
      proposal: { statement: defaultProposal.statement, arrivedAfterConfirmation: true },
    });
    expect((await getProcess(id)).problemStatement).toMatchObject({
      statement: "O deploy bloqueia o time de manhã.",
      origin: "written",
      proposalId: null,
    });
  });

  it("cannot be confirmed once the problem statement is established", async () => {
    assistant.willHold();
    const id = await createProcess();
    await requestRefinement(id);
    await waitFor(() => assistant.attempts.length === 1);
    await confirm(id, { statement: "O deploy bloqueia o time de manhã." });
    assistant.attempts[0]!.respond(completed());
    const { proposal } = await settledRefinement(id);

    const response = await confirm(id, { statement: proposal.statement, proposalId: proposal.id });

    expect(response.statusCode).toBe(409);
    expect((await getProcess(id)).problemStatement.statement).toBe("O deploy bloqueia o time de manhã.");
  });
});
