import type { Stage } from "./stage.ts";

// Ponto da etapa: item fixo que a Etapa precisa cobrir. A chave identifica o Ponto nas Perguntas
// e não muda entre versões da lista; o nome e a descrição podem ser ajustados numa versão nova.
export interface StagePoint {
  key: string;
  name: string;
  // O que o Ponto pede, dito para a IA formular Perguntas a seu serviço.
  description: string;
}

// A lista é mantida pela aplicação, não pela IA (ADR 0002). Ajustes vêm do uso e entram como uma
// versão nova; cada Processo segue a versão com que foi criado.
const lists: Record<number, Record<Stage, StagePoint[]>> = {
  1: {
    P: [
      {
        key: "real_problem",
        name: "Problema real versus sintoma",
        description: "Qual é o problema de fato e o que é apenas sintoma dele.",
      },
      {
        key: "consequence",
        name: "Consequência de não resolver",
        description: "O que acontece se o problema não for resolvido.",
      },
      {
        key: "urgency",
        name: "Motivo da urgência",
        description: "Por que o problema precisa ser resolvido agora.",
      },
    ],
    R: [
      { key: "deadline", name: "Prazo", description: "Até quando a solução precisa estar pronta, se houver prazo." },
      {
        key: "systems_and_apis",
        name: "Sistemas e APIs envolvidos",
        description: "Que sistemas, integrações e APIs a solução envolve, se algum.",
      },
      {
        key: "constraints_vs_preferences",
        name: "Restrições distinguidas das Preferências",
        description: "Quais condições são inegociáveis (Restrições) e quais são apenas desejáveis (Preferências).",
      },
    ],
    O: [
      {
        key: "eliminate_problem",
        name: "Possibilidade de eliminar o problema",
        description: "Se dá para fazer o problema deixar de existir em vez de resolvê-lo.",
      },
      {
        key: "simplest_solution",
        name: "Solução mais simples (inclusive manual)",
        description: "A solução mais simples possível, inclusive uma solução manual.",
      },
      {
        key: "eighty_twenty",
        name: "Alternativa 80/20",
        description: "Uma alternativa que entrega a maior parte do resultado com uma pequena parte do esforço.",
      },
      {
        key: "reversibility",
        name: "Reversibilidade",
        description: "O quanto cada Opção pode ser desfeita depois de adotada.",
      },
    ],
    B: [
      { key: "gains_and_losses", name: "Ganhos e perdas", description: "O que se ganha e o que se perde com cada Opção." },
      { key: "scalability", name: "Capacidade de escala", description: "Como cada Opção se comporta quando a demanda cresce." },
      { key: "maintenance", name: "Manutenção", description: "O esforço de manter cada Opção funcionando ao longo do tempo." },
      {
        key: "chosen_option_and_discards",
        name: "Escolha com os motivos dos descartes",
        description: "Qual Opção é escolhida e por que as outras foram descartadas.",
      },
    ],
    E: [
      { key: "first_step", name: "Primeiro passo concreto", description: "A primeira ação concreta para executar a Escolha." },
      {
        key: "success_criteria",
        name: "Como reconhecer sucesso",
        description: "Como saber, depois de executar, que a decisão deu certo.",
      },
      { key: "plan_b", name: "Plano B", description: "O que fazer se a Escolha não funcionar." },
    ],
  },
};

// Versão usada pelos Processos novos.
export const CURRENT_STAGE_POINTS_VERSION = 1;

export function stagePointsOf(version: number, stage: Stage): StagePoint[] {
  const list = lists[version];
  if (!list) throw new Error(`Lista de Pontos da etapa desconhecida: versão ${version}.`);
  return list[stage];
}

export function findStagePoint(version: number, stage: Stage, key: string): StagePoint | undefined {
  return stagePointsOf(version, stage).find((point) => point.key === key);
}
