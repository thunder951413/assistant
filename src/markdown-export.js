// Markdown exports of AI-organized content: a single item's organized version
// and a topic's digests (overview / recent N days). Pure functions; the routes
// in server.js read the data and send the result as a download.
import { extractProcessedBodyFromDocument, unwrapMarkdownFence } from "./text-helpers.js";
import { ALL_FAVORITES } from "./topics.js";

const SOURCE_LABELS = { jira: "Jira", confluence: "Confluence", github: "GitHub", teams: "Teams", web: "网页", text: "手动输入" };

function localStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// Characters that are invalid in file names on macOS / Windows, plus control characters.
export function safeFileName(name, fallback = "export") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

export function itemExportMarkdown(item, { now = new Date() } = {}) {
  const metadata = item?.metadata || {};
  const processed = String(item?.processedDocument || "");
  if (!processed.trim()) {
    const error = new Error("这条资料还没有 AI 整理版，先生成整理再导出。");
    error.statusCode = 404;
    throw error;
  }
  const title = metadata.title || "未命名资料";
  const compact = "## AI Organized Content\n\n";
  let body = unwrapMarkdownFence(processed.startsWith(compact) ? processed.slice(compact.length) : extractProcessedBodyFromDocument(processed)).trim();
  if (!/^#\s/.test(body)) body = `# ${title}\n\n${body}`;
  const facts = [
    metadata.url ? `- 原文：${metadata.url}` : "",
    metadata.sourceType ? `- 来源：${SOURCE_LABELS[metadata.sourceType] || metadata.sourceType}` : "",
    (metadata.tags || []).length ? `- 标签：${metadata.tags.join("、")}` : "",
    metadata.processedAt ? `- 整理时间：${localStamp(metadata.processedAt)}${metadata.processedStale ? "（之后原文有更新，整理版可能不是最新）" : ""}` : "",
    `- 导出时间：${localStamp(now.toISOString())}`
  ].filter(Boolean);
  return {
    filename: `${safeFileName(title)}-整理-${dayStamp(now)}.md`,
    content: `${body}\n\n---\n\n${facts.join("\n")}\n`
  };
}

// Inline citations [n] become links to the source, except inside the source list itself.
function linkCitations(text, refs) {
  const byIndex = new Map((refs || []).filter((ref) => ref.url).map((ref) => [String(ref.index), ref]));
  if (!byIndex.size) return text;
  const marker = "\n## 出处\n";
  const split = text.indexOf(marker);
  const head = split === -1 ? text : text.slice(0, split);
  const tail = split === -1 ? "" : text.slice(split);
  // A run such as [1][2] is handled as a whole; a run right after "]" is a
  // reference-style link label, and one followed by "(" or ":" is already a link.
  const linked = head.replace(/(?<!\])(?:\[\d{1,3}\])+(?![(:])/g, (run) => run.replace(/\[(\d{1,3})\]/g, (match, index) => {
    const ref = byIndex.get(index);
    return ref ? `[[${index}]](${ref.url})` : match;
  }));
  return linked + tail;
}

export function topicDigestExportMarkdown(tag, digest, { mode = "overview", days = 7, now = new Date() } = {}) {
  const entry = mode === "recent" ? digest?.recent?.[String(days)] : digest?.overview;
  if (!entry?.text) {
    const error = new Error(mode === "recent" ? `还没有最近 ${days} 天的整理，先生成再导出。` : "还没有总览，先生成再导出。");
    error.statusCode = 404;
    throw error;
  }
  const label = tag === ALL_FAVORITES ? "全部关注" : tag;
  const heading = mode === "recent" ? `${label}：最近 ${days} 天的更新` : `${label}：总览`;
  const facts = [
    `生成于 ${localStamp(entry.generatedAt)}`,
    `基于 ${entry.itemCount} 条资料`,
    entry.excludedCount ? `${entry.excludedCount} 条按设置未发送给 AI` : "",
    entry.omitted ? `另有 ${entry.omitted} 条因篇幅未包含` : "",
    mode === "recent" && entry.since ? `时间范围 ${localStamp(entry.since)} 至 ${localStamp(entry.generatedAt)}` : ""
  ].filter(Boolean).join("，");
  const body = linkCitations(String(entry.text).trim(), entry.refs);
  return {
    filename: `${safeFileName(label, "专题")}-${mode === "recent" ? `最近${days}天` : "总览"}-${dayStamp(now)}.md`,
    content: `# ${heading}\n\n> ${facts}。导出时间 ${localStamp(now.toISOString())}。\n\n${body}\n`
  };
}
