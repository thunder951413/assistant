// Knowledge-base ranking: query tokenization, keyword scoring, result diversity,
// vector helpers and context snippets. Pure functions over already-loaded materials.
import { extractBodyFromDocument, extractSummaryFromDocument } from "./item-store.js";
import { extractProcessedBodyFromDocument } from "./text-helpers.js";
import { cleanText } from "./utils.js";

export function buildOpenAIContext(results) {
  return results.map((result, index) => {
    const source = result.item;
    return `资料 ${index + 1}
ID: ${source.id}
标题: ${source.title}
来源: ${source.sourceType}
URL: ${source.url || "local input"}
标签: ${(source.tags || []).join(", ") || "none"}
最后抓取: ${source.lastFetchedAt || "not fetched"}
文件: ${source.paths.document}

内容:
${result.context}`;
  }).join("\n\n---\n\n");
}

export function parseOpenAIStreamPayloads(chunk) {
  const parts = chunk.split(/\n\n+/);
  const rest = parts.pop() || "";
  const payloads = parts
    .flatMap((part) => part.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((payload) => payload === "[DONE]" ? payload : JSON.parse(payload));
  return { payloads, rest };
}

export function diversifyKnowledgeResults(results, limit, terms) {
  if (!results.length) return [];
  if (!terms.length) return results.slice(0, limit);

  const selected = [];
  const seen = new Set();
  const bySource = new Map();
  for (const result of results) {
    const sourceType = result.item.sourceType || "unknown";
    if (!bySource.has(sourceType)) bySource.set(sourceType, []);
    bySource.get(sourceType).push(result);
  }

  for (const group of bySource.values()) {
    const candidate = group[0];
    if (!candidate || seen.has(candidate.item.id)) continue;
    selected.push(candidate);
    seen.add(candidate.item.id);
    if (selected.length >= limit) return selected;
  }

  for (const result of results) {
    if (seen.has(result.item.id)) continue;
    selected.push(result);
    seen.add(result.item.id);
    if (selected.length >= limit) break;
  }

  return selected.sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));
}

export function mergeKnowledgeResults(keywordResults, vectorResults) {
  const merged = new Map();
  for (const result of [...keywordResults, ...vectorResults]) {
    const id = result.item.id;
    const previous = merged.get(id);
    if (!previous) {
      merged.set(id, result);
      continue;
    }
    const keywordScore = Math.max(previous.keywordScore || 0, result.keywordScore || 0);
    const vectorScore = Math.max(previous.vectorScore || 0, result.vectorScore || 0);
    merged.set(id, {
      ...previous,
      keywordScore,
      vectorScore,
      score: keywordScore + vectorScore * 20,
      bestChunk: result.vectorScore > (previous.vectorScore || 0) ? result.bestChunk : previous.bestChunk
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));
}

export function chunkMaterialForEmbedding(material) {
  const metadata = material.metadata;
  const base = !metadata.processedStale && material.processedDocument ? extractProcessedBodyFromDocument(material.processedDocument) : extractBodyFromDocument(material.document);
  const header = `标题：${metadata.title}\n来源：${metadata.sourceType}\nURL：${metadata.url || "本地文本"}\n标签：${(metadata.tags || []).join(", ")}`;
  const text = `${base}\n\n${material.commentsText || ""}`.trim();
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += 1400) {
    chunks.push({ id: `${metadata.id}-${chunks.length + 1}`, text: `${header}\n\n${text.slice(offset, offset + 1600)}` });
  }
  return chunks;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

export function buildVectorKnowledgeContext(bestChunk, document, commentsText, terms) {
  const keywordContext = buildKnowledgeContext(document, commentsText, terms);
  return [
    "语义命中片段：",
    bestChunk,
    keywordContext ? "\n关键词相关片段：" : "",
    keywordContext
  ].filter(Boolean).join("\n").slice(0, 6000);
}

export function buildKnowledgeContext(document, commentsText, terms) {
  const body = extractBodyFromDocument(document);
  const summary = extractSummaryFromDocument(document);
  const lines = `${summary ? `摘要:\n${summary}\n\n` : ""}${body}\n${commentsText ? `\n评论:\n${commentsText}` : ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const matched = terms.length
    ? lines.filter((line) => terms.some((term) => line.toLowerCase().includes(term))).slice(0, 12)
    : [];
  const selected = matched.length ? matched : lines.slice(0, 18);
  return selected.join("\n").slice(0, 6000);
}

export function buildLocalKnowledgeAnswer(question, results) {
  if (!results.length) {
    return `我没有在本地知识库中找到和“${question}”明显相关的资料。可以换用资料中的关键词，或先添加相关资料。`;
  }

  const sources = results.map((result, index) => {
    const item = result.item;
    return `${index + 1}. **${item.title}**\n\n   ${result.context.slice(0, 420).replace(/\n/g, " ")}`;
  }).join("\n\n");

  return `我在本地知识库里找到了这些相关资料。当前未配置 AI 接口，所以先返回可追溯的检索结果；配置 OpenAI 兼容接口后会直接基于这些内容生成回答。\n\n问题：${question}\n\n${sources}`;
}

export function toPublicKnowledgeSource(result) {
  return {
    id: result.item.id,
    title: result.item.title,
    sourceType: result.item.sourceType,
    url: result.item.url,
    tags: result.item.tags || [],
    lastFetchedAt: result.item.lastFetchedAt,
    updatedAt: result.item.updatedAt,
    completeness: result.item.completeness || "unknown",
    coverage: result.item.coverage || {},
    processedStale: Boolean(result.item.processedStale),
    score: result.score,
    paths: result.item.paths,
    excerpt: result.context.slice(0, 500)
  };
}

export function scoreKnowledgeMatch(haystack, terms, metadata) {
  if (!terms.length) return 1;
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    score += countOccurrences(haystack, term, 6);
    if (String(metadata.title || "").toLowerCase().includes(term)) score += 6;
    if ((metadata.tags || []).some((tag) => tag.includes(term))) score += 4;
    if (String(metadata.sourceType || "").toLowerCase().includes(term)) score += 2;
  }
  return score;
}

export function countOccurrences(text, term, cap) {
  let count = 0;
  for (let index = text.indexOf(term); index !== -1 && count < cap; index = text.indexOf(term, index + term.length)) count += 1;
  return count;
}

export function tokenizeQuery(query) {
  const lower = cleanText(query).toLowerCase();
  const asciiTerms = lower.match(/[a-z0-9._/-]{2,}/g) || [];
  const cjkPhrases = lower.match(/[\p{Script=Han}]{2,}/gu) || [];
  const cjkTerms = cjkPhrases.flatMap((phrase) => {
    const terms = [phrase];
    for (let index = 0; index < phrase.length - 1; index += 1) {
      const term = phrase.slice(index, index + 2);
      if (!/[的了和是有在与及或这那哪]/u.test(term)) terms.push(term);
    }
    return terms;
  });
  const shortTerms = lower.split(/\s+/).filter((term) => term.length >= 2);
  const stopTerms = new Set(["有关", "相关", "内容", "资料", "信息", "什么", "哪些", "一下", "这个", "那个"]);
  return [...new Set([...asciiTerms, ...cjkTerms, ...shortTerms])]
    .filter((term) => !stopTerms.has(term) && !(/^[\p{Script=Han}]+$/u.test(term) && term.length > 8))
    .slice(0, 32);
}
