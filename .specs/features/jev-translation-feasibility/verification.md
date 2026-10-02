# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: 4a1acfe..b2520fe (base da feature = `4a1acfe chore: first commit`, anterior à S1 `dba3999`; HEAD = `b2520fe`, S5, confirmado com `git rev-parse HEAD`)
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação; nenhum relatório anterior foi usado como prova

Escopo: a feature inteira, os 59 checks de `checks.md` (C1–C59) e as ACs 1–37 do plano. Tudo foi verificado em `b2520fe` com Node v24.21.0. A árvore real ficou somente leitura: `git status --porcelain` estava vazio antes das provas e continuou vazio depois de todas as execuções. Não chamei LM Studio, Jev, nenhum modelo nem a rede real. Não procurei segredos. As provas usam só os transportes, o `fetch` controlado e os processos dos próprios testes.

**Resultado em uma linha:** 56 de 59 checks estão provados, com teste nomeado executado e asserção localizada. **C50 e C51** não têm evidência live real: `artifacts/ai-study/` não existe neste worktree nem no checkout principal. **C59** não tem teste nem implementação. A AC 27 (emenda) fica aberta, e as provas reais da S2 e da S3 ("Independent test") também.

## Binding sources

O passo 1 só roda no perfil `ui`, então **não foi executado** sob `light`. O plano cita em `Sources` o [desenho aprovado](../../../docs/superpowers/specs/2026-09-22-probe-mvp-design.md), seções 4, 7, 8, 11 e 13. Abri o desenho só para contexto (títulos e §8, "Tradução local"). Não fiz a comparação check × fonte do passo 1 e não alego nenhuma contradição nem ausência dela. A feature não tem tela (`plan.md`, Observable: "Tela ... n/a"), então não há composição a enumerar.

## Provas executadas

Todas as provas rodaram numa única invocação:

`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'` → exit 0. TAP: `# tests 56 # pass 56 # fail 0 # cancelled 0 # skipped 0 # todo 0`, com `grep -cE '# (SKIP|TODO)'` = 0. Cada nome aparece uma vez, como `ok N - C<n>:`: C1–C5 (`ok 1`–`5`), C9 (`6`), C10 (`7`), C11 (`8`), C12 (`9`), C6–C8 (`10`–`12`), C13–C28 (`13`–`28`), C52 (`29`), C53 (`30`), C31 (`31`), C32 (`32`), C33 (`33`), C35 (`34`), C40 (`35`), C29 (`36`), C30 (`37`), C34 (`38`), C36 (`39`), C37 (`40`), C38 (`41`), C39 (`42`), C55 (`43`), C41–C49 (`44`–`52`), C54 (`53`), C56–C58 (`54`–`56`).

Ausentes desse lote: C50, C51 e C59. Rodei cada um separadamente:

