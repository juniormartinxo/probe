# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: 838012d..5f310f9 (correção do review do PR #7: `5f310f9 test(ai-study): check C42 report prose against a closed Portuguese vocabulary`; HEAD = `5f310f9`, confirmado com `git rev-parse HEAD`). A feature inteira é `4a1acfe..5f310f9`; a Round 1 cobriu `4a1acfe..b2520fe` e a Round 2 cobriu `42f101e..c23dddc`.
**Round**: 3 - scoped
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação nem das correções; os relatórios das Rounds 1 e 2 serviram só para delimitar o escopo, nunca como prova

Escopo desta rodada: o diff da correção (`git diff --stat 838012d..5f310f9` → só `tests/ai-study/s5-report.test.mjs`, +28/-5; nenhum arquivo de `src/` mudou), todo veredicto que não foi PASS na Round 2 (**C50, C51, C59**) e os checks cuja prova o diff tocou (**C42, C43**). O PASS de C42 da Round 2 foi julgado de novo, sem herdar o veredicto. Os outros 54 checks têm o julgamento de asserção **carregado** (de `b2520fe`; C41 e C44–C58 com citações reconferidas em `c23dddc` e de novo aqui). As provas dos 59 checks rodaram de novo em `5f310f9`. O diff acrescentou 23 linhas antes da linha 191 de `s5-report.test.mjs`, e todas as citações desse arquivo a partir de `:169` foram atualizadas e reconferidas com `rg -n`/`sed -n`. Os demais arquivos de teste e `src/` não mudaram desde `b2520fe` (`git diff --stat b2520fe..5f310f9 -- . ':!.specs'` → só `s5-report.test.mjs`), e as citações deles seguem válidas.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas e das mutações. As mutações rodaram num `git worktree add --detach <scratchpad>/wt 5f310f9` descartável, removido ao final (`git worktree list` só mostra o checkout principal e `prb-7`). Não chamei LM Studio, Jev, nenhum modelo nem a rede real e não procurei segredos.

**Resultado em uma linha:** 55 de 59 checks provados, com teste nomeado executado em `5f310f9` e asserção localizada. **C42 perde o PASS:** a nova asserção mata as três mutações pedidas, mas três mutações de prosa fixa que chegam ao Markdown verificado sobrevivem pelas brechas dos termos técnicos e da remoção de dados (M4, M5, M6). Outras três sobrevivem porque estão em ramos do gerador que C42 e C43 nunca renderizam (M8–M10). **C50 e C51** continuam sem evidência live real e **C59** continua sem teste nem implementação. O veredicto segue FAIL.

## Novo julgamento de C42

Verified at 5f310f9. A Round 2 deu PASS a C42 com uma lista fechada de palavras inglesas e registrou como lacuna residual a mutação `'nenhum'` → `'nothing'`, que sobrevivia. O review do PR #7 mostrou que `Não avaliados` → `Summary overview` também passava. Logo, aquele PASS não se sustentava: a asserção não provava o valor do check. A correção `5f310f9` trocou a lista de palavras inglesas por uma lista de permissões. `assertPortugueseProse` (`tests/ai-study/s5-report.test.mjs:191-199`) remove cercas `text` (`:168`), crases (`:193`) e dados gravados (`withoutRecordedData`, `:190`: objetos `{...}`, IDs `R01-evaluate-en` e qualquer palavra snake_case). Depois exige que toda sequência de 2+ letras pertença a `PORTUGUESE_VOCABULARY` (`:171-187`) ou a `TECHNICAL_TERMS` (`:188`): `assert.deepEqual(unknown, [], 'prosa do relatório fora do vocabulário em português')` (`:198`).

Julguei de forma adversarial se isso prova "prosa fica em português". A lista de permissões fecha as rotas da Round 2: palavra inglesa nova, com ou sem acento, fica vermelha (M1, M2, M3, M7). Restam três brechas reais. Em todas, prosa fixa do gerador vai para o inglês e C42 continua verde:

1. **Termos técnicos que também são palavras inglesas.** `TECHNICAL_TERMS` aceita `no`, `yes`, `hash`, `corpus`, `template`, `tokens`, `runtime`, `download`, `timeouts` e `id`. O vocabulário "português" aceita `as`, `do`, `real`, `local`, `original`, `literal` e `meta`, que também são palavras inglesas. Um rótulo fixo montado só com essas palavras passa. M4 (`Hash do corpus` → `Corpus hash`, `src/ai-study/report.mjs:227`) e M5 (vazio `'nenhum'` → `'no'`, `report.mjs:55`) chegam ao Markdown de C42 (sonda: `- Corpus hash: \`sha256:…\`` e `- Não executados: no`) e sobrevivem.
2. **Remoção de dados por formato, não por origem.** `withoutRecordedData` apaga qualquer palavra snake_case e tudo entre a primeira `{` e a última `}` da linha, venha do dado gravado ou do texto fixo do gerador. M6 (`Não avaliados` → `not_evaluated`, `report.mjs:246`) chega ao Markdown (`- not_evaluated: \`R12-evaluate-en\` — …`) e sobrevive. A remoção gulosa de `{.*}` também apaga a prosa fixa entre dois JSON na mesma linha. Isso acontece, por exemplo, com `; memória:` em `report.mjs:281` quando tokens e memória vêm disponíveis numa coleta live. Esse caso não foi exercitado.
3. **Prosa fixa em ramos que nenhum teste renderiza.** A asserção só vê o Markdown de uma coleta fixture completa (C42) e a seção Comparação Jev de uma coleta live (C43). Ficam sem verificação de idioma 10 dos 13 `REASON_LABELS` (`report.mjs:29-43`; só `pt_missing`, `en_missing` e `pt_invalid` aparecem), 3 dos 4 `STATUS_LABELS` (`:22-27`), `estado desconhecido`, as linhas de falha, bloqueio, erro de comparação e arquivos ignorados (`:251-256`), `Nenhuma tradução concluída` (`:270`), `(ainda inexistente)` (`:299`), `Comparação ausente` (`:320`), `Nenhum par completo.` (`:348`), `Nenhuma avaliação concluída.` (`:358`), `não registrada (preencher …)` (`:386`) e os problemas das provas live (`:125-186`), que C43 não verifica porque só checa a seção Jev. M8 (`:33`), M9 (`:386`) e M10 (`:255`) sobrevivem sem chegar ao Markdown verificado (sonda: 0 ocorrências).

**Veredicto sobre C42: NÃO PROVADO em `5f310f9`.** As partes "seis seções na ordem" (`:256`, `:260`) e "originais literais" (`:271-272`, `:274`) seguem provadas. A parte "prosa fica em português" não está: o teste é muito mais forte que o da Round 2, mas três mutações de prosa fixa que alcançam o Markdown verificado sobrevivem, e uma brecha real impede o PASS. Não registro isso como lacuna residual. É a mesma classe de erro que a Round 2 cometeu ao aprovar com M3 vivo. **C43 continua PASS:** o claim de C43 trata de contagens e denominadores, e as asserções dele (`:290-292`, `:299-300`) não dependem da asserção de idioma. A asserção de idioma em `:304` é um reforço, e M3 morre nela.

### Mutações em C42 e C43

Verified at 5f310f9. Cada mutação foi aplicada sozinha em `src/ai-study/report.mjs` no worktree descartável e desfeita com `git checkout -- src tests`. A prova mais estreita foi `node --test --test-reporter=tap --test-name-pattern='^(C42|C43):' tests/ai-study/s5-report.test.mjs`. Linha de base: `ok 1 - C42`, `ok 2 - C43`, exit 0. Nos mutantes vivos, uma sonda temporária no teste, só no worktree, gravou o Markdown entregue a `assertPortugueseProse` para mostrar se o mutante chega à asserção.

