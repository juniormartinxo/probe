import { createRequire } from "node:module";
import { dirname } from "node:path";
import pdfmake, { type Content } from "pdfmake";
import type { DocumentNode, ReportDocument } from "./report-document.ts";

// A Roboto que vem com o pdfmake: embutida no arquivo, com os acentos do português e texto selecionável.
const require = createRequire(import.meta.url);
const font = (file: string) => require.resolve(`pdfmake/fonts/Roboto/${file}`);
const fonts = {
  Roboto: {
    normal: font("Roboto-Regular.ttf"),
    bold: font("Roboto-Medium.ttf"),
    italics: font("Roboto-Italic.ttf"),
    bolditalics: font("Roboto-MediumItalic.ttf"),
  },
};
const fontDirectory = dirname(fonts.Roboto.normal);
pdfmake.setFonts(fonts);
// O documento só lê as fontes: nenhuma URL nem outro arquivo do disco, venha o texto de onde vier.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => dirname(path) === fontDirectory);

type DocumentDefinition = Parameters<typeof pdfmake.createPdf>[0];

const muted = "#6b7280";

const headingStyles = { 1: "title", 2: "section", 3: "subsection", 4: "block" } as const;

function contentOf(node: DocumentNode): Content {
  switch (node.kind) {
    case "heading":
      return { text: node.text, style: headingStyles[node.level], headlineLevel: node.level };
    case "paragraph":
      return {
        text: [...(node.label ? [{ text: `${node.label}: `, bold: true }] : []), node.text],
        ...(node.note && { color: muted }),
        margin: [0, 0, 0, 6],
      };
    case "list": {
      const items = node.items.map(([first, ...details]) => ({
        stack: [first ?? "", ...details.map((detail) => ({ text: detail, color: muted, fontSize: 9 }))],
      }));
      return { ul: items, margin: [0, 0, 0, 6] };
    }
    case "table": {
      const columns = node.columns ?? node.header.map((_, index) => (index === node.header.length - 1 ? "wide" : "narrow"));
      return {
        table: {
          headerRows: 1,
          widths: columns.map((column) => (column === "wide" ? "*" : "auto")),
          body: [node.header, ...node.rows].map((row, rowIndex) =>
            row.map((text, index) => ({ text, ...(rowIndex === 0 && { bold: true }), ...(columns[index] === "narrow" && { noWrap: true }) })),
          ),
          dontBreakRows: false,
        },
        layout: "lightHorizontalLines",
        fontSize: 9,
        margin: [0, 0, 0, 8],
      };
    }
  }
}

// O relatório em PDF: A4, títulos, tabelas que repetem o cabeçalho ao quebrar a página e a numeração
// no rodapé. A data do arquivo é a da Finalização, então exportar de novo dá o mesmo arquivo.
export function reportPdf(document: ReportDocument): Promise<Buffer> {
  const finalizedAt = new Date(document.finalizedAt);
  const definition: DocumentDefinition = {
    pageSize: "A4",
    pageMargins: [48, 48, 48, 56],
    info: { title: document.title, creator: "PROBE", producer: "PROBE", creationDate: finalizedAt, modDate: finalizedAt },
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.2 },
    styles: {
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
      section: { fontSize: 14, bold: true, margin: [0, 14, 0, 6] },
      subsection: { fontSize: 12, bold: true, margin: [0, 10, 0, 4] },
      block: { fontSize: 10, bold: true, color: muted, margin: [0, 6, 0, 4] },
    },
    content: document.nodes.map(contentOf),
    // Um título não fica sozinho no fim da página: vai para a próxima, junto do que ele abre.
    pageBreakBefore: (node, { getFollowingNodesOnPage }) => node.headlineLevel !== undefined && getFollowingNodesOnPage().length === 0,
    footer: (currentPage, pageCount) => ({
      text: `Página ${currentPage} de ${pageCount}`,
      alignment: "center",
      fontSize: 8,
      color: muted,
      margin: [0, 20, 0, 0],
    }),
  };
  return pdfmake.createPdf(definition).getBuffer();
}
