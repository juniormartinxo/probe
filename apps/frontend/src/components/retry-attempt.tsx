import { useState } from "react";
import { Link } from "react-router";
import { ApiError, clis, type Attempt, type Cli } from "@/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cliName } from "@/refinement";

// Nova tentativa de uma Solicitação à IA que não trouxe resultado. A CLI começa como a da tentativa
// anterior; trocar é escolha do usuário, nunca automática. O modelo e o perfil do Cloak são os da
// configuração.
export function RetryAttempt({
  last,
  retry,
  onChange,
}: {
  last: Attempt;
  retry: (cli: Cli) => Promise<unknown>;
  onChange: () => void;
}) {
  const [cli, setCli] = useState<Cli>(last.cli);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<"model" | "other">();
  const id = `retry-cli-${last.id}`;

  async function handleRetry() {
    setSending(true);
    setError(undefined);
    try {
      await retry(cli);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "cli_model_not_configured") setError("model");
      // Outra aba pode ter pedido antes; o estado recarregado mostra o que vale.
      else if (!(caught instanceof ApiError && caught.status === 409)) setError("other");
    } finally {
      setSending(false);
      onChange();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="font-normal">
          CLI
        </Label>
        <select
          id={id}
          value={cli}
          onChange={(event) => {
            setCli(event.target.value as Cli);
            setError(undefined);
          }}
          disabled={sending}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
        >
          {clis.map((option) => (
            <option key={option} value={option}>
              {cliName(option)}
              {option === last.cli ? " (a mesma)" : ""}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" disabled={sending} onClick={handleRetry}>
          {sending ? "Pedindo…" : "Tentar novamente"}
        </Button>
      </div>
      {error === "model" && (
        <p className="text-destructive text-sm">
          O {cliName(cli)} ainda não tem modelo escolhido.{" "}
          <Link to="/settings" className="underline">
            Escolha um na configuração
          </Link>{" "}
          ou tente com outra CLI.
        </p>
      )}
      {error === "other" && <p className="text-destructive text-sm">Não foi possível pedir a nova tentativa.</p>}
    </div>
  );
}
