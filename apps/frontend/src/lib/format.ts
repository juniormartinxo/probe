const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
