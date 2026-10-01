# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: PASS
**Scope**: S1 + S2 + S3 + S4 (C1–C40, C52, C53, C55) - slices construídas (PRB-2, PRB-3, PRB-4, PRB-5); C41–C51, C54 e C56–C59 fora de escopo (não construídos)
**Profile**: light
**Diff range**: 5417c97..7868a78 (fix da Round 4, card PRB-5, PR #5); provas de todos os checks construídos re-executadas em `7868a78`
**Round**: 5 - scoped
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação, do review do PR #5 nem das verificações das Rounds 3 e 4

Verificado em `7868a78` (HEAD), Node v24.21.0. A árvore real ficou somente leitura. `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas, depois da reprodução dos sinais (script no scratchpad que importa `tests/ai-study/helpers.mjs` e roda em sandboxes temporárias com `TMPDIR` no scratchpad) e depois do experimento com o `cli.mjs` antigo (`git worktree add --detach` no scratchpad, removido ao final; `git worktree list` voltou às duas entradas anteriores; nenhum processo `ai-study` órfão). Depois da escrita deste relatório, a porcelain mostra só ` M .specs/features/jev-translation-feasibility/verification.md`. Não chamei LM Studio, Jev nem modelo real. Usei só os transportes, o `fetch` e os processos controlados dos testes.

**Resultado em uma linha:** 43 de 43 checks construídos estão provados, com asserção localizada. O FAIL da Round 4 (C55, segundo sinal de outro tipo engolido) está corrigido em `src/ai-study/cli.mjs:63-67` e provado nas quatro combinações; reproduzi o comportamento em HEAD e confirmei que a nova asserção falha com o `cli.mjs` de `5417c97`.

### Escopo pelo diff

Verified at 7868a78. `git diff --stat 5417c97..7868a78` tem um commit (`7868a78`) e 4 arquivos, +51/−30:

- `src/ai-study/cli.mjs`: `INTERRUPT_SIGNALS` (`:58`); `onSignal` remove os listeners dos dois sinais antes de `abort()` (`:63-66`); registro com `process.on` (`:67`). Só o bloco de entrada (`import.meta.url === ...`); `main` não mudou.
- `tests/ai-study/s4-limits.test.mjs`: só o corpo do C55 (`:868-883` entre chamadas, agora SIGINT e SIGTERM com `calls` completo; `:918-940` segundo sinal nas quatro combinações). O teste continua em `:841`; nenhuma outra linha do arquivo mudou (`rg -n "^\s*test\('" ` dá as mesmas linhas da Round 4).
- `checks.md`: texto e Status do C55 (`:193`, `:195`) e o parágrafo de fronteira (`:299`).
- `plan.md`: linha "Comandos Make | Códigos de saída" (`:240`).

Raio de alcance: `cli.mjs` é importado pelos testes (`selectTransports`), mas o bloco alterado só roda quando o arquivo é o entrypoint; ele serve a todo teste que passa pelo `make`, e a suíte completa passou. Nenhum helper, fixture ou Makefile mudou.

Classificação:

- **Verified at 7868a78:** as provas dos 43 checks, re-executadas em full; o julgamento do C55 (não PASS na Round 4; código, texto e teste mudaram); o parágrafo de fronteira e a emenda do `plan.md`.
- **Carried from 864b31b:** os julgamentos de C30, C34, C36, C39 e C40 (re-julgados na Round 4; texto e teste intocados por `7868a78`), a divisão C36/C39/C40 → C56–C58 e o C59.
- **Carried from 4470b14:** os julgamentos de C1–C29, C31–C33, C35, C37, C38, C52 e C53 (com o que a Round 3 trazia de `4eea13b`). Linhas citadas conferidas com `rg -n`: iguais.

## Binding sources

Carried from 864b31b. O passo 1 só roda no profile `ui`, então não rodou sob `light`. O fix não toca o [corpus](corpus.md) nem a interface pública (`git diff 5417c97..7868a78 -- .specs/features/jev-translation-feasibility/corpus.md Makefile` vazio; em `src`, só o tratamento de sinais do entrypoint).

## Checks

Verified at 7868a78. Uma invocação para o alvo inteiro:
`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C1[0-9]|C2[0-9]|C3[0-9]|C40|C52|C53|C55):'`. Exit 0; TAP `# tests 43 # pass 43 # fail 0 # cancelled 0 # skipped 0 # todo 0`. Cada nome aparece uma vez: `ok 1 - C1:` … `ok 5 - C5:`, `ok 6 - C9:`, `ok 7 - C10:`, `ok 8 - C11:`, `ok 9 - C12:`, `ok 10 - C6:`, `ok 11 - C7:`, `ok 12 - C8:`, `ok 13 - C13:` … `ok 28 - C28:`, `ok 29 - C52:`, `ok 30 - C53:`, `ok 31 - C31:`, `ok 32 - C32:`, `ok 33 - C33:`, `ok 34 - C35:`, `ok 35 - C40:`, `ok 36 - C29:`, `ok 37 - C30:`, `ok 38 - C34:`, `ok 39 - C36:`, `ok 40 - C37:`, `ok 41 - C38:`, `ok 42 - C39:`, `ok 43 - C55:`. Nenhuma linha `# SKIP`/`# TODO` (`grep -c` → 0).

