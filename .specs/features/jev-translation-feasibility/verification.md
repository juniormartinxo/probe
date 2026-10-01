# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Scope**: S1 + S2 + S3 + S4 (C1–C40, C52, C53, C55) - slices construídas (PRB-2, PRB-3, PRB-4, PRB-5); C41–C51, C54 e C56–C59 fora de escopo (não construídos)
**Profile**: light
**Diff range**: 243d02d..864b31b (fix da Round 3, card PRB-5, PR #5); provas de todos os checks construídos re-executadas em `864b31b`
**Round**: 4 - scoped
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação, do review do PR #5 nem da verificação da Round 3

Verificado em `864b31b` (HEAD), Node v24.21.0. A árvore real ficou somente leitura. `git status --porcelain` estava vazio antes das provas e continuou vazio depois delas, incluindo o experimento de sinais (feito com um script no scratchpad que importa `tests/ai-study/helpers.mjs` e roda em sandboxes temporárias). Depois da escrita deste relatório, a porcelain mostra ` M .specs/features/jev-translation-feasibility/verification.md` e, pelo passo 7, ` M .specs/LESSONS.md` e ` M .specs/lessons.json`. Não chamei LM Studio, Jev nem modelo real. Usei só os transportes, o `fetch` e os processos controlados dos testes.

**Resultado em uma linha:** 42 de 43 checks construídos estão provados, com asserção localizada. A divisão de C36/C39/C40 em C56–C58 é emenda legítima: nenhuma obrigação do plano sumiu, e os três agora passam. **C55 falha**: o claim diz "um segundo sinal segue o comportamento padrão", mas um segundo sinal de **outro tipo** (SIGINT e depois SIGTERM, ou o inverso) é engolido. Reproduzi isso em `864b31b`. A prova só cobre SIGINT seguido de SIGINT.

### Escopo pelo diff

Verified at 864b31b. `git diff --stat 243d02d..864b31b` tem um commit (`864b31b`) e 5 arquivos, +142/−62:

- `checks.md`: novos textos de C30, C34, C36, C39, C40 e C55; novos C56, C57, C58 (S5) e C59 (S4, pendente); Coverage, Swept e o parágrafo de fronteira (`Error N`).
- `tests/ai-study/helpers.mjs`: `startMake` ganha `processGroup` (`detached`, `:106`); `nodeStatusFromMake` devolve `null` quando o make morre por sinal (`:152`).
- `tests/ai-study/s4-limits.test.mjs`: só mudou o que vem depois de `:816`, isto é, os auxiliares `heldAtBarrier`/`assertInterrupted` e o C55. As linhas de C29–C40 não mudaram.
- `tests/ai-study/support/fixture-barrier-hooks.mjs`: a barreira pode esperar antes ou depois da primeira chamada (`AI_STUDY_TEST_BARRIER_AT`).
- `STATE.md`: contexto, não prova.

O raio de alcance de `helpers.mjs` vai além do C55, porque `nodeStatusFromMake` serve a todo teste que passa pelo make. O ramo novo só devolve `null` quando `status === null`, ou seja, morte por sinal. Antes, esse caso lançava erro. Nenhuma asserção que espera 1 ou 2 pode passar com `null`, então nenhum check foi enfraquecido. `fixture-barrier-hooks.mjs` também é usado pelo C29. O padrão (`before`) mantém o comportamento anterior, e o C29 passou.

Classificação:

- **Verified at 864b31b:** as provas dos 43 checks, re-executadas em full. Re-julgados: C30 e C34 (texto mudou), C36, C39 e C40 (não PASS na Round 3, texto mudou) e C55 (texto e teste mudaram). Também a divisão C36/C39/C40 → C56–C58, o C59 e o novo parágrafo de fronteira.
- **Carried from 4470b14:** os julgamentos de C1–C29, C31–C33, C35, C37, C38, C52 e C53. Nem o texto nem o teste deles mudou no fix, e as linhas citadas são as mesmas, conferidas com `rg -n`. Os julgamentos anteriores que a Round 3 trazia de `4eea13b` continuam como ela registrou.

## Binding sources

Carried from 4470b14. O passo 1 só roda no profile `ui`, então não rodou sob `light`. O fix não toca o [corpus](corpus.md) nem a interface: `git diff 243d02d..864b31b -- .specs/features/jev-translation-feasibility/corpus.md src` está vazio.

## Checks

Verified at 864b31b. Rodei uma invocação para o alvo inteiro:
`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C1[0-9]|C2[0-9]|C3[0-9]|C40|C52|C53|C55):'`. Saiu com exit 0, e o TAP deu `# tests 43 # pass 43 # fail 0 # cancelled 0 # skipped 0 # todo 0`. Cada nome aparece uma vez, nesta ordem: `ok 1 - C1:` … `ok 5 - C5:`, `ok 6 - C9:`, `ok 7 - C10:`, `ok 8 - C11:`, `ok 9 - C12:`, `ok 10 - C6:`, `ok 11 - C7:`, `ok 12 - C8:`, `ok 13 - C13:` … `ok 28 - C28:`, `ok 29 - C52:`, `ok 30 - C53:`, `ok 31 - C31:`, `ok 32 - C32:`, `ok 33 - C33:`, `ok 34 - C35:`, `ok 35 - C40:`, `ok 36 - C29:`, `ok 37 - C30:`, `ok 38 - C34:`, `ok 39 - C36:`, `ok 40 - C37:`, `ok 41 - C38:`, `ok 42 - C39:` e `ok 43 - C55:`. Nenhuma linha `# SKIP` ou `# TODO` (`grep -c -E "# (SKIP|TODO)"` → 0).

Existência: `rg -n "^\s*test\('[A-Z0-9]+:" tests/` encontra exatamente os 43 nomes C, mais `S3:` (`s3-jev.test.mjs:600`) e o teste de fidelidade do corpus, que não tem prefixo:

- `s1-commands.test.mjs:52,91,119,147,166,234,262,341,368` (C1–C5, C9–C12)
- `s1-corpus.test.mjs:68,87,119` (C6–C8)
- `s2-translation.test.mjs:155,218,247,309,346,392,449,523` (C13–C20)
- `s3-jev.test.mjs:118,157,202,246,284,367,410,473,541,568` (C21–C28, C52, C53)
- `s4-limits.test.mjs:132,218,253,325,392,477,557,586,638,704,745,789,841` (C31, C32, C33, C35, C40, C29, C30, C34, C36, C37, C38, C39, C55). Só o C55 mudou de linha (era `:819`).

`rg -n "C5[6-9]" tests src Makefile` não encontra nada. C56–C59 não têm teste e não são contados como aprovados.

`make checks-validate`: `validate_checks: 0 error(s), 0 warning(s) ... [profile: light]`.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | dry-run válido: modo, hashes, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `tests/ai-study/s1-commands.test.mjs:57` - `assert.equal(fixture.status, 0, fixture.output)`; `:60` - `assert.equal(f['hash do corpus'], corpus.corpusHash)`; `:74` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos | `ok 2 - C2:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:100` - `assert.equal(guard.loaded, 3, ...)`; `:116` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação e coleta fixture: zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:127` - `assert.equal(run.status, 0, run.output)`; `:135` - `assert.equal(last.shimCalls, '', ...)`; `:136` - `assert.deepEqual(last.guard.attempts, [], ...)`; `:142` - `assert.doesNotMatch(source, /child_process\|worker_threads/, file)` (agora cobre também `calls.mjs` e `run-reader.mjs`) | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:152` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:157` - `assertUsageFailure(run, /MODE/, ...)` (`:38`, status 2 e código do Node 2) | PASS |
| C5 | config inválida → 2 antes de coletar, sem segredo; tabela completa | `ok 5 - C5:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:206-208` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` | PASS |
| C6 | corpus exato R01–R12/T01–T06; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `tests/ai-study/s1-corpus.test.mjs:70` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)`; `:31-32` - `assert.equal(run.status, 2, ...)` + `assert.equal(run.nodeStatus, 2, ...)`, agora em dry-run **e** `ai-study-run`; `:36` - `assert.ok(!existsSync(join(sandbox.evidenceDir, name)), ...)` | PASS |
| C7 | seis julgamentos, rótulo válido, justificativa; violações → 2 | `ok 11 - C7:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-corpus.test.mjs:90` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:31-36` nas duas fronteiras | PASS |
| C8 | resultados vinculados aos mesmos hashes; alteração impede comparação | `ok 12 - C8:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-corpus.test.mjs:139` - `assert.equal(result.corpus_hash, base.corpusHash)`; `:174` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos fixture, `schema_version: 1` | `ok 6 - C9:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:237` - `assert.equal(run.status, 0, run.output)`; `:244` - `assert.equal(evidence.manifest.schema_version, 1)`; `:250` - 42 resultados | PASS |
| C10 | fixture: live → 2 preservando evidências; coletor live: fixture rejeitado | `ok 7 - C10:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:266` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`; `:321` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/`; `:329` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')` | PASS |
| C11 | aceita RUN_ID 1/64, timeout inteiro positivo, saída 1/2048; 20/24 | `ok 8 - C11:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:355` - `assert.equal(manifest[key], value, key)`; `:363` - `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; relatório exige RUN_ID; live exige config; token opcional; sem flags | `ok 9 - C12:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s1-commands.test.mjs:374` - `assert.equal(manifest['run_id'], 'gerado na coleta')`; `:382` - `/^[A-Za-z0-9_-]{1,64}$/`; `:393` - `resolveConfig('report', {})` lança `UsageError` `/RUN_ID/`; `:407` - `assert.equal(noToken.local.apiToken, null, ...)`; `:411` - `assertUsageFailure(flagged, new RegExp(name), ...)` | PASS |
| C13 | tradução registra original, direção, modelo, revisão do template, vínculo | `ok 13 - C13:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `tests/ai-study/s2-translation.test.mjs:173` - `assert.equal(t.run_id, 'c13')`; `:177` - `assert.equal(t.template_revision, revision)` | PASS |
| C14 | template não confirmado → `template_unverified`, sem envio | `ok 14 - C14:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:224` - `assertIncomplete(outcome, 'template_unverified')`; `:226` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:244` - `assert.deepEqual(lm.calls, [])` | PASS |
| C15 | 2048 admitido; 2049 → `input_limit`; contagem inclui template | `ok 15 - C15:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:260` - `assert.equal(counted[index].request.prompt, expected)`; `:269` - `assertIncomplete(first, 'input_limit')` | PASS |
| C16 | contagem indisponível/tokenizer divergente → `token_count_unavailable` | `ok 16 - C16:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:322` - `assertIncomplete(outcome, 'token_count_unavailable')` | PASS |
| C17 | saída literal como derivação; braço EN usa a derivação | `ok 17 - C17:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:360` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:374` - `assert.equal(enResult.derived_from, \`${c.id}-translate-pt-en\`)` | PASS |
| C18 | vazia/espaços/limite → `invalid_translation`, sem Jev EN | `ok 18 - C18:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:412` - `assert.equal(byCase[caseId].status, 'invalid_translation', caseId)`; `:420` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)` | PASS |
| C19 | duração ms, metadados do runtime, justificativa; sem download como VRAM | `ok 19 - C19:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:466` - `assert.ok(Number.isInteger(duration) && duration >= 25, ...)`; `:478` - `/download/` na justificativa; `:490` - `assertIncomplete(missing, 'model_mismatch')` | PASS |
| C20 | identidade solicitada/retornada Q6_K; sem trocar/instalar/baixar | `ok 20 - C20:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s2-translation.test.mjs:537` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:562` - `assertIncomplete(outcome, reason)` | PASS |
| C21 | seis julgamentos `Choice` na mesma chamada, critérios yes/no/insufficient | `ok 21 - C21:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `tests/ai-study/s3-jev.test.mjs:125` - `assert.equal(jevCalls.length, 24, ...)`; `:134` - `assert.deepEqual(Object.keys(call.body), ['state', 'model', 'questions'], ...)`; `:141` - `assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id)` | PASS |
| C22 | payloads sem gabarito, justificativa ou revisão humana | `ok 22 - C22:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:192` - `assert.ok(!payload.includes(SENTINEL), ...)`; `:194` - `assert.deepEqual(sent(alt), sent(base))` | PASS |
| C23 | par com instruções, rubricas, IDs, critérios e modelo iguais; só o texto varia | `ok 23 - C23:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:212` - `assert.deepEqual(body.questions, reference.questions, ...)`; demais linhas de 4eea13b +3 | PASS |
| C24 | alternância PT/EN e EN/PT até R12, caso e braço preservados | `ok 24 - C24:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:264` - `assert.deepEqual(sentOrder, expectedOrder)`; `:266` - `assert.deepEqual(persisted, expectedOrder)` | PASS |
| C25 | validação Jev de AC 21; violação → `invalid_response` sem inferir | `ok 25 - C25:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:295` - `assert.deepEqual(validateEvaluation(results), [], label)`; `:329` - `assert.ok(problems.length > 0, label)`; `:352` - `invalid.evaluation.status === 'invalid_response'`. Tabelas carried from 4eea13b (+3) | PASS |
| C26 | avaliação persistida com identificação, distribuição, uso, duração; uso ausente não vira zero | `ok 26 - C26:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:396` - `assert.ok(Number.isInteger(e.duration_ms) && e.duration_ms >= 25, ...)`; `:399` - `assert.deepEqual(first.evaluation.usage, { available: true, value: usage })` | PASS |
| C27 | acerto/erro/ausência; `insufficient` é escolha | `ok 27 - C27:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:421` - `assert.equal(compareChoice(choice, expected), outcome, ...)`; `:440` - PT `{ hit: 12, miss: 0, absent: 0 }` | PASS |
| C28 | par incompleto fora do denominador; individual visível | `ok 28 - C28:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:496` - `assert.deepEqual(pair.reasons, reasons, label)`; `:499` - `assert.equal(comparison.counts.paired.denominator, reasons.length === 0 ? 1 : 0, ...)`; `:531` - denominador 10 | PASS |
| C29 | duas coletas simultâneas: só uma; a segunda é rejeitada antes de chamar modelos ou alterar a primeira | `ok 36 - C29:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `tests/ai-study/s4-limits.test.mjs:499-501` - `assert.equal(second.status, 2, ...)` + `assert.equal(second.nodeStatus, 2, ...)` + `/outra coleta \(processo ${firstPid}\) está em andamento/` (processos `make` reais concorrentes, a primeira parada na barreira com a trava, `:489`); `:503` - `assert.equal(started().length, 1, 'nenhuma segunda coleta chegou a uma chamada')`; `:504` - `readServices(sandbox).every((entry) => entry.pid === firstPid)`; `:505-506` - nenhuma execução nova + `assert.deepEqual(snapshotFiles(...c29-primeira), firstBefore, ...)`; mesmo processo `:532-536` - `UsageError` e `assert.equal(used, 0)` | PASS |
| C30 | RUN_ID existente → código 2 da CLI Node (linha `Error 2`), bytes de todos os arquivos anteriores mantidos, inclusive de incompleta | `ok 37 - C30:` | verified at 864b31b (texto mudou, teste não): `tests/ai-study/s4-limits.test.mjs:563` - anterior `status === 'incomplete'`; `:572-573` - `assert.equal(again.status, 2, ...)` + `assert.equal(again.nodeStatus, 2, ...)`. `nodeStatus` vem da linha `] Error (\d+)` (`tests/ai-study/helpers.mjs:153`), que é exatamente onde o novo texto diz que o código é lido. `:577` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before, ...)`; `:578` - nenhuma chamada | PASS |
| C31 | máx. 20 locais / 24 Jev contando falhas; 21ª/25ª bloqueada; zero retries | `ok 31 - C31:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `s4-limits.test.mjs:140` - `e.reason === 'call_limit' && !e.requestSent`; `:142` - `assert.equal(executed, 44, ...)`; `:161` - `assert.equal(retryingLocal.svc.count('local'), 20, 'exatamente 20 pedidos locais saíram')`; `:174` - `assert.equal(retryingJev.svc.count('jev'), 24, ...)`; `:189` - `assert.equal(svc.count(service), nth, \`${label}: nenhum pedido repetido\`)` + `:192` - falha contada em `manifest.calls`; `:151` - a verificação do candidato conta (19 = 1 GET + 18). Ver observação 3 (precisão de "verificações de template") | PASS |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `s4-limits.test.mjs:227` - `e.reason === 'concurrent_call' && e.requestSent === false`; `:230` - `assert.equal(started, 0, ...)`; `:241` - `assert.equal(svc.maxInFlight(), 1)`; `:243` - início/fim alternam em todos os 43 pedidos; `:245-250` - GET candidato, tradução e braços alternados em série | PASS |
| C33 | timeout local/Jev encerra no limite, `incomplete`, restantes não executados, resultado remoto desconhecido sem alegar cancelamento | `ok 33 - C33:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `s4-limits.test.mjs:273` - `assert.ok(waited >= 990 && waited < 1900, ...)` (servidor local que ignora o abort); `:277-278` - `status === 'incomplete'`, `reason === 'timeout'`; `:279-287` - `failure` com `remote_outcome: 'unknown'`, `request_sent: true`; `:289` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/)`; `:292` - `not_executed_items` = restantes | PASS |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → código 1 da CLI Node (linha `Error 1`, o make sai com 2), prefixo preservado, restantes não executados, sem trocar provedor/idioma | `ok 38 - C34:` | verified at 864b31b (texto mudou, teste não): `s4-limits.test.mjs:605-606` - `assert.equal(run.status, 2, \`${label}: o make falha\`)` + `assert.equal(run.nodeStatus, 1, \`... "Error 1" ...\`)`. As duas metades do novo texto ("o próprio make sai com 2" e "código 1 ... `Error 1`") são asserções. `:616` - `assert.deepEqual(manifest.not_executed_items, remainingAfter(last), ...)`; `:620` + `:625` - prefixo íntegro; `:632-634` - mesmas origens e mesmo modelo | PASS |
| C35 | interrupção antes/depois do rename de manifesto/resultado: destino anterior ou novo íntegro; temporário/JSON parcial não aceito | `ok 34 - C35:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `s4-limits.test.mjs:314` - `assert.equal(result.signal, 'SIGKILL', ...)`; `:329`/`:333` - manifesto anterior/novo íntegro; `:337-338`/`:340` - resultado ausente+temporário / novo íntegro; `:346` - `assert.doesNotThrow(() => JSON.parse(content), file)`; `:352` - temporário em `ignored` com `reason === 'temporary'`; `:366` + `:370` - `loadRun` recusa resultado e manifesto parciais | PASS |
| C36 | segredos (chave, token, URL credenciada, cabeçalho), inclusive ecoados, fora de stdout/stderr do dry-run e da coleta e de manifesto, resultados e comparação, inclusive em erros HTTP, de parsing e de transporte; chave/token < 8 → código 2 (`Error 2`), sem chamadas e sem execução | `ok 39 - C36:` | verified at 864b31b (texto mudou, teste não): `s4-limits.test.mjs:659` - `assert.deepEqual(runs.map((r) => r.nodeStatus), [0, 0, 1, 1, 1, 1, 1], ...)`, sobre o dry-run (`runs[0]`) e seis coletas (HTTP, parsing e transporte, `:651-657`); `:663` - `assert.equal(done.results[0].response.runtime_details.stats.echo, 'Bearer [omitido]')`, prova de que o eco chegou; `:695` - `comparison.json` e `manifest.json` entre os arquivos varridos; `:698` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)` sobre stdout e stderr das 7 execuções e todos os arquivos de evidência; `:700` - nenhum `authorization: Bearer` não omitido; `:685` - `assert.equal(short.nodeStatus, 2, ...)` (dry-run e coleta); `:688` - `assert.ok(!existsSync(join(sandbox.evidenceDir, \`c36-curto-${name}\`)), ...)`; `:691` - `assert.equal(readServices(sandbox).length, requestsBefore, 'nenhuma chamada com segredo curto')` | PASS |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches anteriores; mesmo ID segue C30 | `ok 40 - C37:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `s4-limits.test.mjs:725-726` - 18 traduções e 24 avaliações refeitas; `:730-731` - sentinela ausente dos resultados e dos pedidos; `:737` - `assert.deepEqual(evidenceReads.filter(...), [])` (rastreio de `fs`); `:741-742` - mesmo ID → 2, bytes intactos | PASS |
| C38 | corpus sintético, zero leituras de chats/Cloak/credenciais; tráfego só ao servidor configurado e ao Jev oficial | `ok 41 - C38:` | carried from 4470b14 (texto e teste não tocados pelo fix; linhas iguais): `s4-limits.test.mjs:775` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:777` - nenhum caminho `cloak\|.claude\|.codex\|.ssh\|.aws\|/gh/`; `:783` - origens `['http://lmstudio.interno:4321', 'https://api.typesafe.ai']`; `:785` - Jev só em `https://api.typesafe.ai/v1/systemone` | PASS |
| C39 | evidências fora do Git; sobrevivem byte a byte a nova coleta e à leitura por `loadRun`, sem limpeza, inclusive arquivos alheios à bancada | `ok 42 - C39:` | verified at 864b31b (texto mudou, teste não): `s4-limits.test.mjs:799` - `assert.equal(git('check-ignore', '-q', path).status, 0, ...)` no repositório real; `:801` - `assert.equal(git('ls-files', '--', 'artifacts').stdout, '', ...)`; `:808-809` - arquivos alheios (`notas.md` e um `.tmp` parcial) gravados antes do snapshot; `:815` - `assert.equal(after[file], content, \`${file} preservado\`)` depois de nova coleta e de `loadRun` sobre as três execuções (`:811-812`); `:816` - nenhuma execução removida | PASS |
| C40 | relações `schema_version: 1`; `loadRun` recusa vínculo a outra execução ou revisão e arquivo com outra versão de schema | `ok 35 - C40:` | verified at 864b31b (texto mudou, teste não): relações `s4-limits.test.mjs:406` - `assert.equal(manifest.schema_version, 1)`; `:420` - idem por resultado; `:430` - `assert.deepEqual([r.evaluation.run_id, r.evaluation.case_id, r.evaluation.arm], ['c40', r.item.case_id, r.item.arm])`; `:431` - braço EN → tradução do caso; recusas `:455` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)` sobre 12 variantes (`:441-452`: outra execução ×3, revisão ×2, schema ×3, vínculos ×3, item fora do plano); `:458` - revisão diferente da esperada | PASS |
| C52 | live com serviços controlados: zero Codex/Claude/Grok/agy/Cloak | `ok 29 - C52:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:548` - `assert.equal(run.status, 0, run.output)`; `:553` - 42 resultados; `:557` - `assert.equal(run.shimCalls, '', ...)`; `:558` - `assert.deepEqual(run.guard.attempts, [], ...)` | PASS |
| C53 | fronteira live: transporte/resposta fixture → 2, preservando evidências | `ok 30 - C53:` | carried from 4470b14 (teste não tocado pelo fix; linhas iguais): `s3-jev.test.mjs:580-582` - `run.status === 2`, `run.nodeStatus === 2`, `/proveniência "fixture" incompatível com MODE=live em R01-evaluate-pt/`; `:595` - `assert.deepEqual(after.rawResults, before.rawResults)` | PASS |
| C55 | 1º SIGINT/SIGTERM → `incomplete`/`interrupted`, sem alegar cancelamento, trava liberada; durante chamada `unknown`; fora de chamada, sem que a seguinte saia; sinal só no Node → `Error 1`; Ctrl+C no grupo → make morre pelo sinal, manifesto autoritativo; **segundo sinal segue o padrão, sem limpeza** | `ok 43 - C55:` (passa) | verified at 864b31b (texto e teste mudaram). Durante chamada, SIGINT e SIGTERM: `s4-limits.test.mjs:856` - `assert.equal(result.nodeStatus, 1, ...)`; `:857` → `assertInterrupted` (`:835-837`: `status === 'incomplete'`, `reason === 'interrupted'`, trava ausente); `:858-862` - `['R01-evaluate-en', true, 'unknown']`; `:864` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/, signal)`. Entre chamadas: `:877` - `assert.equal(betweenManifest.failure, null, ...)`; `:878` - `completed_items` exatamente `['R01-translate-pt-en']`; `:880` - `calls.local` `{ used: 1 }`. Antes do envio: `:890-893` - `['R01-translate-pt-en', false, 'not_sent']`; `:895` - `calls.local` `{ used: 0 }`. Grupo do make: `:909` - `assert.deepEqual([groupResult.status, groupResult.signal, groupResult.nodeStatus], [null, 'SIGINT', null], ...)`; `:911` - `] Interrupt`; `:912-913` - manifesto `interrupted`/`unknown`. Segundo sinal: `:920` - vivo depois do 1º; `:923` - `assert.equal(result.nodeStatus, 130, ...)`; `:924-925` - `running` e trava do pid. **Contraexemplo:** só SIGINT→SIGINT é provado. O handler é `process.once` por nome (`src/ai-study/cli.mjs:61`), então o primeiro SIGINT só remove o listener de SIGINT. Um SIGTERM depois dele (ou SIGINT depois de SIGTERM) cai no `onSignal` ainda registrado, que é um `abort()` sem efeito. Reproduzido em 864b31b: o Node continua vivo 1 s depois do 2º sinal, e a coleta termina `interrupted` com código 1. O comportamento padrão seria morrer sem limpeza. Ver "C55 - julgamento" | FAIL |

