export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateDescription(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function buildNotebookDescription(input: {
  title: string;
  chapterTitle?: string;
  tags?: string[];
  articleHtml?: string;
}): string {
  const body = input.articleHtml ? truncateDescription(stripHtml(input.articleHtml), 150) : "";
  const tagLine = input.tags && input.tags.length > 0 ? input.tags.slice(0, 4).join(", ") : "";
  const prefix = [input.chapterTitle, tagLine].filter(Boolean).join(" / ");

  if (body && prefix) return `${input.title}。${prefix}。${body}`;
  if (body) return `${input.title}。${body}`;
  if (prefix) return `${input.title}。${prefix}を学べるNoemaの教材ページ。`;
  return `${input.title}を学べるNoemaの教材ページ。`;
}
