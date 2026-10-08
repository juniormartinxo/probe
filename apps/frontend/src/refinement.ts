import type { Attempt, AttemptStatus, Cli, CloakProfile, FailureReason, StatementOrigin, Usage } from "./api";

const cliNames: Record<Cli, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  agy: "Gemini (agy)",
};

export function cliName(cli: Cli): string {
  return cliNames[cli];
}

// Por que a tentativa falhou, nos termos da CLI que ela usou.
const failureText: Record<FailureReason, (cli: Cli) => string> = {
  executor_unavailable: () => "O executor não está disponível.",
  executor_error: () => "O executor recusou a solicitação.",
  cloak_unavailable: () => "O Cloak não foi encontrado no executor.",
  cloak_profile_not_found: () => "O perfil escolhido não existe no Cloak. Escolha outro na configuração.",
  cloak_error: (cli) => `O Cloak falhou antes de chamar o ${cliName(cli)}.`,
  cloak_unauthenticated: (cli) =>
    `O perfil do Cloak não está autenticado no ${cliName(cli)}. Rode cloak login ${cli} no host.`,
  cli_unavailable: (cli) =>
    `O ${cliName(cli)} não foi encontrado no executor ou não está configurado no Cloak (cli.${cli} no config.toml).`,
  cli_rate_limited: (cli) => `O ${cliName(cli)} atingiu o limite de uso. Você pode tentar com outra CLI.`,
  cli_unauthenticated: (cli) => `O ${cliName(cli)} não está autenticado.`,
  cli_error: (cli) => `O ${cliName(cli)} falhou.`,
  invalid_output: () => "A resposta da IA veio incompleta ou fora do formato esperado.",
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
export function attemptProblem(attempt: Pick<Attempt, "status" | "failureReason" | "cli">): string {
  switch (attempt.status) {
    case "failed":
      return attempt.failureReason ? failureText[attempt.failureReason](attempt.cli) : "A solicitação falhou.";
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