### Divisão de C36/C39/C40 em C56–C58 - julgamento

Verified at 864b31b. **Veredito: emenda legítima, não enfraquecimento.** C36, C39 e C40 ficam PASS.

**(i) O novo texto corresponde ao que os testes assertam?** Sim, nos três casos. Nenhum texto promete mais do que a prova cobre:

- **C36:** cada membro do texto tem asserção: dry-run e coleta (`:651-657`), eco (`:663`), manifesto, resultados e comparação (`:695`, `:698`), erros HTTP, de parsing e de transporte (`:659`, com as variantes nas linhas 653-657), e a recusa curta com `Error 2`, sem chamadas e sem execução (`:685`, `:688`, `:691`). O texto antigo dizia "resultados ou relatório". O novo troca "relatório" por "comparação", que é um arquivo real e foi varrido.
- **C39:** "byte a byte" (`:815`), "nova coleta" e "`loadRun`" (`:811-812`), "inclusive arquivos alheios" (`:808-809`) e "fora dos arquivos rastreados" (`:799`, `:801`).
- **C40:** o sujeito da recusa passou de "relatório" para "o leitor de evidências (`loadRun`)", que é exatamente o que `:455` e `:458` exercitam.

**(ii) Alguma obrigação do plano ficou sem check?** Não. Conferi contra o texto do `plan.md`:

