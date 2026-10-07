import type { Stage } from "./api";

export const stages: { stage: Stage; name: string }[] = [
  { stage: "P", name: "Problema" },
  { stage: "R", name: "Restrições" },
  { stage: "O", name: "Opções" },
  { stage: "B", name: "Balanceamento" },
  { stage: "E", name: "Execução" },
];

export function stageName(stage: Stage): string {
  return stages.find((s) => s.stage === stage)?.name ?? stage;
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