- `make check-proof TEST_FLAGS='--test-name-pattern=^C50:'` (também `^C51:` e `^C59:`), sem `RUN_ID`: `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, `make: *** [Makefile:43: check-proof] Error 1`, exit 2. O Makefile só inclui `tests/ai-study/live/*.test.mjs` quando `RUN_ID` é informado (`Makefile:6`).
- `make check-proof TEST_FLAGS='--test-name-pattern=^(C50|C51):' RUN_ID=verifier-no-evidence`: os testes **existem e executam**, mas falham: `not ok 1 - C50:` e `not ok 2 - C51:`, os dois com `error: 'RUN_ID verifier-no-evidence não tem evidências em .../artifacts/ai-study/verifier-no-evidence'` (`src/ai-study/run-reader.mjs:28`). Resultado: `# tests 2 # pass 0 # fail 2`, exit 2. Nenhum arquivo foi criado (`ls artifacts` → inexistente).
- `npm test` → exit 0, `tests 59, pass 59, fail 0, cancelled 0, skipped 0, todo 0`. São os 56 checks mais três testes de apoio sem número de check: `s1-corpus.test.mjs:40` (fidelidade do corpus a corpus.md), `s3-jev.test.mjs:600` (`S3:`, falha ao gravar comparison) e `s5-report.test.mjs:472` (verificadores de C50/C51 com evidência controlada).
- `npm run check` → exit 0 (`node --check` em `src`, `tests`, `support` e `live`).
- `make checks-validate` → `validate_checks: 0 error(s), 0 warning(s) ... [profile: light]`. `make plan-validate` → `0 error(s), 0 warning(s)`.

**Existência.** `rg -n "^\s*test\('" tests/` encontra exatamente os 58 nomes `C<n>:`, além dos três testes de apoio. C1–C5 e C9–C12 estão em `s1-commands.test.mjs` (`:52,91,119,147,166,234,262,341,368`). C6–C8 estão em `s1-corpus.test.mjs` (`:68,87,119`). C13–C20 estão em `s2-translation.test.mjs` (`:155,218,247,309,346,392,449,523`). C21–C28, C52 e C53 estão em `s3-jev.test.mjs` (`:118,157,202,246,284,367,410,473,541,568`). C31, C32, C33, C35, C40, C29, C30, C34, C36, C37, C38, C39 e C55 estão em `s4-limits.test.mjs` (`:133,219,254,326,374,459,539,568,620,686,727,771,823`). C41–C49, C54 e C56–C58 estão em `s5-report.test.mjs` (`:170,204,246,278,321,359,395,424,449,513,525,556,578`). C50 e C51 estão em `live/s5-live.test.mjs` (`:17,26`). **C59 não aparece em nenhum lugar:** `rg -n "C59|local_token_count" src tests` não encontra nada. Todos esses arquivos foram criados dentro do range (`git diff --stat 4a1acfe..b2520fe`), então nenhuma prova se apoia em teste anterior à feature.

## Checks

Todos os caminhos são relativos a `tests/ai-study/`, salvo indicação.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | dry-run válido: modo, hashes, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (lote, exit 0) | `s1-commands.test.mjs:60-61` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `f['hash do gabarito']`; `:81-82` - `'20'`/`'24'`; `:83-84` - destinos; `:85` - `assert.equal(l['chave Jev'], 'configurada (valor omitido)')`; `:74` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos | `ok 2 - C2:` | `s1-commands.test.mjs:100-101` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])`; `:116` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação (dry-run fixture/live) e coleta fixture: zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | `s1-commands.test.mjs:135` - `assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada')`; `:136` - `assert.deepEqual(last.guard.attempts, [], 'nenhum processo nem rede')`; `:142-143` - `assert.doesNotMatch(source, /child_process\|worker_threads/, file)` + nomes das CLIs | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | `s1-commands.test.mjs:152` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:157` - `assertUsageFailure(run, /MODE/, ...)`, que assere `status` 2 e `nodeStatus` 2 (`:39-41`) | PASS |
| C5 | config inválida → 2 antes de coletar, nomeando a config sem revelar segredo; tabela completa | `ok 5 - C5:` | `s1-commands.test.mjs:169-201` (tabela: campos live ausentes, RUN_ID vazio/65/caminho/não ASCII, timeouts `0`,`-1`,`1.5`,`abc`, saída `0`/`2049`/`1.5`, argumento desconhecido, corpus ilegível); `:206-208` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` | PASS |
| C6 | corpus exato R01–R12/T01–T06 em ordem; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | `s1-corpus.test.mjs:70-71` - `assert.deepEqual(...relational_cases.map((r) => r.id), R_IDS)` / `T_IDS`; `:75-82` (ausente, extra, repetido, fora de ordem, em R e em T); `:31-36` - `run.status` 2, `nodeStatus` 2, `!existsSync(...)` | PASS |
| C7 | seis julgamentos, rótulo válido, justificativa; violações → 2 | `ok 11 - C7:` | `s1-corpus.test.mjs:90` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:92-93` - domínio e justificativa; `:97-114` (ausente, extra, duplicado, rótulo, vazia, campo extra) via `:31-32` | PASS |
| C8 | resultados vinculados aos mesmos hashes; alteração impede comparação | `ok 12 - C8:` | `s1-corpus.test.mjs:139-140` - `assert.equal(result.corpus_hash, base.corpusHash)` / `gabarito_hash`; `:144` - `assert.throws(() => assertSameReference(mixed), UsageError)`; `:174` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos fixture, `schema_version: 1` | `ok 6 - C9:` | `s1-commands.test.mjs:237` - `assert.equal(run.status, 0, run.output)`; `:244` - `assert.equal(evidence.manifest.schema_version, 1)`; `:246-247` - `mode`/`provenance` `'fixture'`; `:250` - 42 resultados | PASS |
| C10 | fronteira fixture: live → 2 preservando evidências; coletor live: fixture rejeitado | `ok 7 - C10:` | `s1-commands.test.mjs:266` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`; `:270` - `reason 'provenance_mismatch'`; `:325-326` - coletor live rejeita fixture; `:329` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')` | PASS |
| C11 | aceita RUN_ID 1/64, timeout inteiro positivo, saída 1/2048; 20/24 | `ok 8 - C11:` | `s1-commands.test.mjs:344` - `assert.equal(longId.length, 64)`; `:355` - `assert.equal(manifest[key], value, key)`; `:363` - `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; relatório exige RUN_ID; live exige config; token opcional; sem flags | `ok 9 - C12:` | `s1-commands.test.mjs:373-377` - corpus, `'gerado na coleta'`, `'120'`, `'30'`, `'2048'`; `:393` - `resolveConfig('report', {})` lança `/RUN_ID/`; `:407` - `assert.equal(noToken.local.apiToken, null, 'token local opcional')`; `:411` - `assertUsageFailure(flagged, new RegExp(name), ...)` | PASS |
| C13 | tradução registra original, direção, modelo, revisão do template, vínculo | `ok 13 - C13:` | `s2-translation.test.mjs:172-177` - `run_id`, `case_id`, `requested_model`, `template_revision`; `:180-185` - `direction` `'pt->en'`/`'en->pt'` + `original` | PASS |
| C14 | template não confirmado → `template_unverified`, sem envio | `ok 14 - C14:` | `s2-translation.test.mjs:224` - `assertIncomplete(outcome, 'template_unverified')`; `:226` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:244` - `assert.deepEqual(lm.calls, [])` | PASS |
| C15 | 2048 admitido; 2049 → `input_limit` sem envio nem truncamento; contagem inclui template | `ok 15 - C15:` | `s2-translation.test.mjs:263-264` - `expected.length > t.original.length` + `assert.equal(t.input_tokens.count, 2048)`; `:269-270` - `assertIncomplete(first, 'input_limit')` + `assert.deepEqual(only(blocked.calls, 'translate'), [])` | PASS |
| C16 | contagem indisponível/tokenizer divergente → `token_count_unavailable` | `ok 16 - C16:` | `s2-translation.test.mjs:322-323` - `assertIncomplete(outcome, 'token_count_unavailable')` + `assert.deepEqual(only(calls, 'translate'), [], name)` | PASS |
| C17 | saída literal como derivação; braço EN usa a derivação; original preservado | `ok 17 - C17:` | `s2-translation.test.mjs:360` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:365` - original preservado; `:371` - `assert.equal(en.request.text, literal(c.id), ...)` | PASS |
| C18 | vazia/espaços/limite → `invalid_translation`, sem Jev EN | `ok 18 - C18:` | `s2-translation.test.mjs:412` - `assert.equal(byCase[caseId].status, 'invalid_translation', caseId)`; `:414` - `output_limit`/`empty_output`; `:420` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)` | PASS |
| C19 | duração ms, metadados do runtime, justificativa; download não vira VRAM | `ok 19 - C19:` | `s2-translation.test.mjs:466` - `Number.isInteger(duration) && duration >= 25`; `:469-471` - `{ available: true, value: ... }`; `:474-476` - `available false`, sem `value`, com justificativa; `:478-479` - `/download/`, `/VRAM/` | PASS |
| C20 | identidade solicitada/retornada Q6_K; sem trocar/instalar/baixar | `ok 20 - C20:` | `s2-translation.test.mjs:537` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:562-563` - `assertIncomplete(outcome, reason)` + só `GET ${modelPath}` | PASS |
| C21 | seis julgamentos `Choice` na mesma chamada, critérios yes/no/insufficient | `ok 21 - C21:` | `s3-jev.test.mjs:136` - `assert.deepEqual(Object.keys(call.body.questions), [...JUDGMENT_IDS], ...)`; `:140` - `question.type === 'choice'`; `:141` - `assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id)` | PASS |
| C22 | payloads sem gabarito, justificativa de referência ou revisão humana | `ok 22 - C22:` | `s3-jev.test.mjs:192` - `assert.ok(!payload.includes(SENTINEL), ...)`; `:194` - `assert.deepEqual(sent(alt), sent(base))` | PASS |
| C23 | par com instruções/rubricas/IDs/critérios/modelo iguais; só o texto varia; IDs fora do texto traduzido | `ok 23 - C23:` | `s3-jev.test.mjs:218-223` - `questions`, IDs, modelo, `instructions_hash`, `criteria_hash` e `returned_model` iguais; `:227` - `assert.notEqual(pt.request.body.state, en.request.body.state, c.id)`; `:235` - `assert.doesNotMatch(prompt, /\b[RT]\d{2}\b/, ...)` | PASS |
| C24 | alternância PT/EN e EN/PT até R12, caso e braço preservados | `ok 24 - C24:` | `s3-jev.test.mjs:251-253` - `'R01,pt'`, `'R02,en'`, `'R12,pt'`; `:264` - `assert.deepEqual(sentOrder, expectedOrder)`; `:266` - `assert.deepEqual(persisted, expectedOrder)` | PASS |
| C25 | validação da AC 21; violação → `invalid_response` sem inferir escolha | `ok 25 - C25:` | `s3-jev.test.mjs:285-295` (aceitas: 0/1, soma ±0,000001) - `assert.deepEqual(validateEvaluation(results), [], label)`; `:297-330` (rejeitadas: IDs ausente/extra/repetido, tipo, domínio, prosa, probabilidades ausente/NaN/infinita/<0/>1, soma, confiança) - `assert.match(problems.join('\n'), pattern, label)`; `:352-353` - `invalid_response` + `assert.equal(invalid.evaluation.results, null, ...)` | PASS |
| C26 | avaliação persistida com identificação, distribuição, uso e duração; uso ausente não vira zero | `ok 26 - C26:` | `s3-jev.test.mjs:383-396` - `run_id`, `case_id`, `returned_model`, `probabilities`, `confidence`, `duration_ms >= 25`; `:401-404` - `usage.available false`, `/não é custo zero/`, sem `:0` | PASS |
| C27 | acerto/erro/ausência; `insufficient` é escolha | `ok 27 - C27:` | `s3-jev.test.mjs:411-421` (8 linhas da tabela) - `assert.equal(compareChoice(choice, expected), outcome, ...)`; `:423-424` - inválida/não executada → `absent`; `:452` - `insufficient` conta `hit`/`miss` | PASS |
| C28 | par incompleto fora do denominador; individual visível | `ok 28 - C28:` | `s3-jev.test.mjs:477-490` (13 linhas: braço ausente/inválido, corpus/gabarito, instruções, critérios, versão Jev) - `assert.deepEqual(pair.reasons, reasons, label)`; `:499` - denominador 1/0; `:503` - `assert.ok(visible, ...)`; `:531` - denominador 10 | PASS |
| C29 | duas coletas simultâneas: só uma; a segunda recusada antes de chamar modelos | `ok 36 - C29:` | `s4-limits.test.mjs:481-483` - `second.status` 2, `nodeStatus` 2, `/outra coleta \(processo ${firstPid}\) está em andamento/`; `:485` - `assert.equal(started().length, 1, ...)`; `:488` - `assert.deepEqual(snapshotFiles(...'c29-primeira'), firstBefore, ...)` | PASS |
| C30 | RUN_ID existente → 2; bytes anteriores mantidos, inclusive de execução incompleta | `ok 37 - C30:` | `s4-limits.test.mjs:554-556` - `again.status` 2, `nodeStatus` 2, `/já existe; a execução anterior não será sobrescrita/`; `:559` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before, ...)` | PASS |
| C31 | máx. 20 locais / 24 Jev, falhas contadas, 21ª/25ª bloqueadas, zero retries | `ok 31 - C31:` | `s4-limits.test.mjs:141` - `e.reason === 'call_limit' && !e.requestSent`; `:143-144` - `executed` 44 + `snapshot` 20/24; `:162` - `assert.equal(retryingLocal.svc.count('local'), 20, ...)`; `:175` - Jev 24; `:190` - `assert.equal(svc.count(service), nth, \`${label}: nenhum pedido repetido\`)` | PASS |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | `s4-limits.test.mjs:231` - `assert.equal(started, 0, 'a segunda chamada não começou')`; `:242` - `assert.equal(svc.maxInFlight(), 1)`; `:244` - início e fim alternados | PASS |
| C33 | timeout encerra no limite; `incomplete`; restantes não executados; resultado remoto desconhecido | `ok 33 - C33:` | `s4-limits.test.mjs:274` - `waited >= 990 && waited < 1900`; `:279` - `reason 'timeout'`; `:280-288` - `failure` com `remote_outcome: 'unknown'`; `:290` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/)`; `:293` - `not_executed_items` | PASS |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → 1; prefixo; restantes | `ok 38 - C34:` | `s4-limits.test.mjs:587-588` - `run.status` 2 (make) e `run.nodeStatus` 1 (linha `Error 1`); `:595` - `completed_items`; `:598` - `assert.deepEqual(manifest.not_executed_items, remainingAfter(last), ...)`; `:615` - só os dois destinos | PASS |
| C35 | interrupção antes/depois da troca atômica; temporário e JSON parcial não são evidência | `ok 34 - C35:` | `s4-limits.test.mjs:330` / `:334` - manifesto anterior/novo íntegro; `:341` - resultado novo íntegro; `:353` - temporário ignorado; `:367` - `assert.throws(() => loadRun(...), ... /JSON inválido ou parcial/ ...)` | PASS |
| C36 | segredos fora de stdout/stderr/manifesto/resultados/comparação; chave/token curtos → 2 | `ok 39 - C36:` | `s4-limits.test.mjs:680` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)` sobre stdout, stderr e todos os arquivos; `:682` - cabeçalho `authorization` sem `Bearer` cru; `:667-670` - `nodeStatus` 2, `/curto demais/`, nenhuma execução | PASS |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches anteriores | `ok 40 - C37:` | `s4-limits.test.mjs:707-708` - 18 traduções e 24 avaliações refeitas; `:712` - sentinela ausente; `:719` - `assert.deepEqual(evidenceReads.filter(...), [])` | PASS |
| C38 | zero leituras de chats/perfis Cloak/credenciais; tráfego só aos destinos configurados | `ok 41 - C38:` | `s4-limits.test.mjs:757` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:759` - sem `cloak\|.claude\|.codex\|.ssh\|.aws`; `:765` - origens `['http://lmstudio.interno:4321', 'https://api.typesafe.ai']` | PASS |
| C39 | evidências fora do Git; sobrevivem byte a byte a nova coleta e a `loadRun` | `ok 42 - C39:` | `s4-limits.test.mjs:781` - `git check-ignore` status 0; `:783` - `git ls-files -- artifacts` vazio; `:797` - `assert.equal(after[file], content, ...)`. Reconferido à mão: `git check-ignore -v artifacts/ai-study/x` → `.gitignore:1:artifacts/` | PASS |
| C40 | relações `schema_version: 1`; `loadRun` recusa outra execução/revisão/schema | `ok 35 - C40:` | `s4-limits.test.mjs:388-413` - `schema_version` 1, `run_id`, `planned_items` e vínculos de tradução e avaliação; `:437` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)`; `:440` - `/revisão de corpus ou gabarito diferente/` | PASS |
| C41 | `make ai-study-report` só das evidências, zero rede/modelos; RUN_ID ausente/inválido → 2 | `ok 44 - C41:` | `s5-report.test.mjs:179` - `assert.deepEqual(done.guard.attempts, [], 'zero rede e zero processos')`; `:186-187` - nenhuma leitura fora da execução, corpus atual não lido; `:188-197` + `:119` - `assert.equal(result.nodeStatus, expect, ...)` com `expect: 2` para omitido/vazio/caminho/65/não ASCII/inexistente | PASS |
| C42 | seis seções na ordem; prosa em português; originais literais | `ok 45 - C42:` | `s5-report.test.mjs:225` - `assert.deepEqual(markdown.match(/^## .*$/gm), SECTIONS.map(...))`; `:229` - lista das 6 seções; `:240-241` - original e tradução literais; `:228` - `assertNoBareCodes(markdown)` | PASS |
| C43 | acertos/erros/ausências por julgamento e braço; pares completos; denominadores distintos | `ok 46 - C43:` | `s5-report.test.mjs:259-261` - PT `1 de 12`, EN `2 de 12`, pares `1 de 12`; `:268-269` - `assert.deepEqual(individual[j], ...)` / `paired[j]` | PASS |
| C44 | revisão só `pending`/`faithful`/`meaning_changed`; revisor, justificativa e saída concreta | `ok 47 - C44:` | `s5-report.test.mjs:291-293` - contagens e entradas com `output_sha256`, revisor e justificativa; `:297-309` - recusas (estado, revisor, justificativa, hash ausente/de outro caso, repetição, campo extra) com código 2; `:310` - relatório anterior intacto | PASS |
| C45 | item faltante ou tradução pendente → `inconclusive` mesmo com tudo de acordo | `ok 48 - C45:` | `s5-report.test.mjs:331` - completa e revisada `'evidence_complete'`; `:337-338` - `'inconclusive'` + `['review_pending']`; `:352-355` - falha de transporte e `interrupted` → `inconclusive`, sem nenhum erro pareado | PASS |
| C46 | estado técnico e recomendação humana separados; decisões só quando registradas; produto intacto | `ok 49 - C46:` | `s5-report.test.mjs:367-369` - `não registrada` e nenhuma decisão no texto; `:374-375` - estado técnico inalterado + `Recomendação humana: \`${decision}\``; `:392` - `assert.deepEqual(productAfter, productBefore)` | PASS |
| C47 | correção de gabarito gera revisão identificada; evidência anterior inalterada | `ok 50 - C47:` | `s5-report.test.mjs:413-414` - `revisão 2` + `Gabarito usado: revisão 2, hash ...`; `:420` - `assert.equal(again, first, 'relatório da execução anterior idêntico')` | PASS |
| C48 | amostra de 12 sem acurácia geral; uso indisponível ≠ custo zero; sem moeda sem tarifa | `ok 51 - C48:` | `s5-report.test.mjs:431-432` - textos das limitações; `:434` - `acurácia` aparece uma vez; `:435` - `assert.doesNotMatch(prose, /R\$\|US\$\|USD\|BRL\|€\|custo: 0\|economia de/, ...)` | PASS |
| C49 | relatório fixture marcado como simulado, sem validação real, VRAM ou ganho | `ok 52 - C49:` | `s5-report.test.mjs:457-458` - marca de simulação na saída e nas limitações; `:463` - `Conclusão: \`inconclusive\``; `:465` - `assert.doesNotMatch(fixture.markdown, /comprovada\|VRAM medida\|ganho de tradução de/)`; `:469` - live sem a marca | PASS |
| C50 | evidência **live real** T01–T06: servidor/modelo Q6_K, template confirmado, contagem, seis EN→PT, durações | sem `RUN_ID`: 0 testes, exit 2; com `RUN_ID=verifier-no-evidence`: `not ok 1 - C50:`, exit 2 | no evidence: não há coleta live real (`artifacts/ai-study/` inexistente no worktree e no checkout principal). Asserções que a fechariam: `live/s5-live.test.mjs:20-21` - `assert.deepEqual(proof.problems, [])` + `assert.equal(proof.proven, true)`. Bloqueios: `src/ai-study/template.mjs:14` `official: false` (Decisão 1) e `src/ai-study/lmstudio.mjs:43-44` `countTokens` → `{ count: null, ... }` (Decisão 2) | NÃO PROVADO - bloqueado |
| C51 | evidência **live real** de ≥1 caso R: PT→EN + duas respostas Jev da mesma versão, seis válidos cada | idem: 0 testes sem `RUN_ID`; `not ok 2 - C51:` com `RUN_ID` | no evidence: mesma ausência de coleta. Asserções que a fechariam: `live/s5-live.test.mjs:29` - `assert.equal(proof.proven, true, ...)`; `:31` - seis resultados por braço. Bloqueios: os mesmos de C50, mais as condições de entrada da S5 (rubricas revisadas, campo `model` do Jev) | NÃO PROVADO - bloqueado |
| C52 | `make ai-study-run MODE=live` com serviços controlados: zero CLIs excluídas | `ok 29 - C52:` | `s3-jev.test.mjs:548` - `assert.equal(run.status, 0, run.output)`; `:557` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:558` - `assert.deepEqual(run.guard.attempts, [], 'nenhum processo nem socket')` | PASS |
| C53 | fronteira live: transporte/resposta fixture → 2, evidências preservadas | `ok 30 - C53:` | `s3-jev.test.mjs:580-582` - `run.status` 2, `nodeStatus` 2, `/proveniência "fixture" incompatível com MODE=live/`; `:595-596` - `assert.deepEqual(after.rawResults, before.rawResults)` + manifesto | PASS |
| C54 | `make ai-study-report`: zero CLIs excluídas | `ok 53 - C54:` | `s5-report.test.mjs:519` - `assert.equal(result.shimCalls, '', ...)`; `:521` - `assert.deepEqual(result.guard.attempts.filter((a) => a.kind === 'process'), [], ...)` (fixture, live controlado e recusado) | PASS |
| C55 | 1º SIGINT/SIGTERM → `interrupted`, código 1, trava liberada; 2º sinal segue o padrão | `ok 43 - C55:` | `s4-limits.test.mjs:838` - `assert.equal(result.nodeStatus, 1, ...)`; `:840-844` - `['R01-evaluate-en', true, 'unknown']`; `:817-819` - `reason 'interrupted'` + trava liberada; `:894` - grupo `[null, 'SIGINT', null]`; `:915-917` - segundo sinal não engolido, nas 4 combinações, manifesto `running` (sem limpeza) | PASS |
| C56 | relatório e saída sem segredos sentinela, inclusive de erros HTTP/parsing | `ok 54 - C56:` | `s5-report.test.mjs:552` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)` sobre relatório, stdout e stderr; `:548-550` - `[omitido]` presente (havia exposição a redigir) | PASS |
| C57 | `make ai-study-report` preserva byte a byte as evidências relatadas e as outras | `ok 55 - C57:` | `s5-report.test.mjs:574` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before)`; `:575` - nenhuma execução removida | PASS |
| C58 | relatório recusa com 2 vínculo a outra execução, outra revisão ou `schema_version` ≠ 1 | `ok 56 - C58:` | `s5-report.test.mjs:585-597` (13 variantes) + `:600` `report(..., { expect: 2 })` → `:119` `assert.equal(result.nodeStatus, expect, ...)`; `:601` - `assert.match(refused.stderr, pattern, runId)`; `:602` - nenhum relatório | PASS |
| C59 | até 18 contagens de tokens em orçamento próprio `local_token_count`; 19ª bloqueada; falhas contadas; uma chamada por vez; sem retry do `@lmstudio/sdk` | `^C59:` → `# tests 0`, `Erro: nenhuma prova C<n>: executou com sucesso.`, exit 2 | no evidence: `rg -n "C59\|local_token_count" src tests` sem resultados; `@lmstudio/sdk` ausente de `package.json`; `src/ai-study/lmstudio.mjs:42-44` - "Sem pedido HTTP: não consome chamada do orçamento", `countTokens` devolve `count: null`. O próprio `checks.md:199` diz "pendente, não construído" | NÃO PROVADO - não construído |

### Cobertura das ACs (alocação de `checks.md`, sem recompute)

Pela tabela `Coverage` de `checks.md`, cada AC fecha só quando todos os checks que a cobrem são PASS:

- **AC 1–2, 4–9, 11–26, 28–37:** fechadas. Todos os checks alocados são PASS (`checks.md:269-273`).
- **AC 3:** fechada, porque C3, C52 e C54 são PASS (regra C3 + C52 + C54).
- **AC 10:** fechada, porque C10 e C53 são PASS (regra C10 + C53).
- **AC 27:** **aberta.** C31 é PASS, mas C59, a emenda de 01/10/2026 sobre o orçamento de contagem de tokens, não tem prova.
- **Fora da tabela de ACs:** os "Independent test" da S2 (C50) e da S3 (C51) também estão abertos. A tabela os aloca a `Corpus T`, `Direções de tradução`, `Modos/live` e `Proveniência no relatório/live identificado`. Hoje, AC 11–17 e 18–24 só têm prova por transportes controlados. Nenhuma tradução real e nenhuma avaliação Jev real foram observadas. A aprovação do corpus não aprova as traduções.

### Nível e amostragem

- Os claims de código de saída (C1, C4–C7, C9–C10, C30, C34, C36, C41, C52–C55, C56–C58) passam pela fronteira `make`. Os helpers leem o código do Node na linha `Error N` (`assertUsageFailure`, `s1-commands.test.mjs:39-41`; `report`, `s5-report.test.mjs:119`). Não encontrei lacuna de nível.
- C25, C27 e C28 cobrem cada linha das suas tabelas de decisão, além do caminho de integração (`s3-jev.test.mjs:340-363`, `:426-452`, `:509-538`).
- C42, "prosa fica em português": a prova é indireta. `assertNoBareCodes` (`s5-report.test.mjs:164-166`) recusa códigos em inglês soltos na prosa, mas não afirma o idioma das frases. A observação não é bloqueante, porque os títulos e as frases fixas assertados em C42–C49 estão em português.
- C31, "até duas verificações de template": a coleta faz uma verificação do candidato (`GET`, `s4-limits.test.mjs:150` → 19 locais). A borda 20/21 é provada no orçamento e na coleta com uma camada que repete pedidos (`:141-169`). Não encontrei lacuna.

## Swept existing re-read

A seção `Swept` de `checks.md` (`:316-326`) só aponta para checks. Nenhuma linha resolve para uma restrição **existente** no código. A única decisão marcada `existing` no plano é Observable/Harness (`plan.md`, "existing - tlc-spec-lean instalada, perfil light"). Ela está no código: `.claude/skills/tlc-spec-lean/` tem `references/` e `scripts/`, e `checks.md:3` diz `Profile: light`. O LM Studio e o Jev aparecem como `exists` no Flow, mas são serviços externos. Este verificador não os acessou, por restrição.

## Coverage

Perfil `light`: o recompute do join de Coverage **não foi executado**. A seção "Cobertura das ACs" acima só lê a alocação de `checks.md` e soma os resultados por check. Não é recompute a partir da autoridade de cada conjunto.

## Test policy rows

`checks.md` não tem seção `Test policy`. O perfil `light` também não emite veredito sobre ela.

## Faults injected

Perfil `light`: a injeção de falhas **não foi executada**. Não alego mutantes mortos.

## Observations (non-blocking)

1. C55: a espera fixa de 300 ms entre os sinais (`s4-limits.test.mjs:908`) traz risco de flakiness, sem risco de falso verde. Se o primeiro sinal não for tratado a tempo, o teste falha.
2. O mecanismo de C50/C51 depende da origem do `RUN_ID` (STATE.md, escolha 5 da S5). Depois que o template oficial for adotado, uma coleta com serviços controlados gravada em `artifacts/ai-study/` passaria pelos verificadores. Por isso, o `RUN_ID` que fechar C50/C51 precisa vir de uma coleta live autorizada, e o verificador da próxima rodada deve conferir a proveniência real, não só o teste verde.

## Histórico (rodadas anteriores, escopo S1–S4)

Esta seção é histórico e não serve de prova nesta rodada. As rodadas anteriores tiveram escopo parcial e estão preservadas no Git:

- Rodada 5 (scoped, S1–S4, range `5417c97..7868a78`): PASS em 43/43 checks construídos. Relatório completo em `git show b2520fe:.specs/features/jev-translation-feasibility/verification.md`.
- Rodada 4 (S4, `864b31b`): FAIL em C55 (segundo sinal de outro tipo engolido), corrigido em `7868a78`. Lição L-004.
- Rodada 3 (S4, `4470b14`): FAIL em C36/C39/C40 (partes do relatório), divididas em C56–C58 por decisão do usuário. Lições L-001, L-002 e L-003.
- Rodada 2 (S3, `4eea13b`) e Rodada 1 (S1+S2, `166a2b9`): PASS nos checks então construídos.

## Gate

- `make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C[1-4][0-9]|C5[0-9]):'`: 56 passed, 0 failed, 0 skipped, 0 todo, exit 0. Faltam C50, C51 e C59.
- `npm test`: 59 passed, 0 failed. `npm run check`: exit 0.
- C50/C51 com `RUN_ID` sem evidência: 0 passed, 2 failed. C59: nenhum teste.
- `python3 .claude/skills/tlc-spec-lean/scripts/validate_verification.py jev-translation-feasibility` → exit 1: `ERROR jev-translation-feasibility: verdict is FAIL - route the ranked gaps back as fixes, then re-verify` / `validate_verification: 1 error(s), 0 warning(s) across [jev-translation-feasibility]`.
- `git status --porcelain`: vazio antes; depois do relatório, só ` M .specs/features/jev-translation-feasibility/verification.md` (mais `.specs/lessons.json`/`.specs/LESSONS.md` pela lição).

## Lições

Registrada via `scripts/lessons.py add` uma lição `ac_gap` para C59 (check derivado de emenda sem slice que o construa). C50/C51 não geraram lição: a causa é pré-requisito externo (template oficial, contagem de tokens, autorização da coleta), não uma falha de execução neste código.
