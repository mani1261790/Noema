import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveReaderAiRequest, readAiOutput, readAiRequest, runReaderAi } from './reader-ai';
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
  expect(await reserveReaderAiRequest(db,100,now)).toBe(false); // A delayed previous-day request cannot reset today's budget.
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

// Exercise the actual provider boundary: refused requests must never invoke AI.run.
const bindings = vi.hoisted(() => ({
 AI: {run: vi.fn()},
 READER_AI_RATE_LIMITER: {limit: vi.fn()},
 CMS_DB: {prepare: vi.fn()},
 READER_AI_DAILY_LIMIT: '100'
}));
vi.mock('cloudflare:workers', () => ({env: bindings}));

describe('reader AI provider gate', () => {
 beforeEach(() => {
  vi.resetAllMocks();
  bindings.READER_AI_DAILY_LIMIT = '100';
  bindings.READER_AI_RATE_LIMITER.limit.mockResolvedValue({success:true});
  bindings.CMS_DB.prepare.mockReturnValue({bind:()=>({first:async()=>({requests:1})})});
  bindings.AI.run.mockResolvedValue({response:'ok'});
 });
 const request = () => new Request('https://noema.test/api/chat',{headers:{'cf-connecting-ip':'192.0.2.1'}});
 it('refuses bursts before reserving daily allowance or invoking AI', async () => {
  bindings.READER_AI_RATE_LIMITER.limit.mockResolvedValue({success:false});
  const result = await runReaderAi(request(),'system','question',{});
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(429);
  expect((result as Response).headers.get('retry-after')).toBe('60');
  expect(bindings.CMS_DB.prepare).not.toHaveBeenCalled();
  expect(bindings.AI.run).not.toHaveBeenCalled();
 });
 it('refuses exhausted daily allowance on both reader endpoints', async () => {
  bindings.CMS_DB.prepare.mockReturnValue({bind:()=>({first:async()=>null})});
  for (const endpoint of ['chat','discover']) {
   const result = await runReaderAi(new Request(`https://noema.test/api/${endpoint}`),'system','question',{});
   expect((result as Response).status).toBe(429);
   expect(Number((result as Response).headers.get('retry-after'))).toBeGreaterThan(0);
  }
  expect(bindings.AI.run).not.toHaveBeenCalled();
 });
 it('fails closed on database failure and invalid limit configuration', async () => {
  bindings.CMS_DB.prepare.mockImplementation(()=>{throw new Error('unavailable')});
  expect((await runReaderAi(request(),'s','q',{}) as Response).status).toBe(503);
  bindings.READER_AI_DAILY_LIMIT = 'invalid';
  expect((await runReaderAi(request(),'s','q',{}) as Response).status).toBe(503);
  expect(bindings.AI.run).not.toHaveBeenCalled();
 });
 it('bounds input and output, and never retries failed inference', async () => {
  expect((await runReaderAi(request(),'s','x'.repeat(24000),{}) as Response).status).toBe(400);
  expect(bindings.AI.run).not.toHaveBeenCalled();
  expect(await runReaderAi(request(),'s','q',{})).toBe('ok');
  expect(bindings.AI.run.mock.calls[0][1].max_tokens).toBe(900);
  bindings.AI.run.mockRejectedValue(new Error('provider unavailable'));
  expect((await runReaderAi(request(),'s','q',{}) as Response).status).toBe(503);
  expect(bindings.AI.run).toHaveBeenCalledTimes(2);
 });
});
