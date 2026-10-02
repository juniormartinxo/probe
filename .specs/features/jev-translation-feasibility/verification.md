# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: d6440be..580258d (`e5fa347 test(ai-study): tighten C42 catalogue provenance guards` e `580258d docs(ai-study): cite the human approval of the report text catalogue`; HEAD = `580258d`, confirmado com `git rev-parse HEAD` → `580258dd302bf698ceed6da59e069d01178e9e6b`). A feature inteira é `4a1acfe..580258d`. A Round 1 cobriu `4a1acfe..b2520fe`, a Round 2 `42f101e..c23dddc`, a Round 3 `838012d..5f310f9` e a Round 4 `4dacc6b..b5f0668`.
**Round**: 5 - scoped (segunda rodada além do limite de três do harness, **autorizada pelo usuário** depois da Round 4, para reavaliar C42 com a aprovação humana citada e o endurecimento de `e5fa347`)
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação nem das correções; os relatórios das Rounds 1–4 serviram só para delimitar o escopo e para a lista de mutações E1–E6, nunca como prova

Escopo desta rodada: o diff `git diff --stat d6440be..580258d` (`src/ai-study/report-text.mjs`, 7 linhas, só comentário; `tests/ai-study/s5-report.test.mjs`, +24/-10; `tests/ai-study/support/source-literals.mjs`, +2/-2), todo veredicto que não foi PASS na Round 4 (**C42, C50, C51, C59**) e, como `e5fa347` mexe no teste da S5, os checks desse arquivo: **C41–C49, C54 e C56–C58**. Nesses checks as provas rodaram de novo e as citações foram atualizadas. `src/ai-study/report.mjs` não mudou no diff, então o julgamento das asserções de C41 e C43–C58 é **carregado** (de `b2520fe`, via Round 4 em `b5f0668`); só os números de linha se deslocaram. C42 foi julgado de novo. Os outros 41 checks (C1–C40, C52, C53, C55) têm o julgamento **carregado** de `b2520fe`: os arquivos deles não mudaram (`git diff --stat d6440be..580258d` → só os três arquivos acima). As provas dos 59 checks rodaram de novo em `580258d`.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas, das mutações e da remoção do worktree. As mutações rodaram num `git worktree add --detach` descartável em `580258d`, no scratchpad, removido ao final (`git worktree list` mostra só o checkout principal e `prb-7`). Não chamei LM Studio, Jev, nenhum modelo nem a rede de serviço e não procurei segredos. Consultas externas, todas só de leitura: `gh api` dos comentários e revisões do PR #7 e leitura dos cards PRB-8 a PRB-11 no tracker.

**Resultado em uma linha:** 55 de 59 checks provados, com teste nomeado executado em `580258d` e asserção localizada. **C42 continua NÃO PROVADO, de novo por outro motivo.** A aprovação humana agora está localizada no PR #7, com o hash exato, e eu a aceito como registro, com a ressalva de atribuição descrita em (a). `e5fa347` fecha E1, E3 e E5 (e, de quebra, E6). Mas uma mutação nova e plausível, **N5**, que só esquece a consulta ao rótulo do estado técnico (`STATUS_LABELS[manifest.status]` → `manifest.status`), põe a palavra inglesa `completed` como prosa no relatório de C42 e passa em C42, na suíte S5 inteira e em `npm test` (59/59). Essa rota já existia em `b5f0668` (`report.mjs` não mudou), e a Round 4 não a testou. **C50 e C51** continuam sem evidência live real (PRB-11, bloqueado por PRB-8, PRB-9 e PRB-10) e **C59** continua sem teste nem implementação (PRB-8). O veredicto segue FAIL.

## Julgamento de C42 (Round 5)

Verified at 580258d. Depois de `e5fa347`, a função `assertReportTextFromCatalogue` (`tests/ai-study/s5-report.test.mjs:195-211`, chamada por C42 em `:271`) faz sete asserções sobre o código-fonte:

- `:204` - `assert.deepEqual(source.match(/^import .+;$/gm), REPORT_IMPORTS, 'imports do gerador fora do conjunto revisado')`, com a lista em `:178-184`;
- `:205` - `assert.deepEqual(prose, [], 'texto fora do catálogo em report.mjs')`;
- `:206` - `assert.equal(sha256(JSON.stringify(codeContexts)), REVIEWED_CODE_CONTEXTS, 'uso de códigos do gerador fora dos contextos revisados')`, com o hash em `:177`;
- `:207-208` - toda chave usada existe e toda chave do catálogo é usada;
- `:209` - `assert.equal(sha256(JSON.stringify(REPORT_TEXT)), PINNED_REPORT_TEXT, 'catálogo do relatório diferente do fixado')`, com o hash em `:175`;
- `:210` - `assert.equal(sha256(text.toString()), REVIEWED_TEXT_FUNCTION, 'função de interpolação do catálogo diferente da revisada')`, com o hash em `:176`.

