import test from "node:test";
import assert from "node:assert/strict";
import { ALL_FAVORITES, appendSourceList, buildOverviewInput, buildRecentInput, collectStream, itemEvents, normalizeFavoriteTags, parseEventTime } from "../src/topics.js";

const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-15T00:00:00Z");

function item(id, { tags = ["bm-test"], source = "teams", comments = [], ...metadata } = {}) {
  return { metadata: { id, title: id, sourceType: source, tags, url: `https://x/${id}`, ...metadata }, comments, body: `${id} 原文`, processedBody: "" };
}

test("parses +0800 style offsets and normalizes favorite tags", () => {
  assert.equal(new Date(parseEventTime("2023-11-02T14:53:05+0800")).toISOString(), "2023-11-02T06:53:05.000Z");
  assert.deepEqual(normalizeFavoriteTags([" bm ", "bm", "", "t6d"]), ["bm", "t6d"]);
});

test("item events: messages plus a page update not explained by a comment", () => {
  const chat = item("chat", { comments: [{ id: "1", author: "A", createdAt: "2026-10-14T01:00:00Z", body: "hello" }] });
  assert.deepEqual(itemEvents(chat).map((event) => event.kind), ["message"]);
  const page = item("page", { source: "confluence", sourceUpdatedAt: "2026-10-13T00:00:00Z" });
  assert.deepEqual(itemEvents(page).map((event) => event.kind), ["update"]);
});

test("stream is newest first, filtered by window/tag, and marks unread messages", () => {
  const items = [
    item("a", { contentUpdatedAt: "2026-10-14T03:00:00Z", updateAcknowledgedAt: "2026-10-14T00:30:00Z", comments: [
      { id: "1", author: "A", createdAt: "2026-10-14T00:00:00Z", body: "old read" },
      { id: "2", author: "B", createdAt: "2026-10-14T02:00:00Z", body: "new one" }
    ] }),
    item("b", { tags: ["other"], comments: [{ id: "3", author: "C", createdAt: "2026-10-14T05:00:00Z", body: "elsewhere" }] }),
    item("c", { comments: [{ id: "4", author: "D", createdAt: "2026-09-01T00:00:00Z", body: "too old" }] }),
    item("list", { pageKind: "list", comments: [{ id: "5", author: "E", createdAt: "2026-10-14T06:00:00Z", body: "list" }] })
  ];
  const all = collectStream(items, { since: now - 7 * day });
  assert.deepEqual(all.events.map((event) => event.messageId), ["3", "2", "1"]);
  const tagged = collectStream(items, { since: now - 7 * day, tag: "bm-test" });
  assert.deepEqual(tagged.events.map((event) => [event.messageId, event.isNew]), [["2", true], ["1", false]]);
  const favorites = collectStream(items, { since: now - 7 * day, tag: ALL_FAVORITES, favoriteTags: ["other"] });
  assert.deepEqual(favorites.events.map((event) => event.messageId), ["3"]);
});

test("recent digest input only contains the window and cites items", () => {
  const items = [
    item("a", { comments: [
      { id: "1", author: "A", createdAt: "2026-10-14T00:00:00Z", body: "in window" },
      { id: "2", author: "A", createdAt: "2026-09-01T00:00:00Z", body: "before window" }
    ] }),
    item("quiet", { comments: [{ id: "3", author: "Q", createdAt: "2026-08-01T00:00:00Z", body: "old" }] })
  ];
  const input = buildRecentInput("bm-test", items, { since: now - 3 * day, until: now, days: 3 });
  assert.equal(input.refs.length, 1);
  assert.match(input.user, /in window/);
  assert.doesNotMatch(input.user, /before window/);
  assert.match(input.system, /最近 3 天/);
  assert.equal(buildRecentInput("x", [items[1]], { since: now - day, until: now, days: 1 }).user, "");
});

test("overview input prefers a current organized version and keeps Markdown lines", () => {
  const organized = { ...item("org"), processedBody: "## 结论\n- 第一点\n- 第二点" };
  const stale = { ...item("stale", { processedStale: true }), processedBody: "旧整理版" };
  const input = buildOverviewInput("bm-test", [organized, stale]);
  assert.match(input.user, /（整理版）\n## 结论\n- 第一点/);
  assert.match(input.user, /stale 原文/);
  assert.doesNotMatch(input.user, /旧整理版/);
  assert.match(appendSourceList("正文", input.refs), /## 出处\n\n- \[1\]/);
});

test("previews: newest meaningful message, new count only with a read mark, page excerpts skip preambles", async () => {
  const { latestMessagePreviews, pageExcerpt } = await import("../src/topics.js");
  const chat = item("chat", { contentUpdatedAt: "2026-10-14T05:00:00Z", updateAcknowledgedAt: "2026-10-14T01:30:00Z", comments: [
    { id: "1", author: "A", createdAt: "2026-10-14T01:00:00Z", body: "old" },
    { id: "2", author: "B", createdAt: "2026-10-14T02:00:00Z", body: "> quoted reply\n真正的回复" },
    { id: "3", author: "", createdAt: "2026-10-14T03:00:00Z", body: "[通话]" }
  ] });
  const neverRead = item("never", { contentUpdatedAt: "2026-10-14T05:00:00Z", comments: [{ id: "1", author: "A", createdAt: "2026-10-14T01:00:00Z", body: "hi" }] });
  const page = { ...item("page", { source: "confluence" }), body: "# page\n## Content\nSource: https://x\nSource updated: 2026\n正文第一句。" };
  const previews = latestMessagePreviews([chat, neverRead, page]);
  assert.deepEqual([previews.chat.author, previews.chat.text, previews.chat.newCount], ["B", "真正的回复", 2]);
  assert.equal(previews.never.newCount, null);
  assert.deepEqual([previews.page.kind, previews.page.text], ["page", "正文第一句。"]);
  assert.equal(pageExcerpt("###### 1.步骤\n![img](x.png) [链接](http://a)"), "1.步骤 链接");
});
