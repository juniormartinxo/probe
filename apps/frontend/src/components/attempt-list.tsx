import type { Attempt } from "@/api";
import { formatDate } from "@/lib/format";
import { attemptStatusName, usageSummary } from "@/refinement";

// Tentativas de uma Solicitação à IA, com CLI, modelo e consumo de cada uma.
export function AttemptList({ attempts }: { attempts: Attempt[] }) {
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer">Tentativas da Solicitação à IA ({attempts.length})</summary>
      <ol className="mt-2 flex flex-col gap-1">
        {attempts.map((attempt) => (
          <li key={attempt.id}>
            Tentativa {attempt.number} · {attempt.cli} · {attempt.model} · {attemptStatusName(attempt.status)} ·{" "}
            {usageSummary(attempt.usage)} · {formatDate(attempt.startedAt)}
          </li>
        ))}
      </ol>
    </details>
  );
}