- **AC 31** ("excluir chaves, tokens e cabeçalhos ... de logs, manifestos e relatórios"): logs e manifestos ficam com C36. Relatórios ficam com **C56** (tokens, chaves, URL credenciada, cabeçalhos, inclusive de execuções com erros HTTP e de parsing, em "relatório e saída"). O Coverage foi atualizado: `31` C36 C56, e "Saídas redigidas: relatório C56".
- **Landing 1** (`artifacts/ai-study/<run-id>/` fora do Git, `schema_version: 1`, `make ai-study-report`): "fora do Git" e a sobrevivência à coleta ficam com C39. A sobrevivência à geração do relatório fica com **C57**, que ainda acrescenta "outras execuções". A recusa de `schema_version` pelo relatório fica com **C58**. Landing no Coverage: C9 C39 C40 C41 C57 C58.
- **Relations** ("O relatório deriva das evidências dessa execução"; execução e revisão referenciadas): **C58** recusa outra execução, outra revisão de corpus/gabarito e schema ≠ 1, e C41 limita o relatório às evidências da execução identificada. Relations no Coverage: "revisão semântica/relatório C40 C41 C44 C58".
- **Comandos publicados:** `ai-study-report` C41 C54 C56 C57 C58.

**(iii) Emenda legítima ou enfraquecimento?** Emenda legítima. Cada cláusula removida de C36, C39 e C40 reaparece, com o mesmo sujeito (`make ai-study-report`), em C56, C57 ou C58. Duas delas saíram até mais precisas: C57 com "outras execuções" e C58 com "código 2 / `Error 2`". O padrão é o mesmo de C3/C10 → C52–C54. `checks-validate` passa. C56–C58 estão na seção S5 sem `Status` de prova, e `rg -n "C5[6-9]" tests src Makefile` está vazio, então não contam como aprovados. Uma ressalva de processo, que não vira achado: a autorização do usuário só aparece em `STATE.md` (Decisões da S4, item 6) e no Status de `checks.md`, que são contexto e não prova. O verificador não consegue confirmar a decisão por outra fonte.

