# Project state

As decisões de produto aprovadas estão no [desenho consolidado do MVP](../docs/superpowers/specs/2026-09-22-probe-mvp-design.md). O primeiro plano de viabilidade foi aprovado pelo usuário em 22/09/2026. Este arquivo registra o ponto de retomada, sem duplicar os requisitos.

## Handoff

**Feature**: `jev-translation-feasibility`.

**Authorized scope**: somente planejamento. O usuário esclareceu expressamente que este assistente não deve implementar. Aprovações de plano, checks ou gabaritos não autorizam escrever código, testes da aplicação, instalar dependências ou executar ensaios. Qualquer mudança desse escopo depende de instrução explícita posterior do usuário.

**Where**: desenho e plano aprovados; checks e corpus de referência escritos. A bancada e seus testes ainda não foram implementados; nenhum modelo foi chamado.

**In progress**: [checks](features/jev-translation-feasibility/checks.md) — 51 obrigações derivadas dos 37 critérios; [corpus](features/jev-translation-feasibility/corpus.md) — 12 casos relacionais e 6 traduções EN→PT, com gabaritos aprovados pelo usuário em 22/09/2026.

**Next step**: continuar o planejamento e preparar o encaminhamento para futura implementação. Permanece aberta a escolha entre obter o template oficial e aceitar uma adaptação identificada, sem executar modelos. Não iniciar S1 ou qualquer construção a partir de uma aprovação documental.

**Blockers**: nenhum para a derivação documental. Os gabaritos estão aprovados. Servidor/modelo local, configuração Jev e confirmação do template continuam como pré-requisitos de uma futura coleta, fora do escopo atual. Não é necessário fornecer credenciais durante o planejamento.

**Template research**: o usuário indicou `chbae624/vllm-translategemma-12b-it`, revisão `81d99b4299ce797e9fa5141ade4384e57f5e9442`, arquivo `chat_template.jinja`, SHA-256 `ff2b09144adfdc0dc3b9366a4ec2d36852c28020d4ae42e327b42138a9497b20`. O conteúdo inspecionado usa marcadores textuais `<<<source>>>`, `<<<target>>>` e `<<<text>>>`, além de uma opção de prompt customizado. É uma adaptação, não foi demonstrada equivalência ao arquivo oficial. O critério do plano não foi alterado.

**Scope correction**: arquivos iniciais de implementação criados por interpretação incorreta da aprovação foram removidos nesta rodada. Nenhum código dessa tentativa foi commitado, nenhuma dependência foi instalada e nenhum modelo foi chamado.

**Verification profile**: `light`, padrão do harness; nenhuma elevação foi escolhida. A implementação posterior exige verificador independente conforme a tlc-spec-lean.

**Checks tooling**: `make plan-validate` e `make checks-validate` validam estrutura. `make check-proof TEST_FLAGS='--test-name-pattern=^C1:'` selecionará a prova futura; arquivos de testes ausentes são erro. Nenhum check de comportamento está fechado. Node 24.14.0 foi confirmado no WSL; runner nativo adotado como escolha reversível, sem adicionar Vitest ou dependências.

**Uncommitted**: conferir `git status`; `.agents/`, `.claude/`, `.cursor/` e `.windsurf/` já eram arquivos locais não rastreados e não devem entrar por engano nos commits dos documentos.

**Branch**: `main`.
