.DEFAULT_GOAL := help

PYTHON ?= python3
NODE ?= node
TEST_FILES ?= tests/ai-study/*.test.mjs
TLC_SKILL_DIR ?= .claude/skills/tlc-spec-lean
FEATURE ?= jev-translation-feasibility

.PHONY: help plan-validate checks-validate check-proof commit-validate

help:
	@printf '%s\n' \
	  'Comandos disponíveis nesta fase documental:' \
	  '  make plan-validate [FEATURE=nome]  Valida um plano tlc-spec-lean.' \
	  '  make checks-validate [FEATURE=nome]  Valida a estrutura dos checks.' \
	  '  make check-proof TEST_FLAGS="--test-name-pattern=^C1:"  Executa uma prova quando implementada.' \
	  '  make commit-validate MESSAGE="docs: descricao"  Valida a mensagem de commit.' \
	  'Os comandos da aplicação serão adicionados nas entregas aprovadas.'

plan-validate:
	$(PYTHON) "$(TLC_SKILL_DIR)/scripts/validate_plan.py" "$(FEATURE)" --strict

checks-validate:
	$(PYTHON) "$(TLC_SKILL_DIR)/scripts/validate_checks.py" "$(FEATURE)" --strict

# Os arquivos de prova serão criados na implementação; ausência é erro, não sucesso.
# Exige um teste nomeado C<n>: executado, sem aceitar zero testes, skip ou TODO.
check-proof:
	@set -eu; \
	proof_output=$$(mktemp); \
	trap 'rm -f "$$proof_output"' EXIT; \
	if RUN_ID="$(RUN_ID)" $(NODE) --test --test-isolation=none --test-reporter=tap $(TEST_FLAGS) $(TEST_FILES) >"$$proof_output" 2>&1; then \
	  proof_status=0; \
	else proof_status=$$?; fi; \
	cat "$$proof_output"; \
	test "$$proof_status" -eq 0 || exit "$$proof_status"; \
	awk '/^ok [0-9]+ - C[0-9]+:/ && !/ # (SKIP|TODO)/ { proved=1 } END { exit !proved }' "$$proof_output" || \
	  { printf '%s\n' 'Erro: nenhuma prova C<n>: executou com sucesso.' >&2; exit 1; }

commit-validate:
	$(PYTHON) "$(TLC_SKILL_DIR)/scripts/check_commit.py" --message "$(MESSAGE)"
