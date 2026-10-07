// Etapas do PROBE, na ordem em que um Processo as percorre.
export const stages = ["P", "R", "O", "B", "E"] as const;

export type Stage = (typeof stages)[number];
