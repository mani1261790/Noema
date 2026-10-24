import type { ReaderComment } from "@noema/cms";
type Own={id:string;token:string;body:string};
export function initializeReaderComments(){
 const root=document.querySelector<HTMLElement>("[data-reader-comments]");if(!root)return;
 const q=<T extends HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 const form=q<HTMLFormElement>("[data-comments-form]"),status=q("[data-comments-status]"),list=q("[data-comments-list]"),more=q<HTMLButtonElement>("[data-comments-more]"),retry=q<HTMLButtonElement>("[data-comments-retry]"),open=q<HTMLButtonElement>("[data-comments-open]");
 const name=form.elements.namedItem("name") as HTMLInputElement,body=form.elements.namedItem("body") as HTMLTextAreaElement;
 const endpoint=`/api/comments/${encodeURIComponent(root.dataset.slug!)}`,storageKey=`noema-comments:${root.dataset.slug}`;
 let offset=0,parentId:string|null=null,own:Own[]=[],pending:Own|null=null,pendingSignature="",loading=false;
 try{const stored=JSON.parse(localStorage.getItem(storageKey)??"[]");if(Array.isArray(stored))own=stored.filter(v=>v&&typeof v.id==="string"&&typeof v.token==="string"&&typeof v.body==="string");}catch{/* storage may be blocked */}
 const save=()=>localStorage.setItem(storageKey,JSON.stringify(own));
 const el=(tag:string,text?:string,className?:string)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
 function showForm(parent:string|null=null,label=""){
  parentId=parent;pending=null;form.hidden=false;open.setAttribute("aria-expanded","true");q("[data-reply-label]").textContent=label;body.focus();
 }
 function renderComment(c:ReaderComment,isReply=false){
  const item=el("article",undefined,"reader-comment");item.id=`comment-${c.id}`;
  const meta=el("p",`${c.author_name} · ${new Date(c.created_at*1000).toLocaleDateString("ja-JP")}`,"reader-comment__meta");
  meta.append(el("span",c.author_kind==="staff"?"Noema運営":"読者","reader-comment__badge"));
  item.append(meta);
  if(c.body.length>120){
   item.append(el("p",c.body.slice(0,120)+"…","reader-comment__body reader-comment__excerpt"));
   const full=el("details");full.append(el("summary","全文を読む"),el("p",c.body,"reader-comment__body"));item.append(full);
  }else item.append(el("p",c.body,"reader-comment__body"));
  if(!isReply){const button=el("button","返信する") as HTMLButtonElement;button.type="button";button.addEventListener("click",()=>showForm(c.id,`${c.author_name}さんのコメントへの返信`));item.append(button);}
  return item;
 }
 async function load(reset=false){
  if(loading)return;loading=true;more.disabled=true;retry.hidden=true;status.textContent="コメントを読み込んでいます…";
  try{
   const response=await fetch(`${endpoint}?offset=${reset?0:offset}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();
   const data=await response.json() as {comments:ReaderComment[];replies:ReaderComment[];total:number;hasMore:boolean};
   if(reset){offset=0;list.replaceChildren();}
   for(const c of data.comments){const item=renderComment(c);const replies=data.replies.filter(r=>r.parent_id===c.id);
    if(replies.length){const details=el("details"),summary=el("summary",`返信 ${replies.length}件`),container=el("div",undefined,"reader-comment__replies");for(const reply of replies)container.append(renderComment(reply,true));details.append(summary,container);item.append(details);}list.append(item);
   }
   offset+=data.comments.length;more.hidden=!data.hasMore;q("[data-comment-count]").textContent=`${data.total}件`;
   status.textContent=data.total?"":"まだコメントはありません。最初の質問や感想をどうぞ。";
  }catch{status.textContent="コメントを読み込めませんでした。時間をおいてお試しください。";retry.hidden=false;}
  finally{loading=false;more.disabled=false;}
 }
 function renderOwn(){
  const container=q("[data-own-comments]");container.replaceChildren();if(!own.length)return;
  const details=el("details"),summary=el("summary",`このブラウザからの投稿 ${own.length}件`);details.append(summary,el("p","承認前の投稿もここから削除できます。公開状態は上の一覧で確認してください。","comment-note"));
  for(const entry of own){const row=el("div",undefined,"reader-comment");row.append(el("p",entry.body,"reader-comment__body"));
   const remove=el("button","削除する") as HTMLButtonElement;remove.type="button";
   remove.addEventListener("click",()=>{
    if(remove.dataset.confirm!=="yes"){remove.dataset.confirm="yes";remove.textContent="この投稿を削除しますか？ もう一度押して削除";return;}
    remove.disabled=true;
    void fetch(endpoint,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:entry.id,token:entry.token}),signal:AbortSignal.timeout(15000)}).then(async r=>{
     if(!r.ok)throw Error();own=own.filter(v=>v.id!==entry.id);try{save();}catch{/* server deletion succeeded */}renderOwn();await load(true);status.textContent="投稿を削除しました。返信も公開一覧には表示されなくなります。";
    }).catch(()=>{status.textContent="削除できませんでした。時間をおいてもう一度お試しください。";remove.disabled=false;});
   });row.append(remove);details.append(row);
  }container.append(details);
 }
 open.addEventListener("click",()=>showForm());
 q("[data-comments-cancel]").addEventListener("click",()=>{form.hidden=true;open.setAttribute("aria-expanded","false");open.focus();});
 more.addEventListener("click",()=>void load());retry.addEventListener("click",()=>void load(true));
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!name.value.trim()||!body.value.trim()){status.textContent="表示名とコメントを入力してください。";return;}
  const buttons=Array.from(form.querySelectorAll<HTMLButtonElement>("button"));buttons.forEach(b=>b.disabled=true);
  try{
   const signature=JSON.stringify([name.value.trim(),body.value.trim(),parentId]);
   if(signature!==pendingSignature){pending=null;pendingSignature=signature;}
   pending??={id:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join(""),body:body.value.trim()};
   // Persist the deletion capability before sending, including ambiguous network outcomes.
   own=own.filter(c=>c.id!==pending!.id);own.push(pending);save();
   const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...pending,name:name.value.trim(),parentId,website:(form.elements.namedItem("website") as HTMLInputElement).value}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(response.status===429?"投稿が続いています。少し時間をおいてお試しください。":"送信できませんでした。返信先や受付状況を確認して、時間をおいてお試しください。");
   body.value="";pending=null;form.hidden=true;open.setAttribute("aria-expanded","false");renderOwn();status.textContent="送信しました。運営の確認後に公開されます。";
  }catch(error){status.textContent=error instanceof DOMException?"送信を確認できませんでした。ブラウザの保存設定と通信状況を確認して、再度お試しください。":error instanceof Error?error.message:"送信できませんでした。";renderOwn();}
  finally{buttons.forEach(b=>b.disabled=false);}
 });
 renderOwn();
 if("IntersectionObserver" in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();void load();}},{rootMargin:"300px"});observer.observe(root);}else void load();
}