### C59 e a emenda da AC 27

Verified at 864b31b. C59 cobre a emenda (`plan.md:174`): até 18 contagens, orçamento próprio, `manifest.calls` como `local_token_count`, falhas contadas, uma chamada em andamento entre todos os serviços, timeout local, zero retries e reconexões do `@lmstudio/sdk`, e a 19ª bloqueada antes do envio. No Coverage, "Chamadas (6 edges)" ganhou as bordas 18 e 19. **Não contradiz C31**: C31 continua limitando as 20 chamadas locais e 24 Jev, e a emenda diz "além das 20", em orçamento separado. O Status de C59 é "pendente, não construído". `rg -n "local_token_count" src tests` está vazio. Isso fecha a observação 2 da Round 3.

### C55 - julgamento

Verified at 864b31b. **Veredito: FAIL.** O novo texto descreve corretamente o término do make por sinal: "o make termina pelo próprio sinal e o término autoritativo é o do manifesto". `:909` (`status null`, `signal 'SIGINT'`) e `:911` (`] Interrupt`) provam isso, e `nodeStatusFromMake` devolve `null` em vez de procurar `Error N` (`helpers.mjs:152`). As ressalvas (a) e (b) da Round 3 foram atendidas: entre chamadas (`:877-880`), antes do envio (`:890-895`) e grupo do make (`:909-913`).

