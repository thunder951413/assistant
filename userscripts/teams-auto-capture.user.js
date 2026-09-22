// ==UserScript==
// @name         Material Organizer - Teams Auto Capture
// @namespace    https://github.com/thunder951413/assistant
// @version      0.2.0
// @description  Periodically capture the current Microsoft Teams web conversation into the local Material Organizer app.
// @match        https://teams.microsoft.com/*
// @match        https://teams.cloud.microsoft/*
// @connect      localhost
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    endpoint: "http://127.0.0.1:8020/api/items/upsert-capture",
    intervalMs: 5 * 60 * 1000,
    minMessages: 1,
    maxMessages: 240,
    tags: ["teams", "userscript"]
  };

  let lastFingerprint = "";
  let timer = null;

  GM_registerMenuCommand("Material Organizer: sync current Teams conversation", () => {
    captureAndSend({ force: true });
  });
  GM_registerMenuCommand("Material Organizer: configure local endpoint", configureEndpoint);
  GM_registerMenuCommand("Material Organizer: set pairing token", configurePairingToken);

  schedule();
  setTimeout(() => captureAndSend({ force: false }), 8000);

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => captureAndSend({ force: false }), CONFIG.intervalMs);
  }

  async function captureAndSend({ force }) {
    let capture;
    try { capture = buildTeamsCapture(); } catch (error) {
      if (force) notify("Teams sync skipped", error.message || String(error));
      return;
    }
    if (!capture.comments.length || capture.comments.length < CONFIG.minMessages) return;

    const fingerprint = [capture.url, ...capture.comments.map((message) => [message.id, message.createdAt, message.author, message.body].join("\u0001"))].join("\n");
    if (!force && fingerprint === lastFingerprint) return;

    try {
      await postJson(await endpoint(), capture, await pairingToken());
      lastFingerprint = fingerprint;
      notify("Teams conversation synced", `${capture.title} · ${capture.comments.length} messages`);
    } catch (error) {
      notify("Teams sync failed", error.message || String(error));
    }
  }

  async function endpoint() {
    return clean(await GM_getValue("endpoint", CONFIG.endpoint)) || CONFIG.endpoint;
  }

  async function pairingToken() {
    return clean(await GM_getValue("captureToken", ""));
  }

  async function configureEndpoint() {
    const current = await endpoint();
    const value = prompt("Local Material Organizer capture endpoint", current);
    if (value === null) return;
    const normalized = clean(value).replace(/\/$/, "");
    if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api\/items\/upsert-capture$/i.test(normalized)) {
      notify("Endpoint not saved", "Use a local /api/items/upsert-capture address.");
      return;
    }
    await GM_setValue("endpoint", normalized);
    notify("Endpoint saved", normalized);
  }

  async function configurePairingToken() {
    const value = prompt("Paste the pairing token, or the pairing JSON copied from Material Organizer settings", await pairingToken());
    if (value === null) return;
    const parsed = parsePairing(value);
    if (parsed.endpoint) await GM_setValue("endpoint", parsed.endpoint);
    await GM_setValue("captureToken", parsed.token);
    notify("Pairing token saved", "The next capture will use it.");
  }

  function parsePairing(value) {
    const fallback = clean(value);
    try {
      const parsed = JSON.parse(fallback);
      const endpoint = clean(parsed.endpoint || parsed.captureEndpoint || "").replace(/\/$/, "");
      const token = clean(parsed.token || parsed.captureToken || "");
      if (!token) throw new Error("missing token");
      if (endpoint && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api\/items\/upsert-capture$/i.test(endpoint)) {
        throw new Error("invalid endpoint");
      }
      return { endpoint, token };
    } catch {
      return { endpoint: "", token: fallback };
    }
  }

  function buildTeamsCapture() {
    const title = currentConversationTitle();
    const url = currentConversationUrl(title);
    const comments = readVisibleMessages().slice(-CONFIG.maxMessages);
    const sourceUpdatedAt = latestTimestamp(comments.map((comment) => comment.createdAt));
    const text = renderTeamsText(title, url, comments);

    return {
      title,
      sourceType: "teams",
      url,
      tags: CONFIG.tags,
      // The page is a virtualized UI. The visible message range is the
      // evidence; uploading all HTML is both misleading and unnecessarily large.
      rawContent: text,
      extractedContent: text,
      comments,
      sourceUpdatedAt,
      fetchedAt: new Date().toISOString(),
      pageKind: "content",
      fetchMode: "userscript",
      captureMethod: "userscript",
      completeness: "partial",
      coverage: {
        observedCount: comments.length,
        maxMessages: CONFIG.maxMessages,
        visibleWindow: true,
        newestObservedAt: sourceUpdatedAt
      },
      identityEvidence: {
        conversationUrl: url,
        stableMessageIds: comments.filter((comment) => comment.id).length
      }
    };
  }

  function currentConversationTitle() {
    const candidates = [
      "[data-tid='chat-title']",
      "[data-tid='chat-header-title']",
      "[data-tid='channel-pane-header']",
      "[data-tid='conversation-header-title']",
      "h1",
      "[role='heading'][aria-level='1']",
      "[role='heading'][aria-level='2']"
    ];
    for (const selector of candidates) {
      const text = clean(document.querySelector(selector)?.textContent || "");
      if (text && !/microsoft teams/i.test(text)) return text;
    }
    return clean(document.title).replace(/\s*\|\s*Microsoft Teams\s*$/i, "") || "Microsoft Teams conversation";
  }

  function readVisibleMessages() {
    return extractTeamsMessagesFromDocument(document).messages;
  }

  // Keep this self-contained extractor synchronized with src/capture-policy.js.
  function extractTeamsMessagesFromDocument(document = globalThis.document) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const pickTitle = () => {
    for (const selector of ["[data-tid='channel-name']", "[data-tid='chat-title']", "[data-tid='conversation-header-title']", "h1", "[role='heading']"]) {
      const text = clean(document.querySelector(selector)?.textContent);
      if (text) return text;
    }
    return clean(document.title) || "Microsoft Teams conversation";
  };
  const nearestMessageContainer = (node) => {
    let current = node.parentElement;
    while (current) {
      if (current.matches("[data-tid='chat-pane-item'], [data-tid='message-container'], [data-tid='control-message-renderer']")) return current;
      current = current.parentElement;
    }
    return node;
  };
  const buildMessage = (bodyNode) => {
    const node = nearestMessageContainer(bodyNode);
    const author = clean(node.querySelector("[data-tid*='author'],[data-tid*='sender'],[data-tid*='message-author'],[class*='author'],[class*='sender']")?.textContent) || clean(node.getAttribute("data-author"));
    const createdAt = node.querySelector("time")?.getAttribute("datetime") || node.querySelector("[datetime]")?.getAttribute("datetime") || clean(node.querySelector("[data-tid*='timestamp'],[class*='timestamp'],[aria-label*='sent'],[aria-label*='发送']")?.textContent);
    const attachmentText = [...bodyNode.querySelectorAll("img, a[href]")]
      .map((element) => clean(element.getAttribute("alt") || element.textContent) || (element.tagName === "IMG" ? "图片" : "附件"))
      .filter(Boolean).map((text) => `[${text}]`).filter((text, index, values) => values.indexOf(text) === index).join(" ");
    const body = clean(bodyNode.innerText || bodyNode.textContent) || attachmentText;
    const id = clean(bodyNode.getAttribute("data-mid") || bodyNode.getAttribute("data-message-id") || "");
    return { id, author, createdAt, body, links: [...node.querySelectorAll("a[href]")].map((link) => ({ text: clean(link.textContent), href: link.href })).filter((link) => link.href) };
  };
  const stableNodes = [...document.querySelectorAll("[data-mid], [data-message-id]")]
    .filter((node) => clean(node.getAttribute("data-mid") || node.getAttribute("data-message-id")));
  if (stableNodes.length) return { title: pickTitle(), messages: stableNodes.map(buildMessage).filter((message) => message.body) };
  const fallback = [...document.querySelectorAll("[data-tid='control-message-renderer'], [role='listitem'], [data-tid*='messageBody'], [data-tid*='message-body']")]
    .filter((node) => clean(node.textContent).length > 0 || node.querySelector("img, a[href]"));
  const messages = fallback.map(buildMessage).filter((message) => message.body);
  return { title: pickTitle(), messages };
}

  function renderTeamsText(title, url, comments) {
    return [
      `# ${title || "Microsoft Teams conversation"}`,
      "",
      `Source: ${url}`,
      "Adapter: teams-userscript",
      `Messages captured: ${comments.length}`,
      "",
      "## Messages",
      "",
      ...(comments.length ? comments.map((comment) => [
        `### ${[comment.author, comment.createdAt].filter(Boolean).join(" · ") || "Message"}`,
        "",
        comment.body
      ].join("\n")) : ["_No Teams messages captured._"])
    ].join("\n");
  }

  function currentConversationUrl(title) {
    const ids = [...document.querySelectorAll("[data-fui-tree-item-value]")]
      .filter((node) => clean(node.innerText || node.textContent) === title)
      .map((node) => node.getAttribute("data-fui-tree-item-value").match(/19:[^\s"'<>/]+@thread\.v2$/)?.[0])
      .filter(Boolean);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 1) return `https://teams.microsoft.com/l/chat/${encodeURIComponent(uniqueIds[0])}/conversations`;
    throw new Error("无法唯一确认当前群聊的会话 ID，请展开聊天列表并确认群名称唯一后重试。");
  }

  function canonicalTeamsUrl(value) {
    try {
      const parsed = new URL(value);
      const deepPath = extractTeamsDeepPath(parsed);
      if (deepPath) return `https://teams.microsoft.com${deepPath}`;
      return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return value;
    }
  }

  function extractTeamsDeepPath(parsed) {
    if (/^#\/l\/(?:chat|channel|message|team)\//i.test(parsed.hash)) return parsed.hash.slice(1);
    if (/^\/l\/(?:chat|channel|message|team)\//i.test(parsed.pathname)) return `${parsed.pathname}${parsed.search}`;
    const target = parsed.searchParams.get("url") || parsed.searchParams.get("deeplink");
    if (!target) return "";
    const decoded = decodeURIComponent(target);
    if (/^\/_#\/l\//i.test(decoded)) return decoded.replace(/^\/_#/i, "");
    if (/^_#\/l\//i.test(decoded)) return decoded.replace(/^_#/i, "");
    if (/^\/l\//i.test(decoded)) return decoded;
    try {
      return extractTeamsDeepPath(new URL(decoded));
    } catch {
      return "";
    }
  }

  function postJson(url, payload, token) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "application/json", ...(token ? { "X-Capture-Token": token } : {}) },
        data: JSON.stringify(payload),
        timeout: 30000,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) resolve(response);
          else reject(new Error(`HTTP ${response.status}: ${response.responseText || response.statusText}`));
        },
        onerror: () => reject(new Error("Cannot reach local Material Organizer service.")),
        ontimeout: () => reject(new Error("Timed out while sending capture."))
      });
    });
  }

  function latestTimestamp(values) {
    return values.filter(Boolean).sort().at(-1) || "";
  }

  function notify(title, text) {
    if (typeof GM_notification === "function") {
      GM_notification({ title, text, timeout: 3500 });
    } else {
      console.log(`[Material Organizer] ${title}: ${text}`);
    }
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
})();
