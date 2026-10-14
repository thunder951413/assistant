import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { collectVirtualTeamsMessages, extractTeamsMessagesFromDocument, mergeTeamsCaptureMessages, mergeTeamsCommentsByIdentity, teamsTimeFromMessageId } from "../src/capture-policy.js";

describe("Teams capture extraction", () => {
  it("extracts short messages and never promotes data-tid to a stable id", () => {
    const dom = new JSDOM(`<!doctype html><title>Room</title>
      <div data-tid="chat-pane-message"><span data-tid="message-author">Ada</span><time datetime="2026-09-22T01:00:00Z"></time><div data-tid="messageBodyContent">ok</div></div>
      <div data-tid="chat-pane-message"><span data-tid="message-author">Ben</span><time datetime="2026-09-22T01:01:00Z"></time><div data-tid="messageBodyContent">yo</div></div>`);
    const extracted = extractTeamsMessagesFromDocument(dom.window.document);
    assert.equal(extracted.messages.length, 2);
    assert.deepEqual(extracted.messages.map((message) => [message.id, message.body]), [["", "ok"], ["", "yo"]]);
  });

  it("works when serialized into a page evaluate call with no document argument", () => {
    const dom = new JSDOM(`<!doctype html><div data-mid="m1" data-tid="chat-pane-message">Hello</div>`);
    const previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      assert.equal(extractTeamsMessagesFromDocument().messages[0].body, "Hello");
    } finally {
      globalThis.document = previous;
    }
  });

  it("combines Teams outer author/time with its nested stable body id", () => {
    const dom = new JSDOM(`<!doctype html><div data-tid="chat-pane-item">
      <div data-tid="chat-pane-item" class="avatar">avatar</div>
      <span data-tid="message-author-name" id="author-1789523191319">Roku</span>
      <time id="timestamp-1789523191319" datetime="2026-09-22T01:02:03Z"></time>
      <div data-mid="1789523191319" data-tid="chat-pane-message" id="message-body-1789523191319" role="group">Announcement</div>
    </div>`);
    const [message] = extractTeamsMessagesFromDocument(dom.window.document).messages;
    assert.deepEqual({ id: message.id, author: message.author, createdAt: message.createdAt, body: message.body }, {
      id: "1789523191319", author: "Roku", createdAt: "2026-09-22T01:02:03Z", body: "Announcement"
    });
  });

  it("retains attachment-only and system messages", () => {
    const dom = new JSDOM(`<!doctype html>
      <div data-tid="chat-pane-item"><span data-tid="message-author-name">Roku</span><div data-mid="img-1" data-tid="chat-pane-message"><img alt="Architecture diagram"></div></div>
      <div data-tid="control-message-renderer"><div data-mid="system-1">Roku added Taylor to the chat</div></div>`);
    const messages = extractTeamsMessagesFromDocument(dom.window.document).messages;
    assert.deepEqual(messages.map((message) => message.body), ["[Architecture diagram]", "Roku added Taylor to the chat"]);
  });

  it("uses stable message nodes only when Teams also renders avatar and quote containers", () => {
    const dom = new JSDOM(`<!doctype html><div data-tid="chat-pane-item">
      <div data-tid="chat-pane-item">avatar</div><div class="quote">quoted text</div>
      <span data-tid="message-author-name">Roku</span><time datetime="2026-09-22T01:00:00Z"></time>
      <div data-mid="actual-1" data-tid="chat-pane-message">actual text</div>
    </div><div data-tid="control-message-renderer"><div data-mid="system-1">system notice</div></div>`);
    const messages = extractTeamsMessagesFromDocument(dom.window.document).messages;
    assert.deepEqual(messages.map((message) => [message.id, message.body]), [["actual-1", "actual text"], ["system-1", "system notice"]]);
  });

  it("keeps messages with a shared short prefix distinct", () => {
    const prefix = "x".repeat(300);
    const messages = mergeTeamsCaptureMessages([
      { author: "Ada", createdAt: "2026-09-22T01:00:00Z", body: `${prefix} first` },
      { author: "Ada", createdAt: "2026-09-22T01:00:00Z", body: `${prefix} second` }
    ]);
    assert.equal(messages.length, 2);
  });

  it("treats historic generic Teams DOM ids as content identity, preserving distinct messages", () => {
    const messages = mergeTeamsCaptureMessages([
      { id: "chat-pane-item", author: "Ada", createdAt: "2026-09-22T01:00:00Z", body: "first" },
      { id: "chat-pane-item", author: "Ada", createdAt: "2026-09-22T01:00:00Z", body: "second" }
    ]);
    assert.equal(messages.length, 2);
  });

  it("merges old message-body ids with current data-mid ids", () => {
    const messages = mergeTeamsCaptureMessages([
      { id: "message-body-1789523191319", author: "Roku", createdAt: "2026-09-22T01:00:00Z", body: "old rendering" },
      { id: "1789523191319", author: "Roku", createdAt: "2026-09-22T01:00:00Z", body: "current rendering" }
    ]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].body, "current rendering");
  });

  it("collects a virtualized history until stable identity overlaps prior evidence", async () => {
    const windows = [
      [{ id: "new", body: "new", createdAt: "2026-09-22T03:00:00Z" }],
      [{ id: "mid", body: "middle", createdAt: "2026-09-22T02:00:00Z" }],
      [{ id: "old", body: "old", createdAt: "2026-09-22T01:00:00Z" }]
    ];
    let index = 0;
    const result = await collectVirtualTeamsMessages({
      maxScrolls: 8,
      previousMessages: [{ id: "old", body: "old", createdAt: "2026-09-22T01:00:00Z" }],
      readVisible: async () => ({ messages: windows[index] }),
      scrollOlder: async () => { index = Math.min(index + 1, windows.length - 1); return index < windows.length - 1; }
    });
    assert.deepEqual(result.messages.map((message) => message.id), ["old", "mid", "new"]);
    assert.equal(result.completeness, "partial");
    assert.equal(result.coverage.stoppedBy, "previous-overlap");
  });

  it("stops before another scroll when canceled", async () => {
    const controller = new AbortController();
    let scrolls = 0;
    await assert.rejects(collectVirtualTeamsMessages({
      readVisible: async () => ({ messages: [{ id: "one", body: "one" }] }),
      scrollOlder: async () => { scrolls += 1; controller.abort(); return true; },
      signal: controller.signal
    }), /Teams capture canceled/);
    assert.equal(scrolls, 1);
  });

  it("keeps line breaks of logs and steps, and reads only the message content node", () => {
    const dom = new JSDOM(`<!doctype html><div data-tid="chat-pane-item"><span data-tid="message-author-name">Jing</span><time datetime="2026-06-18T11:26:00Z"></time>
      <div data-mid="1781781960000" data-tid="chat-pane-message"><div id="content-1781781960000" data-message-content="">step 1: make\n06-18 19:11:19 dmx0 input:demod\n\n\n\nstep 2:   flash</div><div data-tid="diverse-reaction-summary">👍 2</div></div></div>`);
    const element = dom.window.document.querySelector("[data-message-content]");
    Object.defineProperty(element, "innerText", { get: () => element.textContent });
    const [message] = extractTeamsMessagesFromDocument(dom.window.document).messages;
    assert.equal(message.body, "step 1: make\n06-18 19:11:19 dmx0 input:demod\n\nstep 2: flash");
    assert.doesNotMatch(message.body, /👍/);
  });

  it("derives the time of system messages from the Teams message id", () => {
    const dom = new JSDOM(`<!doctype html><div data-tid="chat-pane-item"><div data-tid="control-message-renderer" data-mid="1784195389360">Yan Yan added Xiaoming Sui to the chat.</div></div>`);
    const [message] = extractTeamsMessagesFromDocument(dom.window.document).messages;
    assert.equal(message.createdAt, "2026-07-16T09:49:49.360Z");
    assert.equal(teamsTimeFromMessageId("message-body-1784195389360"), "2026-07-16T09:49:49.360Z");
    assert.equal(teamsTimeFromMessageId("chat-pane-item"), "");
  });

  it("never erases a known author or time when a later fragment lacks them", () => {
    const merged = mergeTeamsCaptureMessages([
      { id: "1790669890276", author: "Ada", createdAt: "2026-09-29T08:18:10.276Z", body: "first" },
      { id: "1790669890276", author: "", createdAt: "", body: "first (edited)" }
    ]);
    assert.equal(merged.length, 1);
    assert.deepEqual([merged[0].author, merged[0].createdAt, merged[0].body], ["Ada", "2026-09-29T08:18:10.276Z", "first (edited)"]);
    const stored = mergeTeamsCommentsByIdentity(
      [{ id: "1790669890276", author: "Ada", createdAt: "2026-09-29T08:18:10.276Z", body: "first" }],
      [{ id: "1790669890276", author: "", createdAt: "", body: "first" }, { id: "1784195389360", body: "system" }]
    );
    assert.equal(stored.find((c) => c.id === "1790669890276").author, "Ada");
    assert.equal(stored.find((c) => c.id === "1784195389360").createdAt, "2026-07-16T09:49:49.360Z");
  });

  it("matches unstable-id messages regardless of whitespace changes", () => {
    const stored = mergeTeamsCommentsByIdentity(
      [{ author: "Ada", createdAt: "t", body: "line one line two" }],
      [{ author: "Ada", createdAt: "t", body: "line one\nline two" }]
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0].body, "line one\nline two");
  });

  it("keeps scrolling past the normal budget to reach stored history, and reports an unclosed gap", async () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ id: String(1790000000000 + i), body: `m${i}`, createdAt: new Date(1790000000000 + i).toISOString() }));
    const run = async (stored, extendedMaxScrolls) => {
      let position = history.length - 3;
      return collectVirtualTeamsMessages({
        maxScrolls: 5, extendedMaxScrolls, minScrollsBeforeOverlapStop: 1,
        previousMessages: stored,
        readVisible: async () => ({ messages: history.slice(Math.max(0, position), position + 3) }),
        scrollOlder: async () => { const moved = position > 0; position = Math.max(0, position - 2); return moved; }
      });
    };
    const closed = await run([history[10]], 30);
    assert.equal(closed.coverage.stoppedBy, "previous-overlap");
    assert.equal(closed.coverage.gap, false);
    assert.ok(closed.messages.some((m) => m.id === history[11].id), "messages between captures were collected");
    const open = await run([history[2]], 5);
    assert.equal(open.coverage.gap, true);
    assert.equal(open.coverage.reachedPrevious, false);
    const first = await run([], 30);
    assert.equal(first.coverage.gap, false, "a first capture has no previous position to miss");
  });
});
