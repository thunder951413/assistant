import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeProcessingDelta, buildProcessingInput, newestMessagesWithin, normalizeAutoProcessSettings, shouldAutoProcess } from "../src/ai-processing.js";

const t = (minutes) => new Date(Date.UTC(2026, 9, 14, 0, minutes)).toISOString();
const teams = (count, { processedThroughMinute = null, stale = true, incremental = 0 } = {}) => ({
  metadata: {
    title: "BM Test", sourceType: "teams", url: "u", tags: [],
    processedAt: processedThroughMinute === null ? "" : t(processedThroughMinute),
    processedThroughAt: processedThroughMinute === null ? "" : t(processedThroughMinute),
    processedStale: stale, processedIncrementalCount: incremental
  },
  processedDocument: processedThroughMinute === null ? "" : "# x\n\n## AI Organized Content\n\nold summary",
  comments: Array.from({ length: count }, (_, i) => ({ id: String(i), author: "Ada", createdAt: t(i), body: `message ${i}` }))
});

describe("AI processing policy", () => {
  it("does not re-organize a chat for one new message, but does once enough accumulates", () => {
    const now = Date.parse(t(200));
    assert.equal(shouldAutoProcess(teams(51, { processedThroughMinute: 49 }), {}, now).process, false, "1 new message");
    assert.equal(shouldAutoProcess(teams(51, { processedThroughMinute: 49 }), {}, now).reason, "below-threshold");
    assert.equal(shouldAutoProcess(teams(80, { processedThroughMinute: 49 }), {}, now).reason, "messages");
    const longOne = teams(51, { processedThroughMinute: 49 });
    longOne.comments[50].body = "x".repeat(3500);
    assert.equal(shouldAutoProcess(longOne, {}, now).reason, "chars");
    const later = Date.parse(t(49)) + 8 * 86400000;
    assert.equal(shouldAutoProcess(teams(51, { processedThroughMinute: 49 }), {}, later).reason, "age");
  });

  it("honours the mode setting and always processes new or non-stream items", () => {
    assert.equal(shouldAutoProcess(teams(51, { processedThroughMinute: 49 }), { mode: "always" }).process, true);
    assert.equal(shouldAutoProcess(teams(51), { mode: "manual" }).process, false);
    assert.equal(shouldAutoProcess(teams(5), {}).reason, "first");
    const page = { metadata: { sourceType: "confluence", processedAt: t(1), processedStale: true }, processedDocument: "x", comments: [] };
    assert.equal(shouldAutoProcess(page, {}).reason, "changed");
    assert.equal(shouldAutoProcess({ ...page, metadata: { ...page.metadata, processedStale: false } }, {}).process, false);
    assert.deepEqual(normalizeAutoProcessSettings({ mode: "x", minNewMessages: "0" }).mode, "threshold");
  });

  it("sends only the new messages plus the organized version for an incremental update", () => {
    const item = teams(60, { processedThroughMinute: 49 });
    const input = buildProcessingInput(item, { processedBody: "old summary" });
    assert.equal(input.mode, "incremental");
    assert.match(input.user, /已有整理版：\nold summary/);
    assert.match(input.user, /新增 10 条消息/);
    assert.doesNotMatch(input.user, /message 49\b/);
    assert.match(input.user, /message 59/);
    assert.equal(input.processedThroughAt, t(59));
    assert.equal(analyzeProcessingDelta(item).newMessages, 10);
  });

  it("rebuilds fully every N increments and keeps the newest messages in a long chat", () => {
    assert.equal(buildProcessingInput(teams(60, { processedThroughMinute: 49, incremental: 7 }), { processedBody: "s" }).mode, "full");
    const long = teams(2000);
    long.comments.forEach((comment) => { comment.body = "y".repeat(100); });
    const input = buildProcessingInput(long, {});
    assert.equal(input.mode, "full");
    assert.match(input.user, /最近 \d+ 条/);
    assert.ok(input.user.includes(t(1999)), "the newest message is included");
    assert.ok(!input.user.includes(t(0)), "the oldest message is dropped first");
    const { kept, omitted } = newestMessagesWithin(long.comments, 1000);
    assert.equal(kept.at(-1).createdAt, t(1999));
    assert.equal(kept.length + omitted, 2000);
  });
});
