import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function settings() {
  return {
    ai: {}, embedding: {}, chat: {}, doNotDisturb: {}, notifications: { sources: {} }, refreshSchedule: {},
    processingPrompts: {}, sourceProfiles: {}, refreshJobs: [], tags: []
  };
}

function item(id, title = id) {
  return {
    metadata: { id, title, sourceType: "text", tags: [], url: "", contentUpdatedAt: "" },
    document: `# ${title}\n\n## Content\n\n${title} 正文`, processedDocument: ""
  };
}

async function boot(handler, localSessions = []) {
  const dom = new JSDOM(html, { url: "http://127.0.0.1:8020/", pretendToBeVisual: true });
  const original = {};
  for (const key of ["window", "document", "navigator", "location", "localStorage", "CSS", "HTMLElement", "HTMLDialogElement", "requestAnimationFrame", "fetch", "confirm", "alert"]) {
    original[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, location: dom.window.location,
    localStorage: dom.window.localStorage, CSS: { escape: (value) => String(value) }, HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement, requestAnimationFrame: (callback) => setTimeout(callback, 0),
    confirm: () => true, alert: () => {}
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  dom.window.navigator.clipboard = { writeText: async () => {} };
  localStorage.setItem("materialOrganizer.chatSessions", JSON.stringify(localSessions));
  localStorage.setItem("materialOrganizer.activeChatId", localSessions[0]?.id || "");
  globalThis.fetch = async (path, options = {}) => {
    const result = await handler(String(path), options);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(`${appSource}\nglobalThis.__uiWorkflow = { state, selectItem, sendChatMessage, activateChatSession, checkRefreshJobsForUpdates, renderRefreshJobs, confirmImport, loadChatSessions, saveChatSessions, appendMessage, renderDetail };`)();
  const ui = globalThis.__uiWorkflow;
  clearInterval(ui.state.refreshMonitorTimer);
  return {
    dom, ui,
    cleanup() {
      clearInterval(ui.state.refreshMonitorTimer);
      delete globalThis.__uiWorkflow;
      for (const [key, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  };
}

function defaultApi(path) {
  if (path === "/api/agent-config") return { rootDir: "/tmp/library" };
  if (path === "/api/settings") return { settings: settings() };
  if (path === "/api/items" || path.startsWith("/api/items?")) return { items: [], total: 0 };
  if (path === "/api/tags") return { tags: [] };
  if (path === "/api/source-health") return { sources: [] };
  if (path === "/api/chat-sessions") return { initialized: true, sessions: [], activeChatId: "" };
  return {};
}

test("selectItem ignores a slow previous item response", async () => {
  const a = deferred();
  const b = deferred();
  const app = await boot((path) => path === "/api/items/A" ? a.promise : path === "/api/items/B" ? b.promise : defaultApi(path));
  try {
    const first = app.ui.selectItem("A");
    const second = app.ui.selectItem("B");
    b.resolve({ item: item("B", "第二条") });
    await second;
    a.resolve({ item: item("A", "第一条") });
    await first;
    assert.match(document.querySelector("#detailPanel").textContent, /第二条/);
    assert.doesNotMatch(document.querySelector("#detailPanel").textContent, /第一条/);
  } finally { app.cleanup(); }
});

test("switching chat and cancelling a stream cannot write into the new chat", async () => {
  let streamController;
  const app = await boot((path) => {
    if (path === "/api/chat-stream") {
      const stream = new ReadableStream({ start(controller) { streamController = controller; } });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }
    return defaultApi(path);
  });
  try {
    const firstId = app.ui.state.activeChatId;
    app.ui.state.chatSessions.push({ id: "other", title: "另一会话", updatedAt: new Date().toISOString(), messages: [] });
    document.querySelector("#chatInput").value = "旧会话的问题";
    const sending = app.ui.sendChatMessage(new Event("submit"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.ui.activateChatSession("other");
    document.querySelector("#stopChatButton").click();
    streamController.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"旧回答内容"}\n\n'));
    streamController.close();
    await sending;
    assert.equal(app.ui.state.activeChatId, "other");
    assert.doesNotMatch(document.querySelector("#chatMessages").textContent, /旧回答内容|旧会话的问题/);
    assert.ok(app.ui.state.chatSessions.find((session) => session.id === firstId).messages.some((message) => message.text === "旧会话的问题"));
  } finally { app.cleanup(); }
});

test("subscription polling updates the list but preserves an unsaved drawer edit", async () => {
  const app = await boot((path) => {
    if (path === "/api/refresh-jobs") return { jobs: [{ id: "job", name: "新版", url: "https://new.example", enabled: true }] };
    if (path === "/api/refresh-runs") return { runs: [] };
    return defaultApi(path);
  });
  try {
    app.ui.state.view = "subscriptions";
    app.ui.renderRefreshJobs([{ id: "job", name: "原任务", url: "https://old.example", enabled: true }]);
    document.querySelector('[data-subscription-id="job"] .subs-name').dispatchEvent(new app.dom.window.MouseEvent("click", { bubbles: true }));
    const url = document.querySelector("#subscriptionDrawer input[name='url']");
    assert.equal(url.value, "https://old.example");
    url.value = "https://draft.example";
    url.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    await app.ui.checkRefreshJobsForUpdates();
    assert.equal(document.querySelector("#subscriptionDrawer input[name='url']").value, "https://draft.example", "the draft survives polling");
    assert.match(document.querySelector('[data-subscription-id="job"] .subs-name strong').textContent, /新版/, "the list itself is refreshed");
  } finally { app.cleanup(); }
});

test("import restores controls after failure and rejects a duplicate successful submit", async () => {
  let itemPosts = 0;
  let fail = true;
  const app = await boot(async (path, options) => {
    if (path === "/api/items" && options.method === "POST") {
      itemPosts += 1;
      if (fail) return new Response(JSON.stringify({ error: "暂时失败" }), { status: 500, headers: { "Content-Type": "application/json" } });
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { item: item("saved", "已保存") };
    }
    if (path === "/api/items/saved") return { item: item("saved", "已保存") };
    return defaultApi(path);
  });
  try {
    app.ui.state.importPreview = { title: "导入", sourceType: "text", url: "", rawContent: "x", extractedContent: "正文", comments: [] };
    document.querySelector("#confirmTitle").value = "导入";
    document.querySelector("#previewContent").value = "正文";
    await app.ui.confirmImport();
    assert.equal(itemPosts, 1);
    assert.equal(document.querySelector("#confirmImportButton").disabled, false);
    assert.match(document.querySelector("#previewStatus").textContent, /暂时失败/);
    fail = false;
    const first = app.ui.confirmImport();
    const second = app.ui.confirmImport();
    await Promise.all([first, second]);
    assert.equal(itemPosts, 2);
  } finally { app.cleanup(); }
});

test("an initialized empty server chat store does not revive local sessions", async () => {
  const legacy = [{ id: "legacy", title: "旧对话", updatedAt: "2020-01-01", messages: [{ role: "user", text: "旧记录" }] }];
  const app = await boot((path) => defaultApi(path), legacy);
  try {
    assert.ok(!app.ui.state.chatSessions.some((session) => session.id === "legacy"));
    assert.ok(app.ui.state.chatSessions.every((session) => !session.messages.some((message) => message.text === "旧记录")));
  } finally { app.cleanup(); }
});

test("chat persistence queues immutable snapshots in write order", async () => {
  let queueMode = false;
  const firstWrite = deferred();
  const payloads = [];
  const app = await boot((path, options) => {
    if (path === "/api/chat-sessions" && options.method === "PATCH" && queueMode) {
      payloads.push(JSON.parse(options.body));
      return payloads.length === 1 ? firstWrite.promise : {};
    }
    return defaultApi(path);
  });
  try {
    queueMode = true;
    app.ui.state.chatSessions = [{ id: "chat", title: "会话", updatedAt: "1", messages: [{ role: "user", text: "旧快照" }] }];
    app.ui.state.activeChatId = "chat";
    const oldSave = app.ui.saveChatSessions();
    app.ui.state.chatSessions[0].messages[0].text = "新快照";
    app.ui.state.chatSessions[0].updatedAt = "2";
    const newSave = app.ui.saveChatSessions();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].sessions[0].messages[0].text, "旧快照");
    firstWrite.resolve({});
    await Promise.all([oldSave, newSave]);
    assert.deepEqual(payloads.map((payload) => payload.sessions[0].messages[0].text), ["旧快照", "新快照"]);
  } finally { app.cleanup(); }
});

test("a failed server chat read stays local and does not overwrite remote storage", async () => {
  const legacy = [{ id: "local", title: "本地恢复", updatedAt: "1", messages: [] }];
  let writes = 0;
  const app = await boot((path, options) => {
    if (path === "/api/chat-sessions" && !options.method) return new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } });
    if (path === "/api/chat-sessions" && options.method === "PATCH") writes += 1;
    return defaultApi(path);
  }, legacy);
  try {
    assert.equal(app.ui.state.chatSessionsLocalOnly, true);
    assert.equal(writes, 0);
    assert.match(document.querySelector("#chatSessionStatus").textContent, /本机.*恢复连接/);
  } finally { app.cleanup(); }
});

test("chat source buttons open the cited material", async () => {
  const app = await boot((path) => path === "/api/items/cited" ? { item: item("cited", "验收资料") } : defaultApi(path));
  try {
    app.ui.appendMessage("assistant", "回答", { sources: [{ id: "cited", title: "验收资料", sourceType: "text", completeness: "unknown" }] });
    const source = document.querySelector(".chat-source-link");
    assert.match(source.textContent, /范围未确认/);
    source.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(app.ui.state.view, "materials");
    assert.match(document.querySelector("#detailPanel").textContent, /验收资料/);
  } finally { app.cleanup(); }
});

test("reader shows the original when the organized version is stale, newest messages first", async () => {
  const app = await boot((path) => defaultApi(path));
  try {
    const t = (minute) => new Date(Date.UTC(2026, 9, 14, 1, minute)).toISOString();
    app.ui.renderDetail({
      metadata: { id: "teams-bm", title: "BM Test", sourceType: "teams", tags: [], url: "https://teams.microsoft.com/l/chat/19:x@thread.v2/conversations",
        processedAt: t(5), processedThroughAt: t(5), processedStale: true, contentUpdatedAt: t(30), updateAcknowledgedAt: t(10) },
      document: "# BM Test\n\n## Content\n\n## Messages", processedDocument: "# x\n\n## AI Organized Content\n\nold summary",
      comments: [
        { id: "1", author: "Ada", createdAt: t(1), body: "oldest" },
        { id: "2", author: "Ben", createdAt: t(20), body: "step 1: make\nstep 2: flash" },
        { id: "3", author: "Cy", createdAt: t(25), body: "newest" }
      ]
    });
    const bodies = [...document.querySelectorAll(".msg .msg-body")].map((node) => node.textContent.trim());
    assert.deepEqual(bodies, ["newest", "step 1: makestep 2: flash", "oldest"]);
    assert.equal(document.querySelector(".msg .msg-body br") !== null, true, "line breaks are kept");
    assert.equal(document.querySelectorAll(".msg.is-new").length, 2, "messages after the last read are marked new");
    assert.match(document.querySelector(".reader-banners").textContent, /之后又有 2 条消息/);
    assert.equal(document.querySelector("#showRawButton").classList.contains("is-active"), true);
    assert.doesNotMatch(document.querySelector(".reader-body").textContent, /old summary/);
    document.querySelector("[data-show-mode='processed']").click();
    assert.match(document.querySelector(".reader-body").textContent, /old summary/);
  } finally { app.cleanup(); }
});

test("subscriptions group by source and surface failures and duplicates", async () => {
  const app = await boot((path) => defaultApi(path));
  try {
    app.ui.state.view = "subscriptions";
    app.ui.renderRefreshJobs([
      { id: "a", name: "BM Test refresh", url: "https://teams.microsoft.com/l/chat/19:a@thread.v2/conversations", enabled: true, lastRunAt: new Date().toISOString(), status: "idle", pageKind: "content", intervalMinutes: 240 },
      { id: "b", name: "BM Test copy", url: "https://teams.microsoft.com/l/chat/19:a@thread.v2/conversations", enabled: true, status: "idle", pageKind: "content" },
      { id: "c", name: "Filter 50724", url: "https://jira.example.com/issues/?filter=50724", enabled: true, status: "failed", lastError: "timeout", pageKind: "list" },
      { id: "d", name: "Paused page", url: "https://confluence.example.com/x", enabled: false, pageKind: "content", managedBy: "content-page" }
    ]);
    const groups = [...document.querySelectorAll(".subs-group")].map((group) => group.dataset.sourceGroup);
    assert.deepEqual(groups, ["teams", "jira", "confluence"]);
    assert.match(document.querySelector('[data-subscription-filter="problem"]').textContent, /1/);
    assert.equal(document.querySelectorAll(".subs-name .flag").length, 2, "both duplicate rows are flagged");
    assert.match(document.querySelector('[data-subscription-id="a"] .subs-interval').textContent, /每 4 小时/);
    document.querySelector('[data-subscription-filter="problem"]').click();
    assert.deepEqual([...document.querySelectorAll("[data-subscription-id]")].map((row) => row.dataset.subscriptionId), ["c"]);
  } finally { app.cleanup(); }
});
