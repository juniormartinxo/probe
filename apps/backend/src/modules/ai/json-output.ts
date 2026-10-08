// Lê o objeto JSON que a IA devolveu, puro ou dentro de um bloco de código Markdown. Qualquer
// outra coisa (texto antes ou depois, JSON truncado) é recusada: uma resposta parcial nunca vira
// resultado.
export function parseJsonObject(output: string): Record<string, unknown> | undefined {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(output);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced ? fenced[1]! : output);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

export const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const isFilledText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
