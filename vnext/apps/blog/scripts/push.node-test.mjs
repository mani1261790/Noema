import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(){
 const events={};const shown=[];const opened=[];
 const self={location:{origin:'https://noema-learn.uk'},addEventListener:(name,fn)=>events[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 runInNewContext(source,{self,URL,caches:{},fetch(){}});return {events,shown,opened};
}
test('push displays app icon and opens only a same-origin article',async()=>{
 const w=worker();let task;
 w.events.push({data:{json:()=>({title:'新着',body:'説明',url:'/articles/example',tag:'id'})},waitUntil:p=>task=p});await task;
 assert.equal(w.shown[0][1].icon,'/icons/v2/icon-192.png');
 w.events.notificationclick({notification:{close(){},data:w.shown[0][1].data},waitUntil:p=>task=p});await task;
 assert.equal(w.opened[0],'https://noema-learn.uk/articles/example');
});
test('invalid or external notification links fall back safely',async()=>{
 const w=worker();let task;
 w.events.push({data:{json:()=>({url:'https://evil.example/articles/example'})},waitUntil:p=>task=p});await task;
 assert.equal(w.shown[0][1].data.url,'https://noema-learn.uk/updates');
 w.events.push({data:{json:()=>{throw new Error('bad')}},waitUntil:p=>task=p});await task;
 assert.equal(w.shown[1][0],'Noemaの新着記事');
});