A chave agora é reconhecida por `isTextCall` (`:199`, `/(?:^|[^\w])text\($/`), não mais por `before.endsWith('text(')`. Os literais de linhas `import ` ficam de fora pela linha (`:201`), não mais por `before.endsWith('from ')`.

### (a) A aprovação humana está registrada num lugar verificável?

Li o comentário com `gh api repos/juniormartinxo/probe/issues/comments/5954258912`:

- autor `juniormartinxo`, `user.type: User`, `author_association: OWNER`;
- `created_at` = `updated_at` = `2026-10-02T14:07:19Z` (11:07:19 -03:00), sem edição;
- texto integral: "Aprovação humana (Junior Martins): aprovo o português do catálogo src/ai-study/report-text.mjs com hash sha256:e9a1e00ae3811fa4d02bbf761d83ad2db9652b7760db53f827f368a7c03b327b."

**O hash bate nos três lugares.** O comentário cita `sha256:e9a1e00ae3811fa4d02bbf761d83ad2db9652b7760db53f827f368a7c03b327b`, igual a `PINNED_REPORT_TEXT` (`s5-report.test.mjs:175`) e ao valor que recalculei em `580258d` com o `sha256` do repositório (`node -e` sobre `JSON.stringify(REPORT_TEXT)`). Os dados do catálogo não mudaram desde `33d8d8e`: no diff, `report-text.mjs` só troca as linhas de comentário `:1-5`. O teste confirma em `:209` (`ok 45 - C42`). As citações no código apontam para esse comentário: `src/ai-study/report-text.mjs:3-4` e `tests/ai-study/s5-report.test.mjs:172-173`.

**Linha do tempo do PR #7** (`gh api .../issues/7/comments`, `.../pulls/7/comments` e `.../pulls/7/reviews`): o comentário de 14:07:19Z é o único comentário de issue do PR. O último registro antes dele é o comentário de revisão de 12:15:45Z sobre `e5fa347`, que diz "a aprovação humana formal do hash segue pendente; este fio continua aberto" e fala em "Meu parecer editorial favorável", na voz de um agente. O commit `580258d` veio 34 s depois do comentário (11:07:53 -03:00). Assim, a contradição da Round 4 (anotação de "aprovado" sem registro na fonte) não se repete: o registro agora existe e é anterior ao commit que o cita.

**Limite da evidência.** Toda postagem no PR sai da mesma conta GitHub, usada também por agentes. O registro do PR é visivelmente de agente em pelo menos um caso (12:15:45Z). Por isso a plataforma **não distingue** a autoria humana desse comentário da de um agente. A atribuição a Junior Martins se apoia em duas coisas: o texto do comentário, que se declara humano e nomeia a pessoa, e a afirmação, que me chegou pelo brief do coordenador, de que o usuário conferiu o comentário pessoalmente (`!gh api ...`) e declarou a aprovação. Um brief de agente não é, para mim, consentimento do usuário. Não vi essa declaração direta.

**Julgamento:** aceito o comentário como o **registro localizado** da aprovação humana do hash fixado. Ele cumpre exatamente a condição de fechamento que a Round 4 deixou ("um comentário dele no PR #7 citando o hash"): está na fonte citada, é estável e sem edição, nomeia o arquivo e o hash exato, e não é contradito por nenhum registro posterior. **Não** o trato como prova de autoria humana mais forte do que é: a separação entre humano e agente nessa conta é declarada, não demonstrável. Se o usuário quiser um registro que se sustente sozinho, há duas opções: postar a aprovação de uma conta usada só por ele, ou assinar um commit ou tag com uma chave dele. Para esta rodada, a parte humana de C42 está **localizada** e deixa de ser o motivo de NÃO PROVADO.

### (b) `e5fa347` fecha E1, E3 e E5 sem abrir brechas?

Mutações aplicadas uma de cada vez no worktree descartável e desfeitas com `git checkout -- src tests` (porcelain do worktree vazio antes de cada uma). Prova mais estreita: `node --test --test-reporter=tap --test-name-pattern='^(C42|C43):' tests/ai-study/s5-report.test.mjs`. Linha de base: `ok 1 - C42`, `ok 2 - C43`, exit 0. **Sonda:** depois do veredicto, rodei de novo só com uma linha extra no teste, logo após `report(sandbox, 'c42')` e antes das asserções, que grava o Markdown de C42 num arquivo do scratchpad. A coluna "Sonda" mostra a linha afetada desse Markdown. Na linha de base, ela é `- Não executados: nenhum`.

