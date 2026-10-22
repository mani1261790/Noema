import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reserveReaderAiRequest, readAiOutput, readAiRequest } from './reader-ai';
import type { CmsPublicationDatabase } from './cms-publication-repository';

describe('reader AI bounded usage', () => {
 it('atomically admits only the daily allowance and resets the single row on the next day', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../../studio/migrations/0023_reader_ai_budget.sql',import.meta.url),'utf8'));
  const db = {prepare:(query:string)=>({bind:(...values:unknown[])=>({first:async()=>sql.prepare(query).get(...values as string[]) ?? null})})} as unknown as CmsPublicationDatabase;
  const now=new Date('2026-10-22T12:00:00Z');
  const results=await Promise.all(Array.from({length:105},()=>reserveReaderAiRequest(db,100,now)));
  expect(results.filter(Boolean)).toHaveLength(100);
  expect(await reserveReaderAiRequest(db,100,now)).toBe(false);
  expect(await reserveReaderAiRequest(db,100,new Date('2026-10-23T00:00:00Z'))).toBe(true);
  expect(sql.prepare('select requests from cms_reader_ai_budget').get()?.requests).toBe(1);
  for(const limit of [0,-1,NaN,201])expect(await reserveReaderAiRequest(db,limit,now)).toBe(false);
  sql.close();
 });
 it('accepts both documented provider response envelopes',()=>{
  expect(readAiOutput({response:{articles:[]}})).toBe('{"articles":[]}');
  expect(readAiOutput({choices:[{message:{content:'{"articles":[]}'}}]})).toBe('{"articles":[]}');
  expect(readAiOutput({choices:[]})).toBe('');
 });
 it('rejects cross-origin and oversized bodies before inference',async()=>{
  const make=(body:string,origin='https://noema.test')=>new Request('https://noema.test/api/discover',{method:'POST',headers:{origin,'content-type':'application/json'},body});
  expect(await readAiRequest(make('{"query":"AI"}'),'https://noema.test')).toEqual({query:'AI'});
  await expect(readAiRequest(make('{}','https://other.test'),'https://noema.test')).rejects.toThrow('origin');
  await expect(readAiRequest(make(JSON.stringify({query:'あ'.repeat(12000)})),'https://noema.test')).rejects.toThrow('size');
 });
});
