import { describe, expect, it } from 'vitest';
import { discoveryCandidates, parseDiscoveryAnswer } from './ai-discovery';
import { previewArticles } from '@noema/content';
import { toArticleSummary } from './articles';
const articles=previewArticles.map(a=>toArticleSummary(a));
describe('grounded article guidance',()=>{
 it('only returns existing candidates, deduplicates them, and rejects invented references',()=>{
  const selected=parseDiscoveryAnswer(JSON.stringify({articles:[{id:0,reason:'記事の概要に対応'},{id:0,reason:'重複'},{id:99999,reason:'架空の記事'},{id:'https://evil.test',reason:'外部URL'}]}),articles);
  expect(selected).toEqual([{article:articles[0],reason:'記事の概要に対応'}]);
  expect(parseDiscoveryAnswer('{invalid',articles)).toBeNull();
  expect(parseDiscoveryAnswer('{"articles":[]}',articles)).toEqual([]);
 });
 it('retrieves Japanese questions across a growing corpus and bounds the prompt',()=>{
  const corpus=Array.from({length:1000},(_,i)=>({...articles[0],slug:`article-${i}`,title:i===999?'誤差逆伝播法を手計算する':'パソコンを使う',description:'説明'}));
  const result=discoveryCandidates(corpus,'誤差逆伝播を知りたい');
  expect(result[0].slug).toBe('article-999');expect(result.length).toBeLessThanOrEqual(60);expect(corpus[0].slug).toBe('article-0');
 });
});
