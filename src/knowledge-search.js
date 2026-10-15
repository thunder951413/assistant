// Search, embeddings and question answering over the knowledge base.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { canUseMaterial, matchesMaterialFilters, normalizeChatHistory } from "./ai-policy.js";
import { sendSse, startSse } from "./http-utils.js";
import { buildKnowledgeContext, buildLocalKnowledgeAnswer, buildOpenAIContext, buildVectorKnowledgeContext, chunkMaterialForEmbedding, cosineSimilarity, diversifyKnowledgeResults, mergeKnowledgeResults, parseOpenAIStreamPayloads, scoreKnowledgeMatch, toPublicKnowledgeSource, tokenizeQuery } from "./retrieval.js";
import { summarizeExcerpt } from "./text-helpers.js";
import { cleanText } from "./utils.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createKnowledgeSearch(ctx) {
  // Functions that live elsewhere, resolved when called.
  const supplementalPromptBlock = (...args) => ctx.supplementalPromptBlock(...args);

  // The lightweight /api/search endpoint and the Codex ask-context helper share the
  // same ranking as chat, so all entry points agree on what is relevant.
  async function searchItems(query, limit = 10) {
    if (!cleanText(query)) return [];
    // Local keyword ranking only: these endpoints must stay fast and never send the
    // query to a remote embedding service.
    const results = await searchKnowledgeBase(query, limit, {}, { keywordOnly: true });
    return results.map(({ score, item, excerpt }) => {
      const { paths, ...metadata } = item;
      return { score, item: { ...metadata, excerpt } };
    });
  }

  async function buildAskContext(question) {
    const cleanQuestion = cleanText(question);
    const results = await searchItems(cleanQuestion);
    const selected = results.slice(0, 6).map((result) => result.item);
    const sourceLines = selected.map((item) => {
      const itemPath = `knowledge-base/items/${item.id}`;
      return `- ${item.title} (${item.sourceType}, tags: ${(item.tags || []).join(", ") || "none"})\n  - metadata: ${itemPath}/metadata.json\n  - processed: ${itemPath}/processed.md（如果存在，优先阅读）\n  - document: ${itemPath}/document.md\n  - comments: ${itemPath}/comments.jsonl\n  - url: ${item.url || "local input"}\n  - last fetched: ${item.lastFetchedAt || "not fetched"}`;
    });

    const prompt = `请基于当前项目目录里的 knowledge-base 回答这个问题：

  ${cleanQuestion || "(这里填写问题)"}

  优先阅读：
  ${sourceLines.join("\n") || "- knowledge-base/indexes/by-updated.json\n- knowledge-base/items/*/document.md"}

  回答要求：
  - 先给结论，再列关键依据。
  - 优先读取 processed.md；需要查原文时读取 document.md、comments.jsonl 和 raw 文件。
  - 引用资料时带上 item id、URL 和 lastFetchedAt。
  - 如果资料可能过期，明确提醒。`;

    return {
      question: cleanQuestion,
      rootDir: ctx.kbDir,
      prompt,
      sources: selected
    };
  }

  async function answerFromKnowledgeBase(message, options = {}) {
    const cleanMessage = cleanText(message);
    if (!cleanMessage) {
      throw new Error("请输入问题。");
    }

    const results = await searchKnowledgeBase([...(options.history || []).filter(entry => entry.role === "user").slice(-1).map(entry => entry.content), cleanMessage].join("\n"), 8, { remoteAiOnly: true });
    const trace = [
      {
        type: "thinking",
        title: "理解问题",
        detail: `准备基于本地知识库回答：“${cleanMessage.slice(0, 120)}”`
      },
      {
        type: "tool",
        title: "检索本地知识库",
        detail: `在 ${ctx.kbDir} 中检索相关资料，返回 ${results.length} 条候选。`
      },
      {
        type: "tool_result",
        title: "命中资料",
        detail: results.length
          ? results.slice(0, 5).map((result, index) => `${index + 1}. ${result.item.title} (${result.item.sourceType})`).join("\n")
          : "没有命中资料，将按空上下文回答。"
      }
    ];
    if (ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model) {
      return answerWithOpenAICompatible(cleanMessage, results, trace, options);
    }

    return {
      role: "assistant",
      mode: "local",
      content: buildLocalKnowledgeAnswer(cleanMessage, results),
      rootDir: ctx.kbDir,
      sources: results.map(toPublicKnowledgeSource),
      trace: [
        ...trace,
        {
          type: "tool_result",
          title: "本地回答",
          detail: "未配置 AI 接口，返回本地检索结果。"
        }
      ]
    };
  }

  async function answerWithOpenAICompatible(question, results, trace = [], options = {}) {
    const context = results.map((result, index) => {
      const source = result.item;
      return `资料 ${index + 1}
  ID: ${source.id}
  标题: ${source.title}
  来源: ${source.sourceType}
  URL: ${source.url || "local input"}
  标签: ${(source.tags || []).join(", ") || "none"}
  最后抓取: ${source.lastFetchedAt || "not fetched"}
  文件: ${source.paths.document}
  整理版: ${source.paths.processed || "not generated"}

  内容:
  ${result.context}`;
    }).join("\n\n---\n\n");
    const supplemental = await supplementalPromptBlock();
    const requestTrace = [
      ...trace,
      {
        type: "tool",
        title: "调用 AI 接口",
        detail: `模型：${ctx.settings.ai.model}\n接口：${ctx.ai.endpointHost}\n上下文资料：${results.length} 条`
      }
    ];

    const content = await ctx.ai.chat([
      {
        role: "system",
        content: [
          "你是本地知识库问答助手。只能基于提供的资料回答；如果资料不足，要明确说不知道。回答使用中文。结论在前，并在关键依据处引用资料 ID、URL 或文件路径。",
          supplemental
        ].filter(Boolean).join("\n\n")
      },
      ...normalizeChatHistory(options.history),
      {
        role: "user",
        content: `问题：${question}\n\n本地知识库根目录：${ctx.kbDir}\n\n检索到的资料：\n${context || "没有检索到相关资料。"}`
      }
    ], { materials: results.map(result => result.item), signal: options.signal });

    return {
      role: "assistant",
      mode: "ai",
      content,
      rootDir: ctx.kbDir,
      sources: results.map(toPublicKnowledgeSource),
      trace: [
        ...requestTrace,
        {
          type: "tool_result",
          title: "AI 返回",
          detail: `收到模型回答，长度 ${content.length} 字符。`
        }
      ]
    };
  }

  async function streamAnswerFromKnowledgeBase(message, res, options = {}) {
    startSse(res);
    try {
      const cleanMessage = cleanText(message);
      if (!cleanMessage) {
        throw new Error("请输入问题。");
      }

      sendSse(res, "trace", {
        type: "thinking",
        title: "理解问题",
        detail: `准备基于本地知识库回答：“${cleanMessage.slice(0, 120)}”`
      });

      const results = await searchKnowledgeBase([...(options.history || []).filter(entry => entry.role === "user").slice(-1).map(entry => entry.content), cleanMessage].join("\n"), 8, { remoteAiOnly: true });
      const sources = results.map(toPublicKnowledgeSource);
      sendSse(res, "trace", {
        type: "tool",
        title: "检索本地知识库",
        detail: `在 ${ctx.kbDir} 中检索相关资料，返回 ${results.length} 条候选。`
      });
      sendSse(res, "trace", {
        type: "tool_result",
        title: "命中资料",
        detail: results.length
          ? results.slice(0, 5).map((result, index) => `${index + 1}. ${result.item.title} (${result.item.sourceType})`).join("\n")
          : "没有命中资料，将按空上下文回答。"
      });
      sendSse(res, "sources", { sources });

      if (ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model) {
        await streamWithOpenAICompatible(cleanMessage, results, sources, res, options);
        return;
      }

      const content = buildLocalKnowledgeAnswer(cleanMessage, results);
      sendSse(res, "trace", {
        type: "tool_result",
        title: "本地回答",
        detail: "未配置 AI 接口，返回本地检索结果。"
      });
      sendSse(res, "delta", { text: content });
      sendSse(res, "done", {
        role: "assistant",
        mode: "local",
        content,
        rootDir: ctx.kbDir,
        sources
      });
      res.end();
    } catch (error) {
      sendSse(res, "error", { error: error.message || String(error) });
      res.end();
    }
  }

  async function streamWithOpenAICompatible(question, results, sources, res, options = {}) {
    const context = buildOpenAIContext(results);
    const supplemental = await supplementalPromptBlock();
    sendSse(res, "trace", {
      type: "tool",
      title: "调用 AI 接口",
      detail: `模型：${ctx.settings.ai.model}\n接口：${ctx.ai.endpointHost}\n上下文资料：${results.length} 条`
    });

    const response = await ctx.ai.chatStreamResponse([
      {
        role: "system",
        content: [
          "你是本地知识库问答助手。只能基于提供的资料回答；如果资料不足，要明确说不知道。回答使用中文。结论在前，并在关键依据处引用资料 ID、URL 或文件路径。",
          supplemental
        ].filter(Boolean).join("\n\n")
      },
      ...normalizeChatHistory(options.history),
      {
        role: "user",
        content: `问题：${question}\n\n本地知识库根目录：${ctx.kbDir}\n\n检索到的资料：\n${context || "没有检索到相关资料。"}`
      }
    ], { materials: results.map(result => result.item), signal: options.signal });

    let content = "";
    let streamBuffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      streamBuffer += decoder.decode(chunk, { stream: true });
      const parsed = parseOpenAIStreamPayloads(streamBuffer);
      streamBuffer = parsed.rest;
      for (const payload of parsed.payloads) {
        if (payload === "[DONE]") continue;
        const delta = payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || "";
        if (!delta) continue;
        content += delta;
        sendSse(res, "delta", { text: delta });
      }
    }

    sendSse(res, "trace", {
      type: "tool_result",
      title: "AI 返回",
      detail: `收到模型回答，长度 ${content.length} 字符。`
    });
    sendSse(res, "done", {
      role: "assistant",
      mode: "ai",
      content,
      rootDir: ctx.kbDir,
      sources
    });
    res.end();
  }

  async function searchKnowledgeBase(query, limit = 8, filters = {}, options = {}) {
    const terms = tokenizeQuery(query);
    const desiredLimit = Math.min(100, Math.max(1, Number(limit) || 8));
    const materials = await readAllMaterialsForSearch();
    const results = [];

    for (const material of materials.values()) {
      const { metadata } = material;
      if (!matchesMaterialFilters(metadata, filters, ctx.settings)) continue;
      const score = scoreKnowledgeMatch(material.haystack, terms, metadata);
      if (score > 0 || !terms.length) {
        results.push({ score, keywordScore: score, vectorScore: 0, item: { ...metadata, paths: material.paths }, material });
      }
    }

    let ranked;
    if (isEmbeddingEnabled() && !options.keywordOnly) {
      try {
        const vectorResults = await searchKnowledgeBaseByEmbedding(query, desiredLimit * 2, filters, materials);
        ranked = mergeKnowledgeResults(results, vectorResults);
      } catch (error) {
        console.error("Embedding search failed, falling back to keyword search:", error);
      }
    }
    ranked ||= results.sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));

    // Context snippets are only built for the results actually returned.
    return diversifyKnowledgeResults(ranked, desiredLimit, terms).map(({ material, bestChunk, ...result }) => ({
      ...result,
      excerpt: summarizeExcerpt(material.processedDocument || material.document),
      context: bestChunk
        ? buildVectorKnowledgeContext(bestChunk, material.processedDocument || material.document, material.commentsText, terms)
        : buildKnowledgeContext(material.processedDocument || material.document, material.commentsText, terms)
    }));
  }

  function toSearchMaterial(entry) {
    return ctx.store.derived(entry, "searchMaterial", () => {
      const itemDir = path.join(ctx.itemsDir, entry.id);
      const { metadata, document } = entry;
      const processedDocument = metadata.processedStale ? "" : entry.processedDocument;
      return {
        metadata, document, processedDocument,
        commentsText: entry.commentsText,
        haystack: `${metadata.title}\n${(metadata.tags || []).join(" ")}\n${metadata.sourceType}\n${metadata.url || ""}\n${processedDocument}\n${document}\n${entry.commentsText}`.toLowerCase(),
        paths: {
          metadata: path.join(itemDir, "metadata.json"), document: path.join(itemDir, "document.md"),
          processed: processedDocument ? path.join(itemDir, "processed.md") : "",
          comments: path.join(itemDir, "comments.jsonl"), raw: path.join(itemDir, metadata.rawFileName || "raw.txt")
        }
      };
    });
  }

  async function readAllMaterialsForSearch() {
    const entries = await ctx.store.readAll({ onCorrupt: (issue) => console.warn(`Skipping unreadable material ${issue.id}: ${issue.error}`) });
    return new Map(entries.map((entry) => [entry.id, toSearchMaterial(entry)]));
  }

  async function searchKnowledgeBaseByEmbedding(query, limit, filters = {}, materials = null) {
    const cleanQuery = cleanText(query);
    if (!cleanQuery) return [];
    materials ||= await readAllMaterialsForSearch();
    const index = await embeddingIndexForQuery(materials);
    if (!index?.records?.length) return [];

    const queryVector = await createEmbedding(cleanQuery);
    const bestByItem = new Map();
    for (const record of index.records) {
      const vectorScore = cosineSimilarity(queryVector, record.vector);
      if (!Number.isFinite(vectorScore)) continue;
      const previous = bestByItem.get(record.itemId);
      if (!previous || vectorScore > previous.vectorScore) {
        bestByItem.set(record.itemId, { record, vectorScore });
      }
    }

    const candidates = [...bestByItem.values()]
      .filter((candidate) => candidate.vectorScore > 0.2)
      .sort((a, b) => b.vectorScore - a.vectorScore);

    const results = [];
    for (const candidate of candidates) {
      // Policy is re-checked against current metadata: a stale index may still hold
      // records for items that were since deleted, quarantined or restricted.
      const material = materials.get(candidate.record.itemId);
      if (!material || !matchesMaterialFilters(material.metadata, filters, ctx.settings) || !canUseMaterial(material.metadata, ctx.settings, "embedding")) continue;
      results.push({
        score: candidate.vectorScore * 20,
        keywordScore: 0,
        vectorScore: candidate.vectorScore,
        item: { ...material.metadata, paths: material.paths },
        material,
        bestChunk: candidate.record.text
      });
      if (results.length >= Math.max(1, limit)) break;
    }
    return results;
  }

  function isEmbeddingEnabled() {
    return Boolean(
      ctx.settings.embedding?.enabled
      && ctx.settings.embedding?.baseUrl
      && ctx.settings.embedding?.apiKey
      && ctx.settings.embedding?.model
    );
  }

  function embeddingIndexPath() {
    return path.join(ctx.indexesDir, "embeddings.json");
  }

  function embeddingConfigKey() {
    return [
      ctx.settings.embedding?.baseUrl || "",
      ctx.settings.embedding?.model || "",
      Number(ctx.settings.embedding?.dimensions || 0) || ""
    ].join("|");
  }

  const EMBEDDING_QUERY_WAIT_MS = 2500;

  const embeddingIndexState = { status: "idle", error: "", updatedAt: "", records: 0 };

  let embeddingIndexMemo = null;

  // Uses the freshest index available without making a question wait for a full
  // (re)build: an up-to-date index is used directly; otherwise the build runs in the
  // background and the query waits at most EMBEDDING_QUERY_WAIT_MS before falling back
  // to the previous index (or to keyword-only results when none exists yet).
  async function embeddingIndexForQuery(materials) {
    const build = ensureEmbeddingIndex(materials);
    build.catch((error) => {
      embeddingIndexState.status = "failed";
      embeddingIndexState.error = error.message || String(error);
      console.error("Embedding index build failed:", error);
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), EMBEDDING_QUERY_WAIT_MS).unref?.());
    const ready = await Promise.race([build.catch(() => null), timeout]);
    if (ready) return ready;
    return readSavedEmbeddingIndex();
  }

  async function readSavedEmbeddingIndex() {
    const filePath = embeddingIndexPath();
    const configKey = embeddingConfigKey();
    if (embeddingIndexMemo?.filePath === filePath && embeddingIndexMemo.index.configKey === configKey) return embeddingIndexMemo.index;
    try {
      const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (saved?.version === 2 && saved.configKey === configKey) {
        embeddingIndexMemo = { filePath, index: saved };
        return saved;
      }
    } catch {}
    return null;
  }

  function ensureEmbeddingIndex(materials = null) {
    const filePath = embeddingIndexPath();
    const configKey = embeddingConfigKey();
    const key = `${filePath}|${configKey}`;
    if (ctx.embeddingBuilds.has(key)) return ctx.embeddingBuilds.get(key);
    const build = (async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      materials ||= await readAllMaterialsForSearch();
      const manifest = buildEmbeddingManifest(materials);
      const saved = await readSavedEmbeddingIndex();
      if (saved && JSON.stringify(saved.manifest) === JSON.stringify(manifest)) {
        Object.assign(embeddingIndexState, { status: "ready", error: "", updatedAt: saved.generatedAt || "", records: saved.records?.length || 0 });
        return saved;
      }
      embeddingIndexState.status = "building";
      embeddingIndexState.error = "";
      const rebuilt = await rebuildEmbeddingIndex(manifest, saved, materials);
      if (filePath !== embeddingIndexPath() || configKey !== embeddingConfigKey()) throw new Error("索引配置已变更，请重新检索。");
      const temp = `${filePath}.tmp`;
      await fs.writeFile(temp, JSON.stringify(rebuilt), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temp, filePath);
      embeddingIndexMemo = { filePath, index: rebuilt };
      Object.assign(embeddingIndexState, { status: "ready", error: "", updatedAt: rebuilt.generatedAt, records: rebuilt.records.length });
      return rebuilt;
    })();
    ctx.embeddingBuilds.set(key, build);
    build.finally(() => ctx.embeddingBuilds.delete(key)).catch(() => {});
    return build;
  }

  function buildEmbeddingManifest(materials) {
    const manifest = [];
    for (const [id, material] of materials) {
      if (material.metadata.pageKind === "list" || !canUseMaterial(material.metadata, ctx.settings, "embedding")) continue;
      manifest.push({ id, contentHash: embeddingContentHash(material) });
    }
    return manifest.sort((a, b) => a.id.localeCompare(b.id));
  }

  const embeddingHashes = new WeakMap();

  function embeddingContentHash(material) {
    if (!embeddingHashes.has(material)) {
      embeddingHashes.set(material, createHash("sha256").update(JSON.stringify(chunkMaterialForEmbedding(material))).digest("hex"));
    }
    return embeddingHashes.get(material);
  }

  async function rebuildEmbeddingIndex(manifest, previous = null, materials) {
    const records = [];
    const hashes = new Map((previous?.manifest || []).map(entry => [entry.id, entry.contentHash]));
    const previousRecords = new Map();
    for (const record of previous?.records || []) {
      if (!previousRecords.has(record.itemId)) previousRecords.set(record.itemId, []);
      previousRecords.get(record.itemId).push(record);
    }
    for (const entry of manifest) {
      const material = materials.get(entry.id);
      if (!material || !canUseMaterial(material.metadata, ctx.settings, "embedding")) continue;
      if (hashes.get(entry.id) === entry.contentHash) {
        records.push(...(previousRecords.get(entry.id) || []));
        continue;
      }
      const chunks = chunkMaterialForEmbedding(material);
      for (let offset = 0; offset < chunks.length; offset += 32) {
        const batch = chunks.slice(offset, offset + 32);
        const vectors = await createEmbeddings(batch.map(chunk => chunk.text), [material.metadata]);
        batch.forEach((chunk, index) => records.push({
          itemId: entry.id, chunkId: chunk.id, sourceType: material.metadata.sourceType,
          title: material.metadata.title, text: chunk.text, vector: vectors[index]
        }));
      }
    }
    return { version: 2, configKey: embeddingConfigKey(), generatedAt: new Date().toISOString(), manifest, records };
  }

  async function createEmbedding(text) {
    return ctx.ai.createEmbedding(text, { materials: [] });
  }

  async function createEmbeddings(inputs, materials = []) {
    return ctx.ai.createEmbeddings(inputs, { materials });
  }

  return { searchItems, buildAskContext, answerFromKnowledgeBase, streamAnswerFromKnowledgeBase, searchKnowledgeBase, readAllMaterialsForSearch, isEmbeddingEnabled, embeddingIndexState };
}
