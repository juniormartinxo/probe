# Corpus de referência — revisão 1

Status: revisão 1 aprovada pelo usuário nesta conversa em 22/09/2026, antes de qualquer geração. Todos os exemplos são sintéticos.

Este documento é a fonte dos 18 casos. Na implementação, sua representação estruturada deve preservar os textos e as expectativas; mudanças de significado exigem nova revisão. Cada execução identificará os hashes do corpus e do gabarito. Somente contexto, perguntas, respostas e mudança proposta entram nos modelos. Títulos, gabaritos, justificativas e notas de revisão ficam fora dos payloads.

## Rubricas dos seis julgamentos

| ID | Pergunta de avaliação | Delimitação |
| --- | --- | --- |
| `b_depends_on_a` | É necessário consultar A para interpretar ou avaliar a resposta B? | Dependência de significado ou validade da resposta, não mera ordem cronológica ou assunto semelhante. |
| `a_depends_on_b` | É necessário consultar B para interpretar ou avaliar a resposta A? | Mesma regra, na direção inversa. Uma restrição independente não passa a depender de uma opção só porque pode inviabilizá-la. |
| `complements` | As perguntas fornecem informações distintas que, juntas, esclarecem uma mesma condição ou sua aplicação? | Repetição da mesma informação não é complemento. Dois eixos independentes do projeto não bastam. |
| `change_a_affects_b` | A mudança proposta em A exige reavaliar B? | Considerar a mudança descrita, sem inventar outra. Reavaliar pode confirmar a resposta anterior; não exige que ela necessariamente mude. |
| `same_block` | É útil responder A e B juntas no bloco atual? | Considerar o contexto de trabalho fornecido. Uma referência a uma etapa já confirmada pode exigir reavaliação sem fundir as etapas. |
| `answers_conflict` | As respostas atuais são incompatíveis com as condições explícitas? | Avaliar antes da mudança proposta. Preferência não é obrigação; periodicidades distintas não são somadas sem regra explícita. |

Respostas possíveis: `yes`, `no`, `insufficient`. A última significa que falta informação para distinguir as duas primeiras. Não usar conhecimento externo para completar condições. As rubricas deverão ter uma versão única em inglês para ambos os braços do ensaio.

Os gabaritos abaixo são propostas argumentadas. Se houver discordância humana, revisar antes da coleta; não ajustá-los depois apenas para acompanhar a saída do modelo. A escolha errada pelo Jev conta como erro observado, não como falha de transporte.

## Casos relacionais em português

### R01 — Valor e periodicidade

- Contexto: estamos esclarecendo o orçamento de uma contratação no mesmo bloco da etapa R. Ainda não existe outra definição de periodicidade.
- A — Pergunta: Qual é o orçamento disponível? Resposta: R$ 10.000.
- B — Pergunta: O orçamento informado em A é mensal ou apenas para implantação? Resposta: É mensal; a implantação terá outro orçamento.
- Mudança proposta em A: substituir a resposta por “R$ 10.000 no total, exclusivamente para implantação”.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | B qualifica explicitamente o orçamento registrado em A. |
| `a_depends_on_b` | yes | O valor de A só ganha periodicidade e escopo com B. |
| `complements` | yes | Valor e periodicidade completam a mesma restrição. |
| `change_a_affects_b` | yes | O novo escopo de A exige revisar a interpretação mensal de B. |
| `same_block` | yes | Separar as respostas deixa o valor sem uma unidade temporal definida. |
| `answers_conflict` | no | B esclarece a resposta original, que não fixava periodicidade. |

### R02 — Dois prazos distintos

- Contexto: há dois registros independentes: data-limite para registrar uma decisão e data contratual para entregar um relatório. Não existe regra que calcule um prazo a partir do outro. As perguntas pertencem a blocos distintos de planejamento.
- A — Pergunta: Até quando a decisão deve ser registrada? Resposta: Até 10 de outubro de 2026.
- B — Pergunta: Até quando o relatório deve ser entregue? Resposta: Até 30 de outubro de 2026.
- Mudança proposta em A: antecipar o registro da decisão para 8 de outubro de 2026, mantendo as condições contratuais da entrega.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | no | A data contratual de entrega é independente da data de registro. |
| `a_depends_on_b` | no | A data de registro pode ser interpretada sem a entrega. |
| `complements` | no | São obrigações distintas, não duas partes da mesma condição. |
| `change_a_affects_b` | no | A mudança mantém explicitamente o prazo contratual de B. |
| `same_block` | no | Não há dependência que justifique juntar os blocos distintos informados. |
| `answers_conflict` | no | Datas diferentes referem-se a eventos diferentes. |

### R03 — Integração posterior ao limite

