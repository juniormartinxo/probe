// Pré-carga só de teste (NODE_OPTIONS=--import).
// Variante `response`: o transporte Jev se declara fixture, mas a resposta volta rotulada live.
import { register } from 'node:module';

register('./live-jev-in-fixture-hooks.mjs', import.meta.url, { data: { variant: 'response' } });
