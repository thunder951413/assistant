// OpenAI-compatible API client — eliminates ~200 lines of repeated fetch boilerplate.
// Reads settings lazily via a getter so it always uses the latest config.
//
// Usage:
//   import { createAiClient } from "./ai-client.js";
//   const ai = createAiClient(() => settings);
//   const answer = await ai.chat([{ role: "user", content: "..." }]);
//   const vectors = await ai.createEmbeddings(["text to embed"]);

export function createAiClient(getSettings) {
  function aiConfig() {
    const s = getSettings();
    if (!s.ai?.baseUrl || !s.ai?.apiKey || !s.ai?.model) {
      throw new Error("请先在设置页配置 AI 接口（Base URL、API Key、Model）。");
    }
    const baseUrl = s.ai.baseUrl.replace(/\/+$/, "");
    return {
      baseUrl,
      apiKey: s.ai.apiKey,
      model: s.ai.model,
      endpoint: `${baseUrl}/chat/completions`
    };
  }

  function embeddingConfig() {
    const s = getSettings();
    if (!s.embedding?.baseUrl || !s.embedding?.apiKey || !s.embedding?.model) {
      throw new Error("请先在设置页配置 Embedding 接口。");
    }
    const baseUrl = s.embedding.baseUrl.replace(/\/+$/, "");
    return {
      baseUrl,
      apiKey: s.embedding.apiKey,
      model: s.embedding.model,
      dimensions: Number(s.embedding.dimensions || 0)
    };
  }

  // ---- Chat completions (non-streaming) ----

  async function chatRaw(messages, opts = {}) {
    const { endpoint, apiKey, model } = aiConfig();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.2,
        ...(opts.extraBody || {}),
        messages
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI 请求失败：${response.status} ${text.slice(0, 300)}`);
    }

    return response.json();
  }

  // Convenience: chat and return just the content text.
  async function chat(messages, opts = {}) {
    const payload = await chatRaw(messages, opts);
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("AI 接口没有返回可用内容。");
    }
    return text;
  }

  // Return the full parsed JSON payload (for callers that need more than text).
  async function chatPayload(messages, opts = {}) {
    return chatRaw(messages, opts);
  }

  // ---- Chat completions (streaming) ----

  async function chatStreamResponse(messages, opts = {}) {
    const { endpoint, apiKey, model } = aiConfig();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.2,
        stream: true,
        messages
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI 请求失败：${response.status} ${text.slice(0, 300)}`);
    }

    if (!response.body) {
      throw new Error("AI 接口没有返回可读取的流。");
    }

    return response;
  }

  // ---- Embeddings ----

  async function createEmbeddings(inputs) {
    if (!inputs.length) return [];
    const { baseUrl, apiKey, model, dimensions } = embeddingConfig();

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: inputs,
        ...(dimensions > 0 ? { dimensions } : {})
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding 生成失败：${response.status} ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const data = Array.isArray(payload.data) ? payload.data : [];
    return data
      .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
      .map((item) => Array.isArray(item.embedding) ? item.embedding.map(Number) : []);
  }

  // Convenience: single embedding.
  async function createEmbedding(text) {
    const vectors = await createEmbeddings([text]);
    return vectors[0] || [];
  }

  return {
    chat,
    chatPayload,
    chatStreamResponse,
    createEmbedding,
    createEmbeddings,
    // Exposed for callers that need to check endpoint hostname for trace messages.
    get endpointHost() {
      try { return new URL(aiConfig().baseUrl).hostname; } catch { return ""; }
    }
  };
}
