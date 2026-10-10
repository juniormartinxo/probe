# Conflito avaliado por pares de respostas, com o limite de confiança do impacto

Quando respostas passam a confirmadas, pela Confirmação da síntese de bloco ou porque uma Confirmação passou a sustentar uma Versão nova, o Jev avalia o conflito delas com as respostas já confirmadas que valem. Cada par vira uma pergunta Choice na mesma chamada: as respostas recém-confirmadas entre si e cada uma delas com cada resposta já confirmada, de qualquer Etapa. As Restrições e Preferências em vigor e o enunciado vão como contexto, e a rubrica diz que deixar de atender uma Preferência não é conflito. Cada par é avaliado uma vez, quando a mais nova das duas respostas é confirmada.

Um par só decide sozinho com o limite da Avaliação de impacto (ADR 0003): `yes` com confiança de pelo menos 0,7 abre a Pendência de conflito; `no` com essa confiança não abre nada. Abaixo disso, ou com `insufficient`, o usuário vê o julgamento e abre a Pendência ou descarta o conflito. Se o Jev falhar, o usuário tenta de novo ou segue sem a Avaliação, e o descarte fica registrado com a Avaliação que ele viu.

## Considered Options

- Uma pergunta por resposta nova ("conflita com alguma das confirmadas?"): menos perguntas, mas a primitiva Choice não diz com qual, e a Pendência precisa ficar ligada às respostas envolvidas.
- Pedir à IA que escolha os pares relevantes antes do Jev: menos pares, mas põe a IA no caminho de um julgamento que é do Jev, e uma omissão dela esconderia um conflito.
- Um limite próprio para o conflito: não há dado para escolher outro valor; o de impacto tem o mesmo apoio empírico e a mesma ressalva.

## Consequences

O número de pares cresce com o Processo (respostas novas × confirmadas), e todos vão numa chamada. Se o custo ou o tempo do Jev pesarem no uso, a saída é filtrar por relevância, mantendo a ligação de cada Pendência às duas respostas. O limite de 0,7 continua sem calibração e pode mudar com o uso, junto com o do impacto.
