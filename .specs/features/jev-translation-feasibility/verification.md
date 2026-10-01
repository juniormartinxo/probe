# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: PASS
**Scope**: S1 (C1–C12) - somente a slice construída (issue PRB-2); C13–C54 fora de escopo (não construídos)
**Profile**: light
**Diff range**: 4a1acfe..6bc0215
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Verified at `6bc0215cc2d489eece16b1f4c74d022127811346`, Node v24.14.0. Árvore real somente leitura: `git status --porcelain` idêntico antes e depois (apenas `?? pnpm-lock.yaml`, preexistente). Experimentos auxiliares feitos numa cópia em scratchpad, fora da árvore.

C3 e C10 verificados na redação atual, estreitada em 30/09/2026 por decisão do usuário (partes live movidas para C52–C54, registrado em `checks.md` e `plan.md:38`).

## Binding sources

Passo 1 roda somente sob o profile `ui`; sob `light` não foi executado. Fontes recebidas: desenho aprovado `docs/superpowers/specs/2026-09-22-probe-mvp-design.md` e corpus `corpus.md` revisão 1 (cópia estruturada `src/ai-study/corpus/revision-1.json`). Não as comparo contra os checks neste round. Registro apenas que a fidelidade da cópia estruturada ao `corpus.md` é afirmada por um teste sem número de check (`tests/ai-study/s1-corpus.test.mjs:34`, hashes fixados em `:40-41` e linhas do Markdown em `:42-58`), que passou no gate abaixo.

## Checks

