// Pure text, date and document helpers shared across capture, refresh and AI code.
import { extractBodyFromDocument } from "./item-store.js";
import { cleanText, normalizeTags } from "./utils.js";

export function isSameRelativeSourceDay(existingValue, referenceDate, listValue) {
  if (!/^(today|yesterday)$/i.test(cleanText(existingValue))) return false;
  const existingTime = parseSourceUpdatedAt(existingValue, referenceDate);
  const listTime = Date.parse(listValue);
  if (Number.isNaN(existingTime) || Number.isNaN(listTime)) return false;
  return toDateKey(existingTime) === toDateKey(listTime);
}

export function toDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function normalizeSourceUpdatedAt(value, referenceDate = "") {
  const clean = cleanText(value);
  if (!clean) return "";
  const parsed = parseSourceUpdatedAt(clean, referenceDate);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return clean.toLowerCase().replace(/\s+/g, " ");
}

export function latestTimestampValue(values) {
  let latestValue = "";
  let latestTime = Number.NEGATIVE_INFINITY;
  let lastNonEmpty = "";
  for (const value of values) {
    const clean = cleanText(value || "");
    if (!clean) continue;
    lastNonEmpty = clean;
    const parsed = Date.parse(clean);
    if (Number.isNaN(parsed) || parsed <= latestTime) continue;
    latestValue = clean;
    latestTime = parsed;
  }
  // Prefer the chronologically latest parseable timestamp. When none of the
  // values parse (e.g. Teams captured only localized/relative time strings),
  // fall back to the last non-empty raw value so callers don't lose the
  // field entirely — matching the previous `.at(-1)` behavior in that case.
  return latestValue || lastNonEmpty;
}

export function parseSourceUpdatedAt(value, referenceDate = "") {
  const clean = cleanText(value);
  if (!clean) return Number.NaN;
  const parsed = Date.parse(clean);
  if (!Number.isNaN(parsed)) return parsed;

  const reference = Date.parse(referenceDate);
  if (Number.isNaN(reference)) return Number.NaN;
  const referenceDay = new Date(reference);
  referenceDay.setHours(0, 0, 0, 0);
  if (/^yesterday$/i.test(clean)) return referenceDay.getTime() - 24 * 60 * 60 * 1000;
  if (/^today$/i.test(clean)) return referenceDay.getTime();
  return Number.NaN;
}

export function sourceTypeLabel(sourceType) {
  const labels = {
    text: "文本",
    web: "文本",
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams"
  };
  return labels[sourceType] || sourceType || "";
}

export function sourceLabel(sourceType) {
  return {
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams",
    web: "文本",
    text: "文本"
  }[sourceType] || sourceType || "资料";
}

export function isTruthyFilter(value) {
  return value === true || value === "1" || value === "true" || value === "yes";
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function unwrapMarkdownFence(markdown) {
  const source = String(markdown || "").trim();
  const match = source.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : source;
}

export function extractProcessedBodyFromDocument(document) {
  const marker = "\n## AI Organized Content\n\n";
  const index = document.indexOf(marker);
  return index === -1 ? document : document.slice(index + marker.length);
}

export function normalizeSourceType(sourceType, url) {
  if (sourceType) return sourceType;
  if (!url) return "text";
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("confluence.amlogic.com")) return "confluence";
  if (lowerUrl.includes("github.com")) return "github";
  if (lowerUrl.includes("github.ecodesamsung.com")) return "github";
  if (lowerUrl.includes("teams.microsoft.com") || lowerUrl.includes("teams.live.com") || lowerUrl.includes("teams.cloud.microsoft")) return "teams";
  if (lowerUrl.includes("jira") || lowerUrl.includes("/browse/")) return "jira";
  if (lowerUrl.includes("roku.atlassian.net")) return "jira";
  return "web";
}

export function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .map((comment) => ({
      id: cleanText(comment.id || ""),
      author: cleanText(comment.author || ""),
      createdAt: cleanText(comment.createdAt || ""),
      body: cleanText(comment.body || ""),
      url: cleanText(comment.url || "")
    }))
    .filter((comment) => comment.body || comment.author || comment.id);
}

export function detectUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

export function summarizeExcerpt(document) {
  return extractBodyFromDocument(document)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

export function cleanTextBlock(content) {
  return String(content || "").replace(/\r\n/g, "\n").trim() + "\n";
}

export function buildLocalSummary(content) {
  const lines = cleanText(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLines = lines.slice(0, 5).join("\n");
  const commentLines = lines.filter((line) => /comment|评论|讨论|回复|alice|bob/i.test(line)).slice(0, 5);
  const statusLines = lines.filter((line) => /状态|进展|blocked|blocker|todo|action|下一步|待办/i.test(line)).slice(0, 5);

  return [
    "### 摘要",
    firstLines || content.slice(0, 600),
    "",
    "### 可能的进展/状态",
    statusLines.length ? statusLines.map((line) => `- ${line}`).join("\n") : "- 未从文本中识别到明确状态。",
    "",
    "### 可能的评论/讨论",
    commentLines.length ? commentLines.map((line) => `- ${line}`).join("\n") : "- 未从文本中识别到明确评论。"
  ].join("\n");
}
