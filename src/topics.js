// Topics are the tags the person follows. This module turns captured items into
// a time-ordered stream of events and builds AI inputs for topic digests.
// Pure functions: the server supplies items (metadata + comments + documents).

export const STREAM_TEXT_LIMIT = 400;
export const DIGEST_BUDGET_CHARS = 60000;
export const ALL_FAVORITES = "*";

export function normalizeFavoriteTags(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((tag) => String(tag || "").trim()).filter(Boolean))].slice(0, 50);
}

// "2023-11-02T14:53:05+0800" is not ISO; add the colon before parsing.
export function parseEventTime(value) {
  if (!value) return NaN;
  const text = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(text);
}

function clip(text, limit) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * Events of one item: every message/comment with a time, plus one "update"
 * event for pages that changed without comments (e.g. Confluence edits).
 * @param {{metadata:object, comments?:object[]}} item
 */
export function itemEvents(item) {
  const metadata = item.metadata || {};
  const base = { itemId: metadata.id, itemTitle: metadata.title || "", sourceType: metadata.sourceType || "", tags: metadata.tags || [], url: metadata.url || "" };
  const events = [];
  for (const comment of item.comments || []) {
    const at = parseEventTime(comment.createdAt);
    if (!Number.isFinite(at)) continue;
    const text = clip(comment.body, STREAM_TEXT_LIMIT * 4);
    if (!text) continue;
    events.push({ ...base, kind: "message", id: `${metadata.id}:${comment.id || at}`, messageId: String(comment.id || ""), at: new Date(at).toISOString(), author: comment.author || "", text });
  }
  // The source's own update time; capture times only stand in for pages without messages
  // (for chats they just mark when new messages were fetched).
  const candidates = events.length ? [metadata.sourceUpdatedAt] : [metadata.sourceUpdatedAt, metadata.contentUpdatedAt, metadata.pendingContentUpdatedAt];
  const updatedAt = candidates.map(parseEventTime).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const latestMessage = events.reduce((max, event) => Math.max(max, Date.parse(event.at)), 0);
  // A page change that is not explained by a new comment.
  if (Number.isFinite(updatedAt) && updatedAt - latestMessage > 60 * 1000) {
    events.push({ ...base, kind: "update", id: `${metadata.id}:update:${updatedAt}`, messageId: "", at: new Date(updatedAt).toISOString(), author: "", text: metadata.updateSummary?.text ? clip(metadata.updateSummary.text, STREAM_TEXT_LIMIT) : "页面内容有更新" });
  }
  return events;
}

export function itemMatchesTopic(metadata, tag, favoriteTags = []) {
  const tags = metadata?.tags || [];
  if (tag === ALL_FAVORITES) return favoriteTags.some((favorite) => tags.includes(favorite));
  return tags.includes(tag);
}

export function isStreamCandidate(metadata) {
  return metadata && metadata.pageKind !== "list" && metadata.integrityStatus !== "quarantined" && !metadata.quarantined;
}

/**
 * Time-ordered events across items, newest first.
 * An event is "new" when it arrived after the person last read that item.
 */
