// Pré-carga só de teste (NODE_OPTIONS=--import): a bancada não tem opção para injetar respostas.
// Variante `transport`: o transporte Jev da coleta fixture se declara live.
import { register } from 'node:module';

register('./live-jev-in-fixture-hooks.mjs', import.meta.url, { data: { variant: 'transport' } });
