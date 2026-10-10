# Matriz qualitativa, Recomendação e Escolha na Etapa B

Na Etapa B, as Opções aceitas na Etapa O são comparadas numa Matriz qualitativa: uma linha por Opção, com o atendimento às Restrições e, em texto, ganhos, perdas, esforço, escala, manutenção e reversibilidade. Não há nota, peso nem pontuação. O atendimento às Restrições vem dos pares Opção × Restrição (ADR 0006), nunca da IA nem do usuário; uma Opção inviável aparece como tal e não tem linha a preencher.

As outras células são do usuário, como as Opções na Etapa O: a IA sugere, identificada como sugestão, e o usuário aceita a linha como veio, edita ou escreve a sua. A sugestão vem com a Recomendação, numa operação própria da IA, pedida pelo usuário enquanto B é a atual: a IA recebe o problema, as Etapas confirmadas, as Restrições e Preferências em vigor, as Perguntas de B e as Opções aceitas com a viabilidade e as linhas já gravadas, e devolve uma linha para cada Opção viável e a Opção viável que recomenda, com a justificativa. Uma Recomendação de Opção que não é viável, ou com a matriz sem uma viável (ou com uma inviável), é saída inválida. A Recomendação nunca vira Escolha: só o usuário escolhe.

A Escolha é um registro próprio: a Opção, que precisa ser aceita e viável, e o motivo de descarte de cada outra Opção viável. Trocar de Escolha registra uma nova, a qualquer momento da Etapa B em diante enquanto o Processo está aberto, e a anterior fica no histórico. Os três primeiros Pontos de B se cobrem por Blocos ou ficam inaplicáveis, como nas outras Etapas; o Ponto "Escolha com os motivos dos descartes" só a Escolha cobre: nenhum Bloco pergunta sobre ele e ele não se declara inaplicável. A Confirmação da Etapa B exige, além dos Pontos, nenhuma Opção sem decisão de viabilidade e uma Escolha que se sustenta: Opção viável e um motivo para cada outra viável.

Uma Revisão de Restrição feita em B ou depois forma e avalia os pares novos, como na Etapa O. Se a Opção escolhida deixa de ser viável, a Escolha continua no histórico, aparece como inviável e a Confirmação de B espera uma nova Escolha; se outra Opção passa a ser viável, a Escolha precisa de um motivo para descartá-la.

## Considered Options

- Matriz preenchida só pelo usuário: mais simples, mas deixava a IA sem papel na comparação, ao contrário do que ela faz nas Opções.
- Cobrir o Ponto da Escolha por Blocos: pediria ao usuário que respondesse em texto o que já registra de forma estruturada.
- Reabrir a Confirmação de B quando a Escolha muda depois dela: a compatibilidade do plano com a Escolha é da Etapa E; nesta fatia, a troca só fica no histórico.

## Consequences

A Recomendação mais recente pode ficar velha (uma Opção recomendada que deixou de ser viável, uma linha reescrita): a tela marca isso e o usuário pede outra. Mudar a Escolha depois da Etapa B não reavalia nada por ora; a Etapa E vai precisar olhar a Escolha em vigor.
