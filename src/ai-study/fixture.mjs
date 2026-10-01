import { createCallBudget } from './calls.mjs';

// Respostas controladas: transportes e respostas identificados como `fixture`, nunca derivados de modelos.
// As chamadas simuladas também passam pelo orçamento da execução (AC 27), sem prazo: não há espera.
export function createFixtureTransports({ budget = createCallBudget() } = {}) {
  return {
    budget,
    local: {
      provenance: 'fixture',
      translate: ({ item }) =>
        budget.call('local', null, async () => ({
          provenance: 'fixture',
          model: 'fixture',
          output: `[fixture] tradução simulada de ${item.case_id} (${item.direction}); não é saída de modelo.`,
          finish_reason: 'stop',
          duration_ms: 0,
        })),
    },
    jev: {
      provenance: 'fixture',
      evaluate: ({ judgments }) =>
        budget.call('jev', null, async () => ({
          provenance: 'fixture',
          model: 'fixture',
          results: judgments.map((judgment) => ({
            judgment,
            type: 'choice',
            choice: 'insufficient',
            probabilities: { yes: 0.25, no: 0.25, insufficient: 0.5 },
            confidence: 0.5,
          })),
          usage: null,
          duration_ms: 0,
        })),
    },
  };
}
