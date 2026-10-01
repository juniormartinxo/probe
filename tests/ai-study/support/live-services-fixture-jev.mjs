// Pré-carga só de teste (NODE_OPTIONS=--import), depois da guarda: LM Studio e Jev controlados.
// Variante `fixture-transport`.
import { register } from 'node:module';

import './live-services-fetch.mjs';

register('./live-services-hooks.mjs', import.meta.url, { data: { variant: 'fixture-transport' } });
