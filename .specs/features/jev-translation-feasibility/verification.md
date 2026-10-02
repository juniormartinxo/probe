# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 23574c7..e5d63b8 (`1260b5c` testes que matam os sobreviventes da Round 7; `e5d63b8` escopo do claim de C42 decidido pelo usuário e limpeza das referências a C50/C51/C59). HEAD = `e5d63b8`, confirmado com `git rev-parse HEAD` → `e5d63b84f1346cedfd9a6759667b41412437ed3b`. A feature inteira é `4a1acfe..e5d63b8`. As Rounds 1–7 cobriram `4a1acfe..b2520fe`, `42f101e..c23dddc`, `838012d..5f310f9`, `4dacc6b..b5f0668`, `d6440be..580258d`, `3416c78..0893f6f` e `f7f8ee4..1d46c87`.
**Round**: 8 - scoped (reverificação aprovada pelo usuário ao escolher, em 02/10/2026, a opção registrada no Status de C42 em `checks.md:205`)
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação, das correções nem da emenda; os relatórios anteriores serviram só para delimitar o escopo e para a definição exata das mutações, nunca como prova

Escopo desta rodada: o diff `23574c7..e5d63b8` e os veredictos não PASS da Round 7, que eram as cinco linhas `Killed: no` (N12, N9, E2, E4, N3). O diff tocou `tests/ai-study/s5-report.test.mjs` (+10 linhas), `tests/ai-study/support/source-literals.mjs`, `checks.md` (Status de C42 e uma frase da Coverage) e `.specs/STATE.md`. `src/`, `Makefile` e `package.json` não mudaram desde `1d46c87` (`git diff --stat 1d46c87..e5d63b8 -- src Makefile package.json` vazio). Os arquivos `s1-*`, `s2-*`, `s3-*` e `s4-*` não mudaram desde `b2520fe` (`git diff --stat b2520fe..e5d63b8` vazio para os cinco). Por isso C42, C43 e C45 foram julgados de novo, as citações de C41–C58 em `s5-report.test.mjs` foram refeitas no arquivo atual, e os demais julgamentos são carregados com a origem marcada. As provas dos 56 checks rodaram de novo, por completo, em `e5d63b8`.

Ambiente: Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas e das mutações. As mutações rodaram num worktree `git worktree add --detach` descartável em `e5d63b8`, no scratchpad, removido ao final (`git worktree list` mostra só o checkout principal e `prb-7`). O porcelain do worktree estava vazio antes de cada mutação, e cada uma foi desfeita com `git checkout -- src tests`. Não chamei Jev, LM Studio, nenhum modelo nem nenhum serviço real.

**Resultado em uma linha:** 56 de 56 checks provados, com teste nomeado executado em `e5d63b8` e asserção localizada. N12, N9, E2 e N3 agora morrem, e cada morte foi atribuída à asserção nova por controle. As duas mutações novas (X1, X2) também morrem. E4 continua sobrevivendo, mas está **fora do claim de C42 por decisão do usuário** (`checks.md:205`), e não foi registrado como morto. Não encontrei mutante plausível vivo dentro de um claim. Dois resíduos ficam como lacunas não bloqueantes: o código do motivo sem crases (X3) e a precisão do leitor de escapes.

## Decisão do usuário sobre o escopo de C42

Verified at e5d63b8.

- **Registro.** `checks.md:205`, no Status de C42: "Escopo do claim decidido pelo usuário em 02/10/2026: texto escrito de forma deliberadamente indireta para escapar da leitura estática do gerador (por exemplo, o nome de uma propriedade usado como texto, `Object.keys({ nothing: 1 })[0]`) fica fora do claim; a prova cobre o texto fixo que o gerador escreve diretamente." O texto do claim de C42 (`checks.md:203`) não mudou. `make checks-validate` → 0 erros. O commit sai da conta `Junior Martins`, a mesma usada por agentes (Observação 4): a autoria humana da decisão vem da declaração registrada e do pedido desta rodada, não da conta.
- **O escopo esconde uma regressão plausível?** Procurei os caminhos pelos quais texto chega ao Markdown sem ser literal no gerador: nome de propriedade, `Object.keys`/`Object.entries`, `JSON.stringify` de objeto montado, `String()` de booleano/`null`/`undefined`, `.name`. Em `src/ai-study/report.mjs`, todos os usos atuais (`:24`, `:100`, `:164`, `:171`, `:176`, `:180`, `:185`, `:218`, `:245`, `:332`) operam sobre dados das evidências ou sobre códigos de julgamento mostrados com `code()`. Nenhum monta texto a partir de um objeto literal do gerador. Para testar a forma não intencional mais comum dessa classe, injetei X2 (`simulated && text(...)` em vez do ternário, que vaza `false` na prosa): morre por C49 (`s5-report.test.mjs:527`). Não consegui construir uma regressão sem intenção de ofuscar que coloque inglês na prosa e passe pelas provas. O que fica fora do claim exige escrever o texto de propósito por um caminho não literal. Ressalva: a leitura estática não vê texto não literal de nenhum tipo, e a cobertura renderizada só existe nas linhas que as provas amostram (Observação 12).

