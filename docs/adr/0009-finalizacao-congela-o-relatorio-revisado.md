# Finalização congela o relatório que a Revisão final apresentou

Com a Etapa E confirmada, a Revisão final apresenta o conteúdo estruturado do relatório como ficaria se o Processo fosse finalizado agora: problema original e enunciado confirmado, Restrições e Preferências em vigor, Escolha com a linha da Matriz qualitativa e os descartes (as concessões), plano de execução e, abaixo, o registro por Etapa e o histórico. Junto vem uma impressão digital desse conteúdo (SHA-256 do relatório serializado) e o que ainda impede a Finalização.

A Finalização é um ato explícito que traz a impressão digital da Revisão final que o usuário viu. Com o Processo travado, a aplicação remonta o relatório e recusa a Finalização se a impressão digital mudou (`final_review_outdated`): qualquer Versão nova, Restrição revista, troca de Escolha ou elemento reescrito entre a apresentação e a confirmação muda o relatório. Também recusa enquanto houver qualquer Pendência aberta (inclusive uma informação desconhecida registrada depois de E numa Pergunta de Etapa anterior), uma Solicitação à IA em andamento, Reavaliação ou Conflito sem decisão, Escolha que não se sustenta ou elemento do plano sem compatibilidade decidida: quase tudo isso já bloqueava a Confirmação da Etapa E, a última. Na mesma transação, e lendo tudo nela, grava a Finalização (o conjunto confirmado, pelos ids, e o relatório como foi apresentado, agora com a data da Finalização) e passa o Processo a `finalized`. Toda rota de escrita já recusava um Processo que não está aberto; um gatilho no banco recusa ainda alterar o registro de um Processo finalizado e a Finalização gravada. Como a Finalização espera as Solicitações à IA em andamento e uma nova só abre com o Processo aberto, nenhum resultado da IA chega depois dela.

Entre a Confirmação de E e a Finalização, o plano e a Escolha voltam a mudar pelos caminhos da Etapa E e da Etapa B: é a forma de rever a decisão na Revisão final que o ADR 0008 deixou em aberto. Uma troca de Escolha desatualiza a compatibilidade dos elementos, e a Finalização espera cada um voltar a compatível ou mantido. A Confirmação de E continua única e não se refaz.

O resumo da Decisão que abre o relatório é montado pela aplicação a partir do conteúdo congelado (enunciado, Escolha, descartes e plano), sem chamar a IA. Se um resumo redigido pela IA vier depois, ele precisará ser revisado pelo usuário antes da Finalização e entrar na impressão digital.

## Considered Options

- Gravar a Revisão final apresentada como registro próprio e finalizar por ele: cada abertura da Revisão viraria uma escrita, e a comparação seria a mesma.
- Comparar só as Versões de resposta: deixaria passar uma troca de Escolha, um elemento reescrito ou uma Restrição revista feitos em outra aba.
- Recusar a mudança do plano e da Escolha depois de E, como no ADR 0008: uma Revisão de Restrição que tornasse a Opção escolhida inviável deixaria o Processo sem como ser finalizado.
- Resumo da Decisão redigido pela IA nesta fatia: exigiria uma nova operação no executor e uma etapa de revisão, sem mudar o que é congelado.

## Consequences

O relatório congelado é a fonte única da exportação em Markdown e PDF (PRB-29) e da origem de uma Derivação (PRB-30, PRB-31). Mudar a forma do relatório muda a impressão digital, mas só de Processos ainda abertos: o congelado fica como foi gravado.
