.DEFAULT_GOAL := help

# Configuração local opcional (veja .env.example). As portas seguem para o Docker Compose, o Vite
# e os testes. Precedência, igual em todos eles: ambiente (ou linha de comando) > .env.local > padrão.
PROBE_SETTINGS := PROBE_BACKEND_PORT PROBE_DB_PORT
$(foreach v,$(PROBE_SETTINGS),$(eval PROBE_FROM_ENV_$(v) := $(value $(v))))
-include .env.local
$(foreach v,$(PROBE_SETTINGS),$(if $(PROBE_FROM_ENV_$(v)),$(eval $(v) := $(PROBE_FROM_ENV_$(v)))))
export PROBE_BACKEND_PORT ?= 3210
export PROBE_DB_PORT ?= 5434

COMPOSE ?= docker compose
PNPM ?= pnpm

.PHONY: help install up down logs migrate migrate-down frontend dev test typecheck build

help:
	@printf '%s\n' \
	  'Comandos disponíveis:' \
	  '  make install       Instala as dependências do workspace PNPM.' \
	  '  make up            Sobe backend e banco (Docker Compose) e aplica as migrations.' \
	  '  make down          Para backend e banco, preservando os dados do volume.' \
	  '  make logs          Acompanha os logs do backend.' \
	  '  make migrate       Aplica as migrations pendentes.' \
	  '  make migrate-down  Desfaz a última migration aplicada.' \
	  '  make frontend      Inicia o Vite e abre localhost (5173 ou a próxima porta livre) no navegador.' \
	  '  make dev           Sobe backend e banco e inicia o frontend.' \
	  '  make test          Roda os testes (o backend usa o banco probe_test do serviço db).' \
	  '  make typecheck     Verifica os tipos de todos os pacotes.' \
	  '  make build         Verifica os tipos, compila o frontend e constrói a imagem do backend.' \
	  'Portas publicadas em 127.0.0.1: PROBE_BACKEND_PORT (padrão 3210) e PROBE_DB_PORT (padrão 5434).' \
	  'Precedência: ambiente ou linha de comando > .env.local > padrão (vale também para o Vite e os testes).'

node_modules/.modules.yaml: package.json pnpm-lock.yaml pnpm-workspace.yaml $(wildcard apps/*/package.json)
	$(PNPM) install --frozen-lockfile
	@touch $@

install: node_modules/.modules.yaml

up:
	$(COMPOSE) up --detach --build --wait
	$(MAKE) migrate

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow backend

migrate:
	$(COMPOSE) run --rm backend pnpm migrate latest

migrate-down:
	$(COMPOSE) run --rm backend pnpm migrate down

frontend: install
	$(PNPM) --filter @probe/frontend dev

dev: up
	$(MAKE) frontend

test: install
	$(COMPOSE) up --detach --wait db
	$(PNPM) test

typecheck: install
	$(PNPM) typecheck

build: install
	$(PNPM) build
	$(COMPOSE) build
