import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {
  clickTeamsConversationById, clickTeamsConversationCandidate, extractTeamsConversationId,
  openTeamsConversationFromUi, waitForTeamsReady
} from '../src/sources/teams-page.js';

// fetchTeamsWithWebdriver is orchestration in server.js; it is still evaluated in
// isolation with injected collaborators.
const serverSource=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
function functionSource(name){const start=serverSource.search(new RegExp(`(?:async )?function ${name}\\(`));const end=serverSource.slice(start+1).search(/\n(?:(?:export )?(?:async )?function |const |let |\/\/ )/);return serverSource.slice(start,end<0?undefined:start+1+end);}
function load(name,dependencies={}){return vm.runInNewContext(`(${functionSource(name)})`,dependencies);}
const cleanText=v=>String(v||'').trim();
const CHAT='https://teams.microsoft.com/l/chat/19:g@thread.v2/conversations';

function deps(overrides={}){
  return {
    currentTeamsConversationTitle:async()=>'Same name',
    activateTeamsChatArea:async()=>{},
    clickTeamsConversationByIdWhenReady:async()=>({clicked:false,title:''}),
    waitForTeamsConversationTitle:async()=>true,
    waitForTeamsConversation:async()=>{},
    filterTeamsChatList:async()=>false,
    closeTeamsChatListFilter:async()=>{},
    clickTeamsConversationCandidate:async()=>{throw Error('unsafe title fallback');},
    openTeamsConversationViaSearch:async()=>false,
    ...overrides
  };
}

test('Teams link identity tolerates encoded IDs and rejects malformed encodings',()=>{
  assert.equal(extractTeamsConversationId('https://teams.microsoft.com/l/chat/19%3Ag%40thread.v2/conversations'),'19:g@thread.v2');
  assert.equal(extractTeamsConversationId('https://teams.microsoft.com/l/chat/%XX/conversations'),'');
});

test('a same-title open chat does not bypass the target group ID',async()=>{
  let clicks=0;
  const result=await openTeamsConversationFromUi({}, {title:'Same name',url:CHAT}, deps({
    clickTeamsConversationByIdWhenReady:async()=>{clicks++;return {clicked:true,title:'Same name'};}
  }));
  assert.equal(clicks,1);assert.equal(result.conversationId,'19:g@thread.v2');assert.equal(result.identityVerifiedById,true);assert.equal(result.locatedBy,'chat-list');
});

test('a missing group ID never falls back to an unrelated matching title',async()=>{
  await assert.rejects(openTeamsConversationFromUi({}, {title:'Same name',url:CHAT}, deps()),/无法在 Teams/);
});

test('chats outside the recent list are found through the filter, by id',async()=>{
  const seen=[];let filtered=false,closed=false;
  const result=await openTeamsConversationFromUi({}, {title:'Old group',url:CHAT}, deps({
    filterTeamsChatList:async(page,title)=>{filtered=title==='Old group';return true;},
    clickTeamsConversationByIdWhenReady:async(page,id,timeout)=>{seen.push(timeout);return filtered?{clicked:true,title:'Old group'}:{clicked:false};},
    closeTeamsChatListFilter:async()=>{closed=true;}
  }));
  assert.equal(result.locatedBy,'chat-filter');assert.equal(result.identityVerifiedById,true);assert.ok(closed,'filter is closed again');
});

test('global search must still be confirmed by the conversation id',async()=>{
  let searched=false;
  const result=await openTeamsConversationFromUi({}, {title:'Archived group',url:CHAT}, deps({
    openTeamsConversationViaSearch:async()=>{searched=true;return true;},
    clickTeamsConversationByIdWhenReady:async()=>searched?{clicked:true,title:'Archived group'}:{clicked:false}
  }));
  assert.equal(result.locatedBy,'search');
  await assert.rejects(openTeamsConversationFromUi({}, {title:'Archived group',url:CHAT}, deps({
    openTeamsConversationViaSearch:async()=>true
  })),/无法确认它就是目标会话/);
});

test('a cancelled locate stops before touching the page',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(openTeamsConversationFromUi({}, {title:'x',url:CHAT,signal:controller.signal}, deps({activateTeamsChatArea:async()=>{throw Error('touched');}})),{name:'AbortError'});
});

function domPage(html){const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:200,height:30});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};const previous={HTMLElement:globalThis.HTMLElement,window:globalThis.window,document:globalThis.document};return {dom,page:{evaluate:async(fn,arg)=>dom.window.eval(`(${fn})`)(arg)}};}

test('conversation ID selection uses complete IDs, not substring matches',async()=>{
  const {dom,page}=domPage('<div data-fui-tree-item-value="19:g@thread.v2-extra">Wrong</div><div data-fui-tree-item-value="chat-19:g@thread.v2">Right</div>');let clicked='';for(const el of dom.window.document.querySelectorAll('div'))el.onclick=()=>clicked=el.textContent;
  const result=await clickTeamsConversationById(page,'19:g@thread.v2');assert.equal(result.clicked,true);assert.equal(clicked,'Right');dom.window.close();
});

test('the current Teams chat-list value format (OneGQL folder path) resolves, including a chat pinned twice',async()=>{
  const value=id=>`OneGQL_SystemDefinedConversationFolder|t~u~RecentChats/OneGQL_GroupChatConversation|${id}`;
  const {dom,page}=domPage(`<div role="treeitem" data-fui-tree-item-value="OneGQL_UserDefinedConversationFolder|t~u~Favorites/OneGQL_GroupChatConversation|19:g@thread.v2">BM Test</div><div role="treeitem" data-fui-tree-item-value="${value('19:g@thread.v2')}">BM Test</div><div role="treeitem" data-fui-tree-item-value="${value('19:other@thread.v2')}">BM Test 2</div>`);
  let clicked='';for(const el of dom.window.document.querySelectorAll('div'))el.onclick=()=>clicked=el.textContent;
  const result=await clickTeamsConversationById(page,'19:g@thread.v2');
  assert.equal(result.clicked,true);assert.equal(result.title,'BM Test');assert.equal(clicked,'BM Test');dom.window.close();
});

