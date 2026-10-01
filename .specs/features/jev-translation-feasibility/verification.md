# Viabilidade da tradução local e das avaliações do Jev verification

**Verdict**: PASS
**Scope**: S1 + S2 (C1–C20) - slices construídas (PRB-2, PRB-3); C21–C54 fora de escopo (não construídos)
**Profile**: light
**Diff range**: dba3999..166a2b9 (S2, card PRB-3); S1 re-provada em HEAD
**Round**: 1 - full (S2); S1 com provas re-executadas em HEAD
**Verifier**: independent sub-agent (author != verifier)

Verificado em `166a2b921f0cd2aa86442dc1c4f3b9246a3f7020`, Node v24.21.0. Árvore real somente leitura: `git status --porcelain` vazio antes da verificação. Experimentos feitos só em cópias `git archive HEAD` no scratchpad.

Base: `dba3999` é o squash-merge da S1 em `main`; seu código é idêntico a `1ac00cd` (último commit verificado da S1) - `git diff --stat 1ac00cd dba3999` toca só este relatório. Por isso as citações de arquivos que a S2 não tocou são `carried from 1ac00cd`.

### Escopo pelo diff

`git diff --stat dba3999..HEAD`: `src/ai-study/cli.mjs` (só o texto de `unavailableLive`), `src/ai-study/collect.mjs` (+140/-14), novos `src/ai-study/lmstudio.mjs`, `template.mjs`, `translation.mjs`, novo `tests/ai-study/s2-translation.test.mjs`, `tests/ai-study/s1-commands.test.mjs` (+15/-4, setup do C10), `.specs/STATE.md` e `checks.md` (só linhas `Status:` de C13–C20 e o parágrafo de status; nenhum claim ou proof alterado - conferido no diff).

- Verified at 166a2b9: C13–C20 (novos); C1–C5, C9–C12 (arquivo `s1-commands.test.mjs` tocado, citações renovadas); provas de todos os 20.
- Carried from 1ac00cd: citações de C6–C8 (`tests/ai-study/s1-corpus.test.mjs` e `tests/ai-study/helpers.mjs` intocados no range).

## Binding sources

Passo 1 roda somente sob o profile `ui`; sob `light` não foi executado. Nenhuma fonte binding foi aberta.

## Checks

Verified at 166a2b9 (provas). Uma invocação para todo o alvo:
`make check-proof TEST_FLAGS=' --test-name-pattern=^C1: ... --test-name-pattern=^C20:'` - exit 0; TAP `# tests 20 # pass 20 # fail 0 # cancelled 0 # skipped 0 # todo 0`; individualmente `ok 1 - C1:` ... `ok 5 - C5:`, `ok 6 - C9:`, `ok 7 - C10:`, `ok 8 - C11:`, `ok 9 - C12:`, `ok 10 - C6:`, `ok 11 - C7:`, `ok 12 - C8:`, `ok 13 - C13:` ... `ok 20 - C20:` (cada nome aparece uma vez, sem SKIP/TODO).

