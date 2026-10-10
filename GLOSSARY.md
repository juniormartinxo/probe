# PROBE

Aplicação de apoio à tomada de decisão que conduz o usuário pelas etapas do framework PROBE (Problema, Restrições, Opções, Balanceamento, Execução), da descrição de um problema até uma decisão confirmada.

O código usa o nome em inglês indicado em _Code_ para cada termo; não invente sinônimos.

## Processo

**Processo**:
Percurso completo de um problema pelo PROBE, da descrição inicial até a Finalização. É a unidade que se abre, se retoma e se finaliza.
_Code_: `Process`
_Avoid_: Chat, conversa, decisão, sessão

**Descrição original**:
Texto com que o usuário descreveu o problema ao criar o Processo, preservado exatamente como digitado.
_Code_: `originalDescription`
_Avoid_: Enunciado, prompt, descrição inicial

**Enunciado do problema**:
Formulação do problema que o usuário confirmou: a proposta da IA como veio, corrigida por ele, ou escrita sem proposta. Só existe depois da Confirmação; a Descrição original continua preservada.
_Code_: `ProblemStatement`
_Avoid_: Problema estabelecido, descrição refinada

**Conversa**:
Registro das mensagens trocadas dentro de um Processo; cada Processo tem exatamente uma.
_Code_: `Conversation`
_Avoid_: Chat, histórico

**Etapa**:
Uma das cinco fases do PROBE (P, R, O, B, E) pelas quais um Processo passa.
_Code_: `Stage`
_Avoid_: Fase, passo

**Ponto da etapa**:
Item fixo do conteúdo do framework que uma Etapa precisa cobrir, como "problema real versus sintoma" em P. A lista de Pontos é mantida pela aplicação, não pela IA.
_Code_: `StagePoint`
_Avoid_: Requisito da etapa, critério, checklist

**Revisão final**:
Apresentação consolidada de problema, restrições, Escolha, concessões e plano, feita antes da Finalização.
_Code_: `FinalReview`

**Finalização**:
Confirmação explícita do usuário que congela o Processo e produz a Decisão e o relatório.
_Code_: `Finalization`
_Avoid_: Conclusão, encerramento, fechamento

**Aberto**:
Estado de um Processo desde a criação até a Finalização; só um Processo aberto aceita mudanças.
_Code_: `open`
_Avoid_: Ativo, em andamento, pendente

**Finalizado**:
Estado terminal de um Processo após a Finalização; um Processo finalizado é somente leitura.
_Code_: `finalized`
_Avoid_: Concluído, encerrado, fechado

## IA

**Solicitação à IA**:
Pedido de uma operação à IA dentro de um Processo, como refinar o Enunciado do problema. Registra suas Tentativas; o estado da Solicitação é o da Tentativa mais recente.
_Code_: `AiRequest`
_Avoid_: Chamada, job, prompt

**Tentativa**:
Cada execução de uma Solicitação à IA, com estado, CLI, modelo, Perfil do Cloak e consumo quando a CLI o informa. Uma nova Tentativa só é aberta pelo usuário e nunca depois de uma que trouxe resultado; ela segue com a CLI da anterior, a menos que o usuário escolha outra.
_Code_: `Attempt`
_Avoid_: Retry, execução, chamada

**CLI**:
Programa de linha de comando de um provedor de IA que o executor chama pelo Cloak: Claude Code (`claude`), Codex (`codex`), Grok (`grok`) ou Gemini pelo `agy`. A escolhida na configuração atende as novas Solicitações, com o modelo escolhido para ela; trocar de CLI depois de uma falha é sempre escolha do usuário, nunca automática.
_Code_: `Cli` (`claude`, `codex`, `grok`, `agy`)
_Avoid_: LLM, agente

