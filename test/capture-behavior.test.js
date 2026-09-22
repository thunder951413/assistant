import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeTeamsCommentsByIdentity, nextDueCaptureSlot, normalizeCaptureCompleteness, prepareListCapture, readResponseBodyLimited, shouldCloseOwnedWebdriverSession, withWebdriverSessionQueue } from "../src/capture-policy.js";

describe("capture behavior", () => {
  it("merges a partial Teams observation by stable message id without dropping old messages", () => {
    const merged = mergeTeamsCommentsByIdentity([
      { id: "a", author: "A", createdAt: "2026-01-01T00:00:00Z", body: "old" },
      { id: "b", author: "B", createdAt: "2026-01-01T00:01:00Z", body: "before edit" }
    ], [
      { id: "b", author: "B", createdAt: "2026-01-01T00:01:00Z", body: "edited" },
      { id: "c", author: "C", createdAt: "2026-01-01T00:02:00Z", body: "new" }
    ]);
    assert.deepEqual(merged.map(({ id, body }) => [id, body]), [["a", "old"], ["b", "edited"], ["c", "new"]]);
  });

  it("does not treat a visible-row ordinal as a stable Teams identity", () => {
    const merged = mergeTeamsCommentsByIdentity(
      [{ id: "teams-visible-1", author: "A", createdAt: "2026-01-01T00:00:00Z", body: "first" }],
      [{ id: "teams-visible-1", author: "B", createdAt: "2026-01-01T00:01:00Z", body: "second" }]
    );
    assert.equal(merged.length, 2);
  });

  it("treats a numeric Teams platform id as stable so an edit replaces its message", () => {
    const merged = mergeTeamsCommentsByIdentity(
      [{ id: "1742911200000", author: "A", createdAt: "2026-01-01T00:00:00Z", body: "draft" }],
      [{ id: "1742911200000", author: "A", createdAt: "2026-01-01T00:00:00Z", body: "edited" }]
    );
    assert.deepEqual(merged.map(({ id, body }) => [id, body]), [["1742911200000", "edited"]]);
  });

  it("keeps cancellation and byte limits active while reading a response body", async () => {
    const tooLarge = new Response("12345");
    await assert.rejects(readResponseBodyLimited(tooLarge, 4), /too large/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(readResponseBodyLimited(new Response("ok"), 10, controller.signal), /Capture canceled/);
    const slowAbort = new AbortController();
    let canceled = false;
    const delayed = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("first"));
        setTimeout(() => { if (!canceled) stream.enqueue(new TextEncoder().encode("second")); }, 15);
        setTimeout(() => { if (!canceled) stream.close(); }, 20);
      },
      cancel() { canceled = true; }
    });
    setTimeout(() => slowAbort.abort(), 5);
    await assert.rejects(readResponseBodyLimited(new Response(delayed), 20, slowAbort.signal), /Capture canceled/);
  });

  it("feeds structured API entries into the list refresh workset and propagates truncation", () => {
    const prepared = prepareListCapture({
      entries: [
        { href: "https://example.test/issues/1", title: "One" },
        { href: "https://example.test/issues/2", title: "Two" },
        { href: "https://example.test/issues/3", title: "Three" }
      ],
      completeness: "complete",
      coverage: { pageCount: 2, nextCursor: "cursor-3" }
    }, 2, () => { throw new Error("HTML fallback must not be used for API entries"); });
    assert.deepEqual(prepared.links.map((entry) => entry.href), ["https://example.test/issues/1", "https://example.test/issues/2"]);
    assert.equal(prepared.completeness, "partial");
    assert.deepEqual(prepared.coverage, { pageCount: 2, nextCursor: "cursor-3", observedCount: 3, processedCount: 2, maxItems: 2, truncatedByLimit: true });
  });

  it("schedules a cross-midnight window from yesterday's start", () => {
    const now = new Date(2026, 0, 2, 1, 30);
    const due = nextDueCaptureSlot(
      { intervalMinutes: 60 },
      now,
      { startTime: "22:00", endTime: "02:00" }
    );
    assert.equal(due?.getTime(), new Date(2026, 0, 2, 1, 0).getTime());
    assert.equal(nextDueCaptureSlot({ intervalMinutes: 60, lastRunAt: due.toISOString() }, now, { startTime: "22:00", endTime: "02:00" }), null);
  });

  it("serializes competing operations on one webdriver session", async () => {
    const session = {};
    const order = [];
    const first = withWebdriverSessionQueue(session, async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first:end");
    });
    const second = withWebdriverSessionQueue(session, async () => { order.push("second"); });
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
  });

  it("closes a temporary webdriver session only after its queued users finish", () => {
    const session = { autoClose: true, closeWhenIdle: true, activeOperations: 1 };
    assert.equal(shouldCloseOwnedWebdriverSession(session, true), false);
    session.activeOperations = 0;
    assert.equal(shouldCloseOwnedWebdriverSession(session, false), true);
    assert.equal(shouldCloseOwnedWebdriverSession({ autoClose: false, closeWhenIdle: true, activeOperations: 0 }, true), false);
  });

  it("uses explicit completeness and keeps missing Teams comments partial", () => {
    assert.equal(normalizeCaptureCompleteness("PARTIAL"), "partial");
    assert.equal(normalizeCaptureCompleteness("anything"), "unknown");
    assert.equal(normalizeCaptureCompleteness(undefined, "partial"), "partial");
  });
});
