# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: f7f8ee4..1d46c87 (`e659efa` `.env.local` no `.gitignore`; `f5d5829` remoção da tradução local do estudo; `1d46c87` limitação das rubricas no plano). HEAD = `1d46c87`, confirmado com `git rev-parse HEAD` → `1d46c878c7917d289c722636db8f3ed49f87252f`. A feature inteira é `4a1acfe..1d46c87`. As Rounds 1–6 cobriram `4a1acfe..b2520fe`, `42f101e..c23dddc`, `838012d..5f310f9`, `4dacc6b..b5f0668`, `d6440be..580258d` e `3416c78..0893f6f`.
**Round**: 7 - scoped (autorizada pelo usuário em 02/10/2026 ao escolher a opção "registrar o experimento", que previa "a PRB-7 fecha numa reverificação")
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação, das correções nem da emenda; os relatórios anteriores serviram só para delimitar o escopo e para a lista de mutações, nunca como prova

Escopo desta rodada: o diff `f7f8ee4..1d46c87` inteiro e **todos os 56 checks** de `checks.md` como estão agora. As provas dos 56 rodaram de novo em `1d46c87`. O diff tocou `tests/ai-study/s5-report.test.mjs` (C49 ganhou `:517`; o teste de apoio dos verificadores foi renomeado) e só comentários em `src/ai-study/report.mjs` e `report-text.mjs` (`git diff f7f8ee4..1d46c87 -- src`: 4 linhas, todas de comentário). Por isso C49 foi julgado de novo, e as citações de C41–C58 foram conferidas no arquivo atual. Os julgamentos de C1–C40, C52, C53 e C55 são **carregados** de `b2520fe`: os arquivos `s1-*`, `s2-*`, `s3-*` e `s4-*` não mudaram.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas e das mutações. As mutações rodaram em dois worktrees `git worktree add --detach` descartáveis em `1d46c87`, no scratchpad, ambos removidos ao final (`git worktree list` mostra só o checkout principal e `prb-7`). Não chamei Jev, LM Studio, nenhum modelo nem nenhum serviço real. Não procurei nem imprimi a chave real. Consulta externa, só de leitura: os cards PRB-8 e PRB-11 no tracker.

**Resultado em uma linha:** 56 de 56 checks provados, com teste nomeado executado em `1d46c87` e asserção localizada, e sem lacuna de cobertura deixada pela remoção de C50, C51 e C59. A emenda tem decisão do usuário registrada, e os números do experimento batem com `results.json` e com o gabarito. A nova asserção de C49 mata três mutações da linha de proveniência. **O veredicto é FAIL por um único motivo:** os cinco mutantes sobreviventes da Round 6 na superfície de C42/C43 (N9, N12, E2, E4, N3) **continuam vivos em `1d46c87`**, reconfirmados nesta rodada. As Rounds 4–6 os julgaram não bloqueantes, mas o harness classifica mutante sobrevivente como falha da feature (`verify.md`, "What fails the feature"), e o gate recusa um PASS com uma linha `Killed: no`. Não reclassifico nem omito essas linhas para caber num PASS. Ver "Lacunas".

## Emenda de 02/10/2026 (remoção de C50, C51 e C59)

Verified at 1d46c87.

### Decisão registrada

A remoção tem decisão do usuário registrada nos três artefatos, com data, motivo e consequências. Não é afrouxamento silencioso.

- `plan.md:5` - "**Decisão de 02/10/2026 (usuário): a tradução local saiu do estudo.**", com o experimento, os números e a evidência. `plan.md:7` lista as consequências: C50, C51 e C59 removidos, emenda à AC 27 revogada, *Independent tests* reais de S2/S3 cumpridos pelo experimento, e "**o modo live não foi validado contra serviços reais**".
- `plan.md:138` (S2) e `plan.md:160` (S3): os *Independent tests* ganharam emenda explícita. `plan.md:178`: a emenda à AC 27 está marcada "Revogada em 02/10/2026"; `plan.md:170` (AC 27) ficou idêntica ao texto anterior (`git show f7f8ee4:…/plan.md`, linha 166). `plan.md:220`: linha nova em Fora de escopo. `plan.md:239`: os pré-requisitos 1–3 foram atualizados.
- `checks.md:6` e `checks.md:8`: contagem 56 e a frase "Em 02/10/2026, por decisão do usuário, a tradução local saiu do estudo: C50, C51 e C59 foram removidos".
- `.specs/STATE.md:31-33`: Next step e Blockers com a decisão e "Cards PRB-8 a PRB-11 cancelados".
- Tracker, só leitura: PRB-8 e PRB-11 estão na coluna 65, com `statusSince` 2026-10-02T15:23:42Z, o mesmo instante para os dois. Isso é consistente com o cancelamento, mas não consultei o `stateType` da coluna.
- Atribuição: os três commits saem de `Junior Martins`, a mesma conta usada por agentes (mesma ressalva da Observação 4). A autoria humana da decisão vem da declaração registrada, não da conta.

### Cobertura: o que dependia de C50, C51 e C59

