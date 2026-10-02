# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: 4dacc6b..b5f0668 (correção "catálogo aprovado" de C42: `33d8d8e refactor(ai-study): move all fixed report text into an approved catalogue` e `b5f0668 docs(ai-study): record human approval of the report text catalogue`; HEAD = `b5f0668`, confirmado com `git rev-parse HEAD`). A feature inteira é `4a1acfe..b5f0668`. A Round 1 cobriu `4a1acfe..b2520fe`, a Round 2 `42f101e..c23dddc` e a Round 3 `838012d..5f310f9`.
**Round**: 4 - scoped (rodada além do limite de três do harness, **autorizada pelo usuário** depois da Round 3, junto com a decisão pela correção "catálogo aprovado")
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação nem das correções; os relatórios das Rounds 1–3 serviram só para delimitar o escopo, nunca como prova

Escopo desta rodada: o diff da correção (`git diff --stat 4dacc6b..b5f0668` → `src/ai-study/report-text.mjs` novo, +218; `src/ai-study/report.mjs`, refatoração com 352 linhas alteradas; `tests/ai-study/s5-report.test.mjs`, +27/-36; `tests/ai-study/support/source-literals.mjs` novo, +72), todo veredicto que não foi PASS na Round 3 (**C42, C50, C51, C59**) e, como o diff reescreveu `report.mjs`, todos os checks que geram relatório: **C41–C49, C54 e C56–C58**. Nesses checks as provas rodaram de novo e as citações foram atualizadas. O julgamento das asserções de C41 e C44–C58 vem de `b2520fe`, porque nenhuma delas mudou no diff; só os números de linha se deslocaram. C42 e C43 foram julgados de novo. Os outros 41 checks (C1–C40, C52, C53, C55) têm o julgamento **carregado** de `b2520fe`: os arquivos de teste e de `src/` deles não mudaram desde então (`git diff --stat 5f310f9..b5f0668 -- . ':!.specs'` → só os quatro arquivos acima). As provas dos 59 checks rodaram de novo em `b5f0668`.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas, das mutações e da remoção dos worktrees. Mutações e comparação de saída rodaram em `git worktree add --detach` descartáveis no scratchpad (`wt` em `b5f0668` e `old` em `5f310f9`), removidos ao final (`git worktree list` mostra só o checkout principal e `prb-7`). Não chamei LM Studio, Jev, nenhum modelo nem a rede de serviço e não procurei segredos. A única consulta externa foi a leitura, só de leitura, dos comentários do PR #7 com `gh api`, para conferir o registro da aprovação humana (ver (b) abaixo).

**Resultado em uma linha:** 55 de 59 checks provados, com teste nomeado executado em `b5f0668` e asserção localizada. **C42 continua NÃO PROVADO, agora por outro motivo.** O mecanismo novo funciona: as 12 mutações plausíveis morrem, inclusive as seis que escaparam na Round 3 (M4, M5, M6, M8–M10), aplicadas ao catálogo e ao gerador. Os seis sobreviventes exigem ofuscação ou texto vindo de fora dos dois artefatos cobertos, e julgo que não impediriam o PASS. Mas a prova de "português" passou a ser a aprovação humana do catálogo, e ela **não está no lugar citado**: o PR #7 não tem nenhum registro de aprovação humana. O último registro sobre o catálogo é a revisão do Codex, que diz textualmente não ser aprovação humana. **C50 e C51** continuam sem evidência live real e **C59** continua sem teste nem implementação. O veredicto segue FAIL.

## Julgamento de C42 (Round 4)

Verified at b5f0668. C42 deixou de inspecionar o Markdown renderizado. Agora há três provas mecânicas e uma humana:

- **Varredura estática** de `src/ai-study/report.mjs` por `sourceLiterals` (`tests/ai-study/support/source-literals.mjs:5-72`). Todo literal com letras precisa ser chave existente em `text('…')`, código de `REPORT_CODE_LITERALS` (`tests/ai-study/s5-report.test.mjs:177-182`) ou caminho de import: `assert.deepEqual(prose, [], 'texto fora do catálogo em report.mjs')` (`:193`).
- **Chaves:** toda chave usada existe (`:194`) e toda chave do catálogo é usada (`:195`).
- **Hash:** `assert.equal(sha256(JSON.stringify(REPORT_TEXT)), APPROVED_REPORT_TEXT, 'catálogo do relatório diferente do aprovado')` (`:196`), com `APPROVED_REPORT_TEXT` fixado em `:174`.
- **Português:** a aprovação humana do catálogo com esse hash, registrada em `src/ai-study/report-text.mjs:3-4` e `tests/ai-study/s5-report.test.mjs:171-173`.

### (a) A varredura garante que nenhum texto fixo chega à saída sem passar pelo catálogo?