Existência: `rg -n "test\('C[0-9]+:" tests/` encontra exatamente 20 nomes - `s1-commands.test.mjs:51,90,118,143,162,230,258,337,364` (C1–C5, C9–C12), `s1-corpus.test.mjs:62,81,113` (C6–C8), `s2-translation.test.mjs:139,202,230,292,328,374,431,505` (C13–C20). Nenhum teste C21–C54 (`rg -n "C(2[1-9]|[3-5][0-9]):" tests/` vazio). Os testes C13–C20 são todos do diff da S2 (arquivo novo em `632e363`).

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | `make ai-study-dry-run` válido imprime modo, hashes corpus/gabarito, modelos, limites 20/24, destinos sem credenciais | `ok 1 - C1:` (exit 0) | verified at 166a2b9 (linhas +1): `tests/ai-study/s1-commands.test.mjs:56` - `assert.equal(fixture.status, 0, ...)`; `:59-60` - `assert.equal(f['hash do corpus'], corpus.corpusHash)` / `gabaritoHash`; `:62-63` `'20'`/`'24'`; `:78-79` modelos; `:82` - `assert.equal(l['destino local'], 'http://127.0.0.1:1234/v1')`; `:73` - `assertNoSecret(live)` | PASS |
| C2 | dry-run nos dois modos e coleta fixture: zero rede e zero modelos, com transportes que falham se usados | `ok 2 - C2:` | verified at 166a2b9: `s1-commands.test.mjs:99-100` - `assert.equal(guard.loaded, 3, ...)` + `assert.deepEqual(guard.attempts, [])`; `:115` - `assert.equal(liveFactoryCalls, 0)` | PASS |
| C3 | preparação (dry-run fixture e live) e coleta fixture invocam zero Codex/Claude/Grok/agy/Cloak | `ok 3 - C3:` | verified at 166a2b9: `s1-commands.test.mjs:131` - `assert.equal(last.shimCalls, '', 'nenhuma CLI excluída executada')`; `:132` - `guard.attempts.filter(kind === 'process')` vazio; `:138` - `assert.doesNotMatch(source, /child_process OR worker_threads/, file)` agora também sobre `lmstudio.mjs`, `template.mjs`, `translation.mjs`; `:129` `assertUsageFailure(last, /coleta live ainda não está disponível/, ...)` continua casando a mensagem nova de `src/ai-study/cli.mjs:16` | PASS |
| C4 | só `fixture`/`live`; `fixture` por omissão; outro modo → 2 | `ok 4 - C4:` | verified at 166a2b9: `s1-commands.test.mjs:148` - `assert.match(omitted.stdout, /^modo: fixture$/m, target)`; `:153` - `assertUsageFailure(run, /MODE/, ...)` → `:38` `assert.equal(run.status, 2, ...)` + `:40` código do Node 2; `:159` live aceito | PASS |
| C5 | config inválida na fronteira → 2 antes de coletar; diagnóstico nomeia a config sem segredo; tabela completa | `ok 5 - C5:` | verified at 166a2b9: `s1-commands.test.mjs:202-204` - `assertUsageFailure(run, pattern, label)` + `assertNoSecret(run)` + `assert.deepEqual(listRuns(sandbox), [], ...)` sobre a tabela `:165-197`; `:207-214` variantes CLI direta | PASS |
| C6 | corpus exato R01–R12, T01–T06 em ordem; ausente/extra/repetido rejeitado antes de coletar | `ok 10 - C6:` | carried from 1ac00cd: `tests/ai-study/s1-corpus.test.mjs:64-65` - `assert.deepEqual(info.corpus.relational_cases.map((r) => r.id), R_IDS)` / `T_IDS`; `:27-28` - `assert.equal(run.status, 2)` + `assert.equal(run.nodeStatus, 2)` para `:69-76` | PASS |
| C7 | cada R tem os 6 julgamentos, rótulo válido, justificativa não vazia; violações → 2 | `ok 11 - C7:` | carried from 1ac00cd: `s1-corpus.test.mjs:84` - `assert.deepEqual(r.expectations.map((e) => e.judgment).sort(), [...JUDGMENT_IDS].sort(), r.id)`; `:86-87`; `:27-28` para `:93-108` | PASS |
| C8 | resultados vinculados ao mesmo hash de corpus e gabarito; alteração durante a execução impede comparação | `ok 12 - C8:` | carried from 1ac00cd: `s1-corpus.test.mjs:133-134` - `assert.equal(result.corpus_hash, base.corpusHash)` / `gabarito_hash`; `:167` - `assert.equal(changed.manifest.reason, 'corpus_changed')` | PASS |
| C9 | `make ai-study-run` sem modo → 0, artefatos `fixture` em `artifacts/ai-study/<run-id>/`, `schema_version: 1` | `ok 6 - C9:` | verified at 166a2b9: `s1-commands.test.mjs:233` - `assert.equal(run.status, 0, run.output)`; `:236` - `assert.match(run.stdout, new RegExp(\`artifacts/ai-study/${runId}\`))`; `:240` - `assert.equal(evidence.manifest.schema_version, 1)`; `:242-243` `mode`/`provenance` `'fixture'`; `:250-253` por resultado | PASS |
| C10 | fronteira make: transporte ou resposta live em fixture → 2, preservando evidências; coletor: fixture em live também rejeitado | `ok 7 - C10:` | verified at 166a2b9: `s1-commands.test.mjs:262` - `assertUsageFailure(run, /proveniência "live" incompatível com MODE=fixture/, ...)`, `:265-267` `rejected`/`provenance_mismatch`/`['R01-translate-pt-en']`; `:273` resposta live via make, `:275-278`; coletor live `:317` - `error instanceof UsageError && error.exitCode === 2 && /proveniência "fixture"/`; `:321-322` - `reason === 'provenance_mismatch'` + `results.map(provenance) == ['live']`; `:325` - prefixo intacto byte a byte. Asserções inalteradas pelo diff (ver "C10: diff do setup") | PASS |
| C11 | aceita RUN_ID 1 e 64, timeout inteiro positivo, saída 1 e 2048; limites 20/24 | `ok 8 - C11:` | verified at 166a2b9 (linhas +11): `s1-commands.test.mjs:349-353` - `assert.equal(dry.status, 0)` + `assert.equal(manifest[key], value, key)` + `'20'`/`'24'`; `:357-359` - exit 0 e `assert.deepEqual(evidence.manifest.limits, { local_calls: 20, jev_calls: 24 })` | PASS |
| C12 | defaults publicados; RUN_ID gerado; relatório exige RUN_ID; live exige URL/modelo e chave/modelo; token opcional; sem seleção parcial/retry/paralelismo | `ok 9 - C12:` | verified at 166a2b9: `s1-commands.test.mjs:369-373` - corpus, `'gerado na coleta'`, `'120'`, `'30'`, `'2048'`; `:378` - `assert.match(generated, /^[A-Za-z0-9_-]{1,64}$/)`; `:389` relatório sem RUN_ID lança `UsageError` `/RUN_ID/`; `:393-400` 4 obrigatórios live; `:403` - `assert.equal(noToken.local.apiToken, null, ...)`; `:407` - `assertUsageFailure(flagged, new RegExp(name), ...)` para `CASES,ONLY,RETRY,RETRIES,PARALLEL,CONCURRENCY`; `:412` flags CLI | PASS |
| C13 | toda tradução preparada registra original, direção, modelo solicitado e revisão do template, vinculados ao caso e à execução | `ok 13 - C13:` | verified at 166a2b9: `tests/ai-study/s2-translation.test.mjs:157-161` - `assert.equal(t.run_id, 'c13')`, `assert.equal(t.case_id, result.item.case_id)`, `assert.equal(t.requested_model, MODEL)`, `assert.equal(t.template_revision, revision)`; `:164-165` / `:168-169` - `direction` `'pt->en'`/`'en->pt'` e `t.original` igual ao texto do corpus; `:172-175` contagem 12/6. Adaptador LM Studio: `:188-194` - `assert.deepEqual(posts[index].body, { model: MODEL, prompt: renderPrompt(...), max_tokens: 2048, temperature: 0, stream: false })` (corpo HTTP completo); `:195` - `assert.equal(result.request.prompt, posts[index].body.prompt, 'pedido persistido igual ao enviado')`; `:196-198` resultado persistido | PASS |
| C14 | template oficial não confirmado → coleta `incomplete` com `template_unverified`, sem enviar tradução | `ok 14 - C14:` | verified at 166a2b9: `s2-translation.test.mjs:208` - `assertIncomplete(outcome, 'template_unverified')` → `:77-78` `manifest.status === 'incomplete'` e `reason === 'template_unverified'`; `:210` - `assert.deepEqual(calls, [], 'nenhuma chamada local ou Jev')`; `:211` sem resultados; `:216` `template.official === false`. Adaptador: `:226-227` - `template_unverified` e `assert.deepEqual(lm.calls, [])` (zero pedidos HTTP) | PASS |
| C15 | 2048 admitido; 2049 bloqueado com `input_limit`, sem envio nem truncamento; contagem inclui o template | `ok 15 - C15:` | verified at 166a2b9: `s2-translation.test.mjs:243-246` - `assert.equal(counted[index].request.prompt, expected)` + `assert.equal(call.request.prompt, expected)` + prompt contém o original completo e é maior que ele (template incluído); `:238` 18 envios com 2048; `:247` `input_tokens.count === 2048`; `:252` - `assertIncomplete(first, 'input_limit')`; `:253` - `assert.deepEqual(only(blocked.calls, 'translate'), [])`; `:257-273` registro bloqueado completo (`token_count: 2049`, `limit: 2048`, original íntegro); `:282-289` bloqueio no meio preserva prefixo | PASS |
| C16 | contagem indisponível ou de tokenizer não correspondente → `token_count_unavailable`, sem envio | `ok 16 - C16:` | verified at 166a2b9: `s2-translation.test.mjs:305-309` - `assertIncomplete(outcome, 'token_count_unavailable')` + `assert.deepEqual(only(calls, 'translate'), [], name)` + `blocked.reason`/justificativa, sobre 6 variantes `:295-300` (indisponível, tokenizer diferente, sem tokenizer, fracionário, negativo, nulo). Adaptador: `:317-319` contagem `null` com justificativa e zero rede; `:321-325` - `token_count_unavailable` e pedidos HTTP exatamente `[GET /api/v0/models/<id>]` | PASS |
| C17 | saída persistida literalmente como derivação identificada, preservando original e vínculo; braço inglês usa a derivação | `ok 17 - C17:` | verified at 166a2b9: `s2-translation.test.mjs:342` - `assert.equal(t.derived_text, literal(t.case_id), 'saída literal, sem trim')`; `:347` original ao lado da derivação; `:337` hash do corpus intacto; `:353-354` - `en.request.text === literal(c.id)` e `pt.request.text === caseText(c)`; `:356` - `assert.equal(enResult.derived_from, \`${c.id}-translate-pt-en\`)`. Adaptador: `:368-369` texto da resposta HTTP literal em `derived_text` e `response.output`; `:371` braço EN recebe esse texto | PASS |
| C18 | vazia, só espaços ou término por limite → `invalid_translation`, sem Jev do braço inglês | `ok 18 - C18:` | verified at 166a2b9: `s2-translation.test.mjs:394-396` - `status === 'invalid_translation'`, saída preservada, `invalid_reason` `output_limit`/`empty_output` para R01 (vazia), R02 (espaços), R03 (`length`), T01; `:402` - `assert.ok(!evaluated.includes(\`${caseId}-en\`), ...)`; `:403` braço PT segue; `:406-410` `skipped_items`; `:390` coleta `incomplete`/`invalid_translation`. Adaptador: `:424-428` `finish_reason: 'length'` HTTP → `output_limit` e 12 braços EN pulados | PASS |
| C19 | registro contém duração em ms e modelo/tokens/memória do runtime; cada informação não fornecida recebe indicação e justificativa; sem usar download como VRAM | `ok 19 - C19:` | verified at 166a2b9: `s2-translation.test.mjs:448` - `assert.ok(Number.isInteger(duration) && duration >= 25, ...)` (atraso de 30 ms); `:451-453` modelo/tokens/memória fornecidos registrados com valor; `:455-459` tokens e memória não fornecidos: `available === false`, sem `value`, justificativa não vazia; `:460-461` - `assert.match(r02.memory.justification, /download/)` / `/VRAM/`; **modelo não fornecido** `:472-478` - `assertIncomplete(missing, 'model_mismatch')` + `blocked.runtime.model/tokens/memory` com `available === false`, sem `value`, justificativa não vazia; `:479` duração no registro bloqueado. Adaptador: `:488-491` modelo e `usage` HTTP registrados, memória indisponível com `/VRAM/`; `:495-502` `model_check` com duração e metadados | PASS |
| C20 | registra identidade solicitada e retornada do Q6_K; indisponível/incompatível não seleciona outro modelo, não instala runtime, não baixa pesos | `ok 20 - C20:` | verified at 166a2b9: `s2-translation.test.mjs:519` - `assert.deepEqual(identity, { requested_model: MODEL, returned_model: MODEL, quantization: 'Q6_K', model_state: 'loaded' })`; `:525-531` cada pedido HTTP: `authorization`, caminho só `models/<id>` ou `completions`, chaves do corpo exatas, `model === MODEL`, `max_tokens 2048`, `stream false`; `:544-548` 404 → `model_unavailable`, outro id e quantização `Q4_K_M` → `model_mismatch`, com `assert.deepEqual(lm.calls.map(...), [\`GET ${modelPath}\`], ...)` (nenhum load/download/troca) e `returned_model` registrado; `:557-560` resposta sem `model` → `model_mismatch`, um único POST, sem resultado; `:589-594` troca de modelo no 3º POST bloqueia sem novo envio; `:576-578` prefixo de `LOCAL_BASE_URL` preservado e URL sem credencial/query; `:596-606` quantização retornada registrada | PASS |