Existência: `rg -n "^\s*test\('[A-Z0-9]+:" tests/` encontra exatamente os 43 nomes C, mais `S3:` (`s3-jev.test.mjs:600`):

- `s1-commands.test.mjs:52,91,119,147,166,234,262,341,368` (C1–C5, C9–C12)
- `s1-corpus.test.mjs:68,87,119` (C6–C8)
- `s2-translation.test.mjs:155,218,247,309,346,392,449,523` (C13–C20)
- `s3-jev.test.mjs:118,157,202,246,284,367,410,473,541,568` (C21–C28, C52, C53)
- `s4-limits.test.mjs:132,218,253,325,392,477,557,586,638,704,745,789,841` (C31, C32, C33, C35, C40, C29, C30, C34, C36, C37, C38, C39, C55) - iguais à Round 4.

`make checks-validate`: `validate_checks: 0 error(s), 0 warning(s) ... [profile: light]`. `make plan-validate`: `validate_plan: 0 error(s), 0 warning(s)`.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | dry-run válido: modo, hashes, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `tests/ai-study/s1-commands.test.mjs:57` - `assert.equal(fixture.status, 0, fixture.output)`; `:60` - `assert.equal(f['hash do corpus'], corpus.corpusHash)`; `:74` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos | `ok 2 - C2:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:100` - `assert.equal(guard.loaded, 3, ...)`; `:116` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação e coleta fixture: zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:127` - `assert.equal(run.status, 0, run.output)`; `:135` - `assert.equal(last.shimCalls, '', ...)`; `:136` - `assert.deepEqual(last.guard.attempts, [], ...)`; `:142` - `assert.doesNotMatch(source, <regex>, file)`, regex que alterna `child_process` e `worker_threads` (agora cobre também `calls.mjs` e `run-reader.mjs`) | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:152` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:157` - `assertUsageFailure(run, /MODE/, ...)` (`:38`, status 2 e código do Node 2) | PASS |
| C5 | config inválida → 2 antes de coletar, sem segredo; tabela completa | `ok 5 - C5:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:206-208` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` | PASS |
| C6 | corpus exato R01–R12/T01–T06; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `tests/ai-study/s1-corpus.test.mjs:70` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)`; `:31-32` - `assert.equal(run.status, 2, ...)` + `assert.equal(run.nodeStatus, 2, ...)`, agora em dry-run **e** `ai-study-run`; `:36` - `assert.ok(!existsSync(join(sandbox.evidenceDir, name)), ...)` | PASS |
| C7 | seis julgamentos, rótulo válido, justificativa; violações → 2 | `ok 11 - C7:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-corpus.test.mjs:90` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:31-36` nas duas fronteiras | PASS |
| C8 | resultados vinculados aos mesmos hashes; alteração impede comparação | `ok 12 - C8:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-corpus.test.mjs:139` - `assert.equal(result.corpus_hash, base.corpusHash)`; `:174` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos fixture, `schema_version: 1` | `ok 6 - C9:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:237` - `assert.equal(run.status, 0, run.output)`; `:244` - `assert.equal(evidence.manifest.schema_version, 1)`; `:250` - 42 resultados | PASS |
| C10 | fixture: live → 2 preservando evidências; coletor live: fixture rejeitado | `ok 7 - C10:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:266` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`; `:321` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/`; `:329` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')` | PASS |
| C11 | aceita RUN_ID 1/64, timeout inteiro positivo, saída 1/2048; 20/24 | `ok 8 - C11:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:355` - `assert.equal(manifest[key], value, key)`; `:363` - `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; relatório exige RUN_ID; live exige config; token opcional; sem flags | `ok 9 - C12:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s1-commands.test.mjs:374` - `assert.equal(manifest['run_id'], 'gerado na coleta')`; `:382` - `/^[A-Za-z0-9_-]{1,64}$/`; `:393` - `resolveConfig('report', {})` lança `UsageError` `/RUN_ID/`; `:407` - `assert.equal(noToken.local.apiToken, null, ...)`; `:411` - `assertUsageFailure(flagged, new RegExp(name), ...)` | PASS |
| C13 | tradução registra original, direção, modelo, revisão do template, vínculo | `ok 13 - C13:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `tests/ai-study/s2-translation.test.mjs:173` - `assert.equal(t.run_id, 'c13')`; `:177` - `assert.equal(t.template_revision, revision)` | PASS |
| C14 | template não confirmado → `template_unverified`, sem envio | `ok 14 - C14:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:224` - `assertIncomplete(outcome, 'template_unverified')`; `:226` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:244` - `assert.deepEqual(lm.calls, [])` | PASS |
| C15 | 2048 admitido; 2049 → `input_limit`; contagem inclui template | `ok 15 - C15:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:260` - `assert.equal(counted[index].request.prompt, expected)`; `:269` - `assertIncomplete(first, 'input_limit')` | PASS |
| C16 | contagem indisponível/tokenizer divergente → `token_count_unavailable` | `ok 16 - C16:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:322` - `assertIncomplete(outcome, 'token_count_unavailable')` | PASS |
| C17 | saída literal como derivação; braço EN usa a derivação | `ok 17 - C17:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:360` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:374` - `assert.equal(enResult.derived_from, \`${c.id}-translate-pt-en\`)` | PASS |
| C18 | vazia/espaços/limite → `invalid_translation`, sem Jev EN | `ok 18 - C18:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:412` - `assert.equal(byCase[caseId].status, 'invalid_translation', caseId)`; `:420` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)` | PASS |
| C19 | duração ms, metadados do runtime, justificativa; sem download como VRAM | `ok 19 - C19:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:466` - `assert.ok(Number.isInteger(duration) && duration >= 25, ...)`; `:478` - `/download/` na justificativa; `:490` - `assertIncomplete(missing, 'model_mismatch')` | PASS |
| C20 | identidade solicitada/retornada Q6_K; sem trocar/instalar/baixar | `ok 20 - C20:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s2-translation.test.mjs:537` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:562` - `assertIncomplete(outcome, reason)` | PASS |
| C21 | seis julgamentos `Choice` na mesma chamada, critérios yes/no/insufficient | `ok 21 - C21:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `tests/ai-study/s3-jev.test.mjs:125` - `assert.equal(jevCalls.length, 24, ...)`; `:134` - `assert.deepEqual(Object.keys(call.body), ['state', 'model', 'questions'], ...)`; `:141` - `assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id)` | PASS |
| C22 | payloads sem gabarito, justificativa ou revisão humana | `ok 22 - C22:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:192` - `assert.ok(!payload.includes(SENTINEL), ...)`; `:194` - `assert.deepEqual(sent(alt), sent(base))` | PASS |
| C23 | par com instruções, rubricas, IDs, critérios e modelo iguais; só o texto varia | `ok 23 - C23:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:212` - `assert.deepEqual(body.questions, reference.questions, ...)`; demais linhas de 4eea13b +3 | PASS |
| C24 | alternância PT/EN e EN/PT até R12, caso e braço preservados | `ok 24 - C24:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:264` - `assert.deepEqual(sentOrder, expectedOrder)`; `:266` - `assert.deepEqual(persisted, expectedOrder)` | PASS |
| C25 | validação Jev de AC 21; violação → `invalid_response` sem inferir | `ok 25 - C25:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:295` - `assert.deepEqual(validateEvaluation(results), [], label)`; `:329` - `assert.ok(problems.length > 0, label)`; `:352` - `invalid.evaluation.status === 'invalid_response'`. Tabelas carried from 4eea13b (+3) | PASS |
| C26 | avaliação persistida com identificação, distribuição, uso, duração; uso ausente não vira zero | `ok 26 - C26:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:396` - `assert.ok(Number.isInteger(e.duration_ms) && e.duration_ms >= 25, ...)`; `:399` - `assert.deepEqual(first.evaluation.usage, { available: true, value: usage })` | PASS |
| C27 | acerto/erro/ausência; `insufficient` é escolha | `ok 27 - C27:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:421` - `assert.equal(compareChoice(choice, expected), outcome, ...)`; `:440` - PT `{ hit: 12, miss: 0, absent: 0 }` | PASS |
| C28 | par incompleto fora do denominador; individual visível | `ok 28 - C28:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:496` - `assert.deepEqual(pair.reasons, reasons, label)`; `:499` - `assert.equal(comparison.counts.paired.denominator, reasons.length === 0 ? 1 : 0, ...)`; `:531` - denominador 10 | PASS |
| C29 | duas coletas simultâneas: só uma; a segunda é rejeitada antes de chamar modelos ou alterar a primeira | `ok 36 - C29:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `tests/ai-study/s4-limits.test.mjs:499-501` - `assert.equal(second.status, 2, ...)` + `assert.equal(second.nodeStatus, 2, ...)` + `/outra coleta \(processo ${firstPid}\) está em andamento/` (processos `make` reais concorrentes, a primeira parada na barreira com a trava, `:489`); `:503` - `assert.equal(started().length, 1, 'nenhuma segunda coleta chegou a uma chamada')`; `:504` - `readServices(sandbox).every((entry) => entry.pid === firstPid)`; `:505-506` - nenhuma execução nova + `assert.deepEqual(snapshotFiles(...c29-primeira), firstBefore, ...)`; mesmo processo `:532-536` - `UsageError` e `assert.equal(used, 0)` | PASS |
| C30 | RUN_ID existente → código 2 da CLI Node (linha `Error 2`), bytes de todos os arquivos anteriores mantidos, inclusive de incompleta | `ok 37 - C30:` | carried from 864b31b (texto mudou na Round 4, teste não; nem texto nem teste tocados por 7868a78; linhas iguais): `tests/ai-study/s4-limits.test.mjs:563` - anterior `status === 'incomplete'`; `:572-573` - `assert.equal(again.status, 2, ...)` + `assert.equal(again.nodeStatus, 2, ...)`. `nodeStatus` vem da linha `] Error (\d+)` (`tests/ai-study/helpers.mjs:153`), que é exatamente onde o novo texto diz que o código é lido. `:577` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before, ...)`; `:578` - nenhuma chamada | PASS |
| C31 | máx. 20 locais / 24 Jev contando falhas; 21ª/25ª bloqueada; zero retries | `ok 31 - C31:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `s4-limits.test.mjs:140` - `e.reason === 'call_limit' && !e.requestSent`; `:142` - `assert.equal(executed, 44, ...)`; `:161` - `assert.equal(retryingLocal.svc.count('local'), 20, 'exatamente 20 pedidos locais saíram')`; `:174` - `assert.equal(retryingJev.svc.count('jev'), 24, ...)`; `:189` - `assert.equal(svc.count(service), nth, \`${label}: nenhum pedido repetido\`)` + `:192` - falha contada em `manifest.calls`; `:151` - a verificação do candidato conta (19 = 1 GET + 18). Ver observação 3 (precisão de "verificações de template") | PASS |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `s4-limits.test.mjs:227` - `e.reason === 'concurrent_call' && e.requestSent === false`; `:230` - `assert.equal(started, 0, ...)`; `:241` - `assert.equal(svc.maxInFlight(), 1)`; `:243` - início/fim alternam em todos os 43 pedidos; `:245-250` - GET candidato, tradução e braços alternados em série | PASS |
| C33 | timeout local/Jev encerra no limite, `incomplete`, restantes não executados, resultado remoto desconhecido sem alegar cancelamento | `ok 33 - C33:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `s4-limits.test.mjs:273` - `assert.ok(waited >= 990 && waited < 1900, ...)` (servidor local que ignora o abort); `:277-278` - `status === 'incomplete'`, `reason === 'timeout'`; `:279-287` - `failure` com `remote_outcome: 'unknown'`, `request_sent: true`; `:289` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/)`; `:292` - `not_executed_items` = restantes | PASS |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → código 1 da CLI Node (linha `Error 1`, o make sai com 2), prefixo preservado, restantes não executados, sem trocar provedor/idioma | `ok 38 - C34:` | carried from 864b31b (texto mudou na Round 4, teste não; nem texto nem teste tocados por 7868a78; linhas iguais): `s4-limits.test.mjs:605-606` - `assert.equal(run.status, 2, \`${label}: o make falha\`)` + `assert.equal(run.nodeStatus, 1, \`... "Error 1" ...\`)`. As duas metades do novo texto ("o próprio make sai com 2" e "código 1 ... `Error 1`") são asserções. `:616` - `assert.deepEqual(manifest.not_executed_items, remainingAfter(last), ...)`; `:620` + `:625` - prefixo íntegro; `:632-634` - mesmas origens e mesmo modelo | PASS |
| C35 | interrupção antes/depois do rename de manifesto/resultado: destino anterior ou novo íntegro; temporário/JSON parcial não aceito | `ok 34 - C35:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `s4-limits.test.mjs:314` - `assert.equal(result.signal, 'SIGKILL', ...)`; `:329`/`:333` - manifesto anterior/novo íntegro; `:337-338`/`:340` - resultado ausente+temporário / novo íntegro; `:346` - `assert.doesNotThrow(() => JSON.parse(content), file)`; `:352` - temporário em `ignored` com `reason === 'temporary'`; `:366` + `:370` - `loadRun` recusa resultado e manifesto parciais | PASS |
| C36 | segredos (chave, token, URL credenciada, cabeçalho), inclusive ecoados, fora de stdout/stderr do dry-run e da coleta e de manifesto, resultados e comparação, inclusive em erros HTTP, de parsing e de transporte; chave/token < 8 → código 2 (`Error 2`), sem chamadas e sem execução | `ok 39 - C36:` | carried from 864b31b (texto mudou na Round 4, teste não; nem texto nem teste tocados por 7868a78; linhas iguais): `s4-limits.test.mjs:659` - `assert.deepEqual(runs.map((r) => r.nodeStatus), [0, 0, 1, 1, 1, 1, 1], ...)`, sobre o dry-run (`runs[0]`) e seis coletas (HTTP, parsing e transporte, `:651-657`); `:663` - `assert.equal(done.results[0].response.runtime_details.stats.echo, 'Bearer [omitido]')`, prova de que o eco chegou; `:695` - `comparison.json` e `manifest.json` entre os arquivos varridos; `:698` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)` sobre stdout e stderr das 7 execuções e todos os arquivos de evidência; `:700` - nenhum `authorization: Bearer` não omitido; `:685` - `assert.equal(short.nodeStatus, 2, ...)` (dry-run e coleta); `:688` - `assert.ok(!existsSync(join(sandbox.evidenceDir, \`c36-curto-${name}\`)), ...)`; `:691` - `assert.equal(readServices(sandbox).length, requestsBefore, 'nenhuma chamada com segredo curto')` | PASS |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches anteriores; mesmo ID segue C30 | `ok 40 - C37:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `s4-limits.test.mjs:725-726` - 18 traduções e 24 avaliações refeitas; `:730-731` - sentinela ausente dos resultados e dos pedidos; `:737` - `assert.deepEqual(evidenceReads.filter(...), [])` (rastreio de `fs`); `:741-742` - mesmo ID → 2, bytes intactos | PASS |
| C38 | corpus sintético, zero leituras de chats/Cloak/credenciais; tráfego só ao servidor configurado e ao Jev oficial | `ok 41 - C38:` | carried from 4470b14 (texto e teste não tocados por 864b31b nem por 7868a78; linhas iguais): `s4-limits.test.mjs:775` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:777` - nenhum caminho com `cloak`, `.claude`, `.codex`, `.ssh`, `.aws` ou `/gh/`; `:783` - origens `['http://lmstudio.interno:4321', 'https://api.typesafe.ai']`; `:785` - Jev só em `https://api.typesafe.ai/v1/systemone` | PASS |
| C39 | evidências fora do Git; sobrevivem byte a byte a nova coleta e à leitura por `loadRun`, sem limpeza, inclusive arquivos alheios à bancada | `ok 42 - C39:` | carried from 864b31b (texto mudou na Round 4, teste não; nem texto nem teste tocados por 7868a78; linhas iguais): `s4-limits.test.mjs:799` - `assert.equal(git('check-ignore', '-q', path).status, 0, ...)` no repositório real; `:801` - `assert.equal(git('ls-files', '--', 'artifacts').stdout, '', ...)`; `:808-809` - arquivos alheios (`notas.md` e um `.tmp` parcial) gravados antes do snapshot; `:815` - `assert.equal(after[file], content, \`${file} preservado\`)` depois de nova coleta e de `loadRun` sobre as três execuções (`:811-812`); `:816` - nenhuma execução removida | PASS |
| C40 | relações `schema_version: 1`; `loadRun` recusa vínculo a outra execução ou revisão e arquivo com outra versão de schema | `ok 35 - C40:` | carried from 864b31b (texto mudou na Round 4, teste não; nem texto nem teste tocados por 7868a78; linhas iguais): relações `s4-limits.test.mjs:406` - `assert.equal(manifest.schema_version, 1)`; `:420` - idem por resultado; `:430` - `assert.deepEqual([r.evaluation.run_id, r.evaluation.case_id, r.evaluation.arm], ['c40', r.item.case_id, r.item.arm])`; `:431` - braço EN → tradução do caso; recusas `:455` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)` sobre 12 variantes (`:441-452`: outra execução ×3, revisão ×2, schema ×3, vínculos ×3, item fora do plano); `:458` - revisão diferente da esperada | PASS |
| C52 | live com serviços controlados: zero Codex/Claude/Grok/agy/Cloak | `ok 29 - C52:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:548` - `assert.equal(run.status, 0, run.output)`; `:553` - 42 resultados; `:557` - `assert.equal(run.shimCalls, '', ...)`; `:558` - `assert.deepEqual(run.guard.attempts, [], ...)` | PASS |
| C53 | fronteira live: transporte/resposta fixture → 2, preservando evidências | `ok 30 - C53:` | carried from 4470b14 (teste não tocado por 864b31b nem por 7868a78; linhas iguais): `s3-jev.test.mjs:580-582` - `run.status === 2`, `run.nodeStatus === 2`, `/proveniência "fixture" incompatível com MODE=live em R01-evaluate-pt/`; `:595` - `assert.deepEqual(after.rawResults, before.rawResults)` | PASS |
| C55 | 1º SIGINT/SIGTERM → `incomplete`/`interrupted`, sem alegar cancelamento, trava liberada; durante chamada `unknown`; fora de chamada, sem que a seguinte saia; sinal só no Node → `Error 1`; Ctrl+C no grupo → make morre pelo sinal, manifesto autoritativo; segundo sinal, do mesmo tipo ou do outro, segue o padrão, sem limpeza | `ok 43 - C55:` (exit 0) | verified at 7868a78 (código, texto e teste mudaram). Código: `src/ai-study/cli.mjs:63-67` - `onSignal` faz `for (const name of INTERRUPT_SIGNALS) process.off(name, onSignal)` antes de `interrupt.abort()`, registrado com `process.on` nos dois nomes. Durante chamada, SIGINT e SIGTERM: `tests/ai-study/s4-limits.test.mjs:856` - `assert.equal(result.nodeStatus, 1, ...)`; `:857` → `assertInterrupted` (`:835-837`: `incomplete`, `interrupted`, trava ausente); `:858-861` - `['R01-evaluate-en', true, 'unknown']`; `:864` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/, signal)`. Entre chamadas, **SIGINT e SIGTERM** (`:869`): `:876` - `nodeStatus` 1; `:879` - `assert.equal(betweenManifest.failure, null, ...)`; `:880` - `completed_items` `['R01-translate-pt-en']`; `:882` - `assert.deepEqual(betweenManifest.calls, { local: { used: 1, limit: 20 }, jev: { used: 0, limit: 24 } }, signal)`. Antes do envio: `:893-896` - `['R01-translate-pt-en', false, 'not_sent']`; `:898` - `calls.local.used === 0`. Grupo do make: `:912` - `[status, signal, nodeStatus]` = `[null, 'SIGINT', null]`; `:914` - `] Interrupt`; `:915-916` - manifesto `interrupted`/`unknown`. **Segundo sinal, quatro pares** (`:922`): `:927` - vivo depois do 1º; `:933` - `assert.ok(result, \`${first} → ${second}: o segundo sinal não foi engolido\`)` (corrida contra 3 s, antes de liberar a barreira); `:934` - `assert.equal(result.nodeStatus, exitCode[second], ...)` com `{ SIGINT: 130, SIGTERM: 143 }` (`:921`), isto é, morto pelo **segundo** sinal; `:935` - manifesto `running` (sem limpeza); `:937` - trava com o pid do processo. Reproduzido por mim em HEAD e contraprova com o `cli.mjs` antigo: ver "C55 - julgamento" | PASS |

