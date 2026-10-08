import type { ProcessStatus, Stage, StagePointStatus } from "./api";

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

export function statusName(status: ProcessStatus): string {
  return status === "open" ? "aberto" : "finalizado";
}

export const stagePointStatusText: Record<StagePointStatus, string> = {
  open: "aberto",
  covered: "coberto",
  inapplicable: "inaplicável",
  absent: "ausência registrada",
};
