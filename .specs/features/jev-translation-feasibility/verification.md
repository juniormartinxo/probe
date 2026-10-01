# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: FAIL
**Scope**: S1 + S2 + S3 + S4 (C1–C40, C52, C53, C55) - slices construídas (PRB-2, PRB-3, PRB-4, PRB-5); C41–C51 e C54 fora de escopo (não construídos)
**Profile**: light
**Diff range**: 14ab14a..4470b14 (S4, card PRB-5, PR #5); C1–C28, C52 e C53 re-provados em HEAD
**Round**: 3 - full (S4); C1–C28, C52, C53 re-provados em HEAD, citações renovadas nos arquivos que a S4 tocou
**Verifier**: independent sub-agent (author != verifier) - sub-agente novo, sem contexto da implementação nem do review do PR #5

Verificado em `4470b14`, Node v24.21.0. A árvore real ficou somente leitura. `git status --porcelain` estava vazio antes das provas e depois delas. Depois da escrita deste relatório, a única linha é ` M .specs/features/jev-translation-feasibility/verification.md`. Não chamei LM Studio, Jev nem modelo real. Usei só os transportes, o `fetch` e os processos controlados dos testes.

**Resultado em uma linha:** 40 de 43 checks construídos estão provados, com asserção localizada. C36, C39 e C40 estão **parciais**. O texto de cada um exige o relatório (`make ai-study-report`), que ainda não existe, e por isso o veredito é FAIL. Ver "C36, C39 e C40 - julgamento".

### Escopo pelo diff

`git diff --stat 14ab14a..4470b14` tem 4 commits (`6226e5a`, `ad66920`, `dc17f07`, `4470b14`) e 24 arquivos, +1658/−150:

- Novos: `src/ai-study/calls.mjs` (orçamento, prazo, `ServiceCallError`), `src/ai-study/run-reader.mjs` (`loadRun`), `tests/ai-study/s4-limits.test.mjs` e as pré-cargas `fixture-barrier*.mjs`, `fs-trace.mjs` e `interrupt-on-rename.mjs`.
- Alterados em `src`: `cli.mjs` (sinais e orçamento compartilhado), `collect.mjs`, `config.mjs` (segredos curtos), `evidence.mjs` (trava e gravação atômica), `fixture.mjs`, `jev.mjs` e `lmstudio.mjs`.
- Alterados em `tests`: `helpers.mjs` (`startMake`, `snapshotFiles`, `readFsTrace`, `signal`), `s1-commands.test.mjs` (+1 linha, só o setup do C10 com `createCallBudget`), `s1-corpus.test.mjs` (`expectInvalidCorpus` passa também por `make ai-study-run`, com asserção extra de nenhuma execução criada; C8 com orçamento), `s2-translation.test.mjs` (só setup: orçamento e chave de 8 ou mais caracteres) e `s3-jev.test.mjs` (só setup: orçamento).
- Também alterados: `Makefile` (`check-proof` lê `TEST_FLAGS` pelo ambiente e `help` cita a trava), `plan.md` (3 emendas), `checks.md` (C55 e linhas Status) e `STATE.md`.

Nenhuma asserção de C1–C28, C52 ou C53 foi removida nem enfraquecida. O diff dos quatro testes antigos só acrescenta orçamento ao setup, mais o reforço de C6/C7 pela fronteira `ai-study-run`.

Classificação:

- **Verified at 4470b14:** as provas dos 43 checks. As citações de C29–C40 e C55 são novas. As de C1–C28, C52 e C53 foram renovadas, porque os quatro arquivos de teste foram tocados e as linhas se deslocaram: `s1-commands` +1, `s1-corpus` +6, `s2-translation` +4/+5, `s3-jev` +3.
- **Carried from 4eea13b:** os julgamentos do Round 2 que o diff não tocou. Isso inclui o Ponto 1 (pré-carga de C52/C53), o Ponto 2 (C3), as tabelas de decisão de C25/C27/C28 (só deslocadas em +3) e a leitura de "Fronteira e nível" para C1–C28.

## Binding sources

O passo 1 só roda no profile `ui`, então não rodou sob `light`. O plano marca o [corpus](corpus.md) como fonte de textos e gabaritos. A S4 não o toca (`git diff --stat 14ab14a..HEAD -- .specs/features/jev-translation-feasibility/corpus.md src/ai-study/corpus` vazio). O teste de fidelidade do corpus continua passando no gate.

## Checks

Verified at 4470b14. Rodei uma invocação para o alvo inteiro:
`make check-proof TEST_FLAGS='--test-name-pattern=^(C[1-9]|C1[0-9]|C2[0-9]|C3[0-9]|C40|C52|C53|C55):'`. Saiu com exit 0, e o TAP deu `# tests 43 # pass 43 # fail 0 # cancelled 0 # skipped 0 # todo 0`. Cada nome aparece uma vez: `ok 1 - C1:` … `ok 30 - C53:` como no Round 2, depois `ok 31 - C31:`, `ok 32 - C32:`, `ok 33 - C33:`, `ok 34 - C35:`, `ok 35 - C40:`, `ok 36 - C29:`, `ok 37 - C30:`, `ok 38 - C34:`, `ok 39 - C36:`, `ok 40 - C37:`, `ok 41 - C38:`, `ok 42 - C39:` e `ok 43 - C55:`. Nenhuma linha `# SKIP`/`# TODO`. As linhas que casam com `skip|todo` são os totalizadores e o nome do C30, que contém "todos". O padrão com parênteses funcionou, o que confirma a correção do `check-proof` (STATE.md, Decisões da S4, item 8).

Existência: `rg -n "^\s*test\('[A-Z0-9]+:" tests/` encontra exatamente os 43 nomes C, mais `S3:` (`s3-jev.test.mjs:600`) e o teste de fidelidade do corpus, que não tem prefixo:

- `s1-commands.test.mjs:52,91,119,147,166,234,262,341,368` (C1–C5, C9–C12)
- `s1-corpus.test.mjs:68,87,119` (C6–C8)
- `s2-translation.test.mjs:155,218,247,309,346,392,449,523` (C13–C20)
- `s3-jev.test.mjs:118,157,202,246,284,367,410,473,541,568` (C21–C28, C52, C53)
- `s4-limits.test.mjs:132,218,253,325,392,477,557,586,638,704,745,789,819` (C31, C32, C33, C35, C40, C29, C30, C34, C36, C37, C38, C39, C55)

Não existe teste C41–C51 nem C54. Os 13 testes da S4 estão num arquivo novo do diff. `rg -n "ai-study-report" src Makefile` não encontra nada: o alvo do relatório não existe.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | dry-run válido: modo, hashes, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | verified at 4470b14 (+1): `tests/ai-study/s1-commands.test.mjs:57` - `assert.equal(fixture.status, 0, fixture.output)`; `:60` - `assert.equal(f['hash do corpus'], corpus.corpusHash)`; `:74` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos | `ok 2 - C2:` | verified at 4470b14 (+1): `s1-commands.test.mjs:100` - `assert.equal(guard.loaded, 3, ...)`; `:116` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação e coleta fixture: zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | verified at 4470b14 (+1): `s1-commands.test.mjs:127` - `assert.equal(run.status, 0, run.output)`; `:135` - `assert.equal(last.shimCalls, '', ...)`; `:136` - `assert.deepEqual(last.guard.attempts, [], ...)`; `:142` - `assert.doesNotMatch(source, /child_process\|worker_threads/, file)` (agora cobre também `calls.mjs` e `run-reader.mjs`) | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | verified at 4470b14 (+1): `s1-commands.test.mjs:152` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:157` - `assertUsageFailure(run, /MODE/, ...)` (`:38`, status 2 e código do Node 2) | PASS |
| C5 | config inválida → 2 antes de coletar, sem segredo; tabela completa | `ok 5 - C5:` | verified at 4470b14 (+1): `s1-commands.test.mjs:206-208` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` | PASS |
| C6 | corpus exato R01–R12/T01–T06; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | verified at 4470b14 (+6): `tests/ai-study/s1-corpus.test.mjs:70` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)`; `:31-32` - `assert.equal(run.status, 2, ...)` + `assert.equal(run.nodeStatus, 2, ...)`, agora em dry-run **e** `ai-study-run`; `:36` - `assert.ok(!existsSync(join(sandbox.evidenceDir, name)), ...)` | PASS |
| C7 | seis julgamentos, rótulo válido, justificativa; violações → 2 | `ok 11 - C7:` | verified at 4470b14 (+6): `s1-corpus.test.mjs:90` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:31-36` nas duas fronteiras | PASS |
| C8 | resultados vinculados aos mesmos hashes; alteração impede comparação | `ok 12 - C8:` | verified at 4470b14 (+6): `s1-corpus.test.mjs:139` - `assert.equal(result.corpus_hash, base.corpusHash)`; `:174` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos fixture, `schema_version: 1` | `ok 6 - C9:` | verified at 4470b14 (+1): `s1-commands.test.mjs:237` - `assert.equal(run.status, 0, run.output)`; `:244` - `assert.equal(evidence.manifest.schema_version, 1)`; `:250` - 42 resultados | PASS |
| C10 | fixture: live → 2 preservando evidências; coletor live: fixture rejeitado | `ok 7 - C10:` | verified at 4470b14 (+1): `s1-commands.test.mjs:266` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`; `:321` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/`; `:329` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')` | PASS |
| C11 | aceita RUN_ID 1/64, timeout inteiro positivo, saída 1/2048; 20/24 | `ok 8 - C11:` | verified at 4470b14 (+1): `s1-commands.test.mjs:355` - `assert.equal(manifest[key], value, key)`; `:363` - `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; relatório exige RUN_ID; live exige config; token opcional; sem flags | `ok 9 - C12:` | verified at 4470b14 (+1): `s1-commands.test.mjs:374` - `assert.equal(manifest['run_id'], 'gerado na coleta')`; `:382` - `/^[A-Za-z0-9_-]{1,64}$/`; `:393` - `resolveConfig('report', {})` lança `UsageError` `/RUN_ID/`; `:407` - `assert.equal(noToken.local.apiToken, null, ...)`; `:411` - `assertUsageFailure(flagged, new RegExp(name), ...)` | PASS |
| C13 | tradução registra original, direção, modelo, revisão do template, vínculo | `ok 13 - C13:` | verified at 4470b14 (+4): `tests/ai-study/s2-translation.test.mjs:173` - `assert.equal(t.run_id, 'c13')`; `:177` - `assert.equal(t.template_revision, revision)` | PASS |
| C14 | template não confirmado → `template_unverified`, sem envio | `ok 14 - C14:` | verified at 4470b14 (+4/+5): `s2-translation.test.mjs:224` - `assertIncomplete(outcome, 'template_unverified')`; `:226` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:244` - `assert.deepEqual(lm.calls, [])` | PASS |
| C15 | 2048 admitido; 2049 → `input_limit`; contagem inclui template | `ok 15 - C15:` | verified at 4470b14 (+5): `s2-translation.test.mjs:260` - `assert.equal(counted[index].request.prompt, expected)`; `:269` - `assertIncomplete(first, 'input_limit')` | PASS |
| C16 | contagem indisponível/tokenizer divergente → `token_count_unavailable` | `ok 16 - C16:` | verified at 4470b14 (+5): `s2-translation.test.mjs:322` - `assertIncomplete(outcome, 'token_count_unavailable')` | PASS |
| C17 | saída literal como derivação; braço EN usa a derivação | `ok 17 - C17:` | verified at 4470b14 (+6): `s2-translation.test.mjs:360` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:374` - `assert.equal(enResult.derived_from, \`${c.id}-translate-pt-en\`)` | PASS |
| C18 | vazia/espaços/limite → `invalid_translation`, sem Jev EN | `ok 18 - C18:` | verified at 4470b14 (+6): `s2-translation.test.mjs:412` - `assert.equal(byCase[caseId].status, 'invalid_translation', caseId)`; `:420` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)` | PASS |
| C19 | duração ms, metadados do runtime, justificativa; sem download como VRAM | `ok 19 - C19:` | verified at 4470b14 (+6): `s2-translation.test.mjs:466` - `assert.ok(Number.isInteger(duration) && duration >= 25, ...)`; `:478` - `/download/` na justificativa; `:490` - `assertIncomplete(missing, 'model_mismatch')` | PASS |
| C20 | identidade solicitada/retornada Q6_K; sem trocar/instalar/baixar | `ok 20 - C20:` | verified at 4470b14 (+6): `s2-translation.test.mjs:537` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:562` - `assertIncomplete(outcome, reason)` | PASS |
| C21 | seis julgamentos `Choice` na mesma chamada, critérios yes/no/insufficient | `ok 21 - C21:` | verified at 4470b14 (+3): `tests/ai-study/s3-jev.test.mjs:125` - `assert.equal(jevCalls.length, 24, ...)`; `:134` - `assert.deepEqual(Object.keys(call.body), ['state', 'model', 'questions'], ...)`; `:141` - `assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id)` | PASS |
| C22 | payloads sem gabarito, justificativa ou revisão humana | `ok 22 - C22:` | verified at 4470b14 (+3): `s3-jev.test.mjs:192` - `assert.ok(!payload.includes(SENTINEL), ...)`; `:194` - `assert.deepEqual(sent(alt), sent(base))` | PASS |
| C23 | par com instruções, rubricas, IDs, critérios e modelo iguais; só o texto varia | `ok 23 - C23:` | verified at 4470b14 (+3): `s3-jev.test.mjs:212` - `assert.deepEqual(body.questions, reference.questions, ...)`; demais linhas de 4eea13b +3 | PASS |
| C24 | alternância PT/EN e EN/PT até R12, caso e braço preservados | `ok 24 - C24:` | verified at 4470b14 (+3): `s3-jev.test.mjs:264` - `assert.deepEqual(sentOrder, expectedOrder)`; `:266` - `assert.deepEqual(persisted, expectedOrder)` | PASS |
| C25 | validação Jev de AC 21; violação → `invalid_response` sem inferir | `ok 25 - C25:` | verified at 4470b14 (+3): `s3-jev.test.mjs:295` - `assert.deepEqual(validateEvaluation(results), [], label)`; `:329` - `assert.ok(problems.length > 0, label)`; `:352` - `invalid.evaluation.status === 'invalid_response'`. Tabelas carried from 4eea13b (+3) | PASS |
| C26 | avaliação persistida com identificação, distribuição, uso, duração; uso ausente não vira zero | `ok 26 - C26:` | verified at 4470b14 (+3): `s3-jev.test.mjs:396` - `assert.ok(Number.isInteger(e.duration_ms) && e.duration_ms >= 25, ...)`; `:399` - `assert.deepEqual(first.evaluation.usage, { available: true, value: usage })` | PASS |
| C27 | acerto/erro/ausência; `insufficient` é escolha | `ok 27 - C27:` | verified at 4470b14 (+3): `s3-jev.test.mjs:421` - `assert.equal(compareChoice(choice, expected), outcome, ...)`; `:440` - PT `{ hit: 12, miss: 0, absent: 0 }` | PASS |
| C28 | par incompleto fora do denominador; individual visível | `ok 28 - C28:` | verified at 4470b14 (+3): `s3-jev.test.mjs:496` - `assert.deepEqual(pair.reasons, reasons, label)`; `:499` - `assert.equal(comparison.counts.paired.denominator, reasons.length === 0 ? 1 : 0, ...)`; `:531` - denominador 10 | PASS |
| C29 | duas coletas simultâneas: só uma; a segunda é rejeitada antes de chamar modelos ou alterar a primeira | `ok 36 - C29:` | verified at 4470b14 (novo): `tests/ai-study/s4-limits.test.mjs:499-501` - `assert.equal(second.status, 2, ...)` + `assert.equal(second.nodeStatus, 2, ...)` + `/outra coleta \(processo ${firstPid}\) está em andamento/` (processos `make` reais concorrentes, a primeira parada na barreira com a trava, `:489`); `:503` - `assert.equal(started().length, 1, 'nenhuma segunda coleta chegou a uma chamada')`; `:504` - `readServices(sandbox).every((entry) => entry.pid === firstPid)`; `:505-506` - nenhuma execução nova + `assert.deepEqual(snapshotFiles(...c29-primeira), firstBefore, ...)`; mesmo processo `:532-536` - `UsageError` e `assert.equal(used, 0)` | PASS |
| C30 | RUN_ID existente → 2, bytes de todos os arquivos anteriores mantidos, inclusive de incompleta | `ok 37 - C30:` | verified at 4470b14 (novo): `s4-limits.test.mjs:563` - anterior `status === 'incomplete'`; `:572-574` - `assert.equal(again.status, 2, ...)` + `assert.equal(again.nodeStatus, 2, ...)` + `/RUN_ID ${runId} já existe; .../` (fixture e live × concluída e incompleta); `:577` - `assert.deepEqual(snapshotFiles(sandbox.evidenceDir), before, ...)`; `:578` - nenhuma chamada | PASS |
| C31 | máx. 20 locais / 24 Jev contando falhas; 21ª/25ª bloqueada; zero retries | `ok 31 - C31:` | verified at 4470b14 (novo): `s4-limits.test.mjs:140` - `e.reason === 'call_limit' && !e.requestSent`; `:142` - `assert.equal(executed, 44, ...)`; `:161` - `assert.equal(retryingLocal.svc.count('local'), 20, 'exatamente 20 pedidos locais saíram')`; `:174` - `assert.equal(retryingJev.svc.count('jev'), 24, ...)`; `:189` - `assert.equal(svc.count(service), nth, \`${label}: nenhum pedido repetido\`)` + `:192` - falha contada em `manifest.calls`; `:151` - a verificação do candidato conta (19 = 1 GET + 18). Ver observação 3 (precisão de "verificações de template") | PASS |
| C32 | no máximo uma chamada em andamento | `ok 32 - C32:` | verified at 4470b14 (novo): `s4-limits.test.mjs:227` - `e.reason === 'concurrent_call' && e.requestSent === false`; `:230` - `assert.equal(started, 0, ...)`; `:241` - `assert.equal(svc.maxInFlight(), 1)`; `:243` - início/fim alternam em todos os 43 pedidos; `:245-250` - GET candidato, tradução e braços alternados em série | PASS |
| C33 | timeout local/Jev encerra no limite, `incomplete`, restantes não executados, resultado remoto desconhecido sem alegar cancelamento | `ok 33 - C33:` | verified at 4470b14 (novo): `s4-limits.test.mjs:273` - `assert.ok(waited >= 990 && waited < 1900, ...)` (servidor local que ignora o abort); `:277-278` - `status === 'incomplete'`, `reason === 'timeout'`; `:279-287` - `failure` com `remote_outcome: 'unknown'`, `request_sent: true`; `:289` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/)`; `:292` - `not_executed_items` = restantes | PASS |
| C34 | falha de transporte/HTTP/resposta inválida após dois resultados → código 1, prefixo preservado, restantes não executados, sem trocar provedor/idioma | `ok 38 - C34:` | verified at 4470b14 (novo): `s4-limits.test.mjs:605-606` - `assert.equal(run.status, 2, ...)` + `assert.equal(run.nodeStatus, 1, \`... "Error 1" ...\`)`; `:613` - `completed_items`; `:616` - `assert.deepEqual(manifest.not_executed_items, remainingAfter(last), ...)`; `:620` + `:625` - prefixo JSON íntegro e igual à referência; `:632-634` - pedidos só até a falha, só as duas origens, mesmo modelo Jev. Seis variantes (Jev e local × transporte/HTTP/inválida). Código 1 lido via `Error 1`; ver "Coerência" item 1 | PASS |
| C35 | interrupção antes/depois do rename de manifesto/resultado: destino anterior ou novo íntegro; temporário/JSON parcial não aceito | `ok 34 - C35:` | verified at 4470b14 (novo): `s4-limits.test.mjs:314` - `assert.equal(result.signal, 'SIGKILL', ...)`; `:329`/`:333` - manifesto anterior/novo íntegro; `:337-338`/`:340` - resultado ausente+temporário / novo íntegro; `:346` - `assert.doesNotThrow(() => JSON.parse(content), file)`; `:352` - temporário em `ignored` com `reason === 'temporary'`; `:366` + `:370` - `loadRun` recusa resultado e manifesto parciais | PASS |
| C36 | segredos sentinela fora de stdout, stderr, manifesto, resultados **ou relatório**, inclusive em erros HTTP e de parsing | `ok 39 - C36:` | verified at 4470b14 (novo), parte coleta: `s4-limits.test.mjs:659` - `assert.deepEqual(runs.map((r) => r.nodeStatus), [0, 0, 1, 1, 1, 1, 1], ...)`; `:663-667` - o eco chegou e foi redigido (`'Bearer [omitido]'`); `:698` - `assert.ok(!text.includes(secret), \`${name} em ${where}\`)` sobre stdout/stderr de 7 execuções e todos os arquivos de evidência; `:700` - nenhum `authorization: Bearer` não omitido; `:685-691` - chave/token curtos → código 2, sem chamadas. **Relatório: sem evidência.** `rg -n "ai-study-report" src Makefile` vazio, e nenhum teste gera relatório | PARTIAL |
| C37 | nova tentativa usa nova execução, sem importar resultados/caches anteriores; mesmo ID segue C30 | `ok 40 - C37:` | verified at 4470b14 (novo): `s4-limits.test.mjs:725-726` - 18 traduções e 24 avaliações refeitas; `:730-731` - sentinela ausente dos resultados e dos pedidos; `:737` - `assert.deepEqual(evidenceReads.filter(...), [])` (rastreio de `fs`); `:741-742` - mesmo ID → 2, bytes intactos | PASS |
| C38 | corpus sintético, zero leituras de chats/Cloak/credenciais; tráfego só ao servidor configurado e ao Jev oficial | `ok 41 - C38:` | verified at 4470b14 (novo): `s4-limits.test.mjs:775` - `assert.deepEqual(outside, [], 'nenhuma leitura fora da bancada')`; `:777` - nenhum caminho `cloak\|.claude\|.codex\|.ssh\|.aws\|/gh/`; `:783` - origens `['http://lmstudio.interno:4321', 'https://api.typesafe.ai']`; `:785` - Jev só em `https://api.typesafe.ai/v1/systemone` | PASS |
| C39 | evidências fora do Git e sobrevivem a nova coleta **e geração de relatório**, sem limpeza | `ok 42 - C39:` | verified at 4470b14 (novo), parte coleta: `s4-limits.test.mjs:799` - `git check-ignore` status 0 no repositório real; `:801` - `git ls-files -- artifacts` vazio; `:815` - `assert.equal(after[file], content, ...)` após nova coleta e `loadRun` (`:813`). **Geração de relatório: sem evidência.** `loadRun` só lê, não gera nada | PARTIAL |
| C40 | relações `schema_version: 1`; **relatório** recusa vínculo a outra execução/revisão/schema | `ok 35 - C40:` | verified at 4470b14 (novo): relações `s4-limits.test.mjs:406-434` (`schema_version`, `run_id`, `corpus`, `planned_items`, tradução→original/caso `:426-427`, avaliação→caso/braço `:430-431`); recusas pelo **leitor** `:455` - `assert.throws(() => loadRun(...), (e) => e instanceof UsageError && pattern.test(e.message), runId)` sobre 12 variantes `:441-452`, `:458` - revisão diferente da esperada. **Recusa pelo relatório: sem evidência**, porque o relatório não existe | PARTIAL |
| C52 | live com serviços controlados: zero Codex/Claude/Grok/agy/Cloak | `ok 29 - C52:` | verified at 4470b14 (+3): `s3-jev.test.mjs:548` - `assert.equal(run.status, 0, run.output)`; `:553` - 42 resultados; `:557` - `assert.equal(run.shimCalls, '', ...)`; `:558` - `assert.deepEqual(run.guard.attempts, [], ...)` | PASS |
| C53 | fronteira live: transporte/resposta fixture → 2, preservando evidências | `ok 30 - C53:` | verified at 4470b14 (+3): `s3-jev.test.mjs:580-582` - `run.status === 2`, `run.nodeStatus === 2`, `/proveniência "fixture" incompatível com MODE=live em R01-evaluate-pt/`; `:595` - `assert.deepEqual(after.rawResults, before.rawResults)` | PASS |
| C55 | 1º SIGINT/SIGTERM: `incomplete`/`interrupted`, código 1, `remote_outcome: unknown` sem alegar cancelamento, trava liberada; 2º sinal: padrão, sem limpeza | `ok 43 - C55:` | verified at 4470b14 (novo): `s4-limits.test.mjs:833` - `assert.equal(result.nodeStatus, 1, ...)`; `:835-836` - `status === 'incomplete'`, `reason === 'interrupted'`; `:837-841` - `['R01-evaluate-en', true, 'unknown']`; `:843` - `assert.doesNotMatch(manifest.failure.message, /cancelad[ao]\b/)`; `:845` - `assert.ok(!existsSync(join(sandbox.evidenceDir, LOCK_NAME)), ...)`; segundo sinal `:862` - processo vivo após o 1º; `:865` - `assert.equal(result.nodeStatus, 130, ...)`; `:866-867` - manifesto `running` e trava do pid (sem limpeza). Ver "Coerência" item 3 | PASS |

### C36, C39 e C40 - julgamento

Verified at 4470b14. **Veredito: os três ficam PARTIAL, não PASS.** O que decide é o texto de `checks.md`, e o texto de cada claim pede algo que a S4 não pode provar:

- **C36:** "… não aparecem em stdout, stderr, manifesto, resultados **ou relatório**". O membro "relatório" também aparece na linha de Coverage "Saídas redigidas (6)", atribuído só a C36. A varredura da coleta é sólida: `:698` e `:700` rodam sobre 7 execuções e todos os arquivos, e o eco prova que os segredos chegaram (`:663-667`). Mas não existe relatório para varrer.
- **C39:** "sobrevivem a nova coleta **e geração de relatório**". `loadRun` é um leitor puro (`src/ai-study/run-reader.mjs:23`). Ler não é gerar: um gerador de relatório que escrevesse no diretório da execução, ou o limpasse, passaria por esta prova.
- **C40:** "**relatório** recusa vínculo a outra execução ou revisão, incluindo arquivo incompatível com a versão de schema". A recusa foi provada no leitor que o relatório *deverá* usar (`:455`, `:458`). Que o relatório use esse leitor, e que a recusa chegue à fronteira com o código certo, é uma promessa da S5, não um fato da S4.

A transferência registrada em `STATE.md` (Decisões da S4, item 6) e nas linhas Status de `checks.md` ("prova parcial … C41/S5 deve repetir") é honesta. Mas não muda o texto dos claims. O claim de C41 não menciona segredos (C36), sobrevivência (C39) nem recusa de vínculo (C40). Logo nenhum check construído ou pendente assumiu essas partes: elas continuam devidas por C36, C39 e C40. Há dois caminhos para fechar:

- (a) aceitar FAIL até a S5 e re-verificar os três junto com C41;
- (b) por decisão explícita do usuário, emendar `checks.md` e mover as partes do relatório para C41 ou para um check novo da S5, como foi feito com C3/C10 → C52–C54.

O verificador não escolhe entre os dois.

### Coerência entre C55, as emendas ao plano e os checks

Verified at 4470b14.

1. **Códigos de saída via `Error N`** (emenda em `plan.md`, Observable, "Códigos de saída"). **Coerente, com lacuna de precisão.** C34 diz "conclui a fronteira de coleta com código 1". Pela fronteira, o processo `make` sai com 2 (`s4-limits.test.mjs:605`), e o 1 só aparece na linha `make: *** [...] Error 1`, lida por `tests/ai-study/helpers.mjs:148-152`. A emenda define o código publicado como o da CLI Node, e com ela a leitura do C34 não contradiz o plano. Mas o texto de C4, C5, C9, C10, C30, C34, C53 e C55 continua dizendo só "código N", sem fixar onde ele é lido. A consequência prática é que, pelo código de saída do `make`, 1 (incompleto) e 2 (uso inválido) são indistinguíveis. Só stderr e o manifesto os separam. É lacuna de precisão em `checks.md`, não contradição.
2. **AC 27, `local_token_count`** (emenda em `plan.md`). **Não contradiz C31, mas é uma obrigação aprovada sem check.** A emenda cria um orçamento próprio de até 18 contagens, registrado em `manifest.calls` como `local_token_count`, falhas inclusive, com uma chamada em andamento, timeout e sem retry. Nenhum check tem essa borda (18/19). A linha de Coverage "Chamadas (4 edges)" não tem o membro, e C31 não foi emendado. `rg -n "local_token_count" src tests` está vazio: não implementado, e o live continua bloqueado em `token_count_unavailable`. Como nada foi construído, não há o que falhar hoje. Mas o plano agora tem um requisito sem check: `STATE.md` (Decisões da S4, item 3) só promete que "C31 deve ganhar a variante". O check precisa existir antes da implementação.
3. **Término por sinal / C55.** **Coerente.** O texto de C55 reproduz a emenda: primeiro sinal → `interrupted`, código 1, `unknown`, sem alegar cancelamento, trava liberada; segundo → padrão, sem limpeza. A parte "trava abandonada → código 2 e remoção manual" é provada em C29 (`s4-limits.test.mjs:543-554`), não em C55, o que é coerente com a alocação no Coverage. Duas ressalvas:
   - (a) O primeiro sinal **fora** de uma chamada só é observado indiretamente. O caminho `collect.mjs:227` (`stop('interrupted', ...)` antes do próximo item) e `calls.mjs:74` (interrupção antes do envio) não têm asserção. O teste `:862` só prova que o processo não morre com o primeiro sinal.
   - (b) O teste envia o sinal só ao pid do Node (`:831`, `:860`). Num Ctrl+C real o terminal sinaliza o grupo de processos inteiro, inclusive o `make`. Pelo comportamento documentado do GNU Make, ele espera o filho e termina pelo próprio sinal, sem imprimir `Error 1`. O manifesto continua `interrupted`, e a emenda torna o manifesto a fonte autoritativa. Não executei isso: é uma leitura, não uma prova.

### Fronteira e nível

Verified at 4470b14. Os claims de fronteira de comando novos na S4 são C30 e C34, pela lista de `checks.md`. Os dois atravessam `make ai-study-run` (`runMake`, `spawnSync('make', ...)`) e conferem o código do Node na linha `Error N`. C29 e C55 também atravessam `make`, com processos reais em segundo plano (`startMake`). C35 atravessa a CLI Node com SIGKILL real. C31, C32 e C33 usam `runCollection` com adaptadores reais e `fetch` controlado. Esses não estão na lista de fronteira, e o orçamento é o mesmo objeto da CLI (`src/ai-study/cli.mjs:24-26`). C40 é provado abaixo do relatório: é a lacuna de nível já contada em PARTIAL.

C1–C28, C52 e C53: carried from 4eea13b.

## Swept existing re-read

Verified at 4470b14. `checks.md` não tem linhas `Swept` marcadas como existentes. A única linha `Swept` alterada na S4 é "concurrency", que ganhou C55, já provado acima. As restrições existentes que as provas pressupõem estão presentes no código:

- `rejectMixedProvenance` em `src/ai-study/collect.mjs:165`, aplicado em `:205`, `:209`, `:237` e `:270`;
- a parada `template_unverified` em `collect.mjs:203`;
- interrupção entre itens em `collect.mjs:227`;
- `.gitignore:1` com `artifacts/`, inalterado;
- trava `O_EXCL` em `src/ai-study/evidence.mjs:48`;
- recusa de RUN_ID existente em `evidence.mjs:33`;
- gravação atômica com `fsync` e `rename` em `evidence.mjs:15-25`;
- orçamento sem retry em `src/ai-study/calls.mjs:57-130`.

## Coverage

Profile `light`: o recompute de Coverage não foi executado. Duas leituras das linhas do próprio `checks.md`, sem recompute: o membro "relatório" de "Saídas redigidas (6)" está sem prova (C36 PARTIAL), e a emenda da AC 27 não tem linha nenhuma ("Coerência", item 2).

## Test policy rows

`checks.md` não tem seção `Test policy`, e o profile `light` não emite veredito sobre ela.

## Faults injected

Profile `light`: a injeção de falhas não é exigida e não foi feita. A árvore real não foi alterada.

## Out of scope (not built)

C41, C42, C43, C44, C45, C46, C47, C48, C49, C50, C51 e C54 (S5). Não há testes deles na árvore e eles **não** contam como aprovados. C50 e C51 dependem de serviços reais e não podem ser substituídos por fixture.

## Observations (non-blocking)

Verified at 4470b14, salvo indicação.

1. **Lacuna de precisão nos códigos de saída** ("Coerência", item 1). Sugestão: dizer em `checks.md` que "código N" na fronteira `make` é o da linha `Error N`, e que o término autoritativo é o do manifesto.
2. **AC 27 emendada sem check** ("Coerência", item 2). Criar a borda 18/19 de `local_token_count`, com linha de Coverage, antes de implementar a Decisão 2.
3. **"Verificações de template" em C31.** O claim e o plano falam em "até duas verificações de template" dentro das 20 locais. Na implementação, o template é um dado (`official`) e não gera chamada. O que conta é a verificação do candidato, 1 GET (`s4-limits.test.mjs:149-151`). Quando a Decisão 1 for implementada, fica a definir o que conta como verificação.
4. **C55, primeiro sinal fora de chamada e Ctrl+C real** ("Coerência", item 3, ressalvas a e b).
5. **Resolvidas desde o Round 2:** a observação 4 (falha de `comparison.json`, STATE.md item 7; o teste `S3:` continua passando); a observação 7, parte "GET de identidade não conta no limite" (agora conta, `:151`); e o `check-proof` com parênteses em `TEST_FLAGS` (padrão alternado usado neste round, exit 0). A observação 3, resposta Jev inválida encerra a coleta, agora tem prova em C34 (`jev-invalida`, `:597`).
6. (Carried from 4eea13b.) O Ponto 1, pré-carga de C52/C53 com `countTokens` e template substituídos, continua valendo. A S4 não tocou `live-services-hooks.mjs`, e as condições (a) e (b) do Round 2 seguem pendentes. A guarda ainda não cobre `globalThis.WebSocket`. As rubricas sem revisão humana e o `model` do Jev seguem como condições de entrada da S5.

## Round 2 history (S3, C21–C28, C52, C53)

Carried from 4eea13b. O Round 2 foi feito por sessão nova independente, profile `light`, range `3985c43..4eea13b`, e deu veredito PASS para C1–C28, C52 e C53. O relatório completo está em `git show 4470b14:.specs/features/jev-translation-feasibility/verification.md`. Este round carrega dele, sem refazer, o Ponto 1 (pré-carga `live-services-hooks.mjs` em C52/C53: aceitável enquanto `countTokens` for constante e o template não for o oficial), o Ponto 2 (C3 alterado na S3 sem enfraquecimento) e as tabelas de decisão de C25, C27 e C28. Os testes delas só se deslocaram +3 linhas na S4.

## Round 1 history (S1 + S2, C1–C20)

Carried from 166a2b9. O Round 1 foi feito por verificador independente, profile `light`, range `dba3999..166a2b9`, e deu veredito PASS. Os julgamentos sobre o setup de C10 e a expectativa de C19 (5451bc0) continuam válidos. A S4 só acrescentou orçamento ao setup desses testes, sem alterar asserções.

## Gate

Verified at 4470b14. `make check-proof` com a suíte completa, sem filtro: exit 0; 45 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. São os 43 checks, mais o teste de fidelidade do corpus e o teste `S3:` de `comparison.json`. O gate verde não fecha C36, C39 e C40: as provas deles passam, mas não cobrem a parte do relatório que os claims exigem.