### C55 - julgamento

Verified at 7868a78. **Veredito: PASS.** O FAIL da Round 4 está fechado e as duas observações menores do C55 também.

**Código.** Com `process.once` por nome, o primeiro sinal só removia o próprio listener e o do outro tipo engolia o segundo sinal. Agora o primeiro sinal, de qualquer tipo, remove os dois listeners (`cli.mjs:64`) antes de abortar (`:65`). Sem listener, o segundo SIGINT ou SIGTERM recebe a ação padrão do Node, que encerra o processo pelo sinal sem rodar `finally` nem gravar manifesto. É o que o claim pede.

**Reprodução própria em HEAD.** Script no scratchpad, sandbox do `makeSandbox`, coleta fixture presa na barreira antes da primeira chamada, primeiro sinal, 300 ms, segundo sinal e 1 s de espera antes de liberar a barreira:

| 1º → 2º | Vivo após o 1º | Vivo 1 s após o 2º | `nodeStatus` (linha `Error N`) | Manifesto | Trava |
| --- | --- | --- | --- | --- | --- |
| SIGINT → SIGINT | sim | não | 130 | `running` | presente |
| SIGINT → SIGTERM | sim | não | 143 | `running` | presente |
| SIGTERM → SIGINT | sim | não | 130 | `running` | presente |
| SIGTERM → SIGTERM | sim | não | 143 | `running` | presente |

