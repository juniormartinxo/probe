import { extractText, getDocumentProxy } from "unpdf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAssessor } from "./support/fake-assessor.ts";
import { FakeAssistant, completed, defaultBlock } from "./support/fake-assistant.ts";
import { cache, costConstraint, description, firstStep, planB, processApi, runner, statement, successCriteria } from "./support/process-api.ts";
import { createTestApp, resetDatabase, type TestApp } from "./support/test-app.ts";

let testApp: TestApp;
let assistant: FakeAssistant;
let assessor: FakeAssessor;
const api = processApi(() => testApp);

beforeEach(async () => {
  assistant = new FakeAssistant();
  assessor = new FakeAssessor();
  testApp = await createTestApp({ assistant, assessor });
  await resetDatabase(testApp.db);
});

afterEach(async () => {
  await testApp.close();
});

const exportReport = (id: string, format: "md" | "pdf") => api.inject({ method: "GET", url: `/api/processes/${id}/report.${format}` });

const frozen = async (id: string) => (await api.inject({ method: "GET", url: `/api/processes/${id}/finalization` })).json().finalization;

async function markdownOf(id: string): Promise<string> {
  const response = await exportReport(id, "md");
  expect(response.statusCode).toBe(200);
  return response.body;
}

async function pdfTextOf(pdf: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
  return text;
}

// As seções do relatório, na ordem da tela.
const sections = [
  "Resumo da Decisão",
  "Problema",
  "Restrições",
  "Preferências",
  "Registro por Etapa",
  "Opções",
  "Suposições e esclarecimentos",
  "Comparação das Opções",
  "Escolha e justificativa",
  "Opções descartadas",
  "Plano de execução",
  "Histórico",
];

// Quantas vezes a IA e o Jev foram chamados até agora.
const aiCalls = () =>
  [assistant.refinement, assistant.block, assistant.synthesis, assistant.resolutionQuestion, assistant.options, assistant.recommendation, assistant.connection].reduce(
    (total, script) => total + script.attempts.length,
    0,
  ) +
  [assessor.inputs, assessor.impactInputs, assessor.conflictInputs, assessor.constraintImpactInputs, assessor.optionInputs, assessor.planInputs].reduce(
    (total, inputs) => total + inputs.length,
    0,
  );

describe("The Markdown export", () => {
  it("brings the content of the report on screen, in the same order", async () => {
    const { id } = await api.finalizedProcess();

    const response = await exportReport(id, "md");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="relatorio-[0-9a-f]{8}\.md"$/);
    const markdown = response.body;
    expect(markdown.startsWith("# Relatório da Decisão\n")).toBe(true);
    const positions = sections.map((section) => markdown.indexOf(`\n## ${section}\n`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    for (const text of [description, statement, costConstraint, "Manter o GitHub Actions", cache, runner, "Mais caro.", firstStep, successCriteria, planB]) {
      expect(markdown).toContain(text);
    }
  });

  it("records each Stage with its Points, Questions and answers, and the history", async () => {
    const { id } = await api.finalizedProcess();
    const { report } = await frozen(id);

    const markdown = await markdownOf(id);

    for (const stage of report.stages) {
      expect(markdown).toContain(`### Etapa ${stage.stage} · `);
      for (const point of stage.stagePoints) expect(markdown).toContain(point.name);
      for (const block of stage.blocks) {
        for (const question of block.questions) {
          expect(markdown).toContain(`${block.number}.${question.number} ${question.wording}`);
          if (question.answer) expect(markdown).toContain(question.answer);
        }
      }
    }
    // O histórico em tabela: estado, data, tipo, assunto e texto.
    expect(markdown).toContain("| Estado | Data | Tipo | Assunto | Texto |");
    expect(markdown.match(/^\| (válido|superado) \|/gm)).toHaveLength(report.history.length);
  });

  it("keeps the text of the Process from being read as Markdown", async () => {
    // A primeira Pergunta e a alternativa respondida trazem marcas de Markdown e quebras de linha.
    const [first, ...rest] = defaultBlock.questions;
    assistant.block.willRespond(
      completed({ questions: [{ ...first!, wording: "# A demora\n- é *o problema* | ou sintoma?", choices: ["É o problema | em si\n# sim", ...first!.choices.slice(1)] }, ...rest] }),
    );
    const { id } = await api.finalizedProcess();

    const markdown = await markdownOf(id);

    // Nenhuma linha do texto vira título ou item de lista, nem quebra uma linha da tabela.
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown).not.toMatch(/^\s*- é/m);
    expect(markdown).toContain("\\# A demora");
    expect(markdown).toContain("\\*o problema\\*");
    const historyRows = markdown.split("\n").filter((line) => /^\| (válido|superado) \|/.test(line));
    expect(historyRows.some((row) => row.includes("É o problema \\| em si<br>\\# sim"))).toBe(true);
    for (const row of historyRows) expect(row.split(/(?<!\\)\|/)).toHaveLength(7);
  });
});

describe("The PDF export", () => {
  it("has selectable text, with the headings, the tables and the page numbers", async () => {
    const { id } = await api.finalizedProcess();

    const response = await exportReport(id, "pdf");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="relatorio-[0-9a-f]{8}\.pdf"$/);
    const pdf = response.rawPayload;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await pdfTextOf(pdf);
    expect(text).toContain("Relatório da Decisão");
    const positions = sections.map((section) => text.indexOf(`${section}\n`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    for (const content of [statement, costConstraint, cache, firstStep, planB]) expect(text.replace(/\s+/g, " ")).toContain(content);
    expect(text).toContain("Estado Data Tipo Assunto Texto");
    expect(text).toMatch(/Página 1 de \d+/);
  });
});

describe("Exporting", () => {
  it("calls neither the AI nor Jev, and gives the same file twice", async () => {
    const { id } = await api.finalizedProcess();
    const before = aiCalls();

    const markdown = [await exportReport(id, "md"), await exportReport(id, "md")];
    const pdf = [await exportReport(id, "pdf"), await exportReport(id, "pdf")];

    expect(aiCalls()).toBe(before);
    expect(markdown[1]!.body).toBe(markdown[0]!.body);
    expect(Buffer.compare(pdf[1]!.rawPayload, pdf[0]!.rawPayload)).toBe(0);
  });

  it("changes neither the Decision nor the frozen report, and can be done again", async () => {
    const { id } = await api.finalizedProcess();
    const finalization = await frozen(id);
    const process = await api.getProcess(id);

    expect((await exportReport(id, "pdf")).statusCode).toBe(200);
    expect((await exportReport(id, "md")).statusCode).toBe(200);

    expect(await frozen(id)).toEqual(finalization);
    expect(await api.getProcess(id)).toEqual(process);
    expect((await exportReport(id, "pdf")).statusCode).toBe(200);
  });

  it("is refused for an open Process", async () => {
    const { id } = await api.processInStageE();

    for (const format of ["md", "pdf"] as const) {
      const response = await exportReport(id, format);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "process_not_finalized" });
    }
  });

  it("is refused for a Process that does not exist", async () => {
    const response = await exportReport("00000000-0000-4000-8000-000000000000", "md");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "process_not_found" });
  });
});
