# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: PASS
**Scope**: S1 (C1–C12) - somente a slice construída (issue PRB-2); C13–C54 fora de escopo (não construídos)
**Profile**: light
**Diff range**: 4a1acfe..1ac00cd
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier)

Round 2 verificado em `1ac00cd9cfb64310f7d506f259d0699d5cfc9f3c`, Node v24.14.0. Round 1 em `6bc0215` (relatório commitado em `b50c80a`). Árvore real somente leitura: `git status --porcelain` vazio antes e depois (o `?? pnpm-lock.yaml` do round 1 agora é ignorado por `.gitignore:3`). Experimentos auxiliares feitos em cópias `git archive` no scratchpad, fora da árvore.

### Escopo do round 2

Fix inspecionado: `git diff 6bc0215..1ac00cd` sem `.specs` (o `b50c80a` só adicionou este relatório). Arquivos tocados: `.gitignore` (+`pnpm-lock.yaml`), `tests/ai-study/helpers.mjs`, `tests/ai-study/s1-commands.test.mjs`, `tests/ai-study/support/live-jev-in-fixture-hooks.mjs`, `tests/ai-study/support/live-jev-in-fixture.mjs`, novo `tests/ai-study/support/live-jev-response-in-fixture.mjs`. `src/`, `Makefile` e `tests/ai-study/s1-corpus.test.mjs` intocados (`git diff --stat 6bc0215..1ac00cd -- src Makefile tests/ai-study/s1-corpus.test.mjs` vazio).

- Re-verificados em `1ac00cd`: C4, C5, C10, C12 (passam por `assertUsageFailure`/`runMake`) e também **C3**, que o escopo pelo diff alcança: `s1-commands.test.mjs:128` chama `assertUsageFailure` sobre um `runMake`.
- Carregados de `6bc0215`: C1, C2, C9, C11 (corpo dos testes inalterado; só as linhas deslocaram, citações atualizadas porque o arquivo foi tocado) e C6, C7, C8 (arquivo de teste intocado; citações de `6bc0215` continuam válidas). A mudança em `nodeStatusFromMake` (`helpers.mjs:93-98`) afeta C6/C7 só no caminho de falha sem linha `Error N`: antes `null` reprovava a asserção estrita `run.nodeStatus === 2`, agora lança - reprova igual. Nenhuma mudança no veredito.

## Binding sources

Carried from 6bc0215. Passo 1 roda somente sob o profile `ui`; sob `light` não foi executado. O fix não tocou interface.

## Checks

Verified at 1ac00cd (provas); linhas marcadas por check.

