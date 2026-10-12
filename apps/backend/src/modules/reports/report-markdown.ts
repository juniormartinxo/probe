import type { DocumentNode, ReportDocument } from "./report-document.ts";

// O texto do Processo é do usuário ou da IA: nenhuma marca dele vira formatação. Os caracteres de
// ênfase, código, link, HTML, título e tabela ganham escape em qualquer posição; os que só abrem
// citação, lista ou título sublinhado no começo da linha, só lá.
const escapeInline = (text: string): string => text.replace(/[\\`*_[\]<#|~]/g, "\\$&");
const escapeLine = (line: string): string =>
  escapeInline(line)
    .replace(/^(\s*)([>+=-])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(?=\s|$)/, "$1\\$2");
const escapeText = (text: string): string => text.split("\n").map(escapeLine).join("\n");

// Quebras de linha dentro de um parágrafo ou item continuam quebras de linha.
const hardBreaks = (text: string, indent = ""): string => text.split("\n").join(`  \n${indent}`);

// Numa célula de tabela, uma quebra de linha encerraria a linha da tabela.
const cell = (text: string): string => escapeInline(text).replace(/\r?\n/g, "<br>");

// `afterList`: o nó anterior também é uma lista. Duas listas seguidas com o mesmo marcador seriam lidas
// como uma só; a segunda troca de marcador.
function nodeOf(node: DocumentNode, afterList: boolean): string {
  switch (node.kind) {
    case "heading":
      return `${"#".repeat(node.level)} ${escapeInline(node.text).replace(/\n/g, " ")}`;
    case "paragraph": {
      const text = hardBreaks(escapeText(node.text));
      const body = node.note ? `*${text}*` : text;
      return node.label ? `**${escapeInline(node.label)}:**  \n${body}` : body;
    }
    case "list":
      return node.items
        .map((lines) => {
          const marker = afterList ? "* " : "- ";
          return marker + hardBreaks(escapeText(lines.join("\n")), "  ");
        })
        .join("\n");
    case "table":
      return [
        `| ${node.header.map(cell).join(" | ")} |`,
        `| ${node.header.map(() => "---").join(" | ")} |`,
        ...node.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      ].join("\n");
  }
}

// O relatório em Markdown: um bloco por nó, separados por uma linha em branco.
export function reportMarkdown(document: ReportDocument): string {
  const blocks = document.nodes.map((node, index) => nodeOf(node, document.nodes[index - 1]?.kind === "list"));
  return `${blocks.join("\n\n")}\n`;
}
