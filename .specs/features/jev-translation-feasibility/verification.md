# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: 3416c78..0893f6f (`0893f6f test(ai-study): catch codes printed instead of catalogue labels in C42`; HEAD = `0893f6f`, confirmado com `git rev-parse HEAD` → `0893f6f7d507e24a0f533b87d7258917c046b779`). A feature inteira é `4a1acfe..0893f6f`. A Round 1 cobriu `4a1acfe..b2520fe`, a Round 2 `42f101e..c23dddc`, a Round 3 `838012d..5f310f9`, a Round 4 `4dacc6b..b5f0668` e a Round 5 `d6440be..580258d`.
**Round**: 6 - scoped (terceira rodada além do limite de três do harness, **autorizada explicitamente pelo usuário em 02/10/2026**, para reavaliar C42 depois de `0893f6f`)
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação nem das correções; os relatórios das Rounds 1–5 serviram só para delimitar o escopo e para a lista de mutações (E1–E6, N1–N6), nunca como prova

Escopo desta rodada: o diff `git diff --stat 3416c78..0893f6f` (só `tests/ai-study/s5-report.test.mjs`, +7/-4), todo veredicto que não foi PASS na Round 5 (**C42, C50, C51, C59**) e, como o diff mexe no arquivo de teste da S5, os checks desse arquivo: **C41, C43–C49, C54 e C56–C58**. Nesses checks as provas rodaram de novo e as citações foram atualizadas. `src/` não mudou no diff (`git diff --stat 3416c78..0893f6f -- src` vazio), então o julgamento das asserções de C41 e C43–C58 é **carregado** (de `b2520fe`/`b5f0668`); só os números de linha se deslocaram. C42 foi julgado de novo. Os outros 41 checks (C1–C40, C52, C53, C55) têm o julgamento **carregado** de `b2520fe`: os arquivos deles não mudaram. As provas dos 59 checks rodaram de novo em `0893f6f`.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas, das mutações e da remoção do worktree. As mutações rodaram num `git worktree add --detach` descartável em `0893f6f`, no scratchpad, removido ao final (`git worktree list` mostra só o checkout principal e `prb-7`). Não chamei LM Studio, Jev, nenhum modelo nem a rede de serviço e não procurei segredos. Consulta externa, só de leitura: os cards PRB-8 e PRB-11 no tracker (sem mudança desde a criação, `updatedAt` 2026-10-02T13:30–13:31Z).

**Resultado em uma linha:** 56 de 59 checks provados, com teste nomeado executado em `0893f6f` e asserção localizada. **C42 passa a PASS:** `0893f6f` mata N5 por duas asserções independentes (`:277` e `:273`), e a mesma rota (código no lugar do rótulo) morre também em `OUTCOME_LABELS` (N7), `REASON_LABELS` (N6, via C43), `ARM_LABELS` da linha de avaliações válidas (N8, via C43) e na troca da chave de `STATUS_LABELS` (N10). N1, N2 e N4 da Round 5 também morrem agora. Sobrevivem E2, E4 e N3 (ofuscação deliberada, já aceitas nas rodadas anteriores) e duas novas, N9 e N12, que julgo não bloqueantes (ver "Julgamento de C42"). **C50 e C51** continuam sem evidência live real (PRB-11, bloqueado por PRB-8, PRB-9 e PRB-10) e **C59** continua sem teste nem implementação (PRB-8). O veredicto segue FAIL.

## Julgamento de C42 (Round 6)

Verified at 0893f6f. O que `0893f6f` muda em `tests/ai-study/s5-report.test.mjs`:

- `:166` - `EVIDENCE_CODES` passa a ser montado a partir das chaves de `REPORT_TEXT.reasons`, `statuses` e `outcomes` (20 códigos, antes 13). `assertNoBareCodes` (`:167-170`) remove cercas e trechos entre crases e assere `assert.doesNotMatch(prose, EVIDENCE_CODES, 'código em inglês solto na prosa')` (`:169`). C42 chama sobre o Markdown inteiro (`:273`); C43 sobre a seção Comparação Jev (`:320`).
- `:277` - `assert.match(section(markdown, 'Completude'), /^- Estado técnico: \`completed\` — coleta concluída, motivo /m)`: o rótulo do catálogo, não o código.
- `:205` - `assert.deepEqual(source.match(/^\s*import\b.*$/gm), REPORT_IMPORTS, ...)`: toda linha `import`, com ou sem `;`.
- `:200` - `isTextCall` exige `/(?:^|[^\w.$])text\($/`: `.text(` e `$text(` não contam como chave.

