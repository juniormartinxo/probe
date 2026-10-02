# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: 42f101e..c23dddc (correção do review do PR #7: `c23dddc test(ai-study): prove the C42 report prose is Portuguese and drop L-005`; HEAD = `c23dddc`, confirmado com `git rev-parse HEAD`). A feature inteira é `4a1acfe..c23dddc`; a Round 1 cobriu `4a1acfe..b2520fe`.
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação nem da correção; o relatório da Round 1 foi usado só para delimitar o escopo, nunca como prova

Escopo desta rodada: o diff da correção (`tests/ai-study/s5-report.test.mjs`, `.specs/LESSONS.md`, `.specs/lessons.json`; nenhum arquivo de `src/` mudou, `git diff --stat 42f101e..c23dddc`), todo veredicto que não foi PASS na Round 1 (**C50, C51, C59**) e os checks cuja prova o diff tocou (**C42, C43**). Os demais 54 checks têm o julgamento de asserção **carregado de `b2520fe`**, mas as provas de todos os 59 rodaram de novo em `c23dddc`. As citações do único arquivo de código tocado (`s5-report.test.mjs`, +8 linhas a partir da linha 169) foram atualizadas e reconferidas linha a linha. Nada fora de `.specs/` e desse teste mudou entre `b2520fe` e `c23dddc` (`git diff --stat b2520fe..c23dddc -- . ':!.specs'`), então as demais citações seguem válidas.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas e das mutações, que rodaram num `git worktree` descartável no scratchpad, removido ao final (`git worktree list` só mostra o checkout principal e `prb-7`). Não chamei LM Studio, Jev, nenhum modelo nem a rede real e não procurei segredos.

**Resultado em uma linha:** 56 de 59 checks provados, com teste nomeado executado em `c23dddc` e asserção localizada. **C42** agora prova "prosa fica em português": as duas mutações pedidas ficam vermelhas e passavam com a asserção da Round 1. Uma terceira mutação, uma palavra inglesa isolada fora da lista, sobrevive (lacuna residual de precisão, registrada abaixo). **C50 e C51** continuam sem evidência live real e **C59** continua sem teste nem implementação. O veredicto segue FAIL.

## Correção do julgamento da Round 1 sobre C42

A Round 1 marcou C42 como PASS e, na mesma página ("Nível e amostragem"), admitiu que a prova de "prosa fica em português" era indireta: `assertNoBareCodes` (`tests/ai-study/s5-report.test.mjs:164-166`) só recusa uma lista de códigos de evidência (`EVIDENCE_CODES`, `:163`) e não afirma o idioma das frases. **Esse PASS foi um erro de julgamento.** Uma asserção que não prova o valor do check não sustenta PASS, e a ressalva deveria ter virado NÃO PROVADO, não uma observação não bloqueante. Reproduzi o problema em `c23dddc` com o teste de `42f101e`: com `Não avaliados` → `Not evaluated` em `src/ai-study/report.mjs:246`, o C42 antigo passa (`ok 1 - C42:`, exit 0; tabela "Mutações" abaixo). Com a asserção nova o mesmo mutante fica vermelho, então o PASS de C42 desta rodada se apoia em evidência nova, não no julgamento anterior.

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. A correção não tocou interface. A feature não tem tela (`plan.md`, Observable: "Tela ... n/a"). Não alego contradição nem ausência de contradição.

## Provas executadas

Verified at c23dddc. Todas as provas rodaram numa única invocação:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'` → exit 0. TAP: `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, com `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez, como `ok N - C<n>:`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

Ausentes desse lote: C50, C51 e C59. Rodei cada um separadamente:

- Sem `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^C50:'`, e o mesmo com `^C51:` e `^C59:`. Os três deram `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, `make: *** [Makefile:43: check-proof] Error 1` e exit 2. O Makefile só inclui `tests/ai-study/live/*.test.mjs` quando `RUN_ID` é informado (`Makefile:6`).
- Com `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^(C50|C51):' RUN_ID=verifier-r2-no-evidence`. Os testes **existem e executam**, mas falham: `not ok 1 - C50:` e `not ok 2 - C51:`, os dois com `error: 'RUN_ID verifier-r2-no-evidence não tem evidências em .../prb-7/artifacts/ai-study/verifier-r2-no-evidence'` (`src/ai-study/run-reader.mjs:28`). Resultado: `# tests 2 # pass 0 # fail 2`, exit 2. Nenhum arquivo foi criado (`ls artifacts` → inexistente). O checkout principal (`/home/junior/apps/jm/probe`, `b2520fe`) também não tem `artifacts/ai-study`.
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0` (56 checks e três testes de apoio: `s1-corpus.test.mjs:40`, `s3-jev.test.mjs:600` e `s5-report.test.mjs:480`, este último deslocado de `:472`).
- `npm run check` → exit 0.

**Existência.** Verified at c23dddc para `s5-report.test.mjs` e carried from b2520fe para o resto. `rg -n "^test\('" tests/ai-study/s5-report.test.mjs tests/ai-study/live/s5-live.test.mjs` mostra C41–C49, C54 e C56–C58 em `s5-report.test.mjs` (`:178,212,254,286,329,367,403,432,457,521,533,564,586`) e C50/C51 em `live/s5-live.test.mjs` (`:17,26`). Os outros arquivos de teste não mudaram desde `b2520fe`, e as linhas citadas na Round 1 continuam válidas. `rg -n "C59|local_token_count" src tests` → nenhum resultado (exit 1): C59 continua sem teste.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção de cada linha. Em todas as linhas, o `Proof run` é a execução desta rodada em `c23dddc`.

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
| C31 | máx. 20 locais / 24 Jev, falhas contadas, 21ª/25ª bloqueadas, zero retries | `ok 31 - C31:` | `s4-limits.test.mjs:141`; `:143-144`; `:162` - `assert.equal(retryingLocal.svc.count('local'), 20, ...)`; `:175`; `:190` | PASS | carried from b2520fe |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | `s4-limits.test.mjs:231`; `:242` - `assert.equal(svc.maxInFlight(), 1)`; `:244` | PASS | carried from b2520fe |
| C33 | timeout encerra no limite; `incomplete`; restantes não executados | `ok 33 - C33:` | `s4-limits.test.mjs:274`; `:279` - `reason 'timeout'`; `:280-288`; `:290`; `:293` | PASS | carried from b2520fe |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → 1 | `ok 38 - C34:` | `s4-limits.test.mjs:587-588` - `run.status` 2 (make) e `run.nodeStatus` 1; `:595`; `:598`; `:615` | PASS | carried from b2520fe |
| C35 | interrupção antes/depois da troca atômica | `ok 34 - C35:` | `s4-limits.test.mjs:330` / `:334`; `:341`; `:353`; `:367` - `assert.throws(() => loadRun(...), ... /JSON inválido ou parcial/ ...)` | PASS | carried from b2520fe |
| C36 | segredos fora de stdout/stderr/manifesto/resultados/comparação; chave/token curtos → 2 | `ok 39 - C36:` | `s4-limits.test.mjs:680` - `assert.ok(!text.includes(secret), ...)`; `:682`; `:667-670` | PASS | carried from b2520fe |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches | `ok 40 - C37:` | `s4-limits.test.mjs:707-708`; `:712`; `:719` - `assert.deepEqual(evidenceReads.filter(...), [])` | PASS | carried from b2520fe |
| C38 | zero leituras de chats/perfis Cloak/credenciais; tráfego só aos destinos configurados | `ok 41 - C38:` | `s4-limits.test.mjs:757` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:759`; `:765` | PASS | carried from b2520fe |
| C39 | evidências fora do Git; sobrevivem byte a byte | `ok 42 - C39:` | `s4-limits.test.mjs:781` - `git check-ignore` status 0; `:783`; `:797` - `assert.equal(after[file], content, ...)` | PASS | carried from b2520fe |
| C40 | relações `schema_version: 1`; `loadRun` recusa outra execução/revisão/schema | `ok 35 - C40:` | `s4-limits.test.mjs:388-413`; `:437` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)`; `:440` | PASS | carried from b2520fe |
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:187` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:194-195` - nenhuma leitura fora da execução, corpus atual não lido; `:197-205` + `:119` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | `s5-report.test.mjs:233` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))`; `:237` - lista das 6 seções; `:248-249` - original e tradução literais; `:236` - `assertPortugueseProse(markdown)`, definida em `:171-176`: chama `assertNoBareCodes` (`:172`), tira cercas e crases (`:173`) e faz `assert.deepEqual(english, [], 'prosa do relatório em inglês')` (`:175`) sobre as linhas que casam `ENGLISH_WORDS` (`:170`). Mutações M1/M2 mortas; M3 sobrevive (ver "Mutações") | PASS | verified at c23dddc |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:267-269` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:276-277` - `assert.deepEqual(individual[j], ...)` / `paired[j]`; `:281` - `assertPortugueseProse(jev)` na seção Comparação Jev (mutação M4 morta) | PASS | verified at c23dddc |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:299-301` - contagens e entradas com `output_sha256`, revisor e justificativa; `:305-317` - recusas com código 2; `:318` - relatório anterior intacto | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:339` - `'evidence_complete'`; `:345-346` - `'inconclusive'` + `['review_pending']`; `:360-363` - falha e `interrupted` → `inconclusive`, sem erro pareado | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:375-377` - `não registrada` e nenhuma decisão no texto; `:382-383` - estado técnico inalterado + `Recomendação humana`; `:400` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:421-422` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:428` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:439-440` - textos das limitações; `:442` - `acurácia` uma vez; `:443` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho | `ok 52 - C49:` | `s5-report.test.mjs:465-466` - marca de simulação na saída e nas limitações; `:471` - `Conclusão: \`inconclusive\``; `:473` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:477` - live sem a marca | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C50 | evidência **live real** T01–T06: servidor/modelo Q6_K, template confirmado, contagem, seis EN→PT, durações | sem `RUN_ID`: 0 testes, exit 2; com `RUN_ID=verifier-r2-no-evidence`: `not ok 1 - C50:`, exit 2 | no evidence: não há coleta live real (`artifacts/ai-study/` inexistente no worktree e no checkout principal). Asserções que a fechariam: `live/s5-live.test.mjs:20-21` - `assert.deepEqual(proof.problems, [])` + `assert.equal(proof.proven, true)`. Bloqueios inalterados: `src/ai-study/template.mjs:14` `official: false` (Decisão 1) e `src/ai-study/lmstudio.mjs:43-44` `countTokens` → `{ count: null, ... }` (Decisão 2) | NÃO PROVADO - bloqueado | verified at c23dddc |
| C51 | evidência **live real** de ≥1 caso R: PT→EN + duas respostas Jev da mesma versão, seis válidos cada | idem: 0 testes sem `RUN_ID`; `not ok 2 - C51:` com `RUN_ID` | no evidence: mesma ausência de coleta. Asserções que a fechariam: `live/s5-live.test.mjs:29` - `assert.equal(proof.proven, true, ...)`; `:31` - seis resultados por braço. Bloqueios: os de C50, mais as condições de entrada da S5 (rubricas revisadas, campo `model` do Jev) | NÃO PROVADO - bloqueado | verified at c23dddc |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:527` - `assert.equal(result.shimCalls, '', ...)`; `:529` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:560` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:556-558` - `[omitido]` presente | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:582` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:583` - nenhuma execução removida | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:593-605` (13 variantes) + `:608` `report(..., { expect: 2 })` → `:119` `assert.equal(result.nodeStatus, expect, ...)`; `:609` - `assert.match(refused.stderr, pattern, runId)`; `:610` - nenhum relatório | PASS | carried from b2520fe; citações atualizadas em c23dddc |
| C59 | até 18 contagens de tokens em orçamento próprio `local_token_count`; 19ª bloqueada; falhas contadas; uma chamada por vez; sem retry do `@lmstudio/sdk` | `^C59:` → `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, exit 2 | no evidence: `rg -n "C59\|local_token_count" src tests` sem resultados; `@lmstudio/sdk` ausente de `package.json`; `src/ai-study/lmstudio.mjs:42-44` - "Sem pedido HTTP: não consome chamada do orçamento", `countTokens` devolve `count: null`; `checks.md:199` - "pendente, não construído" | NÃO PROVADO - não construído | verified at c23dddc |

### Mutações em C42 e C43

Verified at c23dddc. As mutações rodaram num `git worktree add --detach <scratchpad>/wt c23dddc` descartável, removido ao final. Cada uma foi aplicada sozinha e desfeita com `git checkout -- src tests`. Linha de base nesse worktree: `^(C42|C43):` → `ok 1`, `ok 2`, exit 0. A coluna "asserção da Round 1" roda o mesmo mutante com o `s5-report.test.mjs` de `42f101e`.

| Mutação | Local | Prova | Asserção nova (`c23dddc`) | Asserção da Round 1 (`42f101e`) |
| --- | --- | --- | --- | --- |
| M1: `Não avaliados` → `Not evaluated` | `src/ai-study/report.mjs:246` | C42 | morta: `not ok 1 - C42:`, `prosa do relatório em inglês`, `+ [ '- Not evaluated:  — ' ]`, exit 2 | sobrevive: `ok 1 - C42:`, exit 0 |
| M2: frase do aviso simulado em inglês (`Translations, choices and durations come from controlled responses.`) | `src/ai-study/report.mjs:372` | C42 | morta: `not ok 1 - C42:`, a linha das Limitações aparece em `english`, exit 2 | sobrevive: `ok 1 - C42:`, exit 0 |
| M3: valor vazio de `list()` `'nenhum'` → `'nothing'` | `src/ai-study/report.mjs:55` | C42, C43 | **sobrevive**: `ok 1 - C42:`, `ok 2 - C43:`, exit 0. Confirmei com uma sonda temporária no teste que o mutante chega ao Markdown de C42: `["- Não executados: nothing"]` | (não rodada; a asserção antiga é estritamente mais fraca) |
| M4: legenda do denominador da Comparação Jev em inglês (`Denominator per arm and judgment: 12 cases; ...`) | `src/ai-study/report.mjs:334` | C43 | morta: `not ok 1 - C43:`, a linha aparece em `english`, exit 2 | sobrevive: `ok 1 - C43:`, exit 0 |

**Veredicto sobre C42: PASS em `c23dddc`.** A asserção agora mira o valor do check. Toda linha de prosa gerada, fora de cercas e crases, é testada contra palavras funcionais inglesas e o vocabulário do relatório (`:170`). Qualquer frase ou rótulo de várias palavras em inglês fica vermelho, inclusive o cenário exato do review (M1), e as linhas fixas e o texto livre das evidências não escapam. O teste continua tendo um limite, registrado como lacuna de precisão e não escondido: a lista é fechada, então uma **palavra inglesa isolada** fora dela, num campo de um só termo (M3, `nothing`), passa. Não rebaixo o check por isso. O claim é sobre a prosa, as frases estão provadas, e o resíduo é um termo único que o teste poderia cercar comparando os rótulos fixos com um vocabulário português conhecido. A lacuna fica como item (a) das lacunas ranqueadas. C43 ganhou a mesma garantia na seção Comparação Jev (M4).

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Carried from b2520fe. Nenhum veredicto de check mudou nesta rodada, então a soma por AC é a mesma:

- **AC 1–26, 28–37:** fechadas. Todos os checks alocados são PASS (`checks.md:269-273`). AC 3 inclui C3 + C52 + C54, e AC 10 inclui C10 + C53.
- **AC 27:** **aberta.** C31 é PASS, mas C59 (emenda de 01/10/2026, orçamento de contagem de tokens) não tem prova.
- **Fora da tabela de ACs:** os "Independent test" da S2 (C50) e da S3 (C51) continuam abertos. Nenhuma tradução real e nenhuma avaliação Jev real foram observadas.

### Nível e amostragem

- **C42, "prosa fica em português"** (verified at c23dddc): a prova deixou de ser indireta. `assertPortugueseProse` (`s5-report.test.mjs:171-176`) assere o idioma linha a linha e mata M1, M2 e M4. O resíduo é M3, uma palavra isolada fora da lista fechada (`:170`). A observação da Round 1 que tratava a prova indireta como não bloqueante foi retirada e corrigida acima.
- Os demais itens são carried from b2520fe. Claims de código de saída passam pela fronteira `make` (`assertUsageFailure`, `s1-commands.test.mjs:39-41`; `report`, `s5-report.test.mjs:119`). C25, C27 e C28 cobrem cada linha das tabelas de decisão. C31 prova a borda 20/21 no orçamento e na coleta (`s4-limits.test.mjs:141-169`).

## Swept existing re-read

Carried from b2520fe. A correção não tocou `checks.md` nem `plan.md`. A seção `Swept` (`checks.md:316-326`) só aponta para checks. A única decisão `existing` do plano, Observable/Harness (tlc-spec-lean instalada, perfil `light`), continua no código (`checks.md:3`).

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Perfil `light`: a injeção de falhas formal **não é exigida** e não alego cobertura de mutação da feature. A pedido desta rodada, injetei quatro mutantes só nas superfícies de C42/C43 que a correção criou (tabela "Mutações em C42 e C43" acima, verified at c23dddc): três mortos e **um sobrevivente (M3)**.

| Mutação | Location | Killed |
| --- | --- | --- |
| M1 `Não avaliados` → `Not evaluated` | `src/ai-study/report.mjs:246` | yes (C42) |
| M2 aviso simulado em inglês | `src/ai-study/report.mjs:372` | yes (C42) |
| M3 `'nenhum'` → `'nothing'` | `src/ai-study/report.mjs:55` | no - sobrevive a C42 e C43 |
| M4 legenda do denominador Jev em inglês | `src/ai-study/report.mjs:334` | yes (C43) |

## Observations (non-blocking)

Carried from b2520fe e reconfirmadas:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.
2. C50/C51: o `RUN_ID` que os fechar precisa vir de uma coleta live autorizada. O verificador da rodada seguinte deve conferir a proveniência real, não só o teste verde (STATE.md, escolha 5 da S5).

Nova nesta rodada:

3. `ENGLISH_WORDS` (`s5-report.test.mjs:170`) inclui `status`, `state` e `run`, que também circulam no português técnico. Hoje nenhuma linha de prosa os usa (C42/C43 verdes), mas uma frase portuguesa futura com "status" quebraria o teste. É risco de falso vermelho, não de falso verde.

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 1 - full** (feature inteira, `4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59. C50 e C51 sem evidência live real, C59 não construído e AC 27 aberta. Gate `validate_verification.py` → exit 1. Erro de julgamento corrigido nesta rodada: C42 recebeu PASS com uma asserção (`assertNoBareCodes`) que não provava "prosa fica em português", e a Round 1 registrou isso como observação não bloqueante. A Round 1 registrou a lição L-005 (`ac_gap`, C59, alocação de checks de emenda), removida em `c23dddc` porque tratava do fluxo da skill. Relatório completo em `git show 42f101e:.specs/features/jev-translation-feasibility/verification.md`.
- Rodadas de escopo S1–S4, anteriores à Round 1 da feature inteira: Rodada 5 (S1–S4, `5417c97..7868a78`) PASS em 43/43 construídos, relatório em `git show b2520fe:.specs/features/jev-translation-feasibility/verification.md`. Rodada 4 (S4, `864b31b`) FAIL em C55, lição L-004. Rodada 3 (S4, `4470b14`) FAIL em C36/C39/C40, lições L-001 a L-003. Rodadas 2 (S3, `4eea13b`) e 1 (S1+S2, `166a2b9`) PASS nos checks então construídos.

## Gate

Verified at c23dddc:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0. Faltam C50, C51 e C59.
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0.
- C50/C51 sem `RUN_ID`: 0 testes, exit 2. Com `RUN_ID=verifier-r2-no-evidence`: 0 passed, 2 failed, exit 2. C59: 0 testes, exit 2.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify`.
- `git status --porcelain`: vazio antes; vazio depois das provas e das mutações; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`, ` M .specs/LESSONS.md` e ` M .specs/lessons.json`, os dois últimos gravados por `lessons.py`.

## Lições

Uma lição registrada por `scripts/lessons.py add` (exit 0): **L-005** (`surviving_mutant`, escopo `report`, candidata): "Assert the language of generated text against the fixed labels the generator emits, since a closed list of foreign words lets a single foreign word through". A fonte é M3 (`src/ai-study/report.mjs:55`; `tests/ai-study/s5-report.test.mjs:170`). O script reutilizou o id L-005, livre desde `c23dddc`; não é a lição removida.

Não registrei:

- o erro de julgamento da Round 1 em C42, porque é comportamento do verificador, ou seja, fluxo da skill (`references/memory.md`, "Scope discipline");
- C59, porque a causa (check de emenda sem slice que o construa) também é fluxo e já foi rejeitada como L-005 anterior, e a lição de código correlata já existe como L-003;
- C50/C51, porque a causa é pré-requisito externo (template oficial, contagem de tokens, autorização da coleta live), não falha de execução neste código.