### C10: diff do setup (regra "nunca enfraquecer asserção")

Verified at 166a2b9. `git diff dba3999..HEAD -- tests/ai-study/s1-commands.test.mjs` só acrescenta: o import de `TRANSLATION_TEMPLATE` (`:12`), `inspect`/`countTokens` e `model` em `liveLocal` (`:285-287`), `translationTemplate = { ...TRANSLATION_TEMPLATE, official: true }` (`:289`) e esse parâmetro na chamada `runCollection` (`:310-316`). Nenhuma linha `assert.*` foi removida ou alterada: o predicado de `assert.rejects` (`:317`), `reason === 'provenance_mismatch'` (`:321`), `results.map(provenance) == ['live']` (`:322`), `fixtureJevCalls === 0` (`:324`) e o prefixo byte a byte (`:325`) são textualmente os mesmos de `dba3999` (só deslocados). O setup novo é necessário porque o coletor live agora para em `template_unverified`/identidade antes da primeira tradução; sem ele o cenário pararia por outro motivo. As asserções continuam exigindo a rejeição por proveniência `fixture` em `R01-evaluate-pt`, depois de um resultado `live` gravado - ou seja, a rejeição não foi trocada por um bloqueio anterior. Não enfraquecido.

### C19: mudança de expectativa em 5451bc0

