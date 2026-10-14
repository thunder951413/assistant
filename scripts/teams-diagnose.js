#!/usr/bin/env node
// Teams page diagnostics for the capture pipeline.
//
// Opens the same persistent WebDriver profile the app uses, waits for you to open
// one subscribed chat, then records (without message text) how Teams currently
// renders the chat list, filter box, header and messages, and which network
// responses carry message data. The JSON report is written to reports/.
//
//   npm run service:stop        # the app must not hold the Teams browser profile
//   node scripts/teams-diagnose.js [--profile <dir>] [--host teams.microsoft.com]
//
// Message bodies are replaced by their length; chat titles and ids are kept because
// they are what the locator has to match.
import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const host = arg("--host", "teams.microsoft.com");
const configDir = process.env.ASSISTANT_CONFIG_DIR || path.join(root, ".config");
const profileDir = path.resolve(arg("--profile", path.join(configDir, "webdriver", host.replace(/[^a-z0-9]+/gi, "-").toLowerCase())));

async function exists(target) { try { await fs.lstat(target); return true; } catch { return false; } }

for (const lock of ["SingletonLock", "SingletonSocket", "lockfile"]) {
  if (await exists(path.join(profileDir, lock))) {
    console.error(`浏览器配置正在被使用：${profileDir}\n请先关闭应用打开的 Teams 窗口或运行 npm run service:stop，再重试。`);
    process.exit(2);
  }
}
if (!(await exists(profileDir))) console.warn(`未找到已有登录目录，将新建：${profileDir}（需要重新登录 Teams）`);

const redact = (value, depth = 0) => {
  if (depth > 6) return "…";
  if (typeof value === "string") return value.length > 80 ? `<str:${value.length}>` : value.replace(/[一-鿿]/g, "字");
  if (Array.isArray(value)) return value.length ? [redact(value[0], depth + 1), `…${value.length} items`] : [];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 60).map(([k, v]) => [k, /content|body|text|preview|message$/i.test(k) && typeof v === "string" ? `<str:${v.length}>` : redact(v, depth + 1)]));
  return value;
};

const network = [];
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 860 },
  args: ["--disable-blink-features=AutomationControlled", "--window-size=1280,860"]
});
const page = context.pages()[0] || await context.newPage();
context.on("response", async (response) => {
  const url = response.url();
  if (!/messages|conversations|chatsvc|threads/i.test(url)) return;
  const type = response.headers()["content-type"] || "";
  if (!/json/i.test(type)) return;
  const entry = { url: url.replace(/(19:)[^/@?]+/g, "$1<id>").slice(0, 300), method: response.request().method(), status: response.status() };
  try {
    const json = await response.json();
    entry.topKeys = Object.keys(json || {}).slice(0, 30);
    const list = Array.isArray(json) ? json : (json.messages || json.value || json.conversations || null);
    if (Array.isArray(list)) { entry.listLength = list.length; entry.sample = redact(list[0]); }
    if (json?._metadata) entry.metadata = redact(json._metadata);
  } catch (error) { entry.error = String(error.message || error).slice(0, 120); }
  if (network.length < 80) network.push(entry);
});