- Contexto: o prazo máximo é obrigatório e não aceita exceção. A integração é indispensável para a entrega; não há substituto disponível. Ambos os prazos são contados a partir de hoje em dias corridos.
- A — Pergunta: Qual é o prazo máximo para entregar? Resposta: 14 dias corridos.
- B — Pergunta: A opção escolhida consegue entregar dentro do prazo de A? Resposta: Sim, ela atende ao prazo, embora dependa de uma integração que só estará disponível em 30 dias corridos.
- Mudança proposta em A: ampliar o prazo máximo para 45 dias corridos.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | A avaliação de atendimento ao prazo exige o limite de A. |
| `a_depends_on_b` | no | A restrição de 14 dias foi fixada independentemente da opção. |
| `complements` | yes | B confronta a capacidade da opção com a condição definida em A. |
| `change_a_affects_b` | yes | O novo limite altera a avaliação de viabilidade temporal de B. |
| `same_block` | yes | Resolver o conflito requer confrontar prazo e dependência obrigatória. |
| `answers_conflict` | yes | A disponibilidade em 30 dias impede cumprir o limite obrigatório de 14. |

### R04 — Preferência com exceção permitida

- Contexto: estamos definindo, no mesmo bloco, o que é aceitável na operação inicial.
- A — Pergunta: Automatizar é obrigatório desde o primeiro dia? Resposta: Não. Preferimos automação, mas permitimos operação manual nos primeiros 30 dias.
- B — Pergunta: Uma opção manual nos primeiros 15 dias é aceitável segundo a regra de A? Resposta: Sim, desde que seja automatizada depois desses 15 dias.
- Mudança proposta em A: exigir automação desde o primeiro dia, sem período manual permitido.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | A aceitação em B usa a permissão de A. |
| `a_depends_on_b` | no | A política pode ser entendida sem essa opção concreta. |
| `complements` | yes | B aplica a regra geral à duração de uma opção. |
| `change_a_affects_b` | yes | Remover a permissão exige rever a aceitação da opção manual. |
| `same_block` | yes | Regra e exceção concreta esclarecem juntas o que é permitido. |
| `answers_conflict` | no | Quinze dias manuais estão dentro dos trinta dias permitidos. |

### R05 — Proibição de envio de dados

- Contexto: nenhuma exceção ou anonimização é permitida pela regra de dados. A opção exige enviar dados brutos ao fornecedor para funcionar. Estamos verificando essa restrição no bloco atual.
- A — Pergunta: Podemos enviar os dados ao fornecedor? Resposta: Não, os dados não podem sair do nosso ambiente.
- B — Pergunta: Podemos aprovar a opção que exige esse envio, respeitando A? Resposta: Sim, aprovamos a opção com o envio obrigatório ao fornecedor.
- Mudança proposta em A: permitir explicitamente o envio desses dados ao fornecedor.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | A aprovação em B deve respeitar a política em A. |
| `a_depends_on_b` | no | A proibição tem significado próprio e não depende da opção. |
| `complements` | yes | Regra e necessidade da opção esclarecem sua compatibilidade. |
| `change_a_affects_b` | yes | A permissão nova modifica a avaliação de B. |
| `same_block` | yes | Proibição e aprovação incompatível devem ser confrontadas juntas. |
| `answers_conflict` | yes | B aprova exatamente o envio proibido em A. |

### R06 — Implantação e operação

- Contexto: implantação e operação usam verbas independentes. Não existe teto agregado. O valor de implantação não gera nem determina mensalidades. As perguntas estão em blocos separados dessas verbas.
- A — Pergunta: Qual é a despesa única prevista de implantação? Resposta: R$ 8.000, pagos uma única vez.
- B — Pergunta: Qual é o limite mensal da operação? Resposta: R$ 2.000 por mês, sem incluir a implantação.
- Mudança proposta em A: alterar a implantação para R$ 9.000, mantendo a verba de operação.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | no | O limite mensal não depende da despesa única. |
| `a_depends_on_b` | no | A despesa única não depende do teto mensal separado. |
| `complements` | no | São condições de verbas independentes, sem restrição agregada. |
| `change_a_affects_b` | no | O contexto mantém a operação independente da implantação. |
| `same_block` | no | Não há necessidade contextual de unir os blocos de verbas distintas. |
| `answers_conflict` | no | R$ 8.000 uma vez não viola um teto mensal que exclui implantação. |

### R07 — Disponibilidade e cor

