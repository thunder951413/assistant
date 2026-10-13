// Local (model-free) fallbacks and parsers for titles, tags and classification.
import { extractBodyFromDocument } from "./item-store.js";
import { sourceTypeLabel } from "./text-helpers.js";
import { cleanText, normalizeTags, uniqueValues } from "./utils.js";

export function recommendTitleLocally(item) {
  const body = extractBodyFromDocument(item.document);
  const lines = body.split(/\n+/)
    .map((line) => cleanText(line.replace(/^[-#*>`\s]+/, "")))
    .filter((line) => line.length >= 6 && !/^source:|^adapter:|^url:/i.test(line));
  return cleanGeneratedTitle(lines[0] || item.metadata.title || "未命名资料");
}

export function cleanGeneratedTitle(title) {
  return cleanText(String(title || "")
    .replace(/^#+\s*/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^标题[:：]\s*/i, ""))
    .slice(0, 180) || "未命名资料";
}

export function recommendBatchTagsLocally(items, allTags) {
  const assignments = items.map((item) => {
    const content = [
      item.metadata.title,
      item.processedDocument || item.document
    ].join("\n");
    return {
      id: item.metadata.id,
      tags: recommendTagsLocally(content, allTags, item.metadata.tags || [])
    };
  });
  return {
    tags: uniqueValues(assignments.flatMap((assignment) => assignment.tags)),
    assignments
  };
}

export function normalizeBatchTagRecommendations(result, items, allTags) {
  const itemIds = new Set(items.map((item) => item.metadata.id));
  const knownTags = new Map(allTags.map((tag) => [tag.toLowerCase(), tag]));
  const canonicalize = (tags) => normalizeTags(tags || []).map((tag) => knownTags.get(tag.toLowerCase()) || tag);
  const assignments = (result.assignments || [])
    .filter((assignment) => itemIds.has(assignment.id))
    .map((assignment) => ({
      id: assignment.id,
      tags: uniqueValues(canonicalize(assignment.tags)).slice(0, 12)
    }));
  const assignedIds = new Set(assignments.map((assignment) => assignment.id));
  for (const item of items) {
    if (!assignedIds.has(item.metadata.id)) {
      assignments.push({ id: item.metadata.id, tags: [] });
    }
  }
  const tags = uniqueValues([
    ...canonicalize(result.tags || []),
    ...assignments.flatMap((assignment) => assignment.tags)
  ]).slice(0, 40);
  return { tags, assignments };
}

export function classifyItemLocally(item, categories) {
  const content = [
    item.metadata.title,
    item.metadata.sourceType,
    ...(item.metadata.tags || []),
    extractBodyFromDocument(item.document).slice(0, 2000)
  ].join("\n").toLowerCase();
  const matchedCategory = categories.find((category) => content.includes(category.toLowerCase()));
  return {
    id: item.metadata.id,
    category: matchedCategory || "未分类",
    reason: matchedCategory ? "按类别关键词本地匹配。" : "未配置 AI，且未命中类别关键词。"
  };
}

export function classifyItemsLocally(items, categories = []) {
  const groupsByName = new Map();
  for (const item of items) {
    const tags = item.metadata.tags || [];
    const content = [
      item.metadata.title,
      item.metadata.sourceType,
      ...(item.metadata.tags || []),
      extractBodyFromDocument(item.document).slice(0, 1200)
    ].join("\n").toLowerCase();
    const matchedCategory = categories.find((category) => content.includes(category.toLowerCase()));
    const name = matchedCategory || tags[0] || sourceTypeLabel(item.metadata.sourceType) || "未分类";
    if (!groupsByName.has(name)) {
      groupsByName.set(name, {
        name,
        itemIds: [],
        reason: categories.length
          ? "未配置 AI，当前按类别关键词本地匹配。"
          : tags[0] ? "按已有标签分组。" : "未配置 AI，按来源类型分组。"
      });
    }
    groupsByName.get(name).itemIds.push(item.metadata.id);
  }
  return {
    groups: [...groupsByName.values()],
    note: categories.length
      ? "未配置 AI 接口，当前按自定义类别关键词本地匹配。"
      : "未配置 AI 接口，当前按标签或来源本地分类。"
  };
}

export function normalizeClassificationCategories(categories) {
  return uniqueValues((categories || [])
    .map((category) => cleanText(category).slice(0, 40))
    .filter(Boolean))
    .slice(0, 24);
}

export function normalizeSingleClassification(result, item, categories) {
  const categoryByLower = new Map(categories.map((category) => [category.toLowerCase(), category]));
  const rawCategory = cleanText(result.category || result.name || "").slice(0, 40);
  const category = categoryByLower.get(rawCategory.toLowerCase()) || (rawCategory === "未分类" ? "未分类" : "未分类");
  return {
    id: item.metadata.id,
    category,
    reason: cleanText(result.reason || "").slice(0, 120)
  };
}

export function normalizeItemClassification(result, items, categories = []) {
  const itemIds = new Set(items.map((item) => item.metadata.id));
  const categoryByLower = new Map(categories.map((category) => [category.toLowerCase(), category]));
  const assigned = new Set();
  const groupsByName = new Map();
  const addGroupItems = (name, itemIds, reason = "") => {
    if (!groupsByName.has(name)) {
      groupsByName.set(name, { name, itemIds: [], reason });
    }
    const group = groupsByName.get(name);
    group.itemIds.push(...itemIds);
    if (!group.reason && reason) group.reason = reason;
  };
  for (const group of result.groups || []) {
    const ids = uniqueValues((group.itemIds || group.items || [])
      .map((id) => cleanText(typeof id === "string" ? id : id?.id))
      .filter((id) => itemIds.has(id) && !assigned.has(id)));
    if (!ids.length) continue;
    ids.forEach((id) => assigned.add(id));
    const rawName = cleanText(group.name || group.title || "未命名分类").slice(0, 40) || "未命名分类";
    const name = categories.length
      ? categoryByLower.get(rawName.toLowerCase()) || (rawName === "未分类" ? "未分类" : "未分类")
      : rawName;
    addGroupItems(name, ids, cleanText(group.reason || "").slice(0, 120));
  }
  const leftovers = items.map((item) => item.metadata.id).filter((id) => !assigned.has(id));
  if (leftovers.length) {
    addGroupItems("未分类", leftovers, "分类结果中未覆盖的资料。");
  }
  return {
    groups: [...groupsByName.values()].map((group) => ({
      ...group,
      itemIds: uniqueValues(group.itemIds)
    })),
    note: result.note || ""
  };
}

export function parseTagsFromAiText(text) {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.tags)) return parsed.tags;
  } catch {
    // Fall through to comma/newline parsing.
  }
  return text.split(/[,\n]/).map((tag) => tag.replace(/^[-*\d.\s]+/, "").trim());
}

export function parseJsonObjectFromText(text) {
  const raw = String(text || "");
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try {
    return JSON.parse(jsonText);
  } catch {
    return {};
  }
}

export function recommendTagsLocally(content, allTags, currentTags) {
  const lowerContent = content.toLowerCase();
  const matchedExisting = allTags.filter((tag) => lowerContent.includes(tag.toLowerCase())).slice(0, 8);
  const inferred = [
    /github|pull request|issuecomment|repository/i.test(content) ? "github" : "",
    /jira|assignee|reporter|resolution/i.test(content) ? "jira" : "",
    /confluence|page id|space:/i.test(content) ? "confluence" : "",
    /blocked|blocker|阻塞/i.test(content) ? "blocked" : "",
    /test|测试|ci\b|certification/i.test(content) ? "test" : "",
    /requirement|需求|request/i.test(content) ? "requirement" : "",
    /hardware|hw\b|electrical/i.test(content) ? "hw" : "",
    /software|sw\b/i.test(content) ? "sw" : ""
  ].filter(Boolean);
  return normalizeRecommendedTags([...currentTags, ...matchedExisting, ...inferred], allTags, currentTags);
}

export function normalizeRecommendedTags(tags, allTags, currentTags = []) {
  const normalized = normalizeTags(tags);
  const existingByLower = new Map(allTags.map((tag) => [tag.toLowerCase(), tag]));
  const current = new Set(currentTags.map((tag) => tag.toLowerCase()));
  const canonical = normalized.map((tag) => existingByLower.get(tag.toLowerCase()) || tag);
  return [...new Set([...canonical])].sort((a, b) => {
    const aCurrent = current.has(a.toLowerCase()) ? 0 : 1;
    const bCurrent = current.has(b.toLowerCase()) ? 0 : 1;
    return aCurrent - bCurrent || a.localeCompare(b);
  }).slice(0, 10);
}