await page.goto(`https://${host}/`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((error) => console.warn(error.message));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("\n1) 在弹出的浏览器里完成登录（如需要），进入 Teams 聊天界面。\n2) 在左侧聊天列表点开一个你订阅过的群聊，等消息加载出来，再往上滚动一两屏。\n3) 回到这里按回车开始采集……");

const report = await page.evaluate(() => {
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const attrs = (el) => Object.fromEntries([...el.attributes].filter((a) => /^(data-|role|aria-|id$|class$|title$|href$)/.test(a.name)).map((a) => [a.name, a.name === "class" ? a.value.split(/\s+/).slice(0, 4).join(" ") : a.value.slice(0, 160)]));
  const skeleton = (el, depth = 0) => !el || depth > 5 ? null : ({ tag: el.tagName.toLowerCase(), ...attrs(el), textLen: clean(el.innerText).length, children: depth < 5 ? [...el.children].slice(0, 12).map((c) => skeleton(c, depth + 1)) : `${el.children.length} children` });
  const treeItems = [...document.querySelectorAll("[data-fui-tree-item-value]")];
  const roleItems = [...document.querySelectorAll("[role='treeitem']")];
  const headerSelectors = ["[data-tid='chat-title']", "[data-tid='conversation-header-title']", "[data-tid='channel-name']", "[data-tid*='conversation-header'] [role='heading']", "main [role='heading'][aria-level='1']", "main h1", "[data-tid='chat-header-title']", "h1", "h2"];
  const messageNodes = [...document.querySelectorAll("[data-mid], [data-message-id]")];
  const firstMessages = messageNodes.slice(0, 3).map((node) => {
    let container = node.parentElement; let hops = 0;
    while (container && hops < 8 && !container.matches("[data-tid='chat-pane-item'], [data-tid='message-container'], [data-tid='control-message-renderer']")) { container = container.parentElement; hops += 1; }
    return { node: { ...attrs(node), textLen: clean(node.innerText).length, innerTextHasNewline: /\n/.test(node.innerText) }, containerFound: Boolean(container), containerHops: hops, container: skeleton(container || node.parentElement) };
  });
  const authorPresence = messageNodes.map((node) => {
    const container = node.closest("[data-tid='chat-pane-item'], [data-tid='message-container']") || node.parentElement;
    return { author: Boolean(container?.querySelector("[data-tid*='author']")), time: Boolean(container?.querySelector("time[datetime]")) };
  });
  return {
    location: { href: location.href.replace(/(19:)[^/@?]+/g, "$1<id>"), hash: location.hash.slice(0, 120), lang: document.documentElement.lang, title: document.title },
    viewport: { width: innerWidth, height: innerHeight },
    chatList: {
      treeItemValueCount: treeItems.length,
      visibleTreeItemValueCount: treeItems.filter(visible).length,
      roleTreeItemCount: roleItems.length,
      samples: treeItems.slice(0, 12).map((el) => ({ value: el.getAttribute("data-fui-tree-item-value"), role: el.getAttribute("role"), ariaLabel: clean(el.getAttribute("aria-label")).slice(0, 120), innerText: clean(el.innerText).slice(0, 120), visible: visible(el), selected: el.getAttribute("aria-selected") || el.getAttribute("aria-current") || "" })),
      selected: treeItems.filter((el) => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current")).map((el) => ({ value: el.getAttribute("data-fui-tree-item-value"), innerText: clean(el.innerText).slice(0, 120), titleCandidates: [...el.querySelectorAll("span, div")].map((n) => clean(n.childNodes.length === 1 && n.firstChild.nodeType === 3 ? n.textContent : "")).filter(Boolean).slice(0, 6) })),
      firstItemSkeleton: skeleton(treeItems[0])
    },
    filterInputs: [...document.querySelectorAll("input, [contenteditable='true']")].filter(visible).map((el) => ({ tag: el.tagName.toLowerCase(), ...attrs(el), placeholder: el.getAttribute("placeholder") || "" })).slice(0, 12),
    filterButtons: [...document.querySelectorAll("button")].filter(visible).map((b) => clean(b.getAttribute("aria-label") || b.getAttribute("title") || "")).filter((t) => /filter|筛选|search|搜索|new chat|新聊天/i.test(t)).slice(0, 12),
    appBar: [...document.querySelectorAll("[data-tid*='app-bar'], nav button, [role='navigation'] button")].filter(visible).map((el) => ({ dataTid: el.getAttribute("data-tid"), aria: clean(el.getAttribute("aria-label")).slice(0, 60), pressed: el.getAttribute("aria-pressed") || el.getAttribute("aria-selected") || "" })).slice(0, 16),
    header: headerSelectors.map((selector) => ({ selector, text: clean(document.querySelector(selector)?.textContent).slice(0, 120) })),
    messages: {
      dataMidCount: messageNodes.length,
      withAuthorElement: authorPresence.filter((m) => m.author).length,
      withTime: authorPresence.filter((m) => m.time).length,
      viewportFound: Boolean(document.querySelector("[data-tid='message-pane-list-viewport']")),
      dataTidsInPane: [...new Set([...document.querySelectorAll("[data-tid]")].map((el) => el.getAttribute("data-tid")).filter((t) => /message|chat-pane|author|timestamp|reply|reaction|edited|see-more|quote|divider|control/i.test(t)))].slice(0, 60),
      firstMessages
    },
    latestButtons: [...document.querySelectorAll("button, [role='button']")].filter(visible).map((b) => clean(b.innerText || b.getAttribute("aria-label"))).filter((t) => /latest|最新|new message|新消息/i.test(t)).slice(0, 6)
  };
});

const out = path.join(root, "reports", `teams-diagnose-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), host, profileDir, report, network }, null, 2));
console.log(`\n已写入：${out}\n聊天列表项 ${report.chatList.treeItemValueCount} 个，消息节点 ${report.messages.dataMidCount} 个，捕获接口响应 ${network.length} 条。`);
rl.close();
await context.close();