- Contexto: a janela de manutenção e a cor de um indicador são decisões independentes. A cor não muda comportamento, alertas ou operação. Cada pergunta está no seu bloco de trabalho.
- A — Pergunta: Quando pode ocorrer a indisponibilidade de manutenção? Resposta: Aos domingos, das 2h às 3h.
- B — Pergunta: Qual será a cor do indicador estático na tela de configurações? Resposta: Azul.
- Mudança proposta em A: mudar a janela para domingos, das 3h às 4h.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | no | A cor não depende da janela. |
| `a_depends_on_b` | no | A janela não depende da cor. |
| `complements` | no | Não esclarecem uma mesma condição. |
| `change_a_affects_b` | no | Alterar o horário não afeta a escolha visual independente. |
| `same_block` | no | O contexto não fornece motivo para unir as duas decisões. |
| `answers_conflict` | no | Horário e cor podem coexistir como registrados. |

### R08 — Referência sem antecedente

- Contexto: a pergunta B foi importada sem a conversa anterior. Não sabemos se “esse prazo” refere-se à entrega de A ou a outro prazo discutido fora deste registro.
- A — Pergunta: Qual é o prazo para a entrega principal? Resposta: 14 dias corridos, incluindo homologação.
- B — Pergunta: Esse prazo inclui homologação? Resposta: Não, a homologação fica fora desse prazo.
- Mudança proposta em A: alterar a entrega principal para 21 dias corridos, ainda incluindo homologação.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | insufficient | Falta identificar o antecedente da referência em B. |
| `a_depends_on_b` | no | A já define evento, unidade e inclusão de homologação sem B. |
| `complements` | insufficient | A relação depende de os prazos serem o mesmo. |
| `change_a_affects_b` | insufficient | Sem o antecedente, não sabemos se a mudança alcança B. |
| `same_block` | insufficient | Primeiro é necessário esclarecer a que prazo B se refere. |
| `answers_conflict` | insufficient | Se forem o mesmo prazo há conflito; se forem distintos pode não haver. |

### R09 — Compromisso e capacidade

- Contexto: estamos negociando no mesmo bloco uma meta de atendimento e a capacidade da opção. A meta de A é um compromisso provisório, condicionado à confirmação de B. B só pode ser aceita se suportar a meta de A.
- A — Pergunta: Que atendimento podemos prometer com a opção de B? Resposta: Propomos 120 solicitações por minuto, desde que B suporte esse volume.
- B — Pergunta: A capacidade da opção suporta a meta de A? Resposta: Sim. A opção suporta até 150 solicitações por minuto.
- Mudança proposta em A: aumentar a meta para 180 solicitações por minuto.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | A suficiência da capacidade de B depende da meta proposta em A. |
| `a_depends_on_b` | yes | O compromisso provisório em A depende da capacidade confirmada em B. |
| `complements` | yes | Meta e capacidade completam a avaliação do compromisso. |
| `change_a_affects_b` | yes | A nova meta ultrapassa a capacidade declarada e exige reavaliação. |
| `same_block` | yes | Negociar as duas respostas juntas resolve a dependência mútua. |
| `answers_conflict` | no | A capacidade atual de 150 suporta a meta atual de 120. |

### R10 — Revisão de uma etapa anterior

- Contexto: A é uma restrição já confirmada na etapa R. Estamos na etapa O avaliando alternativas. Uma revisão do limite deve voltar ao registro de R; não é uma nova pergunta de orçamento no bloco de opções. Não há outros custos.
- A — Pergunta: Qual é o teto total de contratação? Resposta: R$ 8.000.
- B — Pergunta: A opção de R$ 6.000 atende ao teto registrado em A? Resposta: Sim, atende.
- Mudança proposta em A: reduzir o teto total para R$ 5.000.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | B declara conformidade com o teto de A. |
| `a_depends_on_b` | no | O teto é uma restrição confirmada, independente da opção. |
| `complements` | yes | Custo e teto permitem avaliar a mesma condição de viabilidade. |
| `change_a_affects_b` | yes | A opção de R$ 6.000 precisa ser reavaliada diante do teto de R$ 5.000. |
| `same_block` | no | O contexto exige manter o registro de R e a avaliação de O nas suas etapas. |
| `answers_conflict` | no | Antes da mudança, R$ 6.000 cabe no teto de R$ 8.000. |

### R11 — Mesma restrição repetida

- Contexto: ambas as perguntas tratam do mesmo serviço, evento de manutenção e limite obrigatório. Não são duas restrições distintas. Estamos revisando as perguntas do bloco de disponibilidade.
- A — Pergunta: Qual é o tempo máximo de indisponibilidade por manutenção? Resposta: 15 minutos.
- B — Pergunta: Por quantos segundos esse serviço pode ficar indisponível em cada manutenção? Resposta: 900 segundos.
- Mudança proposta em A: reduzir o tempo máximo para 10 minutos.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | no | B fornece um limite completo; a conversão de unidades não exige consultar A. |
| `a_depends_on_b` | no | A fornece um limite completo sem consultar B. |
| `complements` | no | Repetem a mesma informação, em unidades diferentes. |
| `change_a_affects_b` | yes | Alterar um registro da mesma restrição exige rever o outro. |
| `same_block` | yes | Exibir a repetição no mesmo bloco permite conciliá-la sem tratá-la como nova condição. |
| `answers_conflict` | no | Quinze minutos equivalem a novecentos segundos. |

