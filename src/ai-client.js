// Model transport: policy is checked immediately before sending any content.
export function createAiClient(getSettings, { authorize = () => {} } = {}) {
  function config(purpose) {
    const value = getSettings()[purpose === 'embedding' ? 'embedding' : 'ai'];
    if (!value?.baseUrl || !value?.apiKey || !value?.model) throw new Error('请先在设置中配置模型接口、API Key 和模型名称。');
    const baseUrl = value.baseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('模型接口必须是 HTTP 或 HTTPS 地址。');
    return { ...value, baseUrl };
  }

  async function request(purpose, body, opts = {}) {
    authorize(opts.materials, purpose);
    const c = config(purpose);
    const controller = new AbortController();
    const abort = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) abort();
    opts.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('模型请求超时，请重试。')), opts.timeoutMs || 120000);
    const cleanup = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); };
    try {
      const response = await fetch(`${c.baseUrl}/${purpose === 'embedding' ? 'embeddings' : 'chat/completions'}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model: c.model, ...(purpose === 'embedding' && Number(c.dimensions) > 0 ? {dimensions: Number(c.dimensions)} : {}) })
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`模型请求失败（HTTP ${response.status}），请检查接口和授权。`);
      }
      if (!response.body) throw new Error('模型接口未返回内容。');
      const reader = response.body.getReader();
      let bytes = 0;
      const stream = new ReadableStream({
        async pull(target) {
          try {
            const result = await reader.read();
            if (result.done) { cleanup(); target.close(); return; }
            bytes += result.value.byteLength;
            if (bytes > 32 * 1024 * 1024) throw new Error('模型响应超过大小限制。');
            target.enqueue(result.value);
          } catch (error) { cleanup(); controller.abort(); target.error(error); }
        },
        async cancel(reason) { cleanup(); controller.abort(); await reader.cancel(reason).catch(() => {}); }
      });
      return new Response(stream, {status: response.status, headers: response.headers});
    } catch (error) { cleanup(); throw error; }
  }

  async function chatPayload(messages, opts = {}) {
    const response = await request('ai', {temperature: opts.temperature ?? 0.2, ...opts.extraBody, messages}, opts);
    return response.json();
  }
  async function chat(messages, opts = {}) {
    const payload = await chatPayload(messages, opts);
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('AI 接口没有返回可用内容。');
    return text;
  }
  async function chatStreamResponse(messages, opts = {}) {
    return request('ai', {temperature: opts.temperature ?? 0.2, stream: true, messages}, opts);
  }
  async function createEmbeddings(inputs, opts = {}) {
    if (!inputs.length) return [];
    const response = await request('embedding', {input: inputs}, opts);
    const payload = await response.json();
    const values = Array.isArray(payload.data) ? payload.data.slice().sort((a,b) => a.index - b.index) : [];
    if (values.length !== inputs.length || values.some((value, index) => value.index !== index || !Array.isArray(value.embedding) || !value.embedding.length || value.embedding.some(n => !Number.isFinite(n)))) {
      throw new Error('Embedding 接口返回了不完整或无效的向量。');
    }
    const dimension = values[0].embedding.length;
    if (values.some(value => value.embedding.length !== dimension)) throw new Error('Embedding 向量维度不一致。');
    return values.map(value => value.embedding);
  }
  async function createEmbedding(text, opts = {}) { return (await createEmbeddings([text], opts))[0]; }
  return {chat, chatPayload, chatStreamResponse, createEmbedding, createEmbeddings,
    get endpointHost() { try { return new URL(config('ai').baseUrl).hostname; } catch { return ''; } }};
}
