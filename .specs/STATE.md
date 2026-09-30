# Project state

As decisões de produto aprovadas estão no [desenho consolidado do MVP](../docs/superpowers/specs/2026-09-22-probe-mvp-design.md). O primeiro plano de viabilidade foi aprovado pelo usuário em 22/09/2026. Este arquivo registra o ponto de retomada, sem duplicar os requisitos.

## Handoff

**Feature**: `jev-translation-feasibility`.

**Authorized scope**: implementação da S1 (PRB-2) autorizada pelo usuário em 30/09/2026 ao invocar a implementação do card. S2–S5, coleta real e instalação de dependências continuam dependendo de autorização explícita.

**Where**: S1 implementada em `src/ai-study/` com corpus estruturado `src/ai-study/corpus/revision-1.json` (textos e gabaritos da revisão 1, conferidos contra corpus.md por teste). Comandos `make ai-study-dry-run` e `make ai-study-run` (fixture por omissão). C1–C12 com provas em `tests/ai-study/s1-*.test.mjs`, executadas por `make check-proof`; C3 e C10 são parciais até existir a coleta live (ver checks.md). Nenhum modelo foi chamado.

**Next step**: verificador independente da S1, conforme a tlc-spec-lean; depois S2 (PRB-3). `MODE=live` em `ai-study-run` encerra com código 2 até existirem os adaptadores de S2/S3.

**Blockers**: nenhum para S1. Servidor/modelo local, configuração Jev e confirmação do template continuam como pré-requisitos da coleta real. Atenção para S4: o GNU Make sai sempre com 2 quando o recipe falha; o código 1 (incompleto) do Node só aparece na linha `Error 1` do make, então C34 precisa de uma decisão sobre como publicar esse código na fronteira `make`.

**Template research**: o usuário indicou `chbae624/vllm-translategemma-12b-it`, revisão `81d99b4299ce797e9fa5141ade4384e57f5e9442`, arquivo `chat_template.jinja`, SHA-256 `ff2b09144adfdc0dc3b9366a4ec2d36852c28020d4ae42e327b42138a9497b20`. O conteúdo inspecionado usa marcadores textuais `<<<source>>>`, `<<<target>>>` e `<<<text>>>`, além de uma opção de prompt customizado. É uma adaptação, não foi demonstrada equivalência ao arquivo oficial. O critério do plano não foi alterado.

**Verification profile**: `light`, padrão do harness; nenhuma elevação foi escolhida. A implementação posterior exige verificador independente conforme a tlc-spec-lean.

**Checks tooling**: `make plan-validate` e `make checks-validate` validam estrutura. `make check-proof TEST_FLAGS='--test-name-pattern=^C1:'` selecionará a prova futura; arquivos de testes ausentes são erro. C1–C12 têm prova executada (C3 e C10 parciais); C13–C51 continuam pendentes. Node 24.14.0 foi confirmado no WSL; runner nativo adotado como escolha reversível, sem adicionar Vitest ou dependências.

**Uncommitted**: conferir `git status`. Evidências ficam em `artifacts/`, ignorado pelo Git.

**Branch**: `prb-2`.