### (a) A correção mata N5 de verdade?

Sim, e não depende de um caso isolado. Mutações aplicadas uma de cada vez no worktree descartável e desfeitas com `git checkout -- src tests` (porcelain do worktree vazio antes de cada uma). Prova mais estreita: `node --test --test-reporter=tap --test-name-pattern='^(C42|C43):' tests/ai-study/s5-report.test.mjs`. Linha de base: `ok 1 - C42`, `ok 2 - C43`, exit 0. Para cada sobrevivente rodei também a suíte `s5-report.test.mjs` inteira e `npm test`. **Sonda:** `make ai-study-run RUN_ID=probe` + `make ai-study-report RUN_ID=probe` (fixture, dentro do worktree descartável), lendo a linha afetada do Markdown. Na linha de base: `- Estado técnico: \`completed\` — coleta concluída`, `- Não executados: nenhum`, cabeçalho de tabela `| Julgamento | PT (original) acertos | … |`.

- **Independência das duas guardas sobre N5.** N5b (N5 com `assertNoBareCodes(markdown)` removido do teste) morre em `:277`. N5c (N5 com `:277` removido) morre em `:273`/`:169`. Cada guarda sozinha mata N5.
- **Outros pontos do mesmo padrão em `report.mjs`.** As consultas a rótulo são cinco: `REASON_LABELS` (`report.mjs:27`), `ARM_LABELS` (`:183`, cabeçalhos das tabelas, e `:348`, avaliações válidas), `STATUS_LABELS` (`:229`) e `OUTCOME_LABELS` (`:376`). Testei todas (N5–N9, N12) e uma troca de chave (N10).

