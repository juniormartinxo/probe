import { createCallBudget, httpError } from './calls.mjs';
import { canonicalJson, CHOICES, isObject, JUDGMENT_IDS, sha256 } from './corpus.mjs';

// Rubricas únicas em inglês para os dois braços: versão em inglês das rubricas da revisão 1 do corpus.
// O estado varia entre original e tradução; instruções e critérios nunca variam.
const PREAMBLE =
  'The state is a working note with question A and question B, each with its current answer, ' +
  'their context and a proposed change to A. Judge only from the explicit text; ' +
  'do not use outside knowledge to complete missing conditions.';

export const JEV_RUBRIC = Object.freeze({
  id: 'ai-study/jev-rubric-en@corpus-revision-1',
  instructions: Object.freeze({
    b_depends_on_a:
      'Is it necessary to consult A to interpret or evaluate answer B? ' +
      'Count dependence of meaning or validity of the answer, not mere chronological order or similar subject matter.',
    a_depends_on_b:
      'Is it necessary to consult B to interpret or evaluate answer A? ' +
      'Same rule, in the opposite direction. An independent constraint does not become dependent on an option ' +
      'merely because it can make that option infeasible.',
    complements:
      'Do the questions provide distinct information that, together, clarifies the same condition or its application? ' +
      'Repeating the same information is not complementing. Two independent axes of the project are not enough.',
    change_a_affects_b:
      'Does the proposed change to A require reassessing B? ' +
      'Consider the change as described, without inventing another one. ' +
      'Reassessing may confirm the previous answer; it does not require that answer to change.',
    same_block:
      'Is it useful to answer A and B together in the current block? ' +
      'Consider the working context provided. A reference to an already confirmed stage may require reassessment ' +
      'without merging the stages.',
    answers_conflict:
      'Are the current answers incompatible with the explicit conditions? ' +
      'Evaluate before the proposed change. A preference is not an obligation; ' +
      'different periodicities are not added together without an explicit rule.',
  }),
  criteria: Object.freeze({
    yes: 'The explicit text supports answering yes.',
    no: 'The explicit text supports answering no.',
    insufficient: 'The text lacks the information needed to distinguish yes from no.',
  }),
});

export function rubricRevision(rubric = JEV_RUBRIC) {
  return sha256(canonicalJson({ preamble: PREAMBLE, instructions: rubric.instructions, criteria: rubric.criteria }));
}

// Corpo HTTP completo de uma avaliação: o texto do braço é o estado; IDs do caso e do item ficam fora.
export function buildJevBody({ model, text, judgments = JUDGMENT_IDS, rubric = JEV_RUBRIC }) {
  const questions = {};
  for (const id of judgments) {
    questions[id] = { type: 'choice', instructions: `${PREAMBLE}\n\n${rubric.instructions[id]}`, criteria: { ...rubric.criteria } };
  }
  return { state: text, model, questions };
}

// Identificam o que foi efetivamente enviado, para conferir o par sem confiar na configuração.
export function questionHashes(body) {
  const pick = (field) =>
    Object.fromEntries(Object.entries(body.questions).map(([id, question]) => [id, question[field]]));
  return { instructions_hash: sha256(canonicalJson(pick('instructions'))), criteria_hash: sha256(canonicalJson(pick('criteria'))) };
}

// Probabilidades somam 1 a no máximo 0,000001; a folga cobre só o arredondamento de ponto flutuante.
const SUM_TOLERANCE = 0.000001;
const FLOAT_SLACK = 1e-12;

const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