O que falha é a última frase do claim, "Um segundo sinal segue o comportamento padrão, sem limpeza". A redação também vem do plano ("um segundo sinal segue o comportamento padrão"). `src/ai-study/cli.mjs:61` registra `process.once(name, onSignal)` **por nome de sinal**. Depois do primeiro SIGINT, o listener de SIGTERM continua instalado, e o inverso também vale. Um segundo sinal de outro tipo vai para `onSignal`, que chama `abort()` num controller já abortado e não faz nada. Experimento em `864b31b`, com coleta fixture presa na barreira antes da primeira chamada, primeiro sinal, 300 ms, segundo sinal e 1 s de espera:

| 1º → 2º | Node vivo 1 s depois do 2º | Término |
| --- | --- | --- |
| SIGINT → SIGINT | não | `nodeStatus 130`, manifesto `running` (padrão, sem limpeza) |
| SIGINT → SIGTERM | **sim** | só depois de liberar a barreira: `nodeStatus 1`, `incomplete`/`interrupted` |
| SIGTERM → SIGINT | **sim** | idem |

O cenário é realista: Ctrl+C seguido de `kill <pid>`. A prova `:917-925` só exercita SIGINT→SIGINT, por isso passa. É uma lacuna de cobertura (o claim vale para "um segundo sinal" e só um dos quatro pares foi provado) que esconde um comportamento contrário ao claim. O defeito já existia em `4470b14`, porque `cli.mjs` não mudou no fix, e a Round 3 não o pegou. Correções possíveis: remover os dois listeners no primeiro sinal, ou assertar os pares cruzados. A escolha fica com o implementador.