| Mutação | Local | Rota de fuga tentada | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| N1 import novo sem `;` de `review.mjs` + `empty = NOTHING` | `src/ai-study/report.mjs:6,26`, `src/ai-study/review.mjs` | pino de imports | **morta (C42) - fechada** | `imports do gerador fora do conjunto revisado` (`:205`), exit 1 |
| N2 `raw.text('none')` com `raw = { text: (k) => k }` | `src/ai-study/report.mjs:25-26` | `text` membro conta como chave | **morta (C42) - fechada** | `texto fora do catálogo em report.mjs` (`:206`, `isTextCall` em `:200`), exit 1 |
| N3 `empty = /nothing/.source` | `src/ai-study/report.mjs:26` | texto em regex | sobrevive (ofuscação) | exit 0; `s5-report` 14/14; `npm test` 59/59; sonda `- Não executados: nothing` |
| N4 `empty = Object.keys(OUTCOME_LABELS)[2]` | `src/ai-study/report.mjs:26` | chave do catálogo emitida sem literal | **morta (C42) - fechada** | `código em inglês solto na prosa` (`:169`), exit 1. Controle N4b (N4 sem `:273`): sobrevive, sonda `… absent` - só a guarda renderizada a pega |
| N5 `STATUS_LABELS[manifest.status]` → `manifest.status` | `src/ai-study/report.mjs:229` | código no lugar do rótulo do estado técnico | **morta (C42) - fechada** | `código em inglês solto na prosa` (`:169`), exit 1 |
| N5b N5 + remover `assertNoBareCodes(markdown)` do teste | idem + `tests/ai-study/s5-report.test.mjs:273` | só a asserção dirigida | morta (C42) | `The input did not match the regular expression /^- Estado técnico: \`completed\` — coleta concluída, motivo /m` (`:277`) |
| N5c N5 + remover a asserção `:277` do teste | idem + `tests/ai-study/s5-report.test.mjs:277` | só a guarda geral | morta (C42) | `código em inglês solto na prosa` (`:169`) |
| N6 `` `${REASON_LABELS[reason]} (…)` `` → `` `${reason} (…)` `` | `src/ai-study/report.mjs:27` | mesma rota, motivos | morta (C43) | `/^- \`R02\`: braço PT inválido \(\`pt_invalid\`\)$/m` (`:318`) não casa; C42 verde (o relatório de C42 não tem motivo do catálogo) |
| N7 `OUTCOME_LABELS[j.outcome]` → `j.outcome` (os dois braços) | `src/ai-study/report.mjs:376` | mesma rota, resultados | morta (C42 e C43) | `código em inglês solto na prosa` nos dois testes (`:273`, `:320`) |
| N8 `ARM_LABELS[arm]` → `arm` em `jevValid` | `src/ai-study/report.mjs:348` | mesma rota, braços | morta (C43) | `/^- Avaliações válidas PT \(original\): 1 de 12$/m` (`:306`) não casa; `npm test` 58/59; sonda `- Avaliações válidas pt: 12 de 12` |
| N9 (nova) `ARM_LABELS[arm]` → `arm` nos cabeçalhos das tabelas | `src/ai-study/report.mjs:183` | mesma rota, cabeçalho de tabela | **sobrevive** | exit 0; `s5-report` 14/14; `npm test` 59/59; sonda `\| Julgamento \| pt acertos \| pt erros \| pt sem avaliação \| en acertos \| …` |
| N10 (nova) `STATUS_LABELS[manifest.status]` → `STATUS_LABELS[manifest.reason]` | `src/ai-study/report.mjs:229` | chave errada na consulta, cai no rótulo genérico | morta (C42) | `:277` não casa |
| N11 (nova) `empty = '\x68\x69\x74'` (`hit`) | `src/ai-study/report.mjs:26` | escape que o leitor não decodifica, soletrando um código | morta (C42) | `código em inglês solto na prosa` (`:169`): o leitor estático não vê, a guarda renderizada vê |
| N12 (nova) `label: (manifest.failure ? manifest.status : STATUS_LABELS[manifest.status]) ?? …` | `src/ai-study/report.mjs:229` | omitir o rótulo só em coletas com falha | **sobrevive** | exit 0; `s5-report` 14/14; `npm test` 59/59. Nenhum teste aplica `assertNoBareCodes` a um relatório com `failure` (C45 em `:388-402` gera um, mas não chama a guarda) |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` (`passed`) | `src/ai-study/report.mjs:26` | escape com palavra fora dos códigos | sobrevive (ofuscação) | exit 0; 14/14; 59/59; sonda `… passed` |
| E4 `empty = Object.keys({ nothing: text('none') })[0]` | `src/ai-study/report.mjs:26` | texto por nome de propriedade | sobrevive (ofuscação) | exit 0; 14/14; 59/59; sonda `… nothing` |

### (b) A ampliação de `EVIDENCE_CODES` gera falso positivo em texto legítimo?

Não no texto que o gerador produz. Conferi os 20 códigos contra todo o catálogo (`REPORT_TEXT.lines` e os mapas), com o conteúdo entre crases removido: o único acerto é o marcador `{completed}` de `completenessItems` (`- Itens planejados: {planned}; concluídos: {completed}`), que é interpolado com um número e nunca chega ao Markdown. Os rótulos dos mapas não contêm nenhum código. Na linha de base, C42 e C43 passam (`ok 45`, `ok 46` no lote) com a guarda nova sobre o Markdown inteiro de C42.

Dois limites, não bloqueantes (Observação 7): o `\b` do JavaScript é ASCII, então `\bmiss\b` casa em "missão" e `\bhit\b` em "hitória"; e a guarda também varre o texto livre das evidências (justificativas, `problems`, mensagens). Uma fixture futura com uma dessas palavras quebraria o teste sem defeito no gerador. Hoje nenhuma fixture faz isso.

### (c) As sobreviventes impedem o PASS?

Mesmo critério das Rounds 4 e 5: um mutante plausível (o erro simples de quem escreve o gerador) que viola o claim impede o PASS. Uma rota que exige escrever o texto de forma deliberadamente indireta é lacuna de precisão de prioridade baixa.

- **E2, E4, N3:** ofuscação deliberada, como antes. Não impedem.
- **N9:** é a mesma omissão plausível de N5, mas o que ela imprime são os códigos `pt` e `en`, que não são prosa em inglês. O cabeçalho continua em português (`pt acertos`, `en sem avaliação`) e o braço continua identificado. Não viola "prosa em português" (C42) nem "por julgamento e braço" (C43). É uma regressão de apresentação que nenhum teste vê: lacuna de precisão, (a) 1. Não impede.
- **N12:** viola o claim (um relatório de coleta com falha mostraria `incomplete — incomplete`), mas só com um desvio condicional escrito de propósito: não é a omissão de uma consulta, e sim um ramo novo que ignora o rótulo. Uma omissão simples na única linha de consulta (`report.mjs:229`) morre (N5, N10). É a mesma classe de E2/E4/N3. Não impede, mas a amostragem da guarda renderizada (só o estado `completed`) fica registrada em "Nível e amostragem" e em (a) 2.

**Veredicto sobre C42: PASS em `0893f6f`.** O que prova cada parte do claim:

- "seis seções na ordem": `:269` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:274`;
- "originais literais": `:287-288`, `:290`;
- "todo texto fixo vem do catálogo com hash fixado": `:205-211`;
- "prosa renderizada sem código no lugar do rótulo": `:273` (guarda geral, regex em `:166`) e `:277` (rótulo do estado técnico);
- "português do catálogo aprovado por humano": comentário `issuecomment-5954258912` do PR #7 com o hash `sha256:e9a1e00a…327b` = `PINNED_REPORT_TEXT` (`:176`), aceito na Round 5 com a ressalva de atribuição (conta compartilhada com agentes, Observação 4). O catálogo não mudou (`git diff --stat 3416c78..0893f6f -- src` vazio).