### R12 — Plano B e reversibilidade

- Contexto: A foi confirmada na etapa O. Agora estamos na etapa E registrando o plano B da mesma opção. A opção não será rediscutida neste bloco; uma alteração de reversibilidade deve ser registrada em O e propagada a E.
- A — Pergunta: A opção permite retorno ao sistema anterior? Resposta: Sim, o retorno é possível em até um dia, preservando os dados.
- B — Pergunta: Qual será o plano B se ocorrerem três falhas consecutivas? Resposta: Retornar ao sistema anterior em até um dia, preservando os dados, usando a reversibilidade confirmada em A.
- Mudança proposta em A: registrar que a migração é irreversível e não permite retorno ao sistema anterior.

| Julgamento | Esperado | Justificativa |
| --- | --- | --- |
| `b_depends_on_a` | yes | O plano B usa a capacidade de retorno registrada em A. |
| `a_depends_on_b` | no | A reversibilidade é propriedade da opção, independente do gatilho de B. |
| `complements` | yes | Capacidade de retorno e gatilho esclarecem como o fallback poderá ser usado. |
| `change_a_affects_b` | yes | Tornar a opção irreversível exige rever o fallback. |
| `same_block` | no | A referência entre O e E exige vínculo e reavaliação, sem fundir os blocos. |
| `answers_conflict` | no | O retorno de B é permitido pela capacidade atual de A. |

## Casos originais em inglês

As invariantes abaixo orientam a revisão da tradução concreta para português. Não são uma saída literal obrigatória nem dados enviados ao tradutor. A revisão começa em `pending`; `faithful` e `meaning_changed` exigem revisor e justificativa ligados à saída produzida.

### T01 — Negação

Original: “Do not send customer records to the vendor, even for troubleshooting. Sending aggregated metrics is allowed only if they contain no customer records.”

Invariantes: proibição de enviar registros; exceção de troubleshooting expressamente negada; métricas agregadas permitidas somente se não contiverem registros de clientes. Não transformar a segunda frase em permissão geral de envio.

### T02 — Obrigação e preferência

Original: “The audit log must be retained for 90 days. We prefer an automated export, but a manual export is acceptable during the first two weeks.”

Invariantes: retenção de 90 dias obrigatória; exportação automática preferencial; manual permitida nas primeiras duas semanas. Não tornar a preferência uma obrigação ou estender a exceção indefinidamente.

### T03 — Moeda e periodicidade

Original: “The one-time setup budget is BRL 12,500. The operating limit is BRL 1,800 per month and excludes setup. These are separate budgets.”

Invariantes: reais, 12.500 de implantação única, 1.800 por mês de operação, implantação excluída do limite mensal, verbas separadas. Localizar separadores numéricos é permitido; alterar valores ou moeda não.

### T04 — Prazo condicionado

Original: “Deliver within ten business days after legal approval, provided the supplier grants access within two business days of that approval. Otherwise, agree on a new delivery date.”

Invariantes: dez dias úteis contados após aprovação jurídica; condição de acesso em até dois dias úteis da mesma aprovação; renegociar data se a condição falhar. Não iniciar a contagem hoje nem trocar dias úteis por corridos.

### T05 — Identificador técnico

Original: “Set `RETRY_LIMIT=0` for `billing-worker`. A response with status `409` must be recorded as a conflict; do not rename the field `decision_id`.”

Invariantes: preservar literalmente `RETRY_LIMIT=0`, `billing-worker`, `409` e `decision_id`; manter a classificação como conflito e a proibição de renomear. Traduzir a prosa ao redor é permitido.

### T06 — Ambiguidade preservada

Original: “Jordan told Casey that their proposal could be reviewed after the release. It is unclear whose proposal was meant or which release they referred to.”

Invariantes: preservar Jordan e Casey; manter sem resolução a autoria da proposta e a identificação da release; possibilidade de revisão, não promessa. “Lançamento” pode traduzir “release” sem identificar qual. Não escolher um dono por inferência.

## Revisão humana antes da coleta

Revisão dos textos e gabaritos: **aprovada**. Revisor: usuário responsável pelo projeto, nesta conversa. Data: 22/09/2026. A aprovação refere-se à revisão 1 deste corpus e não antecipa a avaliação das traduções que serão geradas.

Pontos para avaliar: o significado das seis rubricas; os rótulos propostos, especialmente R08, R09 e R11; a distinção entre dependência e agrupamento em R10/R12; as invariantes das seis traduções. Estes casos verificam uma hipótese delimitada, não representam uma amostra suficiente para medir a qualidade geral do modelo.