| Mutação | Local | Rota de fuga tentada | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| M1 `Não avaliados` → `Summary overview` | `report.mjs:246` | caso do review do PR #7 | morta (C42) | `not ok 1 - C42`, `prosa do relatório fora do vocabulário em português`, `'Summary — - Summary overview:  — '`, exit 1 |
| M2 vazio `'nenhum'` → `'nothing'` | `report.mjs:55` | sobrevivente da Round 2 | morta (C42) | `'nothing — - Não executados: nothing'`, exit 1 |
| M3 frase fixa da Comparação Jev em inglês (`Agreement with the answer key is a descriptive measure, counted apart from integration success.`) | `report.mjs:326` | frase inteira | morta (C42 e C43) | `'Agreement — …'`, `'with — …'`, `'the — …'`, exit 1 |
| M4 `Hash do corpus` → `Corpus hash` | `report.mjs:227` | só palavras de `TECHNICAL_TERMS` | **sobrevive** | `ok 1 - C42`, `ok 2 - C43`, exit 0; sonda: `- Corpus hash: \`sha256:d9c2…\`` está no Markdown verificado |
| M5 vazio `'nenhum'` → `'no'` | `report.mjs:55` | palavra inglesa que é termo técnico (`no`) | **sobrevive** | exit 0; sonda: `- Não executados: no` |
| M6 `Não avaliados` → `not_evaluated` | `report.mjs:246` | inglês no formato que a asserção remove como dado (snake_case) | **sobrevive** | exit 0; sonda: `- not_evaluated: \`R12-evaluate-en\` — …` |
| M7 `Não avaliados` → `Résumé` | `report.mjs:246` | palavra inglesa com acento | morta (C42) | `'Résumé — - Résumé:  — '`, exit 1 |
| M8 `en_invalid: 'braço EN inválido'` → `'EN arm invalid'` | `report.mjs:33` | ramo não renderizado | **sobrevive** | exit 0; sonda: 0 ocorrências no Markdown verificado |
| M9 `não registrada (preencher … em …)` → `not recorded (fill … in …)` | `report.mjs:386` | ramo não renderizado (C42 grava recomendação) | **sobrevive** | exit 0; sonda: 0 ocorrências |
| M10 `Erro ao gravar a comparação` → `Failed to write the comparison` | `report.mjs:255` | ramo não renderizado | **sobrevive** | exit 0; sonda: 0 ocorrências |

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. A correção não tocou interface. A feature não tem tela (`plan.md`, Observable: "Tela ... n/a"). Não alego contradição nem ausência de contradição.

## Provas executadas

Verified at 5f310f9. Todas as provas rodaram numa única invocação:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'` → exit 0. TAP: `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, com `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez, como `ok N - C<n>`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

C50, C51 e C59 não entram nesse lote. Rodei cada um separadamente:

