// Respostas controladas: transportes e respostas identificados como `fixture`, nunca derivados de modelos.
export function createFixtureTransports() {
  return {
    local: {
      provenance: 'fixture',
      async translate({ item }) {
        return {
          provenance: 'fixture',
          model: 'fixture',
          output: `[fixture] tradução simulada de ${item.case_id} (${item.direction}); não é saída de modelo.`,
          finish_reason: 'stop',
          duration_ms: 0,
        };
      },
    },
    jev: {
      provenance: 'fixture',
      async evaluate({ judgments }) {
        return {
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
        };
      },
    },
  };
}
