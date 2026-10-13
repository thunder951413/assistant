// Microsoft Teams web-app automation: locating conversations, scrolling the
// virtualized message list and extracting messages. Operates on a Playwright page.
import { collectVirtualTeamsMessages, extractTeamsMessagesFromDocument, mergeTeamsCaptureMessages, teamsCaptureMessageKeys } from "../capture-policy.js";
import { areCaptureTitlesConsistent } from "../capture-utils.js";
import { latestTimestampValue } from "../text-helpers.js";
import { cleanText } from "../utils.js";

export async function isTeamsWebAppReady(page) {
  if (!page || page.isClosed()) return false;
  return page.evaluate(() => {
    const hostname = window.location.hostname.toLowerCase();
    const onTeamsHost = hostname === "teams.cloud.microsoft"
      || hostname === "teams.microsoft.com"
      || hostname.endsWith(".teams.microsoft.com");
    if (!onTeamsHost) return false;

    const authInput = document.querySelector([
      "input[type='email']",
      "input[name='loginfmt']",
      "input[name='passwd']",
      "input[type='password']"
    ].join(","));
    if (authInput) return false;

    const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ");
    const launcherVisible = /使用(?: Web|网页)|在此浏览器中继续|Use the web app|Continue on this browser/i.test(bodyText);
    if (launcherVisible) return false;

    const appShell = document.querySelector([
      "[data-tid='app-layout-area--main']",
      "[data-tid='app-bar']",
      "[data-tid='chat-list']",
      "[data-tid='chat-pane-list']",
      "[data-tid='teams-app-bar']",
      "[data-tid='left-rail']"
    ].join(","));
    if (appShell) return true;

    const teamsNavigation = /(?:Activity|Chat|Teams|Calendar|Calls|Apps|活动|聊天|团队|日历|通话|应用)/i.test(bodyText);
    return /\/(?:v2|_#\/|l\/)/i.test(window.location.pathname + window.location.hash) && teamsNavigation;
  }).catch(() => false);
}

export function teamsConversationTitleForJob(job) {
  const title = cleanText(job?.name || "").replace(/\s+refresh$/i, "").trim();
  if (!title || /^Teams conversation$/i.test(title)) return "";
  return title;
}

export async function clickTeamsConversationById(page, conversationId) {
  return page.evaluate((expectedId) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const candidates = [...document.querySelectorAll("[data-fui-tree-item-value]")]
      .filter((element) => {
        const value = String(element.getAttribute("data-fui-tree-item-value") || "");
        return value === expectedId || (value.match(/19:[^\s"'<>/]+@(?:thread\.v2|thread\.tacv2|unq\.gbl\.spaces)(?=$|[\s"'<>/])/g) || []).includes(expectedId);
      })
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    const target = candidates.length === 1 ? candidates[0] : null;
    if (!target) return { clicked: false, title: "" };
    const title = clean(target.innerText || target.textContent);
    if (!title) return { clicked: false, title: "" };
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
    return { clicked: true, title };
  }, conversationId).catch(() => ({ clicked: false, title: "" }));
}

export async function activateTeamsChatArea(page) {
  const selectors = [
    "[data-tid='app-bar-item-chat']",
    "[data-tid='app-bar-item-Chat']",
    "[data-tid*='app-bar'][data-tid*='chat']",
    "button[aria-label='Chat']",
    "button[aria-label^='Chat ']",
    "button[aria-label='聊天']",
    "button[aria-label^='聊天 ']",
    "a[aria-label='Chat']",
    "a[aria-label='聊天']"
  ];
  for (const selector of selectors) {
    try {
      const target = page.locator(selector).first();
      if (!await target.isVisible({ timeout: 500 })) continue;
      const alreadySelected = await target.evaluate((element) => {
        const selected = element.getAttribute("aria-pressed") === "true"
          || element.getAttribute("aria-selected") === "true"
          || element.getAttribute("data-is-selected") === "true"
          || Boolean(element.querySelector("[aria-pressed='true'], [aria-selected='true']"));
        return selected;
      }).catch(() => false);
      if (alreadySelected) return true;
      await target.click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      return true;
    } catch {
      // Teams changes app-bar attributes frequently; try the next stable label.
    }
  }
  return false;
}

export async function clickTeamsConversationCandidate(page, targetTitle) {
  return page.evaluate((expected) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const normalized = clean(expected).toLocaleLowerCase();
    const selectors = [
      "[role='treeitem']",
      "[role='option']",
      "[role='row']",
      "[data-tid*='chat-list-item']",
      "[data-tid*='chat-item']",
      "[data-tid*='conversation-list-item']",
      "a[href*='/l/chat/']"
    ].join(",");
    const candidates = [...document.querySelectorAll(selectors)]
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    if (!normalized) return false;
    const matches = candidates.filter((element) => clean(element.innerText || element.textContent).toLocaleLowerCase() === normalized);
    const target = matches.length === 1 ? matches[0] : null;
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
    return true;
  }, targetTitle).catch(() => false);
}

export async function filterTeamsChatList(page, targetTitle) {
  const inputSelectors = [
    "input[aria-label='Filter by person, chat or channel name']",
    "input[placeholder='Filter by person, chat or channel name']"
  ];
  let filterInput = await firstVisibleTeamsLocator(page, inputSelectors);
  if (!filterInput) {
    const buttonSelectors = [
      "button[aria-label^='Show filter text box']",
      "button[title^='Show filter text box']"
    ];
    const filterButton = await firstVisibleTeamsLocator(page, buttonSelectors);
    if (!filterButton) return false;
    await filterButton.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    filterInput = await firstVisibleTeamsLocator(page, inputSelectors);
  }
  if (!filterInput) return false;
  await filterInput.fill(targetTitle, { timeout: 5000 });
  await page.waitForTimeout(1000);
  return true;
}

export async function closeTeamsChatListFilter(page) {
  const input = await firstVisibleTeamsLocator(page, [
    "input[aria-label='Filter by person, chat or channel name']",
    "input[placeholder='Filter by person, chat or channel name']"
  ]);
  if (input) await input.fill("").catch(() => {});
  const closeButton = await firstVisibleTeamsLocator(page, [
    "button[aria-label^='Close filter text box']",
    "button[title^='Close filter text box']"
  ]);
  if (closeButton) await closeButton.click({ timeout: 2000 }).catch(() => {});
}

export async function firstVisibleTeamsLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) return locator;
  }
  return null;
}

