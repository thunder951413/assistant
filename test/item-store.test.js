import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createItemStore, renderDocument, extractBodyFromDocument, extractSummaryFromDocument } from "../src/item-store.js";

let tmpDirs = [];

async function makeTempStore() {
  const tmpDir = path.join(os.tmpdir(), `item-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  tmpDirs.push(tmpDir);
  const itemsDir = path.join(tmpDir, "items");
  const tagsDir = path.join(tmpDir, "tags");
  const indexesDir = path.join(tmpDir, "indexes");
  await fs.mkdir(itemsDir, { recursive: true });
  await fs.mkdir(tagsDir, { recursive: true });
  await fs.mkdir(indexesDir, { recursive: true });
  return createItemStore(() => ({ itemsDir, tagsDir, indexesDir }));
}

after(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("item-store", () => {
  it("writes and reads an item", async () => {
    const store = await makeTempStore();
    const id = "test-read-write";
    const metadata = { id, title: "Hello", sourceType: "text", url: null, tags: ["test"], createdAt: now(), updatedAt: now(), lastFetchedAt: null, sourceUpdatedAt: "" };

    await store.writeMetadata(id, metadata);
    await store.writeDocument(id, metadata, "body text", "a summary");
    await store.writeComments(id, [{ author: "a", body: "hello" }]);
    await store.writeRawContent(id, "<html>raw</html>", "text/html");

    const item = await store.read(id);
    assert.equal(item.metadata.title, "Hello");
    assert.ok(item.document.includes("body text"));
    assert.ok(item.document.includes("a summary"));
    assert.equal(item.comments.length, 1);
    assert.equal(item.comments[0].body, "hello");
    assert.equal(item.processedDocument, "");

    // raw content was written
    const itemDir = await store.itemDir(id);
    const rawPath = path.join(itemDir, "raw.html");
    const raw = await fs.readFile(rawPath, "utf8");
    assert.ok(raw.includes("raw"));
  });

  it("lists items with filters", async () => {
    const store = await makeTempStore();
    const t = now();

    for (const [i, sourceType, tag] of [
      [0, "jira", "backend"],
      [1, "jira", "frontend"],
      [2, "github", "backend"],
      [3, "confluence", "docs"]
    ]) {
      const id = `list-item-${i}`;
      const metadata = { id, title: `Item ${i}`, sourceType, url: null, tags: [tag], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" };
      await store.writeMetadata(id, metadata);
      await store.writeDocument(id, metadata, `content ${i}`, "");
    }

    const all = await store.list();
    assert.equal(all.length, 4);

    const byTag = await store.list({ tag: "backend" });
    assert.equal(byTag.length, 2);

    const bySource = await store.list({ sourceType: "github" });
    assert.equal(bySource.length, 1);
    assert.equal(bySource[0].title, "Item 2");

    const byQuery = await store.list({ query: "content 0" });
    assert.equal(byQuery.length, 1);
  });

  it("searches items by keyword", async () => {
    const store = await makeTempStore();
    const t = now();

    await store.writeMetadata("search-a", { id: "search-a", title: "Jira auth bug", sourceType: "jira", url: null, tags: ["auth"], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" });
    await store.writeDocument("search-a", { id: "search-a", title: "Jira auth bug", sourceType: "jira", url: null, tags: ["auth"], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" }, "Authentication fails on login page", "");
    await store.writeMetadata("search-b", { id: "search-b", title: "UI layout fix", sourceType: "github", url: null, tags: ["ui"], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" });
    await store.writeDocument("search-b", { id: "search-b", title: "UI layout fix", sourceType: "github", url: null, tags: ["ui"], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" }, "Fixed the sidebar overflow", "");

    const results = await store.search("auth");
    assert.equal(results.length, 1);
    assert.equal(results[0].item.title, "Jira auth bug");
  });

  it("deletes an item and removes it from listing", async () => {
    const store = await makeTempStore();
    const id = "to-delete";
    const t = now();
    const metadata = { id, title: "Gone", sourceType: "text", url: null, tags: [], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" };

    await store.writeMetadata(id, metadata);
    await store.writeDocument(id, metadata, "temp", "");

    const before = await store.list();
    assert.ok(before.some((item) => item.id === id));

    await store.delete(id);

    const after = await store.list();
    assert.ok(!after.some((item) => item.id === id));

    await assert.rejects(() => store.read(id));
  });

  it("rebuilds indexes from items", async () => {
    const store = await makeTempStore();
    const t = now();

    for (const [i, sourceType, tags] of [
      [0, "jira", ["bug", "backend"]],
      [1, "jira", ["bug"]],
      [2, "github", ["feature"]]
    ]) {
      const id = `idx-item-${i}`;
      const metadata = { id, title: `Idx ${i}`, sourceType, url: null, tags, createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" };
      await store.writeMetadata(id, metadata);
      await store.writeDocument(id, metadata, `content`, "");
    }

    await store.rebuildIndexes();

    // Rebuild writes to the store's indexes dir — use the first item's dir to derive it.
    const firstItemDir = await store.itemDir("idx-item-0");
    const idxDir = path.resolve(firstItemDir, "..", "..", "indexes");
    const byTag = JSON.parse(await fs.readFile(path.join(idxDir, "by-tag.json"), "utf8"));
    assert.equal(byTag.bug.length, 2);
    assert.equal(byTag.backend.length, 1);

    const bySource = JSON.parse(await fs.readFile(path.join(idxDir, "by-source.json"), "utf8"));
    assert.equal(bySource.jira.length, 2);
    assert.equal(bySource.github.length, 1);

    const byUpdated = JSON.parse(await fs.readFile(path.join(idxDir, "by-updated.json"), "utf8"));
    assert.equal(byUpdated.length, 3);
  });

  it("handles processed.md writes", async () => {
    const store = await makeTempStore();
    const id = "with-processed";
    const t = now();
    const metadata = { id, title: "P", sourceType: "text", url: null, tags: [], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" };

    await store.writeMetadata(id, metadata);
    await store.writeDocument(id, metadata, "original", "");
    await store.writeProcessedDocument(id, "# Processed\n\nAI output");

    const item = await store.read(id);
    assert.ok(item.processedDocument.includes("AI output"));
  });

  it("preserves an explicit raw API filename", async () => {
    const store = await makeTempStore();
    await store.writeRawContent("raw-json", "{\"ok\":true}", "application/json", "raw.json");
    assert.equal(await fs.readFile(path.join(await store.itemDir("raw-json"), "raw.json"), "utf8"), "{\"ok\":true}");
  });

  it("writes and reads snapshots", async () => {
    const store = await makeTempStore();
    const id = "with-snapshots";
    const t = now();
    const metadata = { id, title: "S", sourceType: "text", url: null, tags: [], createdAt: t, updatedAt: t, lastFetchedAt: null, sourceUpdatedAt: "" };

    await store.writeMetadata(id, metadata);
    await store.writeDocument(id, metadata, "v1", "");
    await store.writeSnapshot(id, "2025-01-01T00-00-00Z", metadata, "v1");

    const snapshots = await store.listSnapshots(id);
    assert.equal(snapshots.length, 1);

    const itemDir = await store.itemDir(id);
    const snapMeta = JSON.parse(await fs.readFile(path.join(itemDir, "snapshots", "2025-01-01T00-00-00Z", "metadata.json"), "utf8"));
    assert.equal(snapMeta.title, "S");
  });

  it("rejects invalid item ids", async () => {
    const store = await makeTempStore();
    await assert.rejects(() => store.read("../etc"));
    await assert.rejects(() => store.read("a/b"));
    await assert.rejects(() => store.read(""));
  });
});

describe("document formatting helpers", () => {
  it("renders a document with metadata, body, and summary", () => {
    const metadata = {
      id: "test-1",
      title: "My Document",
      sourceType: "jira",
      url: "https://example.com/issue-1",
      tags: ["bug", "backend"],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      lastFetchedAt: "2025-01-01T00:00:00Z",
      sourceUpdatedAt: "2025-01-01T00:00:00Z"
    };

    const doc = renderDocument(metadata, "The body text.", "A brief summary");

    assert.ok(doc.includes("# My Document"));
    assert.ok(doc.includes("Source: jira"));
    assert.ok(doc.includes("Tags: bug, backend"));
    assert.ok(doc.includes("The body text."));
    assert.ok(doc.includes("A brief summary"));
    assert.ok(doc.includes("## Summary"));
    assert.ok(doc.includes("## Content"));
  });

  it("renders document without summary section when summary is empty", () => {
    const metadata = {
      id: "test-2",
      title: "No Summary",
      sourceType: "text",
      url: null,
      tags: [],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      lastFetchedAt: null,
      sourceUpdatedAt: ""
    };

    const doc = renderDocument(metadata, "body", "");
    assert.ok(!doc.includes("## Summary"));
  });

  it("extracts body from document", () => {
    const doc = `# Title

## Metadata

- ID: x
- Source: text
- URL: local input
- Tags: none
- Created: 2025-01-01T00:00:00Z
- Updated: 2025-01-01T00:00:00Z
- Last fetched: not fetched
- Source updated: unknown

## Content

actual content here
`;

    assert.equal(extractBodyFromDocument(doc), "actual content here\n");
  });

  it("extracts summary from document", () => {
    const doc = `# Title

## Metadata

- ID: x
- Source: text
- URL: local input
- Tags: none
- Created: 2025-01-01T00:00:00Z
- Updated: 2025-01-01T00:00:00Z
- Last fetched: not fetched
- Source updated: unknown

## Summary

my summary text

## Content

body
`;

    assert.equal(extractSummaryFromDocument(doc), "my summary text");
  });

  it("returns empty string when no summary section exists", () => {
    const doc = `# Title\n\n## Content\n\nbody\n`;
    assert.equal(extractSummaryFromDocument(doc), "");
  });
});

function now() {
  return new Date().toISOString();
}
