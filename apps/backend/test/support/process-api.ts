import type { InjectOptions } from "fastify";
import { expect } from "vitest";
import { waitFor, type TestApp } from "./test-app.ts";

export const description = "Nosso deploy demora demais e o time perde a manhã.";
export const statement = "O deploy leva 40 minutos e bloqueia o time durante a manhã.";

// Chamadas que o frontend faz, sobre um TestApp que pode ser trocado entre os testes.
export function processApi(current: () => TestApp) {
  const inject = (options: InjectOptions) => current().app.inject(options);

  async function getProcess(id: string) {
    const response = await inject({ method: "GET", url: `/api/processes/${id}` });
    expect(response.statusCode).toBe(200);
    return response.json().process;
  }

  async function createProcess(): Promise<string> {
    const response = await inject({ method: "POST", url: "/api/processes", payload: { description } });
    expect(response.statusCode).toBe(201);
    return response.json().process.id;
  }

  async function confirmStatement(id: string) {
    const response = await inject({
      method: "POST",
      url: `/api/processes/${id}/problem-statement/confirmation`,
      payload: { statement },
    });
    expect(response.statusCode).toBe(201);
  }

  const requestBlock = (id: string) => inject({ method: "POST", url: `/api/processes/${id}/block-requests` });

  // Espera a tentativa mais recente da última Solicitação de Bloco sair de "running".
  async function settledBlockRequest(id: string) {
    let process: Awaited<ReturnType<typeof getProcess>>;
    await waitFor(async () => {
      process = await getProcess(id);
      const request = process.blockRequests.at(-1);
      return request !== undefined && request.status !== "running";
    });
    return process!;
  }

  // Pede um Bloco e devolve o Bloco gerado.
  async function generateBlock(id: string) {
    expect((await requestBlock(id)).statusCode).toBe(202);
    const process = await settledBlockRequest(id);
    return process.blocks.at(-1);
  }

  const answer = (id: string, questionId: string, payload: Record<string, unknown>) =>
    inject({ method: "POST", url: `/api/processes/${id}/questions/${questionId}/answer/versions`, payload });

  const markUnknown = (id: string, questionId: string) =>
    inject({ method: "POST", url: `/api/processes/${id}/questions/${questionId}/unknown-information` });

  const requestSynthesis = (id: string, blockId: string) =>
    inject({ method: "POST", url: `/api/processes/${id}/blocks/${blockId}/synthesis-requests` });

  const newSynthesisAttempt = (id: string, blockId: string, requestId: string) =>
    inject({ method: "POST", url: `/api/processes/${id}/blocks/${blockId}/synthesis-requests/${requestId}/attempts` });

  const confirmSynthesis = (id: string, blockId: string, payload: Record<string, unknown>) =>
    inject({ method: "POST", url: `/api/processes/${id}/blocks/${blockId}/synthesis/confirmation`, payload });

  const declareInapplicable = (id: string, key: string, payload: Record<string, unknown>) =>
    inject({ method: "POST", url: `/api/processes/${id}/stage-points/${key}/inapplicability`, payload });

  async function blockOf(id: string, blockId: string) {
    return (await getProcess(id)).blocks.find((block: { id: string }) => block.id === blockId);
  }

  // Espera a última Solicitação de síntese do Bloco sair de "running" e devolve o Bloco.
  async function settledSynthesis(id: string, blockId: string) {
    let block: Awaited<ReturnType<typeof blockOf>>;
    await waitFor(async () => {
      block = await blockOf(id, blockId);
      const request = block.synthesisRequests.at(-1);
      return request !== undefined && request.status !== "running";
    });
    return block!;
  }

  // Responde todas as Perguntas do Bloco padrão do Assistant falso (alternativa única, múltipla e
  // texto livre, nessa ordem).
  async function answerAll(id: string, block: { questions: { id: string; answerType: string }[] }) {
    for (const question of block.questions) {
      const value = question.answerType === "free_text" ? { text: "A diretoria cobrou na última reunião." } : { selectedChoices: [0] };
      expect((await answer(id, question.id, { ...value, basedOnVersionId: null })).statusCode).toBe(201);
    }
  }

  // Processo com o primeiro Bloco gerado e todas as Perguntas respondidas.
  async function processWithAnsweredBlock() {
    const id = await createProcess();
    await confirmStatement(id);
    const block = await generateBlock(id);
    await answerAll(id, block);
    return { id, block };
  }

  // Pede a síntese do Bloco e devolve a proposta concluída.
  async function synthesize(id: string, blockId: string) {
    expect((await requestSynthesis(id, blockId)).statusCode).toBe(202);
    const block = await settledSynthesis(id, blockId);
    const proposal = block.synthesisRequests.at(-1).proposal;
    expect(proposal).not.toBeNull();
    return proposal;
  }

  return {
    inject,
    getProcess,
    createProcess,
    confirmStatement,
    requestBlock,
    settledBlockRequest,
    generateBlock,
    answer,
    markUnknown,
    requestSynthesis,
    newSynthesisAttempt,
    confirmSynthesis,
    declareInapplicable,
    blockOf,
    settledSynthesis,
    answerAll,
    processWithAnsweredBlock,
    synthesize,
  };
}
