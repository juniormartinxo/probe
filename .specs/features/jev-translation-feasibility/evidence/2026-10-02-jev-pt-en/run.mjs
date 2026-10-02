// Experimento de 02/10/2026 que tirou a tradução local do estudo: os 12 casos relacionais da revisão 1
// enviados ao Jev real em PT-BR e em inglês (tradução humana do agente, não do TranslateGemma), com as
// mesmas rubricas e o mesmo corpo de requisição da bancada. Uma chamada por vez, ordem dos braços
// alternada por caso, 24 chamadas. Lê TYPESAFE_API_KEY e JEV_MODEL do ambiente e nunca imprime a chave.
// Uso: node run.mjs [saída.json]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJevBody } from '../../../../../src/ai-study/jev.mjs';
import { caseText } from '../../../../../src/ai-study/collect.mjs';
import { loadCorpus } from '../../../../../src/ai-study/corpus.mjs';
import { JEV_ENDPOINT } from '../../../../../src/ai-study/config.mjs';

const apiKey = process.env.TYPESAFE_API_KEY;
const model = process.env.JEV_MODEL;
if (!apiKey || !model) {
  console.error('Defina TYPESAFE_API_KEY e JEV_MODEL no ambiente.');
  process.exit(2);
}

const EN = {
  R01: {
    context: 'we are clarifying the budget for a hire in the same block as stage R. There is no other periodicity definition yet.',
    a: ['What is the available budget?', 'R$ 10,000.'],
    b: ['Is the budget stated in A monthly or only for implementation?', 'It is monthly; implementation will have a separate budget.'],
    change: 'replace the answer with “R$ 10,000 in total, exclusively for implementation”.',
  },
  R02: {
    context: 'there are two independent records: a deadline for recording a decision and a contractual date for delivering a report. There is no rule that calculates one deadline from the other. The questions belong to distinct planning blocks.',
    a: ['By when must the decision be recorded?', 'By October 10, 2026.'],
    b: ['By when must the report be delivered?', 'By October 30, 2026.'],
    change: 'move the recording of the decision up to October 8, 2026, keeping the contractual conditions of the delivery.',
  },
  R03: {
    context: 'the maximum deadline is mandatory and allows no exception. The integration is indispensable for the delivery; no substitute is available. Both deadlines are counted from today in calendar days.',
    a: ['What is the maximum deadline for delivery?', '14 calendar days.'],
    b: ['Can the chosen option deliver within the deadline in A?', 'Yes, it meets the deadline, although it depends on an integration that will only be available in 30 calendar days.'],
    change: 'extend the maximum deadline to 45 calendar days.',
  },
  R04: {
    context: 'we are defining, in the same block, what is acceptable in the initial operation.',
    a: ['Is automation mandatory from day one?', 'No. We prefer automation, but we allow manual operation during the first 30 days.'],
    b: ['Is a manual option during the first 15 days acceptable under the rule in A?', 'Yes, as long as it is automated after those 15 days.'],
    change: 'require automation from day one, with no manual period allowed.',
  },
  R05: {
    context: 'no exception or anonymization is allowed by the data rule. The option requires sending raw data to the vendor in order to work. We are checking this constraint in the current block.',
    a: ['Can we send the data to the vendor?', 'No, the data cannot leave our environment.'],
    b: ['Can we approve the option that requires this transfer while respecting A?', 'Yes, we approve the option with the mandatory transfer to the vendor.'],
    change: 'explicitly allow sending this data to the vendor.',
  },
  R06: {
    context: 'implementation and operation use independent budgets. There is no aggregate cap. The implementation amount neither generates nor determines monthly fees. The questions are in separate blocks for these budgets.',
    a: ['What is the planned one-time implementation expense?', 'R$ 8,000, paid only once.'],
    b: ['What is the monthly limit for operation?', 'R$ 2,000 per month, not including implementation.'],
    change: 'change the implementation to R$ 9,000, keeping the operation budget.',
  },
  R07: {
    context: 'the maintenance window and the color of an indicator are independent decisions. The color does not change behavior, alerts or operation. Each question is in its own work block.',
    a: ['When can the maintenance downtime occur?', 'On Sundays, from 2 a.m. to 3 a.m.'],
    b: ['What will be the color of the static indicator on the settings screen?', 'Blue.'],
    change: 'move the window to Sundays, from 3 a.m. to 4 a.m.',
  },
  R08: {
    context: 'question B was imported without the previous conversation. We do not know whether “that deadline” refers to the delivery in A or to another deadline discussed outside this record.',
    a: ['What is the deadline for the main delivery?', '14 calendar days, including acceptance testing.'],
    b: ['Does that deadline include acceptance testing?', 'No, acceptance testing is outside that deadline.'],
    change: 'change the main delivery to 21 calendar days, still including acceptance testing.',
  },
  R09: {
    context: 'we are negotiating, in the same block, a service target and the capacity of the option. The target in A is a provisional commitment, conditional on confirmation from B. B can only be accepted if it supports the target in A.',
    a: ['What service level can we promise with the option in B?', 'We propose 120 requests per minute, provided that B supports this volume.'],
    b: ['Does the capacity of the option support the target in A?', 'Yes. The option supports up to 150 requests per minute.'],
    change: 'increase the target to 180 requests per minute.',
  },
  R10: {
    context: 'A is a constraint already confirmed in stage R. We are in stage O evaluating alternatives. A revision of the limit must go back to the record of R; it is not a new budget question in the options block. There are no other costs.',
    a: ['What is the total hiring cap?', 'R$ 8,000.'],
    b: ['Does the R$ 6,000 option meet the cap recorded in A?', 'Yes, it does.'],
    change: 'reduce the total cap to R$ 5,000.',
  },
  R11: {
    context: 'both questions concern the same service, maintenance event and mandatory limit. They are not two distinct constraints. We are reviewing the questions in the availability block.',
    a: ['What is the maximum downtime per maintenance?', '15 minutes.'],
    b: ['For how many seconds can this service be unavailable during each maintenance?', '900 seconds.'],
    change: 'reduce the maximum time to 10 minutes.',
  },
  R12: {
    context: 'A was confirmed in stage O. We are now in stage E recording the fallback plan for the same option. The option will not be rediscussed in this block; a change in reversibility must be recorded in O and propagated to E.',
    a: ['Does the option allow returning to the previous system?', 'Yes, returning is possible within one day, preserving the data.'],
    b: ['What will the fallback plan be if three consecutive failures occur?', 'Return to the previous system within one day, preserving the data, using the reversibility confirmed in A.'],
    change: 'record that the migration is irreversible and does not allow returning to the previous system.',
  },
};

