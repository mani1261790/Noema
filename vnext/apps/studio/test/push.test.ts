import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchReaderPush } from "../worker/push";
import { handleReaderPush } from "../../blog/src/lib/push-api";
const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const db = testEnv.CMS_DB;
const origin = "https://noema-learn.uk";
const base64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
let subscription: { endpoint: string; keys: {p256dh: string;auth: string} };
let keys: { PUSH_VAPID_PUBLIC_KEY: string; PUSH_VAPID_PRIVATE_KEY: string };
async function article(id: string, publication = "unpublished", visibility = "public") {
 await db.prepare(`INSERT INTO cms_articles(id, slug, review_status, publication_status, draft_visibility, published_visibility, published_slug, current_revision_id, current_revision_number, created_by_subject, updated_by_subject, created_at, updated_at, published_at)
 VALUES (?, ?, 'approved', ?, 'public', ?, ?, ?, 1, 'test', 'test', '2026-01-01', '2026-01-01', ?)`)
 .bind(id,id,publication,visibility,id,id+'-r',publication==='published'?'2026-01-01':null).run();
 await db.prepare(`INSERT INTO cms_article_revisions(id,article_id,revision_number,frontmatter_json,markdown,content_sha256,created_by_subject,created_at) VALUES(?,?,1,?,'本文','hash','test','2026-01-01')`)
 .bind(id+'-r',id,JSON.stringify({title:'新しい記事',description:'通知の説明'})).run();
 await db.prepare("UPDATE cms_articles SET published_revision_id = ? WHERE id = ?").bind(id+'-r',id).run();
}
async function publish(id: string) { await db.prepare("UPDATE cms_articles SET publication_status = 'published', published_visibility = 'public' WHERE id = ?").bind(id).run(); }
const api = (method: string, body: unknown, requestOrigin = origin) => handleReaderPush(new Request(origin+'/api/push/subscription', {method,headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)}), {CMS_DB:db,...keys,PUSH_RATE_LIMITER:{limit:async()=>({success:true})}});
beforeAll(async()=>{
 const migrations=testEnv.CMS_TEST_MIGRATIONS;
 await applyD1Migrations(db,migrations.slice(0,-1));
 await article('legacy', 'published');
 await applyD1Migrations(db,migrations.slice(-1));
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
 keys={PUSH_VAPID_PUBLIC_KEY:base64(await crypto.subtle.exportKey('raw',pair.publicKey)),PUSH_VAPID_PRIVATE_KEY:jwk.d!};
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 subscription={endpoint:'https://fcm.googleapis.com/fcm/send/noema-test',keys:{p256dh:base64(await crypto.subtle.exportKey('raw',receiver.publicKey)),auth:base64(crypto.getRandomValues(new Uint8Array(16)).buffer)}};
});
beforeEach(async()=>{
 await db.prepare("DELETE FROM reader_push_subscriptions").run();
 await db.prepare("DELETE FROM cms_articles WHERE id <> 'legacy'").run();
});
describe('Web Push publication delivery',()=>{
 it('seeds existing publications without notifying readers',async()=>{
  expect((await db.prepare("SELECT expanded FROM reader_push_events WHERE article_id='legacy'").first())?.expanded).toBe(1);
 });
 it('registers, refreshes status, and removes only the matching secret subscription',async()=>{
  expect((await api('POST',subscription)).status).toBe(200);
  expect(await (await api('POST',{...subscription,action:'status'})).json()).toEqual({active:true});
  const foreign={...subscription,keys:{...subscription.keys,auth:base64(new Uint8Array(16).buffer)}};
  expect((await api('POST',foreign)).status).toBe(409);
  await api('DELETE',foreign);
  expect((await db.prepare('SELECT count(*) AS n FROM reader_push_subscriptions').first())?.n).toBe(1);
  await api('DELETE',subscription);
  expect(await (await api('POST',{...subscription,action:'status'})).json()).toEqual({active:false});
 });
 it('rejects cross-origin, private endpoints and oversized input',async()=>{
  expect((await api('POST',subscription,'https://evil.example')).status).toBe(403);
  expect((await api('POST',{...subscription,endpoint:'https://127.0.0.1/'})).status).toBe(400);
  expect((await api('POST',{...subscription,endpoint:'https://fcm.googleapis.com.evil.example/'})).status).toBe(400);
  expect((await api('POST',{...subscription,padding:'x'.repeat(5000)})).status).toBe(413);
 });
 it('atomically queues first publication and sends encrypted payload only once',async()=>{
  await api('POST',subscription); await article('new'); await publish('new');
  const send=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:201}));
  await Promise.all([dispatchReaderPush({CMS_DB:db,...keys},send),dispatchReaderPush({CMS_DB:db,...keys},send)]);
  expect(send).toHaveBeenCalledTimes(1);
  const init=send.mock.calls[0][1]!;
  expect(new Headers(init.headers).get('Content-Encoding')).toBe('aes128gcm');
  expect(new Headers(init.headers).get('Authorization')).toMatch(/^vapid /);
  expect(init.redirect).toBe('error');
  await publish('new'); await dispatchReaderPush({CMS_DB:db,...keys},send);
  expect(send).toHaveBeenCalledTimes(1);
 });
 it('does not send when the article becomes nonpublic or registration happens later',async()=>{
  await api('POST',subscription); await article('hidden'); await publish('hidden');
  await db.prepare("UPDATE cms_articles SET published_visibility='unlisted' WHERE id='hidden'").run();
  await article('late'); await publish('late');
  await db.prepare('UPDATE reader_push_subscriptions SET created_at=unixepoch()+1').run();
  const send=vi.fn<typeof fetch>(); await dispatchReaderPush({CMS_DB:db,...keys},send);expect(send).not.toHaveBeenCalled();
 });
 it('retries transient failures and deletes expired provider subscriptions',async()=>{
  await api('POST',subscription);await article('retry');await publish('retry');
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(new Response(null,{status:410}));
  await dispatchReaderPush({CMS_DB:db,...keys},send);
  expect((await db.prepare('SELECT status,attempts FROM reader_push_deliveries').first())).toMatchObject({status:'pending',attempts:1});
  await db.prepare('UPDATE reader_push_deliveries SET next_attempt=0').run();
  await dispatchReaderPush({CMS_DB:db,...keys},send);
  expect((await db.prepare('SELECT count(*) AS n FROM reader_push_subscriptions').first())?.n).toBe(0);
 });
});