Para o que é plausível, sim. O leitor de literais acerta em `report.mjs`. Ele acha 329 literais, e nenhuma das 264 strings entre aspas simples de uma varredura ingênua por linha ficou de fora. Os literais com letras que sobram são exatamente os 29 de `REPORT_CODE_LITERALS`. As partes de template saem separadas das expressões `${}`, inclusive em templates aninhados. A regex com crase de `report.mjs:164` é pulada corretamente. As 12 mutações plausíveis morrem, seis no catálogo (pelo hash) e seis no gerador (pela varredura), inclusive as variantes de gerador que mantêm a chave em uso para escapar de `:195`.

Seis rotas sobrevivem. Todas chegam ao Markdown de C42 (sonda abaixo):

1. **Resíduo declarado (E1).** Um literal exatamente igual a um código listado, emitido sem crases, passa. Exemplo: `'absent'` no lugar de `text('none')`. Dos 29 códigos, 14 são palavras inglesas (`absent`, `pending`, `complete`, `valid`, `live` etc.). É a mesma classe da L-006, uma isenção que pode soletrar prosa. O alcance, porém, é bem menor que o da Round 3. A isenção vale para o literal inteiro e só no código-fonte de `report.mjs`, não para cada palavra do Markdown renderizado. Qualquer frase, rótulo com espaço ou pontuação, ou palavra inglesa fora dessa lista morre.
2. **Escape hexadecimal (E2).** `'\x70\x61\x73\x73\x65\x64'` (`passed`) passa, porque o filtro `l.value.replace(/\\./g, '')` (`s5-report.test.mjs:190`) remove a barra e a letra seguinte sem decodificar o escape, e o resto só tem dígitos. Isso exige ofuscação deliberada.
3. **Código da função `text()` (E3).** O hash cobre `JSON.stringify(REPORT_TEXT)`, só os dados. A função `text` (`src/ai-study/report-text.mjs:211-217`) fica fora do hash e da varredura. Um `if (key === 'none') return 'none';` passa.
4. **Nome de propriedade (E4).** `Object.keys({ nothing: … })[0]` emite texto sem literal.
5. **Texto importado de outro módulo (E5).** A varredura cobre só `report.mjs`. Uma constante `'nothing'` exportada por `review.mjs` e importada passa. Hoje nenhum valor importado que chega à saída é prosa: `ARMS` (`pt`/`en`), `MAX_INPUT_TOKENS`, `CANDIDATE_QUANTIZATION` (`Q6_K`), `REVIEW_FILE` (`review.json`), `templateRevision`/`outputHash` (hashes). Conferi isso lendo `report.mjs:1-5` e cada uso.
6. **Classificação por `before.endsWith('text(')` (E6).** Uma função local `rawtext = (k) => k` chamada como `rawtext('none')` tem o literal classificado como chave. Como `none` é chave existente, a palavra inglesa `none` passa.

**Julgamento de (a):** nenhum dos seis sobreviventes impede o PASS sozinho. O critério de `verify.md` é "a assertion would pass under a plausible wrong implementation". E2, E4 e E6 só aparecem com ofuscação deliberada. E3 e E5 exigem pôr texto fixo em código fora dos dois artefatos cobertos, e conferi que hoje nenhum caminho desses carrega prosa. E1 exige que o literal inteiro coincida com um dos 14 códigos ingleses. Diferente da Round 3, todas as rotas plausíveis de regressão morrem: texto inglês no catálogo, ou literal inglês, frase ou rótulo no gerador. Registro os seis como lacunas de precisão corrigíveis no código (ver "Lacunas"), não como motivo de NÃO PROVADO.

### (b) O hash bate e a aprovação humana está registrada para esse hash?

- **Hash:** bate. Recalculei com o `sha256` do repositório: `sha256(JSON.stringify(REPORT_TEXT))` = `sha256:e9a1e00ae3811fa4d02bbf761d83ad2db9652b7760db53f827f368a7c03b327b`, igual a `s5-report.test.mjs:174`. O teste confirma em `:196` (`ok 45 - C42`). Os dados do catálogo não mudaram entre `33d8d8e` e `b5f0668`: o diff de `b5f0668` só troca as linhas de comentário `report-text.mjs:3-4` e `s5-report.test.mjs:171-172`.
- **Aprovação humana:** registrada **só no repositório e pelo autor**. Os registros são o comentário de `report-text.mjs:3-4` e de `s5-report.test.mjs:171-173` e a mensagem de `b5f0668`: "The user approved the Portuguese of the catalogue pinned by C42 (sha256:e9a1e00a...327b) on PR #7". O lugar citado **não tem essa aprovação**. Li os 7 comentários de revisão do PR #7 com `gh api repos/{owner}/{repo}/pulls/7/comments`. O PR não tem comentários de issue nem revisões com corpo. Encontrei:
  - às 11:32:13Z, o comentário do autor sobre `33d8d8e`: "**A revisão humana do português do catálogo está pendente neste PR.** A Round 4 só roda depois desse OK.";
  - às 11:37:51Z, o último registro do PR, a revisão do Codex sobre o mesmo hash: "Esta é uma revisão por agente, não aprovação humana formal; a anotação de revisão humana pendente deve permanecer até uma pessoa aprovar este hash.";
  - às 11:43:32Z (08:43:32 -0300), seis minutos depois, o commit `b5f0668` troca a anotação "pendente" por "aprovado pelo usuário … no PR #7". Nenhum registro no PR fica entre os dois.

  O brief desta rodada afirma que o usuário aprovou em 02/10/2026. Pode ser que a aprovação tenha sido dada fora do PR, na conversa. Mas o verificador não aceita a afirmação de um agente como aprovação do usuário, e a fonte citada contradiz o registro. Pelo critério "evidence or zero", a prova humana de "português" **não está localizada**.

