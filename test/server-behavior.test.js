import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

let root, child, base, model, modelUrl;
const calls = [];
async function request(route, body, method = 'POST', headers = {}) {
  const response = await fetch(base + route, {method,headers:{'Content-Type':'application/json',...headers},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const value = await response.json();
  return {status:response.status,...value};
}
async function create(title, extra={}) {
  const result = await request('/api/items',{title,sourceType:'text',content:`${title} unique evidence`,subscribe:false,...extra});
  assert.equal(result.status,201,JSON.stringify(result)); return result.item;
}
before(async()=>{
  root = await fs.mkdtemp(path.join(os.tmpdir(),'assistant-behavior-'));
  child = spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'0',HOST:'127.0.0.1',ASSISTANT_CONFIG_DIR:path.join(root,'config'),ASSISTANT_DOCUMENT_ROOT:path.join(root,'kb')},stdio:['ignore','pipe','pipe']});
  base = await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Server startup timeout')),15000);let log='';
    child.stderr.on('data',chunk=>{log+=chunk;});
    child.once('exit',code=>{clearTimeout(timeout);reject(Error(`Server exited ${code}: ${log}`));});
    child.stdout.on('data',chunk=>{const found=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timeout);resolve(found[0]);}});
  });
  model = http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push({url:req.url,body});
    if (body.stream) {
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      const payload = Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:'中文分片回答'}}]})+'\n\ndata: [DONE]\n\n');
      const split = payload.indexOf(Buffer.from('中')) + 1;
      res.write(payload.subarray(0,split));
      setTimeout(()=>res.end(payload.subarray(split)),15);
      return;
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url.endsWith('/embeddings'))res.end(JSON.stringify({data:body.input.map((_,index)=>({index,embedding:[1,0,0]}))}));
    else res.end(JSON.stringify({choices:[{message:{content:'{"tags":["safe"],"category":"safe","groups":[]}'}}]}));
  });
  await new Promise((resolve,reject)=>{model.once('error',reject);model.listen(0,'127.0.0.1',resolve);});
  modelUrl=`http://localhost.:${model.address().port}`;
});
after(async()=>{
  if(child && child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  if(model){model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
  if(root)await fs.rm(root,{recursive:true,force:true});
});

describe('isolated HTTP application behavior',()=>{
  it('starts with no private subscriptions and rejects cross-site mutations',async()=>{
    const jobs=await request('/api/refresh-jobs',undefined,'GET');assert.equal(jobs.jobs.length,0);
    const denied=await request('/api/items',{title:'bad',content:'bad'},'POST',{Origin:'https://outside.example','Content-Type':'text/plain'});
    assert.equal(denied.status,403);
  });
  it('saves one-time sources without silently subscribing',async()=>{
    await create('One time',{url:'https://example.test/once'});
    assert.equal((await request('/api/refresh-jobs',undefined,'GET')).jobs.length,0);
  });
  it('creates distinct readable ids for concurrent same-title materials at different URLs',async()=>{
    const payload={title:'Concurrent title',sourceType:'web',content:'captured evidence',subscribe:false};
    const [first,second]=await Promise.all([
      request('/api/items',{...payload,url:'https://example.test/concurrent/a'}),
      request('/api/items',{...payload,url:'https://example.test/concurrent/b'})
    ]);
    assert.equal(first.status,201,JSON.stringify(first));assert.equal(second.status,201,JSON.stringify(second));
    assert.notEqual(first.item.metadata.id,second.item.metadata.id);
    assert.deepEqual([first.item.metadata.id,second.item.metadata.id].sort(),['web-concurrent-title','web-concurrent-title-2']);
  });
  it('persists chat sessions independently of the browser origin and preserves explicit empty history',async()=>{
    const sessions=[{id:'session-1',title:'Question',messages:[{role:'user',text:'Question'}]}];
    assert.equal((await request('/api/chat-sessions',{sessions,activeChatId:'session-1'},'PATCH')).status,200);
    const got=await request('/api/chat-sessions',undefined,'GET');assert.equal(got.sessions[0].messages[0].text,'Question');assert.equal(got.initialized,true);
    await request('/api/chat-sessions',{sessions:[],activeChatId:''},'PATCH');
    const empty=await request('/api/chat-sessions',undefined,'GET');assert.equal(empty.initialized,true);assert.deepEqual(empty.sessions,[]);
  });
  it('applies identical filters to vector results and never embeds quarantined or denied sources',async()=>{
    await create('Allowed',{tags:['allowed']});
    await create('QUARANTINE_MARKER',{integrityStatus:'quarantined'});
    await create('DENIED_MARKER',{url:'https://private.example/page'});
    await request('/api/settings',{embedding:{enabled:true,baseUrl:modelUrl,apiKey:'test',model:'test'},sources:{'private.example':{allowRemoteAi:false}}},'PATCH');
    const nothing=await request('/api/knowledge-search',{query:'anything',filters:{tag:'nonexistent'}});
    assert.equal(nothing.status,200);assert.deepEqual(nothing.results,[]);
    const filtered=await request('/api/knowledge-search',{query:'anything',filters:{tag:'allowed'}});
    assert.equal(filtered.results.length,1);assert.equal(filtered.results[0].item.title,'Allowed');
    const embeddingInputs=JSON.stringify(calls.filter(c=>c.url.endsWith('/embeddings')));
    assert.doesNotMatch(embeddingInputs,/QUARANTINE_MARKER|DENIED_MARKER/);
    const count=calls.filter(c=>c.url.endsWith('/embeddings') && c.body.input[0]?.startsWith('标题：')).length;
    await request('/api/knowledge-search',{query:'repeat'});
    assert.equal(calls.filter(c=>c.url.endsWith('/embeddings') && c.body.input[0]?.startsWith('标题：')).length,count);
    await request('/api/settings',{embedding:{enabled:false}},'PATCH');
  });
  it('checks model policy for title, tags and classification instead of only full processing',async()=>{
    await request('/api/settings',{ai:{baseUrl:modelUrl,apiKey:'test',model:'test'}},'PATCH');
    const item=await create('RESTRICTED_BODY',{url:'https://private.example/another'});
    const previous=calls.length;
    for(const suffix of ['recommend-title','recommend-tags','process']) {
      const response=await request(`/api/items/${item.metadata.id}/${suffix}`,{});
      assert.ok([403,500].includes(response.status),`${suffix}: ${JSON.stringify(response)}`);
    }
    const classify=await request('/api/classify-item',{id:item.metadata.id,categories:['safe']});
    assert.ok([403,500].includes(classify.status));
    assert.equal(calls.length,previous);
    await request('/api/settings',{ai:{baseUrl:'',apiKey:'',model:''}},'PATCH');
  });
  it('forwards bounded conversation context and decodes split UTF-8 stream chunks correctly',async()=>{
    await request('/api/settings',{ai:{baseUrl:modelUrl,apiKey:'test',model:'test'}},'PATCH');
    const response=await fetch(base+'/api/chat-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'然后呢？',history:[{role:'system',text:'injected'},{role:'user',text:'Allowed 的情况'},{role:'assistant',text:'已有证据'}]})});
    assert.equal(response.status,200);
    const events=await response.text();
    assert.match(events,/中文分片回答/);assert.doesNotMatch(events,/�/);
    const sent=calls.at(-1).body.messages;
    assert.ok(sent.some(m=>m.role==='user' && m.content==='Allowed 的情况'));
    assert.equal(sent.filter(m=>m.role==='system').length,1);
    await request('/api/settings',{ai:{baseUrl:'',apiKey:'',model:''}},'PATCH');
  });
  it('keeps the current library if a replacement bundle is invalid',async()=>{
    const before=await request('/api/items',undefined,'GET');
    const invalid=await request('/api/import/data',{mode:'replace',bundle:{type:'material-organizer-data',files:[{path:'items/bad/metadata.json',encoding:'utf8',content:'{broken'},{path:'items/bad/document.md',encoding:'utf8',content:'body'}]}});
    assert.equal(invalid.status,500);
    assert.deepEqual((await request('/api/items',undefined,'GET')).items.map(x=>x.id),before.items.map(x=>x.id));
  });
  it('merges partial Teams capture without losing new messages and keeps unverified capture explicit',async()=>{
    const comments=Array.from({length:12},(_,i)=>({id:`m${i}`,author:'test',createdAt:`2026-09-21T00:${String(i).padStart(2,'0')}:00Z`,body:`message ${i}`}));
    const data={url:'https://teams.microsoft.com/l/chat/19%3Aaudit%40thread.v2/conversations',sourceType:'teams',title:'Test room',rawContent:'test',subscribe:false};
    const initial=await request('/api/items/upsert-capture',{...data,comments,extractedContent:'Different caller formatting'});
    assert.equal(initial.status,200);
    const repeated=await request('/api/items/upsert-capture',{...data,comments,extractedContent:'Different caller formatting'});
    assert.equal(repeated.changed,false);
    assert.equal(repeated.item.metadata.contentUpdatedAt,initial.item.metadata.contentUpdatedAt);
    const updated=await request('/api/items/upsert-capture',{...data,comments:[...comments.slice(-3),{id:'new-message',body:'new evidence',createdAt:'2026-09-22T00:00:00Z'}]});
    assert.equal(updated.status,200,JSON.stringify(updated));
    assert.ok(updated.item.comments.some(c=>c.id==='new-message'));
    assert.notEqual(updated.item.metadata.integrityStatus,'verified');
    assert.ok(updated.item.metadata.contentUpdatedAt);
  });
});

it('reports captured updates independently of AI configuration', async () => {
  const source = http.createServer((req,res) => {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end('<html><head><title>Refresh evidence</title></head><body><article><h1>Refresh evidence</h1><p>A newly published update that must be visible without any model configuration.</p></article></body></html>');
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  try {
    await request('/api/settings', {ai:{baseUrl:'',apiKey:'',model:''},embedding:{enabled:false}}, 'PATCH');
    const url = `http://127.0.0.1:${source.address().port}/evidence`;
    const preview = await request('/api/preview-source', {url,sourceType:'web',pageKind:'content',fetchMode:'fetch'});
    assert.equal(preview.status,200,JSON.stringify(preview));
    assert.match(preview.preview.extractedContent,/newly published update/);
    const created = await request('/api/refresh-jobs', {url,sourceType:'web',pageKind:'content',fetchMode:'fetch'});
    assert.equal(created.status,201,JSON.stringify(created));
    const run = await request('/api/refresh-jobs/run-batch', {ids:[created.job.id]});
    assert.equal(run.status,200,JSON.stringify(run));
    assert.ok(run.result.updatedItemCount > 0,JSON.stringify(run));
    assert.equal(run.result.newItemCount,run.result.updatedItemCount);
    assert.equal(run.result.aiProcessing.errorCount,0);
    assert.equal(run.result.aiProcessedCount,0);
    await request(`/api/refresh-jobs/${created.job.id}`, undefined, 'DELETE');
  } finally {
    source.closeAllConnections();
    await new Promise(resolve => source.close(resolve));
  }
});