## Mudanças no leitor de literais

Verified at e5d63b8. As mudanças estão em `tests/ai-study/support/source-literals.mjs:30-41` (`readRegex` passa a gravar o corpo da regex com `before: '/'`) e em `tests/ai-study/s5-report.test.mjs:197-200` (`literalLetters` decodifica `\u{…}`, `\uXXXX` e `\xXX` antes de remover os escapes restantes).

Comparei o leitor antigo (`git show 23574c7:tests/ai-study/support/source-literals.mjs`) com o novo sobre `src/ai-study/report.mjs` em `e5d63b8`, e o filtro de letras antigo (`value.replace(/\\./g, '')`) com o novo, num script no scratchpad:

- **Falso positivo no código atual: nenhum.** O leitor novo devolve 331 literais, contra 329 do antigo. Os dois a mais são os corpos das duas regex do gerador, `\s*\n\s*` (`report.mjs:24`) e `` `+ `` (`:164`), e nenhum tem letra depois de `literalLetters`. Nenhum literal do leitor antigo sumiu. Nenhum literal mudou de veredicto de letras entre o filtro antigo e o novo. Por isso o pino `REVIEWED_CODE_CONTEXTS` (`s5-report.test.mjs:178`) não precisou mudar, e as provas passam.
- **O que antes era pego e agora passa: um caso de canto.** Um literal com barra escapada seguida de `x`/`u` e dígitos hexadecimais (`'\\x41'`, que em tempo de execução é o texto `\x41`) tinha letra para o filtro antigo (`x41`) e não tem para o novo. O decodificador lê o `\x41` a partir da segunda barra, e o `\A` resultante é removido. Não é prosa plausível num gerador de relatório, e não existe no código. Fica como Observação 13.
- **O que continua passando:** escapes de identidade, como `'\p\a\s\s\e\d'` (em tempo de execução, `passed`). Eles não eram pegos antes e não são agora. Injetei como E2id: sobrevive. É escrita deliberadamente indireta, da mesma família de E2, e fica fora do claim pela decisão acima.
- **Falso positivo futuro:** uma regex legítima com letras em `report.mjs` passa a contar como literal e falha a prova até ser listada. É uma falha fechada, que exige revisão, e não um falso verde.

## Emenda de 02/10/2026 (remoção de C50, C51 e C59)

Carried from 1d46c87 (Round 7). O diff desta rodada não tocou `plan.md` nem a evidência do experimento. Em `checks.md`, só mudou o Status de C42 e uma frase da Coverage, `checks.md:302`, que não cita mais C50/C51. A conferência da decisão registrada, da cobertura do que dependia de C50/C51/C59 e dos números do experimento (68/72; PT 63/72; EN 66/72) segue válida como registrada na Round 7 (`git show 23574c7:.specs/features/jev-translation-feasibility/verification.md`). A asserção de proveniência live de C49 está agora em `tests/ai-study/s5-report.test.mjs:527` (antes `:517`; mesmo texto, deslocado em 10 linhas pelo diff). P1–P3 são carregados, porque a linha não mudou.

Resíduos de C50/C51/C59 (Observação 10 da Round 7), verified at e5d63b8: `checks.md:302` e `STATE.md:17`, `:19` e `:70` foram corrigidos, e `STATE.md:27` está marcado "(histórico; removidos em 02/10/2026…)". As menções em `STATE.md:42`, `:52` e `:61` estão nas Decisões 1–4 e nas condições de entrada, que `STATE.md:33` declara histórico. Restam `TYPETYPESAFE_API_KEY` em `STATE.md:33` e `RUN_ID="$(RUN_ID)"` em `Makefile:47`, os dois inofensivos.

## Binding sources

Carried from b2520fe. O passo 1 só roda no perfil `ui` e **não foi executado** sob `light`. O diff não tocou interface, e a feature não tem tela (`plan.md`, Observable: "Tela ... n/a").

## Provas executadas

Verified at e5d63b8. Os 56 checks rodaram numa única invocação, com o padrão montado a partir dos IDs de `checks.md` (`rg -o '^\*\*(C[0-9]+)\*\*'`, 56 IDs):

`make check-proof TEST_FLAGS='--test-name-pattern=^(C1|C2|…|C49|C52|C53|C54|C55|C56|C57|C58):'` → exit 0. TAP: `1..56`, `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, e `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez como `ok N - C<n>`, na mesma ordem da Round 7: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

- **Sem órfãos e sem check sem teste.** A lista de `C<n>` dos `ok` no TAP é igual à lista de `**C<n>**` de `checks.md` (`diff` vazio, 56 de cada lado). `rg -o "^test\('(C[0-9]+):" tests` dá exatamente os mesmos 56 IDs (`diff` vazio).
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`: os 56 checks e os três testes de apoio (`s1-corpus.test.mjs:40`, `s3-jev.test.mjs:600`, `s5-report.test.mjs:530`).
- `npm run check` → exit 0.
- `make plan-validate` → exit 0, `0 error(s), 0 warning(s)`. `make checks-validate` → exit 0, `0 error(s), 0 warning(s) [profile: light]`.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação. A coluna `Origem` diz de onde vem o julgamento da asserção. Em todas as linhas, o `Proof run` é a execução desta rodada em `e5d63b8`.

