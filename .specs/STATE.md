# Project state

As decisões de produto aprovadas estão no [desenho consolidado do MVP](../docs/superpowers/specs/2026-09-22-probe-mvp-design.md). Este arquivo não duplica esse registro. Escolhas propostas no plano permanecem propostas até sua revisão.

## Handoff

**Feature**: `jev-translation-feasibility`.

**Where**: desenho do MVP aprovado; primeiro plano escrito para revisão, antes de checks e implementação.

**In progress**: `.specs/features/jev-translation-feasibility/plan.md` — comparação entre português original e inglês traduzido nas avaliações do Jev.

**Next step**: revisar o plano delimitado; após aprovação, escrever checks e o corpus com gabaritos antes dos adaptadores. A aprovação do desenho não inicia implementação nem ensaios reais.

**Blockers**: nenhum para o planejamento. A coleta real depende de servidor/modelo local, credencial Jev e gabaritos revisados. A consulta de GPU via NVML foi bloqueada no ambiente atual; os 16 GB são informação do usuário, não medição obtida nesta execução.

**Verification profile**: `light`, padrão do harness; nenhuma elevação foi escolhida. A implementação posterior exige verificador independente conforme a tlc-spec-lean.

**Uncommitted**: conferir `git status`; `.agents/`, `.claude/`, `.cursor/` e `.windsurf/` já eram arquivos locais não rastreados e não devem entrar por engano nos commits dos documentos.

**Branch**: `main`.