**Perfil do Cloak**:
Conjunto de contas e credenciais das CLIs, administrado no host pelo Cloak, com que o executor chama a CLI. É o perfil do diretório (o que o Cloak liga ao diretório de trabalho do executor) ou um perfil escolhido pelo nome; a escolha vale para novas Tentativas, e cada Tentativa registra o que usou.
_Code_: `CloakProfile` (`directory`, `explicit`)
_Avoid_: Conta, credencial, login

## Perguntas e respostas

**Pergunta**:
Pedido de informação ao usuário dentro de um Processo, formulado pela IA a partir do estado do Processo, servindo a um ou mais Pontos da etapa.
_Code_: `Question`
_Avoid_: Questão

**Bloco**:
Conjunto de Perguntas que a IA gera de uma vez para um ou mais Pontos da etapa atual. Fica estável depois de apresentado; Perguntas novas vão para um Bloco novo.
_Code_: `Block`
_Avoid_: Grupo, seção, página

**Alternativa de resposta**:
Cada resposta possível que a IA oferece numa Pergunta de alternativa única ou múltipla. Não tem relação com Opção.
_Code_: `choice`
_Avoid_: Opção, escolha, item

**Reformulação**:
Pergunta nova, num Bloco novo, que refaz uma Pergunta já apresentada (por exemplo, cuja resposta ficou ambígua). Fica ligada à original; a resposta dada à original continua associada ao texto que o usuário viu.
_Code_: `reformulates`
_Avoid_: Edição da pergunta, nova versão da pergunta

**Síntese do Bloco**:
Resumo, feito pela IA, do que as respostas de um Bloco dizem, com a sugestão de quais Pontos da etapa ainda abertos elas cobrem. É sugestão até a Confirmação da síntese de bloco, que confirma em conjunto as respostas do Bloco (até lá provisórias) e os Pontos que o usuário dá por cobertos.
_Code_: `synthesis` (`SynthesisProposal`, `ConfirmedSynthesis`)
_Avoid_: Resumo do bloco, conclusão do bloco

**Ponto coberto**:
Ponto da etapa que o usuário confirmou como respondido, na Confirmação da síntese de um Bloco. Sugestão da IA não cobre nada sozinha.
_Code_: `covered`

**Ponto inaplicável**:
Ponto da etapa que o usuário declarou não se aplicar ao caso, com justificativa obrigatória.
_Code_: `inapplicable`
_Avoid_: Ponto ignorado, ponto pulado

**Ausência registrada**:
Registro explícito do usuário de que não há o que um Ponto da etapa pede, como prazo ou sistemas e APIs envolvidos. Conta como cobertura do Ponto, sem Bloco nem justificativa, e só existe nos Pontos que a admitem.
_Code_: `absent`
_Avoid_: Ponto vazio, sem prazo implícito

**Resposta ambígua**:
Resposta que a IA, ao sintetizar o Bloco, apontou como possível de entender de mais de um jeito. É sugestão: serve de candidata a Reformulação num Bloco novo, até ganhar uma.
_Code_: `ambiguousAnswers`

**Informação desconhecida**:
Registro explícito do usuário de que não sabe o que uma Pergunta pede. Abre uma Pendência de informação desconhecida, resolvida pela resposta que chegar depois.
_Code_: `unknown` (Pendência `unknown_information`)
_Avoid_: Sem resposta, pulada

**Resumo do entendimento**:
Visão consultável, a qualquer momento, do que o Processo já estabeleceu: enunciado, Pontos, sínteses confirmadas, respostas que valem e Pendências abertas. É montado do que está gravado, sem chamar a IA.
_Code_: `Understanding`

**Rascunho**:
O que o usuário preencheu numa Pergunta e ainda não salvou como Versão, completo ou não; guarda a Versão sobre a qual a alteração começou.
_Code_: `AnswerDraft`

**Resposta herdada**:
Resposta copiada de outro Processo num Desdobramento, que só vale no Processo novo depois de reconfirmada.
_Code_: `InheritedAnswer`
_Avoid_: Fato herdado, resposta importada