Em todos os pares o processo morre pelo segundo sinal (128 + 2 ou 128 + 15), sem limpeza. Com o `cli.mjs` de `5417c97` copiado no mesmo sandbox, SIGINT → SIGTERM e SIGTERM → SIGINT ficam vivos 1 s depois do 2º sinal e só terminam quando a barreira é liberada, com `nodeStatus 1` e `incomplete`/`interrupted`. Isso confirma o contraexemplo da Round 4.

**A nova asserção mata o defeito.** Num `git worktree add --detach` no scratchpad, com o `cli.mjs` de `5417c97` e o teste de HEAD, `make check-proof TEST_FLAGS='--test-name-pattern=^C55:'` sai com 2: `not ok 1 - C55: ...`, `error: 'SIGINT → SIGTERM: o segundo sinal não foi engolido'` (`:933`). A worktree foi removida, e a porcelain da árvore real ficou igual antes e depois. Isso não conta como injeção de falhas, que não roda no profile `light`. É só a contraprova pedida para o fix.

**Observações menores da Round 4:**

- SIGTERM fora de uma chamada agora tem prova direta: entre chamadas (`:869-883`) e como primeiro sinal nos pares `SIGTERM → *` (`:925-927`). Resolvida.
- No caso entre chamadas, `calls` é assertado por inteiro, com `jev.used === 0` (`:882`). "Sem que a chamada seguinte saia" passa a ter prova direta. Resolvida.