### (c) A refatoração preservou a saída?

Sim. Num worktree descartável de `b5f0668`, instrumentei só o helper `report()` do teste para copiar as evidências de cada relatório gerado com sucesso pela suíte S5: 33 execuções, incluindo a de C42 e as live controladas de C43/C49. Depois gerei, com `buildReport` + `formatReportSummary` de cada commit (`5f310f9` e `b5f0668`), o Markdown e o resumo da CLI para as mesmas evidências e o mesmo `reviewPath`. Resultado de `diff -r`: **66 arquivos idênticos** (33 relatórios + 33 resumos). Esses dados renderizam 114 das 145 chaves do catálogo. Para as 31 que não aparecem (provas live, `estado desconhecido`, bloqueio, erro de comparação, comparação ausente, entre outras), fiz duas comparações estáticas. Todo trecho fixo de cada texto do catálogo existe literalmente em `report.mjs@5f310f9`. E todo literal com letras de `report.mjs@5f310f9` está no catálogo ou é um dos códigos listados. A ressalva é que essa parte compara texto, não saída.

### Mutações em C42 e C43

Verified at b5f0668. Cada mutação foi aplicada sozinha no worktree descartável e desfeita com `git checkout -- src tests` (porcelain do worktree vazio antes de cada uma). Prova mais estreita: `node --test --test-reporter=tap --test-name-pattern='^(C42|C43):' tests/ai-study/s5-report.test.mjs`. Linha de base: `ok 1 - C42`, `ok 2 - C43`, exit 0. Sonda: as 33 evidências da suíte foram renderizadas com o código mutado e contei as ocorrências do texto mutado no relatório de C42 e no total. "C42: 0" quer dizer ramo que o relatório de C42 não renderiza. Desde a Round 4, C42 não depende mais disso, porque a prova é estática.

