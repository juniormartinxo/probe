# Project state

As decisões de produto aprovadas estão no [desenho consolidado do MVP](../docs/superpowers/specs/2026-09-22-probe-mvp-design.md). O primeiro plano de viabilidade foi aprovado pelo usuário em 22/09/2026. Este arquivo registra o ponto de retomada, sem duplicar os requisitos.

## Handoff

**Feature**: `jev-translation-feasibility`.

**Authorized scope**: implementação da S1 (PRB-2) autorizada pelo usuário em 30/09/2026 e da S2 (PRB-3) em 01/10/2026, ao invocar a implementação de cada card. S3–S5, coleta real e instalação de dependências continuam dependendo de autorização explícita.

**Where**: S1 implementada em `src/ai-study/` com corpus estruturado `src/ai-study/corpus/revision-1.json` (textos e gabaritos da revisão 1, conferidos contra corpus.md por teste). Comandos `make ai-study-dry-run` e `make ai-study-run` (fixture por omissão). C1–C12 com provas em `tests/ai-study/s1-*.test.mjs`, executadas por `make check-proof`; as partes live de C3 e C10 foram movidas para C52–C54 (S3/S5) por decisão do usuário em 30/09/2026. Nenhum modelo foi chamado.

S2 implementada em `src/ai-study/template.mjs` (template versionado e revisão SHA-256), `translation.mjs` (limite de 2048 tokens, tokenizer correspondente, identidade Q6_K, `invalid_translation`, metadados com justificativa) e `lmstudio.mjs` (REST v0: `GET /api/v0/models/{id}` e `POST /api/v0/completions` com prompt renderizado pela bancada). Coletor live confirma template e candidato antes da primeira tradução; fixture não tem runtime e não passa por esses gates. C13–C20 provados em `tests/ai-study/s2-translation.test.mjs` com transportes controlados e `fetch` controlado; o setup de C10 (S1) passou a fornecer template confirmado, `inspect`, `countTokens` e o modelo do candidato na resposta, sem mudar asserções. Nenhum modelo foi chamado.

**Next step**: S3 (PRB-4), adaptador Jev. `MODE=live` em `ai-study-run` encerra com código 2 até existir o adaptador Jev; o adaptador LM Studio já existe, mas a fronteira live só será ligada com os dois. Ordem decidida pelo usuário em 01/10/2026: S3 segue primeiro, conforme o plano. O template oficial (Decisão 1) corre em paralelo e não bloqueia a S3, porque depende de ação do usuário (aceite da licença do Google ou inspeção do GGUF instalado), não de código. Opcional, junto com a S3: guardar em `manifest.blocked` o texto devolvido pelo runtime nos bloqueios `model_mismatch` (lacuna não bloqueante do verificador).

**Blockers**: nenhum para S1 e S2 por transportes controlados. Para a coleta live (C50): (a) o template versionado é a adaptação, reconstruída sem cópia byte a byte e marcada `official: false`, então o live para em `template_unverified` até o template oficial ser obtido e adotado (ver Decisões de 01/10/2026); (b) o REST do LM Studio não expõe contagem de tokens antes do envio, então o adaptador devolve contagem indisponível e o live para em `token_count_unavailable` até a contagem pelo LM Studio ser implementada (ver Decisões de 01/10/2026). Servidor/modelo local, configuração Jev e confirmação do template continuam como pré-requisitos da coleta real. Atenção para S4: o GNU Make sai sempre com 2 quando o recipe falha; o código 1 (incompleto) do Node só aparece na linha `Error 1` do make, então C34 precisa de uma decisão sobre como publicar esse código na fronteira `make`.

**Template research**: o usuário indicou `chbae624/vllm-translategemma-12b-it`, revisão `81d99b4299ce797e9fa5141ade4384e57f5e9442`, arquivo `chat_template.jinja`, SHA-256 `ff2b09144adfdc0dc3b9366a4ec2d36852c28020d4ae42e327b42138a9497b20`. O conteúdo inspecionado usa marcadores textuais `<<<source>>>`, `<<<target>>>` e `<<<text>>>`, além de uma opção de prompt customizado. É uma adaptação, não foi demonstrada equivalência ao arquivo oficial. O critério do plano não foi alterado.

**Decisões de 01/10/2026** (tomadas pelo usuário após o review do PR #2; nenhuma afrouxa AC ou check):

1. **Template**: obter o `chat_template` oficial de `google/translategemma-12b-it`, a partir dos metadados do GGUF Q6_K instalado ou do repositório do Google (gated, exige aceite de licença). Comparar o prompt gerado para PT→EN e EN→PT com o da bancada e adotar o oficial. A adaptação `chbae624` não é aceita como substituta, porque um template errado pode distorcer a qualidade medida. É o primeiro item a executar entre as pendências da coleta live, em paralelo à S3 (ver Next step). Pendente de confirmação: se os metadados do GGUF do mradermacher trazem o template original.
2. **Tokenizer**: contar tokens pelo próprio LM Studio, via `@lmstudio/sdk` (contagem com o tokenizer do modelo carregado), mantendo a tradução pelo REST v0. A dependência `@lmstudio/sdk` fica autorizada para esse fim. Contagem pelo `tokenizer.json` via `@huggingface/transformers` foi descartada. Pendente de confirmação antes de implementar: o nome exato da API de contagem e se ela trata `<start_of_turn>`/`<end_of_turn>` como tokens especiais, sem o que a contagem falha perto do limite de 2048.
3. **Origem do candidato (mradermacher)**: conferir uma única vez, numa etapa de preparação, o SHA-256 do arquivo GGUF Q6_K instalado contra o hash publicado no Hugging Face para `mradermacher/translategemma-12b-it-GGUF`, registrando o resultado na evidência. Não recalcular a cada coleta.
4. **C50**: permanece na S5, depois das salvaguardas da S4. Com os itens 1 e 2 resolvidos, foi proposto um ensaio live só da tradução (1–2 casos, sem Jev) para antecipar problemas; ele não está no plano e a coleta real continua dependendo de autorização explícita do usuário no momento da execução.

**Verification profile**: `light`, padrão do harness; nenhuma elevação foi escolhida. A implementação posterior exige verificador independente conforme a tlc-spec-lean.

**Checks tooling**: `make plan-validate` e `make checks-validate` validam estrutura. `make check-proof TEST_FLAGS='--test-name-pattern=^C1:'` selecionará a prova futura; arquivos de testes ausentes são erro. C1–C20 têm prova executada e verificação independente PASS (S1+S2, em `166a2b9`, relatório em `verification.md`); C21–C54 continuam pendentes. Node 24.14.0 foi confirmado no WSL; runner nativo adotado como escolha reversível, sem adicionar Vitest ou dependências.

**Uncommitted**: conferir `git status`. Evidências ficam em `artifacts/`, ignorado pelo Git.

**Branch**: `prb-3`.
