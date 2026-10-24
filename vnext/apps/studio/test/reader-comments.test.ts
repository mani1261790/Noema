import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll,beforeEach,describe,expect,it } from "vitest";
import { handleReaderComments } from "../../blog/src/lib/comments-api";
import { manageReaderComments } from "../worker/reader-comments";
import type { CmsSession } from "@noema/cms";
const testEnv=env as Env&{CMS_TEST_MIGRATIONS:D1Migration[]},db=testEnv.CMS_DB;
const origin="https://noema-learn.uk";
const admin:CmsSession={identity:{subject:"admin",role:"admin",displayName:"編集者",email:"private@example.test",publicId:"editor"},capabilities:{canEdit:true,canApprove:true,canComment:true,canManageMembers:true,canPublish:true},passwordLoginReadyAt:null};
const input=()=>({id:crypto.randomUUID(),token:"a".repeat(64),name:"読者",body:"<script>alert(1)</script> 質問",parentId:null as string|null});
async function api(method="GET",body?:unknown,slug="article",allowed=true,requestOrigin=origin){return handleReaderComments(new Request(`${origin}/api/comments/${slug}`,{method,headers:{Origin:requestOrigin,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),{CMS_DB:db,COMMENTS_RATE_LIMITER:{limit:async()=>({success:allowed})}},slug);}
async function manage(body?:unknown,session=admin){return manageReaderComments(new Request("https://studio.noema-learn.uk/api/cms/reader-comments",{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),db,session);}
beforeAll(()=>applyD1Migrations(db,testEnv.CMS_TEST_MIGRATIONS));
beforeEach(async()=>{
 await db.prepare("DELETE FROM reader_comments").run();await db.prepare("DELETE FROM cms_articles").run();
 await db.prepare(`INSERT INTO cms_articles(id,slug,review_status,publication_status,draft_visibility,published_visibility,published_slug,current_revision_id,current_revision_number,created_by_subject,updated_by_subject,created_at,updated_at) VALUES('article','article','approved','published','public','public','article','r',1,'test','test','2026-01-01','2026-01-01')`).run();
});
describe("reader comments",()=>{
 it("keeps submissions private until approved and exposes no ownership or identity secrets",async()=>{
  const data=input();expect((await api("POST",data)).status).toBe(201);
  expect((await (await api()).json() as {total:number}).total).toBe(0);
  expect((await (await manage()).json() as {comments:unknown[]}).comments).toHaveLength(1);
  expect((await manage({id:data.id,action:"publish"})).status).toBe(200);
  const result=await (await api()).json() as {comments:Record<string,unknown>[]};
  expect(result.comments[0].body).toBe(data.body);expect(result.comments[0].author_kind).toBe("reader");
  expect(JSON.stringify(result)).not.toMatch(/owner_hash|token|staff_subject|email/);
 });
 it("requires moderation permission",async()=>{
  const data=input();await api("POST",data);
  const denied={...admin,capabilities:{...admin.capabilities,canEdit:false}};
  expect((await manage(undefined,denied)).status).toBe(403);
  expect((await manage({id:data.id,action:"publish"},denied)).status).toBe(403);
 });
 it("supports verified staff replies and hides descendants when a parent is hidden or deleted",async()=>{
  const data=input();await api("POST",data);await manage({id:data.id,action:"publish"});
  const replyId=crypto.randomUUID();expect((await manage({id:data.id,replyId,action:"reply",body:"回答です"})).status).toBe(200);
  await manage({id:data.id,replyId,action:"reply",body:"回答です"});
  const page=await (await api()).json() as {replies:{author_kind:string;author_name:string}[]};expect(page.replies).toHaveLength(1);expect(page.replies[0]).toMatchObject({author_kind:"staff",author_name:"編集者"});
  await api("DELETE",{id:data.id,token:"b".repeat(64)});expect((await (await api()).json() as {total:number}).total).toBe(1);
  await manage({id:data.id,action:"hide"});expect((await (await api()).json() as {replies:unknown[]}).replies).toHaveLength(0);
  await manage({id:data.id,action:"publish"});await api("DELETE",data);
  expect((await (await api()).json() as {total:number}).total).toBe(0);
  expect(await db.prepare("SELECT body,owner_hash,author_name FROM reader_comments WHERE id=?").bind(data.id).first()).toEqual({body:"",owner_hash:null,author_name:"削除済み"});
  expect((await manage({id:data.id,action:"publish"})).status).toBe(404);
 });
 it("rejects foreign origins, oversized input, honeypots and rate-limited writes",async()=>{
  expect((await api("POST",input(),"article",true,"https://evil.test")).status).toBe(403);
  expect((await api("POST",input(),"article",false)).status).toBe(429);
  expect((await api("POST",{...input(),body:"x".repeat(13000)})).status).toBe(400);
  expect((await api("POST",{...input(),website:"spam"})).status).toBe(400);
  expect((await api("POST",{...input(),name:" "})).status).toBe(400);
 });
 it("excludes unpublished and unlisted articles and invalid reply targets",async()=>{
  expect((await api("POST",{...input(),parentId:crypto.randomUUID()})).status).toBe(409);
  const parent=input();await api("POST",parent);
  expect((await api("POST",{...input(),parentId:parent.id})).status).toBe(409);
  await db.prepare("UPDATE cms_articles SET published_visibility='unlisted'").run();expect((await api()).status).toBe(404);expect((await api("POST",input())).status).toBe(404);
  await db.prepare("UPDATE cms_articles SET published_visibility='public',publication_status='unpublished'").run();expect((await api()).status).toBe(404);
 });
 it("handles retries idempotently and paginates threads without mixing replies",async()=>{
  const first=input();await api("POST",first);expect((await api("POST",first)).status).toBe(200);await manage({id:first.id,action:"publish"});
  const reply={...input(),parentId:first.id};await api("POST",reply);await manage({id:reply.id,action:"publish"});
  expect((await api("POST",{...input(),parentId:reply.id})).status).toBe(409);
  for(let i=0;i<3;i++){const data=input();await api("POST",data);await manage({id:data.id,action:"publish"});}
  const page=await (await api()).json() as {comments:unknown[];hasMore:boolean;total:number};expect(page.comments).toHaveLength(3);expect(page.hasMore).toBe(true);expect(page.total).toBe(4);
 });
 it("enforces pending queue and thread limits atomically",async()=>{
  const parent=input();await api("POST",parent);await manage({id:parent.id,action:"publish"});
  for(let i=0;i<20;i++)expect((await api("POST",{...input(),parentId:parent.id})).status).toBe(201);
  expect((await api("POST",{...input(),parentId:parent.id})).status).toBe(409);
  const hidden=await db.prepare("SELECT id FROM reader_comments WHERE parent_id=? LIMIT 1").bind(parent.id).first<{id:string}>();
  await manage({id:hidden!.id,action:"hide"});
  expect((await api("POST",{...input(),parentId:parent.id})).status).toBe(201);
  expect((await manage({id:hidden!.id,action:"publish"})).status).toBe(409);
  for(let i=0;i<30;i++)await api("POST",input());
  expect((await api("POST",input())).status).toBe(409);
 });
});
