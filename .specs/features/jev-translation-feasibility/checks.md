# Viabilidade da tradução local e das avaliações do Jev — checks

Profile: light
Plan: `.specs/features/jev-translation-feasibility/plan.md`

51 checks em 5 slices · 1 one-way door · 3 pré-requisitos operacionais para coleta real, mantidos no plano.

Status: obrigações derivadas do plano aprovado em 22/09/2026. **Provas de comportamento pendentes: os testes e a bancada ainda não foram implementados.** Validar este documento não executa nem comprova os checks.

Comando disponível: `make check-proof`, usando o runner nativo do Node 24 observado no WSL. Os seletores abaixo reservam nomes `C<n>: descrição` nos futuros arquivos `tests/ai-study/*.test.mjs`. O comando usa `--test-isolation=none` e exige no TAP pelo menos um check nomeado executado, sem skip/TODO, além da saída zero do Node. As provas devem isolar seu estado explicitamente; testes de concorrência ainda precisam criar os processos ou chamadas que sua obrigação exige. Arquivo ausente, teste ausente, skip ou zero testes executados não encerram um check. A existência e a execução do teste selecionado deverão ser verificadas na fase de implementação e pelo verificador independente. Não foram adicionados testes vazios para produzir sucesso artificial.

O [corpus de referência](corpus.md) contém os textos e gabaritos propostos. Aprovação do plano e estrutura válida dos checks não substituem a revisão humana do corpus. C50–C51 exigem evidência live identificada por `RUN_ID`; as demais provas usam transportes controlados e não precisam de modelos.

## Checks

### S1 - Ensaio delimitado sem serviços reais

**C1** - Na fronteira `make ai-study-dry-run`, configuração válida retorna manifesto com modo, hashes de corpus e gabarito, modelos solicitados, limites 20/24 e destinos sem credenciais (AC 1, 8).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C1:'`

**C2** - Dry-run em ambos os modos e coleta fixture produzem zero tentativas de rede e zero invocações de modelos, comprovadas por transportes que falham se usados (AC 2).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C2:'`

**C3** - Preparação, coleta e relatório, em fixture e live com serviços controlados, invocam zero processos Codex, Claude, Grok, agy ou Cloak (AC 3).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C3:'`

**C4** - A fronteira de comandos aceita somente os modos `fixture` e `live`, seleciona `fixture` na omissão e rejeita outro modo com código 2 (AC 4–5).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C4:'`

**C5** - Configuração inválida na fronteira encerra com código 2 antes de coletar; diagnóstico identifica a configuração, sem expor valor secreto (AC 5, Observable). Exercitar tabela: campos live obrigatórios ausentes, RUN_ID vazio explícito/65 caracteres/caminho/não ASCII, timeout zero/negativo/fracionário/não numérico, saída 0/2049/fracionária, argumento desconhecido e corpus ilegível.
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C5:'`

**C6** - O corpus carregado apresenta exatamente R01–R12 e T01–T06 em ordem numérica, sem IDs repetidos; IDs ausentes, extras ou repetidos são rejeitados antes de coletar (AC 6, Observable).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C6:'`

**C7** - Cada um dos 12 casos R tem exatamente os seis julgamentos identificados, rótulo `yes`/`no`/`insufficient` e justificativa não vazia; campo ausente, extra, duplicado, rótulo inválido ou justificativa vazia invalida o corpus com código 2 (AC 7, Observable).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C7:'`

**C8** - Uma execução vincula todos os seus resultados ao mesmo corpus e gabarito por hash; alteração de qualquer um durante a execução impede comparação entre revisões (AC 8, Relations).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C8:'`

**C9** - `make ai-study-run` com modo omitido conclui com código 0 e artefatos `fixture` em `artifacts/ai-study/<run-id>/`, com `schema_version: 1` (AC 9, Landing 1).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C9:'`

**C10** - Tentativa de incorporar resposta fixture em execução live ou resposta live em execução fixture é rejeitada com código 2, preservando as evidências anteriores (AC 10).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C10:'`

