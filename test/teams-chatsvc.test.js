import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatsvcMessageToComment, collectChatsvcMessages, teamsHtmlToText } from "../src/sources/teams-chatsvc.js";

const CONV = "19:30b8f5a4adac40c293c356c82c509370@thread.v2";
const base = "https://teams.cloud.microsoft/api/chatsvc/apac/v1";
const msg = (id, extra = {}) => ({ id: String(id), type: "Message", conversationid: CONV, messagetype: "RichText/Html", imdisplayname: "Ada", composetime: new Date(id).toISOString().replace("Z", "0000Z"), content: `<p>m${id}</p>`, properties: {}, ...extra });

describe("Teams chatsvc capture", () => {
  it("converts rich text keeping lines, code, links, quotes and images", () => {
    const text = teamsHtmlToText(`<blockquote itemtype="http://schema.skype.com/Reply"><b>Bob</b><p>old point</p></blockquote><p>step 1: make&nbsp;-j8</p><pre>06-18 19:11:19 dmx0
06-18 19:11:20 dmx1</pre><ul><li>a</li><li>b</li></ul><p><a href="https://jira/browse/X-1">X-1</a> <img alt="diagram"></p>`);
    assert.equal(text, "> Bob\n> old point\n\nstep 1: make -j8\n\n```\n06-18 19:11:19 dmx0\n06-18 19:11:20 dmx1\n```\n\n- a\n- b\n\nX-1 (https://jira/browse/X-1) [diagram]");
  });

  it("maps system, edited and deleted messages and skips control messages", () => {
    assert.equal(chatsvcMessageToComment(msg(1790000000000, { messagetype: "ThreadActivity/AddMember", content: "<addmember><target>8:orgid:x</target><detailedtargetinfo><friendlyname>Hui Li</friendlyname></detailedtargetinfo></addmember>" })).body, "[成员加入：Hui Li]");
    const edited = chatsvcMessageToComment(msg(1790000000001, { properties: { edittime: "1790000099999" } }));
    assert.equal(edited.editedAt, new Date(1790000099999).toISOString());
    assert.equal(edited.createdAt, "2026-09-21T14:13:20.001Z");
    const deleted = chatsvcMessageToComment(msg(1790000000002, { properties: { deletetime: "1790000100000" } }));
    assert.equal(deleted.body, "");
    assert.ok(deleted.deletedAt);
    assert.equal(chatsvcMessageToComment(msg(1790000000003, { messagetype: "Control/Typing" })), null);
  });

  it("pages backwards until stored history is reached and reports coverage", async () => {
    const pages = {
      [`p1`]: { messages: [msg(1790000000300), msg(1790000000200)], _metadata: { backwardLink: "p2" } },
      [`p2`]: { messages: [msg(1790000000100), msg(1790000000050)], _metadata: { backwardLink: "p3" } },
      [`p3`]: { messages: [msg(1790000000010)], _metadata: {} }
    };
    const requested = [];
    const requestJson = async (url) => { requested.push(url); return { status: 200, json: pages[url.startsWith("p") ? url : "p1"] }; };
    const incremental = await collectChatsvcMessages({ requestJson, base, conversationId: CONV, knownIds: new Set(["1790000000100"]) });
    assert.equal(requested.length, 2);
    assert.match(requested[0], /conversations\/19%3A30b8f5a4adac40c293c356c82c509370%40thread\.v2\/messages\?.*pageSize=200/);
    assert.deepEqual(incremental.comments.map((c) => c.id), ["1790000000050", "1790000000100", "1790000000200", "1790000000300"]);
    assert.equal(incremental.coverage.stoppedBy, "previous-overlap");
    assert.equal(incremental.coverage.gap, false);

    requested.length = 0;
    const byTime = await collectChatsvcMessages({ requestJson, base, conversationId: CONV, knownIds: new Set([new Date(1790000000200).toISOString()]) });
    assert.equal(byTime.coverage.reachedPrevious, true, "overlap is also recognised by the stored millisecond time");

    const full = await collectChatsvcMessages({ requestJson, base, conversationId: CONV });
    assert.equal(full.completeness, "complete");
    assert.equal(full.coverage.reachedStart, true);
    assert.equal(full.comments.length, 5);

    const capped = await collectChatsvcMessages({ requestJson, base, conversationId: CONV, knownIds: new Set(["missing"]), maxPages: 2 });
    assert.equal(capped.coverage.gap, true);
  });

  it("refuses data from another conversation and surfaces auth failures", async () => {
    await assert.rejects(collectChatsvcMessages({ base, conversationId: CONV, requestJson: async () => ({ status: 200, json: { messages: [msg(1, { conversationid: "19:other@thread.v2" })] } }) }), /会话 ID 与目标不一致/);
    await assert.rejects(collectChatsvcMessages({ base, conversationId: CONV, requestJson: async () => ({ status: 401, json: null }) }), (error) => error.status === 401);
  });
});
