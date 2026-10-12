# Plano de execução cobre os Pontos de E, com a compatibilidade avaliada contra a Escolha

Na Etapa E, o usuário escreve o Plano de execução: o primeiro passo concreto, como reconhecer sucesso e o plano B, um elemento por Ponto de E. Como a Escolha cobre o Ponto dela na Etapa B (ADR 0007), cada elemento cobre o seu Ponto: nenhum Bloco o cobre e ele não se declara inaplicável, porque os três são obrigatórios para confirmar E. Os Blocos de E continuam: a IA formula Perguntas a serviço dos Pontos ainda sem elemento, recebendo a Escolha em vigor (com os descartes) e as Restrições; a síntese de um Bloco de E confirma as respostas, mas não cobre Ponto. Cada elemento é gravado à parte, em qualquer ordem; reescrevê-lo guarda o anterior no histórico.

Ao gravar um elemento, o Jev avalia se ele é compatível com a Escolha em vigor: uma pergunta Choice por elemento, `yes` = compatível, com o problema, a Escolha e o elemento como dado. Só `yes` com confiança de pelo menos 0,7 decide sozinho (o limite dos ADRs 0003 e 0006). Com `no`, `insufficient` ou confiança baixa, o usuário vê o julgamento e reescreve o elemento ou o mantém com justificativa obrigatória. Com o Jev em falha, ele tenta de novo ou mantém o elemento sem Avaliação, o que fica registrado. A Avaliação de cobertura da Etapa não tem o que avaliar em E; a Confirmação de E exige os três elementos, cada um compatível ou mantido sobre a Escolha em vigor, e uma Escolha que ainda se sustenta.

Uma troca de Escolha antes da Confirmação de E desatualiza as Avaliações dos elementos: o usuário pede uma nova pelo mesmo caminho da nova tentativa. Depois da Confirmação de E, o Processo está pronto para a Revisão final, e reescrever um elemento ou trocar a Escolha é recusado.

## Considered Options

- Pontos de E cobertos por Blocos, com o plano registrado à parte: faria o usuário responder e depois reescrever a mesma coisa.
- Gravar os três elementos juntos: obrigaria a ter o plano inteiro antes de ver qualquer Avaliação.
- Uma justificativa única na Confirmação da Etapa, contra o Jev: a decisão sobre um elemento incompatível ficaria longe dele, e o elemento reescrito não teria Avaliação própria.
- Reabrir a Confirmação de E quando o plano ou a Escolha mudam depois dela: a Confirmação de Etapa é única no banco, e rever a decisão antes da Finalização é papel da Revisão final.

## Consequences

Rever o plano ou a Escolha depois de E fica para a Revisão final (PRB-28), que precisará dizer como isso se faz. Uma Revisão de Restrição ou uma Versão nova de resposta depois de E continuam pelos caminhos de Reavaliação que já existem; uma Revisão de Restrição que torne a Opção escolhida inviável depois de E também fica para a Revisão final. O limite de 0,7 continua sem calibração e muda junto com o do impacto, do conflito e da violação.

O ADR 0009 respondeu a essa pendência: entre a Confirmação de E e a Finalização, o plano e a Escolha voltam a mudar pelos mesmos caminhos, e a Finalização exige de novo cada elemento compatível ou mantido sobre a Escolha em vigor.
