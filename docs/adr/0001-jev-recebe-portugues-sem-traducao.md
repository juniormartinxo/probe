# Jev recebe português, sem tradução local

O desenho de 22/09/2026 previa traduzir para inglês, com TranslateGemma 12B Q6_K local, antes das avaliações do Jev. Em 02/10/2026, os 12 casos relacionais do corpus foram enviados ao Jev real (`jev-1.13.0`) em PT-BR e em inglês traduzido à mão (o melhor caso possível para a tradução). As escolhas coincidiram em 68 de 72 julgamentos; os acertos foram PT 63/72 e EN 66/72, e a diferença ficou só em escolhas de baixa confiança. Decidimos enviar o português direto: o ganho não paga o runtime local, o template oficial nem a contagem de tokens. Evidência (script e respostas brutas) em `.specs/features/jev-translation-feasibility/evidence/2026-10-02-jev-pt-en/` no commit `98ce217`; a bancada e o diretório `.specs/` foram removidos depois.

## Consequences

Não existe tradutor, nem traduções versionadas, no modelo de dados. Se o Jev passar a errar de forma sistemática em português, reabra este ADR com casos novos antes de reintroduzir a tradução.