**Texto do claim e Status.** `checks.md:193` acrescenta "do mesmo tipo ou do outro". Isso só torna explícito o que a frase do plano ("um segundo sinal segue o comportamento padrão", `plan.md:176`) já exigia. O texto não fica mais fraco. O Status (`:195`) descreve exatamente os casos do teste.

Ressalva não bloqueante: a espera de 300 ms entre os sinais (`:926`) é heurística. Se o primeiro sinal não chegasse a ser tratado nesse intervalo, os dois sinais encontrariam o listener instalado, e o teste falharia em vez de passar indevidamente. O risco é de flakiness, não de falso verde.

### Fronteira e nível

Verified at 7868a78 para os arquivos tocados. O parágrafo de `checks.md:299` passa a dizer "quando o recipe falha, o próprio make sai com 2" e abre exceção explícita para o make encerrado por um sinal do grupo (Ctrl+C), que termina sem `Error N`, com o manifesto como término autoritativo (C55). A emenda de `plan.md:240` diz o mesmo. Isso fecha a observação 1 da Round 4.

**Não enfraquece outra obrigação.** A exceção cobre só o make morto por sinal (`status === null`), caso em que `nodeStatusFromMake` devolve `null` (`tests/ai-study/helpers.mjs:152`). Nenhuma asserção que espera 1 ou 2 passa com `null`. C34 continua assertando o make com 2 e o Node com 1 (`s4-limits.test.mjs:605-606`). C29, C30 e C36 continuam assertando `nodeStatus` 2 pela linha `Error 2`. Os códigos 130/143 do segundo sinal não contradizem o parágrafo: nesse caso o make **não** foi morto. Ele reporta `Error 130`/`Error 143`, que é o código do processo filho lido pela mesma linha, e o claim do C55 promete "comportamento padrão", não código 1 ou 2. A emenda do plano corrige um fato antes descrito largo demais, não muda uma decisão. Aceitei-a como coerente. A autorização do usuário não pode ser conferida por outra fonte além do commit. C1–C35, C37, C38, C52 e C53: carried from 4470b14.

