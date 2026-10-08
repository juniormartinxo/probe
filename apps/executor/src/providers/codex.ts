import {
  exitMessage,
  failed,
  invalidOutput,
  isRecord,
  jsonLines,
  numberOrNull,
  parseJson,
  usageOrNull,
  type CliExit,
  type GenerationOutcome,
  type Provider,
  type Usage,
} from "./provider.ts";

// O codex conta a entrada lida do cache dentro de input_tokens; aqui ela fica à parte.
function usageFrom(usage: unknown): Usage | null {
  if (!isRecord(usage)) return null;
  const input = numberOrNull(usage.input_tokens);
  const cached = numberOrNull(usage.cached_input_tokens);
  return usageOrNull({
    inputTokens: input !== null && cached !== null ? input - cached : input,
    outputTokens: numberOrNull(usage.output_tokens),
    cacheCreationInputTokens: numberOrNull(usage.cache_write_input_tokens),
    cacheReadInputTokens: cached,
    costUsd: null,
  });
}

// As mensagens de erro do provedor chegam como o JSON da API; fica a mensagem, com o status HTTP.
function readableError(message: string): string {
  const parsed = parseJson(message);
  if (!isRecord(parsed) || !isRecord(parsed.error) || typeof parsed.error.message !== "string") return message;
  return typeof parsed.status === "number" ? `${parsed.status}: ${parsed.error.message}` : parsed.error.message;
}

const messageOf = (event: Record<string, unknown> | undefined): string | undefined => {
  const message = isRecord(event?.error) ? event.error.message : event?.message;
  return typeof message === "string" ? readableError(message) : undefined;
};

// A resposta é o último `agent_message` de um turno concluído; um turno que falhou traz o motivo.
function outcome(exit: CliExit): GenerationOutcome {
  const events = jsonLines(exit.stdout);
  const turnCompleted = events.findLast((event) => event.type === "turn.completed");
  const turnFailed = events.findLast((event) => event.type === "turn.failed");
  const usage = usageFrom(turnCompleted?.usage);
  if (exit.exitCode !== 0 || turnFailed) {
    const message = messageOf(turnFailed) ?? messageOf(events.findLast((event) => event.type === "error"));
    return failed("cli_error", exit, message ?? exitMessage("codex", exit), usage);
  }
  const answer = events
    .flatMap((event) => (event.type === "item.completed" && isRecord(event.item) ? [event.item] : []))
    .findLast((item) => item.type === "agent_message" && typeof item.text === "string");
  if (!turnCompleted || !answer) return failed("invalid_output", exit, invalidOutput("codex"), usage);
  return { status: "completed", output: answer.text as string, usage };
}

// Codex: `codex exec` não interativo, eventos JSONL (trazem o consumo), sem gravar a sessão em disco
// e sem a configuração e as regras do usuário (a autenticação continua a do perfil). Nada além de
// gerar texto: sem shell, apps, navegador, uso do computador, subagentes nem plugins, e com o sandbox
// só de leitura. Não precisa de um repositório git. O prompt vai pelo stdin (`-`).
const disabledFeatures = ["shell_tool", "apps", "browser_use", "computer_use", "multi_agent", "plugins"];

export const codex: Provider = {
  args: (model) => [
    "exec",
    "--json",
    "--model",
    model,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
    "-",
  ],
  delivery: { via: "stdin", content: (prompt) => prompt },
  outcome,
};