| Mutação | Local | Rota de fuga tentada | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| K1 (M4) `Hash do corpus` → `Corpus hash` | `report-text.mjs:99` | termos técnicos no catálogo | morta (C42) | `not ok 1 - C42`, `catálogo do relatório diferente do aprovado`, exit 1; sonda C42: 1 |
| K2 (M5) `none: 'nenhum'` → `'no'` | `report-text.mjs:41` | palavra inglesa curta | morta (C42) | idem; sonda C42: 1 |
| K3 (M6) `Não avaliados` → `not_evaluated` | `report-text.mjs:121` | snake_case | morta (C42) | idem; sonda C42: 1 |
| K4 (M8) `en_invalid` → `EN arm invalid` | `report-text.mjs:28` | ramo não renderizado | morta (C42) | idem; sonda: 0 (o hash não depende de renderização) |
| K5 (M9) `não registrada (preencher …)` → `not recorded (fill …)` | `report-text.mjs:191` | ramo não renderizado em C42 | morta (C42) | idem; sonda C42: 0, total 28 |
| K6 (M10) `Erro ao gravar a comparação` → `Failed to write the comparison` | `report-text.mjs:125` | ramo não renderizado | morta (C42) | idem; sonda: 0 |
| G1 (M5) `list(…, empty = text('none'))` → `'no'` | `report.mjs:26` | literal inglês no gerador | morta (C42) | `texto fora do catálogo em report.mjs`, exit 1; sonda C42: 1 |
| G2 (M4) linha do hash em template literal `` `- Corpus hash: ${…}` ``, chave mantida em uso | `report.mjs:201` | template literal, sem deixar chave órfã | morta (C42) | `texto fora do catálogo em report.mjs`; sonda C42: 1 |
| G3 (M6) `'- not_evaluated: '` antes de `text('completenessSkipped', …)` | `report.mjs:234` | snake_case no gerador, chave mantida | morta (C42) | idem; sonda C42: 1 |
| G4 (M8) `reason === 'en_invalid' ? 'EN arm invalid' : …` | `report.mjs:27` | ramo não renderizado | morta (C42) | idem; sonda: 0 |
| G5 (M9) `` `not recorded (fill ${…})` `` antes da chave | `report.mjs:414` | ramo não renderizado em C42 | morta (C42) | idem; sonda C42: 0, total 28 |
| G6 (M10) `` `- Failed to write the comparison: ${…}` ``, chave mantida | `report.mjs:260` | ramo não renderizado | morta (C42) | idem; sonda: 0 |
| E1 `empty = text('none')` → `'absent'` | `report.mjs:26` | código de `REPORT_CODE_LITERALS` como prosa (resíduo declarado) | **sobrevive** | `ok 1 - C42`, `ok 2 - C43`, exit 0; sonda C42: 1 (`- Não executados: absent`) |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` (`passed`) | `report.mjs:26` | escape que o filtro não decodifica (`s5-report.test.mjs:190`) | **sobrevive** | exit 0; sonda C42: 1 (`- Não executados: passed`) |
| E3 `if (key === 'none') return 'none';` em `text()` | `report-text.mjs:211-213` | código do catálogo fora do hash | **sobrevive** | exit 0; sonda C42: 1 (`- Não executados: none`) |
| E4 `empty = Object.keys({ nothing: text('none') })[0]` | `report.mjs:26` | texto por nome de propriedade | **sobrevive** | exit 0; sonda C42: 1 (`- Não executados: nothing`) |
| E5 `export const NOTHING = 'nothing'` em `review.mjs`, importado e usado como `empty` | `review.mjs:10`, `report.mjs:4,26` | texto em módulo não varrido | **sobrevive** | exit 0; sonda C42: 1 |
| E6 `const rawtext = (key) => key;` e `rawtext('none')` | `report.mjs:25-26` | literal classificado como chave por `before.endsWith('text(')` | **sobrevive** | exit 0; sonda C42: 1 (`- Não executados: none`) |

C43 ficou verde em todas as mutações. Ela não depende de idioma desde `33d8d8e`: só tem `assertNoBareCodes(jev)` (`s5-report.test.mjs:303`), e o claim de C43 é de contagens e denominadores (`:289-291`, `:298-299`).

**Veredicto sobre C42: NÃO PROVADO em `b5f0668` - aprovação humana não localizada.** As partes provadas são estas:
- "seis seções na ordem": `:254`, `:259`;
- "originais literais": `:270-271`, `:273`;
- "todo texto fixo vem do catálogo com hash fixado": `:193-196`.

Para a parte mecânica, julgo que a prova sustentaria o PASS ((a) acima). Mas o claim "prosa fica em português" agora se apoia, por desenho, na revisão humana do catálogo. Essa revisão está afirmada no código pelo autor e contradita pelo único registro na fonte citada. Isso é uma lacuna de evidência, não de código. Ela se fecha sem mudar código, com a aprovação do usuário registrada onde possa ser localizada (por exemplo, um comentário dele no PR #7 citando o hash `sha256:e9a1e00a…327b`). Com isso, uma nova rodada pode dar PASS a C42 sem repetir as mutações.

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. A correção não tocou interface. A feature não tem tela (`plan.md`, Observable: "Tela ... n/a"). Não alego contradição nem ausência de contradição.

## Provas executadas

Verified at b5f0668. Todas as provas rodaram numa única invocação:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'` → exit 0. TAP: `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, com `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez, como `ok N - C<n>`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

C50, C51 e C59 não entram nesse lote. Rodei cada um separadamente:

