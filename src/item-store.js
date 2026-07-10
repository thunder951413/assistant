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
import { slugify } from "./utils.js";

// ---- Path helpers ----

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

  // ---- Item CRUD ----

  async function read(id) {
    if (!id || id.includes("..") || id.includes("/")) {
      throw new Error("Invalid item id.");
    }

    const itemDir = path.join(itemsDir(), id);
    const metadata = JSON.parse(await fs.readFile(path.join(itemDir, "metadata.json"), "utf8"));
    const document = await fs.readFile(path.join(itemDir, "document.md"), "utf8");
    const processedPath = path.join(itemDir, "processed.md");
    const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
    const commentsPath = path.join(itemDir, "comments.jsonl");
    const comments = await readJsonLines(commentsPath);
    return { metadata, document, processedDocument, comments };
  }

  async function list(filters = {}) {
    const dirs = await safeReaddir(itemsDir());
    const items = [];

    for (const id of dirs) {
      const metadataPath = path.join(itemsDir(), id, "metadata.json");
      if (!(await exists(metadataPath))) continue;
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      const document = await fs.readFile(path.join(itemsDir(), id, "document.md"), "utf8");
      const processedPath = path.join(itemsDir(), id, "processed.md");
      const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
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
    if (!id || id.includes("..") || id.includes("/")) {
      throw new Error("Invalid item id.");
    }

    const itemDir = path.join(itemsDir(), id);
    if (!(await exists(itemDir))) {
      throw new Error("Item not found.");
    }

    await fs.rm(itemDir, { recursive: true, force: true });
    await rebuildIndexes();
  }

  // ---- Metadata mutation (low-level, no index rebuild) ----

  async function writeMetadata(id, metadata) {
    const dir = path.join(itemsDir(), id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8"
    );
  }

  async function writeDocument(id, metadata, body, summary = "") {
    const dir = path.join(itemsDir(), id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "document.md"),
      renderDocument(metadata, body, summary),
      "utf8"
    );
  }

  async function writeProcessedDocument(id, content) {
    const dir = path.join(itemsDir(), id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "processed.md"), content, "utf8");
  }

  async function writeComments(id, lines) {
    const dir = path.join(itemsDir(), id);
    await fs.mkdir(dir, { recursive: true });
    const text = (lines || []).map((obj) => JSON.stringify(obj)).join("\n") + (lines.length ? "\n" : "");
    await fs.writeFile(path.join(dir, "comments.jsonl"), text, "utf8");
  }

  async function writeRawContent(id, content, contentType = "", fileName = "") {
    const dir = path.join(itemsDir(), id);
    await fs.mkdir(dir, { recursive: true });
    const isHtml = /text\/html|application\/xhtml\+xml/.test(contentType);
    const safeName = /^raw\.[a-z0-9._-]+$/i.test(fileName) ? fileName : isHtml ? "raw.html" : "raw.txt";
    await fs.writeFile(path.join(dir, safeName), content, "utf8");
  }

  // ---- Item directory ----

  async function itemDir(id) {
    return path.join(itemsDir(), id);
  }

  // ---- Indexes ----

  async function rebuildIndexes() {
    await fs.mkdir(tagsDir(), { recursive: true });
    await fs.mkdir(indexesDir(), { recursive: true });

    const allItems = await list();
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

    await fs.writeFile(path.join(indexesDir(), "by-tag.json"), `${JSON.stringify(byTag, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(indexesDir(), "by-source.json"), `${JSON.stringify(bySource, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(indexesDir(), "by-updated.json"), `${JSON.stringify(allItems.map((item) => item.id), null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(indexesDir(), "search.json"), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), items: searchIndex }, null, 2)}\n`, "utf8");

    const existingTagFiles = await safeReaddir(tagsDir());
    for (const file of existingTagFiles) {
      if (file.endsWith(".json")) await fs.unlink(path.join(tagsDir(), file));
    }
    for (const [tag, ids] of Object.entries(byTag)) {
      await fs.writeFile(path.join(tagsDir(), `${slugify(tag)}.json`), `${JSON.stringify({ tag, items: ids }, null, 2)}\n`, "utf8");
    }
  }

  // ---- Snapshots ----

  async function listSnapshots(id) {
    const snapDir = path.join(itemsDir(), id, "snapshots");
    const files = await safeReaddir(snapDir);
    return files.sort().reverse();
  }

  async function writeSnapshot(id, snapshotId, metadata, document) {
    const snapDir = path.join(itemsDir(), id, "snapshots", snapshotId);
    await fs.mkdir(snapDir, { recursive: true });
    await fs.writeFile(path.join(snapDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(snapDir, "document.md"), document, "utf8");
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
    writeSnapshot,
    listSnapshots,
    itemDir,
    rebuildIndexes,
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