Comparei a tabela Coverage, o Swept e as ACs antes e depois (`git diff f7f8ee4..1d46c87 -- …/checks.md`). Nenhum membro ficou sem check.

| Onde | Antes | Agora (`checks.md`) | Situação |
| --- | --- | --- | --- |
| AC 27 | C31 C59 | `:260` C31 | AC 27 voltou ao texto original (`plan.md:170`: 20 locais, 24 Jev, falhas, sem retry), que C31 cobre por inteiro (`checks.md:153`). A parte de C59 era a emenda, que foi revogada |
| Comandos publicados: `ai-study-run MODE=live` | C34 C50 C51 C52 C53 | `:264` C34 C52 C53 | coberto por serviços controlados |
| Modos: `live` | C4 C50 C51 | `:268` C4 | C4 prova a aceitação do modo |
| Corpus T (6) | C6 C50 | `:274` C6 | coberto |
| Direções de tradução (2) | C13 C50/C51 | `:277` C13 | coberto por transportes controlados |
| Chamadas (6 edges) | +18/19 contagens (C59) | `:288` 4 edges, C31 | os dois edges saíram junto com o orçamento revogado; o tamanho declarado caiu de 6 para 4 |
| Proveniência no relatório: live identificado | C50 C51 | `:300` C49 | **nova prova**: `s5-report.test.mjs:517` (ver abaixo). Ressalva de precisão na Observação 9 |
| Swept validation / authorization | …C59 | `:306`, `:309` | os outros checks da linha continuam |
| Swept dependency failure | "simulação não fecha C50 C51" | `:312` | a frase saiu, e os checks continuam |
| *Independent tests* S2 e S3 | C50 / C51 | `plan.md:138`, `:161` | remoção registrada como emenda: a parte real fica no experimento, e a parte controlada continua nos checks |

`make checks-validate` → `0 error(s), 0 warning(s)`, e `make plan-validate` → `0 error(s), 0 warning(s)`. Os dois validam estrutura: o tamanho declarado de cada linha bate com os membros.

Resíduos de texto que ainda citam os checks removidos, sem efeito na cobertura (Observação 10): `checks.md:302` ("C50–C51 não exigem concordância perfeita…") e `STATE.md:17`, `:19` e `:70` (ainda dizem que C50/C51/C59 estão pendentes). O `STATE.md:33` declara histórico só para as Decisões 1–4 e para as condições de entrada.

### Nova asserção de C49 (proveniência live)

`s5-report.test.mjs:517` - `assert.match(live.markdown, /^- Modo e proveniência: \`live\` \/ \`live\`$/m)`, sobre o relatório de uma coleta live com serviços controlados (`:514-515`). A linha vem de `src/ai-study/report.mjs:198` (`text('configMode', …)`).

Mutações em worktree descartável, uma de cada vez, desfeitas com `git checkout -- src tests` (porcelain do worktree vazio antes de cada uma). Prova mais estreita: `node --test --test-isolation=none --test-reporter=tap --test-name-pattern='^C49:' tests/ai-study/s5-report.test.mjs`. Linha de base: `ok 1 - C49`, exit 0.

| Mutação | Local | Resultado |
| --- | --- | --- |
| P1 `provenance: code(manifest.provenance)` → `code('fixture')` | `report.mjs:198` | morta: `not ok 1 - C49`, exit 1, em `:517`: "did not match … Input: '- Modo e proveniência: \`live\` / \`fixture\`'" |
| P2 sufixo `(simulado)` sempre, mesmo no live | `report.mjs:198` | morta: exit 1 |
| P2b P2 + remover `:517` do teste (controle) | idem + `s5-report.test.mjs:517` | sobrevive: exit 0. Sem `:517`, nada no teste pega a mutação, então a linha nova é o que mata |
| P3 `mode: code(manifest.mode)` → `code('fixture')` | `report.mjs:198` | morta: exit 1 |
| P3b P3 + remover `:517` (controle) | idem | sobrevive: exit 0 |

A asserção nova pega o que diz pegar. Antes dela, o relatório live só era checado pela ausência da faixa "Resultados simulados" (`:516`).

### Evidência do experimento

`evidence/2026-10-02-jev-pt-en/run.mjs` e `results.json`:

