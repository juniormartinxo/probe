# Opção avaliada contra cada Restrição, com o limite do impacto

Na Etapa O, as Opções são itens próprios do Processo, como as Restrições e Preferências na Etapa R. A IA as propõe, identificadas como sugestão, e o usuário aceita cada uma (como veio ou editada), descarta ou acrescenta as suas. Os Pontos da Etapa O continuam cobertos como nas outras Etapas, pelos Blocos de Perguntas ou declarados inaplicáveis; as Opções são o que esses Pontos ajudam a encontrar, e a IA não inventa Opção para preencher um Ponto.

Cada Opção aceita é avaliada pelo Jev contra cada Restrição em vigor, um par por pergunta Choice, todos os pares novos numa chamada; só as Restrições vão como dado, porque uma Preferência não elimina Opção. Um par é avaliado uma vez: quando a Opção é aceita, ou quando uma Revisão de Restrição põe em vigor uma Restrição nova. O par só decide sozinho com o limite da Avaliação de impacto (ADR 0003): `yes` com confiança de pelo menos 0,7 marca a violação; `no` com essa confiança, o cumprimento. Abaixo disso, com `insufficient` ou com o Jev em falha, o usuário vê o julgamento e decide se a Opção viola a Restrição.

Uma Opção que viola uma Restrição em vigor é inviável, e nada a compensa: a viabilidade só olha os pares, nunca vantagens em outra dimensão. Ela volta a ser considerada só se a Restrição for revista. A Confirmação da Etapa O exige pelo menos uma Opção viável, nenhum par sem decisão e nenhuma sugestão da IA sem resposta do usuário. Sem Opção viável, a aplicação mostra os impedimentos (cada Opção e as Restrições que ela viola) e oferece pedir novas Opções à IA ou rever uma Restrição; o Processo continua aberto.

## Considered Options

- Opções declararem os Pontos que cobrem, no lugar dos Blocos: faria a quantidade de Opções parecer exigência, contra o "sem inventar opções para atingir uma quantidade".
- Uma pergunta por Opção ("viola alguma Restrição?"): menos perguntas, mas a primitiva Choice não diz qual, e os impedimentos precisam nomear a Restrição.
- Deixar o usuário contestar um `yes` confiante: a contestação existe, por caminhos explícitos (rever a Restrição ou descrever a Opção de outro jeito); uma anulação avulsa afrouxaria uma Restrição sem revisão.

## Consequences

Os pares crescem com Opções × Restrições, todos numa chamada por aceitação. O limite de 0,7 continua sem calibração e muda junto com o do impacto e o do conflito. Uma Opção aceita não se edita: descrevê-la de outro jeito é descartar e acrescentar outra, que passa por pares novos.