const enText = (c) => [
  `Context: ${c.context}`,
  `A — Question: ${c.a[0]} Answer: ${c.a[1]}`,
  `B — Question: ${c.b[0]} Answer: ${c.b[1]}`,
  `Proposed change to A: ${c.change}`,
].join('\n');

async function ask(text) {
  const started = Date.now();
  try {
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildJevBody({ model, text })),
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    if (!response.ok) return { error: `HTTP ${response.status}`, ms: Date.now() - started };
    return { ...JSON.parse(raw), ms: Date.now() - started };
  } catch (error) {
    return { error: error.name, ms: Date.now() - started };
  }
}

const { corpus } = await loadCorpus(fileURLToPath(new URL('../../../../../src/ai-study/corpus/revision-1.json', import.meta.url)));
const cases = Object.values(corpus).find((v) => Array.isArray(v) && v.some((x) => x?.id === 'R01'));
const results = [];
for (const [i, c] of cases.entries()) {
  const pt = caseText(c);
  const en = enText(EN[c.id]);
  let ptAnswer;
  let enAnswer;
  if (i % 2 === 0) {
    ptAnswer = await ask(pt);
    enAnswer = await ask(en);
  } else {
    enAnswer = await ask(en);
    ptAnswer = await ask(pt);
  }
  results.push({ id: c.id, expectations: c.expectations, pt: ptAnswer, en: enAnswer });
  process.stderr.write(`${c.id} ok\n`);
}
const out = process.argv[2] ?? fileURLToPath(new URL('results.json', import.meta.url));
writeFileSync(out, JSON.stringify(results, null, 2));

let hits = { pt: 0, en: 0 };
let same = 0;
let total = 0;
const models = new Set();
const rows = [];
for (const r of results) {
  models.add(r.pt.model ?? `PT ${r.pt.error}`);
  models.add(r.en.model ?? `EN ${r.en.error}`);
  for (const { judgment, expected } of r.expectations) {
    const p = r.pt.answers?.[judgment];
    const e = r.en.answers?.[judgment];
    total += 1;
    if (p?.choice === expected) hits.pt += 1;
    if (e?.choice === expected) hits.en += 1;
    if (p && e && p.choice === e.choice) same += 1;
    const fmt = (v) => (v ? `${v.choice} (${v.confidence.toFixed(2)})` : '-');
    const mark = (v) => (v?.choice === expected ? '' : ' ✗');
    rows.push(`| ${r.id} | ${judgment} | ${expected} | ${fmt(p)}${mark(p)} | ${fmt(e)}${mark(e)} | ${p && e ? (p.choice === e.choice ? 'sim' : '**NÃO**') : '-'} |`);
  }
}
console.log(`Modelos devolvidos: ${[...models].join(', ')}`);
console.log(`Acertos contra o gabarito: PT ${hits.pt}/${total}, EN ${hits.en}/${total}; escolhas iguais nos dois idiomas: ${same}/${total}`);
console.log('| Caso | Julgamento | Gabarito | PT-BR | EN | Igual? |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(row);
console.log(`Resultados brutos: ${out}`);