- **Segredos.** `run.mjs` lê a chave de `process.env.TYPESAFE_API_KEY` (`run.mjs:13`) e só a interpola no cabeçalho (`run.mjs:107`, `` authorization: `Bearer ${apiKey}` ``). Não grava nem imprime a chave. Em `results.json`, a busca por `bearer\s+\S+`, `sk-[A-Za-z0-9]{8,}`, `api[_-]?key\s*[:=]` e qualquer sequência alfanumérica de 32+ caracteres não achou nada. Os únicos acertos de `token` são `input_tokens`/`output_tokens` de `usage`. Cada resposta tem só `answers`, `model`, `ms` e `usage`.
- **Números, recalculados por mim** a partir de `results.json` e de `src/ai-study/corpus/revision-1.json`. As `expectations` gravadas nos 12 casos são idênticas ao gabarito da revisão 1.
  - 12 casos (R01–R12), 24 respostas, nenhuma com `error`, todas com `model` = `jev-1.13.0`.
  - Escolhas iguais: **68/72**. Acertos PT **63/72**, EN **66/72**. Sem R08: PT **63/66**, EN **64/66**. Todos batem com `plan.md:5` e `STATE.md:33`.
  - As quatro divergências: R08 `a_depends_on_b` (PT `yes` 0,18; EN `no` 0,16), R08 `complements` (PT `yes` 0,48; EN `no` 0,11), R08 `answers_conflict` (PT `yes` 0,50; EN `insufficient` 0,27) e R11 `same_block` (PT `no` 0,32; EN `yes` 0,41). A faixa de confiança é 0,11–0,50, e três das quatro são de R08, como diz o plano.
  - Ressalva: o plano diz que o modelo solicitado foi `jev-latest`, mas `results.json` só registra o modelo devolvido. O pedido não está na evidência (Observação 11).
- `run.mjs` usa `buildJevBody` da bancada (`run.mjs:8`, `:108`) e alterna a ordem dos braços por caso (`run.mjs:122-133`). Não rodei o script.

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. O diff não tocou interface, e a feature não tem tela (`plan.md`, Observable: "Tela ... n/a").

## Provas executadas

Verified at 1d46c87. Os 56 checks rodaram numa única invocação, com o padrão montado a partir dos IDs de `checks.md`:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C1|C2|…|C49|C52|C53|C54|C55|C56|C57|C58):'` → exit 0. TAP: `1..56`, `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, e `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez como `ok N - C<n>`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

