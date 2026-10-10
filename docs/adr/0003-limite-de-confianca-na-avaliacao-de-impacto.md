# Limite de confiança decide quando o usuário julga o impacto de uma mudança

Quando uma resposta muda, o Jev avalia o impacto da Versão nova sobre cada Confirmação que dependia da anterior. Um `yes` abre a Pendência de reavaliação e um `no` mantém a Confirmação, mas só com confiança de pelo menos 0,7. Abaixo disso, ou com `insufficient`, o julgamento não decide: o usuário vê a Avaliação e escolhe entre abrir a Pendência e manter a Confirmação. Se o Jev falhar, o usuário tenta de novo ou decide sem ele. A decisão fica registrada com a Avaliação que ele viu.

O limite só escolhe quem decide; ele não esconde nada. A regra de exibir as Avaliações brutas, sem limiar, continua valendo. O valor 0,7 fica no código, junto da rubrica de impacto, e tem apoio empírico, mas não é calibração. Nos testes reais da One Model Arena (09/10/2026, jev-1.13.0, 314 respostas com gabarito, com perguntas de outro tipo), as 299 respostas com confiança de pelo menos 0,7 acertaram, e as 15 abaixo disso tiveram 5 erros.

## Considered Options

- Deixar todo julgamento do impacto para o usuário: mais seguro, mas transforma cada mudança de resposta numa decisão manual, mesmo quando o Jev está confiante.
- Agir sobre qualquer `yes`/`no`, sem limite: contradiz a issue (a baixa confiança precisa chegar ao usuário) e deixaria julgamentos fracos abrirem ou descartarem Pendências.

## Consequences

O limite pode mudar com o uso. A amostra abaixo de 0,7 é pequena e não vem de Avaliações de impacto. Medir isso fica para quando houver Avaliações de impacto reais suficientes; não há processo de calibração.
