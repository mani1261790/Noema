import { readerCommentInput, commentTokenHash, readCommentJson, type CommentsDatabase, type ReaderComment } from "@noema/cms";
interface CommentsEnvironment { CMS_DB: CommentsDatabase; COMMENTS_RATE_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>} }
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const fields="id,parent_id,author_name,author_kind,body,created_at,status";
export async function handleReaderComments(request:Request,env:CommentsEnvironment,slug:string):Promise<Response>{
 const url=new URL(request.url),db=env.CMS_DB;
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return json({error:"not_found"},404);
 if(request.method!=="GET"){
 if(!["POST","DELETE"].includes(request.method))return json({error:"method"},405);
 if(request.headers.get("origin")!==url.origin)return json({error:"origin"},403);
 if(!env.COMMENTS_RATE_LIMITER || !(await env.COMMENTS_RATE_LIMITER.limit({key:request.headers.get("cf-connecting-ip")??"unknown"})).success)return json({error:"rate_limit"},429);
 }
 const article=await db.prepare("SELECT id FROM cms_articles WHERE published_slug=? AND publication_status='published' AND published_visibility='public'").bind(slug).first<{id:string}>();
 if(!article)return json({error:"not_found"},404);
 if(request.method==="GET"){
 const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get("offset"))||0));
 const roots=await db.prepare(`SELECT ${fields} FROM reader_comments WHERE article_id=? AND parent_id IS NULL AND status='published' ORDER BY created_at DESC,id DESC LIMIT 4 OFFSET ?`).bind(article.id,Math.floor(offset)).all<ReaderComment>();
 const page=roots.results.slice(0,3);
 const replies=page.length?await db.prepare(`SELECT ${fields} FROM reader_comments WHERE parent_id IN (${page.map(()=>"?").join(",")}) AND status='published' ORDER BY created_at,id LIMIT 60`).bind(...page.map(c=>c.id)).all<ReaderComment>():{results:[]};
 const count=await db.prepare("SELECT count(*) n FROM reader_comments WHERE article_id=? AND parent_id IS NULL AND status='published'").bind(article.id).first<{n:number}>();
 return json({comments:page,replies:replies.results,total:count?.n??0,hasMore:roots.results.length>3});
 }
 let value:unknown;try{value=await readCommentJson(request);}catch{return json({error:"invalid_body"},400);}
 if(request.method==="DELETE"){
 const parsed=readerCommentInput.pick({id:true,token:true}).safeParse(value);if(!parsed.success)return json({error:"invalid_body"},400);
 await db.prepare("UPDATE reader_comments SET status='deleted',body='',author_name='削除済み',owner_hash=NULL WHERE id=? AND article_id=? AND owner_hash=? AND author_kind='reader'").bind(parsed.data.id,article.id,await commentTokenHash(parsed.data.token)).run();
 return json({ok:true});
 }
 const parsed=readerCommentInput.safeParse(value);if(!parsed.success)return json({error:"invalid_body"},400);
 const data=parsed.data,hash=await commentTokenHash(data.token);
 const existing=await db.prepare("SELECT id FROM reader_comments WHERE id=? AND article_id=? AND owner_hash=?").bind(data.id,article.id,hash).first();
 if(existing)return json({ok:true,id:data.id});
 // All checks live in the INSERT to avoid concurrent requests bypassing limits.
 const inserted=await db.prepare(`INSERT INTO reader_comments(id,article_id,parent_id,author_name,author_kind,body,owner_hash)
 SELECT ?,?,?,?,'reader',?,? WHERE
 (SELECT count(*) FROM reader_comments WHERE author_kind='reader' AND created_at>unixepoch()-86400)<500
 AND (SELECT count(*) FROM reader_comments WHERE article_id=? AND status='pending')<50
 AND (? IS NULL OR (EXISTS(SELECT 1 FROM reader_comments WHERE id=? AND article_id=? AND parent_id IS NULL AND status='published')
 AND (SELECT count(*) FROM reader_comments WHERE parent_id=? AND status IN ('pending','published'))<20))
 ON CONFLICT(id) DO NOTHING RETURNING id`).bind(data.id,article.id,data.parentId,data.name,data.body,hash,article.id,data.parentId,data.parentId,article.id,data.parentId).first();
 return inserted?json({ok:true,id:data.id},201):json({error:"unavailable"},409);
}
