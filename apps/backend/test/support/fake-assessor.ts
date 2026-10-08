import type {
  AssessmentChoice,
  Assessor,
  AssessorOutcome,
  CoverageInput,
  Verdict,
} from "../../src/modules/assessments/assessor.ts";

export const JEV_MODEL = "jev-de-teste";

// Julgamento com a escolha e a confiança dadas; o restante da probabilidade fica com as outras duas.
export function verdict(choice: AssessmentChoice, confidence = 0.9): Verdict {
  const rest = (1 - confidence) / 2;
  const probabilities = { yes: rest, no: rest, insufficient: rest };
  probabilities[choice] = confidence;
  return { choice, probabilities, confidence };
}

type Verdicts = Record<string, Verdict>;

// Desfecho concluído com `yes` em cada Ponto recebido, salvo os dados em `overrides`.
export const coverageOutcome =
  (overrides: Verdicts = {}) =>
  (input: CoverageInput): AssessorOutcome<Verdicts> => ({
    status: "completed",
    model: JEV_MODEL,
    result: Object.fromEntries(input.stagePoints.map((point) => [point.key, overrides[point.key] ?? verdict("yes")])),
  });

type Step = AssessorOutcome<Verdicts> | ((input: CoverageInput) => AssessorOutcome<Verdicts>);

// `Assessor` falso: desfechos na ordem; sem roteiro, `yes` em todos os Pontos.
export class FakeAssessor implements Assessor {
  readonly model = JEV_MODEL;
  readonly inputs: CoverageInput[] = [];
  private readonly steps: Step[] = [];

  willRespond(...steps: Step[]): this {
    this.steps.push(...steps);
    return this;
  }

  async assessCoverage(input: CoverageInput): Promise<AssessorOutcome<Verdicts>> {
    this.inputs.push(input);
    const step = this.steps.shift() ?? coverageOutcome();
    return typeof step === "function" ? step(input) : step;
  }
}
