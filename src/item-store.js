// ItemStore — unified file-system storage for knowledge-base items.
//
// Encapsulates metadata.json / document.md / processed.md / comments.jsonl
// read/write, listing, searching, deletion, and index rebuilding.
// Paths are resolved lazily via a getter so they track settings changes.
//
// Usage:
//   import { createItemStore } from "./item-store.js";
//   const store = createItemStore(() => ({ itemsDir, tagsDir, indexesDir }));
//   const item = await store.read("some-id");
//   const items = await store.list({ tag: "jira" });

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { slugify } from "./utils.js";
import { atomicWriteFile, atomicWriteJson, pathExists, replaceDirectory } from "./atomic-files.js";

// ---- Path helpers ----

async function exists(filePath) {
  return pathExists(filePath);
}

async function safeReaddir(dir) {
  if (!(await exists(dir))) return [];
  return fs.readdir(dir);
}

async function readJsonLines(filePath) {
  if (!(await exists(filePath))) return [];
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ---- Document formatting ----

export function renderDocument(metadata, body, summary = "") {
  const tags = (metadata.tags || []).join(", ") || "none";
  const url = metadata.url || "local input";
  const refreshNote = metadata.refreshNote
    ? `\n## Latest Refresh\n\n- Previous length: ${metadata.refreshNote.previousDocumentLength}\n- Current length: ${metadata.refreshNote.currentDocumentLength}\n- Delta: ${metadata.refreshNote.lengthDelta}\n`
    : "";
  const summaryBlock = summary.trim() ? `\n## Summary\n\n${summary.trim()}\n` : "";

  return `# ${metadata.title}

## Metadata

- ID: ${metadata.id}
- Source: ${metadata.sourceType}
- URL: ${url}
- Tags: ${tags}
- Created: ${metadata.createdAt}
- Updated: ${metadata.updatedAt}
- Last fetched: ${metadata.lastFetchedAt || "not fetched"}
- Source updated: ${metadata.sourceUpdatedAt || "unknown"}
${refreshNote}
${summaryBlock}
## Content

${body.trim() || "_No content captured yet._"}
`;
}

export function extractBodyFromDocument(document) {
  const marker = "\n## Content\n\n";
  const index = document.indexOf(marker);
  return index === -1 ? document : document.slice(index + marker.length);
}

export function extractSummaryFromDocument(document) {
  const startMarker = "\n## Summary\n\n";
  const endMarker = "\n## Content\n\n";
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return "";
  return document.slice(start + startMarker.length, end).trim();
}

// ---- Main factory ----

export function createItemStore(getDirs) {
  function itemsDir() { return getDirs().itemsDir; }
  function tagsDir() { return getDirs().tagsDir; }
  function indexesDir() { return getDirs().indexesDir; }
  let rebuildTail = Promise.resolve();
  let operationTail = Promise.resolve();
  const diagnostics = [];
  const MAX_DIAGNOSTICS = 100;

  function withStoreLock(operation) {
    const next = operationTail.catch(() => {}).then(operation);
    operationTail = next.catch(() => {});
    return next;
  }

  function withRecoveredStoreLock(operation) {
    return withStoreLock(async () => {
      await recoverPendingCommits();
      return operation();
    });
  }

  // For callers that need to atomically inspect or replace the whole knowledge-base
  // directory (for example a staged bundle import). The operation must not call this
  // store's public read/write methods while it owns the lock.
  function runExclusive(operation) {
    if (typeof operation !== "function") throw new TypeError("runExclusive requires an operation.");
    return withRecoveredStoreLock(operation);
  }

  function recordDiagnostic(issue) {
    const existing = diagnostics.find((entry) => entry.id === issue.id && entry.error === issue.error);
    if (existing) {
      existing.observedAt = issue.observedAt;
      existing.count = (existing.count || 1) + 1;
      return existing;
    }
    diagnostics.push({ ...issue, count: 1 });
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
    return diagnostics.at(-1);
  }

  function validateItemId(id) {
    const value = String(id || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
      || /[. ]$/.test(value)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value)) {
      throw new Error("Invalid item id.");
    }
    return value;
  }

  async function recoverPendingCommits() {
    const root = path.join(itemsDir(), ".transactions");
    for (const name of await safeReaddir(root)) {
      const transaction = path.join(root, name);
      let manifest;
      try { manifest = JSON.parse(await fs.readFile(path.join(transaction, "manifest.json"), "utf8")); } catch { continue; }
      let id;
      try { id = validateItemId(manifest.id); } catch { continue; }
      const target = path.join(itemsDir(), id);
      const staged = path.join(transaction, "item");
      const previous = path.join(transaction, "previous");
      // A staged revision is complete before it can replace the live directory. Prefer it
      // during recovery; the former revision remains available until this point succeeds.
      if (!(await exists(target)) && await exists(staged)) await fs.rename(staged, target);
      if (!(await exists(target)) && await exists(previous)) await fs.rename(previous, target);
      if (await exists(target)) await fs.rm(transaction, { recursive: true, force: true });
    }
  }

  // ---- Item CRUD ----

  async function readNow(id) {
    id = validateItemId(id);
    const itemDir = path.join(itemsDir(), id);
    const metadata = JSON.parse(await fs.readFile(path.join(itemDir, "metadata.json"), "utf8"));
    const document = await fs.readFile(path.join(itemDir, "document.md"), "utf8");
    const processedPath = path.join(itemDir, "processed.md");
    const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
    const commentsPath = path.join(itemDir, "comments.jsonl");
    const comments = await readJsonLines(commentsPath);
    return { metadata, document, processedDocument, comments };
  }

  function read(id) {
    return withRecoveredStoreLock(async () => {
      return readNow(id);
    });
  }

  async function listNow(filters = {}) {
    const dirs = await safeReaddir(itemsDir());
    const items = [];

    for (const id of dirs) {
      if (id.startsWith(".")) continue;
      let metadata; let document; let processedDocument;
      try {
        validateItemId(id);
        const metadataPath = path.join(itemsDir(), id, "metadata.json");
        if (!(await exists(metadataPath))) continue;
        metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        document = await fs.readFile(path.join(itemsDir(), id, "document.md"), "utf8");
        const processedPath = path.join(itemsDir(), id, "processed.md");
        processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
      } catch (error) {
        const issue = recordDiagnostic({ id, error: error.message || String(error), observedAt: new Date().toISOString() });
        filters.onCorrupt?.(issue);
        continue;
      }
      const searchText = `${metadata.title} ${(metadata.tags || []).join(" ")} ${processedDocument} ${document}`.toLowerCase();

      // Filter hooks — callers can override via filter functions passed in options.
      if (filters.tag && !(metadata.tags || []).includes(filters.tag)) continue;
      if (filters.sourceType && metadata.sourceType !== filters.sourceType) continue;
      if (filters.integrityStatus && metadata.integrityStatus !== filters.integrityStatus) continue;
      if (filters.dateFrom && String(metadata.updatedAt || "") < String(filters.dateFrom)) continue;
      if (filters.dateTo && String(metadata.updatedAt || "") > String(filters.dateTo)) continue;
      if (filters.query && !searchText.includes(filters.query.toLowerCase())) continue;

      // Optional predicate filter — allows server.js to apply its own business-logic filters
      // (e.g. includeLists, includeInvalidTeamsRoot, updates-only).
      if (typeof filters.predicate === "function" && !filters.predicate(metadata, { processedDocument, searchText })) continue;

      items.push({
        ...metadata,
        hasProcessed: Boolean(processedDocument),
        excerpt: summarizeExcerpt(processedDocument || document)
      });
    }

    return items.sort((a, b) => {
      const updateState = Number(Boolean(b.contentUpdatedAt)) - Number(Boolean(a.contentUpdatedAt));
      if (updateState !== 0) return updateState;
      const updateTime = String(b.contentUpdatedAt || "").localeCompare(String(a.contentUpdatedAt || ""));
      if (updateTime !== 0) return updateTime;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  }

  function list(filters = {}) {
    return withRecoveredStoreLock(async () => {
      return listNow(filters);
    });
  }

  async function search(query) {
    if (!query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    let indexedItems = [];
    try {
      const payload = JSON.parse(await fs.readFile(path.join(indexesDir(), "search.json"), "utf8"));
      indexedItems = Array.isArray(payload.items) ? payload.items : [];
    } catch {}
    const allItems = indexedItems.length ? indexedItems : await list();

    return allItems
      .map((item) => {
        const haystack = item.searchText || `${item.title} ${item.excerpt} ${(item.tags || []).join(" ")}`.toLowerCase();
        const title = String(item.title || "").toLowerCase();
        const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 4 : 0) + (haystack.includes(term) ? 1 : 0), 0);
        return { item, score };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  async function deleteItem(id) {
    id = validateItemId(id);
    await withStoreLock(async () => {
      await recoverPendingCommits();
      const itemDir = path.join(itemsDir(), id);
      if (!(await exists(itemDir))) throw new Error("Item not found.");
      await fs.rm(itemDir, { recursive: true, force: true });
    });
    await rebuildIndexes();
  }

  // ---- Metadata mutation (low-level, no index rebuild) ----

  async function writeMetadata(id, metadata) {
    id = validateItemId(id);
    if (metadata?.id !== id) throw new Error("Metadata id must match item id.");
    if (metadata?.rawFileName !== undefined && !/^raw\.[a-z0-9._-]+$/i.test(String(metadata.rawFileName))) throw new Error("Invalid raw file name.");
    return withRecoveredStoreLock(async () => {
      const dir = path.join(itemsDir(), id);
      await fs.mkdir(dir, { recursive: true });
      await atomicWriteJson(path.join(dir, "metadata.json"), metadata);
    });
  }

  async function writeDocument(id, metadata, body, summary = "") {
    id = validateItemId(id);
    return withRecoveredStoreLock(async () => {
      const dir = path.join(itemsDir(), id);
      await fs.mkdir(dir, { recursive: true });
      await atomicWriteFile(path.join(dir, "document.md"), renderDocument(metadata, body, summary), "utf8");
    });
  }

  async function writeProcessedDocument(id, content) {
    id = validateItemId(id);
    return withRecoveredStoreLock(async () => {
      const dir = path.join(itemsDir(), id);
      await fs.mkdir(dir, { recursive: true });
      await atomicWriteFile(path.join(dir, "processed.md"), content, "utf8");
    });
  }

  async function writeComments(id, lines) {
    id = validateItemId(id);
    return withRecoveredStoreLock(async () => {
      const dir = path.join(itemsDir(), id);
      await fs.mkdir(dir, { recursive: true });
      const text = (lines || []).map((obj) => JSON.stringify(obj)).join("\n") + (lines.length ? "\n" : "");
      await atomicWriteFile(path.join(dir, "comments.jsonl"), text, "utf8");
    });
  }

  async function writeRawContent(id, content, contentType = "", fileName = "") {
    id = validateItemId(id);
    return withRecoveredStoreLock(async () => {
      const dir = path.join(itemsDir(), id);
      await fs.mkdir(dir, { recursive: true });
      const isHtml = /text\/html|application\/xhtml\+xml/.test(contentType);
      const safeName = /^raw\.[a-z0-9._-]+$/i.test(fileName) ? fileName : isHtml ? "raw.html" : "raw.txt";
      await atomicWriteFile(path.join(dir, safeName), content, "utf8");
      const metadataPath = path.join(dir, "metadata.json");
      if (await exists(metadataPath)) {
        const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        await atomicWriteJson(metadataPath, { ...metadata, rawFileName: safeName });
      }
      return safeName;
    });
  }

  async function commit(id, payload = {}) {
    id = validateItemId(id);
    return withStoreLock(async () => {
      await recoverPendingCommits();
      const root = path.join(itemsDir(), ".transactions");
      const transaction = path.join(root, `${id}-${crypto.randomUUID()}`);
      const staged = path.join(transaction, "item");
      const target = path.join(itemsDir(), id);
      await fs.mkdir(staged, { recursive: true });
      try {
      if (await exists(target)) await fs.cp(target, staged, { recursive: true, force: true });
      let metadata = payload.metadata === undefined ? undefined : { ...payload.metadata };
      if (metadata?.id !== undefined && metadata.id !== id) throw new Error("Metadata id must match item id.");
      if (metadata?.rawFileName !== undefined && !/^raw\.[a-z0-9._-]+$/i.test(String(metadata.rawFileName))) throw new Error("Invalid raw file name.");
      if (metadata !== undefined) await atomicWriteJson(path.join(staged, "metadata.json"), metadata);
      // Metadata is rendered into document.md, so a metadata-only commit must refresh
      // that header as well instead of leaving two visible revisions out of sync.
      if (payload.document !== undefined || payload.body !== undefined || payload.summary !== undefined || metadata !== undefined) {
        const nextMetadata = metadata === undefined ? JSON.parse(await fs.readFile(path.join(staged, "metadata.json"), "utf8")) : metadata;
        const existingDocument = await exists(path.join(staged, "document.md")) ? await fs.readFile(path.join(staged, "document.md"), "utf8") : "";
        const body = payload.body === undefined ? extractBodyFromDocument(existingDocument) : payload.body;
        const summary = payload.summary === undefined ? extractSummaryFromDocument(existingDocument) : payload.summary;
        await atomicWriteFile(path.join(staged, "document.md"), payload.document === undefined ? renderDocument(nextMetadata, body, summary) : payload.document, "utf8");
      }
      if (payload.processedDocument !== undefined) await atomicWriteFile(path.join(staged, "processed.md"), payload.processedDocument, "utf8");
      if (payload.comments !== undefined) await atomicWriteFile(path.join(staged, "comments.jsonl"), (payload.comments || []).map((line) => JSON.stringify(line)).join("\n") + (payload.comments?.length ? "\n" : ""), "utf8");
      if (payload.raw !== undefined) {
        const name = /^raw\.[a-z0-9._-]+$/i.test(payload.rawFileName || "") ? payload.rawFileName : /text\/html|application\/xhtml\+xml/.test(payload.rawContentType || "") ? "raw.html" : "raw.txt";
        await atomicWriteFile(path.join(staged, name), payload.raw, "utf8");
        metadata ||= JSON.parse(await fs.readFile(path.join(staged, "metadata.json"), "utf8"));
        metadata = { ...metadata, rawFileName: name };
        await atomicWriteJson(path.join(staged, "metadata.json"), metadata);
      }
      if (!(await exists(path.join(staged, "metadata.json"))) || !(await exists(path.join(staged, "document.md")))) throw new Error("A committed item requires metadata and document.");
      await atomicWriteJson(path.join(transaction, "manifest.json"), { id, createdAt: new Date().toISOString() });
      if (await exists(target)) await fs.rename(target, path.join(transaction, "previous"));
      await fs.rename(staged, target);
      await fs.rm(transaction, { recursive: true, force: true });
        return readNow(id);
      } catch (error) {
        await recoverPendingCommits().catch(() => {});
        throw error;
      }
    });
  }

  // ---- Item directory ----

  async function itemDir(id) {
    return path.join(itemsDir(), validateItemId(id));
  }

  // ---- Indexes ----

  async function rebuildIndexesNow() {
    await fs.mkdir(tagsDir(), { recursive: true });
    await fs.mkdir(indexesDir(), { recursive: true });

    const allItems = await listNow();
    const byTag = {};
    const bySource = {};
    const searchIndex = [];

    for (const item of allItems) {
      bySource[item.sourceType] ||= [];
      bySource[item.sourceType].push(item.id);

      for (const tag of item.tags || []) {
        byTag[tag] ||= [];
        byTag[tag].push(item.id);
      }
      searchIndex.push({
        id: item.id,
        title: item.title,
        sourceType: item.sourceType,
        tags: item.tags || [],
        url: item.url || "",
        updatedAt: item.updatedAt || "",
        contentUpdatedAt: item.contentUpdatedAt || "",
        integrityStatus: item.integrityStatus || "",
        searchText: `${item.title || ""} ${(item.tags || []).join(" ")} ${item.excerpt || ""}`.toLowerCase(),
        excerpt: item.excerpt || ""
      });
    }

    await Promise.all([
      atomicWriteJson(path.join(indexesDir(), "by-tag.json"), byTag),
      atomicWriteJson(path.join(indexesDir(), "by-source.json"), bySource),
      atomicWriteJson(path.join(indexesDir(), "by-updated.json"), allItems.map((item) => item.id)),
      atomicWriteJson(path.join(indexesDir(), "search.json"), { version: 1, generatedAt: new Date().toISOString(), items: searchIndex })
    ]);
    const stagedTags = `${tagsDir()}.staged-${crypto.randomUUID()}`;
    await fs.mkdir(stagedTags, { recursive: true });
    for (const [tag, ids] of Object.entries(byTag)) {
      await atomicWriteJson(path.join(stagedTags, `${slugify(tag)}.json`), { tag, items: ids });
    }
    await replaceDirectory(stagedTags, tagsDir());
  }

  function rebuildIndexes() {
    // Index construction reads every item, so it uses the same store lock as commits.
    // listNow deliberately avoids nesting that lock.
    const run = () => withRecoveredStoreLock(rebuildIndexesNow);
    const next = rebuildTail.then(run, run);
    rebuildTail = next.catch(() => {});
    return next;
  }

  // ---- Snapshots ----

  async function listSnapshots(id) {
    id = validateItemId(id);
    return withRecoveredStoreLock(async () => {
      const snapDir = path.join(itemsDir(), id, "snapshots");
      const files = await safeReaddir(snapDir);
      return files.sort().reverse();
    });
  }

  async function writeSnapshot(id, snapshotId, metadata, document) {
    id = validateItemId(id);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(snapshotId || ""))) throw new Error("Invalid snapshot id.");
    return withRecoveredStoreLock(async () => {
      const snapDir = path.join(itemsDir(), id, "snapshots", snapshotId);
      await fs.mkdir(snapDir, { recursive: true });
      await atomicWriteJson(path.join(snapDir, "metadata.json"), metadata);
      await atomicWriteFile(path.join(snapDir, "document.md"), document, "utf8");
    });
  }

  return {
    read,
    list,
    search,
    delete: deleteItem,
    writeMetadata,
    writeDocument,
    writeProcessedDocument,
    writeComments,
    writeRawContent,
    commit,
    writeSnapshot,
    listSnapshots,
    itemDir,
    rebuildIndexes,
    runExclusive,
    getDiagnostics: () => diagnostics.slice(),
    validateItemId,
    // Re-export utility for callers that need it directly
    exists
  };
}

// ---- Internal helpers ----

function summarizeExcerpt(text) {
  const clean = String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^# .*\n?/gm, "")
    .replace(/\n*## Metadata[\s\S]*?(?=\n##|\n#|$)/g, "")
    .trim();
  return clean.slice(0, 400).replace(/\n/g, " ");
}