### (d) Citações de `s5-report.test.mjs`

`0893f6f` acrescentou 1 linha líquida antes de `:172` (comentário de 2 linhas no lugar de 1) e 2 linhas em C42 (`:276-277`). Conferi mecanicamente, com `difflib` entre `3416c78` e `0893f6f`, as 96 linhas desse arquivo citadas nas linhas de C41–C58 da Round 5: `:121` não mudou; as linhas de `:205` a `:273` andaram +1; as de `:284` em diante andaram +3; `:199` e `:204` são as linhas alteradas pela correção (agora `:200` e `:205`). Nenhuma outra diferença de texto.

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. O diff não tocou interface. A feature não tem tela (`plan.md`, Observable: "Tela ... n/a"). Não alego contradição nem ausência de contradição.

## Provas executadas

Verified at 0893f6f. Todas as provas rodaram numa única invocação:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'` → exit 0. TAP: `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, com `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez, como `ok N - C<n>`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

C50, C51 e C59 não entram nesse lote. Rodei cada um separadamente:

- Sem `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^C50:'`, e o mesmo com `^C51:` e `^C59:`. Os três deram `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, `make: *** [Makefile:43: check-proof] Error 1` e exit 2.
- Com `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^(C50|C51):' RUN_ID=verifier-r6-no-evidence`. Os testes **existem e executam**, mas falham: `not ok 1 - C50:` e `not ok 2 - C51:`, os dois com `error: 'RUN_ID verifier-r6-no-evidence não tem evidências em .../prb-7/artifacts/ai-study/verifier-r6-no-evidence'`. Resultado: `# tests 2 # pass 0 # fail 2`, exit 2. Nenhum arquivo foi criado (`ls artifacts` → inexistente).
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`: os 56 checks e três testes de apoio.
- `npm run check` → exit 0.

**Existência.** Verified at 0893f6f. `rg -n "^test\('" tests/ai-study/s5-report.test.mjs tests/ai-study/live/s5-live.test.mjs` mostra C41–C49, C54 e C56–C58 em `s5-report.test.mjs` (`:214,248,293,325,368,406,442,471,496,560,572,603,625`) e C50/C51 em `live/s5-live.test.mjs` (`:17,26`). `rg -n "C59|local_token_count" src tests` → nenhum resultado (exit 1), e `@lmstudio/sdk` não está em `package.json` (`grep -c` = 0): C59 continua sem teste.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção de cada linha. Em todas as linhas, o `Proof run` é a execução desta rodada em `0893f6f`.

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
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:223` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:230-231` - nenhuma leitura fora da execução, corpus atual não lido; `:233-241` + `:121` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | ordem: `s5-report.test.mjs:269` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:274`; literais: `:287-288`, `:290`; texto fixo só do catálogo: `:205-211` (imports, prosa, contextos, chaves, `PINNED_REPORT_TEXT`, `REVIEWED_TEXT_FUNCTION`); prosa renderizada sem código no lugar do rótulo: `:273` - `assertNoBareCodes(markdown)` → `:169` `assert.doesNotMatch(prose, EVIDENCE_CODES, ...)` (códigos de `reasons`/`statuses`/`outcomes`, `:166`) e `:277` - `assert.match(section(markdown, 'Completude'), /^- Estado técnico: \`completed\` — coleta concluída, motivo /m)`; aprovação humana localizada: PR #7 `issuecomment-5954258912` (ressalva de atribuição, Observação 4). N5 morta por `:273` e `:277` independentemente; sobreviventes E2/E4/N3/N12 exigem escrita deliberada, N9 não produz prosa em inglês ("Julgamento de C42" (c)) | PASS | verified at 0893f6f |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:306-308` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:315-316` - `assert.deepEqual(individual[j], ...)` / `assert.deepEqual(paired[j], ...)`; `:320` - `assertNoBareCodes(jev)` (reforço fora do claim) | PASS | carried from b5f0668; prova e citações verified at 0893f6f |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:338-340` - contagens e entradas com `output_sha256`, revisor e justificativa; `:344-356` - recusas com código 2; `:357` - relatório anterior intacto | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:378` - `'evidence_complete'`; `:384-385` - `'inconclusive'` + `['review_pending']`; `:399-402` - falha e `interrupted` → `inconclusive`, sem erro pareado | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:414-416` - `não registrada` e nenhuma decisão no texto; `:421-422` - estado técnico inalterado + `Recomendação humana`; `:439` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:460-461` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:467` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:478-479` - textos das limitações; `:481` - `acurácia` uma vez; `:482` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho | `ok 52 - C49:` | `s5-report.test.mjs:504-505` - marca de simulação na saída e nas limitações; `:510` - `Conclusão: \`inconclusive\``; `:512` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:516` - live sem a marca | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C50 | evidência **live real** T01–T06: servidor/modelo Q6_K, template confirmado, contagem, seis EN→PT, durações | sem `RUN_ID`: 0 testes, exit 2; com `RUN_ID=verifier-r6-no-evidence`: `not ok 1 - C50:`, exit 2 | no evidence: não há coleta live real (`artifacts/ai-study/` não existe). Asserções que a fechariam: `live/s5-live.test.mjs:20-21` - `assert.deepEqual(proof.problems, [])` + `assert.equal(proof.proven, true)`. Bloqueios inalterados: `src/ai-study/template.mjs:14` `official: false` (Decisão 1, PRB-9) e `src/ai-study/lmstudio.mjs:43-44` `countTokens` → `{ count: null, ... }` (Decisão 2, PRB-8). Card da coleta: PRB-11 | NÃO PROVADO - bloqueado (PRB-11 ← PRB-8, PRB-9, PRB-10) | verified at 0893f6f |
| C51 | evidência **live real** de ≥1 caso R: PT→EN + duas respostas Jev da mesma versão, seis válidos cada | idem: 0 testes sem `RUN_ID`; `not ok 2 - C51:` com `RUN_ID` | no evidence: mesma ausência de coleta. Asserções que a fechariam: `live/s5-live.test.mjs:29` - `assert.equal(proof.proven, true, ...)`; `:31` - seis resultados por braço. Bloqueios: os de C50, mais as rubricas revisadas e o campo `model` do Jev (PRB-10) | NÃO PROVADO - bloqueado (PRB-11 ← PRB-8, PRB-9, PRB-10) | verified at 0893f6f |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:566` - `assert.equal(result.shimCalls, '', ...)`; `:568` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:599` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:595-597` - `[omitido]` presente | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:621` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:622` - nenhuma execução removida | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:632-644` (13 variantes) + `:647` `report(..., { expect: 2 })` → `:121` `assert.equal(result.nodeStatus, expect, ...)`; `:648` - `assert.match(refused.stderr, pattern, runId)`; `:649` - nenhum relatório | PASS | carried from b2520fe; prova e citações verified at 0893f6f |
| C59 | até 18 contagens de tokens em orçamento próprio `local_token_count`; 19ª bloqueada; falhas contadas; uma chamada por vez; sem retry do `@lmstudio/sdk` | `^C59:` → `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, exit 2 | no evidence: `rg -n "C59\|local_token_count" src tests` sem resultados; `@lmstudio/sdk` ausente de `package.json`; `src/ai-study/lmstudio.mjs:42-44` - "Sem pedido HTTP: não consome chamada do orçamento", `countTokens` devolve `count: null`; `checks.md:199` - "pendente, não construído". Card: PRB-8 | NÃO PROVADO - não construído (PRB-8) | verified at 0893f6f |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Verified at 0893f6f, a partir da alocação em `checks.md:269-273` e dos veredictos acima:

- **AC 1–26, 28–37:** fechadas. Todos os checks alocados são PASS. AC 3 inclui C3 + C52 + C54, e AC 10 inclui C10 + C53. **AC 33 fecha nesta rodada** (C42 PASS).
- **AC 27:** **aberta.** C31 é PASS, mas C59 (emenda de 01/10/2026, orçamento de contagem de tokens) não tem prova (PRB-8).
- **Fora da tabela de ACs:** os "Independent test" da S2 (C50) e da S3 (C51) continuam abertos (PRB-11). Nenhuma tradução real e nenhuma avaliação Jev real foram observadas.

### Nível e amostragem

- **C42, "prosa fica em português"** (verified at 0893f6f): a prova combina três níveis. Estático sobre a fonte do gerador e do catálogo (`:205-211`), que cobre o texto **fixo** em todos os ramos, inclusive os não renderizados. Renderizado sobre o Markdown inteiro de uma coleta fixture concluída (`:273`, `:277`), que cobre o caminho dos dados: rótulos consultados a partir de códigos. E a aprovação humana do catálogo. A amostra renderizada tem um estado técnico (`completed`), sem motivos do catálogo; os motivos e os braços são cobertos pela seção Jev de C43 (`:318-320`, `:306-307`). Como `report.mjs:229` é a única linha que consulta `STATUS_LABELS`, uma omissão simples vale para todos os estados e morre (N5, N10). Um desvio só para coletas com falha (N12) não morre: a guarda renderizada não roda sobre nenhum relatório com `failure`.
- Os demais itens são carried from b2520fe. Claims de código de saída passam pela fronteira `make` (`assertUsageFailure`, `s1-commands.test.mjs:39-41`; `report`, `s5-report.test.mjs:121`). C25, C27 e C28 cobrem cada linha das tabelas de decisão. C31 prova a borda 20/21 no orçamento e na coleta (`s4-limits.test.mjs:141-169`).

## Swept existing re-read

Carried from b2520fe. O diff não tocou `checks.md` nem `plan.md`. A seção `Swept` (`checks.md:316-326`) só aponta para checks. A única decisão `existing` do plano, Observable/Harness (tlc-spec-lean instalada, perfil `light`), continua no código (`checks.md:3`).

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Verified at 0893f6f. Perfil `light`: a injeção formal de falhas **não é exigida**, e não alego cobertura de mutação da feature. A pedido desta rodada, injetei 16 mutantes na superfície de idioma de C42 e C43 (detalhes em "Julgamento de C42" (a)), mais 2 controles que removem uma asserção do teste (N5b, N5c) e 1 controle de N4 (N4b). Dos 16: 11 mortos e **5 sobreviventes** (E2, E4, N3, N9, N12). Nenhum sobrevivente é uma omissão plausível que viole o claim (julgamento em (c)), mas cada um fica registrado aqui como `no`.

| Mutação | Location | Killed |
| --- | --- | --- |
| N1 import novo sem `;` de `review.mjs` | `src/ai-study/report.mjs:6`, `tests/ai-study/s5-report.test.mjs:205` | yes (C42, `:205`) - fechada por `0893f6f` |
| N2 `raw.text('none')` | `src/ai-study/report.mjs:25-26`, `tests/ai-study/s5-report.test.mjs:200` | yes (C42, `:206`) - fechada por `0893f6f` |
| N3 `empty = /nothing/.source` | `src/ai-study/report.mjs:26` | no - sobrevive (regex pulada pelo leitor; ofuscação) |
| N4 `empty = Object.keys(OUTCOME_LABELS)[2]` | `src/ai-study/report.mjs:26` | yes (C42, `:273`) - fechada por `0893f6f` |
| N5 `STATUS_LABELS[manifest.status]` → `manifest.status` | `src/ai-study/report.mjs:229` | yes (C42, `:273` e `:277`, cada uma sozinha: N5b, N5c) - fechada por `0893f6f` |
| N6 `REASON_LABELS[reason]` → `reason` | `src/ai-study/report.mjs:27` | yes (C43, `:318`) |
| N7 `OUTCOME_LABELS[…]` → código | `src/ai-study/report.mjs:376` | yes (C42 `:273`, C43 `:320`) |
| N8 `ARM_LABELS[arm]` → `arm` em `jevValid` | `src/ai-study/report.mjs:348` | yes (C43, `:306`) |
| N9 `ARM_LABELS[arm]` → `arm` nos cabeçalhos das tabelas | `src/ai-study/report.mjs:183` | no - sobrevive em `npm test` (59/59); cabeçalho `pt acertos`, sem prosa em inglês |
| N10 `STATUS_LABELS[manifest.reason]` | `src/ai-study/report.mjs:229` | yes (C42, `:277`) |
| N11 `empty = '\x68\x69\x74'` (`hit`) | `src/ai-study/report.mjs:26` | yes (C42, `:273`) |
| N12 rótulo omitido só com `manifest.failure` | `src/ai-study/report.mjs:229` | no - sobrevive em `npm test` (59/59); desvio condicional deliberado |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` (`passed`) | `src/ai-study/report.mjs:26` | no - sobrevive (escape não decodificado, `tests/ai-study/s5-report.test.mjs:202`; palavra fora de `EVIDENCE_CODES`) |
| E4 `Object.keys({ nothing: … })[0]` | `src/ai-study/report.mjs:26` | no - sobrevive (sem literal) |

