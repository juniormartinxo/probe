// Catálogo de todo texto fixo do relatório (AC 33: prosa em português). Só dados: strings com
// lacunas `{nome}`, preenchidas por `text` com valores das evidências. `report.mjs` não tem prosa
// própria; C42 prova isso e fixa o hash deste catálogo. O Codex deu parecer editorial favorável
// no PR #7; a aprovação humana do português segue pendente. Mudar o texto exige nova revisão.

export const REPORT_TEXT = Object.freeze({
  sections: Object.freeze([
    'Configuração e proveniência',
    'Completude',
    'Originais e traduções',
    'Revisão semântica',
    'Comparação Jev',
    'Limitações',
  ]),
  arms: Object.freeze({ pt: 'PT (original)', en: 'EN (tradução)' }),
  outcomes: Object.freeze({ hit: 'acerto', miss: 'erro', absent: 'sem avaliação' }),
  statuses: Object.freeze({
    completed: 'coleta concluída',
    incomplete: 'coleta incompleta',
    rejected: 'coleta rejeitada',
    running: 'sem término registrado (processo encerrado durante a coleta)',
  }),
  // Códigos gravados nas evidências, apresentados em português com o código ao lado.
  reasons: Object.freeze({
    pt_missing: 'braço PT ausente',
    en_missing: 'braço EN ausente',
    pt_invalid: 'braço PT inválido',
    en_invalid: 'braço EN inválido',
    reference_mismatch: 'corpus ou gabarito divergente',
    instructions_mismatch: 'instruções divergentes',
    criteria_mismatch: 'critérios divergentes',
    jev_model_mismatch: 'versão Jev divergente',
    jev_model_unknown: 'versão Jev não identificada',
    invalid_translation: 'tradução inválida',
    temporary: 'arquivo temporário',
    not_evidence: 'não é evidência',
    not_in_manifest: 'não confirmado pelo manifesto',
  }),
  lines: Object.freeze({
    simulatedNotice: 'não são validação real do candidato, medição de VRAM nem ganho de tradução',
    none: 'nenhum',
    notRecorded: 'não registrado',

    // Conclusão e motivos.
    reasonSimulated: 'resultados simulados (fixture) não decidem sobre o candidato',
    reasonCollectionIncomplete: 'estado técnico {status}{reason}',
    reasonItemsNotExecuted: '{count} itens não executados',
    reasonItemsSkipped: '{count} itens não avaliados',
    reasonComparisonMissing: 'comparison.json ausente',
    reasonReviewPending: 'revisão semântica pendente em {items}',

    // Provas live (C50/C51).
    templateNotConfirmed: 'template oficial não confirmado',
    templateNotAdopted: 'template gravado não é o template oficial adotado na bancada',
    liveFixtureTranslation: 'evidência fixture: simulação não comprova a integração local',
    liveFixtureRelational: 'evidência fixture: simulação não comprova a avaliação Jev real',
    liveNoServer: 'servidor local não identificado',
    liveNoModel: 'modelo retornado pelo runtime não identificado',
    liveModelMismatch: 'modelo retornado {returned} diferente do solicitado {requested}',
    liveQuantization: 'quantização {quantization}, não {expected}',
    liveNotInformed: 'não informada',
    liveNoTCases: 'nenhuma tradução EN→PT planejada',
    liveTMissing: '{id}: tradução EN→PT ausente',
    liveProvenance: '{id}: proveniência {provenance}',
    liveDirection: '{id}: direção {direction}',
    liveTranslationStatus: '{id}: tradução {status}',
    liveOutputNoModel: '{id}: saída sem modelo identificado pelo runtime',
    liveOutputOtherModel: '{id}: saída gerada por {returned}, não {model}',
    liveNoTokenCount: '{id}: sem contagem de tokens da entrada',
    liveOtherTokenizer: '{id}: contagem pelo tokenizer {tokenizer}, não {model}',
    liveTooManyTokens: '{id}: entrada com {count} tokens acima de {max}',
    liveNoDuration: '{id}: sem duração real medida',
    liveNoTranslation: 'sem tradução PT→EN live válida',
    liveArmMissing: 'braço {arm} ausente',
    liveArmInvalid: 'braço {arm} sem resultados válidos live para todos os julgamentos enviados',
    liveArmsVersion: 'braços sem a mesma versão Jev identificada',
    liveEnNotDerived: 'braço en não deriva da tradução do caso',
    liveCaseProblems: '{id}: {problems}',
    liveNoRCases: 'nenhum caso R executado',

    // Disponibilidade e uso informados pelo runtime.
    notZeroCost: 'ausência de uso informado não é custo zero',
    availabilityMissing: '{label}: não registrado',
    availabilityValue: '{label}: {value}',
    availabilityUnavailable: '{label}: indisponível — {justification}{usage}',
    usageInformed: 'uso informado: {value}',
    usageUnavailable: 'uso: indisponível — {notZeroCost}',

    // Configuração e proveniência.
    tableJudgment: 'Julgamento',
    tableHits: '{arm} acertos',
    tableMisses: '{arm} erros',
    tableAbsent: '{arm} sem avaliação',
    configRun: '- Execução: {run}',
    configMode: '- Modo e proveniência: {mode} / {provenance}{simulated}',
    configSimulated: ' (simulado)',
    configTimes: '- Início e término: {started} — {finished}',
    configCorpus: '- Corpus: {path}, revisão {revision}',
    configCorpusHash: '- Hash do corpus: {hash}',
    configGabaritoHash: '- Hash do gabarito usado nesta execução: {hash}',
    configServer: '- Servidor local: {server}',
    configNoServer: 'nenhum (fixture não acessa a rede)',
    configLocalModel: '- Modelo local solicitado: {requested}; retornado pelo runtime: {returned}; quantização: {quantization}',
    configNotConfigured: 'não configurado',
    configNotIdentified: 'não identificado',
    configTemplate: '- Template de tradução: {id}, revisão {revision}, {official}',
    configTemplateOfficial: 'oficial confirmado',
    configTemplateNotOfficial: 'não confirmado como oficial ({justification})',
    configNoJustification: 'sem justificativa',
    configJev: '- Jev: destino {endpoint}, modelo solicitado {model}',
    configRubric: '- Rubrica Jev: {id}, revisão {revision}',
    configLimits: '- Limites de chamadas: {local} locais e {jev} Jev; usadas: {calls}',
    configTimeouts: '- Timeouts: local {local} s, Jev {jev} s; saída local máxima {tokens} tokens',

    // Completude.
    completenessState: '- Estado técnico: {status} — {label}{reason}',
    completenessUnknownState: 'estado desconhecido',
    completenessReason: ', motivo {reason}',
    completenessItems: '- Itens planejados: {planned}; concluídos: {completed}',
    completenessNotExecuted: '- Não executados: {items}',
    completenessSkipped: '- Não avaliados: {items}',
    completenessSkippedItem: '{item} — {reason}',
    completenessFailure: '- Falha que encerrou a coleta: item {item}, serviço {service}, motivo {reason}, pedido enviado {sent}, resultado remoto {outcome}: {message}',
    completenessBlocked: '- Bloqueio: {item} {reason}: {justification}',
    completenessComparisonError: '- Erro ao gravar a comparação: {error}',
    completenessIgnored: '- Arquivos ignorados (não são evidência): {files}',
    proofProven: 'comprovada{cases}',
    proofCases: ' (casos {cases})',
    proofUnproven: 'sem prova',
    proofLine: '- {label}: {status}{problems}',
    proofTranslation: 'Integração local real dos casos T (EN→PT)',
    proofRelational: 'Integração real tradução PT→EN e Jev pareado',
    completenessConclusion: '- Conclusão: {conclusion}',
    completenessConclusionReason: '  - {code}: {detail}',

    // Originais e traduções.
    noTranslations: 'Nenhuma tradução concluída nesta execução.',
    translationTokens: '{count} tokens (tokenizer {tokenizer})',
    translationNoTokens: 'sem contagem (fixture não tem tokenizer do candidato)',
    translationCase: '- Caso {case}, direção {direction}, proveniência {provenance}',
    translationState: '- Estado: {status}{invalid}',
    translationDuration: '- Duração: {duration} ms; entrada formatada: {tokens}',
    translationRuntime: '- Runtime — {model}; {tokens}; {memory}',
    runtimeModel: 'modelo',
    runtimeTokens: 'tokens',
    runtimeMemory: 'memória',
    translationOutput: '- Saída (sha256): {hash}',
    noOutput: 'sem saída',
    original: 'Original:',
    literalTranslation: 'Tradução literal:',

    // Revisão semântica.
    reviewIntro: 'Cada tradução é revisada pela saída concreta (hash sha256 da saída literal), por significado, entidades, valores, negações, condições e ambiguidades. Revisão registrada em {path}{missing}.',
    reviewMissing: ' (ainda inexistente)',
    reviewItem: '- {item} — {status} — saída {hash}',
    reviewReviewer: '  - Revisor: {reviewer}',
    reviewJustification: '  - Justificativa: {justification}',

    // Comparação Jev.
    jevNoComparison: 'Comparação ausente: a coleta terminou sem gravar `comparison.json`. Nenhuma métrica é apresentada.',
    jevGabarito: 'Gabarito usado: revisão {revision}, hash {hash}. Uma correção do gabarito gera nova revisão e nova comparação identificada; esta comparação não é recalculada com outra referência.',
    jevDescriptive: 'A concordância com o gabarito é medida descritiva, contada à parte do sucesso da integração.',
    jevCases: '- Casos relacionais: {count}',
    jevValid: '- Avaliações válidas {arm}: {valid} de {total}',
    jevPairs: '- Pares completos: {pairs} de {total}{cases}',
    jevByArm: '### Por braço e julgamento (todas as avaliações)',
    jevDenominator: 'Denominador por braço e julgamento: {count} casos; caso sem avaliação válida conta como sem avaliação.',
    jevPairedHeading: '### Pares completos (denominador {count})',
    jevIncompleteHeading: '### Pares incompletos',
    jevIncomplete: '- {case}: {reasons}',
    jevNone: 'Nenhum.',
    jevPairedResults: '### Resultados dos pares completos',
    jevNoPairs: 'Nenhum par completo.',
    jevPairHeader: '| Julgamento | Esperado | PT | EN |',
    jevIndividual: '### Avaliações individuais',
    jevDistributionsNote: 'Distribuições e confianças são descritivas, não limiares de produção.',
    jevNoEvaluations: 'Nenhuma avaliação concluída.',
    jevEvaluation: '- {item}: {status}, modelo retornado {model}, duração {duration} ms, {usage}{problems}',
    jevProblems: '; problemas: {problems}',
    jevDistribution: '  - {judgment}: escolha {choice}; distribuição {distribution}; confiança {confidence}',

    // Limitações.
    limitSimulated: '- Resultados simulados (fixture): {notice}. Traduções, escolhas e durações vêm de respostas controladas.',
    limitSample: '- Amostra de {count} casos relacionais: não estabelece acurácia geral nem calibração de confiança. Distribuições e confianças são descritivas, não limiares de produção.',
    limitCost: '- Uso indisponível não é custo zero. Sem tarifa identificada nas evidências, nenhum uso é convertido em dinheiro e nenhuma economia é estimada.',
    limitGain: '- Não há meta mínima de ganho: a decisão considera regressões semânticas, exemplos, diferença observada e latência medida.',
    limitProduct: '- O relatório não altera configurações do produto; a recomendação é somente a registrada pelo humano.',

    // Cabeçalho.
    recommendationRecorded: '{decision}, registrada por {reviewer}: {justification}',
    recommendationMissing: 'não registrada (preencher {field} em {file})',
    title: '# Relatório do estudo de tradução e Jev — execução {run}',
    simulatedBanner: '> **Resultados simulados (fixture).** {notice}.',
    headerState: '- Estado técnico: {status}{reason}',
    headerConclusion: '- Conclusão: {conclusion}',
    headerRecommendation: '- Recomendação humana: {recommendation}',

    // Resumo impresso pela CLI.
    summarySimulated: 'Relatório gerado de evidências simuladas (fixture): não comprova tradução real, avaliação Jev, VRAM ou ganho de tradução.',
    summaryLive: 'Relatório gerado: o estado técnico não indica qualidade das traduções nem concordância com o gabarito.',
    summaryRun: 'run_id: {run}',
    summaryState: 'estado técnico: {status}{reason}',
    summaryConclusion: 'conclusão: {conclusion}',
    summaryRecommendation: 'recomendação humana: {recommendation}',
    summaryNotRecorded: 'não registrada',
    summaryReport: 'relatório: {path}',
  }),
});

// Texto do catálogo com as lacunas preenchidas. Lacuna sem valor é erro do gerador, não texto vazio.
export function text(key, values = {}) {
  const template = REPORT_TEXT.lines[key];
  if (template === undefined) throw new Error(`texto do relatório inexistente: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`lacuna {${name}} sem valor em ${key}`);
    return String(values[name]);
  });
}