// Aceita somente seis resultados choice válidos; nenhuma escolha é inferida de texto livre.
export function validateEvaluation(results, judgments = JUDGMENT_IDS) {
  if (!Array.isArray(results)) return ['resposta sem a lista de resultados'];
  const problems = [];
  const counts = new Map();
  for (const r of results) counts.set(r?.judgment, (counts.get(r?.judgment) ?? 0) + 1);
  for (const id of judgments) if (!counts.has(id)) problems.push(`ID ausente ${id}`);
  for (const [id, n] of counts) {
    if (!judgments.includes(id)) problems.push(`ID extra ${id}`);
    else if (n > 1) problems.push(`ID repetido ${id}`);
  }
  for (const r of results) {
    const label = `${r?.judgment}`;
    if (!isObject(r)) {
      problems.push(`${label}: resultado não é objeto`);
      continue;
    }
    if (r.type !== 'choice') problems.push(`${label}: tipo ${JSON.stringify(r.type ?? null)} não é choice`);
    if (!CHOICES.includes(r.choice)) problems.push(`${label}: escolha ${JSON.stringify(r.choice ?? null)} fora do domínio`);
    if (!isObject(r.probabilities)) {
      problems.push(`${label}: probabilidades ausentes`);
    } else {
      for (const key of Object.keys(r.probabilities)) if (!CHOICES.includes(key)) problems.push(`${label}: probabilidade extra ${key}`);
      const values = CHOICES.map((choice) => r.probabilities[choice]);
      CHOICES.forEach((choice, i) => {
        if (!isUnit(values[i])) problems.push(`${label}: probabilidade de ${choice} ausente, não finita ou fora de [0,1]`);
      });
      if (values.every(isUnit)) {
        const sum = values.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1) > SUM_TOLERANCE + FLOAT_SLACK) problems.push(`${label}: soma das probabilidades ${sum} fora da tolerância`);
      }
    }
    if (!isUnit(r.confidence)) problems.push(`${label}: confiança ausente, não finita ou fora de [0,1]`);
  }
  return problems;
}

// Registro de uma avaliação por caso e braço; resposta inválida fica sem escolhas, nunca inferidas.
export function evaluationRecord({ runId, item, body, response, judgments, durationMs }) {
  const problems = validateEvaluation(response.results, judgments);
  return {
    run_id: runId,
    case_id: item.case_id,
    arm: item.arm,
    requested_model: body.model,
    returned_model: response.model ?? null,
    rubric_id: JEV_RUBRIC.id,
    rubric_revision: rubricRevision(JEV_RUBRIC),
    ...questionHashes(body),
    status: problems.length === 0 ? 'valid' : 'invalid_response',
    problems,
    results:
      problems.length === 0
        ? response.results.map(({ judgment, choice, probabilities, confidence }) => ({ judgment, choice, probabilities, confidence }))
        : null,
    usage: usageInfo(response.usage),
    duration_ms: durationMs,
  };
}

const USAGE_UNAVAILABLE = 'o Jev não informou uso nesta chamada; ausência não é custo zero';

export function usageInfo(usage) {
  return usage === null || usage === undefined
    ? { available: false, justification: USAGE_UNAVAILABLE }
    : { available: true, value: usage };
}

// Transporte live do Jev: um POST por braço com as seis perguntas, sem SDK e sem retries.
// Cada avaliação é um único pedido HTTP contado no orçamento da execução, com o prazo Jev.
export function createJevTransport(config, { fetch = globalThis.fetch, budget = createCallBudget(config.limits) } = {}) {
  const { endpoint, apiKey, timeoutSeconds } = config.jev;
  return {
    provenance: 'live',
    evaluate: ({ body }) =>
      budget.call('jev', timeoutSeconds, async (signal) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal,
        });
        // O corpo de erro não é repetido: pode ecoar o pedido ou credenciais.
        if (!response.ok) throw httpError('Jev', response.status, 'na avaliação');
        const raw = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Corpo fora de JSON vira `invalid_response` registrada (AC 21); segredos são omitidos na gravação.
          return { provenance: 'live', model: null, results: null, usage: null, raw_body: raw };
        }
        return {
          provenance: 'live',
          model: typeof parsed?.model === 'string' ? parsed.model : null,
          results: isObject(parsed?.answers)
            ? Object.entries(parsed.answers).map(([judgment, answer]) =>
                isObject(answer) ? { ...answer, judgment } : { judgment, answer },
              )
            : null,
          usage: parsed?.usage ?? null,
        };
      }),
  };
}