**C50, C51 e C59 não são mais checks.** Foram removidos em `f5d5829` por decisão do usuário de 02/10/2026 (conferido na Round 7, carregado acima).

| Check | Claim | Proof run | Evidence | Result | Origem |
| --- | --- | --- | --- | --- | --- |
| C1 | dry-run válido: modo, hashes, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (lote, exit 0) | `s1-commands.test.mjs:60-61` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `f['hash do gabarito']`; `:81-82` - `'20'`/`'24'`; `:83-84` - destinos; `:85` - `assert.equal(l['chave Jev'], 'configurada (valor omitido)')`; `:74` - `assertNoSecret(live)` | PASS | carried from b2520fe |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos | `ok 2 - C2:` | `s1-commands.test.mjs:100-101` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])`; `:116` - `assert.equal(liveFactoryCalls, 0)` | PASS | carried from b2520fe |
| C3 | preparação (dry-run fixture/live) e coleta fixture: zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | `s1-commands.test.mjs:135` - `assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada')`; `:136` - `assert.deepEqual(last.guard.attempts, [], 'nenhum processo nem rede')`; `:142-143` - `assert.doesNotMatch(source, …, file)` com a regex que alterna `child_process` e `worker_threads`, mais os nomes das CLIs | PASS | carried from b2520fe |
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
| C31 | máx. 20 locais / 24 Jev, falhas contadas, 21ª/25ª bloqueadas, zero retries | `ok 31 - C31:` | `s4-limits.test.mjs:141`; `:143-144`; `:162` - `assert.equal(retryingLocal.svc.count('local'), 20, ...)`; `:175`; `:190` | PASS | carried from b2520fe; prova sozinha a AC 27 (emenda revogada, conferido em 1d46c87) |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | `s4-limits.test.mjs:231`; `:242` - `assert.equal(svc.maxInFlight(), 1)`; `:244` | PASS | carried from b2520fe |
| C33 | timeout encerra no limite; `incomplete`; restantes não executados | `ok 33 - C33:` | `s4-limits.test.mjs:274`; `:279` - `reason 'timeout'`; `:280-288`; `:290`; `:293` | PASS | carried from b2520fe |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → 1 | `ok 38 - C34:` | `s4-limits.test.mjs:587-588` - `run.status` 2 (make) e `run.nodeStatus` 1; `:595`; `:598`; `:615` | PASS | carried from b2520fe |
| C35 | interrupção antes/depois da troca atômica | `ok 34 - C35:` | `s4-limits.test.mjs:330` / `:334`; `:341`; `:353`; `:367` - `assert.throws(() => loadRun(...), ... /JSON inválido ou parcial/ ...)` | PASS | carried from b2520fe |
| C36 | segredos fora de stdout/stderr/manifesto/resultados/comparação; chave/token curtos → 2 | `ok 39 - C36:` | `s4-limits.test.mjs:680` - `assert.ok(!text.includes(secret), ...)`; `:682`; `:667-670` | PASS | carried from b2520fe |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches | `ok 40 - C37:` | `s4-limits.test.mjs:707-708`; `:712`; `:719` - `assert.deepEqual(evidenceReads.filter(...), [])` | PASS | carried from b2520fe |
| C38 | zero leituras de chats/perfis Cloak/credenciais; tráfego só aos destinos configurados | `ok 41 - C38:` | `s4-limits.test.mjs:757` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:759`; `:765` | PASS | carried from b2520fe |
| C39 | evidências fora do Git; sobrevivem byte a byte | `ok 42 - C39:` | `s4-limits.test.mjs:781` - `git check-ignore` status 0; `:783`; `:797` - `assert.equal(after[file], content, ...)` | PASS | carried from b2520fe |
| C40 | relações `schema_version: 1`; `loadRun` recusa outra execução/revisão/schema | `ok 35 - C40:` | `s4-limits.test.mjs:388-413`; `:437` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)`; `:440` | PASS | carried from b2520fe |
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:228` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:235` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da execução e do relatório')`; `:246-247` + `:121` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` | PASS | carried from b2520fe; citações verified at e5d63b8 (+5 linhas) |
| C42 | seis seções na ordem; prosa em português; originais literais (escopo: `checks.md:205`) | `ok 45 - C42:` | ordem: `s5-report.test.mjs:274` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map((s) => \`## ${s}\`))` + `:279`; literais: `:292-293`, `:295`; texto fixo só do catálogo: `:277` → `:210-216`, com `:211` - `assert.deepEqual(prose, [], 'texto fora do catálogo em report.mjs')` sobre `:207` (literais com letras depois de `literalLetters`, `:197-200`, que agora incluem corpos de regex, `support/source-literals.mjs:38`); prosa renderizada: `:278` - `assertNoBareCodes(markdown)` → `:169`, e `:282` - rótulo do estado `completed`; com falha e interrompida: `:409-410` (C45). E2, E2u e N3 morrem em `:211`; N12 em `:409` e `:410`; E4 fora do claim | PASS | verified at e5d63b8 |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:311-313` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; **`:316-317`** - `assert.equal(jev.split('\n').filter((line) => line === tableHeader).length, 2, 'cabeçalho das duas tabelas com os rótulos dos braços')`, com `tableHeader` literal em `:316`; `:322-323` - `assert.deepEqual(individual[j], ...)` / `assert.deepEqual(paired[j], ...)`; `:327` - `assertNoBareCodes(jev)`. N9 e X1 morrem em `:317` | PASS | verified at e5d63b8 |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:345-347` - contagens e entradas com `output_sha256`, revisor e justificativa; `:362-363` - recusas com código 2; `:364` - relatório anterior intacto | PASS | carried from b2520fe; citações verified at e5d63b8 (+7 linhas) |
| C45 | item faltante ou tradução pendente → `inconclusive` | `ok 48 - C45:` | `s5-report.test.mjs:385` - `'evidence_complete'`; `:391-392` - `'inconclusive'` + `['review_pending']`; `:406-407` - falha (`transport_error`) e `interrupted` → `inconclusive`, motivos `collection_incomplete`/`items_not_executed`; **`:409`** - `assert.match(section(markdown, 'Completude'), /^- Estado técnico: \`incomplete\` — coleta incompleta, motivo /m, runId)`; **`:410`** - `assertNoBareCodes(markdown)` | PASS | verified at e5d63b8 |
| C46 | estado técnico e recomendação humana separados; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:424` - `não registrada`; `:431-432` - estado técnico inalterado + `Recomendação humana`; `:449` - `assert.deepEqual(productAfter, productBefore)` | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:470-471` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:477` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda | `ok 51 - C48:` | `s5-report.test.mjs:488-489` - limitações; `:491` - `acurácia` uma vez; `:492` - `assert.doesNotMatch(prose, …, ...)` com a regex que alterna `R$`, `US$`, `USD`, `BRL`, `€`, `custo: 0` e `economia de` | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho (e, pela Coverage, live identificado) | `ok 52 - C49:` | `s5-report.test.mjs:513` - faixa no cabeçalho; `:514-515` - marca na saída e nas limitações; `:516` - `/^- Modo e proveniência: \`fixture\` \/ \`fixture\` \(simulado\)$/m`; `:520` - `Conclusão: \`inconclusive\``; `:522` - `assert.doesNotMatch(fixture.markdown, …)` com a regex que alterna `comprovada`, `VRAM medida` e `ganho de tradução de`; `:526` - live sem a faixa; `:527` - `assert.match(live.markdown, /^- Modo e proveniência: \`live\` \/ \`live\`$/m)` (P1–P3 carregadas; X2 morre aqui nesta rodada) | PASS | carried from 1d46c87; citações verified at e5d63b8 (+10 linhas) |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` | PASS | carried from b2520fe |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS | carried from b2520fe |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:577` - `assert.equal(result.shimCalls, '', ...)`; `:579` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844`; `:817-819`; `:894`; `:915-917` | PASS | carried from b2520fe |
| C56 | relatório e saída sem segredos sentinela | `ok 54 - C56:` | `s5-report.test.mjs:610` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)`; `:606-608` - `[omitido]` presente | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |
| C57 | `make ai-study-report` preserva byte a byte as evidências | `ok 55 - C57:` | `s5-report.test.mjs:632` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:633` - nenhuma execução removida | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:643-655` (13 variantes) + `:658` `report(..., { expect: 2 })` → `:121` `assert.equal(result.nodeStatus, expect, ...)`; `:659` - `assert.match(refused.stderr, pattern, runId)`; `:660` - nenhum relatório | PASS | carried from b2520fe; citações verified at e5d63b8 (+10 linhas) |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Carried from 1d46c87. O diff não mudou a tabela de ACs (`checks.md:257-261`) nem nenhum claim. AC 1–37 estão todas fechadas, e todos os checks alocados são PASS. AC 27 fecha com C31.

### Nível e amostragem

- **C42** (verified at e5d63b8): a prova tem três níveis. A leitura estática da fonte do gerador cobre o texto fixo em todos os ramos (`:207-216`). Agora ela lê também os corpos de regex e decodifica `\x`/`\u`. A guarda renderizada cobre uma coleta concluída (`:278`, `:282`) e, desde `1260b5c`, também as coletas com falha e interrompida de C45 (`:409-410`). Com isso, a lacuna de amostragem da Round 7 (N12) fechou. O terceiro nível é a aprovação humana do catálogo. Pelo escopo de `checks.md:205`, texto escrito de forma deliberadamente indireta fica fora do claim (E4, E2id).
- **C43** (verified at e5d63b8): o cabeçalho das duas tabelas de contagem agora é asserido como linha exata (`:316-317`), com a ordem das colunas e os rótulos dos braços.
- **C49, proveniência live** (carried from 1d46c87): a coleta live roda com serviços controlados, não reais. Isso é coerente com `plan.md:7`.
- Os demais itens são carried from b2520fe.

## Swept existing re-read

Carried from 1d46c87. O diff não tocou o Swept (`checks.md:304-313`). A única decisão `existing` (`plan.md:254`, perfil `light` e tlc-spec-lean instalada) continua no código: `checks.md:3` traz `Profile: light`, e `.claude/skills/tlc-spec-lean/` existe (verified at e5d63b8).

## Coverage

Carried from b2520fe. Perfil `light`: o recompute do join de Coverage **não foi executado**. O diff não mudou nenhuma linha da tabela Coverage (`checks.md:296-300`); a única mudança fora do Status de C42 é a frase de `checks.md:302`, que não é linha da tabela.

## Test policy rows

Carried from b2520fe. `checks.md` não tem seção `Test policy`.

## Faults injected

Perfil `light`: a injeção formal de falhas **não é exigida**, e não alego cobertura de mutação da feature. As linhas abaixo existem porque foram injetadas, e cada resultado é um fato sobre os testes.

Verified at e5d63b8, num worktree descartável em `e5d63b8`. As definições de N12, N9, E2, E4 e N3 são as mesmas das Rounds 6–7 (`git show f7f8ee4:…/verification.md`). Prova: `node --test --test-reporter=tap tests/ai-study/s5-report.test.mjs` (o arquivo inteiro, 14 testes). Linha de base: exit 0, `# pass 14 # fail 0`. "Controle" é a mesma mutação com a asserção nova removida do teste (ou com o leitor/filtro antigo), para mostrar qual asserção mata.

| Mutação | Location | Killed |
| --- | --- | --- |
| N12 `label: (manifest.failure ? manifest.status : STATUS_LABELS[manifest.status]) ?? …` | `src/ai-study/report.mjs:229` | yes - `not ok C45`, exit 1, em `tests/ai-study/s5-report.test.mjs:409`. Controle N12b (sem `:409`): ainda morre, em `assertNoBareCodes` (`:169`, chamado de `:410`). Controle N12c (sem `:410`): morre em `:409`. As duas asserções novas matam N12 de forma independente |
| N9 `ARM_LABELS[arm]` → `arm` nos cabeçalhos das tabelas | `src/ai-study/report.mjs:183` | yes - `not ok C43`, exit 1, em `tests/ai-study/s5-report.test.mjs:317`. Controle N9b (sem `:317`): sobrevive, exit 0, 14/14. Quem mata é a asserção nova |
| E2 `empty = '\x70\x61\x73\x73\x65\x64'` (`passed`) | `src/ai-study/report.mjs:26` | yes - `not ok C42`, exit 1, em `tests/ai-study/s5-report.test.mjs:211` (`texto fora do catálogo`). Controle E2b (filtro antigo `l.value.replace(/\\./g, '')` em `:207`): sobrevive, exit 0. Quem mata é `literalLetters` |
| E2u `empty = 'passed'` (nova, variante `\u`) | `src/ai-study/report.mjs:26` | yes - `not ok C42`, exit 1, em `tests/ai-study/s5-report.test.mjs:211` |
| N3 `empty = /nothing/.source` | `src/ai-study/report.mjs:26` | yes - `not ok C42`, exit 1, em `tests/ai-study/s5-report.test.mjs:211`. Controle N3b (leitor de `23574c7`): sobrevive, exit 0. Quem mata é `readRegex` (`tests/ai-study/support/source-literals.mjs:38`) |
| X1 (nova) troca a ordem das colunas `acertos`/`erros` no cabeçalho, mantendo as linhas de dados | `src/ai-study/report.mjs:183` | yes - `not ok C43`, exit 1, em `tests/ai-study/s5-report.test.mjs:317` |
| X2 (nova) `simulated ? text('configSimulated') : ''` → `simulated && text('configSimulated')` (vaza `false` na prosa do relatório live) | `src/ai-study/report.mjs:198` | yes - `not ok C49`, exit 1, em `tests/ai-study/s5-report.test.mjs:527` |
| P1, P2, P3 (proveniência live) | `src/ai-study/report.mjs:198` | yes - carried from 1d46c87 (linha da asserção agora `:527`, texto inalterado; `src/` inalterado) |
| N1, N2, N4, N5, N6, N7, N8, N10, N11 | `src/ai-study/report.mjs` (ver Round 6) | yes - carried from 0893f6f (`src/` inalterado; as asserções que os mataram só se deslocaram) |

### Mutações fora dos claims

Estas mutações também foram injetadas em `e5d63b8` e **sobrevivem** (exit 0, `# pass 14 # fail 0`). Ficam numa tabela à parte, sem coluna `Killed`, porque não estão dentro de nenhum claim, pelos motivos da última coluna. Não são mutantes mortos. A tabela não é lida pelo gate, e isso é deliberado: E4 sai do gate por decisão do usuário, e X3 e E2id saem pelo julgamento registrado aqui, que o leitor pode contestar.

| Mutação | Location | Efeito no teste | Motivo do escopo |
| --- | --- | --- | --- |
| E4 `empty = Object.keys({ nothing: text('none') })[0]` | `src/ai-study/report.mjs:26` | sobrevive, exit 0, 14/14 | **fora do claim de C42 por decisão do usuário de 02/10/2026** (`checks.md:205`). É nome de propriedade usado como texto, que é o exemplo da própria decisão. Não encontrei variante sem intenção de ofuscar que escape das provas ("Decisão do usuário sobre o escopo de C42") |
| E2id `empty = '\p\a\s\s\e\d'` (escapes de identidade, `passed`) | `src/ai-study/report.mjs:26` | sobrevive, exit 0, 14/14 | escrita deliberadamente indireta, da família de E2. Fica dentro da mesma decisão (`checks.md:205`). Já sobrevivia antes de `1260b5c` |
| X3 `reason: code(inline(manifest.reason))` → `reason: inline(manifest.reason)` (código do motivo sem crases) | `src/ai-study/report.mjs:230` | sobrevive, exit 0, 14/14 | plausível, mas fora de C42 e de C45. O valor é um código gravado nas evidências, sem rótulo no catálogo (`transport_error`, `interrupted`). Ele aparece no relatório com crases ou sem, e nenhum texto em português é trocado ou perdido. O claim de C42 não exige crases (`checks.md:203`; não há regra de formatação de códigos em `plan.md` nem em `checks.md`). `EVIDENCE_CODES` (`tests/ai-study/s5-report.test.mjs:166`) só lista códigos com rótulo. É lacuna de precisão, não de claim (Lacuna 1) |

## Observations (non-blocking)

Carried from b2520fe:

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde.

Carried from b5f0668:

3. O texto livre gravado nas evidências entra no relatório como dado, fora do catálogo, e fica fora do claim de C42.

Carried from 580258d / 0893f6f:

4. **Atribuição.** O comentário de aprovação do catálogo, os commits da emenda e o commit que registra a decisão de escopo de C42 (`e5d63b8`) saem da mesma conta usada por agentes. A autoria humana vem da declaração registrada, não da conta.
5. **Pinos opacos.** `REVIEWED_CODE_CONTEXTS` e `REVIEWED_TEXT_FUNCTION` (`tests/ai-study/s5-report.test.mjs:177-178`) não têm lista legível.
6. `codeContexts` é um conjunto de linhas (`:209`).
7. **Limites de `EVIDENCE_CODES`** (`:166`): `\b` ASCII casa dentro de palavras acentuadas.
8. `formatReportSummary` imprime o estado técnico como código no stdout, fora do claim de C42.

Carried from 1d46c87:

9. **C49 e o membro "live identificado".** O claim de C49 (`checks.md:231`) fala só de relatório fixture, e a Coverage (`checks.md:300`) atribui a ele também "live identificado", provado em `:527`. O diff não mudou isso: a lacuna de precisão no artefato continua.
10. **Resíduos.** Os resíduos de C50/C51/C59 foram limpos em `e5d63b8` (ver "Emenda"). Restam `TYPETYPESAFE_API_KEY` em `STATE.md:33` e `RUN_ID="$(RUN_ID)"` em `Makefile:47`, os dois inofensivos.
11. **Modelo solicitado fora da evidência.** `plan.md:5` diz `jev-latest`, mas `results.json` só registra o modelo devolvido.

Novas nesta rodada (verified at e5d63b8):

12. **A leitura estática não vê texto não literal.** Nome de propriedade, `JSON.stringify` de objeto montado e `String()` de booleano não passam pelo leitor. Hoje, todos os usos desse tipo em `report.mjs` operam sobre evidências ou sobre códigos entre crases. X2 mostra que um vazamento de booleano numa linha renderizada e asserida morre. Fora das linhas asseridas, só a decisão de escopo (`checks.md:205`) e a revisão humana cobrem essa classe.
13. **Canto do decodificador de escapes.** `literalLetters` (`tests/ai-study/s5-report.test.mjs:197-200`) decodifica `\xXX`/`\uXXXX` também quando a barra é escapada (`'\\x41'`, texto `\x41` em tempo de execução). Esse literal tinha letras para o filtro antigo e não tem para o novo. Não existe no código, e não é prosa plausível. Uma leitura de escapes num único passo, da esquerda para a direita, resolveria isso.

## Lacunas

Nenhuma bloqueante: os 56 checks estão provados com asserção localizada, e não ficou mutante plausível vivo dentro de um claim. Ranqueadas, todas não bloqueantes:

1. **X3, código do motivo sem crases** - `src/ai-study/report.mjs:230`: nenhum teste assere a formatação de códigos de evidência sem rótulo no catálogo. A asserção de C45 em `tests/ai-study/s5-report.test.mjs:409` para em `motivo `. Correção barata, se o usuário quiser fixar a convenção "código sempre entre crases": estender `:409` para `` motivo `transport_error` `` / `` motivo `interrupted` ``.
2. **Observação 13** - o decodificador de escapes tem um canto (`\\x..`) que o filtro antigo pegava.
3. **Observações 9 e 12** - precisão de C49 na Coverage e alcance da leitura estática.

## Histórico (rodadas anteriores)

Esta seção é histórico e não serve de prova nesta rodada.

- **Round 7 - scoped** (`f7f8ee4..1d46c87`, commit do relatório `23574c7`): FAIL, 56/56 provados com asserção localizada e sem lacuna de cobertura depois da remoção de C50, C51 e C59 (decisão do usuário de 02/10/2026, conferida). A asserção nova de C49 (então `:517`) matou P1–P3. O FAIL veio só dos cinco sobreviventes da Round 6, reconfirmados em `1d46c87`: N12, N9, E2, E4 e N3. Gate → exit 1. Nenhuma lição nova. Relatório em `git show 23574c7:.specs/features/jev-translation-feasibility/verification.md`.
- **Round 6 - scoped** (`3416c78..0893f6f`, commit do relatório `f7f8ee4`): FAIL, 56/59. C42 passou a PASS (N5 morta). Sobreviveram E2, E4, N3, N9 e N12. C50 e C51 ficaram sem evidência live real e C59 sem teste nem implementação. Gate → exit 1.
- **Round 5 - scoped** (`d6440be..580258d`, commit do relatório `3416c78`): FAIL, 55/59. C42 ficou NÃO PROVADO por N5. Gate → exit 1. L-008 registrada.
- **Round 4 - scoped** (`4dacc6b..b5f0668`, commit do relatório `d6440be`): FAIL, 55/59. Gate → exit 1. L-006 atualizada, L-007 registrada.
- **Round 3 - scoped** (`838012d..5f310f9`, commit do relatório `4dacc6b`): FAIL, 55/59. Gate → exit 1. L-006 registrada.
- **Round 2 - scoped** (`42f101e..c23dddc`, commit do relatório `838012d`): FAIL, 56/59. L-005 registrada.
- **Round 1 - full** (`4a1acfe..b2520fe`, commit do relatório `42f101e`): FAIL, 56/59.
- Rodadas de escopo S1–S4, anteriores à Round 1: Rodada 5 (S1–S4) PASS em 43/43; Rodada 4 (S4) FAIL em C55, L-004; Rodada 3 (S4) FAIL em C36/C39/C40, L-001 a L-003; Rodadas 2 (S3) e 1 (S1+S2) PASS nos checks então construídos.

## Gate

Verified at e5d63b8:

- `make check-proof TEST_FLAGS='--test-name-pattern=^(<os 56 IDs de checks.md>):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0.
- `npm test`: 59 passed, 0 failed, exit 0. `npm run check`: exit 0. `make plan-validate`: exit 0. `make checks-validate`: exit 0.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 0: `validate_verification: 0 error(s), 0 warning(s) across [jev-translation-feasibility]`. Na primeira execução, o gate deu exit 1 por dois motivos de formato, que corrigi sem mudar nenhum veredicto. (1) As células de evidência de C3, C48 e C49 tinham `\|` dentro de regex, e o gate divide a linha nesses pipes. Reescrevi essas células para descrever a alternância sem o caractere `|`; as asserções citadas são as mesmas. (2) O cabeçalho da tabela "Mutações fora dos claims" continha "Resultado" e "claim", e por isso o gate a lia como tabela de checks. Renomeei as colunas. Essa tabela fica fora do gate de propósito, como diz a própria seção: E4, E2id e X3 sobrevivem e estão registrados como fora dos claims, não como mortos.
- `git status --porcelain`: vazio antes; vazio depois das provas, das mutações e da remoção do worktree; ao final, só ` M .specs/features/jev-translation-feasibility/verification.md`.

## Lições

Nenhuma lição nova registrada, e `lessons.py` não foi chamado. Nesta rodada não houve falha nova de execução sobre o código: todas as mutações dentro dos claims morreram. E4 e E2id estão fora do claim por decisão do usuário. X3 e a Observação 13 são lacunas de precisão das provas, e não falhas de execução do código.