export function collectStream(items, { since = 0, until = Infinity, tag = "", favoriteTags = [], sourceType = "", limit = 300 } = {}) {
  const events = [];
  for (const item of items) {
    const metadata = item.metadata || {};
    if (!isStreamCandidate(metadata)) continue;
    if (tag && !itemMatchesTopic(metadata, tag, favoriteTags)) continue;
    if (sourceType && metadata.sourceType !== sourceType) continue;
    const readAt = parseEventTime(metadata.updateAcknowledgedAt);
    const unread = Boolean(metadata.contentUpdatedAt || metadata.pendingContentUpdatedAt);
    for (const event of itemEvents(item)) {
      const at = Date.parse(event.at);
      if (at < since || at > until) continue;
      events.push({ ...event, text: clip(event.text, STREAM_TEXT_LIMIT), isNew: unread && (!Number.isFinite(readAt) || at > readAt) });
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  return { events: events.slice(0, limit), total: events.length };
}

// Keeps line breaks (Markdown structure) while bounding the length.
function truncate(text, limit) {
  const clean = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > limit ? `${clean.slice(0, Math.max(0, limit - 1))}…` : clean;
}

function itemHeader(index, metadata) {
  const when = metadata.sourceUpdatedAt || metadata.updatedAt || "";
  return `[${index}] ${metadata.title || metadata.id}（${metadata.sourceType || "资料"}${when ? `，更新于 ${when}` : ""}）${metadata.url ? `\n链接：${metadata.url}` : ""}`;
}

function newestFirst(items) {
  const activity = (item) => Math.max(0, ...itemEvents(item).map((event) => Date.parse(event.at)), parseEventTime(item.metadata?.updatedAt) || 0);
  return [...items].sort((a, b) => activity(b) - activity(a));
}

/**
 * Input for a topic overview: each item's organized version when it is current,
 * otherwise its original text (and newest messages for chat-like items).
 * @param {object[]} items {metadata, document, processedDocument, comments, body, processedBody}
 */
export function buildOverviewInput(topicLabel, items, { budget = DIGEST_BUDGET_CHARS } = {}) {
  const ordered = newestFirst(items);
  const perItem = Math.max(1500, Math.floor(budget / Math.max(1, ordered.length)));
  const refs = [];
  const blocks = [];
  let used = 0;
  for (const item of ordered) {
    if (used >= budget) break;
    const metadata = item.metadata || {};
    const index = refs.length + 1;
    let content = "";
    if (item.processedBody && !metadata.processedStale) {
      content = `（整理版）\n${item.processedBody}`;
    } else {
      const messages = (item.comments || []).slice(-30).reverse()
        .map((comment) => `- ${comment.createdAt || ""} ${comment.author || ""}：${clip(comment.body, 300)}`).join("\n");
      content = [item.body ? `（原文）\n${item.body}` : "", messages ? `最近消息/评论（新→旧）：\n${messages}` : ""].filter(Boolean).join("\n\n");
    }
    const block = `${itemHeader(index, metadata)}\n${truncate(content, Math.min(perItem, budget - used))}`;
    blocks.push(block);
    refs.push({ index, itemId: metadata.id, title: metadata.title || "", url: metadata.url || "", sourceType: metadata.sourceType || "" });
    used += block.length;
  }
  const omitted = ordered.length - refs.length;
  return {
    refs,
    system: [
      `你在为专题「${topicLabel}」写一份汇总。资料来自 Teams、Jira、GitHub、Confluence 等不同来源，已按最近活动排序，并用 [编号] 标记。`,
      "输出结构（Markdown，中文）：",
      "## 一句话现状",
      "## 关键结论与决定",
      "## 进行中 / 未解决的问题（写明负责人或下一步，没有就写“不明确”）",
      "## 主要进展（按时间，新的在前）",
      "## 各资料要点（每条一两句）",
      "要求：每个要点末尾用 [编号] 标出处；不同来源说法不一致时明确指出；只用资料里的信息，不编造；保留 issue 编号、版本号、人名、日期。"
    ].join("\n"),
    user: `${blocks.join("\n\n---\n\n")}${omitted > 0 ? `\n\n（另有 ${omitted} 条资料因篇幅未包含）` : ""}`,
    omitted
  };
}

/**
 * Input for "what changed in the last N days": the messages, comments and page
 * updates inside the window, grouped by item, newest first.
 */
export function buildRecentInput(topicLabel, items, { since, until = Date.now(), days, budget = DIGEST_BUDGET_CHARS } = {}) {
  const groups = [];
  for (const item of items) {
    const events = itemEvents(item).filter((event) => {
      const at = Date.parse(event.at);
      return at >= since && at <= until;
    }).sort((a, b) => b.at.localeCompare(a.at));
    if (events.length) groups.push({ item, events });
  }
  groups.sort((a, b) => b.events[0].at.localeCompare(a.events[0].at));
  const refs = [];
  const blocks = [];
  let used = 0;
  let eventCount = 0;
  let droppedEvents = 0;
  for (const { item, events } of groups) {
    const metadata = item.metadata || {};
    const index = refs.length + 1;
    const lines = [];
    for (const event of events) {
      const line = event.kind === "update"
        ? `- ${event.at} 页面有更新。当前内容摘录：${clip(item.processedBody && !metadata.processedStale ? item.processedBody : item.body, 1200)}`
        : `- ${event.at} ${event.author || "未知"}：${clip(event.text, 600)}`;
      if (used + line.length > budget) { droppedEvents += 1; continue; }
      lines.push(line);
      used += line.length;
      eventCount += 1;
    }
    if (!lines.length) continue;
    blocks.push(`${itemHeader(index, metadata)}\n本期 ${events.length} 条（新→旧）：\n${lines.join("\n")}`);
    refs.push({ index, itemId: metadata.id, title: metadata.title || "", url: metadata.url || "", sourceType: metadata.sourceType || "", eventCount: events.length });
  }
  return {
    refs,
    eventCount,
    droppedEvents,
    system: [
      `你在为专题「${topicLabel}」整理最近 ${days} 天的更新。下面是这段时间内各资料的新消息、新评论和页面更新，用 [编号] 标记。`,
      "输出结构（Markdown，中文）：",
      "## 概况（几句话：这段时间最重要的变化）",
      "## 重要更新（按重要程度，每条写清楚是什么、谁、什么时候）",
      "## 新出现的问题 / 需要我关注或回复的事项",
      "## 按资料的更新明细（每条资料一两句，没实质内容的合并成一句带过）",
      "要求：每个要点末尾用 [编号] 标出处；只写这段时间内的新内容，旧背景最多一句；不编造；保留 issue 编号、版本号、人名、日期。"
    ].join("\n"),
    user: blocks.length
      ? `${blocks.join("\n\n---\n\n")}${droppedEvents ? `\n\n（篇幅限制，另有 ${droppedEvents} 条较早的消息未包含）` : ""}`
      : ""
  };
}

/** Appends a source list so [n] citations stay clickable after the AI text. */
export function appendSourceList(text, refs) {
  if (!refs.length) return text;
  const lines = refs.map((ref) => `- [${ref.index}] ${ref.title}${ref.url ? ` — ${ref.url}` : ""}`);
  return `${String(text || "").trim()}\n\n## 出处\n\n${lines.join("\n")}\n`;
}