**Versão**:
Cada estado registrado de uma resposta; alterar uma resposta cria uma nova Versão e preserva a anterior.
_Code_: `AnswerVersion`
_Avoid_: Revisão, edição

**Avaliação**:
Julgamento estruturado do Jev sobre o estado do Processo, como cobertura de um Ponto, violação de Restrição, impacto de uma nova Versão ou conflito entre respostas. Informa o usuário, nunca confirma nada.
_Code_: `Assessment`
_Avoid_: Julgamento, questão, análise

**Confirmação**:
Ato do usuário que dá algo por estabelecido: enunciado do problema, síntese de bloco, Etapa, Escolha ou Finalização.
_Code_: `Confirmation`
_Avoid_: Conclusão, aprovação, validação

**Reavaliação**:
Revisão de uma Confirmação (síntese de bloco ou Etapa) que dependia de uma Versão já superada. Abre-se com a Versão nova e passa pela Avaliação de impacto do Jev; termina quando a Confirmação passa a sustentar a Versão nova (sem impacto, mantida pelo usuário ou reconfirmada). Enquanto não termina, bloqueia a Confirmação da Etapa da Pergunta e das seguintes; com impacto, vira Pendência de reavaliação.
_Code_: `Reassessment` (a Avaliação: `ImpactAssessment`)
_Avoid_: Revalidação, invalidação

**Pendência**:
Impedimento visível que bloqueia as Confirmações que dependem dele, por um de três motivos: reavaliação (depende de Versão superada), conflito (respostas incompatíveis) ou informação desconhecida. A de reavaliação nasce de uma Avaliação de impacto e se resolve reconfirmando a Confirmação afetada (numa síntese de bloco, com o texto corrigido, se preciso) ou corrigindo a resposta com uma Versão nova.
_Code_: `Pendency` (motivos `unknown_information` e `reassessment`; resolução `answered`, `reconfirmed` ou `corrected`)
_Avoid_: Bloqueio, alerta, issue

## Restrições e opções

**Restrição**:
Condição inegociável do problema; elimina as Opções que a violam e não pode ser compensada por vantagens em outra dimensão. O usuário a registra na Etapa R como item próprio do Processo, com escopo e unidade quando se aplicam; retirada, deixa de valer e fica no histórico.
_Code_: `Constraint`
_Avoid_: Restrição inegociável, requisito, condição

**Preferência**:
Condição desejável, mas negociável, que pesa no Balanceamento sem eliminar Opções. Registrada na Etapa R como item próprio, distinto das Restrições, com a mesma forma.
_Code_: `Preference`
_Avoid_: Restrição negociável, desejo, critério

**Opção**:
Caminho concreto considerado para resolver o problema, inclusive eliminá-lo ou resolvê-lo manualmente.
_Code_: `Option`
_Avoid_: Alternativa, solução, proposta

**Recomendação**:
Sugestão da IA a favor de uma Opção; nunca se torna Escolha sem ato do usuário.
_Code_: `Recommendation`
_Avoid_: Sugestão de escolha, decisão da IA

**Escolha**:
Opção selecionada pelo usuário na Etapa B; continua revisável enquanto o Processo estiver aberto.
_Code_: `ChosenOption`
_Avoid_: Seleção, decisão

**Decisão**:
Escolha e plano de execução congelados pela Finalização.
_Code_: `Decision`
_Avoid_: Resultado, conclusão

## Derivações

**Derivação**:
Processo novo criado a partir de um Processo finalizado, que permanece intacto e identificado como origem.
_Code_: `Derivation`
_Avoid_: Branch, fork, cópia

**Reconsideração**:
Derivação que reabre uma Decisão para revisá-la, herdando contexto e respostas da origem.
_Code_: `Reconsideration`
_Avoid_: Revisão de decisão, reabertura

**Desdobramento**:
Derivação que estabelece um problema novo, herdando apenas o contexto selecionado da origem e percorrendo o PROBE completo.
_Code_: `Spinoff`
_Avoid_: Problema relacionado, subprocesso
