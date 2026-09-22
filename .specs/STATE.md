# Project state

As decisões de produto aprovadas estão no [desenho consolidado do MVP](../docs/superpowers/specs/2026-09-22-probe-mvp-design.md). O primeiro plano de viabilidade foi aprovado pelo usuário em 22/09/2026. Este arquivo registra o ponto de retomada, sem duplicar os requisitos.

## Handoff

**Feature**: `jev-translation-feasibility`.

**Where**: desenho e plano aprovados; checks e corpus de referência escritos. A bancada e seus testes ainda não foram implementados; nenhum modelo foi chamado.

**In progress**: [checks](features/jev-translation-feasibility/checks.md) — 51 obrigações derivadas dos 37 critérios; [corpus](features/jev-translation-feasibility/corpus.md) — 12 casos relacionais e 6 traduções EN→PT, com gabaritos propostos para revisão.

**Next step**: revisar os textos e gabaritos do corpus antes da primeira geração, conforme o plano aprovado. Quando avançarmos à construção, começar por S1 (dry-run e fixture), escrever as provas com Node test runner e fechar os checks com evidência. A revisão semântica do corpus é condição da coleta real, não impedimento técnico à implementação offline. O escopo desta rodada permanece documental.

**Blockers**: nenhum para a derivação documental. A coleta real depende de servidor/modelo local, credencial Jev e gabaritos revisados. A consulta anterior de GPU via NVML foi bloqueada no ambiente; os 16 GB são informação do usuário, não medição obtida nesta execução.

**Verification profile**: `light`, padrão do harness; nenhuma elevação foi escolhida. A implementação posterior exige verificador independente conforme a tlc-spec-lean.

**Checks tooling**: `make plan-validate` e `make checks-validate` validam estrutura. `make check-proof TEST_FLAGS='--test-name-pattern=^C1:'` selecionará a prova futura; arquivos de testes ausentes são erro. Nenhum check de comportamento está fechado. Node 24.14.0 foi confirmado no WSL; runner nativo adotado como escolha reversível, sem adicionar Vitest ou dependências.

**Uncommitted**: conferir `git status`; `.agents/`, `.claude/`, `.cursor/` e `.windsurf/` já eram arquivos locais não rastreados e não devem entrar por engano nos commits dos documentos.

**Branch**: `main`.