test('ambiguous same-title groups are not selected arbitrarily',async()=>{
  const {dom,page}=domPage('<div role="treeitem">Same</div><div role="treeitem">Same</div>');assert.equal(await clickTeamsConversationCandidate(page,'Same'),false);dom.window.close();
});

test('Teams readiness continues automatically and only asks for sign-in when needed',async()=>{
  let clock=0;const events=[];
  const readyAfter=async(n)=>{let calls=0;return waitForTeamsReady({isReady:async()=>++calls>n,needsUserAction:async()=>false,onLoginRequired:()=>events.push('login'),onReady:({})=>events.push('ready'),wait:async(ms)=>{clock+=ms;},now:()=>clock,graceMs:45000});};
  assert.equal(await readyAfter(3),true);assert.deepEqual(events,['ready']);
  events.length=0;clock=0;let calls=0;
  assert.equal(await waitForTeamsReady({isReady:async()=>++calls>5,needsUserAction:async()=>true,onLoginRequired:()=>events.push('login'),onReady:()=>events.push('ready'),wait:async(ms)=>{clock+=ms;},now:()=>clock}),true);
  assert.deepEqual(events,['login','ready'],'sign-in screen surfaces once, then resumes by itself');
  clock=0;
  assert.equal(await waitForTeamsReady({isReady:async()=>false,wait:async(ms)=>{clock+=ms;},now:()=>clock,timeoutMs:5000}),false);
});

test('capture rejects a group change even after the original ID was located',async()=>{
  const capture=load('fetchTeamsWithWebdriver',{cleanText,DOMException,TEAMS_GAP_SCROLL_DEADLINE_MS:1000,canonicalizeMaterialUrl:x=>x,extractTeamsConversationId,waitForTeamsConversation:async()=>{},readExistingTeamsComments:async()=>[],scrollTeamsMessages:async()=>[],extractTeamsFromPage:async()=>({title:'Other group'}),areCaptureTitlesConsistent:(a,b)=>a===b});
  await assert.rejects(capture({url:()=> 'https://teams.cloud.microsoft/'},CHAT,{}, {expectedTitle:'Expected group',identityVerifiedById:true}),/已阻止抓取/);
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

test('server Teams API path: incremental fetch, auth refresh on 401, deleted-message text, fallback when no auth',async()=>{
  const {collectChatsvcMessages,fetchChatsvcTopic}=await import('../src/sources/teams-chatsvc.js');
  const CONV='19:g@thread.v2';
  const message=(id,extra={})=>({id:String(id),type:'Message',conversationid:CONV,messagetype:'RichText/Html',imdisplayname:'Ada',composetime:new Date(id).toISOString(),content:`<p>m${id}</p>`,properties:{},...extra});
  let calls=0,refreshed=0;
  const session={chatsvcAuth:{base:'https://t/api/chatsvc/apac/v1',headers:{authorization:'Bearer x'},seenAt:Date.now()}};
  const page={context:()=>({request:{get:async(url)=>{
    calls++;
    if(calls===1)return {status:()=>401,ok:()=>false};
    if(/\/messages/.test(url))return {status:()=>200,ok:()=>true,json:async()=>({messages:[message(1790000000300),message(1790000000200,{properties:{deletetime:'1790000000999'}}),message(1790000000100)],_metadata:{backwardLink:'more'}})};
    return {status:()=>200,ok:()=>true,json:async()=>({threadProperties:{topic:'BM Test'}})};
  }}})};
  const fetchViaApi=load('fetchTeamsViaChatsvc',{
    extractTeamsConversationId,canonicalizeMaterialUrl:x=>x,collectChatsvcMessages,fetchChatsvcTopic,latestTimestampValue:v=>v.filter(Boolean).sort().at(-1),
    renderTeamsTextFromComments:(title,url,adapter,comments)=>`# ${title}\n${comments.map(c=>c.body).join('\n')}`,
    readExistingTeamsComments:async()=>[{id:'1790000000100',body:'stored'}],
    ensureChatsvcAuth:async(s,p,opts={})=>{if(opts.forceRefresh)refreshed++;return s.chatsvcAuth;},
    updateRefreshRun:()=>{},console,DOMException,Set,JSON,Date
  });
  const result=await fetchViaApi(session,page,`https://teams.microsoft.com/l/chat/${CONV}/conversations`,{id:'teams'},{});
  assert.equal(refreshed,1,'a 401 refreshes auth once and retries');
  assert.equal(result.fetchMethod,'teams-chatsvc');assert.equal(result.title,'BM Test');assert.equal(result.conversationId,CONV);
  assert.equal(result.coverage.reachedPrevious,true);
  assert.equal(result.comments.find(c=>c.id==='1790000000200').body,'[消息已删除]');
  assert.equal(result.identityEvidence.verified,true);
  const noAuth=load('fetchTeamsViaChatsvc',{extractTeamsConversationId,ensureChatsvcAuth:async()=>null,console,DOMException});
  assert.equal(await noAuth({}, {}, `https://teams.microsoft.com/l/chat/${CONV}/conversations`,{}, {}),null,'falls back to the page when auth is unavailable');
});
