# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: PASS
**Scope**: S1 + S2 + S3 (C1–C28, C52, C53) - slices construídas (PRB-2, PRB-3, PRB-4); C29–C51 e C54 fora de escopo (não construídos)
**Profile**: light
**Diff range**: 3985c43..4eea13b (S3, card PRB-4, PR #4); C1–C20 re-provados em HEAD
**Round**: 2 - full (S3); C1–C20 re-provados em HEAD, citações renovadas nos arquivos que a S3 tocou
**Verifier**: independent fresh session (author != verifier) - sessão nova do Claude Code no worktree `prb-4`, sem contexto da implementação nem do review

Verificado em `4eea13b`, Node v24.21.0. Árvore real somente leitura: `git status --porcelain` vazio antes e depois de todas as execuções de prova. Nenhum LM Studio, Jev ou modelo real foi chamado; só os transportes e o `fetch` controlados dos testes.

Base: `3985c43` é o merge-base com `main`. O código (`src`, `tests`, `Makefile`, `.gitignore`) de `3985c43` é idêntico ao de `166a2b9`, onde o Round 1 foi verificado: `git diff --stat 166a2b9 c2d0fb6 -- src tests Makefile .gitignore` e `git diff --stat c2d0fb6 3985c43 -- ...` são vazios. Por isso o que não mudou é `carried from 166a2b9`.

### Escopo pelo diff

`git diff --stat 3985c43..4eea13b` (4 commits: `8005951`, `368204e`, `f2acc1f`, `4eea13b`):

- Novos: `src/ai-study/jev.mjs`, `src/ai-study/comparison.mjs`, `tests/ai-study/s3-jev.test.mjs`, `tests/ai-study/support/live-services*.mjs` (5 arquivos de pré-carga).
- Alterados: `src/ai-study/collect.mjs` (+48), `cli.mjs` (live ligado aos adaptadores), `corpus.mjs` (exporta `sha256`/`isObject`), `fixture.mjs` (`type: 'choice'`), `manifest.mjs` (resumo live), `Makefile` (só o texto do `help`), `tests/ai-study/helpers.mjs` (+13: pré-cargas e `readServices`), `tests/ai-study/s1-commands.test.mjs` (só o corpo do C3), `tests/ai-study/s2-translation.test.mjs` (só a resposta do Jev controlado em `controlled()`), `.specs/STATE.md`, `checks.md`.
- Intocado: `tests/ai-study/s1-corpus.test.mjs` (`git diff --stat 3985c43..4eea13b -- tests/ai-study/s1-corpus.test.mjs` vazio).

Classificação:

- Verified at 4eea13b: C21–C28, C52, C53 (novos); C1–C5, C9–C12 (`s1-commands.test.mjs` tocado; C1/C2 sem deslocamento, C4–C12 deslocados +3); C13–C20 (`s2-translation.test.mjs` tocado; todas as linhas +12, nenhuma linha `assert` alterada - `git diff ... | grep '^[-+]' | grep -c assert` = 0); provas de todos os 30.
- Carried from 166a2b9: citações de C6–C8 (`s1-corpus.test.mjs` intocado); os julgamentos "C10: diff do setup" e "C19: mudança de expectativa em 5451bc0" do Round 1 (os testes não mudaram além do deslocamento).

## Binding sources

Passo 1 roda somente sob o profile `ui`; sob `light` não foi executado. O plano marca o [corpus](corpus.md) como fonte dos textos e gabaritos; ele foi lido para C22/C27 (o gabarito é lido do corpus estruturado pelo teste, `s3-jev.test.mjs:44-45`), mas não houve comparação formal de passo 1.

## Checks

Verified at 4eea13b (provas). Uma invocação para todo o alvo:
`make check-proof TEST_FLAGS=' --test-name-pattern=^C1: ... --test-name-pattern=^C28: --test-name-pattern=^C52: --test-name-pattern=^C53:'` - exit 0; TAP `# tests 30 # pass 30 # fail 0 # cancelled 0 # skipped 0 # todo 0`; individualmente `ok 1 - C1:` … `ok 5 - C5:`, `ok 6 - C9:`, `ok 7 - C10:`, `ok 8 - C11:`, `ok 9 - C12:`, `ok 10 - C6:`, `ok 11 - C7:`, `ok 12 - C8:`, `ok 13 - C13:` … `ok 28 - C28:`, `ok 29 - C52:`, `ok 30 - C53:`. Cada nome aparece uma vez; as únicas linhas com `skip`/`todo` no TAP são os totalizadores `# skipped 0` / `# todo 0`.

Existência: `rg -n "test\('(C[0-9]+|S3):" tests/` encontra exatamente 30 nomes C mais um teste `S3:` sem check - `s1-commands.test.mjs:51,90,118,146,165,233,261,340,367` (C1–C5, C9–C12), `s1-corpus.test.mjs:62,81,113` (C6–C8), `s2-translation.test.mjs:151,214,242,304,340,386,443,517` (C13–C20), `s3-jev.test.mjs:115,154,199,243,281,364,407,470,538,565` (C21–C28, C52, C53), `s3-jev.test.mjs:597` (`S3:` falha de `comparison.json`). Nenhum teste C29–C51 ou C54. Os testes C21–C28, C52 e C53 estão todos no diff da S3 (arquivo novo).

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | `make ai-study-dry-run` válido imprime modo, hashes corpus/gabarito, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | verified at 4eea13b (linhas inalteradas): `tests/ai-study/s1-commands.test.mjs:56` - `assert.equal(fixture.status, 0, ...)`; `:59-60` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `gabaritoHash`; `:62-63` `'20'`/`'24'`; `:78-79` modelos; `:82` - `assert.equal(l['destino local'], 'http://127.0.0.1:1234/v1')`; `:73` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos, com transportes que falham se usados | `ok 2 - C2:` | verified at 4eea13b: `s1-commands.test.mjs:99-100` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])`; `:115` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação (dry-run fixture e live) e coleta fixture invocam zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | verified at 4eea13b: `s1-commands.test.mjs:126` - `assert.equal(run.status, 0, run.output)` para os dois dry-runs e a coleta fixture; `:134` - `assert.equal(last.shimCalls, '', ...)` (log de shims cumulativo das quatro execuções do sandbox); `:135` - `assert.deepEqual(last.guard.attempts, [], 'nenhum processo nem rede')` (log da guarda cumulativo); `:141` - `assert.doesNotMatch(source, ...)` com o padrão `child_process` ou `worker_threads`, sobre todos os `src/ai-study/*.mjs`, agora incluindo `jev.mjs` e `comparison.mjs`. Parada live: `:130-132` (make 2, Node 1, `template oficial não confirmado`). Ver "Ponto 2" | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | verified at 4eea13b (+3): `s1-commands.test.mjs:151` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:156` - `assertUsageFailure(run, /MODE/, ...)` → `:38` `assert.equal(run.status, 2, ...)` + `:40` código do Node 2; `:162` live aceito | PASS |
| C5 | config inválida na fronteira → 2 antes de coletar; diagnóstico nomeia a config sem segredo; tabela completa | `ok 5 - C5:` | verified at 4eea13b (+3): `s1-commands.test.mjs:205-207` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` sobre a tabela `:168-200`; `:210-217` variantes CLI direta | PASS |
| C6 | corpus exato R01–R12, T01–T06 em ordem; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | carried from 166a2b9: `tests/ai-study/s1-corpus.test.mjs:64-65` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)` / `T_IDS`; `:27-28` - `assert.equal(run.status, 2)` + `assert.equal(run.nodeStatus, 2)` para `:69-76` | PASS |
| C7 | cada R tem os 6 julgamentos, rótulo válido, justificativa não vazia; violações → 2 | `ok 11 - C7:` | carried from 166a2b9: `s1-corpus.test.mjs:84` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:86-87`; `:27-28` para `:93-108` | PASS |
| C8 | resultados vinculados ao mesmo hash de corpus e gabarito; alteração durante a execução impede comparação | `ok 12 - C8:` | carried from 166a2b9: `s1-corpus.test.mjs:133-134` - `assert.equal(result.corpus_hash, base.corpusHash)` / `gabarito_hash`; `:167` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos `fixture` em `artifacts/ai-study/<run-id>/`, `schema_version: 1` | `ok 6 - C9:` | verified at 4eea13b (+3): `s1-commands.test.mjs:236` - `assert.equal(run.status, 0, run.output)`; `:239` - `assert.match(run.stdout, new RegExp(\`artifacts/ai-study/${runId}\`))`; `:243` - `assert.equal(evidence.manifest.schema_version, 1)`; `:245-246` `mode`/`provenance` `'fixture'`; `:253-256` por resultado | PASS |
| C10 | fronteira make: transporte ou resposta live em fixture → 2, preservando evidências; coletor: fixture em live também rejeitado | `ok 7 - C10:` | verified at 4eea13b (+3): `s1-commands.test.mjs:265` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`, `:268-270` `rejected`/`provenance_mismatch`/`['R01-translate-pt-en']`; `:276` resposta live via make, `:278-281`; coletor live `:320` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/`; `:324-325` - `reason === 'provenance_mismatch'` + `results.map(provenance) == ['live']`; `:327` transporte simulado não chamado; `:328` - prefixo intacto byte a byte. Parte make-live: C53 | PASS |
| C11 | aceita RUN_ID 1 e 64, timeout inteiro positivo, saída 1 e 2048; limites 20/24 | `ok 8 - C11:` | verified at 4eea13b (+3): `s1-commands.test.mjs:352-356` - `assert.equal(dry.status, 0)` + `assert.equal(manifest[key], value, key)` + `'20'`/`'24'`; `:360-362` - exit 0 e `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; RUN_ID gerado; relatório exige RUN_ID; live exige URL/modelo e chave/modelo; token opcional; sem seleção parcial/retry/paralelismo | `ok 9 - C12:` | verified at 4eea13b (+3): `s1-commands.test.mjs:372-376` - corpus, `'gerado na coleta'`, `'120'`, `'30'`, `'2048'`; `:381` - `assert.match(generated, /^[A-Za-z0-9_-]{1,64}$/)`; `:392` relatório sem RUN_ID lança `UsageError` `/RUN_ID/`; `:396-403` 4 obrigatórios live; `:406` - `assert.equal(noToken.local.apiToken, null, ...)`; `:410` - `assertUsageFailure(flagged, new RegExp(name), ...)`; `:415` flags CLI | PASS |
| C13 | toda tradução preparada registra original, direção, modelo solicitado e revisão do template, vinculados ao caso e à execução | `ok 13 - C13:` | verified at 4eea13b (+12): `tests/ai-study/s2-translation.test.mjs:169-173` - `assert.equal(t.run_id, 'c13')` … `assert.equal(t.template_revision, revision)`; `:200` - `assert.deepEqual(posts[index].body, { model: MODEL, prompt: renderPrompt(...), max_tokens: 2048, temperature: 0, stream: false })`; `:207` - `assert.equal(result.request.prompt, posts[index].body.prompt, ...)` | PASS |
| C14 | template oficial não confirmado → coleta `incomplete` com `template_unverified`, sem enviar tradução | `ok 14 - C14:` | verified at 4eea13b (+12): `s2-translation.test.mjs:220` - `assertIncomplete(outcome, 'template_unverified')`; `:222` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:223` sem resultados; `:239` - `assert.deepEqual(lm.calls, [])` (adaptador, zero HTTP) | PASS |
| C15 | 2048 admitido; 2049 bloqueado com `input_limit`, sem envio nem truncamento; contagem inclui o template | `ok 15 - C15:` | verified at 4eea13b (+12): `s2-translation.test.mjs:255` - `assert.equal(counted[index].request.prompt, expected)`; `:258` prompt maior que o original (template incluído); `:264` - `assertIncomplete(first, 'input_limit')`; `:265` - `assert.deepEqual(only(blocked.calls, 'translate'), [])`; `:294` bloqueio no meio preserva prefixo | PASS |
| C16 | contagem indisponível ou de tokenizer não correspondente → `token_count_unavailable`, sem envio | `ok 16 - C16:` | verified at 4eea13b (+12): `s2-translation.test.mjs:317` - `assertIncomplete(outcome, 'token_count_unavailable')` sobre as 6 variantes; `:321` justificativa; `:333` adaptador real `token_count_unavailable` | PASS |
| C17 | saída persistida literalmente como derivação identificada, preservando original e vínculo; braço inglês usa a derivação | `ok 17 - C17:` | verified at 4eea13b (+12): `s2-translation.test.mjs:354` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:366` braço PT usa o original; `:368` - `assert.equal(enResult.derived_from, \`${c.id}-translate-pt-en\`)`; `:380-381` adaptador: `derived_text` e `response.output` literais; `:383` braço EN recebe esse texto | PASS |
| C18 | vazia, só espaços ou término por limite → `invalid_translation`, sem Jev do braço inglês | `ok 18 - C18:` | verified at 4eea13b (+12): `s2-translation.test.mjs:406` - `assert.equal(byCase[caseId].status, 'invalid_translation', caseId)`; `:414` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)` | PASS |
| C19 | registro contém duração em ms e modelo/tokens/memória do runtime; cada informação não fornecida recebe indicação e justificativa; sem usar download como VRAM | `ok 19 - C19:` | verified at 4eea13b (+12): `s2-translation.test.mjs:460` - `assert.ok(Number.isInteger(duration) && duration >= 25, ...)`; `:463` modelo fornecido; `:467-468` tokens/memória `available === false`; `:472-473` - `/download/` e `/VRAM/`; `:484` - `assertIncomplete(missing, 'model_mismatch')` (modelo não fornecido); `:491` duração do bloqueio; `:500` adaptador | PASS |
| C20 | registra identidade solicitada e retornada do Q6_K; indisponível/incompatível não seleciona outro modelo, não instala runtime, não baixa pesos | `ok 20 - C20:` | verified at 4eea13b (+12): `s2-translation.test.mjs:531` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:537-543` cada pedido HTTP; `:556-557` - `assertIncomplete(outcome, reason)` + `assert.deepEqual(lm.calls.map(...), [\`GET ${modelPath}\`], ...)`; `:560`, `:572` sem resultados; `:601` troca de modelo no 3º POST | PASS |
| C21 | adaptador Jev envia exatamente os seis julgamentos como perguntas `Choice` independentes na mesma chamada, com critérios `yes`/`no`/`insufficient` | `ok 21 - C21:` | verified at 4eea13b: `tests/ai-study/s3-jev.test.mjs:122` - `assert.equal(jevCalls.length, 24, 'uma chamada por braço: 12 casos × 2 braços')`; `:126-130` método, URL oficial, `authorization`, `content-type`, cabeçalhos exatos; `:131` - `assert.deepEqual(Object.keys(call.body), ['state', 'model', 'questions'], 'corpo completo')`; `:133` - `assert.deepEqual(Object.keys(call.body.questions), [...JUDGMENT_IDS], ...)`; `:137-138` - `question.type === 'choice'` + `assert.deepEqual(Object.keys(question.criteria), ['yes', 'no', 'insufficient'], id)`; `:143-146` nenhuma instrução cita outro julgamento; `:149-150` - pedido persistido `deepEqual` ao corpo e `JSON.stringify(...) === call.rawBody` | PASS |
| C22 | payloads completos para tradução e Jev sem gabaritos, justificativas de referência ou revisões humanas; sentinelas ausentes | `ok 22 - C22:` | verified at 4eea13b: `s3-jev.test.mjs:159-171` corpus com rótulos rotacionados e sentinelas em justificativas/títulos/invariantes; `:174-177` revisão humana sentinela no diretório de evidências; `:183-184` 18 POST locais e 24 Jev; `:186` gabaritos diferentes; `:189` - `assert.ok(!payload.includes(SENTINEL), ...)` sobre método+URL+corpo bruto de todas as chamadas; `:191` - `assert.deepEqual(sent(alt), sent(base))` (byte a byte iguais com gabaritos diferentes); `:194-195` chaves exatas do pedido persistido | PASS |
| C23 | par com instruções em inglês, rubricas, IDs, critérios e modelo Jev iguais; só original vs tradução varia; IDs/etapas fora do texto traduzido | `ok 23 - C23:` | verified at 4eea13b: `s3-jev.test.mjs:209-210` - `assert.deepEqual(body.questions, reference.questions, ...)` + modelo em todas as chamadas; `:215-220` por caso, perguntas, IDs, modelo, hashes de instruções/critérios e modelo retornado iguais entre PT e EN; `:222-224` - `pt.state === caseText(c)`, `en.state === translated`, diferentes; `:226-227` IDs de caso/item/julgamento fora dos dois estados; `:232-233` nenhum ID `[RT]\d{2}` nem julgamento no prompt de tradução; `:237-239` instruções em inglês, sem perguntas do corpus nem acentuação | PASS |
| C24 | R01 PT antes de EN, R02 EN antes de PT, alternância até R12, caso e braço preservados | `ok 24 - C24:` | verified at 4eea13b: `s3-jev.test.mjs:37` ordem esperada; `:248-250` `R01,pt` / `R02,en` / `R12,pt`; `:260` 12 traduções distintas (o estado identifica o braço); `:261` - `assert.deepEqual(sentOrder, expectedOrder)` (ordem HTTP real); `:263` - `assert.deepEqual(persisted, expectedOrder)`; `:265-267` caso/braço/ID em cada resultado | PASS |
| C25 | validação só aceita seis IDs únicos `choice`, escolha no domínio, três probabilidades finitas em [0,1] com soma a ≤0,000001 de 1 e confiança finita em [0,1]; violação → `invalid_response` sem inferir escolha | `ok 25 - C25:` | verified at 4eea13b: aceitos `s3-jev.test.mjs:292` - `assert.deepEqual(validateEvaluation(results), [], label)` sobre `:283-290`; rejeitados `:326-327` - `assert.ok(problems.length > 0, label)` + `assert.match(problems.join('\n'), pattern, label)` sobre `:295-322`; coletor com adaptador real `:343-346` - `IncompleteError`, código 1, `incomplete`/`invalid_response`; `:349-350` - `status === 'invalid_response'` e `results === null` (nenhuma escolha inferida); `:352` braço anterior preservado; `:356-358` par fora do denominador. Todas as linhas da tabela em "Tabelas de decisão" | PASS |
| C26 | avaliação persistida identifica execução, caso, braço, escolha, distribuição, confiança, modelo retornado, uso e duração; uso ausente identificado, não zero | `ok 26 - C26:` | verified at 4eea13b: `s3-jev.test.mjs:380-385` `run_id`, `case_id`, `requested_model`, `returned_model` (retornado ≠ solicitado), `valid`; `:389-391` escolha, `deepEqual` das probabilidades, confiança 0.42; `:393` - `assert.ok(Number.isInteger(e.duration_ms) && e.duration_ms >= 25, ...)` (atraso 30 ms); `:395` braços `['pt', 'en']`; `:396` - `assert.deepEqual(first.evaluation.usage, { available: true, value: usage })`; `:398-401` uso ausente `available === false`, sem `value`, `/não é custo zero/`, sem `:0` | PASS |
| C27 | escolha válida = gabarito → acerto; ≠ → erro; sem escolha válida → ausência; `insufficient` é escolha | `ok 27 - C27:` | verified at 4eea13b: `s3-jev.test.mjs:418` - `assert.equal(compareChoice(choice, expected), outcome, ...)` sobre `:409-416`; `:420-421` resposta inválida e braço não executado → todos `absent`; coleta `:437` - PT `{ hit: 12, miss: 0, absent: 0 }`; `:438-442` - EN sempre `insufficient` → `{ hit: insufficientExpected, miss: 12 - insufficientExpected, absent: 0 }`; `:446-449` R08 EN por julgamento | PASS |
| C28 | par sem braço válido ou com divergência de corpus/gabarito, instruções, critérios ou versão Jev → incompleto, fora do denominador; individual visível | `ok 28 - C28:` | verified at 4eea13b: `s3-jev.test.mjs:493-494` - `assert.deepEqual(pair.reasons, reasons, label)` + status; `:496` - `assert.equal(comparison.counts.paired.denominator, reasons.length === 0 ? 1 : 0, ...)`; `:500` resultado visível; `:503` válido contado no individual (6), sobre a tabela `:475-487`; `:489-490` os hashes divergentes de fato diferem; coleta `:525` R01 `['incomplete', ['en_missing'], ...]`; `:527` R02 `jev_model_mismatch`; `:528` denominador 10; `:532` resultados individuais visíveis; `:534` R01 EN ausente | PASS |
| C52 | `make ai-study-run MODE=live` com LM Studio e Jev controlados invoca zero Codex/Claude/Grok/agy/Cloak | `ok 29 - C52:` | verified at 4eea13b: `s3-jev.test.mjs:540-544` `runMake('ai-study-run', MODE=live, ...)` com pré-carga `liveServices`; `:545` - `assert.equal(run.status, 0, run.output)`; `:550` - 42 resultados (18 traduções e 24 avaliações, ou seja, o caminho live inteiro executou); `:554` - `assert.equal(run.shimCalls, '', 'nenhuma CLI excluída executada')`; `:555` - `assert.deepEqual(run.guard.attempts, [], 'nenhum processo nem socket')`; `:559` só destinos configurados. Ver "Ponto 1" | PASS |
| C53 | na fronteira `make ai-study-run MODE=live` com serviços controlados, transporte ou resposta fixture → 2, preservando evidências anteriores | `ok 30 - C53:` | verified at 4eea13b: `s3-jev.test.mjs:577-578` - `assert.equal(run.status, 2, ...)` + `assert.equal(run.nodeStatus, 2, ...)` para transporte e resposta; `:579` - `/proveniência "fixture" incompatível com MODE=live em R01-evaluate-pt/`; `:581-582` `rejected`/`provenance_mismatch`; `:584` - prefixo `[['R01-translate-pt-en', 'live']]`; `:587` Jev chamado 0 vez (transporte) / 1 vez (resposta); `:592-593` - execução anterior intacta byte a byte (`rawResults` e manifesto). Ver "Ponto 1" | PASS |

### Tabelas de decisão (todas as linhas)

Verified at 4eea13b. Exigência de `checks.md`: "C25, C27 e C28 devem cobrir cada linha das suas tabelas de decisão, além do caminho de integração."

**C25 - aceitos** (`s3-jev.test.mjs:292`, cada linha deve resultar em `[]`):

| Linha | Entrada | Local |
| --- | --- | --- |
| válido | seis `yes` 0.8/0.1/0.1, confiança 0.6 | `s3-jev.test.mjs:283` |
| probabilidade 0 e 1 | `{ yes: 1, no: 0, insufficient: 0 }` | `s3-jev.test.mjs:284` |
| soma a menos de 0,000001 | distância 5e-7 | `s3-jev.test.mjs:285` |
| soma a exatamente 0,000001 acima | `0.250001` | `s3-jev.test.mjs:286` |
| soma a exatamente 0,000001 abaixo | `0.249999` | `s3-jev.test.mjs:287` |
| confiança 0 | `0` | `s3-jev.test.mjs:288` |
| confiança 1 | `1` | `s3-jev.test.mjs:289` |
| escolha `insufficient` | `insufficient` | `s3-jev.test.mjs:290` |

**C25 - rejeitados** (`s3-jev.test.mjs:326-327`, problema não vazio e mensagem específica):

| Linha | Membro do Coverage | Local |
| --- | --- | --- |
| lista ausente | resposta sem resultados | `s3-jev.test.mjs:295` |
| resultado não objeto | resultado inválido | `s3-jev.test.mjs:296` |
| resultado em texto | sem inferir de prosa | `s3-jev.test.mjs:297` |
| ID ausente | ID ausente | `s3-jev.test.mjs:298` |
| ID extra | ID extra | `s3-jev.test.mjs:299` |
| ID repetido | ID repetido | `s3-jev.test.mjs:300` |
| tipo `score` | tipo não choice | `s3-jev.test.mjs:301` |
| tipo ausente | tipo não choice | `s3-jev.test.mjs:302` |
| escolha `maybe` | escolha fora do domínio | `s3-jev.test.mjs:303` |
| escolha `Yes` | escolha fora do domínio | `s3-jev.test.mjs:304` |
| escolha em prosa | sem inferir de prosa | `s3-jev.test.mjs:305` |
| escolha ausente com prosa em `text` | sem inferir de prosa | `s3-jev.test.mjs:306` |
| probabilidades ausentes | probabilidade ausente | `s3-jev.test.mjs:307` |
| uma probabilidade ausente | probabilidade ausente | `s3-jev.test.mjs:308` |
| probabilidade extra | (além do claim) | `s3-jev.test.mjs:309` |
| probabilidade NaN | não finita / borda NaN | `s3-jev.test.mjs:310` |
| probabilidade infinita | não finita / borda infinito | `s3-jev.test.mjs:311` |
| probabilidade em texto | não numérica | `s3-jev.test.mjs:312` |
| probabilidade abaixo de 0 | fora de [0,1] / borda abaixo de 0 | `s3-jev.test.mjs:313` |
| probabilidade acima de 1 | fora de [0,1] / borda acima de 1 | `s3-jev.test.mjs:314` |
| soma acima da tolerância | distância 1,1e-6 > 0,000001 | `s3-jev.test.mjs:315` |
| soma abaixo da tolerância | distância 1,1e-6 > 0,000001 | `s3-jev.test.mjs:316` |
| confiança ausente | confiança inválida | `s3-jev.test.mjs:317` |
| confiança abaixo de 0 | borda abaixo de 0 | `s3-jev.test.mjs:318` |
| confiança acima de 1 | borda acima de 1 | `s3-jev.test.mjs:319` |
| confiança NaN | borda NaN | `s3-jev.test.mjs:320` |
| confiança infinita | borda infinito | `s3-jev.test.mjs:321` |
| confiança em texto | não numérica | `s3-jev.test.mjs:322` |

**C25 - pelo adaptador e coletor** (`s3-jev.test.mjs:343-360`, cada um como 2ª resposta, R01 EN): ID ausente (`:333`), prosa sem `choice` (`:334`), corpo sem `answers` (`:335`), corpo não JSON (`:336`), soma fora (`:337`).

**C27** (`s3-jev.test.mjs:418`):

| Linha | Escolha × gabarito | Resultado | Local |
| --- | --- | --- | --- |
| 1 | `yes` × `yes` | hit | `s3-jev.test.mjs:409` |
| 2 | `no` × `no` | hit | `s3-jev.test.mjs:410` |
| 3 | `insufficient` × `insufficient` | hit | `s3-jev.test.mjs:411` |
| 4 | `no` × `yes` | miss | `s3-jev.test.mjs:412` |
| 5 | `yes` × `insufficient` | miss | `s3-jev.test.mjs:413` |
| 6 | `insufficient` × `no` | miss | `s3-jev.test.mjs:414` |
| 7 | `null` × `yes` | absent | `s3-jev.test.mjs:415` |
| 8 | `undefined` × `insufficient` | absent | `s3-jev.test.mjs:416` |
| 9 | resposta `invalid_response` | todos absent | `s3-jev.test.mjs:420` |
| 10 | braço não executado | todos absent | `s3-jev.test.mjs:421` |
| coleta | PT = gabarito; EN sempre `insufficient` | contagens por julgamento e braço | `s3-jev.test.mjs:437-449` |

**C28** (`s3-jev.test.mjs:493-503`):

| Linha | Motivos esperados | Local |
| --- | --- | --- |
| par completo | `[]`, denominador 1 | `s3-jev.test.mjs:475` |
| braço PT ausente | `pt_missing` | `s3-jev.test.mjs:476` |
| braço EN ausente | `en_missing` | `s3-jev.test.mjs:477` |
| dois braços ausentes | `pt_missing`, `en_missing` | `s3-jev.test.mjs:478` |
| braço EN inválido | `en_invalid` | `s3-jev.test.mjs:479` |
| braço PT inválido | `pt_invalid` | `s3-jev.test.mjs:480` |
| corpus divergente | `reference_mismatch` | `s3-jev.test.mjs:481` |
| gabarito divergente | `reference_mismatch` | `s3-jev.test.mjs:482` |
| instruções divergentes | `instructions_mismatch` | `s3-jev.test.mjs:483` |
| critérios divergentes | `criteria_mismatch` | `s3-jev.test.mjs:484` |
| versão Jev divergente | `jev_model_mismatch` | `s3-jev.test.mjs:485` |
| versão Jev PT não identificada | `jev_model_unknown` | `s3-jev.test.mjs:486` |
| versão Jev EN não identificada | `jev_model_unknown` | `s3-jev.test.mjs:487` |
| coleta: R01 sem tradução válida, R02 com versão EN diferente | `en_missing`, `jev_model_mismatch`, denominador 10 | `s3-jev.test.mjs:525-534` |

Os seis membros de "Par incompleto (6)" em `checks.md` (braço ausente, braço inválido, corpus/gabarito, instruções, critérios, versão Jev) têm linha. Os de "Resposta Jev inválida (10)", "Bordas de probabilidade/confiança (6)", "Tolerância da soma (3 edges)" e "Comparação individual (3)" também. Isto é leitura das linhas contra o Coverage, não o recompute do profile `standard`.

### Ponto 1 - pré-carga `live-services-hooks.mjs` em C52 e C53

Verified at 4eea13b. **Veredito: a substituição não invalida as provas de C52 e C53. Aceitável, com duas condições para quando as Decisões 1 e 2 do STATE.md forem implementadas.**

O que a pré-carga substitui (`tests/ai-study/support/live-services-hooks.mjs:17-31`):

- `TRANSLATION_TEMPLATE` passa a ter `official: true`. O resto do objeto continua o real (`{ ...REAL, official: true, ... }`), então o prompt renderizado e a revisão do template são os de produção.
- `countTokens` do adaptador LM Studio passa a devolver `{ count: 100, tokenizer: config.local.model }`. As demais funções (`inspect`, `translate`) continuam as reais, falando com o `fetch` controlado de `live-services-fetch.mjs`.
- Só no C53, `createJevTransport` é embrulhado para declarar `fixture` no transporte ou na resposta. Essa troca é o próprio cenário do claim, e a bancada não tem outra forma de injetar proveniência fixture no live. É o mesmo mecanismo aceito no Round 1 para C10.

Por que a prova continua válida:

1. **O que foi trocado não faz I/O nem cria processo na versão real.** O `countTokens` real é uma constante (`src/ai-study/lmstudio.mjs:37-39`, `return { count: null, ... }`), e `official` é um dado (`src/ai-study/template.mjs:14`). Trocar esses dois pontos não esconde nenhum caminho que pudesse invocar uma CLI. Além disso, o C3 faz uma varredura estática de todos os `src/ai-study/*.mjs`, sem pré-carga (`s1-commands.test.mjs:141`). Ela cobre os arquivos reais `template.mjs` e `lmstudio.mjs` contra `child_process`/`worker_threads` e contra os nomes das CLIs.
2. **Nenhum dos dois pontos trocados é o objeto dos claims.** Template e contagem são as duas barreiras que a S2 põe antes da primeira chamada (AC 12 e AC 14, provadas em C14 e C16 com o código real). Sem a troca, o live para antes de qualquer chamada: o C3 mostra isso pela fronteira `make` (`s1-commands.test.mjs:130-132`). Nesse caso C52 não exercitaria nada e C53 não chegaria ao Jev. O que C52 afirma (zero processos excluídos durante a coleta live) e o que C53 afirma (rejeição por proveniência na fronteira live) é exercitado por código de produto não substituído: `cli.mjs` → `selectTransports` → `runCollection` → adaptadores reais → `rejectMixedProvenance` (`src/ai-study/collect.mjs:132`, aplicado em `:191` e `:224`).
3. **A guarda continua ativa no processo do `make`.** `NODE_OPTIONS` carrega `guard.mjs` antes das pré-cargas (`tests/ai-study/helpers.mjs:67`). A pré-carga só substitui `globalThis.fetch`. Criação de processo, `net`, `tls`, `http`, `https`, `dgram` e `dns` seguem bloqueados e registrados. O C52 afirma `guard.attempts` vazio (`s3-jev.test.mjs:555`) depois de 42 itens executados (`:550`).
4. **Está declarado.** Linhas Status de C52/C53 em `checks.md` e `.specs/STATE.md` (Handoff, S3).

Condições (não bloqueiam este round):

- (a) Quando a Decisão 2 trouxer um `countTokens` real (via `@lmstudio/sdk`), a pré-carga deixará de ser inofensiva: ela substituiria código que faz I/O, e C52 deixaria de exercitá-lo. Nesse momento C52 precisa ser re-provado sem substituir `countTokens`, controlando só o transporte. A guarda também não intercepta `globalThis.WebSocket` (`rg -n "WebSocket|undici" tests/ai-study/support/guard.mjs` vazio), que é como o SDK costuma falar com o LM Studio.
- (b) Quando a Decisão 1 adotar o template oficial (`official: true` no produto), a troca de `TRANSLATION_TEMPLATE` deve sair da pré-carga.

Não fiz uma sonda de mutação em cópia para confirmar o mascaramento: a execução foi negada nesta sessão, e o profile `light` não exige injeção de falhas. O julgamento acima vem da leitura do código.

### Ponto 2 - C3 alterado na S3

Verified at 4eea13b. **Veredito: a afirmação de C3 continua provada e não foi enfraquecida.**

O diff (`git diff 3985c43..4eea13b -- tests/ai-study/s1-commands.test.mjs`) só toca o corpo do C3:

- **Removido:** `assertUsageFailure(last, /coleta live ainda não está disponível/, 'run live')`, `assert.deepEqual(listRuns(sandbox), ['c3-fixture'])` e o filtro `guard.attempts.filter((a) => a.kind === 'process')`.
- **Acrescentado:** `RUN_ID: 'c3-live'` na 4ª execução. Também as asserções `last.status === 2`, `last.nodeStatus === 1`, stderr `/template oficial não confirmado/` e `listRuns == ['c3-fixture', 'c3-live']` (`:130-133`), e a asserção `guard.attempts` inteiro `[]` (`:135`).

O claim de C3 cobre a preparação (dry-run fixture e live) e a coleta fixture. A coleta live foi movida para C52 por decisão do usuário (30/09/2026). As asserções que provam o claim continuam iguais:

- `run.status === 0` dos três primeiros comandos (`:126`).
- Log de shims vazio (`:134`). O log é por sandbox e cumulativo (`helpers.mjs:43`, `:79`), então cobre as quatro execuções.
- Varredura estática (`:141-142`).

A asserção da guarda ficou mais forte: antes só processos, agora qualquer tentativa, inclusive de rede. As linhas removidas tratavam da recusa do live por adaptador ausente, um comportamento que a S3 eliminou de propósito. Elas não faziam parte do claim. A parada em `template_unverified` com zero processos e zero rede é afirmada no lugar. A alteração foi aceita pelo usuário (`.specs/STATE.md`, Escolhas da S3, item 4).

### Ponto 3 - `checks.md` editado na S3

Verified at 4eea13b. **Veredito: nenhum claim, proof, linha de Coverage ou Swept foi alterado.**

O diff (`git diff 3985c43..4eea13b -- .specs/features/jev-translation-feasibility/checks.md`) tem exatamente:

- uma linha alterada: o parágrafo `Status:` do topo, que acrescenta "S3 implementada ... C29–C51 e C54 pendentes";
- dez linhas `Status:` acrescentadas, uma para cada C21–C28, C52 e C53;
- uma linha acrescentada após o Status do C25: "Leitura aceita pelo usuário em 01/10/2026 (review do PR #4): ≤0,000001, com folga de 1e-12 só para arredondamento de ponto flutuante."

Nenhuma linha removida além do parágrafo de status substituído. O texto do claim do C25 continua "≤0,000001". A nota é uma leitura de precisão aceita pelo usuário (STATE.md, Escolhas da S3, item 2) e corresponde ao código (`src/ai-study/jev.mjs:64-65`, `:98`). Ver observação 2.

### Fronteira e nível

Verified at 4eea13b.

- **Claims de fronteira de comando** (lista de `checks.md`: C1, C4–C7, C9–C10, C30, C34, C41, C52–C54). C52 e C53 atravessam `make ai-study-run MODE=live` (`helpers.mjs:83-88`, `spawnSync('make', ...)`). O C53 também confere o código do Node pela linha `Error 2` (`s3-jev.test.mjs:578`). Atendido. C1, C4–C7, C9 e C10: carried from 166a2b9; as provas não mudaram além do deslocamento.
- **Adaptadores: pedido completo e resultado persistido.** O C21 afirma o pedido HTTP completo do Jev: método, URL, cabeçalhos exatos, chaves do corpo, cada pergunta. Afirma também o pedido persistido igual ao corpo bruto enviado (`:149-150`). O C22 compara os payloads brutos de todas as chamadas, tradução e Jev (`:188-191`). O C25 percorre o adaptador real com cinco respostas HTTP inválidas e afirma o registro persistido (`:343-360`). O C26 afirma o registro persistido. Atendido.
- C21–C27 usam `runCollection` com os adaptadores reais e `fetch` controlado. Template confirmado e `countTokens` controlado entram por parâmetro (`s3-jev.test.mjs:38`, `:86-91`). Nenhum desses checks está na lista de fronteira de comando.
- As linhas "instruções/critérios divergentes" do C28 só são provadas em `pairCase`/`buildComparison` (`:483-484`). Na coleta, a rubrica é constante e esses casos não ocorrem. Isso é aceitável porque C28 não é claim de fronteira e o caminho de integração do C28 é exercitado em `:508-535`.

## Swept existing re-read

Verified at 4eea13b. `checks.md` não tem linhas `Swept` marcadas como existentes. As restrições existentes citadas antes continuam presentes:

- `rejectMixedProvenance` em `src/ai-study/collect.mjs:132`, aplicado à identidade (`:160`, `:164`), ao transporte (`:191`) e à resposta (`:224`);
- a parada `template_unverified` em `collect.mjs:158`;
- `.gitignore:1` com `artifacts/`, inalterado.

## Coverage

Profile `light`: o recompute de Coverage não foi executado. Os membros das linhas de S3 foram lidos contra as asserções em "Tabelas de decisão". Isso é leitura, não recompute.

## Test policy rows

`checks.md` não tem seção `Test policy`; o profile `light` não emite veredito sobre ela.

## Faults injected

Profile `light`: a injeção de falhas não é exigida e não foi feita. Uma sonda em cópias `git archive HEAD` no scratchpad foi proposta para testar o Ponto 1 e negada pela permissão da sessão, então não rodou. A árvore real não foi alterada.

## Out of scope (not built)

C29, C30, C31, C32, C33, C34, C35, C36, C37, C38, C39, C40 (S4); C41, C42, C43, C44, C45, C46, C47, C48, C49, C50, C51, C54 (S5). São slices não construídas. Não há testes delas na árvore. C51 depende de serviços reais e não pode ser substituído por fixture. Esses checks não foram verificados e **não** contam como aprovados.

## Observations (non-blocking)

Verified at 4eea13b, salvo indicação.

1. **Pré-carga de C52/C53.** Vale enquanto `countTokens` for constante e o template versionado não for o oficial. Ver Ponto 1, condições (a) e (b). A guarda não cobre `globalThis.WebSocket` (`tests/ai-study/support/guard.mjs`).
2. **Precisão do C25.** O código aceita distância até 0,000001 + 1e-12 (`src/ai-study/jev.mjs:98`), não estritamente ≤0,000001. A leitura foi aceita pelo usuário e registrada em `checks.md`. Não há linha de teste entre 1e-6 e 1e-6 + 1e-12, e ela não seria representável de forma útil.
3. **Resposta Jev inválida encerra a coleta.** Ela termina `incomplete` com código 1 (`collect.mjs:280`), o que antecipa AC 29. A decisão é do usuário (STATE.md, item 4), e C34 (S4) continua sendo a prova.
4. **Falha ao gravar `comparison.json`.** Ela troca o motivo original por `internal_error` (`collect.mjs`, `finish`). A pendência está registrada para a S4 no STATE.md. O teste `S3:` (`s3-jev.test.mjs:597`) não tem check associado.
5. **Rubrica em inglês sem revisão humana.** `JEV_RUBRIC` (`src/ai-study/jev.mjs:10-41`) ainda não foi revisada, e os critérios `yes`/`no` são texto novo. A revisão é condição de entrada da S5/C51 (STATE.md).
6. **Identidade do Jev.** Se `POST /v1/systemone` não devolver `model`, todo par fica `jev_model_unknown` (`src/ai-study/comparison.mjs:42`) e o denominador pareado será 0. A confirmação na documentação é condição de entrada da S5 (STATE.md).
7. (Carried from 166a2b9) A coleta live real continua bloqueada: o template tem `official: false` e a contagem é indisponível (`src/ai-study/template.mjs:14`, `src/ai-study/lmstudio.mjs:37-39`). O `GET` de identidade e as verificações de template ainda não contam no limite de 20 chamadas, que é obrigação de C31. O texto de uma resposta rejeitada por `model_mismatch` não é guardado. Também continuam válidas as observações 5 e 6 do Round 1: C6/C7 só na fronteira dry-run, e `check-proof` quebra com parênteses em `TEST_FLAGS`, por isso usei `--test-name-pattern` repetido.

## Round 1 history (S1 + S2, C1–C20)

Carried from 166a2b9. O Round 1 (verificador independente, profile `light`, range `dba3999..166a2b9`, veredito PASS) provou C1–C20 com citações em `166a2b9`. O relatório completo está em `git show 4eea13b:.specs/features/jev-translation-feasibility/verification.md`. Os julgamentos que este round carrega sem refazer, porque os testes só se deslocaram:

- **C10, diff do setup:** a S2 só acrescentou setup (template confirmado, `inspect`/`countTokens`, modelo do candidato). Nenhuma asserção mudou. As asserções estão em `s1-commands.test.mjs:320-328` em 4eea13b.
- **C19, mudança de expectativa em 5451bc0:** "modelo não fornecido" passou a ser afirmado em `manifest.blocked.runtime` porque a resposta sem `model` bloqueia com `model_mismatch` (C20). As asserções são as mesmas três, mais a duração, em `s2-translation.test.mjs:484-491`. A prova não foi enfraquecida. Na época, sondas em cópia mataram dois mutantes.
- **Adaptador LM Studio:** o pedido HTTP completo é afirmado em C13 e C20 (`s2-translation.test.mjs:200`, `:537-543`). Em C17–C19 o pedido é conferido de forma implícita pela rota controlada.

## Gate

Verified at 4eea13b. `make check-proof` (suíte completa, sem filtro): exit 0; 32 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo (C1–C28, C52, C53, o teste de fidelidade do corpus e o teste `S3:` de `comparison.json`).
