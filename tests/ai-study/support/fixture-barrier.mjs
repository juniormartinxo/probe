// Pré-carga só de teste (NODE_OPTIONS=--import): a primeira chamada fixture espera uma barreira.
import { register } from 'node:module';

register('./fixture-barrier-hooks.mjs', import.meta.url);