Verified at 166a2b9. Antes (`632e363`), o cenário de resposta live sem `model` concluía e o teste afirmava `runtime.model` indisponível com justificativa num arquivo de resultado. Em `5451bc0` esse cenário passa a bloquear com `model_mismatch` (exigência de C20: saída de modelo não identificado não é aceita), e o membro "modelo não fornecido" passou a ser afirmado em `manifest.blocked.runtime` (`s2-translation.test.mjs:472-478`), com as mesmas três asserções de antes (`available === false`, ausência de `value`, justificativa não vazia) mais a duração (`:479`). Tokens e memória não fornecidos continuam afirmados numa coleta concluída (`:455-461`).

Julgamento: **a prova não foi enfraquecida.** O claim exige que cada informação não fornecida "receba indicação e justificativa" no registro da tradução; o registro bloqueado (`manifest.blocked`, com item, caso, direção, original, modelo solicitado, revisão do template, duração e `runtime`) é o registro persistido daquela chamada, e os três campos são cobertos. A mudança de estado terminal vem de um claim mais forte (C20), não de afrouxar C19. Sondas em cópia scratch confirmam que a asserção pega implementações erradas:
- removendo a justificativa só do campo `model` em `describe` (`src/ai-study/translation.mjs:58`): `not ok - C19:` (falha `'model'`), C20 segue `ok`;
- restaurando a aceitação de resposta sem `model` (`collect.mjs:207`, condição `response.model && ...`): `not ok` em C19 e C20 (`esperado IncompleteError, veio null`).