- Sem `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^C50:'`, e o mesmo com `^C51:` e `^C59:`. Os três deram `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, `make: *** [Makefile:43: check-proof] Error 1` e exit 2. O Makefile só inclui `tests/ai-study/live/*.test.mjs` quando `RUN_ID` é informado (`Makefile:6`).
- Com `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^(C50|C51):' RUN_ID=verifier-r3-no-evidence`. Os testes **existem e executam**, mas falham: `not ok 1 - C50:` e `not ok 2 - C51:`, os dois com `error: 'RUN_ID verifier-r3-no-evidence não tem evidências em .../prb-7/artifacts/ai-study/verifier-r3-no-evidence'`. Resultado: `# tests 2 # pass 0 # fail 2`, exit 2. Nenhum arquivo foi criado (`ls artifacts` → inexistente). O checkout principal (`/home/junior/apps/jm/probe`) também não tem `artifacts/ai-study`.
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`: os 56 checks e três testes de apoio (`s1-corpus.test.mjs:40`, `s3-jev.test.mjs:600` e `s5-report.test.mjs:503`, este último deslocado de `:480`).
- `npm run check` → exit 0.

**Existência.** Verified at 5f310f9 para `s5-report.test.mjs`; o resto vem carried from b2520fe. `rg -n "^test\('" tests/ai-study/s5-report.test.mjs tests/ai-study/live/s5-live.test.mjs` mostra C41–C49, C54 e C56–C58 em `s5-report.test.mjs` (`:201,235,277,309,352,390,426,455,480,544,556,587,609`) e C50/C51 em `live/s5-live.test.mjs` (`:17,26`). `rg -n "C59|local_token_count" src tests` → nenhum resultado (exit 1), e `@lmstudio/sdk` não está em `package.json`: C59 continua sem teste.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção de cada linha. Em todas as linhas, o `Proof run` é a execução desta rodada em `5f310f9`.

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
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:210` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:217-218` - nenhuma leitura fora da execução, corpus atual não lido; `:220-228` + `:119` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | ordem: `s5-report.test.mjs:256` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:260`; literais: `:271-272`, `:274`. **Prosa em português:** `:259` - `assertPortugueseProse(markdown)` → `:198` `assert.deepEqual(unknown, [], 'prosa do relatório fora do vocabulário em português')`. Essa asserção não prova o valor: M4, M5 e M6 sobrevivem e chegam ao Markdown verificado, pelas isenções de `:188` e `:190`; M8–M10 sobrevivem em ramos que não são renderizados (ver "Novo julgamento de C42") | NÃO PROVADO - asserção não prova "prosa fica em português" | verified at 5f310f9 |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:290-292` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:299-300` - `assert.deepEqual(individual[j], ...)` / `assert.deepEqual(paired[j], ...)`; `:304` - `assertPortugueseProse(jev)`, reforço que não faz parte do claim (M3 morta) | PASS | verified at 5f310f9 |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:322-324` - contagens e entradas com `output_sha256`, revisor e justificativa; `:328-340` - recusas com código 2; `:341` - relatório anterior intacto | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:362` - `'evidence_complete'`; `:368-369` - `'inconclusive'` + `['review_pending']`; `:383-386` - falha e `interrupted` → `inconclusive`, sem erro pareado | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:398-400` - `não registrada` e nenhuma decisão no texto; `:405-406` - estado técnico inalterado + `Recomendação humana`; `:423` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:444-445` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:451` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:462-463` - textos das limitações; `:465` - `acurácia` uma vez; `:466` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho | `ok 52 - C49:` | `s5-report.test.mjs:488-489` - marca de simulação na saída e nas limitações; `:494` - `Conclusão: \`inconclusive\``; `:496` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:500` - live sem a marca | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C50 | evidência **live real** T01–T06: servidor/modelo Q6_K, template confirmado, contagem, seis EN→PT, durações | sem `RUN_ID`: 0 testes, exit 2; com `RUN_ID=verifier-r3-no-evidence`: `not ok 1 - C50:`, exit 2 | no evidence: não há coleta live real (`artifacts/ai-study/` não existe no worktree nem no checkout principal). Asserções que a fechariam: `live/s5-live.test.mjs:20-21` - `assert.deepEqual(proof.problems, [])` + `assert.equal(proof.proven, true)`. Bloqueios inalterados: `src/ai-study/template.mjs:14` `official: false` (Decisão 1) e `src/ai-study/lmstudio.mjs:43-44` `countTokens` → `{ count: null, ... }` (Decisão 2) | NÃO PROVADO - bloqueado | verified at 5f310f9 |
| C51 | evidência **live real** de ≥1 caso R: PT→EN + duas respostas Jev da mesma versão, seis válidos cada | idem: 0 testes sem `RUN_ID`; `not ok 2 - C51:` com `RUN_ID` | no evidence: mesma ausência de coleta. Asserções que a fechariam: `live/s5-live.test.mjs:29` - `assert.equal(proof.proven, true, ...)`; `:31` - seis resultados por braço. Bloqueios: os de C50, mais as condições de entrada da S5 (rubricas revisadas, campo `model` do Jev) | NÃO PROVADO - bloqueado | verified at 5f310f9 |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:550` - `assert.equal(result.shimCalls, '', ...)`; `:552` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:583` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:579-581` - `[omitido]` presente | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:605` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:606` - nenhuma execução removida | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:616-628` (13 variantes) + `:631` `report(..., { expect: 2 })` → `:119` `assert.equal(result.nodeStatus, expect, ...)`; `:632` - `assert.match(refused.stderr, pattern, runId)`; `:633` - nenhum relatório | PASS | carried from b2520fe; citações atualizadas em 5f310f9 |
| C59 | até 18 contagens de tokens em orçamento próprio `local_token_count`; 19ª bloqueada; falhas contadas; uma chamada por vez; sem retry do `@lmstudio/sdk` | `^C59:` → `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, exit 2 | no evidence: `rg -n "C59\|local_token_count" src tests` sem resultados; `@lmstudio/sdk` ausente de `package.json`; `src/ai-study/lmstudio.mjs:42-44` - "Sem pedido HTTP: não consome chamada do orçamento", `countTokens` devolve `count: null`; `checks.md:199` - "pendente, não construído" | NÃO PROVADO - não construído | verified at 5f310f9 |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Verified at 5f310f9, a partir da alocação em `checks.md:269-273` e dos veredictos acima:

- **AC 1–26, 28–32, 34–37:** fechadas. Todos os checks alocados são PASS. AC 3 inclui C3 + C52 + C54, e AC 10 inclui C10 + C53.
- **AC 33:** **aberta.** C42 não prova "prosa fica em português" (ver "Novo julgamento de C42").
- **AC 27:** **aberta.** C31 é PASS, mas C59 (emenda de 01/10/2026, orçamento de contagem de tokens) não tem prova.
- **Fora da tabela de ACs:** os "Independent test" da S2 (C50) e da S3 (C51) continuam abertos. Nenhuma tradução real e nenhuma avaliação Jev real foram observadas.

### Nível e amostragem

- **C42, "prosa fica em português"** (verified at 5f310f9): a asserção já está no nível certo, sobre o Markdown gerado pela fronteira `make`. A falha está na amostragem e na precisão. A amostragem só renderiza dois estados do gerador (fixture completa; seção Jev de uma coleta live parcial), mas o claim cobre toda a prosa do relatório, inclusive rótulos de ramos que esses estados não alcançam (M8–M10). A precisão falha porque as isenções da lista de permissões aceitam palavras inglesas (M4–M6).
- Os demais itens são carried from b2520fe. Claims de código de saída passam pela fronteira `make` (`assertUsageFailure`, `s1-commands.test.mjs:39-41`; `report`, `s5-report.test.mjs:119`). C25, C27 e C28 cobrem cada linha das tabelas de decisão. C31 prova a borda 20/21 no orçamento e na coleta (`s4-limits.test.mjs:141-169`).

## Swept existing re-read

Carried from b2520fe. A correção não tocou `checks.md` nem `plan.md`. A seção `Swept` (`checks.md:316-326`) só aponta para checks. A única decisão `existing` do plano, Observable/Harness (tlc-spec-lean instalada, perfil `light`), continua no código (`checks.md:3`).

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Verified at 5f310f9. Perfil `light`: a injeção formal de falhas **não é exigida**, e não alego cobertura de mutação da feature. A pedido desta rodada, injetei dez mutantes só na superfície de idioma de C42/C43 que a correção criou (detalhes em "Mutações em C42 e C43"): quatro mortos e **seis sobreviventes**.

| Mutação | Location | Killed |
| --- | --- | --- |
| M1 `Não avaliados` → `Summary overview` | `src/ai-study/report.mjs:246` | yes (C42) |
| M2 `'nenhum'` → `'nothing'` | `src/ai-study/report.mjs:55` | yes (C42) |
| M3 frase fixa da Comparação Jev em inglês | `src/ai-study/report.mjs:326` | yes (C42, C43) |
| M4 `Hash do corpus` → `Corpus hash` | `src/ai-study/report.mjs:227` | no - sobrevive a C42 e C43 (isenção `TECHNICAL_TERMS`, `s5-report.test.mjs:188`) |
| M5 `'nenhum'` → `'no'` | `src/ai-study/report.mjs:55` | no - sobrevive (`no` em `TECHNICAL_TERMS`) |
| M6 `Não avaliados` → `not_evaluated` | `src/ai-study/report.mjs:246` | no - sobrevive (remoção snake_case, `s5-report.test.mjs:190`) |
| M7 `Não avaliados` → `Résumé` | `src/ai-study/report.mjs:246` | yes (C42) |
| M8 `en_invalid` → `'EN arm invalid'` | `src/ai-study/report.mjs:33` | no - ramo não renderizado |
| M9 `não registrada (preencher …)` → `not recorded (fill …)` | `src/ai-study/report.mjs:386` | no - ramo não renderizado |
| M10 `Erro ao gravar a comparação` → `Failed to write the comparison` | `src/ai-study/report.mjs:255` | no - ramo não renderizado |

## Observations (non-blocking)

Carried from b2520fe e reconfirmadas:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.
2. C50/C51: o `RUN_ID` que os fechar precisa vir de uma coleta live autorizada. O verificador da rodada seguinte deve conferir a proveniência real, não só o teste verde (STATE.md, escolha 5 da S5).

Novas nesta rodada (verified at 5f310f9):

3. `PORTUGUESE_VOCABULARY` (`s5-report.test.mjs:171-187`) foi montado a partir do texto que as fixtures de C42/C43 renderizam hoje. Inclui palavras que só existem nas fixtures do teste, como `falsa`, `ampliar` e `preservado`. Qualquer frase portuguesa nova no gerador, ou texto livre novo numa fixture, quebra o teste até entrar na lista. É risco de falso vermelho, não de falso verde, e é a troca declarada no comentário de `:169-170`.
4. A observação 3 da Round 2 (`status`, `state` e `run` em `ENGLISH_WORDS`) caiu com a remoção dessa lista.

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 2 - scoped** (`42f101e..c23dddc`, commit do relatório `838012d`): FAIL, 56/59. C50 e C51 sem evidência live real, C59 não construído e AC 27 aberta. C42 recebeu PASS com uma lista fechada de palavras inglesas (`ENGLISH_WORDS`). Matava `Não avaliados` → `Not evaluated`, uma frase do aviso simulado e a legenda do denominador Jev. A mutação `'nenhum'` → `'nothing'` sobrevivia e foi registrada como lacuna residual de precisão, sem tirar o PASS. **Erro de julgamento, corrigido nesta rodada:** com um mutante vivo que chega ao Markdown verificado, a asserção não provava o valor do check. O review do PR #7 confirmou com `Summary overview`. Gate → exit 1. Lição L-005 registrada. Relatório completo em `git show 838012d:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 1 - full** (feature inteira, `4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59. C50 e C51 sem evidência live real, C59 não construído e AC 27 aberta. C42 recebeu PASS com uma asserção (`assertNoBareCodes`) que não provava "prosa fica em português", erro corrigido na Round 2. Gate → exit 1. Relatório em `git show 42f101e:.specs/features/jev-translation-feasibility/verification.md`.
- Rodadas de escopo S1–S4, anteriores à Round 1 da feature inteira: Rodada 5 (S1–S4, `5417c97..7868a78`) PASS em 43/43 construídos, relatório em `git show b2520fe:.specs/features/jev-translation-feasibility/verification.md`. Rodada 4 (S4, `864b31b`) FAIL em C55, lição L-004. Rodada 3 (S4, `4470b14`) FAIL em C36/C39/C40, lições L-001 a L-003. Rodadas 2 (S3, `4eea13b`) e 1 (S1+S2, `166a2b9`) PASS nos checks então construídos.

## Gate

Verified at 5f310f9:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0. Faltam C50, C51 e C59. C42 está verde, mas não está provado (ver acima).
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0.
- C50/C51 sem `RUN_ID`: 0 testes, exit 2. Com `RUN_ID=verifier-r3-no-evidence`: 0 passed, 2 failed, exit 2. C59: 0 testes, exit 2.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify` (1 erro, 0 avisos).
- `git status --porcelain`: vazio antes; vazio depois das provas e das mutações; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`, ` M .specs/LESSONS.md` e ` M .specs/lessons.json`, os dois últimos gravados por `lessons.py`.

## Lições

Registradas por `scripts/lessons.py add` (exit 0 nas duas chamadas):

- **L-006** (nova, `surviving_mutant`, escopo `report`, candidata): "Exempt from a language allowlist only tokens that cannot spell prose, since technical terms and stripped data patterns that are also foreign words let a foreign label through". A fonte é M4/M5/M6 (`src/ai-study/report.mjs:227,55,246`; `tests/ai-study/s5-report.test.mjs:188,190`). A L-005 não cobre esse caso: ela trata da lista fechada de palavras estrangeiras, não das isenções de uma lista de permissões.
- **L-005** (existente, atualizada, sem nova lição): a L-005 já diz para conferir o idioma contra os rótulos fixos que o gerador emite. Isso cobre M8–M10, prosa fixa em ramos que o Markdown de teste não renderiza. Reenviei o texto idêntico com a fonte M8/M9/M10 (`src/ai-study/report.mjs:33,386,255`). O script deduplicou (`UPDATED L-005`) e só acrescentou a evidência; a recorrência segue 1 porque é a mesma feature.

Não registrei:

- o erro de julgamento da Round 2 em C42, porque é comportamento do verificador, ou seja, fluxo da skill (`references/memory.md`, "Scope discipline");
- C59, porque a causa é fluxo (check de emenda sem slice que o construa) e a lição de código correlata já existe como L-003;
- C50/C51, porque a causa é pré-requisito externo (template oficial, contagem de tokens, autorização da coleta live), não falha de execução neste código.