export async function waitForTeamsConversationTitle(page, expectedTitle) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const actualTitle = await currentTeamsConversationTitle(page);
    if (actualTitle && areCaptureTitlesConsistent(expectedTitle, actualTitle)) {
      await waitForTeamsConversation(page);
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

export async function currentTeamsConversationTitle(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const selectors = [
      "[data-tid='chat-title']",
      "[data-tid='conversation-header-title']",
      "[data-tid='channel-name']",
      "[data-tid*='conversation-header'] [role='heading']",
      "main [role='heading'][aria-level='1']",
      "main h1"
    ];
    for (const selector of selectors) {
      const title = clean(document.querySelector(selector)?.textContent);
      if (title) return title;
    }
    return "";
  }).catch(() => "");
}

export function validateTeamsExtraction(extracted, url) {
  const title = cleanText(extracted?.title || "");
  const comments = Array.isArray(extracted?.comments) ? extracted.comments : [];
  const text = cleanText(extracted?.text || "");
  const failedTitle = /^oops$/i.test(title);
  const emptyCapture = comments.length === 0 || /Messages captured:\s*0/i.test(text);
  const noMessagesNote = /No Teams messages captured/i.test(text);
  if (failedTitle || emptyCapture || noMessagesNote) {
    throw new Error([
      "Teams 抓取没有捕获到有效消息，已跳过更新，避免覆盖已有内容。",
      "请确认 WebDriver 已登录，并且目标聊天/频道页面已经打开。",
      `URL: ${url}`
    ].join(" "));
  }
}

