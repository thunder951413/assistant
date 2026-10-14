#!/usr/bin/env node
// One-off cleanup of Teams messages captured by older extractor versions.
//
//   node scripts/migrate-teams-comments.js            # dry run: report only
//   node scripts/migrate-teams-comments.js --apply    # write changes (snapshot first)
//
// Older captures stored a whole message row as the body
//   "<preview>… by <Author> <Author> 7/29/2025 10:21 AM Translate <body>"
// under the generic id "chat-pane-item", recorded date dividers ("Friday, June 12")
// as messages, and stored system messages without a time. This script
//   1. drops date-divider rows,
//   2. drops legacy rows that duplicate a message stored under its real Teams id,
//   3. restores the real body of the remaining legacy rows,
//   4. fills missing times from Teams message ids (epoch milliseconds).
// Messages with a real Teams id are never removed.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createItemStore } from "../src/item-store.js";
import { normalizeTeamsBody, teamsTimeFromMessageId, mergeTeamsCommentsByIdentity } from "../src/capture-policy.js";
import { renderTeamsTextFromComments } from "../src/sources/teams-page.js";
import { writeItemSnapshot } from "../src/storage-maintenance.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const kbArg = process.argv.indexOf("--kb");
const kbDir = path.resolve(kbArg >= 0 ? process.argv[kbArg + 1] : process.env.ASSISTANT_DOCUMENT_ROOT || path.join(root, "knowledge-base"));
const itemsDir = path.join(kbDir, "items");
const store = createItemStore(() => ({ itemsDir, tagsDir: path.join(kbDir, "tags"), indexesDir: path.join(kbDir, "indexes") }));

const STABLE_ID = /^(?:message-body-)?\d{13}$/;
const WEEKDAY = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const DATE_DIVIDER = new RegExp(`^(?:(?:${WEEKDAY})|(?:(?:${WEEKDAY}),? )?(?:(?:January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}(?:, \\d{4})?)|Today|Yesterday|昨天|今天|\\d{4}年\\d{1,2}月\\d{1,2}日.*|\\d{1,2}月\\d{1,2}日.*|星期.)$`, "i");
// Row header time as Teams printed it: "7/29/2025 10:21 AM", "6/8 10:08 AM",
// "Wednesday 3:00 PM", "Yesterday 9:12 AM" or just "3:00 PM".
const ROW_TIME = String.raw`(?:\d{1,2}/\d{1,2}(?:/\d{2,4})?,? |(?:${WEEKDAY}|Yesterday|Today|昨天|今天) )?\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|上午|下午)?`;
const collapse = (value) => String(value || "").replace(/\s+/g, " ").trim();
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function restoreLegacyBody(comment) {
  const body = String(comment.body || "");
  const author = collapse(comment.author);
  if (!author) return body;
  const name = escapeRe(author);
  // Row header variants written by older extractors:
  //   "<preview> by A A <time> [Edited] [Translate] <body>"           (others)
  //   "<preview> by A <time> [Edited] A <body>"                       (own messages)
  //   "<preview> by A, has an attachment. A <time> … <body/filename>" (attachments)
  const header = new RegExp(`^([\\s\\S]*?) by ${name}(?:, has (?:an )?attachments?\\.)? (?:${name} )?${ROW_TIME}(?: Edited)?(?: ${name})?(?: Edited)?(?: Translate)?(?: ([\\s\\S]+))?$`);
  const match = body.match(header);
  if (!match) return body;
  const restored = (match[2] || "").trim();
  if (restored) return restored;
  const preview = match[1].trim();
  return preview && preview !== "Message" ? `[${preview}]` : "[附件]";
}

