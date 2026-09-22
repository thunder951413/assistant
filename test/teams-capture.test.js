import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { collectVirtualTeamsMessages, extractTeamsMessagesFromDocument, mergeTeamsCaptureMessages } from "../src/capture-policy.js";

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
});