**C11** - Configuração válida aceita RUN_ID de 1 e 64 caracteres ASCII permitidos, timeout inteiro positivo e saída de 1 e 2048 tokens; limites de chamadas permanecem 20/24 (AC 5, 27, Observable).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C11:'`

**C12** - A preparação resolve os defaults publicados: corpus versionado, RUN_ID gerado na coleta, timeouts local/Jev 120/30 segundos e saída 2048; relatório exige RUN_ID, live exige URL/modelo local e chave/modelo Jev, token local é opcional; não oferece seleção parcial, retry ou paralelismo por flags (Observable).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C12:'`

### S2 - Traduções reais rastreáveis

**C13** - Toda tradução preparada registra o original, direção PT→EN ou EN→PT, modelo solicitado e revisão do template, vinculados ao caso e à execução (AC 11, Relations).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C13:'`

**C14** - Template oficial não confirmado encerra a coleta `incomplete` com `template_unverified`, sem enviar a tradução do corpus (AC 12).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C14:'`

**C15** - Entrada formatada de 2048 tokens é admitida e entrada de 2049 é bloqueada com `input_limit` sem envio nem truncamento; a contagem inclui o template (AC 13).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C15:'`

**C16** - Contagem indisponível ou produzida por tokenizer não correspondente bloqueia o envio com `token_count_unavailable` (AC 14).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C16:'`

**C17** - Saída de tradução é persistida literalmente como derivação identificada, preservando original e vínculo; o envio ao braço inglês usa essa derivação sem substituir o original (AC 15, Relations).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C17:'`

**C18** - Tradução vazia, só espaços ou encerrada pelo limite de saída resulta em `invalid_translation`, sem chamada Jev do braço inglês correspondente (AC 16).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C18:'`

**C19** - Registro da tradução contém duração em milissegundos e modelo/tokens/memória retornados pelo runtime; cada informação não fornecida recebe indicação e justificativa, sem usar tamanho de download como VRAM (AC 17).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C19:'`

**C20** - O adaptador registra identidade solicitada e retornada do candidato Q6_K; indisponibilidade ou incompatibilidade não seleciona outro modelo, não instala runtime e não baixa pesos (S2, Impact, Out of scope).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C20:'`

### S3 - Comparação pareada no Jev

**C21** - A fronteira do adaptador Jev envia exatamente os seis julgamentos como perguntas `Choice` independentes na mesma chamada, cada uma com critérios `yes`, `no`, `insufficient` (AC 18).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C21:'`

**C22** - Payloads completos para tradução e Jev contêm zero gabaritos, justificativas de referência ou revisões humanas; sentinelas exclusivas desses campos não aparecem em nenhum estado enviado (AC 19).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C22:'`

**C23** - Cada par enviado mantém instruções em inglês, rubricas, IDs, critérios e modelo Jev iguais; a única variação de conteúdo é o texto original versus tradução, com IDs/etapas fora do texto traduzido (AC 20).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C23:'`

**C24** - Na ordem do corpus, R01 envia PT antes de EN, R02 envia EN antes de PT, e a alternância continua até R12, preservando identificação de caso e braço em cada resultado (Flow).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C24:'`

**C25** - A validação Jev só aceita seis IDs únicos esperados de tipo `choice`, escolha no domínio, três probabilidades finitas em [0,1] com soma a distância ≤0,000001 de 1 e confiança finita em [0,1]; qualquer violação gera `invalid_response` sem inferir escolha de prosa (AC 21).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C25:'`

**C26** - Avaliação persistida identifica execução, caso, braço, escolha, distribuição, confiança, modelo retornado, uso informado e duração; ausência de uso fica identificada, sem virar zero (AC 22, Relations).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C26:'`

**C27** - Para cada julgamento e braço, escolha válida igual ao gabarito conta acerto, escolha válida diferente conta erro e ausência de escolha válida conta ausência; `insufficient` é uma escolha, não um resultado ausente (AC 23).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C27:'`