## Observations (non-blocking)

Carried from b2520fe e reconfirmadas:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.
2. C50/C51: o `RUN_ID` que os fechar precisa vir de uma coleta live autorizada. O verificador da rodada seguinte deve conferir a proveniência real, não só o teste verde (STATE.md, escolha 5 da S5; critério de aceite de PRB-11).

Carried from b5f0668:

3. O texto livre gravado nas evidências pelo próprio sistema (`problems` do Jev, `failure.message`, `comparison_error`, justificativas) entra no relatório como dado, fora do catálogo, e continua fora do claim de C42.

Carried from 580258d (`src/` e os pinos não mudaram):

4. **Atribuição da aprovação.** O comentário `issuecomment-5954258912` sai da mesma conta usada por agentes. Aceito o registro, mas a autoria humana vem da declaração, não da conta.
5. **Pinos opacos.** `REVIEWED_CODE_CONTEXTS` e `REVIEWED_TEXT_FUNCTION` (`tests/ai-study/s5-report.test.mjs:177-178`) se chamam "reviewed", mas não têm lista legível nem registro de revisão.
6. `codeContexts` é um conjunto de linhas (`:204`). Um literal de código novo, numa linha idêntica a uma já revisada, não muda o hash.

Novas nesta rodada (verified at 0893f6f):

