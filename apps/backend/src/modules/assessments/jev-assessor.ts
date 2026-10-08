import {
  assessmentChoices,
  type AssessmentChoice,
  type Assessor,
  type AssessorOutcome,
  type Verdict,
} from "./assessor.ts";
import { coverageRequest } from "./coverage-rubric.ts";

// Endpoint da API do Jev. Fixo: só os testes apontam o Assessor para outro endereço.
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface JevSettings {
  url: string;
  // Chave da API do Jev, só no ambiente do backend; sem ela, nenhuma Avaliação é enviada.
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
}

// As probabilidades somam 1 a menos do arredondamento.
const SUM_TOLERANCE = 1e-6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isChoice = (value: unknown): value is AssessmentChoice => assessmentChoices.some((choice) => choice === value);

// Um julgamento Choice completo e coerente, ou nada: nenhuma escolha é inferida de texto.
function verdictFrom(value: unknown): Verdict | undefined {
  if (!isRecord(value) || value.type !== "choice" || !isChoice(value.choice) || !isUnit(value.confidence)) return undefined;
  const { probabilities } = value;
  if (!isRecord(probabilities) || Object.keys(probabilities).some((key) => !isChoice(key))) return undefined;
  const values = assessmentChoices.map((choice) => probabilities[choice]);
  if (!values.every(isUnit)) return undefined;
  if (Math.abs(values.reduce((sum, item) => sum + item, 0) - 1) > SUM_TOLERANCE) return undefined;
  return {
    choice: value.choice,
    probabilities: { yes: values[0]!, no: values[1]!, insufficient: values[2]! },
    confidence: value.confidence,
  };
}

const failed = (reason: Extract<AssessorOutcome<never>, { status: "failed" }>["reason"], message: string) =>
  ({ status: "failed", reason, message }) as const;

// O corpo de erro do Jev não é repetido: pode ecoar o pedido.
function httpFailure(status: number): AssessorOutcome<never> {
  if (status === 401 || status === 403) return failed("jev_unauthenticated", `O Jev recusou a chave (HTTP ${status}). Confira TYPESAFE_API_KEY.`);
  if (status === 429) return failed("jev_rate_limited", "O Jev recusou por limite de uso (HTTP 429). Tente de novo mais tarde.");
  if (status >= 500) return failed("jev_unavailable", `O Jev está indisponível ou sobrecarregado (HTTP ${status}).`);
  return failed("jev_error", `O Jev recusou a Avaliação (HTTP ${status}).`);
}

// Assessor real: um POST à API do Jev por Avaliação, sem SDK e sem novas tentativas automáticas; uma
// nova tentativa depende do usuário.
export function createJevAssessor({ url, apiKey, model, timeoutMs }: JevSettings): Assessor {
  return {
    model,
    async assessCoverage(input) {
      if (!apiKey) {
        return failed("jev_not_configured", "TYPESAFE_API_KEY não definida no backend; defina-a no .env.local e reinicie (make up).");
      }
      const { state, questions } = coverageRequest(input);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ state, model, questions }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return failed(
          "jev_unavailable",
          timedOut ? `O Jev não respondeu em ${Math.round(timeoutMs / 1000)} s.` : `Não foi possível falar com o Jev em ${url}.`,
        );
      }
      if (!response.ok) return httpFailure(response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return failed("invalid_output", "A resposta do Jev não veio em JSON.");
      }
      if (!isRecord(body) || typeof body.model !== "string" || !isRecord(body.answers)) {
        return failed("invalid_output", "A resposta do Jev veio sem o modelo ou sem as respostas.");
      }
      const answers = body.answers;
      const result: Record<string, Verdict> = {};
      const invalid: string[] = [];
      for (const key of Object.keys(questions)) {
        const verdict = verdictFrom(answers[key]);
        if (verdict) result[key] = verdict;
        else invalid.push(key);
      }
      if (invalid.length > 0) return failed("invalid_output", `O Jev não devolveu um julgamento válido para: ${invalid.join(", ")}.`);
      return { status: "completed", model: body.model, result };
    },
  };
}