**C28** - Par sem um braço válido ou com divergência de corpus/gabarito, instruções, critérios ou versão Jev resolvida é marcado incompleto e excluído do denominador pareado; o resultado individual concluído continua visível (AC 24).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C28:'`

### S4 - Coleta limitada com preservação na falha

**C29** - Duas coletas simultâneas no mesmo diretório-base de evidências admitem somente uma; a segunda é rejeitada antes de chamar modelos ou alterar a execução da primeira (AC 25).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C29:'`

**C30** - Coleta com RUN_ID existente encerra com código 2 e mantém os bytes de todos os arquivos anteriores, inclusive quando a tentativa anterior ficou incompleta (AC 26).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C30:'`

**C31** - Execução envia no máximo 20 chamadas locais e 24 Jev, contando falhas e até duas verificações de template; a tentativa 21/25 é bloqueada e transportes/SDKs fazem zero retries automáticos (AC 27).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C31:'`

**C32** - A coleta mantém no máximo uma chamada em andamento, inclusive durante tradução, verificações de template e braços alternados (S4).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C32:'`

**C33** - Timeout local ou Jev encerra a espera no limite configurado e a coleta `incomplete`; restantes ficam não executados e inferência remota sem confirmação fica com resultado desconhecido, sem alegar cancelamento remoto (AC 28).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C33:'`

**C34** - Falha de transporte, HTTP ou resposta inválida após dois resultados conclui a fronteira de coleta com código 1, preserva o prefixo e lista todos os itens restantes como não executados, sem trocar provedor/idioma (AC 29, Flow).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C34:'`

**C35** - Interrupção injetada antes e depois da substituição de manifesto/resultado deixa o arquivo de destino anterior ou novo íntegro; arquivo temporário ou JSON parcial não é aceito como evidência (AC 30).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C35:'`

**C36** - Segredos sentinela em tokens, chaves, URL credenciada e cabeçalhos de autenticação não aparecem em stdout, stderr, manifesto, resultados ou relatório, inclusive em erros HTTP e de parsing (AC 31).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C36:'`

**C37** - Nova tentativa explícita usa nova execução e não importa silenciosamente resultados ou caches de execução anterior; executar novamente com o ID anterior segue C30 (S4, Relations).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C37:'`

**C38** - A coleta usa corpus sintético e configurações explícitas, com zero leituras de chats, perfis Cloak ou diretórios de credenciais; tráfego controlado confirma somente servidor local configurado e destino oficial Jev (S4, Observable).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C38:'`

**C39** - Evidências ficam fora dos arquivos rastreados pelo Git e sobrevivem a nova coleta e geração de relatório, sem limpeza automática (S4, Landing 1).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C39:'`

**C40** - Manifesto e registros `schema_version: 1` mantêm relações execução→configuração/corpus/itens, tradução→original/caso e avaliação→caso/braço; relatório recusa vínculo a outra execução ou revisão, incluindo arquivo incompatível com a versão de schema (Relations, Landing 1).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C40:'`

### S5 - Relatório para uma decisão informada

**C41** - `make ai-study-report RUN_ID=...` gera Markdown somente das evidências da execução identificada, com zero chamadas de rede ou modelos; RUN_ID ausente ou inválido encerra com código 2 (AC 32).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C41:'`

**C42** - Markdown apresenta, nesta ordem, configuração/proveniência, completude, originais/traduções, revisão semântica, comparação Jev e limitações; prosa fica em português e originais não são reescritos (AC 33).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C42:'`

**C43** - Relatório mostra acertos, erros e ausências por julgamento em cada braço, mais contagens dos pares completos; um conjunto controlado com um par completo, um braço isolado e uma resposta inválida demonstra denominadores distintos (AC 34).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C43:'`