7. **Limites de `EVIDENCE_CODES`** (`:166`). O `\b` do JavaScript é ASCII: `\bmiss\b` casa em "missão" e `\bhit\b` em "hitória". Como a guarda varre também o texto livre das evidências (Observação 3), uma fixture futura com essas palavras quebraria o teste sem defeito no gerador. Hoje nenhuma faz isso. Sugestão: usar `(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])` com a flag `u`.
8. **Sumário no stdout.** `formatReportSummary` (`src/ai-study/report.mjs:461`) imprime o estado técnico como código, sem rótulo, por desenho. Fica fora do claim de C42, que é sobre o Markdown.

## Lacunas

Ranqueadas.

**(a) Corrigíveis no código**

1. **C59: teste e implementação inexistentes** (`checks.md:199`; `src/ai-study/lmstudio.mjs:42-44`). É código, mas depende das confirmações de API da Decisão 2. Card **PRB-8** (também bloqueia PRB-11). É a única lacuna de código que mantém o FAIL.
2. **C42/C43, cabeçalhos das tabelas (N9, não bloqueante)** - `src/ai-study/report.mjs:183`: nenhum teste lê a linha de cabeçalho das tabelas de contagem (`countsTable` em `tests/ai-study/s5-report.test.mjs:151-161` só lê linhas de julgamento). Correção: asserir em C43 a linha `| Julgamento | PT (original) acertos | … |`.
3. **C42, guarda renderizada só sobre coleta concluída (N12, não bloqueante)** - aplicar `assertNoBareCodes` também aos relatórios com `failure` e `interrupted` de C45 (`tests/ai-study/s5-report.test.mjs:395-402`).
4. **C42, leitor (E2, E4, N3, não bloqueantes)** - `tests/ai-study/s5-report.test.mjs:202`: decodificar escapes antes do teste de letras; tratar regex e nomes de propriedade como literais. Todos exigem ofuscação.

