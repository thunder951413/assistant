import test from "node:test";
import assert from "node:assert/strict";
import { itemExportMarkdown, safeFileName, topicDigestExportMarkdown } from "../src/markdown-export.js";
import { ALL_FAVORITES, appendSourceList } from "../src/topics.js";
import { sendTextDownload } from "../src/http-utils.js";

const now = new Date("2026-10-15T07:00:00Z");

test("item export keeps the organized body and adds source facts", () => {
  const processedDocument = "# 标题\n\n## Metadata\n\n- ID: x\n\n## AI Organized Content\n\n```markdown\n# AGC 调整\n\n## 结论\n\n根因未明确。\n```\n";
  const { filename, content } = itemExportMarkdown({ metadata: { title: "AGC: 调整/记录", url: "https://teams/x", sourceType: "teams", tags: ["bm", "t6d"], processedAt: "2026-10-14T11:29:41Z", processedStale: true }, processedDocument }, { now });
  assert.match(filename, /^AGC 调整 记录-整理-\d{8}\.md$/);
  assert.ok(content.startsWith("# AGC 调整\n\n## 结论\n\n根因未明确。"));
  assert.ok(!content.includes("## Metadata"));
  assert.match(content, /- 原文：https:\/\/teams\/x/);
  assert.match(content, /- 标签：bm、t6d/);
  assert.match(content, /整理版可能不是最新/);
});

test("item export adds a title when the body has none, and refuses unprocessed items", () => {
  const { content } = itemExportMarkdown({ metadata: { title: "无标题正文" }, processedDocument: "## AI Organized Content\n\n正文" }, { now });
  assert.ok(content.startsWith("# 无标题正文\n\n正文"));
  assert.throws(() => itemExportMarkdown({ metadata: { title: "x" }, processedDocument: "" }), (error) => error.statusCode === 404);
});

test("topic digest export links citations but leaves the source list alone", () => {
  const refs = [{ index: 1, title: "A", url: "https://a" }, { index: 2, title: "B", url: "" }];
  const text = appendSourceList("现状见 [1]，另见 [2]。合并 [1][2]。[说明][1]\n\n[1]: https://kept", refs);
  const digest = { overview: { text, generatedAt: "2026-10-15T01:00:00Z", itemCount: 2, refs }, recent: {} };
  const { filename, content } = topicDigestExportMarkdown("bm", digest, { now });
  assert.match(filename, /^bm-总览-\d{8}\.md$/);
  assert.ok(content.startsWith("# bm：总览\n\n> 生成于"));
  assert.match(content, /现状见 \[\[1\]\]\(https:\/\/a\)，另见 \[2\]。/);
  assert.match(content, /合并 \[\[1\]\]\(https:\/\/a\)\[2\]。\[说明\]\[1\]\n\n\[1\]: https:\/\/kept/);
  assert.match(content, /\n- \[1\] A — https:\/\/a\n/);
  assert.throws(() => topicDigestExportMarkdown("bm", digest, { mode: "recent", days: 7 }), /最近 7 天/);
  const recent = topicDigestExportMarkdown(ALL_FAVORITES, { recent: { 3: { text: "无更新", generatedAt: "2026-10-15T01:00:00Z", since: "2026-10-12T01:00:00Z", itemCount: 0, refs: [] } } }, { mode: "recent", days: 3, now });
  assert.match(recent.filename, /^全部关注-最近3天-/);
  assert.match(recent.content, /^# 全部关注：最近 3 天的更新/);
});

test("download headers carry a UTF-8 file name with an ASCII fallback", () => {
  const headers = {};
  let body = "";
  sendTextDownload({ writeHead: (status, value) => Object.assign(headers, value, { status }), end: (value) => { body = value; } }, "专题 总览.md", "# x");
  assert.equal(headers.status, 200);
  assert.match(headers["Content-Disposition"], /filename="_ _\.md"; filename\*=UTF-8''%E4%B8%93/);
  assert.equal(body, "# x");
  assert.equal(safeFileName('  ..a/b:c*?"<>|  '), "a b c");
});