**C44** - Revisão semântica de cada saída aceita somente `pending`, `faithful` ou `meaning_changed`; os dois últimos exigem revisor, justificativa e vínculo à saída concreta, não apenas ao ID do caso (AC 35, Relations).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C44:'`

**C45** - Coleta com qualquer item faltante ou qualquer tradução pendente recebe conclusão `inconclusive`, mesmo que todos os pares já avaliados concordem com o gabarito (AC 36).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C45:'`

**C46** - Estado técnico e recomendação humana são campos distintos; `keep_candidate`, `reject_candidate` e `expand_study` só aparecem como recomendação registrada por humano, com zero mudanças automáticas na configuração do produto (AC 37).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C46:'`

**C47** - Correção de gabarito gera revisão identificada e não altera métricas de evidência anterior; nova comparação registra a revisão usada, sem substituir a referência silenciosamente (S5, AC 8).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C47:'`

**C48** - Relatório identifica amostra de 12 casos relacionais sem alegar acurácia geral/calibração; uso indisponível não é custo zero e conversão monetária só aparece com tarifa identificada (S5).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C48:'`

**C49** - Todo relatório fixture identifica os resultados como simulados e não os apresenta como validação real do candidato, medição de VRAM ou ganho de tradução (AC 9, S5).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C49:'`

**C50** - Evidência live de T01–T06 identifica servidor/modelo Q6_K, template confirmado, contagem correspondente, seis traduções EN→PT e durações reais; ausência desses registros deixa a integração local sem prova, nunca suprida por fixture (S2 Independent test).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C50:' RUN_ID="$RUN_ID"`

**C51** - Evidência live de ao menos um caso R contém tradução PT→EN e duas respostas Jev da mesma versão, cada uma com seis resultados válidos; concordância ou discordância com o gabarito fica contabilizada separadamente do sucesso de integração (S3 Independent test).
Proof: `make check-proof TEST_FLAGS='--test-name-pattern=^C51:' RUN_ID="$RUN_ID"`

## Coverage

