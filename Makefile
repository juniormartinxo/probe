.DEFAULT_GOAL := help

.PHONY: help

help:
	@printf '%s\n' \
	  'Comandos disponíveis:' \
	  '  make help  Lista as operações disponíveis.' \
	  'Os alvos da aplicação (up, down, frontend, executor, dev) chegam com a primeira fatia.'
