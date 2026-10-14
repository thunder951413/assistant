// When to (re)run AI organization, and what to send.
//
// Message streams (Teams chats, long comment threads) change a little at a time.
// Re-processing the whole stream after every new message is slow and costly, so:
//  - automatic processing waits until enough new material has accumulated
//    (or the organized version is old), configurable in settings.autoProcess;
//  - an update sends the existing organized version plus only the new messages
//    ("incremental"), and every few increments a full pass rebuilds it;
//  - a full pass of a long stream keeps the newest messages, not the oldest.

export function defaultAutoProcessSettings() {
  return { mode: "threshold", minNewMessages: 20, minNewChars: 3000, maxStaleDays: 7, fullEvery: 8 };
}

export function normalizeAutoProcessSettings(value = {}) {
  const defaults = defaultAutoProcessSettings();
  const number = (input, fallback, min, max) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
  };
  return {
    mode: ["threshold", "always", "manual"].includes(value.mode) ? value.mode : defaults.mode,
    minNewMessages: number(value.minNewMessages, defaults.minNewMessages, 1, 1000),
    minNewChars: number(value.minNewChars, defaults.minNewChars, 100, 200000),
    maxStaleDays: number(value.maxStaleDays, defaults.maxStaleDays, 1, 365),
    fullEvery: number(value.fullEvery, defaults.fullEvery, 1, 100)
  };
}

const STREAM_SOURCES = new Set(["teams"]);

export function isMessageStream(item) {
  return STREAM_SOURCES.has(item?.metadata?.sourceType) || (item?.comments?.length || 0) >= 30;
}

function messageTime(comment) {
  return String(comment?.createdAt || "");
}

// What changed since the organized version was produced.
export function analyzeProcessingDelta(item, now = Date.now()) {
  const metadata = item?.metadata || {};
  const comments = Array.isArray(item?.comments) ? item.comments : [];
  const processedAt = metadata.processedAt || "";
  const through = metadata.processedThroughAt || processedAt;
  const newComments = through ? comments.filter((comment) => messageTime(comment) > through) : comments;
  const newChars = newComments.reduce((sum, comment) => sum + String(comment.body || "").length, 0);
  const ageDays = processedAt ? (now - Date.parse(processedAt)) / 86400000 : Infinity;
  return {
    stream: isMessageStream(item),
    hasProcessed: Boolean(item?.processedDocument?.trim?.() && processedAt),
    stale: Boolean(metadata.processedStale || metadata.pendingContentUpdatedAt),
    newMessages: newComments.length,
    newChars,
    newComments,
    ageDays,
    through
  };
}

// Should a refresh trigger automatic processing of this item now?
export function shouldAutoProcess(item, policy = defaultAutoProcessSettings(), now = Date.now()) {
  const settings = normalizeAutoProcessSettings(policy);
  const delta = analyzeProcessingDelta(item, now);
  if (settings.mode === "manual") return { process: false, reason: "manual", delta };
  if (!delta.hasProcessed) return { process: true, reason: "first", delta };
  if (!delta.stale) return { process: false, reason: "fresh", delta };
  if (settings.mode === "always" || !delta.stream) return { process: true, reason: "changed", delta };
  if (delta.newMessages >= settings.minNewMessages) return { process: true, reason: "messages", delta };
  if (delta.newChars >= settings.minNewChars) return { process: true, reason: "chars", delta };
  if (delta.newMessages > 0 && delta.ageDays >= settings.maxStaleDays) return { process: true, reason: "age", delta };
  return { process: false, reason: "below-threshold", delta };
}

function formatMessages(comments) {
  return comments.map((comment) => [
    [comment.author, comment.createdAt].filter(Boolean).join(" · "),
    String(comment.body || "")
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");
}

// Keeps the newest messages that fit in `budget` characters, in chronological order.
export function newestMessagesWithin(comments, budget) {
  const sorted = [...comments].sort((a, b) => messageTime(a).localeCompare(messageTime(b)));
  const kept = [];
  let used = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const size = String(sorted[index].body || "").length + 80;
    if (kept.length && used + size > budget) break;
    kept.unshift(sorted[index]);
    used += size;
  }
  return { kept, omitted: sorted.length - kept.length };
}

const INCREMENTAL_MAX_MESSAGES = 400;
const STREAM_BUDGET_CHARS = 40000;

// Builds the model input. Returns { mode, user, systemExtra, processedThroughAt }.
export function buildProcessingInput(item, { body = "", summary = "", processedBody = "", policy } = {}) {
  const settings = normalizeAutoProcessSettings(policy);
  const metadata = item.metadata || {};
  const comments = Array.isArray(item.comments) ? item.comments : [];
  const latestTime = comments.map(messageTime).filter(Boolean).sort().at(-1) || "";
  const header = [
    `标题：${metadata.title}`,
    `来源类型：${metadata.sourceType}`,
    `URL：${metadata.url || "local input"}`,
    `标签：${(metadata.tags || []).join(", ") || "none"}`,
    `最后抓取：${metadata.lastFetchedAt || "not fetched"}`,
    `来源更新时间：${metadata.sourceUpdatedAt || "unknown"}`
  ].join("\n");

  if (!isMessageStream(item)) {
    return {
      mode: "full",
      systemExtra: "",
      processedThroughAt: latestTime,
      user: [header, "", summary ? `已有摘要：\n${summary}\n` : "", "原始提取内容：", body.slice(0, 28000),
        comments.length ? `\n\n评论/对话结构化内容：\n${formatMessages(newestMessagesWithin(comments, 12000).kept)}` : ""].join("\n")
    };
  }

  const delta = analyzeProcessingDelta(item);
  const incrementalCount = Number(metadata.processedIncrementalCount || 0);
  const canIncrement = processedBody.trim() && delta.through && delta.newMessages > 0
    && delta.newMessages <= INCREMENTAL_MAX_MESSAGES && incrementalCount + 1 < settings.fullEvery;
  if (canIncrement) {
    const { kept, omitted } = newestMessagesWithin(delta.newComments, STREAM_BUDGET_CHARS);
    return {
      mode: "incremental",
      processedThroughAt: latestTime,
      systemExtra: [
        "这是一次增量更新：下面给出已有的整理版，以及在它之后新增的消息。",
        "请把新增消息合并进整理版，输出更新后的完整整理版（不是只输出新增部分）。",
        "新增内容推翻旧结论时以新消息为准，并在相应位置注明变化与时间。"
      ].join("\n"),
      user: [header, "", "已有整理版：", processedBody.slice(0, 24000), "",
        `自 ${delta.through} 之后新增 ${delta.newMessages} 条消息${omitted ? `（仅包含最近 ${kept.length} 条）` : ""}：`,
        formatMessages(kept)].join("\n")
    };
  }

  const { kept, omitted } = newestMessagesWithin(comments, STREAM_BUDGET_CHARS);
  return {
    mode: "full",
    processedThroughAt: latestTime,
    systemExtra: omitted ? `消息较多，只提供了最近的 ${kept.length} 条（共 ${comments.length} 条）；更早的内容如有已有整理版可作参考。` : "",
    user: [header, "",
      omitted && processedBody.trim() ? `较早内容的已有整理版（供参考）：\n${processedBody.slice(0, 12000)}\n` : "",
      `对话消息（按时间顺序${omitted ? `，最近 ${kept.length} 条` : `，共 ${kept.length} 条`}）：`,
      formatMessages(kept)].join("\n")
  };
}