Ressalva (observação 2): o registro bloqueado não guarda o texto devolvido pela resposta rejeitada.

### Adaptador LM Studio: pedido HTTP completo e resultado persistido

Verified at 166a2b9. Toda prova de C13–C20 que usa o adaptador real (`createLmStudioTransport` com `fetch` controlado, `s2-translation.test.mjs:85-101`, que registra método, URL, cabeçalhos e corpo) afirma o resultado persistido. O pedido completo é afirmado explicitamente em C13 (corpo por `deepEqual`, todas as 18 traduções) e em C20 (método, caminho, autorização, chaves do corpo). Em C17–C19 o pedido só é conferido de forma implícita: `lmStudioRoute` (`:127-131`) responde 500 a rota ou método inesperados, e a coleta então falha. O adaptador tem uma única forma de pedido, já coberta por C13 e C20, então julgo a regra "Provas dos adaptadores inspecionam a requisição completa e o resultado persistido" (`checks.md`) atendida no nível do adaptador, embora não em cada sub-cenário:

- **C13**. Pedido HTTP: corpo completo por `deepEqual` (`:188-194`). Resultado persistido: `request.prompt`, `derived_text`, `requested_model`, `template_revision` (`:195-198`).
- **C14**. Pedido HTTP: zero pedidos (`:227`). Resultado persistido: manifesto `template_unverified` (`:226`).
- **C16**. Pedido HTTP: lista exata `[GET models/<id>]` (`:322-325`). Resultado persistido: manifesto `token_count_unavailable` (`:321`).
- **C17**. Pedido HTTP: corpo vem da rota padrão (falha em 500 se a rota divergir). Resultado persistido: `derived_text` e `response.output` literais (`:368-369`), texto no braço EN (`:371`).
- **C18**. Pedido HTTP: idem. Resultado persistido: `status`, `invalid_reason`, `derived_text`, `skipped_items` (`:424-428`).
- **C19**. Pedido HTTP: idem. Resultado persistido: `runtime.model/tokens/memory`, `duration_ms`, `model_check` (`:488-502`).
- **C20**. Pedido HTTP: método, caminho, `authorization`, chaves exatas do corpo, `model`, `max_tokens`, `stream` (`:522-531`); lista de pedidos nos bloqueios (`:545`); href sem credencial/query (`:578`). Resultado persistido: identidade no manifesto (`:519`), `returned_model` (`:547`, `:559`, `:592`), sem arquivos de resultado (`:548`, `:560`).