Proof run (uma invocação para todo o alvo, em `1ac00cd`):
`make check-proof TEST_FLAGS=' --test-name-pattern=^C1: --test-name-pattern=^C2: ... --test-name-pattern=^C12:'` - exit 0; TAP `# tests 12 # pass 12 # fail 0 # cancelled 0 # skipped 0 # todo 0`; individualmente: `ok 1 - C1:`, `ok 2 - C2:`, `ok 3 - C3:`, `ok 4 - C4:`, `ok 5 - C5:`, `ok 6 - C9:`, `ok 7 - C10:`, `ok 8 - C11:`, `ok 9 - C12:`, `ok 10 - C6:`, `ok 11 - C7:`, `ok 12 - C8:`.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | `make ai-study-dry-run` válido imprime modo, hashes corpus/gabarito, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | carried from 6bc0215, linhas atualizadas: `tests/ai-study/s1-commands.test.mjs:55` - `assert.equal(fixture.status, 0, ...)`; `:58-59` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `assert.equal(f['hash do gabarito'], corpus.gabaritoHash)`; `:61-62` `'20'`/`'24'`; `:77-78` modelos solicitados; `:81` - `assert.equal(l['destino local'], 'http://127.0.0.1:1234/v1')`; `:72` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos, com transportes que falham se usados | `ok 2 - C2:` | carried from 6bc0215, linhas atualizadas: `s1-commands.test.mjs:98-99` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])`; `:114` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação (dry-run fixture e live) e coleta fixture invocam zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | verified at 1ac00cd: `s1-commands.test.mjs:130` - `assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada')`; `:131` - `assert.deepEqual(last.guard.attempts.filter((a) => a.kind === 'process'), [])`; `:137` - `assert.doesNotMatch(source, /child_process OR worker_threads/, file)` (alternância reescrita sem barra vertical); `:128` `assertUsageFailure(last, /coleta live ainda não está disponível/, 'run live')` agora com código do Node estrito | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → código 2 | `ok 4 - C4:` | verified at 1ac00cd: `s1-commands.test.mjs:147` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)` (ambos os alvos make); `:152` - `assertUsageFailure(run, /MODE/, ...)` para `FIXTURE`, `Live`, `simulated`, `dry-run`, vazio → `:37` `assert.equal(run.status, 2, ...)` + `:39` `assert.equal('nodeStatus' in run ? run.nodeStatus : run.status, 2, ...)`; `:157-158` live aceito (`/^modo: live$/m`) | PASS |
| C5 | config inválida na fronteira → 2 antes de coletar; diagnóstico nomeia a config sem segredo; tabela completa | `ok 5 - C5:` | verified at 1ac00cd: `s1-commands.test.mjs:201-203` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` sobre a tabela `:164-196` (4 campos live ausentes, RUN_ID vazio/65/caminho(3)/não ASCII/espaço, timeouts `0,-1,1.5,abc,'',1e2` ×2, saída `0,2049,1.5,abc,''`, `RETRY`, corpus ilegível/diretório/vazio/JSON inválido); `:207-212` variantes CLI direta (sem chave `nodeStatus`, usam `run.status`) | PASS |
| C6 | corpus exato R01–R12, T01–T06 em ordem; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | carried from 6bc0215: `tests/ai-study/s1-corpus.test.mjs:64-65` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)` / `...T_IDS`; `:27-28` - `assert.equal(run.status, 2)` + `assert.equal(run.nodeStatus, 2)` para as 8 variantes `:69-76`; `:31` - `assert.doesNotMatch(run.stdout, /hash do corpus/)` | PASS |
| C7 | cada R tem os 6 julgamentos, rótulo válido, justificativa não vazia; violações → 2 | `ok 11 - C7:` | carried from 6bc0215: `s1-corpus.test.mjs:84` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:86-87` rótulo e justificativa; `:27-28` código 2 na fronteira para `:93-108` | PASS |
| C8 | todos os resultados vinculados ao mesmo hash de corpus e gabarito; alteração durante a execução impede comparação | `ok 12 - C8:` | carried from 6bc0215: `s1-corpus.test.mjs:133-134` - `assert.equal(result.corpus_hash, base.corpusHash)` / `assert.equal(result.gabarito_hash, base.gabaritoHash)`; `:138` - `assert.throws(() => assertSameReference(mixed), UsageError)`; `:163` - `error.exitCode === 2 && /CORPUS/`; `:167` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos `fixture` em `artifacts/ai-study/<run-id>/`, `schema_version: 1` | `ok 6 - C9:` | carried from 6bc0215, linhas atualizadas: `s1-commands.test.mjs:232` - `assert.equal(run.status, 0, run.output)`; `:235` - `assert.match(run.stdout, new RegExp(\`artifacts/ai-study/${runId}\`))`; `:239` - `assert.equal(evidence.manifest.schema_version, 1)`; `:241-242` `mode`/`provenance` = `'fixture'`; `:249-252` cada resultado `schema_version` 1 e `provenance` `'fixture'` | PASS |
| C10 | fronteira make: transporte ou resposta live em execução fixture → 2, preservando evidências; coletor: fixture em live também rejeitado | `ok 7 - C10:` | verified at 1ac00cd: transporte live via make `s1-commands.test.mjs:261` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, 'live em fixture')`, `:264-266` `rejected`/`provenance_mismatch`/`['R01-translate-pt-en']`; **resposta live via make (novo)** `:272` - `assertUsageFailure(response, /proveniência "live" incompatível com MODE=fixture em R01-evaluate-pt/, 'resposta live em fixture')` (pré-carga `live-jev-response-in-fixture.mjs`: transporte declara `fixture`, resposta volta `live`), `:274-275` - `assert.equal(responseEvidence.manifest.status, 'rejected')` / `reason === 'provenance_mismatch'`, `:276-277` - `assert.deepEqual(responseEvidence.results.map((r) => r.item.id), ['R01-translate-pt-en'])` + `results[0].provenance === 'fixture'` (prefixo preservado); coletor live `:306` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/`; `:314` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')` | PASS |
| C11 | aceita RUN_ID 1 e 64, timeout inteiro positivo, saída 1 e 2048; limites 20/24 | `ok 8 - C11:` | carried from 6bc0215, linhas atualizadas: `s1-commands.test.mjs:338-342` - `assert.equal(dry.status, 0)` + `assert.equal(manifest[key], value, key)` + `'20'`/`'24'`; `:346-348` - `make ai-study-run` exit 0 e `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; RUN_ID gerado; relatório exige RUN_ID; live exige URL/modelo e chave/modelo; token opcional; sem seleção parcial/retry/paralelismo | `ok 9 - C12:` | verified at 1ac00cd: `s1-commands.test.mjs:358-362` - corpus `'src/ai-study/corpus/revision-1.json (revisão 1)'`, `run_id` `'gerado na coleta'`, `'120'`, `'30'`, `'2048'`; `:367` - `assert.match(generated, /^[A-Za-z0-9_-]{1,64}$/)`; `:378` - `resolveConfig('report', {})` lança `UsageError` com `/RUN_ID/`; `:382-389` 4 obrigatórios live; `:392` - `assert.equal(noToken.local.apiToken, null, ...)`; `:396` - `assertUsageFailure(flagged, new RegExp(name), ...)` para `CASES,ONLY,RETRY,RETRIES,PARALLEL,CONCURRENCY` via make; `:401` flags CLI | PASS |

Existência e execução (em `1ac00cd`): `rg -n "test\('C[0-9]+:" tests/` encontra exatamente os 12 nomes (`s1-commands.test.mjs:50,89,117,142,161,229,257,326,353`; `s1-corpus.test.mjs:62,81,113`). Nenhum teste C13–C54 (`rg -n "C(1[3-9]|[2-5][0-9]):" tests/` sem resultados).

### Fechamento das lacunas do round 1

Verified at 1ac00cd.

- **Lacuna 1 (C10, resposta live na fronteira make) - fechada.** O caso novo `s1-commands.test.mjs:270-277` atravessa `make ai-study-run` com a pré-carga `support/live-jev-response-in-fixture.mjs`, que registra `live-jev-in-fixture-hooks.mjs` com `variant: 'response'`: transporte Jev `provenance: 'fixture'` (passa a checagem de transporte, `src/ai-study/collect.mjs:102`) e resposta `provenance: 'live'` (rejeitada em `collect.mjs:113`). Asserta código 2 (make e Node), diagnóstico, `rejected`/`provenance_mismatch` e prefixo `['R01-translate-pt-en']` com proveniência `fixture`. Sonda em cópia scratch: removendo `rejectMixedProvenance(response?.provenance, item)` em `collect.mjs:113`, `C10` fica `not ok`, com a falha no rótulo `resposta live em fixture` (a asserção nova), ou seja, a mudança é de nível resposta e é pega na fronteira make.
- **Lacuna 2 (fallback para o 2 genérico do make) - fechada.** `nodeStatusFromMake` (`tests/ai-study/helpers.mjs:93-98`) agora lança `make falhou sem a linha "Error N" ...` quando o make falha sem a linha; `runMake` sempre põe a chave `nodeStatus` (`:80`), e `assertUsageFailure` (`s1-commands.test.mjs:39`) usa `'nodeStatus' in run ? run.nodeStatus : run.status`, recorrendo a `run.status` só para `runCli` (que não tem a chave, `helpers.mjs:83-89`). Sonda em cópia scratch de `1ac00cd` trocando a regex por uma que nunca casa (simula a linha ausente): `C4`, `C5`, `C10`, `C12` todos `not ok` (`# pass 0 # fail 4`), cada um com `make falhou sem a linha "Error N"`. Controle: a mesma sonda em cópia de `6bc0215` dá `ok` nos quatro (`# pass 4 # fail 0`), o que confirma que a lacuna existia e foi fechada.

### Fronteira `make`

Verified at 1ac00cd. `runMake` (`helpers.mjs:76-81`) executa `make -s --no-print-directory -C <cópia> <alvo> VAR=valor` sem herdar o ambiente do teste; em falha, o código do Node vem de `nodeStatusFromMake` (`helpers.mjs:93-98`, regex `/\] Error (\d+)$/m`), agora estrito. C6/C7 usam `run.nodeStatus` (`s1-corpus.test.mjs:28`); C3/C4/C5/C10/C12 usam `assertUsageFailure` (`s1-commands.test.mjs:36-41`).

### Nível e amostragem

Verified at 1ac00cd. C10 agora tem as duas variantes do claim ("transporte ou resposta") na fronteira make; o restante do nível e da amostragem é carried from 6bc0215.

## Swept existing re-read

Carried from 6bc0215. O fix não tocou `src/`; as citações de `src/ai-study/*.mjs` do round 1 continuam válidas (`collect.mjs:86-93` `rejectMixedProvenance`, aplicado em `:102` e `:113`, reconfirmado neste round). Landing 1: `.gitignore:1` `artifacts/` inalterado; o fix só acrescentou `.gitignore:3` `pnpm-lock.yaml`.

## Coverage

Carried from 6bc0215. Profile `light`: recompute de Coverage não executado.

## Test policy rows

Carried from 6bc0215. `checks.md` não tem seção `Test policy`; o profile `light` não emite veredito sobre ela.

## Faults injected

Verified at 1ac00cd. Profile `light`: injeção de falhas não é exigida. As duas sondas em scratch descritas em "Fechamento das lacunas" foram feitas só para confirmar o fechamento das lacunas 1 e 2; a árvore real não foi alterada (porcelain vazio antes e depois).

## Out of scope (not built)

Carried from 6bc0215. C13, C14, C15, C16, C17, C18, C19, C20 (S2); C21, C22, C23, C24, C25, C26, C27, C28, C52, C53 (S3); C29, C30, C31, C32, C33, C34, C35, C36, C37, C38, C39, C40 (S4); C41, C42, C43, C44, C45, C46, C47, C48, C49, C50, C51, C54 (S5). Slices não construídas; sem testes na árvore. Não verificados e **não** contados como aprovados.

## Observations (non-blocking)

Verified at 1ac00cd.

1. (Round 1, lacuna 1) Fechada - ver acima.
2. (Round 1, lacuna 2) Fechada - ver acima.
3. (Round 1, lacuna 3, conhecida, não bloqueante por decisão do usuário) C6/C7 provam a rejeição do corpus inválido só em `make ai-study-dry-run`; `make ai-study-run` usa o mesmo `loadCorpus` (`cli.mjs:36`), mas variantes de IDs/rótulos não são exercitadas no alvo de coleta.
4. (Round 1, lacuna 4, conhecida, não bloqueante por decisão do usuário) `check-proof` quebra com parênteses em `TEST_FLAGS` (`$(TEST_FLAGS)` sem aspas, `Makefile:38`). Neste round usei `--test-name-pattern` repetidos numa só invocação.
5. (Nova, menor) Na variante resposta de C10 pela fronteira make, a preservação do prefixo é afirmada por IDs e proveniência (`s1-commands.test.mjs:276-277`), não byte a byte; a comparação byte a byte existe só no coletor (`:314`). Atende à redação do claim.

## Gate

Verified at 1ac00cd. `make check-proof` (suíte completa, sem filtro) - exit 0; 13 passed, 0 failed, 0 skipped, 0 todo (C1–C12 mais o teste de fidelidade do corpus).
