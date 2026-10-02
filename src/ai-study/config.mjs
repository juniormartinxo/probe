import { isAbsolute, join, relative, resolve } from 'node:path';

import { UsageError } from './errors.mjs';

export const MODES = Object.freeze(['fixture', 'live']);
export const LIMITS = Object.freeze({ localCalls: 20, jevCalls: 24 });
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_CORPUS = 'src/ai-study/corpus/revision-1.json';
export const MAX_OUTPUT_TOKENS = 2048;

// Assinatura publicada no plano; não há flags de seleção parcial, retry ou paralelismo.
export const CONFIG_NAMES = Object.freeze([
  'MODE',
  'RUN_ID',
  'CORPUS',
  'LOCAL_BASE_URL',
  'LOCAL_MODEL',
  'LOCAL_API_TOKEN',
  'TYPESAFE_API_KEY',
  'JEV_MODEL',
  'LOCAL_TIMEOUT_SECONDS',
  'JEV_TIMEOUT_SECONDS',
  'LOCAL_MAX_OUTPUT_TOKENS',
]);
export const SECRET_NAMES = Object.freeze(['LOCAL_API_TOKEN', 'TYPESAFE_API_KEY']);
// Variáveis do próprio Makefile que podem aparecer na linha de comando do make.
const MAKE_KNOBS = new Set(['NODE', 'PYTHON', 'TEST_FILES', 'TEST_FLAGS', 'TLC_SKILL_DIR', 'FEATURE', 'AI_STUDY_CLI']);

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

