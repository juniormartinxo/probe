.DEFAULT_GOAL := help

PYTHON ?= python3
TLC_SKILL_DIR ?= .claude/skills/tlc-spec-lean
FEATURE ?= jev-translation-feasibility

.PHONY: help plan-validate commit-validate

help:
	@printf '%s\n' \
	  'Comandos disponíveis nesta fase documental:' \
	  '  make plan-validate [FEATURE=nome]  Valida um plano tlc-spec-lean.' \
	  '  make commit-validate MESSAGE="docs: descricao"  Valida a mensagem de commit.' \
	  'Os comandos da aplicação serão adicionados nas entregas aprovadas.'

plan-validate:
	$(PYTHON) "$(TLC_SKILL_DIR)/scripts/validate_plan.py" "$(FEATURE)" --strict

commit-validate:
	$(PYTHON) "$(TLC_SKILL_DIR)/scripts/check_commit.py" --message "$(MESSAGE)"