Proof run (uma invocação para todo o alvo):
`make check-proof TEST_FLAGS='--test-name-pattern=^C1: --test-name-pattern=^C2: ... --test-name-pattern=^C12:'` - exit 0; TAP `# tests 12 # pass 12 # fail 0 # skipped 0 # todo 0`; cada `ok N - Cn:` listado individualmente (C1–C12, todos `ok`).

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | `make ai-study-dry-run` válido imprime modo, hashes corpus/gabarito, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | `tests/ai-study/s1-commands.test.mjs:53` - `assert.equal(fixture.status, 0, ...)`; `:56-60` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `assert.equal(f['hash do gabarito'], corpus.gabaritoHash)` / `'20'` / `'24'`; `:75-76` modelos solicitados; `:79` - `assert.equal(l['destino local'], 'http://127.0.0.1:1234/v1')` (entrada com usuário/senha/query sentinela); `:70` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos, com transportes que falham se usados | `ok 2 - C2:` | `s1-commands.test.mjs:96-97` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])` (guarda de rede/processo pré-carregada nos 3 processos via make); `:112` - `assert.equal(liveFactoryCalls, 0)` (fábrica de transportes que lançam erro nunca construída na coleta fixture) | PASS |
| C3 | preparação (dry-run fixture e live) e coleta fixture invocam zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | `s1-commands.test.mjs:128` - `assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada')` (log de shims acumulado sobre as 4 execuções make); `:129` - `assert.deepEqual(last.guard.attempts.filter((a) => a.kind === 'process'), [])`; `:135-136` - `assert.doesNotMatch(source, /child_process OR worker_threads/, file)` (regex de alternância, reescrita sem barra vertical) em todo `src/ai-study/*.mjs` | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → código 2 | `ok 4 - C4:` | `s1-commands.test.mjs:145` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)` (ambos os alvos make); `:150` - `assertUsageFailure(run, /MODE/, ...)` → `:36-37` `assert.equal(run.status, 2)` + `assert.equal(run.nodeStatus ?? run.status, 2)` para `FIXTURE`, `Live`, `simulated`, `dry-run`, vazio; `:156` live aceito | PASS |
| C5 | config inválida na fronteira → 2 antes de coletar; diagnóstico nomeia a config sem segredo; tabela completa | `ok 5 - C5:` | `s1-commands.test.mjs:199-201` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` sobre a tabela `:162-194`: 4 campos live ausentes, RUN_ID vazio/65/caminho(3)/não ASCII/espaço, timeouts `0,-1,1.5,abc,'',1e2` ×2, saída `0,2049,1.5,abc,''`, argumento desconhecido `RETRY`, corpus ilegível/diretório/vazio/JSON inválido | PASS |
| C6 | corpus exato R01–R12, T01–T06 em ordem; ausente/extra/repetido rejeitado antes de coletar | `ok 11 - C6:` (gate) / filtrado `ok 10` | `tests/ai-study/s1-corpus.test.mjs:64-65` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)` / `...T_IDS`; `:27-28` - `assert.equal(run.status, 2)` + `assert.equal(run.nodeStatus, 2)` via `make ai-study-dry-run CORPUS=...` para as 8 variantes `:69-76`; `:31` - `assert.doesNotMatch(run.stdout, /hash do corpus/)` | PASS |
| C7 | cada R tem os 6 julgamentos, rótulo válido, justificativa não vazia; violações → 2 | filtrado `ok 11 - C7:` | `s1-corpus.test.mjs:84` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:86-87` rótulo ∈ {yes,no,insufficient}, `justification.trim().length > 0`; `:27-28` código 2 na fronteira para ausente/extra/duplicado/rótulo inválido/justificativa vazia/ausente/campo extra/não lista (`:93-108`) | PASS |
| C8 | todos os resultados vinculados ao mesmo hash de corpus e gabarito; alteração durante a execução impede comparação | filtrado `ok 12 - C8:` | `s1-corpus.test.mjs:133-134` - `assert.equal(result.corpus_hash, base.corpusHash)` / `assert.equal(result.gabarito_hash, base.gabaritoHash)` para todo resultado; `:138` - `assert.throws(() => assertSameReference(mixed), UsageError)`; `:163` - `error instanceof UsageError && error.exitCode === 2 && /CORPUS/`; `:167` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos `fixture` em `artifacts/ai-study/<run-id>/`, `schema_version: 1` | `ok 6 - C9:` | `s1-commands.test.mjs:230` - `assert.equal(run.status, 0, run.output)`; `:233` - `assert.match(run.stdout, new RegExp(\`artifacts/ai-study/${runId}\`))`; `:237` - `assert.equal(evidence.manifest.schema_version, 1)`; `:239-240` `mode`/`provenance` = `'fixture'`; `:247-250` cada resultado `schema_version` 1 e `provenance` `'fixture'` | PASS |
| C10 | fronteira make: live em execução fixture → 2, preservando evidências; coletor: fixture em live também rejeitado | `ok 7 - C10:` | `s1-commands.test.mjs:259` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)` (make, código do Node 2); `:262-264` - `manifest.status === 'rejected'`, `reason === 'provenance_mismatch'`, `results.map(id) == ['R01-translate-pt-en']`; `:295` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/` (transporte e resposta fixture em live); `:303` - `assert.deepEqual(readRun(...).rawResults, snapshot, 'prefixo intacto byte a byte')`; `:310` resposta live vinda de transporte fixture rejeitada no coletor | PASS |
| C11 | aceita RUN_ID 1 e 64, timeout inteiro positivo, saída 1 e 2048; limites 20/24 | `ok 8 - C11:` | `s1-commands.test.mjs:327-331` - `assert.equal(dry.status, 0)` + `assert.equal(manifest[key], value, key)` (run_id `x`/64 chars, saída `1`/`2048`, timeouts `1`/`600`) + `'20'`/`'24'`; `:335-337` - `make ai-study-run` exit 0 e `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; RUN_ID gerado; relatório exige RUN_ID; live exige URL/modelo e chave/modelo; token opcional; sem seleção parcial/retry/paralelismo | `ok 9 - C12:` | `s1-commands.test.mjs:347-351` - corpus `src/ai-study/corpus/revision-1.json (revisão 1)`, `run_id` `'gerado na coleta'`, `'120'`, `'30'`, `'2048'`; `:356` - `assert.match(generated, /^[A-Za-z0-9_-]{1,64}$/)`; `:367` - `resolveConfig('report', {})` lança `UsageError` com `/RUN_ID/`; `:374-376` 4 obrigatórios live; `:381` - `assert.equal(noToken.local.apiToken, null)`; `:385` - `assertUsageFailure(flagged, new RegExp(name))` para `CASES,ONLY,RETRY,RETRIES,PARALLEL,CONCURRENCY` via make; `:390` flags CLI | PASS |

Existência e execução: `rg -n "test\('C[0-9]+:" tests/` encontra exatamente os 12 nomes (`s1-commands.test.mjs:48,87,115,140,159,227,255,315,342`; `s1-corpus.test.mjs:62,81,113`), todos arquivos novos no diff `4a1acfe..HEAD`. Nenhum teste C13–C54 existe na árvore (`rg -n "C(1[3-9]|[2-5][0-9]):" tests/` sem resultados).

### Fronteira `make` (C1, C4–C7, C9–C10)

Todas as provas desses checks chamam `runMake` (`tests/ai-study/helpers.mjs:75-80`), que executa `make -s --no-print-directory -C <cópia> <alvo> VAR=valor` sem herdar o ambiente do teste. Exit 0 do make implica exit 0 do Node. Em falha, GNU make sai 2 sempre, e o código do Node vem de `nodeStatusFromMake` (`helpers.mjs:91-95`, regex `/\] Error (\d+)$/m`). Confirmado diretamente numa cópia em scratchpad: `make ai-study-run MODE=bogus` imprime `make: *** [Makefile:54: ai-study-run] Error 2` e sai 2; o CLI direto sai 2. C6/C7 usam `run.nodeStatus` estrito (`s1-corpus.test.mjs:28`); C4/C5/C10/C12 usam `run.nodeStatus ?? run.status` (`s1-commands.test.mjs:37`) - ver observação 2.

### Nível e amostragem

- Nível adequado: códigos de saída e comandos atravessam o make; vinculação por hash (C8) e a parte do coletor em C10 estão no nível do coletor, como a redação desses claims permite.
- Amostragem: as tabelas de C5, C6 e C7 cobrem todos os membros enumerados nos claims (e alguns além). C11 cobre as duas bordas aceitas de RUN_ID e saída.

## Swept existing re-read

As linhas `Swept` de `checks.md` não usam o marcador `existing` nem `n/a`; elas apontam para checks. Reli contra o código os membros S1 que agora resolvem para código existente:

- validation (C4–C8, C11–C12): `src/ai-study/config.mjs:84-85` (`RUN_ID_PATTERN`, `POSITIVE_INTEGER`), `:101-104` (MODE), `:120-129` (inteiros e máximo 2048), `:143-148` (obrigatórios live), `:92-98` (nomes da linha de comando); `src/ai-study/corpus.mjs:97-171` (IDs, ordem, chaves exatas, rótulos, justificativa). Presentes.
- failure modes (C10): `src/ai-study/collect.mjs:86-93` `rejectMixedProvenance`, aplicado ao transporte `:102` e à resposta `:113`. Presente.
- authorization (C2, C3, C12): `src/ai-study/cli.mjs:22-24` (fixture nunca constrói transportes live), `:14-19` (live recusado nesta entrega); nenhum `child_process` em `src/ai-study`. Presente.
- data lifecycle (C8): `collect.mjs:81-85` (`ensureCorpusUnchanged` por hash do arquivo, antes e depois de cada chamada), `:121-122` (hashes em cada resultado). Presente.
- state transitions (C9, C10): `collect.mjs:75-80`, `:137` (`completed`/`rejected`/`incomplete`). Presente.
- observability (C1): `src/ai-study/manifest.mjs:173-197`, destino via `displayUrl` (`config.mjs:180-182`, sem userinfo/query). Presente.
- idempotency, concurrency, dependency failure: nenhum membro S1.

Evidências fora do Git (Landing 1, parcialmente usado por C9): `.gitignore:1` `artifacts/` - `git check-ignore` confirma.

## Coverage

Profile `light`: recompute de Coverage não executado.

## Test policy rows

`checks.md` não tem seção `Test policy`; e o profile `light` não emite veredito sobre ela.

## Faults injected

Profile `light`: injeção de falhas não executada.

## Out of scope (not built)

C13, C14, C15, C16, C17, C18, C19, C20 (S2); C21, C22, C23, C24, C25, C26, C27, C28, C52, C53 (S3); C29, C30, C31, C32, C33, C34, C35, C36, C37, C38, C39, C40 (S4); C41, C42, C43, C44, C45, C46, C47, C48, C49, C50, C51, C54 (S5). Slices não construídas; sem testes na árvore. Não verificados e **não** contados como aprovados.

## Observations (non-blocking)

1. C10 - nível parcial: o claim diz "transporte **ou resposta** live em execução fixture" na fronteira make. Só a variante transporte atravessa o make no teste (`s1-commands.test.mjs:258-259`); a variante resposta é provada no coletor (`:306-311`). O caminho erro→código é o mesmo (`collect.mjs:113` → `cli.mjs:47-49`). Reproduzi a variante resposta numa cópia em scratchpad com pré-carga equivalente: `make ai-study-run` → `Error 2`, manifesto `rejected`/`provenance_mismatch`, prefixo `001-R01-translate-pt-en.json` preservado. Um caso de teste na fronteira fecharia o claim literalmente.
2. Robustez do teste: o fallback em `s1-commands.test.mjs:37` (`run.nodeStatus ?? run.status`) volta para o 2 do make se a linha `Error N` não for reconhecida, e o make sai 2 em qualquer falha. Hoje a linha está presente e é lida (observado acima), mas uma mudança no formato tornaria vazia a asserção do código do Node em C4/C5/C10/C12. C6/C7 já usam a forma estrita.
3. C6/C7 provam a rejeição do corpus em `make ai-study-dry-run`. `make ai-study-run` usa o mesmo `loadCorpus` antes do despacho (`cli.mjs:36`), e C5 cobre corpus ilegível/JSON inválido em `ai-study-run` com `listRuns == []`, mas variantes de IDs/rótulos não são exercitadas no alvo de coleta.
4. Runner: a forma de alternância `TEST_FLAGS='--test-name-pattern=^(C1|C2|...):'` falha no shell do recipe (`/bin/sh: Syntax error: "(" unexpected`, make `Error 2`) porque `$(TEST_FLAGS)` entra sem aspas (`Makefile:38`). Usei padrões `--test-name-pattern` repetidos (OR nativo do Node), numa só invocação.

## Gate

`make check-proof` (suíte completa, sem filtro) - exit 0; 13 passed, 0 failed, 0 skipped, 0 todo (C1–C12 mais o teste de fidelidade do corpus).