- Sem `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^C50:'`, e o mesmo com `^C51:` e `^C59:`. Os três deram `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, `make: *** [Makefile:43: check-proof] Error 1` e exit 2. O Makefile só inclui `tests/ai-study/live/*.test.mjs` quando `RUN_ID` é informado (`Makefile:6`).
- Com `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^(C50|C51):' RUN_ID=verifier-r4-no-evidence`. Os testes **existem e executam**, mas falham: `not ok 1 - C50:` e `not ok 2 - C51:`, os dois com `error: 'RUN_ID verifier-r4-no-evidence não tem evidências em .../prb-7/artifacts/ai-study/verifier-r4-no-evidence'`. Resultado: `# tests 2 # pass 0 # fail 2`, exit 2. Nenhum arquivo foi criado (`ls artifacts` → inexistente).
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`: os 56 checks e três testes de apoio (`s1-corpus.test.mjs:40`, `s3-jev.test.mjs:600` e `s5-report.test.mjs:502`).
- `npm run check` → exit 0. Agora inclui `tests/ai-study/support/*.mjs` e, portanto, `source-literals.mjs`. O `src/ai-study/*.mjs` inclui `report-text.mjs`.

**Existência.** Verified at b5f0668 para `s5-report.test.mjs`; o resto vem carried from b2520fe. `rg -n "^test\('" tests/ai-study/s5-report.test.mjs tests/ai-study/live/s5-live.test.mjs` mostra C41–C49, C54 e C56–C58 em `s5-report.test.mjs` (`:199,233,276,308,351,389,425,454,479,543,555,586,608`) e C50/C51 em `live/s5-live.test.mjs` (`:17,26`). `rg -n "C59|local_token_count" src tests` → nenhum resultado (exit 1), e `@lmstudio/sdk` não está em `package.json`: C59 continua sem teste.

**Citações de `s5-report.test.mjs`.** O diff acrescentou 2 linhas de import no topo e trocou o bloco de vocabulário (`:171-197`) e uma linha de C42 por duas. Por isso as citações até C42 andaram +2 (helper `report`, `:121`) ou -2 (corpo de C41), e as seguintes -1. Cada linha citada abaixo foi reconferida com `sed -n` em `b5f0668`.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção de cada linha. Em todas as linhas, o `Proof run` é a execução desta rodada em `b5f0668`.

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
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:208` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:215-216` - nenhuma leitura fora da execução, corpus atual não lido; `:218-226` + `:121` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | ordem: `s5-report.test.mjs:254` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:259`; literais: `:270-271`, `:273`; texto fixo só do catálogo: `:193` - `assert.deepEqual(prose, [], 'texto fora do catálogo em report.mjs')`, `:194-195`, `:196` - `assert.equal(sha256(JSON.stringify(REPORT_TEXT)), APPROVED_REPORT_TEXT, ...)`. **Português:** aprovação humana afirmada em `src/ai-study/report-text.mjs:3-4` e `s5-report.test.mjs:171-173` e não localizada no PR #7 citado: o último registro do PR (11:37:51Z) é a revisão do Codex, "não aprovação humana formal" (ver "Julgamento de C42") | NÃO PROVADO - aprovação humana do catálogo não localizada | verified at b5f0668 |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:289-291` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:298-299` - `assert.deepEqual(individual[j], ...)` / `assert.deepEqual(paired[j], ...)`; `:303` - `assertNoBareCodes(jev)` (reforço fora do claim) | PASS | verified at b5f0668 |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:321-323` - contagens e entradas com `output_sha256`, revisor e justificativa; `:327-339` - recusas com código 2; `:340` - relatório anterior intacto | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:361` - `'evidence_complete'`; `:367-368` - `'inconclusive'` + `['review_pending']`; `:382-385` - falha e `interrupted` → `inconclusive`, sem erro pareado | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:397-399` - `não registrada` e nenhuma decisão no texto; `:404-405` - estado técnico inalterado + `Recomendação humana`; `:422` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:443-444` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:450` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:461-462` - textos das limitações; `:464` - `acurácia` uma vez; `:465` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho | `ok 52 - C49:` | `s5-report.test.mjs:487-488` - marca de simulação na saída e nas limitações; `:493` - `Conclusão: \`inconclusive\``; `:495` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:499` - live sem a marca | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C50 | evidência **live real** T01–T06: servidor/modelo Q6_K, template confirmado, contagem, seis EN→PT, durações | sem `RUN_ID`: 0 testes, exit 2; com `RUN_ID=verifier-r4-no-evidence`: `not ok 1 - C50:`, exit 2 | no evidence: não há coleta live real (`artifacts/ai-study/` não existe). Asserções que a fechariam: `live/s5-live.test.mjs:20-21` - `assert.deepEqual(proof.problems, [])` + `assert.equal(proof.proven, true)`. Bloqueios inalterados: `src/ai-study/template.mjs:14` `official: false` (Decisão 1) e `src/ai-study/lmstudio.mjs:43-44` `countTokens` → `{ count: null, ... }` (Decisão 2) | NÃO PROVADO - bloqueado | verified at b5f0668 |
| C51 | evidência **live real** de ≥1 caso R: PT→EN + duas respostas Jev da mesma versão, seis válidos cada | idem: 0 testes sem `RUN_ID`; `not ok 2 - C51:` com `RUN_ID` | no evidence: mesma ausência de coleta. Asserções que a fechariam: `live/s5-live.test.mjs:29` - `assert.equal(proof.proven, true, ...)`; `:31` - seis resultados por braço. Bloqueios: os de C50, mais as condições de entrada da S5 (rubricas revisadas, campo `model` do Jev) | NÃO PROVADO - bloqueado | verified at b5f0668 |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:549` - `assert.equal(result.shimCalls, '', ...)`; `:551` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:582` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:578-580` - `[omitido]` presente | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:604` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:605` - nenhuma execução removida | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:615-627` (13 variantes) + `:630` `report(..., { expect: 2 })` → `:121` `assert.equal(result.nodeStatus, expect, ...)`; `:631` - `assert.match(refused.stderr, pattern, runId)`; `:632` - nenhum relatório | PASS | carried from b2520fe; prova e citações verified at b5f0668 |
| C59 | até 18 contagens de tokens em orçamento próprio `local_token_count`; 19ª bloqueada; falhas contadas; uma chamada por vez; sem retry do `@lmstudio/sdk` | `^C59:` → `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, exit 2 | no evidence: `rg -n "C59\|local_token_count" src tests` sem resultados; `@lmstudio/sdk` ausente de `package.json`; `src/ai-study/lmstudio.mjs:42-44` - "Sem pedido HTTP: não consome chamada do orçamento", `countTokens` devolve `count: null`; `checks.md:199` - "pendente, não construído" | NÃO PROVADO - não construído | verified at b5f0668 |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Verified at b5f0668, a partir da alocação em `checks.md:269-273` e dos veredictos acima:

- **AC 1–26, 28–32, 34–37:** fechadas. Todos os checks alocados são PASS. AC 3 inclui C3 + C52 + C54, e AC 10 inclui C10 + C53.
- **AC 33:** **aberta.** C42 está provado na parte mecânica (seções, literais, texto fixo só do catálogo com hash fixado), mas a prova de "português" é a aprovação humana do catálogo, que não foi localizada.
- **AC 27:** **aberta.** C31 é PASS, mas C59 (emenda de 01/10/2026, orçamento de contagem de tokens) não tem prova.
- **Fora da tabela de ACs:** os "Independent test" da S2 (C50) e da S3 (C51) continuam abertos. Nenhuma tradução real e nenhuma avaliação Jev real foram observadas.

### Nível e amostragem

- **C42, "prosa fica em português"** (verified at b5f0668): a prova saiu do Markdown renderizado e foi para a fonte do gerador. Isso resolve a amostragem da Round 3: os ramos não renderizados passam a ser cobertos (K4, K6, G4 e G6 morrem com sonda 0). Também resolve a precisão das isenções por palavra: não há mais lista de palavras. O nível é estático e não depende de fixture. Ficam como lacunas de precisão as seis rotas sobreviventes de (a). O juízo do idioma passou a ser humano por desenho, e essa evidência humana está ausente.
- Os demais itens são carried from b2520fe. Claims de código de saída passam pela fronteira `make` (`assertUsageFailure`, `s1-commands.test.mjs:39-41`; `report`, `s5-report.test.mjs:121`). C25, C27 e C28 cobrem cada linha das tabelas de decisão. C31 prova a borda 20/21 no orçamento e na coleta (`s4-limits.test.mjs:141-169`).

## Swept existing re-read

Carried from b2520fe. A correção não tocou `checks.md` nem `plan.md`. A seção `Swept` (`checks.md:316-326`) só aponta para checks. A única decisão `existing` do plano, Observable/Harness (tlc-spec-lean instalada, perfil `light`), continua no código (`checks.md:3`).

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Verified at b5f0668. Perfil `light`: a injeção formal de falhas **não é exigida**, e não alego cobertura de mutação da feature. A pedido desta rodada, injetei 18 mutantes na superfície de idioma de C42 que a correção criou (detalhes em "Mutações em C42 e C43"): 12 mortos e **6 sobreviventes**. Os sobreviventes são lacunas de precisão que julgo não plausíveis como implementação errada; o motivo de NÃO PROVADO em C42 é outro.

| Mutação | Location | Killed |
| --- | --- | --- |
| K1 (M4) `Hash do corpus` → `Corpus hash` | `src/ai-study/report-text.mjs:99` | yes (C42, hash) |
| K2 (M5) `'nenhum'` → `'no'` | `src/ai-study/report-text.mjs:41` | yes (C42, hash) |
| K3 (M6) `Não avaliados` → `not_evaluated` | `src/ai-study/report-text.mjs:121` | yes (C42, hash) |
| K4 (M8) `en_invalid` → `EN arm invalid` | `src/ai-study/report-text.mjs:28` | yes (C42, hash) |
| K5 (M9) `não registrada (preencher …)` → `not recorded (fill …)` | `src/ai-study/report-text.mjs:191` | yes (C42, hash) |
| K6 (M10) `Erro ao gravar a comparação` → `Failed to write the comparison` | `src/ai-study/report-text.mjs:125` | yes (C42, hash) |
| G1 (M5) `empty = 'no'` | `src/ai-study/report.mjs:26` | yes (C42, varredura) |
| G2 (M4) `` `- Corpus hash: ${…}` ``, chave mantida | `src/ai-study/report.mjs:201` | yes (C42, varredura) |
| G3 (M6) `'- not_evaluated: '`, chave mantida | `src/ai-study/report.mjs:234` | yes (C42, varredura) |
| G4 (M8) `'EN arm invalid'` em `reasonLabel` | `src/ai-study/report.mjs:27` | yes (C42, varredura) |
| G5 (M9) `` `not recorded (fill …)` ``, chave mantida | `src/ai-study/report.mjs:414` | yes (C42, varredura) |
| G6 (M10) `` `- Failed to write the comparison: …` ``, chave mantida | `src/ai-study/report.mjs:260` | yes (C42, varredura) |
| E1 `empty = 'absent'` (código listado, resíduo declarado) | `src/ai-study/report.mjs:26` | no - sobrevive (`REPORT_CODE_LITERALS`, `tests/ai-study/s5-report.test.mjs:177-182`) |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` | `src/ai-study/report.mjs:26` | no - sobrevive (escape não decodificado, `tests/ai-study/s5-report.test.mjs:190`) |
| E3 `text()` devolve `'none'` para a chave `none` | `src/ai-study/report-text.mjs:211-213` | no - sobrevive (função fora do hash) |
| E4 `Object.keys({ nothing: … })[0]` | `src/ai-study/report.mjs:26` | no - sobrevive (sem literal) |
| E5 constante `'nothing'` importada de `review.mjs` | `src/ai-study/review.mjs:10`, `src/ai-study/report.mjs:4` | no - sobrevive (módulo não varrido) |
| E6 `rawtext('none')` | `src/ai-study/report.mjs:25-26` | no - sobrevive (`before.endsWith('text(')`, `tests/ai-study/s5-report.test.mjs:188`) |

## Observations (non-blocking)

Carried from b2520fe e reconfirmadas:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.
2. C50/C51: o `RUN_ID` que os fechar precisa vir de uma coleta live autorizada. O verificador da rodada seguinte deve conferir a proveniência real, não só o teste verde (STATE.md, escolha 5 da S5).

Novas nesta rodada (verified at b5f0668):

3. A mensagem de `33d8d8e` diz "66 reports of the S5 suite". Encontrei 33 relatórios gerados com sucesso pela suíte. Os 66 arquivos idênticos da minha comparação são 33 relatórios mais 33 resumos da CLI. O resultado é o mesmo; só a contagem da mensagem é imprecisa.
4. Texto livre gravado nas evidências pelo próprio sistema (`problems` do Jev, `failure.message`, `comparison_error`, justificativas de runtime e de template) entra no relatório como dado, fora do catálogo. Ele não é coberto por C42, como nas rodadas anteriores. Um exemplo é `fetch failed`, mensagem do `TypeError` do transporte, que pode aparecer em `failure.message`. Registro como limite do claim, não como lacuna nova.
5. O catálogo aprovado tem termos técnicos e códigos dentro do texto (`comparison.json ausente`, `run_id: {run}`, `braço en não deriva…`). Esses casos são decisão editorial coberta pela revisão humana, não pela máquina.

## Lacunas

Ranqueadas.

**(a) Corrigíveis no código**

1. C42, precisão da varredura (E1): `REPORT_CODE_LITERALS` (`tests/ai-study/s5-report.test.mjs:177-182`) isenta códigos que também são palavras inglesas. Correção possível: exigir que um código listado só apareça como operando de comparação, chave de índice ou argumento de `code(…)`.
2. C42, escopo do hash (E3): o hash cobre só os dados de `REPORT_TEXT`. Fixar o hash dos bytes de `src/ai-study/report-text.mjs` inteiro, ou varrer também a função `text`.
3. C42, escopo da varredura (E5): só `report.mjs` é varrido. Restringir os bindings importados que o gerador pode renderizar, ou varrer os módulos importados.
4. C42, leitor de literais (E2, E6): decodificar escapes antes do teste de letras (`:190`) e reconhecer a chave pela chamada exata a `text` importada do catálogo, não por `before.endsWith('text(')` (`:188`). Exigem ofuscação; prioridade baixa.
5. C59: teste e implementação inexistentes (`checks.md:199`). A emenda à AC 27 precisa de um slice que a construa. O ponto de entrada provável é `src/ai-study/lmstudio.mjs:42-44`, e o bloqueio de C50 (contagem real de tokens) é compartilhado.

**(b) Bloqueadas por pré-requisitos externos**

1. C42 / AC 33: aprovação humana do catálogo `sha256:e9a1e00a…327b` registrada onde possa ser localizada. O PR #7 citado não a contém, e o último registro dele nega que a revisão do Codex seja aprovação. Fecha sem mudar código.
2. C50: coleta live real T01–T06, que depende do template oficial adotado (Decisão 1, `src/ai-study/template.mjs:14`), da contagem de tokens real (Decisão 2, `src/ai-study/lmstudio.mjs:43-44`) e da autorização da coleta.
3. C51: coleta live real de ≥1 caso R com Jev, que depende dos bloqueios de C50, das rubricas revisadas e do campo `model` do Jev.

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 3 - scoped** (`838012d..5f310f9`, commit do relatório `4dacc6b`): FAIL, 55/59. C42 perdeu o PASS. A lista de permissões `PORTUGUESE_VOCABULARY` + `TECHNICAL_TERMS` sobre o Markdown renderizado matava M1, M2, M3 e M7, mas três mutações de prosa fixa que chegavam ao Markdown verificado sobreviviam. M4 (`Corpus hash`) e M5 (`no`) passavam por termos isentos que também são palavras inglesas, e M6 (`not_evaluated`) pela remoção de snake_case como dado. Outras três (M8–M10) estavam em ramos que nenhum teste renderizava. C50 e C51 seguiam sem evidência live real e C59 não estava construído. Gate → exit 1. Lição L-006 registrada; L-005 atualizada com M8–M10. Relatório completo em `git show 4dacc6b:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 2 - scoped** (`42f101e..c23dddc`, commit do relatório `838012d`): FAIL, 56/59. C50 e C51 sem evidência live real, C59 não construído e AC 27 aberta. C42 recebeu PASS com uma lista fechada de palavras inglesas e um mutante vivo (`'nenhum'` → `'nothing'`). A Round 3 corrigiu esse erro de julgamento. Gate → exit 1. Lição L-005 registrada. Relatório em `git show 838012d:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 1 - full** (feature inteira, `4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59. C50 e C51 sem evidência live real, C59 não construído e AC 27 aberta. C42 recebeu PASS com uma asserção (`assertNoBareCodes`) que não provava "prosa fica em português", erro corrigido na Round 2. Gate → exit 1. Relatório em `git show 42f101e:.specs/features/jev-translation-feasibility/verification.md`.
- Rodadas de escopo S1–S4, anteriores à Round 1 da feature inteira: Rodada 5 (S1–S4, `5417c97..7868a78`) PASS em 43/43 construídos, relatório em `git show b2520fe:.specs/features/jev-translation-feasibility/verification.md`. Rodada 4 (S4, `864b31b`) FAIL em C55, lição L-004. Rodada 3 (S4, `4470b14`) FAIL em C36/C39/C40, lições L-001 a L-003. Rodadas 2 (S3, `4eea13b`) e 1 (S1+S2, `166a2b9`) PASS nos checks então construídos.

## Gate

Verified at b5f0668:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0. Faltam C50, C51 e C59. C42 está verde, mas não está provado (ver acima).
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0.
- C50/C51 sem `RUN_ID`: 0 testes, exit 2. Com `RUN_ID=verifier-r4-no-evidence`: 0 passed, 2 failed, exit 2. C59: 0 testes, exit 2.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify` (1 erro, 0 avisos).
- `git status --porcelain`: vazio antes; vazio depois das provas, das mutações e da remoção dos worktrees; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`, ` M .specs/LESSONS.md` e ` M .specs/lessons.json`, os dois últimos gravados por `lessons.py`.

## Lições

Registradas por `scripts/lessons.py add` (exit 0 nas duas chamadas):

- **L-006** (existente, atualizada, sem nova lição): "Exempt from a language allowlist only tokens that cannot spell prose, …" já cobre E1. `REPORT_CODE_LITERALS` isenta códigos que também são palavras inglesas. Reenviei o texto idêntico com a fonte E1 (`tests/ai-study/s5-report.test.mjs:177-182`; `src/ai-study/report.mjs:26`). O script deduplicou (`UPDATED L-006`); a recorrência segue 1 porque é a mesma feature.
- **L-007** (nova, `surviving_mutant`, escopo `report`, candidata): "Pin and scan every module whose code or values reach generated text, since a scan of the generator file and a hash of the text data miss fixed text from helper code or imports". Fonte: E3/E5 (`src/ai-study/report-text.mjs:211-217`; `src/ai-study/report.mjs:1-5`; `tests/ai-study/s5-report.test.mjs:186,196`). A L-005 fala de conferir o idioma contra os rótulos que o gerador emite, e a L-006 das isenções de uma lista. Nenhuma das duas cobre o alcance da varredura e do hash.

Não registrei:

- E2, E4 e E6, porque exigem ofuscação deliberada e não são implementação errada plausível;
- a aprovação humana não localizada (C42), porque é registro de processo humano, não falha de execução no código (`references/memory.md`, "Scope discipline");
- C59, porque a causa é fluxo (check de emenda sem slice que o construa) e a lição de código correlata já existe como L-003;
- C50/C51, porque a causa é pré-requisito externo (template oficial, contagem de tokens, autorização da coleta live), não falha de execução neste código.
