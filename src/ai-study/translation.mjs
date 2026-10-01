// Regras da tradução: entrada formatada, identidade do candidato, validade da saída e metadados do runtime.
export const MAX_INPUT_TOKENS = 2048;
export const CANDIDATE_QUANTIZATION = 'Q6_K';

// A contagem só vale do tokenizer do modelo identificado; nunca se trunca a entrada.
export function checkInputTokens(count, tokenizer) {
  if (!count || !Number.isInteger(count.count) || count.count < 0 || count.tokenizer !== tokenizer) {
    return {
      reason: 'token_count_unavailable',
      token_count: Number.isInteger(count?.count) ? count.count : null,
      tokenizer: count?.tokenizer ?? null,
      justification:
        count?.justification ?? `sem contagem inteira pelo tokenizer correspondente a ${JSON.stringify(tokenizer)}`,
    };
  }
  if (count.count > MAX_INPUT_TOKENS) {
    return {
      reason: 'input_limit',
      token_count: count.count,
      tokenizer: count.tokenizer,
      limit: MAX_INPUT_TOKENS,
      justification: `entrada formatada com ${count.count} tokens excede ${MAX_INPUT_TOKENS}; não é truncada`,
    };
  }
  return null;
}

// Identidade vem da resposta do runtime, não do nome solicitado; não há troca para outro modelo.
export function checkIdentity(model, requested) {
  if (!model) return { reason: 'model_unavailable', justification: `modelo ${requested} indisponível no runtime` };
  if (model.id !== requested) {
    return { reason: 'model_mismatch', justification: `runtime identificou ${model.id}, não ${requested}` };
  }
  if (String(model.quantization ?? '').toUpperCase() !== CANDIDATE_QUANTIZATION) {
    return {
      reason: 'model_mismatch',
      justification: `quantização retornada ${model.quantization ?? 'não informada'}, candidato exige ${CANDIDATE_QUANTIZATION}`,
    };
  }
  return null;
}

export function invalidTranslationReason(response) {
  if (typeof response.output !== 'string' || response.output.trim() === '') return 'empty_output';
  if (response.finish_reason === 'length') return 'output_limit';
  return null;
}

const UNAVAILABLE = {
  model: 'o runtime não informou o modelo que gerou a resposta',
  tokens: 'o runtime não informou o uso de tokens desta chamada',
  memory: 'o runtime não informou memória nesta chamada; tamanho de download não é medição de VRAM',
};

function describe(field, value) {
  return value === null || value === undefined
    ? { available: false, justification: UNAVAILABLE[field] }
    : { available: true, value };
}

export function runtimeInfo(response) {
  return {
    model: describe('model', response.model),
    tokens: describe('tokens', response.usage),
    memory: describe('memory', response.memory),
  };
}
