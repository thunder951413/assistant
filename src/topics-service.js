// Topics (followed tags): materials cache, overview and AI digests.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { canUseMaterial } from "./ai-policy.js";
import { atomicWriteFile } from "./atomic-files.js";
import { extractBodyFromDocument } from "./item-store.js";
import { extractProcessedBodyFromDocument } from "./text-helpers.js";
import { ALL_FAVORITES, appendSourceList, buildOverviewInput, buildRecentInput, collectStream, isStreamCandidate, itemMatchesTopic, normalizeFavoriteTags } from "./topics.js";
import { slugify } from "./utils.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createTopicsService(ctx) {
  // Functions that live elsewhere, resolved when called.
  const listItems = (...args) => ctx.listItems(...args);
  const readItem = (...args) => ctx.readItem(...args);
  const supplementalPromptBlock = (...args) => ctx.supplementalPromptBlock(...args);

  // Topic materials: current metadata from the store list, bodies and comments
  // cached until the item changes.
  const topicMaterialCache = new Map();

  async function loadTopicMaterials() {
    const list = await listItems({ includeLists: false });
    const materials = [];
    const live = new Set(list.map((metadata) => metadata.id));
    for (const id of topicMaterialCache.keys()) if (!live.has(id)) topicMaterialCache.delete(id);
    for (const metadata of list) {
      if (!isStreamCandidate(metadata)) continue;
      const key = [metadata.lastFetchedAt, metadata.updatedAt, metadata.processedAt, metadata.processedStale].join("|");
      let cached = topicMaterialCache.get(metadata.id);
      if (!cached || cached.key !== key) {
        try {
          const item = await readItem(metadata.id);
          cached = {
            key,
            comments: item.comments || [],
            body: extractBodyFromDocument(item.document || "").trim(),
            processedBody: item.processedDocument ? extractProcessedBodyFromDocument(item.processedDocument).trim() : ""
          };
          topicMaterialCache.set(metadata.id, cached);
        } catch {
          continue;
        }
      }
      materials.push({ metadata, comments: cached.comments, body: cached.body, processedBody: cached.processedBody });
    }
    return materials;
  }

  function topicDigestPath(tag) {
    const slug = tag === ALL_FAVORITES ? "all-favorites" : slugify(tag) || createHash("sha1").update(tag).digest("hex").slice(0, 12);
    return path.join(ctx.kbDir, "topics", `${slug}.json`);
  }

  async function readTopicDigest(tag) {
    try {
      return JSON.parse(await fs.readFile(topicDigestPath(tag), "utf8"));
    } catch {
      return { tag, overview: null, recent: {} };
    }
  }

  async function topicOverview() {
    const favorites = normalizeFavoriteTags(ctx.settings.favoriteTags || []);
    const materials = await loadTopicMaterials();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const tagCounts = new Map();
    for (const { metadata } of materials) for (const tag of metadata.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    const describe = async (tag) => {
      const members = materials.filter(({ metadata }) => itemMatchesTopic(metadata, tag, favorites));
      const stream = collectStream(members, { since: weekAgo, limit: 1 });
      const digest = await readTopicDigest(tag);
      const activity = members.map(({ metadata }) => metadata.sourceUpdatedAt || metadata.updatedAt || "").filter(Boolean).sort().at(-1) || "";
      return {
        tag,
        itemCount: members.length,
        unreadCount: members.filter(({ metadata }) => metadata.contentUpdatedAt || metadata.pendingContentUpdatedAt).length,
        weekEventCount: stream.total,
        sources: [...new Set(members.map(({ metadata }) => metadata.sourceType))],
        lastActivityAt: activity,
        overviewAt: digest.overview?.generatedAt || "",
        recentAt: Object.values(digest.recent || {}).map((entry) => entry.generatedAt).sort().at(-1) || ""
      };
    };
    return {
      favorites: await Promise.all(favorites.map(describe)),
      all: favorites.length ? await describe(ALL_FAVORITES) : null,
      tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count, favorite: favorites.includes(tag) }))
    };
  }

  async function generateTopicDigest(tag, { mode, days }) {
    const favorites = normalizeFavoriteTags(ctx.settings.favoriteTags || []);
    if (tag === ALL_FAVORITES && !favorites.length) throw new Error("还没有关注任何标签。");
    const label = tag === ALL_FAVORITES ? "全部关注" : tag;
    const members = (await loadTopicMaterials()).filter(({ metadata }) => itemMatchesTopic(metadata, tag, favorites));
    // Respect per-source "do not send to remote AI" settings.
    const allowed = members.filter(({ metadata }) => canUseMaterial(metadata, ctx.settings));
    const excluded = members.length - allowed.length;
    if (!allowed.length) throw new Error(members.length ? "这个专题的资料都设置为不能发送给当前的 AI 服务。" : "这个标签下还没有资料。");
    const now = Date.now();
    const since = now - days * 24 * 60 * 60 * 1000;
    const input = mode === "recent"
      ? buildRecentInput(label, allowed, { since, until: now, days })
      : buildOverviewInput(label, allowed);
    const generatedAt = new Date(now).toISOString();
    let text;
    if (mode === "recent" && !input.user) {
      text = `最近 ${days} 天，这个专题没有新的消息、评论或页面更新。`;
    } else {
      const supplemental = await supplementalPromptBlock();
      const used = new Set(input.refs.map((ref) => ref.itemId));
      text = await ctx.ai.chat([
        { role: "system", content: [input.system, supplemental].filter(Boolean).join("\n\n") },
        { role: "user", content: input.user }
      ], { materials: allowed.filter(({ metadata }) => used.has(metadata.id)).map(({ metadata }) => metadata), timeoutMs: 240000 });
      text = appendSourceList(text, input.refs);
    }
    const entry = {
      text,
      generatedAt,
      itemCount: input.refs.length,
      memberCount: members.length,
      excludedCount: excluded,
      refs: input.refs,
      ...(mode === "recent" ? { days, since: new Date(since).toISOString(), eventCount: input.eventCount, droppedEvents: input.droppedEvents } : { omitted: input.omitted })
    };
    const digest = await readTopicDigest(tag);
    const next = mode === "recent"
      ? { ...digest, tag, recent: { ...(digest.recent || {}), [String(days)]: entry } }
      : { ...digest, tag, overview: entry };
    const file = topicDigestPath(tag);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  return { loadTopicMaterials, readTopicDigest, topicOverview, generateTopicDigest };
}