Esta tabela aloca os membros a provas futuras. `-` significa nenhum membro sem check atribuído, **não** prova executada ou resultado aprovado. Todos os checks estão pendentes de execução.

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| AC S1 (10) | `1` C1 · `2` C2 · `3` C3 · `4` C4 · `5` C5 C11 C12 · `6` C6 · `7` C7 · `8` C8 · `9` C9 · `10` C10 | - |
| AC S2 (7) | `11` C13 · `12` C14 · `13` C15 · `14` C16 · `15` C17 · `16` C18 · `17` C19 | - |
| AC S3 (7) | `18` C21 · `19` C22 · `20` C23 · `21` C25 · `22` C26 · `23` C27 · `24` C28 | - |
| AC S4 (7) | `25` C29 · `26` C30 · `27` C31 · `28` C33 · `29` C34 · `30` C35 · `31` C36 | - |
| AC S5 (6) | `32` C41 · `33` C42 · `34` C43 · `35` C44 · `36` C45 · `37` C46 | - |
| Landing (1) | bancada Make + `schema_version: 1` + diretório de evidências C9 C39 C40 C41 | - |
| Relations (7) | execução C8 C40 · revisão corpus/gabarito C8 C47 · configuração C1 C40 · item planejado C33 C34 · tradução C13 C17 · avaliação C26 · revisão semântica/relatório C40 C41 C44 | - |
| Comandos publicados (4) | `ai-study-dry-run` C1 C2 · `ai-study-run MODE=fixture` C9 · `ai-study-run MODE=live` C34 C50 C51 · `ai-study-report` C41 | - |
| Códigos da fronteira (3) | `0` C9 · `1` C34 · `2` C4 C5 C10 C30 C41 | - |
| Configuração inicial (2 assemblies) | entrada CLI de coleta C1 C9 C12 · entrada CLI de relatório C41 | - |
| Configurações publicadas (11) | `MODE` C4 · `RUN_ID` C5 C11 C12 · `CORPUS` C6 C12 · `LOCAL_BASE_URL` C5 C12 C38 · `LOCAL_MODEL` C5 C12 C20 · `LOCAL_API_TOKEN` C12 C36 · `TYPESAFE_API_KEY` C5 C12 C36 · `JEV_MODEL` C5 C12 C23 · `LOCAL_TIMEOUT_SECONDS` C5 C11 C12 C33 · `JEV_TIMEOUT_SECONDS` C5 C11 C12 C33 · `LOCAL_MAX_OUTPUT_TOKENS` C5 C11 C12 | - |
| Modos (3) | `fixture` C4 C9 · `live` C4 C50 C51 · outro C4 | - |
| RUN_ID (7) | 1 caractere C11 · 64 caracteres C11 · vazio explícito C5 · 65 caracteres C5 · caminho C5 · não ASCII C5 · omitido C12 C41 | - |
| Limite de saída (5) | `0` C5 · `1` C11 · `2048` C11 · `2049` C5 · fracionário C5 | - |
| Timeouts (5) | zero C5 · negativo C5 · fracionário C5 · não numérico C5 · inteiro positivo C11 C33 | - |
| Flags não oferecidas (3) | seleção parcial C12 · retry C12 · paralelismo C12 | - |
| Corpus R (12) | `R01` C6 C7 · `R02` C6 C7 · `R03` C6 C7 · `R04` C6 C7 · `R05` C6 C7 · `R06` C6 C7 · `R07` C6 C7 · `R08` C6 C7 · `R09` C6 C7 · `R10` C6 C7 · `R11` C6 C7 · `R12` C6 C7 | - |
| Corpus T (6) | `T01` C6 C50 · `T02` C6 C50 · `T03` C6 C50 · `T04` C6 C50 · `T05` C6 C50 · `T06` C6 C50 | - |
| Julgamentos (6) | `b_depends_on_a` C7 C21 C27 · `a_depends_on_b` C7 C21 C27 · `complements` C7 C21 C27 · `change_a_affects_b` C7 C21 C27 · `same_block` C7 C21 C27 · `answers_conflict` C7 C21 C27 | - |
| Escolhas (3) | `yes` C7 C21 C27 · `no` C7 C21 C27 · `insufficient` C7 C21 C27 | - |
| Direções de tradução (2) | PT→EN C13 C51 · EN→PT C13 C50 | - |
| Entrada formatada (2 edges) | 2048 C15 · 2049 C15 | - |
| Tradução inválida (3) | vazia C18 · só espaços C18 · término por limite C18 | - |
| Metadados runtime (5) | modelo C19 C20 · tokens C19 · memória C19 · duração C19 · não fornecido C19 | - |
| Conteúdo excluído de payloads (3) | gabarito C22 · justificativa de referência C22 · revisão humana C22 | - |
| Resposta Jev inválida (10) | ID ausente C25 · ID extra C25 · ID repetido C25 · tipo não choice C25 · escolha fora do domínio C25 · probabilidade ausente C25 · probabilidade não finita C25 · probabilidade fora de [0,1] C25 · soma fora da tolerância C25 · confiança inválida C25 | - |
| Bordas de probabilidade/confiança (6) | abaixo de 0 C25 · 0 C25 · 1 C25 · acima de 1 C25 · NaN C25 · infinito C25 | - |
| Tolerância da soma (3 edges) | distância menor que 0,000001 C25 · igual a 0,000001 C25 · maior que 0,000001 C25 | - |
| Comparação individual (3) | acerto C27 · erro C27 · ausência C27 | - |
| Par incompleto (6) | braço ausente C28 · braço inválido C28 · corpus/gabarito divergente C28 · instruções divergentes C28 · critérios divergentes C28 · versão Jev divergente C28 | - |
| Ordem de braços (2) | PT/EN em R ímpar C24 · EN/PT em R par C24 | - |
| Chamadas (4 edges) | local 20 C31 · local 21 C31 · Jev 24 C31 · Jev 25 C31 | - |
| Falhas externas (5) | transporte C34 · HTTP C34 · resposta inválida C34 · timeout local C33 · timeout Jev C33 | - |
| Razões da tradução (4) | `template_unverified` C14 · `input_limit` C15 · `token_count_unavailable` C16 · `invalid_translation` C18 | - |
| Persistência atômica (4) | manifesto antes de substituir C35 · manifesto depois C35 · resultado antes C35 · resultado depois C35 | - |
| Segredos (4) | chave C36 · token C36 · URL credenciada C36 · cabeçalho de autenticação C36 | - |
| Saídas redigidas (6) | stdout C36 · stderr C36 · manifesto C36 · resultado C36 · relatório C36 · diagnóstico HTTP/parsing C36 | - |
| CLIs excluídas (5) | Codex C3 · Claude C3 · Grok C3 · agy C3 · Cloak C3 | - |
| Relatório (6) | configuração/proveniência C42 · completude C42 · originais/traduções C42 · revisão semântica C42 · comparação Jev C42 C43 · limitações C42 C48 | - |
| Revisão semântica (3) | `pending` C44 C45 · `faithful` C44 · `meaning_changed` C44 | - |
| Recomendação humana (3) | `keep_candidate` C46 · `reject_candidate` C46 · `expand_study` C46 | - |
| Conclusão sem evidência completa (2) | coleta faltante C45 · revisão pendente C45 | - |
| Proveniência no relatório (2) | fixture simulado C49 · live identificado C50 C51 | - |

