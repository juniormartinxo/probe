import { readFileSync } from 'node:fs';

import { UsageError } from './errors.mjs';

// Respostas controladas: identificadas como `fixture` e nunca derivadas de modelos.
export function createFixtureTransports({ responses = {} } = {}) {
  return {
    local: {
      async translate({ item }) {
        return (
          responses[item.id] ?? {
            provenance: 'fixture',
            model: 'fixture',
            output: `[fixture] tradução simulada de ${item.case_id} (${item.direction}); não é saída de modelo.`,
            finish_reason: 'stop',
            duration_ms: 0,
          }
        );
      },
    },
    jev: {
      async evaluate({ item, judgments }) {
        return (
          responses[item.id] ?? {
            provenance: 'fixture',
            model: 'fixture',
            results: judgments.map((judgment) => ({
              judgment,
              choice: 'insufficient',
              probabilities: { yes: 0.25, no: 0.25, insufficient: 0.5 },
              confidence: 0.5,
            })),
            usage: null,
            duration_ms: 0,
          }
        );
      },
    },
  };
}

// Substitui respostas fixture por item; apoio de teste, não faz parte da assinatura publicada.
export function loadFixtureResponses(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed.responses === 'object' && !Array.isArray(parsed.responses)) return parsed.responses;
  } catch {
    // Cai no diagnóstico abaixo.
  }
  throw new UsageError('AI_STUDY_FIXTURE_RESPONSES inválido: esperado JSON com objeto "responses"');
}
