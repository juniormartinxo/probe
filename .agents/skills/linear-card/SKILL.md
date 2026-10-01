---
name: linear-card
description: Use ao criar, atualizar ou organizar tarefas do PROBE no Linear a partir dos documentos do projeto, preservando escopo, critérios, checks e verificação independente do harness.
---

# Linear card — PROBE

Adaptada da skill `linear-card` do Dragia. Cards descrevem resultados observáveis em português brasileiro; não são catálogos de arquivos ou classes. O Linear organiza o trabalho, mas não substitui as obrigações aprovadas do harness.

## Autoridade e escopo

Leia as instruções aplicáveis do repositório, `.specs/STATE.md` e os documentos da entrega: `plan.md`, `checks.md` e, quando existir, `corpus.md` em `.specs/features/<feature>/`. Consulte o desenho do MVP em `docs/superpowers/specs/2026-09-22-probe-mvp-design.md` como contexto, sem importar outras entregas para o card.

Leia a `tlc-spec-lean` local quando a entrega usar esse harness; a instalação atual está em `.claude/skills/tlc-spec-lean/SKILL.md`. Não afirme utilizar uma skill que não conseguiu acessar.

Criar cards ou aprovar documentos não autoriza implementar, escrever testes, instalar dependências, executar modelos, fazer commits ou publicar código. Respeite a fase e a autorização explícita do usuário. Em conflitos entre snapshots, preserve a instrução atual e registre a diferença relevante sem reescrever obrigações aprovadas.

## Identificação e duplicatas

1. Descubra time e projeto pelo Linear e confira sua relação com o PROBE e este repositório. Resolva IDs pela leitura atual; não reutilize os IDs do Dragia.
2. Se time ou projeto não tiver identificação inequívoca, pergunte antes da criação. Projeto ausente não autoriza criá-lo automaticamente.
3. Pesquise tarefas existentes no time/projeto, inclusive arquivadas e subtarefas, pelo nome da entrega e seus resultados. Reutilize ou vincule equivalentes; não duplique por diferença de título.
4. Leia os estados disponíveis. Para trabalho planejado ainda sem autorização de construção, prefira `Backlog`; use outro estado quando solicitado ou justificado pelo fluxo real.

Não presuma que o template Tasks do Dragia se aplica ao PROBE. Preserve o formato editorial abaixo, ajustando-o somente a um template efetivamente identificado ou a instruções do usuário.

## Campos nativos

| Campo | Regra |
| --- | --- |
| Time e projeto | Identificados e conferidos antes de publicar. |
| Título | Resultado e finalidade, com slice quando aplicável. |
| Responsável, datas, estimativa e ciclo | Somente com base explícita; caso contrário, vazios. |
| Milestone | Somente quando indicada ou inequivocamente ligada à entrega; não escolher a mais recente por padrão. |
| Prioridade e labels | Somente com base explícita ou convenção verificada do PROBE; não importar Medium ou labels do Dragia. |
| Pai e bloqueios | Relações reais por IDs nativos, coerentes com o texto; sem dependências circulares. |

Ao atualizar um card, preserve metadados não relacionados ao pedido. Não reatribua responsável, projeto ou milestone automaticamente.

## Conteúdo do card

Use `## Objetivo`, `## Descrição` e `## Arquivos`. A última seção contém links para as fontes, mesmo sem anexos. Subtítulos sob Descrição acomodam a rastreabilidade:

```markdown
## Objetivo

Resultado observável e sua finalidade.

## Descrição

Situação atual, escopo e exclusões relevantes. Distinguir trabalho previsto de evidência já obtida.

### Critérios de aceitação

- [ ] Resultado verificável — AC e checks correspondentes.

### Provas previstas

IDs dos checks, afirmações e comandos exatos de checks.md. Indicar evidências esperadas e se são controladas ou live.

### Dependências e conclusão

Pré-requisitos, bloqueios reais e condições para concluir. Decisões humanas pendentes permanecem explícitas.

## Arquivos

Referências ao plano, checks, estado, corpus e desenho pertinente.
```

Prefira objetivo em até duas frases e critérios agrupados por resultado. A concisão não pode apagar critérios, checks, bordas ou provas aprovadas. Não crie uma tarefa por check. Em uma entrega por slices, crie uma principal e subtarefas por resultado; mantenha na principal uma matriz AC → checks → subtarefa e explicite obrigações transversais.

Links de repositório devem derivar do remote verificado, preferencialmente com revisão identificada. Não invente URLs, comandos, contratos, evidências ou decisões. Anexos só quando necessários, sem segredos.

## Harness e evidências

- Preserve o perfil aprovado, `Coverage`, `Swept`, `Handoff` e todas as provas de `checks.md`. Cards não substituem nem enfraquecem esses documentos.
- Validação estrutural de documentos não prova comportamento. Fixture não prova integração real, qualidade semântica ou desempenho.
- Registre separadamente os checks live, com a exigência de `RUN_ID` e evidências identificadas. Ausência de serviço ou credencial mantém a obrigação pendente; nunca converta fixture em aprovação live.
- Inclua a verificação independente como condição de fechamento da entrega. No harness atual, após a construção autorizada e o último commit, o coordenador despacha um Verifier novo, distinto do builder, sobre `<feature base>..HEAD` e todos os checks.
- O relatório `verification.md` precisa registrar perfil, resultados e evidência localizada por check; o gate `validate_verification.py <feature>` deve sair com código 0. Não execute essa fase durante a criação dos cards.
- Não solicite nem publique segredos no Linear. Cite apenas a necessidade de configuração segura no ambiente autorizado.

Para `jev-translation-feasibility`, releia o estado atual: são 37 critérios e 51 checks. A revisão 1 dos gabaritos foi aprovada; a revisão das traduções concretas ainda depende de geração futura. C50 e C51 exigem evidência live. O template indicado em `chbae624/vllm-translategemma-12b-it` é uma adaptação cuja equivalência ao oficial não foi demonstrada; não trate sua aceitação como aprovada. AC 12/C14 continuam vigentes até decisão humana explícita registrada nas fontes. Configuração local e Jev são pré-requisitos de coleta, não impedimentos para planejamento.

## Publicar e conferir

Use as ferramentas Linear disponíveis. Crie primeiro a principal, depois as subtarefas e relações. Após cada publicação, releia os cards e confira conteúdo, time, projeto, pai, estado e dependências, além dos campos opcionais efetivamente solicitados. Se uma resposta for ambígua ou houver falha de transporte, pesquise antes de tentar criar novamente.

Entregue identificadores, links, hierarquia, dependências, cobertura e decisões humanas pendentes. Só declare criação confirmada pela ferramenta. Se o Linear estiver indisponível, entregue textos prontos para criação e explique a limitação; não instale conectores ou force uma nova autenticação como parte do planejamento.
