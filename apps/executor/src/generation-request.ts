// Operações de geração que o executor aceita. Cada uma vira uma invocação fixa da CLI; o que vem
// do backend só preenche argumentos validados aqui.
export const operations = ["generate_text"] as const;
export type Operation = (typeof operations)[number];

export interface GenerationRequest {
  id: string;
  operation: Operation;
  model: string;
  prompt: string;
}

export type RequestError = "invalid_request" | "invalid_id" | "unknown_operation" | "invalid_model" | "invalid_prompt";

export type ParseResult = { ok: true; request: GenerationRequest } | { ok: false; error: RequestError };

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
// Alias ("sonnet") ou nome completo ("claude-opus-5-5[1m]"); começa por letra ou dígito, então
// nunca é lido como opção da CLI.
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

const isOperation = (value: unknown): value is Operation => operations.some((operation) => operation === value);

export function parseGenerationRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid_request" };
  const { id, operation, model, prompt } = body as Record<string, unknown>;
  if (typeof id !== "string" || !idPattern.test(id)) return { ok: false, error: "invalid_id" };
  if (!isOperation(operation)) return { ok: false, error: "unknown_operation" };
  if (typeof model !== "string" || !modelPattern.test(model)) return { ok: false, error: "invalid_model" };
  if (typeof prompt !== "string" || prompt.trim() === "") return { ok: false, error: "invalid_prompt" };
  return { ok: true, request: { id, operation, model, prompt } };
}
