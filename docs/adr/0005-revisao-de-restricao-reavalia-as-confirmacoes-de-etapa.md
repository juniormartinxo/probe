# Revisão de Restrição reavalia as Confirmações de Etapa que a sustentavam

Uma Restrição só muda, depois da Etapa R, por uma Revisão de Restrição: o usuário retira a Restrição em vigor e, se houver, registra a que a substitui (Restrição nova ou Preferência), com uma nota. A revisão é um registro próprio e vale em qualquer Etapa a partir de R: resolve uma Pendência de conflito, e fica ligada a ela, ou é avulsa, depois da Etapa R. Na Etapa R, o registro e a retirada avulsos continuam como estavam.

O que se reavalia são as Confirmações de Etapa que sustentavam a Restrição revista, ou seja, as que foram feitas com ela em vigor. Cada uma passa pela Avaliação de impacto do Jev, com rubrica própria, no mesmo fluxo da Versão nova: com `yes` confiante abre a Pendência de reavaliação, que fica na Confirmação da Etapa e não numa Pergunta; com `no` confiante, a Confirmação passa a sustentar a revisão; com julgamento incerto ou falha do Jev, quem decide é o usuário. Enquanto não há decisão, a Confirmação da Etapa atual espera. Numa Etapa R ainda não confirmada, nenhuma Confirmação sustentava a Restrição, e nada é reavaliado.

O esclarecimento que resolve uma Pendência de conflito passa a ir como contexto às Avaliações de conflito do Jev e às perguntas de resolução da IA seguintes, com as duas respostas como estavam então. Assim, quando uma das respostas muda e o conflito volta, o Jev e a IA sabem o que o usuário já explicou.

## Considered Options

- Reavaliar também as sínteses de Bloco: elas resumem respostas e não recebem Restrições, então a Restrição revista não muda o que afirmam.
- Verificar de novo o conflito entre todas as respostas confirmadas: uma Restrição nova pode criar ou desfazer conflitos, mas o custo cresce com o quadrado das respostas. Os conflitos novos aparecem quando uma resposta muda, com a Restrição revista como contexto.
- Pôr a Pendência de reavaliação numa Pergunta (a do conflito resolvido): mantinha a Pergunta obrigatória, mas ligava a Pendência a uma resposta que não mudou e não serviria à revisão avulsa.

## Consequences

Uma Pendência deixa de ter sempre uma Pergunta: a de reavaliação de uma Revisão de Restrição fica na Confirmação da Etapa. A Avaliação de impacto passa a ter como objeto uma Versão nova ou uma Revisão de Restrição. Revisões em cadeia (a substituta revista de novo) são reavaliadas uma de cada vez, na ordem em que a Confirmação as passa a sustentar.