Claims sobre códigos de saída e comandos (C1, C4–C7, C9–C10, C30, C34, C41) exigem atravessar a fronteira do comando publicado. Provas dos adaptadores inspecionam a requisição completa e o resultado persistido. C25, C27 e C28 devem cobrir cada linha das suas tabelas de decisão, além do caminho de integração. C50–C51 não exigem concordância perfeita do modelo com o gabarito: provam integração, enquanto C27/C43 medem a concordância observada.

## Swept

- validation: C4–C8, C11–C16, C25, C31; C5 C11 C15 C25 explicitam as bordas.
- failure modes: C10 C14 C16 C18 C28 C33 C34 C35.
- idempotency: C30 C31 C37; coleta repetida não sobrescreve nem reutiliza silenciosamente.
- authorization: C2 C3 C12 C22 C31 C36 C38; não há API recebida nem autenticação de usuário nesta entrega.
- concurrency: C24 C29 C32 C35; exclusão local e uma chamada em andamento.
- data lifecycle: C8 C17 C26 C30 C37 C39 C40 C44 C47.
- dependency failure: C14 C16 C18 C20 C25 C33 C34; simulação não fecha C50 C51.
- state transitions: C9 C10 C28 C33 C34 C44 C45 C46.
- observability: C1 C19 C26 C36 C42 C43 C48 C49.

## Handoff

Snapshot medido com `wc -c` em 22/09/2026, antes de acrescentar este cálculo: STATE 2.252 + plan 24.897 + checks 23.834 + corpus 20.212 + desenho aprovado 31.657 + Makefile 1.273 = 104.125 bytes. Entradas ≈ 104.125 / 4 = 26.031 tokens. Código da bancada e testes ainda têm 0 arquivos; seu tamanho futuro não é apresentado como medição.

Distribuição estimada da reserva para testes, código e evidências: S1 8k + S2 8k + S3 8k + S4 10k + S5 6k = 40k. Essa é previsão, não tamanho medido. Entradas + reserva ≈ 66.031 tokens, abaixo do orçamento de 150k: um builder, sem divisão entre agentes. O verificador independente entra somente após implementação e último commit da feature, conforme o harness.

Esta entrega registra checks e corpus. Não há check fechado, adaptador implementado ou resultado de modelo. Antes de qualquer coleta real, resolver os três pré-requisitos do plano, inclusive a revisão do corpus. A próxima implementação pode começar por S1, sem serviços reais, quando entrarmos na fase de construção autorizada pelo usuário.
