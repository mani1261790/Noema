import type { ArticleSummary } from '@noema/content';
import { normalizeArticleSearchText } from './article-search';

/** A bounded shortlist; Japanese bigrams also match questions without spaces. */
export function discoveryCandidates(articles: ArticleSummary[], query: string): ArticleSummary[] {
  const normalized = normalizeArticleSearchText(query);
  const terms = new Set(normalized.match(/[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu)?.flatMap(term => /[a-z0-9]/u.test(term) ? [term] : Array.from({length:term.length-1}, (_,i)=>term.slice(i,i+2))) ?? []);
  const score = (a: ArticleSummary) => {
    const text = normalizeArticleSearchText([a.title,a.description,...a.tags,...a.authors,a.editorDisplayName ?? ''].join(' '));
    return [...terms].reduce((sum,term)=>sum+(text.includes(term)?1:0),0);
  };
  const sorted = articles.map(article=>({article,score:score(article)})).sort((a,b)=>b.score-a.score);
  let size = 0;
  return sorted.slice(0,60).map(({article})=>article).filter(a=>{size += JSON.stringify([a.slug,a.title,a.description,a.features]).length; return size <= 18_000;});
}

export function parseDiscoveryAnswer(output: string, candidates: ArticleSummary[]): Array<{article: ArticleSummary; reason:string}> | null {
  try {
    const parsed = JSON.parse(output);
    if (!parsed || !Array.isArray(parsed.articles)) return null;
    const seen = new Set<number>();
    return parsed.articles.flatMap((item: {id?:unknown;reason?:unknown})=>{
      if (!item || !Number.isInteger(item.id) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 200) return [];
      const id = item.id as number;
      const article = candidates[id];
      if (!article || seen.has(id)) return [];
      seen.add(id); return [{article,reason:item.reason.trim()}];
    }).slice(0,3);
  } catch { return null; }
}