Duas observações menores no C55, que não bloqueiam:

- O primeiro sinal **fora** de uma chamada só é provado com SIGINT. O SIGTERM usa o mesmo `onSignal` (`cli.mjs:61`), então o risco é baixo.
- No caso entre chamadas, "sem que a chamada seguinte saia" é provado de forma indireta: `failure === null` e `completed_items` exato (`:877-878`). `calls.jev` não é assertado. No caso antes do envio, a prova é direta (`request_sent: false`, `not_sent`, `calls.local.used === 0`).

### Fronteira e nível

Verified at 864b31b para os arquivos tocados. O novo parágrafo de `checks.md` ("Pela fronteira `make`, o código 1 ou 2 de um claim é o código da CLI Node, lido na linha `make: *** [...] Error N` ...") fecha a lacuna de precisão da Round 3 (observação 1). A lista de claims de fronteira ganhou C36, C55 e C56–C58. C36 e C55 atravessam `make` (`runMake`/`startMake`). Resta uma imprecisão: o parágrafo diz que "o próprio make sai com 2 em qualquer falha", mas, quando o grupo recebe o sinal, o make não sai com 2, e sim morre pelo sinal (`:909`). O C55 trata esse caso explicitamente, então não há contradição no check. O parágrafo geral só ficou largo demais. C1–C35, C37, C38, C52 e C53: carried from 4470b14.