export function migrateComments(comments) {
  const stats = { before: comments.length, dividers: 0, duplicates: 0, restored: 0, timesFilled: 0 };
  const stable = comments.filter((c) => STABLE_ID.test(String(c.id || "")));
  const stableKeys = new Set(stable.filter((c) => c.author && c.createdAt).map((c) => `${collapse(c.author)}\n${c.createdAt}`));
  const stableBodies = new Set(stable.map((c) => collapse(c.body)));
  const kept = [];
  for (const original of comments) {
    const comment = { ...original };
    const legacy = !STABLE_ID.test(String(comment.id || ""));
    if (legacy && !comment.author && DATE_DIVIDER.test(collapse(comment.body))) { stats.dividers += 1; continue; }
    if (legacy && comment.createdAt && stableKeys.has(`${collapse(comment.author)}\n${comment.createdAt}`)) { stats.duplicates += 1; continue; }
    if (legacy) {
      const restored = restoreLegacyBody(comment);
      if (restored !== comment.body) { comment.body = restored; stats.restored += 1; }
      if (!comment.author && stableBodies.has(collapse(comment.body))) { stats.duplicates += 1; continue; }
      // A row the old extractor stored twice (system notices repeated inside one row).
    }
    if (!comment.createdAt) {
      const derived = teamsTimeFromMessageId(comment.id);
      if (derived) { comment.createdAt = derived; stats.timesFilled += 1; }
    }
    comment.body = normalizeTeamsBody(comment.body);
    kept.push(comment);
  }
  // Re-run the identity merge so restored legacy rows that now equal each other collapse.
  const merged = mergeTeamsCommentsByIdentity([], kept);
  stats.duplicates += kept.length - merged.length;
  stats.after = merged.length;
  return { comments: merged, stats };
}

async function main() {
  const total = { items: 0, changed: 0, before: 0, after: 0, dividers: 0, duplicates: 0, restored: 0, timesFilled: 0 };
  for (const entry of await store.readAll()) {
    const { metadata } = entry;
    if (metadata.sourceType !== "teams" || !entry.comments.length) continue;
    total.items += 1;
    const { comments, stats } = migrateComments(entry.comments);
    for (const key of ["before", "after", "dividers", "duplicates", "restored", "timesFilled"]) total[key] += stats[key];
    const changed = JSON.stringify(comments) !== JSON.stringify(entry.comments);
    console.log(`${changed ? "*" : " "} ${metadata.title.slice(0, 40).padEnd(40)} ${String(stats.before).padStart(4)} -> ${String(stats.after).padStart(4)}  dividers ${stats.dividers}, duplicates ${stats.duplicates}, restored ${stats.restored}, times ${stats.timesFilled}`);
    if (!changed) continue;
    total.changed += 1;
    if (!apply) continue;
    const itemDir = path.join(itemsDir, metadata.id);
    await writeItemSnapshot(itemDir, metadata, new Date().toISOString());
    const adapterId = entry.document.match(/^Adapter: (.+)$/m)?.[1] || "teams";
    const body = renderTeamsTextFromComments(metadata.title, metadata.url, { id: adapterId }, comments);
    const hasProcessed = Boolean(entry.processedDocument);
    await store.commit(metadata.id, {
      metadata: { ...metadata, updatedAt: new Date().toISOString(), ...(hasProcessed ? { processedStale: true } : {}), migratedAt: new Date().toISOString(), migration: "teams-comments-v1" },
      body,
      comments,
      raw: body,
      rawFileName: metadata.rawFileName || "raw.txt"
    });
  }
  console.log(`\n${apply ? "Applied" : "Dry run"}: ${total.changed}/${total.items} Teams items change; messages ${total.before} -> ${total.after} (dividers ${total.dividers}, duplicates ${total.duplicates}, restored bodies ${total.restored}, times filled ${total.timesFilled}).`);
  if (apply && total.changed) {
    await store.rebuildIndexes();
    console.log("Snapshots of the previous versions were saved under each item's snapshots/ folder. Restart the service to reload.");
  } else if (!apply && total.changed) {
    console.log("Run again with --apply to write these changes (stop the service first: npm run service:stop).");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
