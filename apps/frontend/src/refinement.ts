import type { Attempt, AttemptStatus, CloakProfile, FailureReason, StatementOrigin, Usage } from "./api";

const failureText: Record<FailureReason, string> = {
  executor_unavailable: "O executor não está disponível.",
  executor_error: "O executor recusou a solicitação.",
  cloak_unavailable: "O Cloak não foi encontrado no executor.",
  cloak_profile_not_found: "O perfil escolhido não existe no Cloak. Escolha outro na configuração.",
  cloak_unauthenticated: "O perfil do Cloak não está autenticado no claude. Rode cloak login claude no host.",
  cli_unavailable: "O claude não foi encontrado no executor.",
  cli_rate_limited: "O claude atingiu o limite de uso.",
  cli_unauthenticated: "O claude não está autenticado.",
  cli_error: "O claude falhou.",
  invalid_output: "A resposta da IA veio incompleta ou fora do formato esperado.",
};

const statusText: Record<AttemptStatus, string> = {
  running: "em andamento",
  completed: "concluída",
  failed: "falhou",
  timed_out: "tempo esgotado",
  canceled: "cancelada",
  interrupted: "interrompida",
};

export function attemptStatusName(status: AttemptStatus): string {
  return statusText[status];
}

// Por que a tentativa não trouxe proposta, em uma frase.
export function attemptProblem(attempt: Pick<Attempt, "status" | "failureReason">): string {
  switch (attempt.status) {
    case "failed":
      return attempt.failureReason ? failureText[attempt.failureReason] : "A solicitação falhou.";
    case "timed_out":
      return "A IA demorou demais e a solicitação foi encerrada.";
    case "interrupted":
      return "A solicitação foi interrompida antes de terminar; o resultado não foi recebido.";
    case "canceled":
      return "A solicitação foi cancelada.";
    default:
      return "";
  }
}

// Com que perfil do Cloak a CLI rodou.
export function cloakProfileSummary(profile: CloakProfile | null): string {
  if (!profile) return "sem Cloak";
  return profile.source === "directory" ? "perfil do diretório" : `perfil ${profile.name}`;
}

const integer = new Intl.NumberFormat("pt-BR");
const dollars = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

// Só o que a CLI informou; ausência não é custo zero.
export function usageSummary(usage: Usage | null): string {
  if (!usage) return "consumo não informado";
  const parts = [
    usage.inputTokens !== null && `${integer.format(usage.inputTokens)} tokens de entrada`,
    usage.outputTokens !== null && `${integer.format(usage.outputTokens)} de saída`,
    usage.costUsd !== null && dollars.format(usage.costUsd),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" · ") : "consumo não informado";
}

const originText: Record<StatementOrigin, string> = {
  proposal: "proposta da IA aceita como veio",
  corrected: "corrigido a partir da proposta da IA",
  written: "escrito por você",
};

export function originName(origin: StatementOrigin): string {
  return originText[origin];
}