| Mutação | Local | Rota de fuga tentada | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| K2 (controle) `none: 'nenhum'` → `'no'` | `src/ai-study/report-text.mjs:42` | palavra inglesa no catálogo | morta (C42) | `not ok 1 - C42`, `catálogo do relatório diferente do fixado`, exit 1; sonda `- Não executados: no` |
| G1 (controle) `empty = text('none')` → `'no'` | `src/ai-study/report.mjs:26` | literal inglês no gerador | morta (C42) | `texto fora do catálogo em report.mjs`, exit 1; sonda `… no` |
| E1 `empty = 'absent'` | `src/ai-study/report.mjs:26` | código de `REPORT_CODE_LITERALS` como prosa | **morta (C42) - fechada** | `uso de códigos do gerador fora dos contextos revisados` (`:206`), exit 1; sonda `… absent` |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` (`passed`) | `src/ai-study/report.mjs:26` | escape que o filtro não decodifica (`:201`) | **sobrevive** (não era alvo) | `ok 1 - C42`, `ok 2 - C43`, exit 0; sonda `… passed` |
| E3 `if (key === 'none') return 'none';` em `text()` | `src/ai-study/report-text.mjs:212-213` | código do catálogo fora do hash | **morta (C42) - fechada** | `função de interpolação do catálogo diferente da revisada` (`:210`), exit 1; sonda `… none` |
| E4 `empty = Object.keys({ nothing: text('none') })[0]` | `src/ai-study/report.mjs:26` | texto por nome de propriedade | **sobrevive** (não era alvo) | exit 0; sonda `… nothing` |
| E5 `export const NOTHING = 'nothing'` em `review.mjs`, somado ao import existente | `src/ai-study/review.mjs:10`, `src/ai-study/report.mjs:4,26` | texto em módulo não varrido | **morta (C42) - fechada** | `imports do gerador fora do conjunto revisado` (`:204`), exit 1; sonda `… nothing` |
| E6 `const rawtext = (key) => key;` e `rawtext('none')` | `src/ai-study/report.mjs:25-26` | literal classificado como chave por sufixo | **morta (C42) - fechada** | `texto fora do catálogo em report.mjs` (`:205`; `isTextCall` em `:199` exige não-palavra antes de `text(`), exit 1; sonda `… none` |
| N1 (nova) import novo **sem ponto e vírgula** `import { NOTHING } from './review.mjs'` + `empty = NOTHING` | `src/ai-study/report.mjs:6,26`, `src/ai-study/review.mjs:10` | contornar o pino de imports `^import .+;$` | **sobrevive** | exit 0; sonda `… nothing`. A regex de `:204` não casa a linha nova, e o literal do caminho fica isento por estar numa linha `import ` (`:201`) |
| N2 (nova) `const raw = { text: (key) => key };` e `raw.text('none')` | `src/ai-study/report.mjs:25-26` | contornar `isTextCall` com outro `text` (membro) | **sobrevive** | exit 0; sonda `… none`. `.` é não-palavra, então `raw.text('none')` conta como chave |
| N3 (nova) `empty = /nothing/.source` | `src/ai-study/report.mjs:26` | texto em regex, que o leitor pula | **sobrevive** | exit 0; sonda `… nothing` |
| N4 (nova) `empty = Object.keys(OUTCOME_LABELS)[2]` | `src/ai-study/report.mjs:26` | emitir uma chave do próprio catálogo (`absent`) | **sobrevive** | exit 0; sonda `… absent` |
| N5 (nova) `label: STATUS_LABELS[manifest.status] ?? …` → `label: manifest.status ?? …` | `src/ai-study/report.mjs:229` | esquecer a consulta ao rótulo e imprimir o código | **sobrevive** | exit 0 em C42/C43, na suíte `s5-report.test.mjs` inteira (14/14) e em `npm test` (59/59); sonda: `- Estado técnico: \`completed\` — completed` em vez de `— coleta concluída` |
| N6 (nova, controle de N5) `` `${REASON_LABELS[reason]} (…)` `` → `` `${reason} (…)` `` | `src/ai-study/report.mjs:27` | a mesma rota de N5 em outro rótulo | morta (C43) | `not ok 2 - C43`, exit 1 (C42 ficou verde; quem mata é `assertNoBareCodes`/os textos de motivo de C43) |

**Julgamento de (b):**

- **E1, E3 e E5 estão fechadas como mirado**, e E6 fechou junto pelo `isTextCall` novo. As mortes vêm das asserções novas (`:204`, `:206`, `:210`) e do classificador novo (`:199`).
- **As brechas novas** contornam essas mesmas asserções: N1 contorna o pino de imports com uma linha sem `;` (ou com comentário depois do `;`), e N2 contorna `isTextCall` com um `text` que não é o importado. N1 depende só de uma variação de estilo, não de ofuscação, mas o repositório usa `;` em toda linha. Julgo N1 e N2 lacunas de precisão de prioridade baixa, como E2, E4 e N3. Todas exigem escrever o texto de forma deliberadamente indireta.
- **Os pinos novos são opacos.** `REVIEWED_CODE_CONTEXTS` e `REVIEWED_TEXT_FUNCTION` (`:176-177`) são hashes sem lista legível nem registro de quem revisou o quê. Quem mudar uma linha de contexto recalcula o hash sem ver o que aprovou. Isso não abre rota de mutação, mas o nome "reviewed" não tem registro que o sustente (Observação 3).
- **N5 é o achado que decide.** Ele não é ofuscação: é o erro mais simples de quem monta o relatório, esquecer a consulta ao rótulo. O resultado é prosa inglesa (`completed`) no Markdown que C42 verifica, na seção Completude. A prova de C42 é estática ("todo texto **fixo** vem do catálogo") e não vê o caminho dos dados: o código vem das evidências, não é literal de `report.mjs`, e nenhuma linha de contexto muda. As outras consultas a rótulo são cobertas por C43 (`ARM_LABELS` em `:303-304`, `OUTCOME_LABELS` na última asserção de C43 e `REASON_LABELS`, como mostra N6). A de `STATUS_LABELS` (`report.mjs:229`) não é coberta por nenhum teste. N5 já existia em `b5f0668`, porque `report.mjs` não mudou no diff. É uma omissão da Round 4, como a Round 3 corrigiu a da Round 2.

**Veredicto sobre C42: NÃO PROVADO em `580258d` - mutante plausível N5 sobrevive.** O que está provado:

- "seis seções na ordem": `:268`, `:273`;
- "originais literais": `:284-285`, `:287`;
- "todo texto fixo vem do catálogo com hash fixado": `:204-210`;
- "português do catálogo aprovado por humano": comentário `issuecomment-5954258912`, com a ressalva de atribuição de (a).

O que não está provado: que a prosa **renderizada** fica em português quando o gerador monta rótulos a partir de códigos das evidências. A lacuna é de código e corrigível; ver "Lacunas" (a) 1.

### (c) Citações de `s5-report.test.mjs`

`e5fa347` acrescentou 14 linhas entre `:169` e `:211`. Por isso toda citação a partir da antiga `:186` de `b5f0668` andou +14, e as anteriores não mudaram (helper `report`, `:121`). Conferi isso mecanicamente: comparei o texto de 57 linhas citadas na Round 4 com o das linhas deslocadas em `580258d` e não houve nenhuma diferença.

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. O diff não tocou interface. A feature não tem tela (`plan.md`, Observable: "Tela ... n/a"). Não alego contradição nem ausência de contradição.

## Provas executadas

Verified at 580258d. Todas as provas rodaram numa única invocação:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'` → exit 0. TAP: `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, com `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez, como `ok N - C<n>`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

C50, C51 e C59 não entram nesse lote. Rodei cada um separadamente:

- Sem `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^C50:'`, e o mesmo com `^C51:` e `^C59:`. Os três deram `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, `make: *** [Makefile:43: check-proof] Error 1` e exit 2.
- Com `RUN_ID`: `make check-proof TEST_FLAGS='--test-name-pattern=^(C50|C51):' RUN_ID=verifier-r5-no-evidence`. Os testes **existem e executam**, mas falham: `not ok 1 - C50:` e `not ok 2 - C51:`, os dois com `error: 'RUN_ID verifier-r5-no-evidence não tem evidências em .../prb-7/artifacts/ai-study/verifier-r5-no-evidence'`. Resultado: `# tests 2 # pass 0 # fail 2`, exit 2. Nenhum arquivo foi criado (`ls artifacts` → inexistente).
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`: os 56 checks e três testes de apoio (`s1-corpus.test.mjs:40`, `s3-jev.test.mjs:600` e `s5-report.test.mjs:516`).
- `npm run check` → exit 0.

**Existência.** Verified at 580258d. `rg -n "^test\('" tests/ai-study/s5-report.test.mjs tests/ai-study/live/s5-live.test.mjs` mostra C41–C49, C54 e C56–C58 em `s5-report.test.mjs` (`:213,247,290,322,365,403,439,468,493,557,569,600,622`) e C50/C51 em `live/s5-live.test.mjs` (`:17,26`). `rg -n "C59|local_token_count" src tests` → nenhum resultado (exit 1), e `@lmstudio/sdk` não está em `package.json`: C59 continua sem teste.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção de cada linha. Em todas as linhas, o `Proof run` é a execução desta rodada em `580258d`.

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
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:222` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:229-230` - nenhuma leitura fora da execução, corpus atual não lido; `:232-240` + `:121` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | ordem: `s5-report.test.mjs:268` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:273`; literais: `:284-285`, `:287`; texto fixo só do catálogo: `:204-210` (imports, prosa, contextos, chaves, `PINNED_REPORT_TEXT`, `REVIEWED_TEXT_FUNCTION`); aprovação humana localizada: PR #7 `issuecomment-5954258912` com o hash exato (ressalva de atribuição em "Julgamento de C42" (a)). **Mutante plausível N5 sobrevive**: `src/ai-study/report.mjs:229` sem `STATUS_LABELS[…]` renderiza `completed` como prosa no Markdown de C42, com `npm test` 59/59 | NÃO PROVADO - mutante plausível N5 (rótulo do estado técnico) sobrevive | verified at 580258d |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:303-305` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:312-313` - `assert.deepEqual(individual[j], ...)` / `assert.deepEqual(paired[j], ...)`; `:317` - `assertNoBareCodes(jev)` (reforço fora do claim) | PASS | carried from b5f0668; prova e citações verified at 580258d |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:335-337` - contagens e entradas com `output_sha256`, revisor e justificativa; `:341-353` - recusas com código 2; `:354` - relatório anterior intacto | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:375` - `'evidence_complete'`; `:381-382` - `'inconclusive'` + `['review_pending']`; `:396-399` - falha e `interrupted` → `inconclusive`, sem erro pareado | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:411-413` - `não registrada` e nenhuma decisão no texto; `:418-419` - estado técnico inalterado + `Recomendação humana`; `:436` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:457-458` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:464` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:475-476` - textos das limitações; `:478` - `acurácia` uma vez; `:479` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho | `ok 52 - C49:` | `s5-report.test.mjs:501-502` - marca de simulação na saída e nas limitações; `:507` - `Conclusão: \`inconclusive\``; `:509` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:513` - live sem a marca | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C50 | evidência **live real** T01–T06: servidor/modelo Q6_K, template confirmado, contagem, seis EN→PT, durações | sem `RUN_ID`: 0 testes, exit 2; com `RUN_ID=verifier-r5-no-evidence`: `not ok 1 - C50:`, exit 2 | no evidence: não há coleta live real (`artifacts/ai-study/` não existe). Asserções que a fechariam: `live/s5-live.test.mjs:20-21` - `assert.deepEqual(proof.problems, [])` + `assert.equal(proof.proven, true)`. Bloqueios inalterados: `src/ai-study/template.mjs:14` `official: false` (Decisão 1, PRB-9) e `src/ai-study/lmstudio.mjs:43-44` `countTokens` → `{ count: null, ... }` (Decisão 2, PRB-8). Card da coleta: PRB-11 | NÃO PROVADO - bloqueado (PRB-11 ← PRB-8, PRB-9, PRB-10) | verified at 580258d |
| C51 | evidência **live real** de ≥1 caso R: PT→EN + duas respostas Jev da mesma versão, seis válidos cada | idem: 0 testes sem `RUN_ID`; `not ok 2 - C51:` com `RUN_ID` | no evidence: mesma ausência de coleta. Asserções que a fechariam: `live/s5-live.test.mjs:29` - `assert.equal(proof.proven, true, ...)`; `:31` - seis resultados por braço. Bloqueios: os de C50, mais as rubricas revisadas e o campo `model` do Jev (PRB-10) | NÃO PROVADO - bloqueado (PRB-11 ← PRB-8, PRB-9, PRB-10) | verified at 580258d |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:563` - `assert.equal(result.shimCalls, '', ...)`; `:565` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:596` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:592-594` - `[omitido]` presente | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:618` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:619` - nenhuma execução removida | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:629-641` (13 variantes) + `:644` `report(..., { expect: 2 })` → `:121` `assert.equal(result.nodeStatus, expect, ...)`; `:645` - `assert.match(refused.stderr, pattern, runId)`; `:646` - nenhum relatório | PASS | carried from b2520fe; prova e citações verified at 580258d |
| C59 | até 18 contagens de tokens em orçamento próprio `local_token_count`; 19ª bloqueada; falhas contadas; uma chamada por vez; sem retry do `@lmstudio/sdk` | `^C59:` → `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, exit 2 | no evidence: `rg -n "C59\|local_token_count" src tests` sem resultados; `@lmstudio/sdk` ausente de `package.json`; `src/ai-study/lmstudio.mjs:42-44` - "Sem pedido HTTP: não consome chamada do orçamento", `countTokens` devolve `count: null`; `checks.md:199` - "pendente, não construído". Card: PRB-8 | NÃO PROVADO - não construído (PRB-8) | verified at 580258d |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Verified at 580258d, a partir da alocação em `checks.md:269-273` e dos veredictos acima:

- **AC 1–26, 28–32, 34–37:** fechadas. Todos os checks alocados são PASS. AC 3 inclui C3 + C52 + C54, e AC 10 inclui C10 + C53.
- **AC 33:** **aberta.** As seções, os literais, o texto fixo só do catálogo e a aprovação humana do catálogo estão provados. A prosa renderizada a partir de códigos das evidências não está: N5 sobrevive.
- **AC 27:** **aberta.** C31 é PASS, mas C59 (emenda de 01/10/2026, orçamento de contagem de tokens) não tem prova (PRB-8).
- **Fora da tabela de ACs:** os "Independent test" da S2 (C50) e da S3 (C51) continuam abertos (PRB-11). Nenhuma tradução real e nenhuma avaliação Jev real foram observadas.

### Nível e amostragem

- **C42, "prosa fica em português"** (verified at 580258d): a prova é estática sobre a fonte do gerador e do catálogo, mais a aprovação humana do catálogo. Ela cobre o texto **fixo** em todos os ramos, inclusive os não renderizados. Não cobre o nível renderizado no caminho dos dados: quando um rótulo vem de `REPORT_TEXT.<mapa>[código]`, a fonte continua limpa mesmo que o gerador imprima o código no lugar do rótulo (N5). Essa é a lacuna de nível que decide C42.
- Os demais itens são carried from b2520fe. Claims de código de saída passam pela fronteira `make` (`assertUsageFailure`, `s1-commands.test.mjs:39-41`; `report`, `s5-report.test.mjs:121`). C25, C27 e C28 cobrem cada linha das tabelas de decisão. C31 prova a borda 20/21 no orçamento e na coleta (`s4-limits.test.mjs:141-169`).

## Swept existing re-read

Carried from b2520fe. O diff não tocou `checks.md` nem `plan.md`. A seção `Swept` (`checks.md:316-326`) só aponta para checks. A única decisão `existing` do plano, Observable/Harness (tlc-spec-lean instalada, perfil `light`), continua no código (`checks.md:3`).

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Verified at 580258d. Perfil `light`: a injeção formal de falhas **não é exigida**, e não alego cobertura de mutação da feature. A pedido desta rodada, injetei 14 mutantes na superfície de idioma de C42 (detalhes em "Julgamento de C42" (b)): 7 mortos e **7 sobreviventes**. Seis sobreviventes (E2, E4, N1–N4) exigem escrever o texto de forma indireta. **N5 é plausível** e é o motivo de NÃO PROVADO em C42.

| Mutação | Location | Killed |
| --- | --- | --- |
| K2 (controle) `'nenhum'` → `'no'` | `src/ai-study/report-text.mjs:42` | yes (C42, `:209`) |
| G1 (controle) `empty = 'no'` | `src/ai-study/report.mjs:26` | yes (C42, `:205`) |
| E1 `empty = 'absent'` | `src/ai-study/report.mjs:26` | yes (C42, `:206`) - fechada por `e5fa347` |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` | `src/ai-study/report.mjs:26` | no - sobrevive (escape não decodificado, `tests/ai-study/s5-report.test.mjs:201`) |
| E3 `text()` devolve `'none'` para a chave `none` | `src/ai-study/report-text.mjs:212-213` | yes (C42, `:210`) - fechada por `e5fa347` |
| E4 `Object.keys({ nothing: … })[0]` | `src/ai-study/report.mjs:26` | no - sobrevive (sem literal) |
| E5 `NOTHING` acrescentado ao import existente de `review.mjs` | `src/ai-study/review.mjs:10`, `src/ai-study/report.mjs:4` | yes (C42, `:204`) - fechada por `e5fa347` |
| E6 `rawtext('none')` | `src/ai-study/report.mjs:25-26` | yes (C42, `:205` via `:199`) - fechada por `e5fa347` |
| N1 import novo sem `;` de `review.mjs` | `src/ai-study/report.mjs:6`, `tests/ai-study/s5-report.test.mjs:204` | no - sobrevive (regex `^import .+;$`) |
| N2 `raw.text('none')` com `raw = { text: (k) => k }` | `src/ai-study/report.mjs:25-26`, `tests/ai-study/s5-report.test.mjs:199` | no - sobrevive (`.` antes de `text(`) |
| N3 `empty = /nothing/.source` | `src/ai-study/report.mjs:26` | no - sobrevive (regex pulada pelo leitor) |
| N4 `empty = Object.keys(OUTCOME_LABELS)[2]` | `src/ai-study/report.mjs:26` | no - sobrevive (chave do catálogo emitida sem literal) |
| N5 `STATUS_LABELS[manifest.status]` → `manifest.status` | `src/ai-study/report.mjs:229` | **no - sobrevive em `npm test` (59/59)**; `completed` como prosa no relatório de C42 |
| N6 `REASON_LABELS[reason]` → `reason` | `src/ai-study/report.mjs:27` | yes (C43) |

## Observations (non-blocking)

Carried from b2520fe e reconfirmadas:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.
2. C50/C51: o `RUN_ID` que os fechar precisa vir de uma coleta live autorizada. O verificador da rodada seguinte deve conferir a proveniência real, não só o teste verde (STATE.md, escolha 5 da S5; critério de aceite de PRB-11).

Carried from b5f0668:

3. O texto livre gravado nas evidências pelo próprio sistema (`problems` do Jev, `failure.message`, `comparison_error`, justificativas) entra no relatório como dado, fora do catálogo, e continua fora do claim de C42. N5 é diferente: lá existe um rótulo do catálogo para o código, e o gerador deixa de usá-lo.

Novas nesta rodada (verified at 580258d):

4. **Atribuição da aprovação.** O comentário `issuecomment-5954258912` sai da mesma conta usada por agentes. Um comentário anterior do mesmo PR (12:15:45Z) foi escrito na voz de um agente ("Meu parecer editorial favorável"). Aceito o registro, mas a autoria humana vem da declaração, não da conta. Ver "Julgamento de C42" (a).
5. **Pinos opacos.** `REVIEWED_CODE_CONTEXTS` e `REVIEWED_TEXT_FUNCTION` (`tests/ai-study/s5-report.test.mjs:176-177`) se chamam "reviewed", mas não têm lista legível nem registro de revisão. Uma mudança legítima numa linha de contexto obriga a recalcular o hash às cegas. Sugestão: fixar a lista de linhas em claro (como `REPORT_IMPORTS`) em vez do hash.
6. `codeContexts` é um conjunto de linhas (`:203`). Um literal de código novo, numa linha idêntica a uma já revisada, não muda o hash. Não achei uso plausível disso para emitir prosa, mas o pino é por texto da linha, não por posição.

## Lacunas

Ranqueadas.

**(a) Corrigíveis no código**

1. **C42, prosa renderizada a partir de códigos (N5)** - `src/ai-study/report.mjs:229`; nenhuma asserção cobre o rótulo de `STATUS_LABELS`. Correção possível: em C42 (ou C45), asserir que a linha do estado técnico traz o rótulo do catálogo (`coleta concluída`). Uma versão mais geral: estender `assertNoBareCodes` (`tests/ai-study/s5-report.test.mjs:164-168`) para todas as chaves dos mapas `statuses`, `outcomes`, `reasons` e `arms` do catálogo, fora de crases. Isso mata N5 e N4.
2. **C42, pino de imports (N1)** - `tests/ai-study/s5-report.test.mjs:204`: a regex `^import .+;$` ignora uma linha `import` sem `;` ou com comentário no fim. Correção: casar toda linha que começa com `import` (`/^import\b.*$/gm`) e comparar com a lista.
3. **C42, leitor e classificador (E2, E4, N2, N3)** - `tests/ai-study/s5-report.test.mjs:199,201`: decodificar escapes antes do teste de letras; reconhecer `text(` só quando não é precedido de `.`; tratar regex e nomes de propriedade como literais. Todos exigem ofuscação; prioridade baixa.
4. **C59: teste e implementação inexistentes** (`checks.md:199`; `src/ai-study/lmstudio.mjs:42-44`). É código, mas depende das confirmações de API da Decisão 2. Card de acompanhamento: **PRB-8** (também bloqueia PRB-11).

**(b) Bloqueadas por pré-requisitos externos**

1. **C50:** coleta live real T01–T06. Card **PRB-11**, bloqueado por **PRB-8** (contagem de tokens, `src/ai-study/lmstudio.mjs:43-44`) e **PRB-9** (template oficial e conferência do GGUF, `src/ai-study/template.mjs:14`), mais a autorização explícita da coleta.
2. **C51:** coleta live real de ≥1 caso R com Jev. Card **PRB-11**, bloqueado por PRB-8, PRB-9 e **PRB-10** (revisão humana das rubricas Jev e campo `model` da resposta).
3. (Opcional, não bloqueia) **C42, atribuição da aprovação humana:** se o usuário quiser um registro que se sustente sem a declaração dele, há duas opções: uma aprovação postada de uma conta usada só por ele, ou um commit ou tag assinado. Hoje a aprovação está localizada e aceita (Observação 4).

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 4 - scoped** (`4dacc6b..b5f0668`, commit do relatório `d6440be`): FAIL, 55/59. Primeira rodada além do limite, autorizada pelo usuário. C42 passou a ser provado por varredura estática de `report.mjs` e pelo hash do catálogo `REPORT_TEXT`, e as 12 mutações plausíveis (K1–K6, G1–G6) morreram. Seis rotas sobreviveram (E1–E6) e foram julgadas lacunas de precisão. C42 ficou NÃO PROVADO porque a aprovação humana do hash `sha256:e9a1e00a…327b` não estava no PR #7 citado: o último registro era a revisão do Codex, "não aprovação humana formal". C50 e C51 sem evidência live real e C59 não construído. Gate → exit 1. L-006 atualizada e L-007 registrada. Relatório em `git show d6440be:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 3 - scoped** (`838012d..5f310f9`, commit do relatório `4dacc6b`): FAIL, 55/59. C42 perdeu o PASS: a lista de permissões sobre o Markdown renderizado deixava passar M4–M6, e M8–M10 estavam em ramos não renderizados. Gate → exit 1. L-006 registrada; L-005 atualizada. Relatório em `git show 4dacc6b:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 2 - scoped** (`42f101e..c23dddc`, commit do relatório `838012d`): FAIL, 56/59. C42 recebeu PASS com um mutante vivo (`'nenhum'` → `'nothing'`), erro de julgamento corrigido na Round 3. Gate → exit 1. L-005 registrada. Relatório em `git show 838012d:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 1 - full** (feature inteira, `4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59. C42 recebeu PASS com uma asserção (`assertNoBareCodes`) que não provava "prosa fica em português", erro corrigido na Round 2. Gate → exit 1. Relatório em `git show 42f101e:.specs/features/jev-translation-feasibility/verification.md`.
- Rodadas de escopo S1–S4, anteriores à Round 1 da feature inteira: Rodada 5 (S1–S4, `5417c97..7868a78`) PASS em 43/43 construídos, relatório em `git show b2520fe:.specs/features/jev-translation-feasibility/verification.md`. Rodada 4 (S4, `864b31b`) FAIL em C55, lição L-004. Rodada 3 (S4, `4470b14`) FAIL em C36/C39/C40, lições L-001 a L-003. Rodadas 2 (S3, `4eea13b`) e 1 (S1+S2, `166a2b9`) PASS nos checks então construídos.

## Gate

Verified at 580258d:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0. Faltam C50, C51 e C59. C42 está verde, mas não está provado (N5).
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0.
- C50/C51 sem `RUN_ID`: 0 testes, exit 2. Com `RUN_ID=verifier-r5-no-evidence`: 0 passed, 2 failed, exit 2. C59: 0 testes, exit 2.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify` (1 erro, 0 avisos).
- `git status --porcelain`: vazio antes; vazio depois das provas, das mutações e da remoção do worktree; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`, ` M .specs/LESSONS.md` e ` M .specs/lessons.json`, os dois últimos gravados por `lessons.py`.

## Lições

Registrada por `scripts/lessons.py add` (exit 0):

- **L-008** (nova, `surviving_mutant`, escopo `report`, candidata): "Assert the rendered label wherever generated text maps a stored code to a catalogue label, since a source scan of fixed text stays clean when the lookup is dropped and the raw code is printed". Fonte: N5 (`src/ai-study/report.mjs:229`; `tests/ai-study/s5-report.test.mjs:195-211`). A L-005 fala de conferir o idioma contra os rótulos fixos, a L-006 das isenções e a L-007 do alcance da varredura e do hash. Nenhuma cobre o caminho dos dados, em que o rótulo existe no catálogo e o gerador deixa de consultá-lo.

Não registrei:

- N1 e N2, que são precisão das próprias guardas novas (regex de import que exige `;`, classificador de `text(`) e ficam na família da L-007; E2, E4 e N3, que exigem ofuscação;
- a ressalva de atribuição da aprovação humana (conta compartilhada com agentes), porque é processo humano, não falha de execução no código (`references/memory.md`, "Scope discipline");
- C59, C50 e C51, porque as causas são fluxo e pré-requisitos externos (PRB-8 a PRB-11), não falha de execução neste código.