O cabeçalho `content-type` e o `AbortSignal.timeout` não são afirmados (timeout é C33, S4). C15 usa só transporte controlado, coerente com C16: o adaptador real não conta tokens.

### Fronteira e nível

Verified at 166a2b9. C13–C20 não estão na lista de claims de fronteira de comando de `checks.md` ("C1, C4–C7, C9–C10, C30, C34, C41, C52–C54"); as provas no nível do coletor/adaptador atendem. `make ai-study-run MODE=live` continua recusado com código 2 (`src/ai-study/cli.mjs:14-18`), então o adaptador LM Studio não é alcançável pela fronteira nesta entrega. Isso está registrado em `.specs/STATE.md` (Next step). Nível e amostragem de C1–C12: carried from 1ac00cd.

## Swept existing re-read

Verified at 166a2b9. `checks.md` não tem linhas `Swept` marcadas como existentes. As restrições existentes citadas na S1 continuam presentes: `rejectMixedProvenance` em `src/ai-study/collect.mjs:112-119`, aplicada ao transporte (`:171`) e à resposta (`:204`), e agora também à consulta de identidade (`:140`, `:144`); `.gitignore:1` `artifacts/` inalterado.

## Coverage

Profile `light`: o recompute de Coverage não foi executado. Os membros das linhas de S2 (direções, bordas 2048/2049, tradução inválida 3, metadados runtime 5, razões da tradução 4) aparecem nas asserções citadas acima, mas isso é leitura, não recompute.