export function extractTeamsConversationId(url) {
  try { return decodeURIComponent(extractTeamsDeepPath(url).match(/^\/l\/chat\/([^/?#]+)/i)?.[1] || ""); } catch { return ""; }
}

export function extractTeamsDeepPath(url) {
  try {
    const parsed = new URL(url);
    if (/^#\/l\/(?:chat|channel|message|team)\//i.test(parsed.hash)) {
      return parsed.hash.slice(1);
    }
    if (/^\/l\/(?:chat|channel|message|team)\//i.test(parsed.pathname)) {
      return `${parsed.pathname}${parsed.search}`;
    }

    const target = parsed.searchParams.get("url") || parsed.searchParams.get("deeplink");
    if (!target) return "";
    const decoded = decodeURIComponent(target);
    if (/^\/_#\/l\/(?:chat|channel|message|team)\//i.test(decoded)) {
      return decoded.replace(/^\/_#/i, "");
    }
    if (/^_#\/l\/(?:chat|channel|message|team)\//i.test(decoded)) {
      return decoded.replace(/^_#/i, "");
    }
    if (/^\/l\/(?:chat|channel|message|team)\//i.test(decoded)) {
      return decoded;
    }
    if (/^https:\/\/(?:teams\.microsoft\.com|teams\.cloud\.microsoft)\//i.test(decoded)) {
      return extractTeamsDeepPath(decoded);
    }
    return "";
  } catch {
    return "";
  }
}

export async function waitForTeamsConversation(page) {
  // Teams keeps long-lived network requests open; wait for message DOM instead.
  await page.waitForSelector("[data-mid], [data-tid='chat-pane-message'], [data-tid='message-container']", { state: "visible", timeout: 20000 });
}

export async function readVisibleTeamsMessages(page) {
  return page.evaluate(extractTeamsMessagesFromDocument);
}

export function mergeTeamsMessages(messages) {
  return mergeTeamsCaptureMessages(messages);
}

export function mergeTeamsComments(comments) {
  return mergeTeamsMessages(comments).map((comment, index) => ({
    id: cleanText(comment.id || `teams-message-${index + 1}`),
    author: cleanText(comment.author || ""),
    createdAt: cleanText(comment.createdAt || ""),
    body: cleanText(comment.body || ""),
    links: Array.isArray(comment.links) ? comment.links : [],
    url: cleanText(comment.url || "")
  }));
}

export function renderTeamsTextFromComments(title, url, adapter, comments) {
  const sourceUpdatedAt = latestTimestampValue(comments.map((comment) => comment.createdAt)) || "";
  const lines = [
    `# ${title || "Microsoft Teams conversation"}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    `Messages captured: ${comments.length}`,
    sourceUpdatedAt ? `Latest message: ${sourceUpdatedAt}` : "",
    "",
    "## Messages",
    "",
    ...(comments.length
      ? comments.map((comment, index) => {
          const heading = [comment.author, comment.createdAt].filter(Boolean).join(" · ");
          return `### ${heading || `消息 ${index + 1}`}\n\n${comment.body || "_Empty message._"}`;
        })
      : ["_No Teams messages captured. Make sure the WebDriver window is logged in and the target chat or channel is open._"])
  ].filter((line) => line !== "");
  return lines.join("\n");
}

export async function scrollTeamsMessages(page, options = {}) {
  const captured = await collectVirtualTeamsMessages({
    maxScrolls: options.maxScrolls || 18,
    minScrollsBeforeOverlapStop: options.minScrollsBeforeOverlapStop || 2,
    previousMessages: options.previousMessages || [],
    signal: options.signal,
    jumpToLatest: () => jumpTeamsToLatest(page),
    readVisible: async () => {
      const visible = await readVisibleTeamsMessages(page);
      if (options.expectedTitle && !areCaptureTitlesConsistent(options.expectedTitle, visible.title || "")) {
        throw new Error(`Teams 会话在抓取期间发生变化：目标“${options.expectedTitle}”，当前“${visible.title || "未知"}”。已阻止写入。`);
      }
      return visible;
    },
    wait: () => page.waitForTimeout(1200),
    returnToLatest: async () => {
      await jumpTeamsToLatest(page);
      await page.waitForTimeout(800);
    },
    scrollOlder: async () => {
      const moved = await page.evaluate(() => {
        const viewport = document.querySelector("[data-tid='message-pane-list-viewport']");
        const candidates = (viewport ? [viewport] : [...document.querySelectorAll("[data-tid='chat-pane-list'], [role='main'], main, [data-tid*='chat'], [data-tid*='message'], div")]
          .filter((el) => el instanceof HTMLElement)
          .filter((el) => el.querySelector("[data-mid]") || el.matches("[data-mid]")))
          .map((el) => ({ el, score: (el.scrollHeight - el.clientHeight) * Math.max(1, el.getBoundingClientRect().height) }))
          .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
        const target = candidates[0]?.el;
        if (!target) return false;
        const before = target.scrollTop;
        target.scrollTop = Math.max(0, target.scrollTop - Math.max(420, Math.floor(target.clientHeight * 0.85)));
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
        return target.scrollTop !== before;
      });
      if (!moved) {
        try { await page.mouse.wheel(0, -900); } catch {}
      }
      return moved;
    }
  });
  const messages = captured.messages;
  Object.defineProperties(messages, {
    completeness: { value: captured.completeness, enumerable: false },
    coverage: { value: captured.coverage, enumerable: false }
  });
  return messages;
}

export async function jumpTeamsToLatest(page) {
  let clicked = false;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clickedThisRound = await page.evaluate(() => {
        const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const labels = [
          "跳转到最新",
          "跳至最新",
          "回到最新",
          "Jump to latest",
          "Go to latest",
          "Latest"
        ];
        const isVisible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.visibility !== "hidden"
            && style.display !== "none"
            && rect.width > 0
            && rect.height > 0;
        };
        const candidates = [...document.querySelectorAll("button, [role='button']")]
          .filter((node) => node instanceof HTMLElement && isVisible(node));
        const target = candidates.find((node) => {
          const text = clean([
            node.innerText,
            node.textContent,
            node.getAttribute("aria-label"),
            node.getAttribute("title")
          ].filter(Boolean).join(" "));
          return labels.some((label) => text.toLowerCase().includes(label.toLowerCase()));
        });
        if (!target) return false;
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return true;
      });
      if (!clickedThisRound) break;
      clicked = true;
      await page.waitForTimeout(1200);
    }
  } catch {
    // Fall back to direct container scrolling below.
  }

  const settled = await settleTeamsAtBottom(page);
  return clicked || settled;
}

export async function settleTeamsAtBottom(page) {
  try {
    let stableBottomRounds = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await page.evaluate(() => {
        const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const labels = ["跳转到最新", "跳至最新", "回到最新", "Jump to latest", "Go to latest", "Latest"];
        const isVisible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.visibility !== "hidden"
            && style.display !== "none"
            && rect.width > 0
            && rect.height > 0;
        };
        const latestButtonVisible = [...document.querySelectorAll("button, [role='button']")]
          .filter((node) => node instanceof HTMLElement && isVisible(node))
          .some((node) => {
            const text = clean([
              node.innerText,
              node.textContent,
              node.getAttribute("aria-label"),
              node.getAttribute("title")
            ].filter(Boolean).join(" "));
            return labels.some((label) => text.toLowerCase().includes(label.toLowerCase()));
        });
        const viewport = document.querySelector("[data-tid='message-pane-list-viewport']");
        const candidates = (viewport ? [viewport] : [...document.querySelectorAll("[data-tid='chat-pane-list'], [role='main'], main, [data-tid*='chat'], [data-tid*='message'], div")]
          .filter((el) => el instanceof HTMLElement)
          .filter((el) => el.querySelector("[data-mid]") || el.matches("[data-mid]")))
          .map((el) => ({
            el,
            score: (el.scrollHeight - el.clientHeight) * Math.max(1, el.getBoundingClientRect().height)
          }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score);
        const targets = candidates.slice(0, 1).map((entry) => entry.el);
        if (!targets.length) return { found: false, moved: false, atBottom: false, latestButtonVisible };
        let moved = false;
        for (const target of targets) {
          const before = target.scrollTop;
          target.scrollTop = target.scrollHeight;
          target.scrollBy?.({ top: target.scrollHeight, behavior: "auto" });
          target.dispatchEvent(new Event("scroll", { bubbles: true }));
          moved = moved || target.scrollTop !== before;
        }
        const primary = targets[0];
        const distanceToBottom = primary.scrollHeight - primary.clientHeight - primary.scrollTop;
        return {
          found: true,
          moved,
          atBottom: distanceToBottom <= 12,
          distanceToBottom,
          latestButtonVisible
        };
      });
      try {
        await page.mouse.wheel(0, 7200);
        await page.keyboard.press("End");
        await page.keyboard.press("PageDown");
      } catch {
        // Direct scroll above is the primary fallback.
      }
      if (!result.found) return false;
      stableBottomRounds = result.atBottom && !result.latestButtonVisible ? stableBottomRounds + 1 : 0;
      if (stableBottomRounds >= 2) return true;
      await page.waitForTimeout(result.moved ? 900 : 700);
    }
    return await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const labels = ["跳转到最新", "跳至最新", "回到最新", "Jump to latest", "Go to latest", "Latest"];
      const isVisible = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const latestButtonVisible = [...document.querySelectorAll("button, [role='button']")]
        .filter((node) => node instanceof HTMLElement && isVisible(node))
        .some((node) => {
          const text = clean([
            node.innerText,
            node.textContent,
            node.getAttribute("aria-label"),
            node.getAttribute("title")
          ].filter(Boolean).join(" "));
          return labels.some((label) => text.toLowerCase().includes(label.toLowerCase()));
      });
      const viewport = document.querySelector("[data-tid='message-pane-list-viewport']");
      const candidates = (viewport ? [viewport] : [...document.querySelectorAll("[data-tid='chat-pane-list'], [role='main'], main, [data-tid*='chat'], [data-tid*='message'], div")]
        .filter((el) => el instanceof HTMLElement)
        .filter((el) => el.querySelector("[data-mid]") || el.matches("[data-mid]")))
        .map((el) => ({
          el,
          score: (el.scrollHeight - el.clientHeight) * Math.max(1, el.getBoundingClientRect().height)
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const target = candidates[0]?.el;
      if (!target || latestButtonVisible) return false;
      return target.scrollHeight - target.clientHeight - target.scrollTop <= 12;
    });
  } catch {
    return false;
  }
}

export function teamsMessageKeySet(messages) {
  const keys = new Set();
  for (const message of messages || []) {
    for (const key of teamsMessageKeys(message)) {
      keys.add(key);
    }
  }
  return keys;
}

export function hasTeamsMessageOverlap(messages, previousKeys) {
  if (!previousKeys?.size) return false;
  for (const message of messages || []) {
    for (const key of teamsMessageKeys(message)) {
      if (previousKeys.has(key)) return true;
    }
  }
  return false;
}

export function teamsMessageKeys(message) {
  return teamsCaptureMessageKeys(message);
}

export async function extractTeamsFromPage(page, url, adapter, observedMessages = []) {
  const visible = await readVisibleTeamsMessages(page);
  const data = {
    title: visible.title,
    messages: mergeTeamsMessages([...(observedMessages || []), ...(visible.messages || [])])
  };

  const comments = data.messages.map((message) => ({
    id: message.id,
    author: message.author,
    createdAt: message.createdAt,
    body: message.body,
    url
  }));
  const sourceUpdatedAt = latestTimestampValue(comments.map((comment) => comment.createdAt)) || "";

  return {
    title: data.title || "Microsoft Teams conversation",
    text: renderTeamsTextFromComments(data.title || "Microsoft Teams conversation", url, adapter, comments),
    comments,
    sourceUpdatedAt,
    completeness: observedMessages?.completeness || "partial",
    coverage: observedMessages?.coverage || { observedCount: comments.length, stoppedBy: "visible-window" }
  };
}
