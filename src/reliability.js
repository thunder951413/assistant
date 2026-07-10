import { promises as fs } from "node:fs";
import path from "node:path";

export function createRunHistory(filePath, options = {}) {
  const maxBytes = Math.max(64 * 1024, Number(options.maxBytes) || 2 * 1024 * 1024);
  const maxEntries = Math.max(10, Number(options.maxEntries) || 200);

  async function append(entry) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await rotateIfNeeded();
    const record = { ...entry, recordedAt: entry.recordedAt || new Date().toISOString() };
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(filePath, 0o600).catch(() => {});
    return record;
  }

  async function list(limit = 50) {
    let text = "";
    try { text = await fs.readFile(filePath, "utf8"); } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return text.split("\n").filter(Boolean).slice(-Math.min(maxEntries, Math.max(1, Number(limit) || 50)))
      .reverse().map((line) => JSON.parse(line));
  }

  async function rotateIfNeeded() {
    let stat;
    try { stat = await fs.stat(filePath); } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stat.size < maxBytes) return;
    await fs.rm(`${filePath}.1`, { force: true });
    await fs.rename(filePath, `${filePath}.1`);
  }

  return { append, list };
}

export function computeSourceHealth(items = [], jobs = [], now = Date.now()) {
  const sources = new Map();
  const get = (sourceType) => {
    const key = sourceType || "unknown";
    if (!sources.has(key)) sources.set(key, {
      sourceType: key, itemCount: 0, enabledJobs: 0, failedJobs: 0, quarantinedItems: 0,
      incompleteItems: 0, staleItems: 0, latestFetchedAt: "", latestSuccessAt: "", captureMethods: {}
    });
    return sources.get(key);
  };
  for (const item of items) {
    const row = get(item.sourceType);
    row.itemCount += 1;
    if (item.integrityStatus === "quarantined" || item.quarantined) row.quarantinedItems += 1;
    const bodySignal = Number(item.contentLength || item.excerpt?.length || 0);
    if (!item.title || bodySignal < 80) row.incompleteItems += 1;
    const fetched = Date.parse(item.lastFetchedAt || item.updatedAt || "");
    if (fetched && now - fetched > 30 * 86400000) row.staleItems += 1;
    if (String(item.lastFetchedAt || "") > row.latestFetchedAt) row.latestFetchedAt = item.lastFetchedAt;
    const method = item.captureMethod || item.fetchMode || "unknown";
    row.captureMethods[method] = (row.captureMethods[method] || 0) + 1;
  }
  for (const job of jobs) {
    let sourceType = job.sourceType;
    if (!sourceType) {
      try {
        const host = new URL(job.url).hostname;
        sourceType = host.includes("jira") || host.includes("atlassian") ? "jira" : host.includes("github") ? "github" : host.includes("teams") ? "teams" : host.includes("confluence") ? "confluence" : "web";
      } catch { sourceType = "web"; }
    }
    const row = get(sourceType);
    if (job.enabled) row.enabledJobs += 1;
    if (job.enabled && (["failed", "unreachable"].includes(job.status) || job.circuitOpen)) row.failedJobs += 1;
    if (job.status === "idle" && job.lastRunAt > row.latestSuccessAt) row.latestSuccessAt = job.lastRunAt;
  }
  return [...sources.values()].map((row) => {
    const defects = row.quarantinedItems + row.incompleteItems + row.staleItems + row.failedJobs;
    const denominator = Math.max(1, row.itemCount + row.enabledJobs);
    return { ...row, score: Math.max(0, Math.round(100 - defects / denominator * 100)), healthy: defects === 0 };
  }).sort((a, b) => a.sourceType.localeCompare(b.sourceType));
}

export function lineDiff(before = "", after = "", maxLines = 1200) {
  const left = String(before).split("\n");
  const right = String(after).split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const removed = left.slice(prefix, left.length - suffix);
  const added = right.slice(prefix, right.length - suffix);
  const lines = [
    ...left.slice(Math.max(0, prefix - 3), prefix).map((line) => `  ${line}`),
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
    ...right.slice(right.length - suffix, Math.min(right.length, right.length - suffix + 3)).map((line) => `  ${line}`)
  ];
  return { changed: removed.length > 0 || added.length > 0, addedLines: added.length, removedLines: removed.length, text: lines.slice(0, maxLines).join("\n"), truncated: lines.length > maxLines };
}