// Mensagens nomeiam a configuração e nunca repetem o valor recebido.
export function resolveConfig(command, env, { repoRoot, commandLineNames = [] } = {}) {
  const problems = [];
  const has = (name) => Object.hasOwn(env, name);

  for (const name of commandLineNames) {
    if (SECRET_NAMES.includes(name)) {
      problems.push(`${name}: segredos devem vir do ambiente, não da linha de comando`);
    } else if (!CONFIG_NAMES.includes(name) && !MAKE_KNOBS.has(name)) {
      problems.push(`argumento desconhecido: ${name} (não há seleção parcial, retry ou paralelismo)`);
    }
  }

  let mode = 'fixture';
  if (has('MODE')) {
    if (MODES.includes(env.MODE)) mode = env.MODE;
    else problems.push('MODE inválido: use fixture ou live');
  }

  let runId = null;
  if (has('RUN_ID')) {
    if (RUN_ID_PATTERN.test(env.RUN_ID)) runId = env.RUN_ID;
    else problems.push('RUN_ID inválido: use de 1 a 64 caracteres entre letras ASCII, números, hífen e sublinhado');
  } else if (command === 'report') {
    problems.push('RUN_ID obrigatório para o relatório');
  }

  let corpusPath = resolve(repoRoot, DEFAULT_CORPUS);
  if (has('CORPUS')) {
    if (env.CORPUS === '') problems.push('CORPUS vazio: omita-o para usar o corpus versionado');
    else corpusPath = resolve(repoRoot, env.CORPUS);
  }

  const integer = (name, fallback, max = Infinity) => {
    if (!has(name)) return fallback;
    const value = env[name];
    if (POSITIVE_INTEGER.test(value) && Number(value) <= max) return Number(value);
    problems.push(`${name} inválido: use inteiro de 1 a ${max === Infinity ? 'N' : max}`);
    return fallback;
  };
  const localTimeoutSeconds = integer('LOCAL_TIMEOUT_SECONDS', 120);
  const jevTimeoutSeconds = integer('JEV_TIMEOUT_SECONDS', 30);
  const localMaxOutputTokens = integer('LOCAL_MAX_OUTPUT_TOKENS', MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);

  const nonBlankOrNull = (name) => (has(name) && env[name].trim() !== '' ? env[name] : null);
  const localModel = nonBlankOrNull('LOCAL_MODEL');
  const jevModel = nonBlankOrNull('JEV_MODEL');
  const jevApiKey = nonBlankOrNull('TYPESAFE_API_KEY');
  const localApiToken = nonBlankOrNull('LOCAL_API_TOKEN');
  // Segredo curto coincidiria com texto comum e não poderia ser omitido das evidências (AC 31).
  for (const [name, value] of [['TYPESAFE_API_KEY', jevApiKey], ['LOCAL_API_TOKEN', localApiToken]]) {
    if (value !== null && value.length < MIN_REDACTED_SECRET) {
      problems.push(`${name} curto demais: use ao menos ${MIN_REDACTED_SECRET} caracteres, para que possa ser omitido das evidências`);
    }
  }

  let localBaseUrl = null;
  if (nonBlankOrNull('LOCAL_BASE_URL')) {
    localBaseUrl = parseHttpUrl(env.LOCAL_BASE_URL);
    if (!localBaseUrl) problems.push('LOCAL_BASE_URL inválida: use uma URL http ou https');
  }

  if (mode === 'live' && command !== 'report') {
    if (!nonBlankOrNull('LOCAL_BASE_URL')) problems.push('LOCAL_BASE_URL obrigatória no modo live');
    if (!localModel) problems.push('LOCAL_MODEL obrigatório no modo live');
    if (!jevApiKey) problems.push('TYPESAFE_API_KEY obrigatória no modo live (via ambiente)');
    if (!jevModel) problems.push('JEV_MODEL obrigatório no modo live');
  }

  if (problems.length > 0) throw new UsageError(`configuração inválida:\n  - ${problems.join('\n  - ')}`);

  return {
    command,
    mode,
    runId,
    corpusPath,
    corpusDisplay: displayPath(repoRoot, corpusPath),
    limits: LIMITS,
    local: {
      baseUrl: localBaseUrl,
      model: localModel,
      apiToken: localApiToken,
      timeoutSeconds: localTimeoutSeconds,
      maxOutputTokens: localMaxOutputTokens,
    },
    jev: { endpoint: JEV_ENDPOINT, model: jevModel, apiKey: jevApiKey, timeoutSeconds: jevTimeoutSeconds },
  };
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Destino exibível: sem usuário, senha, query ou fragmento.
export function displayUrl(url) {
  return url ? `${url.origin}${url.pathname.replace(/\/$/, '')}` : null;
}

export function displayPath(repoRoot, path) {
  const rel = relative(repoRoot, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

// Credenciais de URL são omitidas pela estrutura (usuário, senha e query), não por busca do valor:
// uma credencial curta como `u` ou `MODE` corromperia qualquer diagnóstico. Segredos do ambiente
// são omitidos onde aparecerem.
export function redact(text, env) {
  return redactText(text, SECRET_NAMES.map((name) => env[name]));
}

export function redactText(text, secrets) {
  const structural = text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi, '$1[omitido]@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)\?[^\s#]*/gi, '$1?[omitido]');
  return omitSecrets(structural, secrets);
}

// Valores secretos da configuração: vão só em cabeçalhos, e um serviço pode ecoá-los na resposta.
export function secretValues(config) {
  return [config.jev.apiKey, config.local.apiToken];
}

function omitSecrets(text, secrets) {
  return secrets
    .filter((value) => typeof value === 'string' && value.length > 0)
    .reduce((result, secret) => result.split(secret).join('[omitido]'), text);
}

// Segredo mais curto que isto coincidiria por acaso com texto comum: omiti-lo das evidências corromperia
// traduções e identificadores. A configuração recusa chave e token mais curtos (código 2), então todo
// segredo de uma execução é omitido (AC 31).
export const MIN_REDACTED_SECRET = 8;

// Evidência gravada: omite os segredos em qualquer texto (chaves inclusive), sem reescrever URLs, que
// podem fazer parte de uma tradução literal. O filtro de tamanho só protege chamadas fora da configuração.
export function redactValue(value, secrets) {
  const relevant = secrets.filter((secret) => typeof secret === 'string' && secret.length >= MIN_REDACTED_SECRET);
  const walk = (v) => {
    if (typeof v === 'string') return omitSecrets(v, relevant);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [omitSecrets(k, relevant), walk(x)]));
    }
    return v;
  };
  return relevant.length === 0 ? value : walk(value);
}

export function evidenceDirFor(repoRoot) {
  return join(repoRoot, 'artifacts', 'ai-study');
}

// Relatórios são derivados, fora do diretório de evidências: gerá-los nunca toca uma execução.
export function reportDirFor(repoRoot) {
  return join(repoRoot, 'artifacts', 'ai-study-reports');
}
