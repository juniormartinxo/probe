import type {
  AssessmentChoice,
  Assessor,
  AssessorOutcome,
  CoverageInput,
  ImpactInput,
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

// Desfecho concluído de uma Avaliação de impacto, com o julgamento dado.
export const impactOutcome = (choice: AssessmentChoice, confidence = 0.9): AssessorOutcome<Verdict> => ({
  status: "completed",
  model: JEV_MODEL,
  result: verdict(choice, confidence),
});

// `Assessor` falso: desfechos na ordem; sem roteiro, `yes` em todos os Pontos e, no impacto, `no`
// com confiança (a Confirmação continua valendo).
export class FakeAssessor implements Assessor {
  readonly model = JEV_MODEL;
  readonly inputs: CoverageInput[] = [];
  readonly impactInputs: ImpactInput[] = [];
  private readonly steps: Step[] = [];
  private readonly impactSteps: AssessorOutcome<Verdict>[] = [];

  willRespond(...steps: Step[]): this {
    this.steps.push(...steps);
    return this;
  }

  willAssessImpact(...outcomes: AssessorOutcome<Verdict>[]): this {
    this.impactSteps.push(...outcomes);
    return this;
  }

  async assessImpact(input: ImpactInput): Promise<AssessorOutcome<Verdict>> {
    this.impactInputs.push(input);
    return this.impactSteps.shift() ?? impactOutcome("no");
  }

  async assessCoverage(input: CoverageInput): Promise<AssessorOutcome<Verdicts>> {
    this.inputs.push(input);
    const step = this.steps.shift() ?? coverageOutcome();
    return typeof step === "function" ? step(input) : step;
  }
}