## Swept existing re-read

Carried from 864b31b. `checks.md` não tem linhas `Swept` marcadas como existentes, e o fix não tocou a seção Swept (`git diff 5417c97..7868a78 -- checks.md` só altera as linhas 193, 195 e 299).

## Coverage

Profile `light`: o recompute de Coverage não roda.

## Test policy rows

`checks.md` não tem seção `Test policy`, e o profile `light` não emite veredito sobre ela.

## Faults injected

Profile `light`: a injeção de falhas não roda. A contraprova do C55 com o `cli.mjs` antigo (acima) só confirma que o fix e a asserção nova estão ligados.

## Out of scope (not built)

C41–C51 e C54 (S5), C56, C57 e C58 (S5), e C59 (S4, pendente da contagem de tokens). `rg -n "C5[6-9]|C4[1-9]|C5[01]|C54" tests --glob '*.test.mjs'` não encontra testes deles, e eles **não** contam como aprovados.

## Observations (non-blocking)

Verified at 7868a78, salvo indicação.

1. **Resolvidas desde a Round 4:** o C55 cruzado (FAIL), a falta de prova do SIGTERM fora de chamada, `calls.jev` entre chamadas e o parágrafo de fronteira largo demais.
2. **C55, espera fixa de 300 ms entre os sinais** (`s4-limits.test.mjs:926`): risco de flakiness, sem risco de falso verde (ver "C55 - julgamento").
3. (Carried from 4470b14.) A observação sobre "verificações de template" em C31 continua aberta. A observação sobre a pré-carga de C52/C53, `globalThis.WebSocket` e as condições de entrada da S5 também continua.

