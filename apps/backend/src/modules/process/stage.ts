// Etapas do PROBE, na ordem em que um Processo as percorre.
export const stages = ["P", "R", "O", "B", "E"] as const;

export type Stage = (typeof stages)[number];

export const isStage = (value: string): value is Stage => stages.some((stage) => stage === value);

// A Etapa que a Confirmação da atual abre; a última não tem seguinte.
export function nextStage(stage: Stage): Stage | undefined {
  return stages[stages.indexOf(stage) + 1];
}
