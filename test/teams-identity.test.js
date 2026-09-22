import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
function functionSource(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));const end=source.slice(start+1).search(/\n(?:async )?function /);return source.slice(start,end<0?undefined:start+1+end);}
function load(name,dependencies={}){return vm.runInNewContext(`(${functionSource(name)})`,dependencies);}
const cleanText=v=>String(v||'').trim();
const extractDeep=load('extractTeamsDeepPath',{URL});
const extractId=load('extractTeamsConversationId',{extractTeamsDeepPath:extractDeep});
test('Teams link identity tolerates encoded IDs and rejects malformed encodings',()=>{
 assert.equal(extractId('https://teams.microsoft.com/l/chat/19%3Ag%40thread.v2/conversations'),'19:g@thread.v2');
 assert.equal(extractId('https://teams.microsoft.com/l/chat/%XX/conversations'),'');
});
test('a same-title open chat does not bypass the target group ID',async()=>{
 let clicks=0;
 const open=load('openTeamsConversationFromUi',{cleanText,DOMException,extractTeamsConversationId:extractId,currentTeamsConversationTitle:async()=> 'Same name',areCaptureTitlesConsistent:()=>true,activateTeamsChatArea:async()=>{},clickTeamsConversationById:async()=>{clicks++;return {clicked:true,title:'Same name'};},waitForTeamsConversationTitle:async()=>true,waitForTeamsConversation:async()=>{},closeTeamsChatListFilter:async()=>{}});
 const result=await open({}, {title:'Same name',url:'https://teams.microsoft.com/l/chat/19:g@thread.v2/conversations'});
 assert.equal(clicks,1);assert.equal(result.conversationId,'19:g@thread.v2');assert.equal(result.identityVerifiedById,true);
});
test('a missing group ID never falls back to an unrelated matching title',async()=>{
 const open=load('openTeamsConversationFromUi',{cleanText,DOMException,extractTeamsConversationId:extractId,currentTeamsConversationTitle:async()=> 'Same name',areCaptureTitlesConsistent:()=>true,activateTeamsChatArea:async()=>{},clickTeamsConversationById:async()=>({clicked:false}),filterTeamsChatList:async()=>false,clickTeamsConversationCandidate:async()=>{throw Error('unsafe title fallback');}});
 await assert.rejects(open({}, {title:'Same name',url:'https://teams.microsoft.com/l/chat/19:g@thread.v2/conversations'}),/无法在 Teams/);
});
function domPage(html){const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:200,height:30});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};return {dom,page:{evaluate:async(fn,arg)=>dom.window.eval(`(${fn})`)(arg)}};}
test('conversation ID selection uses complete IDs, not substring matches',async()=>{
 const {dom,page}=domPage('<div data-fui-tree-item-value="19:g@thread.v2-extra">Wrong</div><div data-fui-tree-item-value="chat-19:g@thread.v2">Right</div>');let clicked='';for(const el of dom.window.document.querySelectorAll('div'))el.onclick=()=>clicked=el.textContent;
 const select=load('clickTeamsConversationById');const result=await select(page,'19:g@thread.v2');assert.equal(result.clicked,true);assert.equal(clicked,'Right');dom.window.close();
});
test('ambiguous same-title groups are not selected arbitrarily',async()=>{
 const {dom,page}=domPage('<div role="treeitem">Same</div><div role="treeitem">Same</div>');const select=load('clickTeamsConversationCandidate');assert.equal(await select(page,'Same'),false);dom.window.close();
});
test('capture rejects a group change even after the original ID was located',async()=>{
 const capture=load('fetchTeamsWithWebdriver',{cleanText,DOMException,canonicalizeMaterialUrl:x=>x,extractTeamsConversationId:extractId,waitForTeamsConversation:async()=>{},readExistingTeamsComments:async()=>[],scrollTeamsMessages:async()=>[],extractTeamsFromPage:async()=>({title:'Other group'}),areCaptureTitlesConsistent:(a,b)=>a===b});
 await assert.rejects(capture({url:()=> 'https://teams.cloud.microsoft/'},'https://teams.microsoft.com/l/chat/19:g@thread.v2/conversations',{}, {expectedTitle:'Expected group',identityVerifiedById:true}),/已阻止抓取/);
});
test('already cancelled capture never touches the browser',async()=>{
 const capture=load('fetchTeamsWithWebdriver',{DOMException});
 const controller=new AbortController();controller.abort();
 await assert.rejects(capture({},'',{}, {signal:controller.signal}),{name:'AbortError'});
});
test('userscript shares the tested DOM extractor and rejects ambiguous root-page identity',async()=>{
 const {readdir}=await import('node:fs/promises');
 const files=await readdir(new URL('../userscripts/',import.meta.url));
 const script=await readFile(new URL('../userscripts/'+files.find(f=>f.endsWith('.js')),import.meta.url),'utf8');
 const {extractTeamsMessagesFromDocument}=await import('../src/capture-policy.js');
 assert.ok(script.includes(extractTeamsMessagesFromDocument.toString()),'userscript extractor drifted from server');
 const start=script.indexOf('function currentConversationUrl(');const end=script.indexOf('\n  function canonicalTeamsUrl',start);
 const {dom}=domPage('<div data-fui-tree-item-value="OneGQL|19:a@thread.v2">Group</div>');
 const resolve=vm.runInNewContext('('+script.slice(start,end)+')',{document:dom.window.document,clean:cleanText});
 assert.match(resolve('Group'),/19%3Aa%40thread.v2/);
 dom.window.document.body.insertAdjacentHTML('beforeend','<div data-fui-tree-item-value="OneGQL|19:b@thread.v2">Group</div>');
 assert.throws(()=>resolve('Group'),/无法唯一确认/);dom.window.close();
});