- **Sem órfãos e sem check sem teste.** A lista de `C<n>` dos `ok` no TAP é igual à lista de `**C<n>**` de `checks.md` (`diff` vazio, 56 de cada lado). `rg -n "^test\('C[0-9]+:" tests` dá exatamente os mesmos 56 IDs, um teste por ID. `rg -nE 'C5[019]\b' src tests Makefile package.json` não acha nada, e `tests/ai-study/live/` não existe. Os testes sem prefixo `C<n>:` são de apoio: `s1-corpus.test.mjs:40`, `s3-jev.test.mjs:600` e `s5-report.test.mjs:520` (os verificadores de integração live).
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`: os 56 checks e os três testes de apoio.
- `npm run check` → exit 0 (o glob de `tests/ai-study/live/*.mjs` saiu de `package.json`).
- `make plan-validate` → exit 0, `0 error(s), 0 warning(s)`. `make checks-validate` → exit 0, `0 error(s), 0 warning(s) [profile: light]`.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção. Em todas as linhas, o `Proof run` é a execução desta rodada em `1d46c87`.

**C50, C51 e C59 não são mais checks.** Foram removidos de `checks.md` em `f5d5829` por decisão do usuário de 02/10/2026 (`plan.md:5-7`, `checks.md:6,8`, `STATE.md:33`), por isso não aparecem como linha. A cobertura que dependia deles foi conferida em "Emenda de 02/10/2026".

| Check | Claim | Proof run | Evidence | Result | Origem |
| --- | --- | --- | --- | --- | --- |
| C1 | dry-run válido: modo, hashes, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (lote, exit 0) | `s1-commands.test.mjs:60-61` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `f['hash do gabarito']`; `:81-82` - `'20'`/`'24'`; `:83-84` - destinos; `:85` - `assert.equal(l['chave Jev'], 'configurada (valor omitido)')`; `:74` - `assertNoSecret(live)` | PASS | carried from b2520fe |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos | `ok 2 - C2:` | `s1-commands.test.mjs:100-101` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])`; `:116` - `assert.equal(liveFactoryCalls, 0)` | PASS | carried from b2520fe |
| C3 | preparação (dry-run fixture/live) e coleta fixture: zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | `s1-commands.test.mjs:135` - `assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada')`; `:136` - `assert.deepEqual(last.guard.attempts, [], 'nenhum processo nem rede')`; `:142-143` - `assert.doesNotMatch(source, /child_process\|worker_threads/, file)` + nomes das CLIs | PASS | carried from b2520fe |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | `s1-commands.test.mjs:152` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:157` - `assertUsageFailure(run, /MODE/, ...)`, que assere `status` 2 e `nodeStatus` 2 (`:39-41`) | PASS | carried from b2520fe |
| C5 | config inválida → 2 antes de coletar, nomeando a config sem revelar segredo; tabela completa | `ok 5 - C5:` | `s1-commands.test.mjs:169-201` (tabela de entradas inválidas); `:206-208` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` | PASS | carried from b2520fe |
| C6 | corpus exato R01–R12/T01–T06 em ordem; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | `s1-corpus.test.mjs:70-71` - `assert.deepEqual(...relational_cases.map((r) => r.id), R_IDS)` / `T_IDS`; `:75-82` (ausente, extra, repetido, fora de ordem); `:31-36` - `run.status` 2, `nodeStatus` 2, `!existsSync(...)` | PASS | carried from b2520fe |
| C7 | seis julgamentos, rótulo válido, justificativa; violações → 2 | `ok 11 - C7:` | `s1-corpus.test.mjs:90` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:92-93` - domínio e justificativa; `:97-114` via `:31-32` | PASS | carried from b2520fe |
| C8 | resultados vinculados aos mesmos hashes; alteração impede comparação | `ok 12 - C8:` | `s1-corpus.test.mjs:139-140` - `assert.equal(result.corpus_hash, base.corpusHash)` / `gabarito_hash`; `:144` - `assert.throws(() => assertSameReference(mixed), UsageError)`; `:174` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS | carried from b2520fe |
| C9 | `make ai-study-run` sem modo → 0, artefatos fixture, `schema_version: 1` | `ok 6 - C9:` | `s1-commands.test.mjs:237` - `assert.equal(run.status, 0, run.output)`; `:244` - `assert.equal(evidence.manifest.schema_version, 1)`; `:246-247` - `mode`/`provenance` `'fixture'`; `:250` - 42 resultados | PASS | carried from b2520fe |
| C10 | fronteira fixture: live → 2 preservando evidências; coletor live: fixture rejeitado | `ok 7 - C10:` | `s1-commands.test.mjs:266` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`; `:270` - `reason 'provenance_mismatch'`; `:325-326`; `:329` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')` | PASS | carried from b2520fe |
| C11 | aceita RUN_ID 1/64, timeout inteiro positivo, saída 1/2048; 20/24 | `ok 8 - C11:` | `s1-commands.test.mjs:344` - `assert.equal(longId.length, 64)`; `:355` - `assert.equal(manifest[key], value, key)`; `:363` - `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS | carried from b2520fe |
| C12 | defaults publicados; relatório exige RUN_ID; live exige config; token opcional; sem flags | `ok 9 - C12:` | `s1-commands.test.mjs:373-377` - defaults; `:393` - `resolveConfig('report', {})` lança `/RUN_ID/`; `:407` - `assert.equal(noToken.local.apiToken, null, 'token local opcional')`; `:411` - `assertUsageFailure(flagged, new RegExp(name), ...)` | PASS | carried from b2520fe |
| C13 | tradução registra original, direção, modelo, revisão do template, vínculo | `ok 13 - C13:` | `s2-translation.test.mjs:172-177` - `run_id`, `case_id`, `requested_model`, `template_revision`; `:180-185` - `direction` + `original` | PASS | carried from b2520fe |
| C14 | template não confirmado → `template_unverified`, sem envio | `ok 14 - C14:` | `s2-translation.test.mjs:224` - `assertIncomplete(outcome, 'template_unverified')`; `:226` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:244` - `assert.deepEqual(lm.calls, [])` | PASS | carried from b2520fe |
| C15 | 2048 admitido; 2049 → `input_limit` sem envio nem truncamento; contagem inclui template | `ok 15 - C15:` | `s2-translation.test.mjs:263-264` - `assert.equal(t.input_tokens.count, 2048)`; `:269-270` - `assertIncomplete(first, 'input_limit')` + `assert.deepEqual(only(blocked.calls, 'translate'), [])` | PASS | carried from b2520fe |
| C16 | contagem indisponível/tokenizer divergente → `token_count_unavailable` | `ok 16 - C16:` | `s2-translation.test.mjs:322-323` - `assertIncomplete(outcome, 'token_count_unavailable')` + `assert.deepEqual(only(calls, 'translate'), [], name)` | PASS | carried from b2520fe |
| C17 | saída literal como derivação; braço EN usa a derivação; original preservado | `ok 17 - C17:` | `s2-translation.test.mjs:360` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:365`; `:371` - `assert.equal(en.request.text, literal(c.id), ...)` | PASS | carried from b2520fe |
| C18 | vazia/espaços/limite → `invalid_translation`, sem Jev EN | `ok 18 - C18:` | `s2-translation.test.mjs:412` - `assert.equal(byCase[caseId].status, 'invalid_translation', caseId)`; `:414`; `:420` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)` | PASS | carried from b2520fe |
| C19 | duração ms, metadados do runtime, justificativa; download não vira VRAM | `ok 19 - C19:` | `s2-translation.test.mjs:466` - `Number.isInteger(duration) && duration >= 25`; `:469-471`; `:474-476`; `:478-479` - `/download/`, `/VRAM/` | PASS | carried from b2520fe |
| C20 | identidade solicitada/retornada Q6_K; sem trocar/instalar/baixar | `ok 20 - C20:` | `s2-translation.test.mjs:537` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:562-563` | PASS | carried from b2520fe |
| C21 | seis julgamentos `Choice` na mesma chamada, critérios yes/no/insufficient | `ok 21 - C21:` | `s3-jev.test.mjs:136` - `assert.deepEqual(Object.keys(call.body.questions), [...JUDGMENT_IDS], ...)`; `:140`; `:141` - `assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id)` | PASS | carried from b2520fe |
| C22 | payloads sem gabarito, justificativa de referência ou revisão humana | `ok 22 - C22:` | `s3-jev.test.mjs:192` - `assert.ok(!payload.includes(SENTINEL), ...)`; `:194` - `assert.deepEqual(sent(alt), sent(base))` | PASS | carried from b2520fe |
| C23 | par com instruções/rubricas/IDs/critérios/modelo iguais; só o texto varia | `ok 23 - C23:` | `s3-jev.test.mjs:218-223`; `:227` - `assert.notEqual(pt.request.body.state, en.request.body.state, c.id)`; `:235` - `assert.doesNotMatch(prompt, /\b[RT]\d{2}\b/, ...)` | PASS | carried from b2520fe |
| C24 | alternância PT/EN e EN/PT até R12 | `ok 24 - C24:` | `s3-jev.test.mjs:251-253`; `:264` - `assert.deepEqual(sentOrder, expectedOrder)`; `:266` - `assert.deepEqual(persisted, expectedOrder)` | PASS | carried from b2520fe |
| C25 | validação da AC 21; violação → `invalid_response` sem inferir escolha | `ok 25 - C25:` | `s3-jev.test.mjs:285-295` - `assert.deepEqual(validateEvaluation(results), [], label)`; `:297-330` - `assert.match(problems.join('\n'), pattern, label)`; `:352-353` | PASS | carried from b2520fe |
| C26 | avaliação persistida com identificação, distribuição, uso e duração; uso ausente não vira zero | `ok 26 - C26:` | `s3-jev.test.mjs:383-396`; `:401-404` - `usage.available false`, `/não é custo zero/` | PASS | carried from b2520fe |
| C27 | acerto/erro/ausência; `insufficient` é escolha | `ok 27 - C27:` | `s3-jev.test.mjs:411-421` - `assert.equal(compareChoice(choice, expected), outcome, ...)`; `:423-424`; `:452` | PASS | carried from b2520fe |
| C28 | par incompleto fora do denominador; individual visível | `ok 28 - C28:` | `s3-jev.test.mjs:477-490` - `assert.deepEqual(pair.reasons, reasons, label)`; `:499`; `:503`; `:531` | PASS | carried from b2520fe |
| C29 | duas coletas simultâneas: só uma; a segunda recusada antes de chamar modelos | `ok 36 - C29:` | `s4-limits.test.mjs:481-483`; `:485` - `assert.equal(started().length, 1, ...)`; `:488` | PASS | carried from b2520fe |
| C30 | RUN_ID existente → 2; bytes anteriores mantidos | `ok 37 - C30:` | `s4-limits.test.mjs:554-556`; `:559` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before, ...)` | PASS | carried from b2520fe |
| C31 | máx. 20 locais / 24 Jev, falhas contadas, 21ª/25ª bloqueadas, zero retries | `ok 31 - C31:` | `s4-limits.test.mjs:141`; `:143-144`; `:162` - `assert.equal(retryingLocal.svc.count('local'), 20, ...)`; `:175`; `:190` | PASS | carried from b2520fe; agora prova sozinho a AC 27 (emenda revogada) |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | `s4-limits.test.mjs:231`; `:242` - `assert.equal(svc.maxInFlight(), 1)`; `:244` | PASS | carried from b2520fe |
| C33 | timeout encerra no limite; `incomplete`; restantes não executados | `ok 33 - C33:` | `s4-limits.test.mjs:274`; `:279` - `reason 'timeout'`; `:280-288`; `:290`; `:293` | PASS | carried from b2520fe |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → 1 | `ok 38 - C34:` | `s4-limits.test.mjs:587-588` - `run.status` 2 (make) e `run.nodeStatus` 1; `:595`; `:598`; `:615` | PASS | carried from b2520fe |
| C35 | interrupção antes/depois da troca atômica | `ok 34 - C35:` | `s4-limits.test.mjs:330` / `:334`; `:341`; `:353`; `:367` - `assert.throws(() => loadRun(...), ... /JSON inválido ou parcial/ ...)` | PASS | carried from b2520fe |
| C36 | segredos fora de stdout/stderr/manifesto/resultados/comparação; chave/token curtos → 2 | `ok 39 - C36:` | `s4-limits.test.mjs:680` - `assert.ok(!text.includes(secret), ...)`; `:682`; `:667-670` | PASS | carried from b2520fe |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches | `ok 40 - C37:` | `s4-limits.test.mjs:707-708`; `:712`; `:719` - `assert.deepEqual(evidenceReads.filter(...), [])` | PASS | carried from b2520fe |
| C38 | zero leituras de chats/perfis Cloak/credenciais; tráfego só aos destinos configurados | `ok 41 - C38:` | `s4-limits.test.mjs:757` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:759`; `:765` | PASS | carried from b2520fe |
| C39 | evidências fora do Git; sobrevivem byte a byte | `ok 42 - C39:` | `s4-limits.test.mjs:781` - `git check-ignore` status 0; `:783`; `:797` - `assert.equal(after[file], content, ...)` | PASS | carried from b2520fe |
| C40 | relações `schema_version: 1`; `loadRun` recusa outra execução/revisão/schema | `ok 35 - C40:` | `s4-limits.test.mjs:388-413`; `:437` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)`; `:440` | PASS | carried from b2520fe |
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:223` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:230-231` - nenhuma leitura fora da execução, corpus atual não lido; `:241-242` + `:121` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; prova e citações verified at 1d46c87 |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | ordem: `s5-report.test.mjs:269` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:274`; literais: `:287-288`, `:290`; texto fixo só do catálogo: `:205-211`; prosa renderizada sem código no lugar do rótulo: `:273` - `assertNoBareCodes(markdown)` → `:169` `assert.doesNotMatch(prose, EVIDENCE_CODES, ...)` e `:277` - rótulo do estado técnico; aprovação humana: PR #7 `issuecomment-5954258912` (Observação 4). Sobreviventes E2/E4/N3/N9/N12 em "Faults injected" | PASS | carried from 0893f6f (linhas `< :517`, inalteradas); prova verified at 1d46c87 |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:306-308` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:315-316` - `assert.deepEqual(individual[j], ...)` / `assert.deepEqual(paired[j], ...)`; `:320` - `assertNoBareCodes(jev)` | PASS | carried from b5f0668; prova verified at 1d46c87 |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:338-340` - contagens e entradas com `output_sha256`, revisor e justificativa; `:355-356` - recusas com código 2; `:357` - relatório anterior intacto | PASS | carried from b2520fe; prova verified at 1d46c87 |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:378` - `'evidence_complete'`; `:384-385` - `'inconclusive'` + `['review_pending']`; `:399-402` - falha e `interrupted` → `inconclusive` | PASS | carried from b2520fe; prova verified at 1d46c87 |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:414-416` - `não registrada`; `:421-422` - estado técnico inalterado + `Recomendação humana`; `:439` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; prova verified at 1d46c87 |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:460-461` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:467` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; prova verified at 1d46c87 |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:478-479` - limitações; `:481` - `acurácia` uma vez; `:482` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS | carried from b2520fe; prova verified at 1d46c87 |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho (e, pela Coverage, live identificado) | `ok 52 - C49:` | `s5-report.test.mjs:503` - faixa no cabeçalho; `:504-505` - marca na saída e nas limitações; `:506` - `/^- Modo e proveniência: \`fixture\` \/ \`fixture\` \(simulado\)$/m`; `:510` - `Conclusão: \`inconclusive\``; `:512` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:516` - live sem a faixa; **`:517`** - `assert.match(live.markdown, /^- Modo e proveniência: \`live\` \/ \`live\`$/m)` (P1, P2 e P3 mortas; controles P2b e P3b sobrevivem sem `:517`) | PASS | verified at 1d46c87 |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:567` - `assert.equal(result.shimCalls, '', ...)`; `:569` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; citações verified at 1d46c87 (+1 linha) |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:600` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:596-598` - `[omitido]` presente | PASS | carried from b2520fe; citações verified at 1d46c87 (+1 linha) |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:622` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:623` - nenhuma execução removida | PASS | carried from b2520fe; citações verified at 1d46c87 (+1 linha) |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:633-645` (13 variantes) + `:648` `report(..., { expect: 2 })` → `:121` `assert.equal(result.nodeStatus, expect, ...)`; `:649` - `assert.match(refused.stderr, pattern, runId)`; `:650` - nenhum relatório | PASS | carried from b2520fe; citações verified at 1d46c87 (+1 linha) |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Verified at 1d46c87, a partir de `checks.md:257-261` e dos veredictos acima:

- **AC 1–37:** todas fechadas, e todos os checks alocados são PASS. AC 3 é coberta por C3 + C52 + C54, e AC 10 por C10 + C53. **AC 27 fecha com C31**, porque a emenda que trazia C59 foi revogada (`plan.md:178`), e o texto da AC (`plan.md:170`) é o original, que C31 cobre.
- **Fora da tabela de ACs:** os *Independent tests* reais de S2 e S3 saíram dos checks por emenda registrada (`plan.md:138`, `:161`). A observação real do Jev ficou com o experimento de 02/10/2026, que roda fora da bancada. Nenhuma tradução local real foi observada, e o plano declara que o modo live não foi validado contra serviços reais (`plan.md:7`).

### Nível e amostragem

- **C49, proveniência live** (verified at 1d46c87): a asserção roda sobre o relatório de uma coleta live com **serviços controlados**, não reais. Ela prova que o relatório identifica a proveniência gravada, e não que alguma integração real aconteceu. Essa leitura é coerente com `plan.md:7`.
- **C42** (carried from 0893f6f): o texto fixo é verificado de forma estática em todos os ramos e no Markdown renderizado de uma coleta concluída. A amostra renderizada não inclui relatório com `failure` (N12).
- Os demais itens são carried from b2520fe: claims de código de saída passam pela fronteira `make`, C25/C27/C28 cobrem cada linha das tabelas de decisão, e C31 prova a borda 20/21.

## Swept existing re-read

Verified at 1d46c87. O diff tocou o Swept (`checks.md:304-313`): as linhas validation e authorization perderam C59, e dependency failure perdeu a frase sobre C50/C51. Todas as linhas continuam apontando só para checks existentes. A única decisão `existing` do plano, Observable/Harness (`plan.md:254`: tlc-spec-lean instalada, perfil `light`), continua no código: `checks.md:3` traz `Profile: light`, e `.claude/skills/tlc-spec-lean/` existe.

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**. Nesta rodada conferi só as linhas que o diff mudou, comparando antes e depois (tabela em "Emenda de 02/10/2026"). Nenhuma ficou com membro sem check.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Perfil `light`: a injeção formal de falhas **não é exigida**, e não alego cobertura de mutação da feature. As linhas abaixo existem porque foram injetadas (Rounds 5–7) e cada resultado é um fato sobre os testes.

Verified at 1d46c87, nesta rodada:

- P1–P3 sobre a nova asserção de C49 (com os controles P2b e P3b).
- Os cinco sobreviventes da Round 6, reaplicados num segundo worktree descartável em `1d46c87`. Rodei `s5-report.test.mjs` inteiro: linha de base `# pass 14 # fail 0`, e com cada mutante, exit 0, `# pass 14 # fail 0`.

Os mortos de N1, N2, N4–N8, N10 e N11 são carried from 0893f6f: `src/` só mudou em comentários, e as linhas das asserções que os mataram (`:166-211`, `:273-320`) não mudaram.

| Mutação | Location | Killed |
| --- | --- | --- |
| P1 proveniência live impressa como `fixture` | `src/ai-study/report.mjs:198` | yes (C49, `tests/ai-study/s5-report.test.mjs:517`) - verified at 1d46c87 |
| P2 sufixo `(simulado)` também no live | `src/ai-study/report.mjs:198` | yes (C49, `:517`) - verified at 1d46c87 |
| P3 modo live impresso como `fixture` | `src/ai-study/report.mjs:198` | yes (C49, `:517`) - verified at 1d46c87 |
| N9 `ARM_LABELS[arm]` → `arm` nos cabeçalhos das tabelas | `src/ai-study/report.mjs:183` | no - sobrevive em 1d46c87 (`s5-report` 14/14) |
| N12 rótulo do estado omitido só com `manifest.failure` | `src/ai-study/report.mjs:229` | no - sobrevive em 1d46c87 (`s5-report` 14/14) |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` (`passed`) | `src/ai-study/report.mjs:26` | no - sobrevive em 1d46c87 (`s5-report` 14/14) |
| E4 `empty = Object.keys({ nothing: text('none') })[0]` | `src/ai-study/report.mjs:26` | no - sobrevive em 1d46c87 (`s5-report` 14/14) |
| N3 `empty = /nothing/.source` | `src/ai-study/report.mjs:26` | no - sobrevive em 1d46c87 (`s5-report` 14/14) |
| N1, N2, N4, N5, N6, N7, N8, N10, N11 | `src/ai-study/report.mjs` (ver Round 6) | yes - carried from 0893f6f |

## Observations (non-blocking)

Carried from b2520fe:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.

Carried from b5f0668:

3. O texto livre gravado nas evidências entra no relatório como dado, fora do catálogo, e fica fora do claim de C42.

Carried from 580258d / 0893f6f:

4. **Atribuição.** O comentário de aprovação do catálogo e os commits da emenda saem da mesma conta usada por agentes. A autoria humana vem da declaração registrada, não da conta.
5. **Pinos opacos.** `REVIEWED_CODE_CONTEXTS` e `REVIEWED_TEXT_FUNCTION` (`tests/ai-study/s5-report.test.mjs:177-178`) não têm lista legível.
6. `codeContexts` é um conjunto de linhas (`:204`).
7. **Limites de `EVIDENCE_CODES`** (`:166`): `\b` ASCII casa dentro de palavras acentuadas.
8. `formatReportSummary` imprime o estado técnico como código no stdout, fora do claim de C42.

A Observação 2 (proveniência do `RUN_ID` de C50/C51) saiu com os checks.

Novas nesta rodada (verified at 1d46c87):

9. **C49 e o membro "live identificado".** O claim de C49 (`checks.md:231`) fala só de relatório fixture. A Coverage (`checks.md:300`) atribui a ele também "live identificado", que a asserção nova `:517` prova. O membro tem prova executada e localizada, mas o texto do claim não o nomeia: é uma lacuna de precisão no artefato, e não de cobertura. Sugestão: uma nota na linha de Coverage ou no Status de C49.
10. **Resíduos de C50/C51/C59.** `checks.md:302` ("C50–C51 não exigem concordância perfeita…"), `STATE.md:17`, `:19` e `:70` ainda descrevem C50/C51/C59 como pendentes, contra o `STATE.md:31-33`. O `Makefile` ainda passa `RUN_ID="$(RUN_ID)"` ao Node em `check-proof`, o que é inofensivo. O `STATE.md:33` registra `TYPETYPESAFE_API_KEY` em `.env.local`, um nome que a bancada não lê.
11. **Modelo solicitado fora da evidência.** `plan.md:5` diz `jev-latest`, mas `results.json` só registra o modelo devolvido (`jev-1.13.0`) e não guarda a ordem efetiva dos braços, que só aparece no código (`run.mjs:122-133`).

## Lacunas

Ranqueadas.

**(a) Mutantes sobreviventes: o único motivo do FAIL**

O harness não aceita PASS com mutante vivo (`verify.md`: "A surviving mutant is a finding… What fails the feature: … a surviving mutant"). O gate lê a coluna `Killed`. As Rounds 4–6 julgaram estes cinco não bloqueantes porque exigem escrita deliberada ou não produzem prosa em inglês. Esse julgamento nunca passou pelo gate, porque aquelas rodadas eram FAIL por C50/C51/C59. Com esses checks removidos, os cinco são a única coisa entre a feature e um gate verde. Há duas saídas: corrigir, ou o usuário aceitar explicitamente o risco como fora do perfil `light`. A segunda é decisão dele, não do verificador.

1. **N12 (C42)** - `src/ai-study/report.mjs:229`: um relatório de coleta com falha que imprimisse o código no lugar do rótulo passaria. É o único dos cinco que viola o claim no texto renderizado sem ofuscação. Correção barata: aplicar `assertNoBareCodes` e a asserção do rótulo do estado aos relatórios com `failure` e `interrupted` de C45 (`tests/ai-study/s5-report.test.mjs:395-402`).
2. **N9 (C43)** - `src/ai-study/report.mjs:183`: nenhum teste lê a linha de cabeçalho das tabelas de contagem. Correção barata: asserir em C43 `| Julgamento | PT (original) acertos | … |`.
3. **E2, E4, N3 (C42)** - `src/ai-study/report.mjs:26` e o leitor estático em `tests/ai-study/s5-report.test.mjs:202`: escapes, nomes de propriedade e regex escapam da varredura. Correção: decodificar escapes e tratar regex e chaves como literais no leitor. Também é possível uma decisão explícita do usuário de que ofuscação deliberada fica fora do claim.

**(b) Não bloqueantes**

4. Observações 9, 10 e 11 (precisão de C49 na Coverage, resíduos de texto, modelo solicitado ausente da evidência).

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 6 - scoped** (`3416c78..0893f6f`, commit do relatório `f7f8ee4`): FAIL, 56/59. Rodada autorizada pelo usuário para reavaliar C42 depois de `0893f6f`. **C42 passou a PASS**: N5 morreu por duas asserções independentes (`:273`, `:277`), e N1, N2, N4, N6–N8, N10 e N11 também morreram. Sobreviveram E2, E4 e N3 (ofuscação) e N9 e N12 (novas), julgadas não bloqueantes. C50 e C51 ficaram sem evidência live real (PRB-11) e C59 sem teste nem implementação (PRB-8). Gate → exit 1. Nenhuma lição nova. Relatório em `git show f7f8ee4:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 5 - scoped** (`d6440be..580258d`, commit do relatório `3416c78`): FAIL, 55/59. Foi despachada pelo coordenador sem autorização explícita da rodada (correção registrada na Round 6). C42 ficou NÃO PROVADO por N5. Gate → exit 1. L-008 registrada.
- **Round 4 - scoped** (`4dacc6b..b5f0668`, commit do relatório `d6440be`): FAIL, 55/59. C42 ficou NÃO PROVADO pela aprovação humana ausente do hash do catálogo. Gate → exit 1. L-006 atualizada, L-007 registrada.
- **Round 3 - scoped** (`838012d..5f310f9`, commit do relatório `4dacc6b`): FAIL, 55/59. C42 perdeu o PASS (M4–M6, M8–M10). Gate → exit 1. L-006 registrada.
- **Round 2 - scoped** (`42f101e..c23dddc`, commit do relatório `838012d`): FAIL, 56/59. C42 recebeu PASS com um mutante vivo, erro corrigido na Round 3. L-005 registrada.
- **Round 1 - full** (`4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59.
- Rodadas de escopo S1–S4, anteriores à Round 1: Rodada 5 (S1–S4) PASS em 43/43; Rodada 4 (S4) FAIL em C55, L-004; Rodada 3 (S4) FAIL em C36/C39/C40, L-001 a L-003; Rodadas 2 (S3) e 1 (S1+S2) PASS nos checks então construídos.

## Gate

Verified at 1d46c87:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(<os 56 IDs de checks.md>):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0.
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0. `make plan-validate`: exit 0. `make checks-validate`: exit 0.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify` (1 erro, 0 avisos).
- `git status --porcelain`: vazio antes; vazio depois das provas, das mutações e da remoção dos dois worktrees; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`.

## Lições

Nenhuma lição nova registrada, e `lessons.py` não foi chamado. Nesta rodada não houve falha nova de execução sobre o código:

- P1–P3 morreram.
- Os sobreviventes N9 e N12 já estão cobertos pela **L-008** (asserir o rótulo renderizado onde o gerador mapeia código para rótulo do catálogo), e E2, E4 e N3 pela família **L-006**/**L-007**.
- As observações 9–11 são de artefato e de evidência, não de execução do código.
