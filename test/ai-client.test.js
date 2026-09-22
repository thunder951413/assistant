import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAiClient } from '../src/ai-client.js';

test('model timeout covers a slow response body and cancellation stops an active stream', async () => {
  const service = http.createServer((req,res)=>{
    res.writeHead(200, {'Content-Type':'application/json'}); res.write('{');
  });
  await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
  try {
    const client=createAiClient(()=>({ai:{baseUrl:`http://127.0.0.1:${service.address().port}`,apiKey:'test',model:'test'}}));
    await assert.rejects(client.chatPayload([{role:'user',content:'slow'}],{timeoutMs:40}),/超时|abort/i);
    const controller=new AbortController();
    const response=await client.chatStreamResponse([{role:'user',content:'slow'}],{signal:controller.signal});
    const reading=response.text();controller.abort();await assert.rejects(reading,/abort/i);
  } finally {service.closeAllConnections(); await new Promise(resolve=>service.close(resolve));}
});
