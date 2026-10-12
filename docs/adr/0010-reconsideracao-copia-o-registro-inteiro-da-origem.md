# Reconsideração copia o registro inteiro da origem e lê as mudanças contra o conjunto confirmado

A Reconsideração de um Processo finalizado é um Processo novo, aberto, na Etapa em que a origem terminou (E, com a Confirmação dela), com uma cópia de tudo o que a origem registrou: enunciado, Blocos, Perguntas, Versões, sínteses, Pontos, Confirmações de síntese e de Etapa, Avaliações, Pendências resolvidas, Restrições e Preferências (com as Revisões), Opções e a viabilidade delas, Matriz qualitativa, Recomendações, Escolhas, plano de execução e as Solicitações à IA que os produziram. Cada registro ganha um id novo, e toda referência a outro registro da origem passa a apontar para a cópia dele, inclusive os ids guardados no resultado de uma tentativa da IA. Nada da cópia aponta para a origem; cada registro copiado fica identificado (`derivation_copies`: tabela, id na origem, id da cópia). Ficam de fora a Conversa (a cópia abre a sua), os rascunhos, a Finalização e a própria Derivação.

A cópia segue o esquema do banco: as chaves estrangeiras dizem o que remapear e em que ordem gravar. Como há ciclos entre tabelas (uma Pendência de conflito e a Revisão de Restrição que a resolve, a pergunta de resolução e a Pendência dela), a ordem sai dos próprios registros: cada um entra depois dos que referencia. Uma tabela nova ligada ao Processo que não for classificada como copiada ou deixada de fora faz a Reconsideração falhar, em vez de copiar pela metade.

Com a cópia isomorfa à origem, as regras de qualquer Processo valem sem caminho próprio: as Confirmações herdadas sustentam as mesmas Versões, uma Versão nova passa pela Avaliação de impacto e abre Pendência de reavaliação onde couber, e a Finalização exige o mesmo. A Revisão final de uma Reconsideração recém-criada apresenta o mesmo relatório que a origem congelou, com a origem na identificação.

A Derivação (`derivations`) guarda a origem, o tipo e o conjunto herdado: o conjunto confirmado da Finalização da origem, pelos ids das cópias. O que mudou em relação à origem é lido contra ele, sem chamar a IA: respostas cuja Versão que vale tem outro conteúdo, Restrições e Preferências retiradas ou acrescentadas, troca de Escolha e elementos do plano reescritos. Uma resposta que mudou e voltou ao que era não conta. A lista entra no relatório, na origem da identificação, e é congelada pela Finalização da Reconsideração.

## Considered Options

- Copiar só as Versões válidas e as Confirmações, como a spec descreve ao pé da letra: as Confirmações sustentam Versões por registros que apontam também para as superadas (a tentativa da IA que sintetizou o Bloco, a Avaliação de cobertura da Etapa, a Avaliação de impacto que fez a síntese sustentar a Versão nova). Sem eles, cada módulo precisaria de um caminho próprio para Confirmações herdadas. Com o registro inteiro, as válidas continuam válidas, as superadas continuam superadas, e o histórico da origem segue no relatório.
- Referenciar os registros da origem em vez de copiá-los: contraria a spec (cópia, nunca referência a conteúdo da origem) e misturaria um Processo finalizado com um aberto nas mesmas linhas.
- Lista de tabelas e colunas escrita à mão: divergiria do esquema na primeira migration que esquecesse de atualizá-la.

## Consequences

O Processo derivado carrega também as Solicitações à IA da origem, com CLI, modelo e consumo; identificadas como cópias, não são chamadas novas. O Desdobramento (PRB-31) reaproveita a Derivação e a origem no relatório, mas não a cópia inteira: ele herda só as respostas escolhidas, como Respostas herdadas a reconfirmar.