## Test policy rows

`checks.md` não tem seção `Test policy`; o profile `light` não emite veredito sobre ela.

## Faults injected

Profile `light`: a injeção de falhas não é exigida e não foi feita como etapa. As duas sondas descritas em "C19: mudança de expectativa" foram experimentos pontuais para julgar a força da prova, em cópias `git archive HEAD` no scratchpad. A árvore real não foi alterada.

## Out of scope (not built)

C21, C22, C23, C24, C25, C26, C27, C28, C52, C53 (S3); C29, C30, C31, C32, C33, C34, C35, C36, C37, C38, C39, C40 (S4); C41, C42, C43, C44, C45, C46, C47, C48, C49, C50, C51, C54 (S5). São slices não construídas e não há testes delas na árvore. Não foram verificados e **não** contam como aprovados.

## Observations (non-blocking)

Verified at 166a2b9.

1. **Coleta live hoje sempre bloqueia antes de traduzir.** O template versionado tem `official: false` (`src/ai-study/template.mjs:14`), então o live para em `template_unverified`. Mesmo com o template confirmado, `countTokens` do adaptador real devolve `count: null` (`src/ai-study/lmstudio.mjs:37-39`), então o live para em `token_count_unavailable`. O caminho de admissão de C15 só está provado com contagem controlada. Isso atende aos claims (AC 12 e AC 14 exigem esses bloqueios) e está registrado como blocker e decisão do usuário em `.specs/STATE.md` (Decisões de 01/10/2026, itens 1 e 2). Mas nenhuma tradução live é possível até esses dois itens serem resolvidos.
2. **Saída rejeitada não fica guardada.** Quando a resposta vem sem `model` ou de outro modelo, `manifest.blocked` registra metadados e `runtime`, mas não o texto devolvido (`collect.mjs:207-219`). C17 trata de traduções aceitas, então não há violação. Ainda assim, a auditoria de um bloqueio `model_mismatch` não mostra o que o runtime respondeu.
3. **Partes do pedido sem asserção.** O `AbortSignal.timeout` (`lmstudio.mjs:15`) e o cabeçalho `content-type` não são afirmados por nenhuma prova. O timeout pertence a C33 (S4).
4. **Consulta de identidade fora do limite de chamadas.** O `GET /api/v0/models/<id>` (`collect.mjs:142`) é uma chamada ao runtime que ainda não é contada contra o limite de 20 chamadas locais. O plano reserva até duas verificações de template nesse limite (`plan.md:172`). Isso é obrigação de C31 (S4).
5. (Carried from 1ac00cd, conhecida) C6/C7 provam a rejeição do corpus inválido só em `make ai-study-dry-run`.
6. (Carried from 1ac00cd, conhecida) `check-proof` quebra com parênteses em `TEST_FLAGS` (`Makefile:37`, `$(TEST_FLAGS)` sem aspas). Usei `--test-name-pattern` repetidos numa só invocação.

## Gate

Verified at 166a2b9. `make check-proof` (suíte completa, sem filtro): exit 0; 21 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo (C1–C20 mais o teste de fidelidade do corpus).
