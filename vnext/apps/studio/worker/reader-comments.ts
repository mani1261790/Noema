import { readCommentJson, type CmsSession } from "@noema/cms";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function manageReaderComments(request:Request,db:D1Database,session:CmsSession):Promise<Response>{
 if(!session.capabilities.canEdit)return json({error:{message:"コメントを管理する権限がありません。"}},403);
 const url=new URL(request.url);
 if(request.method==="GET"){
 const status=url.searchParams.get("status")??"pending";
 if(!["pending","published","hidden"].includes(status))return json({error:{message:"表示条件が正しくありません。"}},400);
 const offset=Math.max(0,Math.min(100000,Math.floor(Number(url.searchParams.get("offset"))||0)));
 const rows=await db.prepare(`SELECT c.id,c.parent_id,c.author_name,c.author_kind,c.body,c.created_at,c.status,a.published_slug,
 json_extract(r.frontmatter_json,'$.title') article_title,p.body parent_body,p.status parent_status,
 (SELECT count(*) FROM reader_comments reply WHERE reply.parent_id=COALESCE(c.parent_id,c.id) AND reply.author_kind='staff' AND reply.status='published') staff_replies
 FROM reader_comments c JOIN cms_articles a ON a.id=c.article_id
 LEFT JOIN cms_article_revisions r ON r.id=a.published_revision_id
 LEFT JOIN reader_comments p ON p.id=c.parent_id
 WHERE c.status=? ORDER BY c.created_at DESC,c.id DESC LIMIT 21 OFFSET ?`).bind(status,offset).all();
 return json({comments:rows.results.slice(0,20),hasMore:rows.results.length>20});
 }
 if(request.method!=="POST")return json({error:{message:"この操作には対応していません。"}},405);
 let value:unknown;try{value=await readCommentJson(request);}catch{return json({error:{message:"入力が正しくありません。"}},400);}
 const data=value as {id?:string;action?:string;body?:string;replyId?:string};
 if(!data||typeof data.id!=="string"||!["publish","hide","reply"].includes(data.action??""))return json({error:{message:"入力が正しくありません。"}},400);
 const comment=await db.prepare("SELECT id,article_id,parent_id,status FROM reader_comments WHERE id=? AND status<>'deleted'").bind(data.id).first<{id:string;article_id:string;parent_id:string|null;status:string}>();
 if(!comment)return json({error:{message:"コメントが見つかりません。"}},404);
 const subject=session.identity.subject;
 if(data.action==="reply"){
 if(typeof data.body!=="string"||!data.body.trim()||data.body.trim().length>2000||typeof data.replyId!=="string"||!/^[0-9a-f-]{36}$/i.test(data.replyId))return json({error:{message:"返信は1〜2,000文字で入力してください。"}},400);
 const parent=comment.parent_id??comment.id;
 const row=await db.prepare(`INSERT INTO reader_comments(id,article_id,parent_id,author_name,author_kind,body,status,staff_subject,moderated_by,moderated_at)
 SELECT ?,?,?,?,'staff',?,'published',?,?,unixepoch() WHERE
 EXISTS(SELECT 1 FROM reader_comments p JOIN cms_articles a ON a.id=p.article_id WHERE p.id=? AND p.status='published' AND a.publication_status='published' AND a.published_visibility='public')
 AND (SELECT count(*) FROM reader_comments WHERE parent_id=? AND status IN ('pending','published'))<20
 ON CONFLICT(id) DO NOTHING RETURNING id`).bind(data.replyId,comment.article_id,parent,session.identity.displayName||"Noema編集部",data.body.trim(),subject,subject,parent,parent).first();
 if(!row){
 const existing=await db.prepare("SELECT id FROM reader_comments WHERE id=? AND staff_subject=? AND parent_id=?").bind(data.replyId,subject,parent).first();
 if(!existing)return json({error:{message:"公開済みのコメントにのみ返信できます。返信上限は20件です。"}},409);
 }
 }else{
 const updated=await db.prepare(`UPDATE reader_comments SET status=?,moderated_by=?,moderated_at=unixepoch() WHERE id=? AND status<>'deleted'
 AND (?='hidden' OR (EXISTS(SELECT 1 FROM cms_articles a WHERE a.id=reader_comments.article_id AND a.publication_status='published' AND a.published_visibility='public')
 AND (parent_id IS NULL OR (EXISTS(SELECT 1 FROM reader_comments p WHERE p.id=reader_comments.parent_id AND p.status='published')
 AND (SELECT count(*) FROM reader_comments sibling WHERE sibling.parent_id=reader_comments.parent_id AND sibling.id<>reader_comments.id AND sibling.status IN ('pending','published'))<20)))) RETURNING id`)
 .bind(data.action==="publish"?"published":"hidden",subject,data.id,data.action==="publish"?"published":"hidden").first();
 if(!updated)return json({error:{message:"記事・返信先が非公開、または返信上限に達しているため公開できません。"}},409);
 }
 return json({ok:true});
}
