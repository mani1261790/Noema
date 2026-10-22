import { describe, expect, it } from "vitest";
import type { ArticleSummary } from "@noema/content";
import { isContinuationTitle, selectEntryArticles } from "./article-discovery";
const article = (slug: string, approach: ArticleSummary['approach'], title = slug): ArticleSummary => ({ slug, title, approach, description: '', excerpt: '', authors: ['Noema'], tags: [], topics: ['data-models'], href: `/articles/${slug}`, heroImage: null, publishedAt: '2026-10-01', updatedAt: '2026-10-01' });
describe('homepage entry choices', () => {
  it('recognizes later installments without rejecting version numbers', () => {
    for (const title of ['仕組み②', '第２回 学習', 'Part 3: 実験', 'その2', '学習（3）', '後編']) expect(isContinuationTitle(title), title).toBe(true);
    for (const title of ['仕組み①', '第1回 学習', 'Python 3を使う', 'HTML5とCSS3']) expect(isContinuationTitle(title), title).toBe(false);
  });
  it('offers different reading intents and excludes later series parts', () => {
    const start = article('start', 'practice', '道具の基本');
    const later = article('later', 'theory', '実験');
    const theory = article('theory', 'theory');
    const build = article('build', 'development');
    const items = [later, theory, build, start];
    expect(selectEntryArticles(items, [{items:[start,later]}])).toEqual([start,theory,build]);
    expect(items[0]).toBe(later);
    expect(selectEntryArticles(items, [], 0)).toEqual([]);
  });
  it('does not fill a sparse catalog with a sequel', () => {
    expect(selectEntryArticles([article('sequel','theory','仕組み②')], [])).toEqual([]);
  });
});
