# Desdobramento herda as respostas escolhidas num Bloco de Respostas herdadas, reconfirmado pela síntese

O Desdobramento de um Processo finalizado é um Processo novo, aberto, na Etapa P, com a descrição do problema novo como primeira interação: o refinamento pela IA e a Confirmação do enunciado seguem como em qualquer Processo. Ao criá-lo, o usuário escolhe quais respostas da origem herdar, entre as Versões do conjunto confirmado que a Finalização da origem congelou; qualquer outra coisa (uma Escolha, uma Versão superada, uma de outro Processo, a mesma duas vezes) é recusada.

Cada Etapa com respostas escolhidas ganha um Bloco de Respostas herdadas, criado com o Desdobramento, na ordem do PROBE e numerado antes dos Blocos da IA: cópias das Perguntas (texto, assunto, alternativas e Pontos servidos), cada uma com a resposta como Versão 1. O Desdobramento segue a versão da lista de Pontos da origem, para que as Perguntas copiadas sirvam aos Pontos pelas mesmas chaves. O Bloco não vem de uma tentativa da IA (`attempt_id` nulo), e cada Pergunta e Versão copiada fica identificada em `derivation_copies`. Nada aponta para a origem.

As Respostas herdadas são provisórias, como qualquer resposta antes da Confirmação da síntese de bloco: só passam a valer quando o usuário confirma a síntese do Bloco delas, que também é quando cobrem Pontos. Até lá, o usuário pode alterá-las (uma Versão nova), e elas ficam fora do que a IA recebe para propor Opções e recomendar. Por isso só se herdam Versões que valiam na origem: do conjunto confirmado da Finalização e confirmadas por uma síntese de bloco (uma Resposta herdada que a origem nunca reconfirmou também está no conjunto). A síntese espera o enunciado confirmado e a Etapa do Bloco aberta; os Blocos da IA de uma Etapa esperam a síntese do Bloco de Respostas herdadas dela, como esperam a de qualquer Bloco anterior, e recebem as Respostas herdadas no que já foi perguntado.

A Decisão da origem (o resumo da Decisão do relatório congelado: enunciado, Escolha, descartes e plano) é copiada na Derivação e aparece no Desdobramento e no relatório dele só como contexto: não é resposta, não entra em Opções, Escolha ou plano e não cobre Ponto. O relatório identifica a origem e marca os Blocos de Respostas herdadas.

## Considered Options

- Respostas herdadas como registro à parte, fora dos Blocos: cada módulo (síntese, cobertura, conflito, relatório, o que a IA recebe) precisaria de um caminho próprio para reconfirmá-las e lê-las.
- Copiar os Blocos inteiros da origem, com as sínteses: traria Pontos cobertos e respostas confirmadas para um problema que ainda não foi estabelecido.
- Um Bloco de Respostas herdadas só, para todas as Etapas: a síntese dele cobriria Pontos de Etapas ainda fechadas.
- Herdar a Decisão da origem como Restrição, Opção ou Escolha: a spec quer a Decisão só como contexto.
- Passar a Decisão da origem à IA nos prompts: mudaria a porta do `Assistant` sem pedido da spec; fica para quando o uso mostrar necessidade.

## Consequences

Um Bloco pode existir sem tentativa da IA. Uma Reconsideração de um Desdobramento copia o Bloco de Respostas herdadas como qualquer outro, e ele segue identificado como tal, como no relatório da origem. A Derivação dela é uma Reconsideração, cuja origem é o Desdobramento: a Decisão da origem do Desdobramento não vai junto, porque a Reconsideração já carrega o registro inteiro dele e identifica só a origem imediata.
