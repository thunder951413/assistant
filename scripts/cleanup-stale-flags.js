#!/usr/bin/env node
// One-off cleanup: clear stuck `processedStale` / `pendingContentUpdatedAt` flags
// that the Teams "new content" bug left behind on items the user already acknowledged.
//
// Background: src/server.js used to retain `processedStale` across refresh runs even
// when no real update was detected, so every batch refresh re-triggered AI processing
// and re-raised the NEW badge. The fix stops the stickiness; this script clears the
// residue already written to disk.
//
// Safety: only touches metadata flags, never document.md / comments.jsonl / raw files.
// Clears an item when it looks like an acknowledged-but-stuck state. After a user
// acknowledges an update (acknowledgeItemUpdate), both contentUpdatedAt and
// pendingContentUpdatedAt should be empty, and processedStale should be false.
// The old stickiness bug left these flags set, so every batch refresh re-selected
// the item for AI processing and re-raised the NEW badge. Conditions (independent,
// all require updateAcknowledgedAt to be set so we never touch unacknowledged updates):
//   - processedStale=true            -> clear to false
//   - pendingContentUpdatedAt set    -> clear to ""  (regardless of contentUpdatedAt,
//     since acknowledgeItemUpdate clears contentUpdatedAt but not pending)
//
// Usage:
//   node scripts/cleanup-stale-flags.js          # dry-run, prints what would change
//   node scripts/cleanup-stale-flags.js --apply  # actually write metadata.json

import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const itemsDir = path.join(root, "knowledge-base", "items");
const apply = process.argv.includes("--apply");

function shouldClean(metadata) {
  if (!metadata.updateAcknowledgedAt) return null;
  const patch = {};
  if (metadata.processedStale) patch.processedStale = false;
  if (metadata.pendingContentUpdatedAt) patch.pendingContentUpdatedAt = "";
  return Object.keys(patch).length ? patch : null;
}

async function main() {
  const dirs = await fs.readdir(itemsDir);
  const changes = [];
  for (const id of dirs) {
    const metaPath = path.join(itemsDir, id, "metadata.json");
    let raw;
    try {
      raw = await fs.readFile(metaPath, "utf8");
    } catch {
      continue;
    }
    const metadata = JSON.parse(raw);
    const patch = shouldClean(metadata);
    if (!patch) continue;
    const next = { ...metadata, ...patch };
    changes.push({ id, patch, before: {
      processedStale: metadata.processedStale,
      pendingContentUpdatedAt: metadata.pendingContentUpdatedAt,
      contentUpdatedAt: metadata.contentUpdatedAt,
      updateAcknowledgedAt: metadata.updateAcknowledgedAt
    } });
    if (apply) {
      await fs.writeFile(metaPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
  }

  if (!changes.length) {
    console.log(apply ? "No stuck flags found; nothing changed." : "No stuck flags found.");
    return;
  }
  for (const { id, patch, before } of changes) {
    console.log(`${apply ? "cleaned" : "would clean"} ${id}`);
    console.log(`  before: ${JSON.stringify(before)}`);
    console.log(`  patch:  ${JSON.stringify(patch)}`);
  }
  console.log(`\n${changes.length} item(s) ${apply ? "updated" : "would be updated"}.`);
  if (!apply) console.log("Run with --apply to write changes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