## Swept existing re-read

Carried from 4470b14, com um re-read verified at 864b31b. `checks.md` não tem linhas `Swept` marcadas como existentes. O fix só acrescentou C59, C56, C57 e C58 às linhas validation, authorization e data lifecycle. Nenhum deles foi construído, então não há restrição no código para conferir. As restrições citadas na Round 3 continuam onde estavam: `src` não mudou no fix (`git diff 243d02d..864b31b -- src` vazio).

## Coverage

Profile `light`: o recompute de Coverage não roda.

## Test policy rows

`checks.md` não tem seção `Test policy`, e o profile `light` não emite veredito sobre ela.

## Faults injected

Profile `light`: a injeção de falhas não roda. O experimento de sinais do C55 não injetou falha: rodou o código de `864b31b` sem alteração.

## Out of scope (not built)

C41, C42, C43, C44, C45, C46, C47, C48, C49, C50, C51, C54, C56, C57 e C58 (S5), e C59 (S4, pendente da contagem de tokens). Não há testes deles na árvore, e eles **não** contam como aprovados.

## Observations (non-blocking)

Verified at 864b31b, salvo indicação.

1. **Parágrafo de fronteira largo demais:** "o próprio make sai com 2 em qualquer falha" não vale para o término por sinal no grupo (ver "Fronteira e nível").
2. **C55, SIGTERM fora de chamada e `calls.jev` entre chamadas** (ver "C55 - julgamento").
3. **Resolvidas desde a Round 3:** a observação 1 (precisão de "código N", agora no parágrafo de fronteira e nos textos de C30, C34, C36 e C55); a observação 2 (AC 27 sem check, agora C59); e a observação 4, ressalvas (a) e (b) do C55 (agora com prova).
4. (Carried from 4470b14.) A observação 3, sobre "verificações de template" em C31, continua aberta. A observação 6, sobre a pré-carga de C52/C53, `globalThis.WebSocket` e as condições de entrada da S5, também continua.