## Round 4 history (S4, 864b31b)

Carried from 864b31b. A Round 4 (scoped) foi feita por sub-agente independente, profile `light`, range `243d02d..864b31b`, e deu veredito FAIL, com 42 de 43 checks PASS. O C55 falhou porque `cli.mjs` registrava `process.once` por tipo de sinal e um segundo sinal do outro tipo era engolido. A Round 4 reproduziu o defeito. Ela também julgou legítima a divisão de C36/C39/C40 em C56–C58 (cada cláusula removida reaparece com o mesmo sujeito em C56, C57 ou C58; a autorização do usuário só aparece em `STATE.md` e no Status) e julgou que o C59 cobre a emenda da AC 27 sem contradizer o C31. Observações menores: SIGTERM fora de chamada sem prova, `calls.jev` não assertado entre chamadas e o parágrafo "make sai com 2 em qualquer falha". O relatório completo está em `git show 5417c97:.specs/features/jev-translation-feasibility/verification.md`. Lição registrada: L-004.

## Round 3 history (S4, 4470b14)

Carried from 4470b14. A Round 3 foi feita por sub-agente independente, profile `light`, range `14ab14a..4470b14`, e deu veredito FAIL, com 40 de 43 checks PASS. C36, C39 e C40 ficaram PARTIAL porque exigiam o relatório da S5. O relatório completo está em `git show 243d02d:.specs/features/jev-translation-feasibility/verification.md`. Lições registradas: L-001, L-002 e L-003.

## Round 2 history (S3, C21–C28, C52, C53)

Carried from 4eea13b. A Round 2 foi feita por sessão nova independente, profile `light`, range `3985c43..4eea13b`, e deu veredito PASS para C1–C28, C52 e C53. O relatório completo está em `git show 4470b14:.specs/features/jev-translation-feasibility/verification.md`.

## Round 1 history (S1 + S2, C1–C20)

Carried from 166a2b9. A Round 1 foi feita por verificador independente, profile `light`, range `dba3999..166a2b9`, e deu veredito PASS.

## Gate

Verified at 7868a78. `make check-proof` com a suíte completa, sem filtro: exit 0; 45 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. São os 43 checks, mais o teste de fidelidade do corpus e o teste `S3:`. `make checks-validate`: 0 erros e 0 avisos. `make plan-validate`: 0 erros e 0 avisos. `git status --porcelain`: vazio antes; vazio depois das provas e dos experimentos; depois do relatório, só ` M .specs/features/jev-translation-feasibility/verification.md`.

Passo 7: não se aplica, porque não houve falha fundamentada nesta rodada. A ressalva dos 300 ms é risco de flakiness, não gap de prova.
