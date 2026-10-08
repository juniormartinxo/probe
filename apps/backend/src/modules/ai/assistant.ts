// Porta da IA. A implementação real chama o executor; nos testes, uma versão falsa a substitui.

import type { ItemStatement } from "../process/constraints-and-preferences.ts";
import type { StagePoint } from "../process/stage-points.ts";
import type { Stage } from "../process/stage.ts";

// CLIs que o executor chama, pelo nome com que o Cloak as registra. Gemini roda pelo `agy`.
export const clis = ["claude", "codex", "grok", "agy"] as const;
export type Cli = (typeof clis)[number];

export const isCli = (value: unknown): value is Cli => clis.some((cli) => cli === value);

// Perfil do Cloak com que a CLI roda: o que o Cloak liga ao diretório de trabalho do executor, ou
// um perfil escolhido pelo nome. As contas e credenciais da CLI são as do perfil.
export type CloakProfile = { source: "directory" } | { source: "explicit"; name: string };

// Fora do domínio (banco, executor), o perfil do diretório é a ausência de um nome.
export const cloakProfileName = (profile: CloakProfile): string | null =>
  profile.source === "explicit" ? profile.name : null;

export const cloakProfileNamed = (name: string | null): CloakProfile =>
  name === null ? { source: "directory" } : { source: "explicit", name };

// Consumo como a CLI informou; o que ela não informou fica null, nunca zero.
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
}

export type FailureReason =
  | "executor_unavailable"
  | "executor_error"
  | "cloak_unavailable"
  | "cloak_profile_not_found"
  // Outro erro do próprio Cloak, como a configuração dele ilegível.
  | "cloak_error"
  // O perfil do Cloak não está autenticado na CLI.
  | "cloak_unauthenticated"
  | "cli_unavailable"
  | "cli_rate_limited"
  // Só em tentativas anteriores ao Cloak.
  | "cli_unauthenticated"
  | "cli_error"
  | "invalid_output";

// Só "completed" traz resultado; qualquer outro desfecho chega sem conteúdo aproveitável.
// "interrupted": a geração começou e o resultado ficou desconhecido (por exemplo, o executor caiu).
export type AssistantOutcome<T> =
  | { status: "completed"; result: T; usage: Usage | null }
  | { status: "failed"; reason: FailureReason; message: string; usage: Usage | null }
  | { status: "timed_out" }
  | { status: "canceled" }
  | { status: "interrupted"; message: string };

export interface AttemptContext {
  // Identifica a tentativa no executor; permite cancelá-la.
  id: string;
  cli: Cli;
  model: string;
  cloakProfile: CloakProfile;
  signal: AbortSignal;
}

// Proposta de enunciado mais claro, com o que a IA achou ambíguo ou faltando na descrição.
export interface StatementProposal {
  statement: string;
  ambiguities: string[];
  missingInformation: string[];
}

export type AnswerType = "single_choice" | "multiple_choice" | "free_text";

// Pergunta como a IA a formulou, servindo a um ou mais Pontos da etapa (pelas chaves). Só as
// Perguntas de alternativa têm alternativas.
export interface GeneratedQuestion {
  // A pergunta como é feita ao usuário.
  wording: string;
  // Do que a Pergunta trata, em poucas palavras.
  subject: string;
  contextRelation: string;
  // Por que a Pergunta está sendo feita, quando a IA julga necessário dizer.
  rationale: string | null;
  stagePoints: string[];
  // Referência (`ref`) da Pergunta já feita que esta reformula, se for uma reformulação.
  reformulates: string | null;
  answerType: AnswerType;
  choices: string[];
}

export interface GeneratedBlock {
  questions: GeneratedQuestion[];
}

// Pergunta já feita no Processo, como a IA a recebe: a resposta que vale, descrita em texto, ou o
// registro de que o usuário não sabe.
export interface AskedQuestion {
  // "2.1": Pergunta 1 do Bloco 2. É como a IA se refere a ela.
  ref: string;
  wording: string;
  stagePoints: string[];
  answer: string | null;
  unknown: boolean;
}

// Resposta que a IA apontou como ambígua ao sintetizar um Bloco, pela referência da Pergunta.
export interface AmbiguousAnswer {
  question: string;
  reason: string;
}

// Respostas confirmadas de uma Etapa anterior, já confirmada: o contexto com que a IA trabalha na atual.
export interface ConfirmedStageAnswers {
  stage: Stage;
  answers: { ref: string; wording: string; answer: string }[];
}

// O que a IA recebe para gerar um Bloco: o problema, as Etapas já confirmadas, os Pontos ainda
// abertos da Etapa e o que já foi perguntado, para não perguntar de novo.
export interface BlockInput {
  stage: Stage;
  originalDescription: string;
  problemStatement: string;
  confirmedStages: ConfirmedStageAnswers[];
  // As Restrições e Preferências em vigor, como o usuário as registrou.
  constraints: ItemStatement[];
  preferences: ItemStatement[];
  openStagePoints: StagePoint[];
  askedQuestions: AskedQuestion[];
  // Sínteses dos Blocos anteriores da Etapa, como o usuário as confirmou.
  confirmedSyntheses: string[];
  // Respostas que as sínteses confirmadas apontaram como ambíguas: candidatas a reformulação.
  ambiguousAnswers: AmbiguousAnswer[];
}

// O que a IA recebe para sintetizar um Bloco e sugerir a cobertura dos Pontos ainda abertos.
export interface SynthesisInput {
  stage: Stage;
  originalDescription: string;
  problemStatement: string;
  confirmedStages: ConfirmedStageAnswers[];
  constraints: ItemStatement[];
  preferences: ItemStatement[];
  openStagePoints: StagePoint[];
  blockNumber: number;
  // As Perguntas do Bloco sintetizado.
  questions: AskedQuestion[];
  // As Perguntas dos Blocos anteriores da Etapa.
  earlierQuestions: AskedQuestion[];
}

// Sugestão da IA sobre um Ponto aberto: se as respostas já o cobrem, e por quê.
export interface CoverageSuggestion {
  stagePoint: string;
  covered: boolean;
  reason: string;
}

export interface GeneratedSynthesis {
  synthesis: string;
  // Uma sugestão para cada Ponto aberto.
  coverage: CoverageSuggestion[];
  ambiguousAnswers: AmbiguousAnswer[];
}

export interface Assistant {
  refineProblemStatement(
    input: { originalDescription: string },
    context: AttemptContext,
  ): Promise<AssistantOutcome<StatementProposal>>;
  generateBlock(input: BlockInput, context: AttemptContext): Promise<AssistantOutcome<GeneratedBlock>>;
  synthesizeBlock(input: SynthesisInput, context: AttemptContext): Promise<AssistantOutcome<GeneratedSynthesis>>;
  // Pedido mínimo à CLI, só para saber se a cadeia até ela funciona; o resultado é a resposta crua.
  testConnection(context: AttemptContext): Promise<AssistantOutcome<string>>;
}