## Round 3 history (S4, 4470b14)

Carried from 4470b14. A Round 3 foi feita por sub-agente independente, profile `light`, range `14ab14a..4470b14`, e deu veredito FAIL. 40 de 43 checks ficaram PASS. C36, C39 e C40 ficaram PARTIAL porque o texto de cada um exigia o relatório (`make ai-study-report`), que não existe. Ressalvas não bloqueantes: "código N" sem dizer onde é lido na fronteira make; a emenda da AC 27 (`local_token_count`) sem check; e o C55 sem prova do sinal fora de chamada e sem o sinal ao grupo do make. O relatório completo está em `git show 243d02d:.specs/features/jev-translation-feasibility/verification.md`. Lições registradas: L-001, L-002 e L-003.

## Round 2 history (S3, C21–C28, C52, C53)

Carried from 4eea13b. A Round 2 foi feita por sessão nova independente, profile `light`, range `3985c43..4eea13b`, e deu veredito PASS para C1–C28, C52 e C53. O relatório completo está em `git show 4470b14:.specs/features/jev-translation-feasibility/verification.md`. Dela continuam valendo o Ponto 1 (pré-carga `live-services-hooks.mjs` em C52/C53), o Ponto 2 (C3 alterado na S3 sem enfraquecimento) e as tabelas de decisão de C25, C27 e C28.

## Round 1 history (S1 + S2, C1–C20)

Carried from 166a2b9. A Round 1 foi feita por verificador independente, profile `light`, range `dba3999..166a2b9`, e deu veredito PASS. Os julgamentos sobre o setup de C10 e a expectativa de C19 (5451bc0) continuam válidos.

## Gate

Verified at 864b31b. `make check-proof` com a suíte completa, sem filtro: exit 0; 45 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. São os 43 checks, mais o teste de fidelidade do corpus e o teste `S3:`. `make checks-validate`: 0 erros, 0 avisos. O gate verde não fecha o C55: a prova passa, mas não cobre o segundo sinal de outro tipo, que o claim exige e o código não cumpre.

Passo 7: lição L-004 (candidate, `ac_gap`, escopo `signals`) registrada via `lessons.py` a partir do FAIL do C55. A imprecisão do parágrafo de fronteira (observação 1) é menor e já está coberta por L-002, por isso não gerou lição nova. `validate_verification.py jev-translation-feasibility` saiu com 1 (veredito FAIL).
