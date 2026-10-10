import type {
  Assistant,
  AssistantOutcome,
  AttemptContext,
  BlockInput,
  GeneratedResolutionQuestion,
  ResolutionQuestionInput,
  GeneratedBlock,
  GeneratedOptions,
  GeneratedRecommendation,
  GeneratedSynthesis,
  OptionProposalInput,
  RecommendationInput,
  StatementProposal,
  SynthesisInput,
  Usage,
} from "../../src/modules/ai/assistant.ts";

export const defaultProposal: StatementProposal = {
  statement: "O deploy leva 40 minutos e bloqueia o time durante a manhã.",
  ambiguities: ["Não está claro se os 40 minutos incluem os testes."],
  missingInformation: ["Com que frequência o deploy é feito?"],
};

export const defaultBlock: GeneratedBlock = {
  questions: [
    {
      wording: "A demora do deploy é o problema em si ou sintoma de outra coisa?",
      subject: "Sintoma ou causa",
      contextRelation: "O enunciado fala da demora do deploy, mas não do que a provoca.",
      rationale: "Separar o sintoma do problema real evita resolver a coisa errada.",
      stagePoints: ["real_problem"],
      reformulates: null,
      answerType: "single_choice",
      choices: ["A demora é o problema em si", "A demora é sintoma de outra coisa", "Não sei"],
    },
    {
      wording: "O que a demora do deploy já causou?",
      subject: "Efeitos da demora",
      contextRelation: "O time perde a manhã esperando o deploy.",
      rationale: null,
      stagePoints: ["consequence", "urgency"],
      reformulates: null,
      answerType: "multiple_choice",
      choices: ["Atraso nas entregas", "Horas extras", "Clientes reclamando"],
    },
    {
      wording: "Por que resolver isso agora, e não daqui a seis meses?",
      subject: "Por que agora",
      contextRelation: "O problema existe há algum tempo.",
      rationale: "A urgência define quanto esforço cabe agora.",
      stagePoints: ["urgency"],
      reformulates: null,
      answerType: "free_text",
      choices: [],
    },
  ],
};

export const defaultResolutionQuestion: GeneratedResolutionQuestion = {
  question: "Existe uma alternativa provisória até a integração ficar pronta, o prazo deve ser revisto ou a dependência foi mal entendida?",
};

// Síntese padrão do primeiro Bloco: sugere cobertos o problema real e a consequência, e aberta a
// urgência.
export const defaultSynthesis: GeneratedSynthesis = {
  synthesis: "A demora do deploy é sintoma de outra coisa e já atrasou entregas; a diretoria cobrou uma solução.",
  coverage: [
    { stagePoint: "real_problem", covered: true, reason: "A pessoa disse que a demora é sintoma de outra coisa." },
    { stagePoint: "consequence", covered: true, reason: "As entregas já atrasaram." },
    { stagePoint: "urgency", covered: false, reason: "A cobrança da diretoria não explica por que agora." },
  ],
  ambiguousAnswers: [],
};

// Proposta padrão de Opções: uma que elimina o problema e uma manual.
export const defaultOptions: GeneratedOptions = {
  options: [
    { statement: "Fazer o deploy só dos serviços alterados", description: null, stagePoints: ["eliminate_problem"] },
    { statement: "Rodar o deploy à mão, fora do horário do time", description: null, stagePoints: ["simplest_solution"] },
  ],
};

// Recomendação padrão: uma linha para cada Opção viável que a IA recebe, recomendando a primeira.
export function defaultRecommendation(input: RecommendationInput): GeneratedRecommendation {
  const viable = input.options.filter((option) => option.viability === "viable");
  return {
    comparisons: viable.map((option) => ({
      option: option.ref,
      gains: "Resolve parte da demora.",
      losses: "Exige alguma mudança no time.",
      effort: "Médio.",
      scalability: "Acompanha o crescimento por um tempo.",
      maintenance: "Pouca.",
      reversibility: "Reversível.",
    })),
    recommendedOption: viable[0]?.ref ?? "O1",
    rationale: "Atende as Restrições com o menor esforço.",
  };
}

export function completed<T = StatementProposal>(
  result: T = defaultProposal as T,
  usage: Usage | null = null,
): AssistantOutcome<T> {
  return { status: "completed", result, usage };
}

export interface ReceivedAttempt<I, T> {
  input: I;
  context: AttemptContext;
  // Responde uma tentativa retida por willHold().
  respond(outcome: AssistantOutcome<T>): void;
}

const HOLD = Symbol("hold");

// Roteiro de uma operação: desfechos na ordem; sem roteiro, conclui com o resultado padrão (que pode
// depender do que a operação recebeu).
// Uma tentativa retida fica pendente até o teste respondê-la, e termina como cancelada se a geração
// for abortada antes disso.
export class Script<I, T> {
  readonly attempts: ReceivedAttempt<I, T>[] = [];
  private readonly steps: (AssistantOutcome<T> | typeof HOLD)[] = [];

  constructor(private readonly fallback: (input: I) => AssistantOutcome<T>) {}

  willRespond(...outcomes: AssistantOutcome<T>[]): this {
    this.steps.push(...outcomes);
    return this;
  }

  willHold(): this {
    this.steps.push(HOLD);
    return this;
  }

  run(input: I, context: AttemptContext): Promise<AssistantOutcome<T>> {
    const step = this.steps.shift() ?? this.fallback(input);
    return new Promise((resolve) => {
      this.attempts.push({ input, context, respond: resolve });
      if (step !== HOLD) return resolve(step);
      context.signal.addEventListener("abort", () => resolve({ status: "canceled" }), { once: true });
    });
  }
}

// `Assistant` falso, com um roteiro por operação.
export class FakeAssistant implements Assistant {
  readonly refinement = new Script<{ originalDescription: string }, StatementProposal>(() => completed());
  readonly block = new Script<BlockInput, GeneratedBlock>(() => completed(defaultBlock));
  readonly synthesis = new Script<SynthesisInput, GeneratedSynthesis>(() => completed(defaultSynthesis));
  readonly resolutionQuestion = new Script<ResolutionQuestionInput, GeneratedResolutionQuestion>(() => completed(defaultResolutionQuestion));
  readonly options = new Script<OptionProposalInput, GeneratedOptions>(() => completed(defaultOptions));
  readonly recommendation = new Script<RecommendationInput, GeneratedRecommendation>((input) => completed(defaultRecommendation(input)));
  readonly connection = new Script<null, string>(() => completed("ok"));

  refineProblemStatement(input: { originalDescription: string }, context: AttemptContext) {
    return this.refinement.run(input, context);
  }

  generateBlock(input: BlockInput, context: AttemptContext) {
    return this.block.run(input, context);
  }

  synthesizeBlock(input: SynthesisInput, context: AttemptContext) {
    return this.synthesis.run(input, context);
  }

  formulateResolutionQuestion(input: ResolutionQuestionInput, context: AttemptContext) {
    return this.resolutionQuestion.run(input, context);
  }

  proposeOptions(input: OptionProposalInput, context: AttemptContext) {
    return this.options.run(input, context);
  }

  recommendOption(input: RecommendationInput, context: AttemptContext) {
    return this.recommendation.run(input, context);
  }

  testConnection(context: AttemptContext) {
    return this.connection.run(null, context);
  }
}
