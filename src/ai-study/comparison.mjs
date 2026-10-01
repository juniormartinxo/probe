import { JUDGMENT_IDS } from './corpus.mjs';
import { SCHEMA_VERSION } from './evidence.mjs';

export const ARMS = Object.freeze(['pt', 'en']);

// `insufficient` é uma escolha como as outras; só a falta de escolha válida é ausência.
export function compareChoice(choice, expected) {
  if (choice === null || choice === undefined) return 'absent';
  return choice === expected ? 'hit' : 'miss';
}

// Uma resposta inválida não contribui com nenhuma escolha, mesmo que parte dela pareça válida.
export function scoreEvaluation(evaluation, expectations) {
  const choices = new Map(
    evaluation?.status === 'valid' ? evaluation.results.map((r) => [r.judgment, r.choice]) : [],
  );
  return JUDGMENT_IDS.map((judgment) => {
    const expected = expectations.find((e) => e.judgment === judgment).expected;
    const choice = choices.get(judgment) ?? null;
    return { judgment, expected, choice, outcome: compareChoice(choice, expected) };
  });
}

// Par completo exige os dois braços válidos com a mesma referência, instruções, critérios e modelo Jev resolvido.
export function pairCase(caseId, records, reference) {
  const arms = Object.fromEntries(
    ARMS.map((arm) => [arm, records.find((r) => r.item.case_id === caseId && r.item.arm === arm) ?? null]),
  );
  const reasons = [];
  for (const arm of ARMS) {
    if (!arms[arm]) reasons.push(`${arm}_missing`);
    else if (arms[arm].evaluation.status !== 'valid') reasons.push(`${arm}_invalid`);
  }
  if (arms.pt && arms.en) {
    const [pt, en] = [arms.pt, arms.en];
    const sameReference = [pt, en].every(
      (r) => r.corpus_hash === reference.corpus_hash && r.gabarito_hash === reference.gabarito_hash,
    );
    if (!sameReference) reasons.push('reference_mismatch');
    if (pt.evaluation.instructions_hash !== en.evaluation.instructions_hash) reasons.push('instructions_mismatch');
    if (pt.evaluation.criteria_hash !== en.evaluation.criteria_hash) reasons.push('criteria_mismatch');
    if (!pt.evaluation.returned_model || !en.evaluation.returned_model) reasons.push('jev_model_unknown');
    else if (pt.evaluation.returned_model !== en.evaluation.returned_model) reasons.push('jev_model_mismatch');
  }
  return {
    case_id: caseId,
    status: reasons.length === 0 ? 'complete' : 'incomplete',
    reasons,
    arms: Object.fromEntries(ARMS.map((arm) => [arm, arms[arm]?.item.id ?? null])),
  };
}

function emptyCounts() {
  return Object.fromEntries(
    ARMS.map((arm) => [arm, Object.fromEntries(JUDGMENT_IDS.map((j) => [j, { hit: 0, miss: 0, absent: 0 }]))]),
  );
}

// Comparação da execução: resultados individuais sempre visíveis; o denominador pareado só conta pares completos.
export function buildComparison({ runId, corpus, reference, records }) {
  const evaluations = records.map((r) => ({
    item: r.item.id,
    case_id: r.item.case_id,
    arm: r.item.arm,
    status: r.evaluation.status,
    judgments: scoreEvaluation(
      r.evaluation,
      corpus.relational_cases.find((c) => c.id === r.item.case_id).expectations,
    ),
  }));
  const pairs = corpus.relational_cases.map((c) => pairCase(c.id, records, reference));
  const individual = emptyCounts();
  const paired = emptyCounts();
  const completeCases = new Set(pairs.filter((p) => p.status === 'complete').map((p) => p.case_id));
  for (const c of corpus.relational_cases) {
    for (const arm of ARMS) {
      const scored = evaluations.find((e) => e.case_id === c.id && e.arm === arm)?.judgments ?? scoreEvaluation(null, c.expectations);
      for (const { judgment, outcome } of scored) {
        individual[arm][judgment][outcome] += 1;
        if (completeCases.has(c.id)) paired[arm][judgment][outcome] += 1;
      }
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    corpus_hash: reference.corpus_hash,
    gabarito_hash: reference.gabarito_hash,
    evaluations,
    pairs,
    counts: {
      individual: { denominator: corpus.relational_cases.length, by_arm: individual },
      paired: { denominator: completeCases.size, cases: [...completeCases], by_arm: paired },
    },
  };
}
