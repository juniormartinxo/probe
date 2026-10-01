// Pré-carga só de teste (NODE_OPTIONS=--import): a bancada não tem opção para injetar respostas.
import { register } from 'node:module';

register('./live-jev-in-fixture-hooks.mjs', import.meta.url);
