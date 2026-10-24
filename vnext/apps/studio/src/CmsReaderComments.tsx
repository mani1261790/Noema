import { useEffect, useState } from "react";
import type { ReaderComment } from "@noema/cms";
import { cmsRequest } from "./cms-client";
import type { CmsLibraryConnection } from "./CmsArticleLibrary";
import "./reader-comments.css";
type Comment = ReaderComment & {article_title:string|null;published_slug:string|null;parent_body:string|null;parent_status:string|null;staff_replies:number};
export function CmsReaderComments({connection}:{connection:CmsLibraryConnection}){
 const [status,setStatus]=useState("pending"),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [items,setItems]=useState<Comment[]>([]),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [reply,setReply]=useState<{id:string;replyId:string;body:string}|null>(null);
 useEffect(()=>{
  if(connection.kind!=="ready")return;
  let active=true;setLoading(true);setError("");
  void cmsRequest(`/api/cms/reader-comments?status=${status}&offset=${offset}`,{method:"GET"}).then(result=>{
   if(!active)return;if(!result.ok){setError(result.error.message);return;}
   const data=result.value as {comments:Comment[];hasMore:boolean};setItems(data.comments);setMore(data.hasMore);
  }).catch(()=>{if(active)setError("コメントを取得できませんでした。");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[connection.kind,status,offset,refresh]);
 async function action(id:string,action:string){
  setBusy(true);setError("");
  try{const result=await cmsRequest("/api/cms/reader-comments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action,...(action==="reply"?{body:reply?.body,replyId:reply?.replyId}:{})})});
  if(!result.ok){setError(result.error.message);return;}setReply(null);setRefresh(v=>v+1);
  }catch{setError("保存できませんでした。もう一度お試しください。");}finally{setBusy(false);}
 }
 return <section className="studio-reader-comments" aria-labelledby="studio-comments-heading">
  <h1 id="studio-comments-heading" tabIndex={-1}>読者のコメント</h1>
  <p>読者の投稿は承認後に公開されます。名前は自己申告です。返信は「Noema運営」と表示されます。</p>
  {connection.kind!=="ready"?<p>Studioに接続すると管理できます。</p>:<>
   <div className="comment-actions" aria-label="コメントの状態">{[["pending","承認待ち"],["published","公開中"],["hidden","非表示"]].map(([value,label])=><button type="button" key={value} aria-pressed={status===value} disabled={busy} onClick={()=>{setStatus(value);setOffset(0);setReply(null);}}>{label}</button>)}<button type="button" disabled={busy||loading} onClick={()=>setRefresh(v=>v+1)}>再読み込み</button></div>
   {error&&<p role="alert">{error}</p>}
   {loading?<p role="status">読み込み中…</p>:error?null:items.length===0?<p>該当するコメントはありません。</p>:items.map(c=><article className="studio-reader-comment" key={c.id}>
    <p><strong>{c.article_title??"非公開の記事"}</strong></p>
    <p>{c.author_name} · {c.author_kind==="staff"?"Noema運営":"読者"} · {new Date(c.created_at*1000).toLocaleString("ja-JP")} · {c.staff_replies?"運営の返信あり":"運営の返信なし"}</p>
    {c.parent_id&&<details><summary>返信先を確認</summary><p className="comment-body">{c.parent_body||"削除済み"}</p><p>{c.parent_status!=="published"?"返信先は公開されていません。":""}</p></details>}
    <p className="comment-body">{c.body}</p>
    <div className="comment-actions">
     {c.status!=="published"&&<button type="button" disabled={busy} onClick={()=>void action(c.id,"publish")}>公開する</button>}
     {c.status!=="hidden"&&<button type="button" disabled={busy} onClick={()=>void action(c.id,"hide")}>非表示にする</button>}
     {c.status==="published"&&<button type="button" disabled={busy} onClick={()=>setReply({id:c.id,replyId:crypto.randomUUID(),body:""})}>返信する</button>}
    </div>
    {reply?.id===c.id&&<form noValidate onSubmit={e=>{e.preventDefault();void action(c.id,"reply");}}><label>運営からの返信<textarea required maxLength={2000} rows={4} value={reply.body} onChange={e=>setReply({...reply,body:e.target.value})}/></label><p>送信するとすぐに公開されます。</p><div className="comment-actions"><button disabled={busy||!reply.body.trim()} type="submit">返信を公開</button><button type="button" disabled={busy} onClick={()=>setReply(null)}>キャンセル</button></div></form>}
   </article>)}
   <div className="comment-actions"><button type="button" disabled={busy||loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-20))}>前の20件</button><button type="button" disabled={busy||loading||!more} onClick={()=>setOffset(v=>v+20)}>次の20件</button></div>
  </>}
 </section>;
}