**(b) Bloqueadas por pré-requisitos externos**

1. **C50:** coleta live real T01–T06. Card **PRB-11**, bloqueado por **PRB-8** (contagem de tokens, `src/ai-study/lmstudio.mjs:43-44`) e **PRB-9** (template oficial e conferência do GGUF, `src/ai-study/template.mjs:14`), mais a autorização explícita da coleta.
2. **C51:** coleta live real de ≥1 caso R com Jev. Card **PRB-11**, bloqueado por PRB-8, PRB-9 e **PRB-10** (revisão humana das rubricas Jev e campo `model` da resposta).
3. (Opcional, não bloqueia) **C42, atribuição da aprovação humana:** uma aprovação postada de uma conta usada só pelo usuário, ou um commit ou tag assinado, daria um registro que se sustenta sem a declaração dele (Observação 4).

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 5 - scoped** (`d6440be..580258d`, commit do relatório `3416c78`): FAIL, 55/59. **Correção de registro (Round 6):** o relatório da Round 5 dizia que a rodada foi "autorizada pelo usuário". Isso estava errado: a Round 5 foi **despachada pelo coordenador sem autorização explícita da rodada**. O usuário tinha aprovado o português do catálogo, não uma rodada extra. O coordenador informou o erro no brief da Round 6. A aprovação humana do hash do catálogo (PR #7, `issuecomment-5954258912`) foi aceita, com a ressalva da conta compartilhada com agentes. `e5fa347` fechou E1, E3, E5 e E6. C42 ficou NÃO PROVADO pela mutação plausível N5 (código `manifest.status` impresso no lugar do rótulo de `STATUS_LABELS`, `report.mjs:229`, verde em `npm test`). Outras sobreviventes: N1–N4, E2, E4. C50 e C51 sem evidência live real (PRB-11) e C59 não construído (PRB-8). Gate → exit 1. L-008 registrada. Relatório em `git show 3416c78:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 4 - scoped** (`4dacc6b..b5f0668`, commit do relatório `d6440be`): FAIL, 55/59. Primeira rodada além do limite, autorizada pelo usuário. C42 passou a ser provado por varredura estática de `report.mjs` e pelo hash do catálogo `REPORT_TEXT`, e as 12 mutações plausíveis (K1–K6, G1–G6) morreram. Seis rotas sobreviveram (E1–E6) e foram julgadas lacunas de precisão. C42 ficou NÃO PROVADO porque a aprovação humana do hash `sha256:e9a1e00a…327b` não estava no PR #7 citado. C50 e C51 sem evidência live real e C59 não construído. Gate → exit 1. L-006 atualizada e L-007 registrada. Relatório em `git show d6440be:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 3 - scoped** (`838012d..5f310f9`, commit do relatório `4dacc6b`): FAIL, 55/59. C42 perdeu o PASS: a lista de permissões sobre o Markdown renderizado deixava passar M4–M6, e M8–M10 estavam em ramos não renderizados. Gate → exit 1. L-006 registrada; L-005 atualizada. Relatório em `git show 4dacc6b:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 2 - scoped** (`42f101e..c23dddc`, commit do relatório `838012d`): FAIL, 56/59. C42 recebeu PASS com um mutante vivo (`'nenhum'` → `'nothing'`), erro de julgamento corrigido na Round 3. Gate → exit 1. L-005 registrada. Relatório em `git show 838012d:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 1 - full** (feature inteira, `4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59. C42 recebeu PASS com uma asserção (`assertNoBareCodes`) que não provava "prosa fica em português", erro corrigido na Round 2. Gate → exit 1. Relatório em `git show 42f101e:.specs/features/jev-translation-feasibility/verification.md`.
- Rodadas de escopo S1–S4, anteriores à Round 1 da feature inteira: Rodada 5 (S1–S4, `5417c97..7868a78`) PASS em 43/43 construídos, relatório em `git show b2520fe:.specs/features/jev-translation-feasibility/verification.md`. Rodada 4 (S4, `864b31b`) FAIL em C55, lição L-004. Rodada 3 (S4, `4470b14`) FAIL em C36/C39/C40, lições L-001 a L-003. Rodadas 2 (S3, `4eea13b`) e 1 (S1+S2, `166a2b9`) PASS nos checks então construídos.

## Gate

Verified at 0893f6f:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0. Faltam C50, C51 e C59.
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0.
- C50/C51 sem `RUN_ID`: 0 testes, exit 2. Com `RUN_ID=verifier-r6-no-evidence`: 0 passed, 2 failed, exit 2. C59: 0 testes, exit 2.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify` (1 erro, 0 avisos).
- `git status --porcelain`: vazio antes; vazio depois das provas, das mutações e da remoção do worktree; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`.

## Lições

Nenhuma lição nova registrada; `lessons.py` não foi chamado. As falhas fundamentadas desta rodada já estão cobertas:

- N9 e N12 são rótulo do catálogo não asserido no Markdown renderizado, exatamente o caso da **L-008** ("Assert the rendered label wherever generated text maps a stored code to a catalogue label…"). N12 é a mesma lição aplicada a outra amostra (coleta com falha).
- E2, E4 e N3 exigem ofuscação e ficam na família da **L-006**/**L-007**.
- O falso positivo latente do `\b` ASCII (Observação 7) é uma fragilidade do teste, não uma falha observada.
- C59, C50 e C51 têm causa em fluxo e pré-requisitos externos (PRB-8 a PRB-11), não em falha de execução neste código.
