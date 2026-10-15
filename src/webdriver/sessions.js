// Browser sessions per site: launch (one per profile), reuse, window placement, cookies.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { defaultSourceProfile, normalizeWebdriverWindowMode } from "../settings-schema.js";
import { recordChatsvcAuth } from "../sources/teams-chatsvc.js";
import { BROWSER_DISK_CACHE_BYTES, trimBrowserProfileIfLarge } from "../storage-maintenance.js";
import { safeHostname, slugify } from "../utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export function createWebdriverSessions(ctx) {
  // Functions that live elsewhere, resolved when called.
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);

  async function openWebdriverSession(url, hostname) {
    const target = url || (hostname ? `https://${hostname}` : "https://jira.amlogic.com");
    const adapter = detectSourceAdapter(target);
    const session = await ensureWebdriverSession(adapter.hostname, target, {
      headed: true,
      manual: true,
      autoClose: false
    });
    session.page = await ensureSessionPage(session);
    await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
    return describeWebdriverSession(adapter.hostname, session);
  }

  async function saveWebdriverCookies(url, hostname) {
    const target = url || (hostname ? `https://${hostname}` : "");
    const adapter = detectSourceAdapter(target);
    if (!adapter.hostname) throw new Error("需要 URL 或 hostname 才能保存 Cookie。");
    const session = await ensureWebdriverSession(adapter.hostname, target || `https://${adapter.hostname}`, {
      headed: false,
      autoClose: true
    });
    let cookies = [];
    let cookieHeader = "";
    try {
      cookies = await session.context.cookies(`https://${adapter.hostname}`);
      cookieHeader = cookiesToHeader(cookies);
      if (!cookieHeader) {
        throw new Error("没有读取到可保存的 Cookie。请先在 Webdriver 窗口完成登录。");
      }
    } finally {
      if (session.autoClose) {
        await closeWebdriverSession(session);
      }
    }

    const previous = ctx.settings.sources?.[adapter.hostname] || defaultSourceProfile(adapter.hostname, adapter.sourceType);
    ctx.settings = {
      ...ctx.settings,
      sources: {
        ...(ctx.settings.sources || {}),
        [adapter.hostname]: {
          ...previous,
          hostname: adapter.hostname,
          sourceType: adapter.sourceType,
          authMode: "cookie",
          cookie: cookieHeader
        }
      }
    };
    await ctx.persistSettings();

    return {
      hostname: adapter.hostname,
      authMode: "cookie",
      cookieCount: cookies.length,
      savedAt: new Date().toISOString()
    };
  }

  // One launch per profile at a time: concurrent callers for the same site share it
  // (two persistent contexts on one profile directory would fight over its lock).
  const webdriverLaunches = new Map();

  async function ensureWebdriverSession(hostname, url, options = {}) {
    const key = hostname || safeHostname(url) || "default";
    while (webdriverLaunches.has(key)) await webdriverLaunches.get(key).catch(() => {});
    const launch = ensureWebdriverSessionUnshared(key, url, options);
    webdriverLaunches.set(key, launch);
    try {
      return await launch;
    } finally {
      if (webdriverLaunches.get(key) === launch) webdriverLaunches.delete(key);
    }
  }

  async function waitForWebdriverIdle(session, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Number(session.activeOperations || 0) > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async function ensureWebdriverSessionUnshared(key, url, options = {}) {
    const normalizedOptions = typeof options === "boolean" ? { headed: options } : options;
    const headed = Boolean(normalizedOptions.headed);
    const manual = Boolean(normalizedOptions.manual);
    const profile = ctx.settings.sources?.[key] || {};
    const headless = headed ? false : Boolean(profile.webdriverHeadless);
    const autoClose = Boolean(normalizedOptions.autoClose && !manual);
    const windowMode = normalizeWebdriverWindowMode(normalizedOptions.windowMode || profile.webdriverWindowMode);
    const existing = ctx.webdriverSessions.get(key);
    if (existing) {
      const needsRelaunch = (headed && existing.headless) || (manual && !existing.manual);
      const inUse = Number(existing.activeOperations || 0) > 0;
      // A different window placement alone is not worth interrupting work in progress.
      if (!needsRelaunch && (existing.windowMode === windowMode || inUse)) return existing;
      if (inUse) await waitForWebdriverIdle(existing);
      await existing.context.close().catch(() => {});
    }

    await fs.mkdir(ctx.webdriverRoot, { recursive: true });
    await fs.chmod(ctx.webdriverRoot, 0o700).catch(() => {});
    const userDataDir = path.join(ctx.webdriverRoot, slugify(key));
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.chmod(userDataDir, 0o700).catch(() => {});
    await trimBrowserProfileIfLarge(userDataDir).catch((error) => console.warn(`Browser cache trim skipped for ${key}: ${error.message}`));
    const windowPlacement = webdriverWindowPlacement(windowMode, manual);
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: windowPlacement.size,
      args: [
        "--disable-blink-features=AutomationControlled",
        // Keep rendering and timers running while the window is off screen or covered.
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        `--disk-cache-size=${BROWSER_DISK_CACHE_BYTES}`,
        `--window-size=${windowPlacement.size.width},${windowPlacement.size.height}`,
        `--window-position=${windowPlacement.position.x},${windowPlacement.position.y}`,
        ...windowPlacement.args
      ]
    });
    const page = context.pages()[0] || await context.newPage();
    const session = {
      hostname: key,
      userDataDir,
      context,
      page,
      headless,
      windowMode,
      manual,
      autoClose,
      startedAt: new Date().toISOString()
    };
    if (/teams/i.test(key)) recordChatsvcAuth(context, session);
    ctx.webdriverSessions.set(key, session);
    context.on("close", () => {
      if (ctx.webdriverSessions.get(key) === session) ctx.webdriverSessions.delete(key);
    });
    return session;
  }

  async function closeWebdriverSession(session) {
    try {
      await session.context.close();
    } catch {
      // The user or browser may have already closed it.
    }
  }

  async function ensureSessionPage(session) {
    if (session.page && !session.page.isClosed()) return session.page;
    const existingPage = session.context.pages().find((page) => !page.isClosed());
    if (existingPage) return existingPage;
    return session.context.newPage();
  }

  function cookiesToHeader(cookies) {
    return cookies
      .filter((cookie) => cookie.name && typeof cookie.value === "string")
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  async function webdriverStatus() {
    const sessions = [];
    for (const [hostname, session] of ctx.webdriverSessions.entries()) {
      sessions.push(describeWebdriverSession(hostname, session));
    }
    return sessions;
  }

  function describeWebdriverSession(hostname, session) {
    return {
      hostname,
      userDataDir: session.userDataDir,
      headless: Boolean(session.headless),
      windowMode: session.windowMode || "compact",
      manual: Boolean(session.manual),
      autoClose: Boolean(session.autoClose),
      startedAt: session.startedAt,
      url: session.page?.url?.() || ""
    };
  }

  function webdriverWindowPlacement(mode, manual) {
    // Full-size window parked off screen: Teams needs a real viewport to render its
    // virtualized message list, but should not cover the user's work.
    if (mode === "background") {
      return {
        size: { width: 1200, height: 820 },
        position: { x: -2600, y: 80 },
        args: []
      };
    }
    if (mode === "normal") {
      return {
        size: manual ? { width: 1000, height: 720 } : { width: 900, height: 640 },
        position: manual ? { x: 80, y: 80 } : { x: -2400, y: 80 },
        args: []
      };
    }

    if (mode === "minimized") {
      return {
        size: { width: 420, height: 260 },
        position: { x: -3000, y: 80 },
        args: ["--start-minimized"]
      };
    }

    return {
      size: { width: manual ? 520 : 420, height: manual ? 420 : 260 },
      position: manual ? { x: -2200, y: 80 } : { x: -3000, y: 80 },
      args: []
    };
  }

  return { openWebdriverSession, saveWebdriverCookies, ensureWebdriverSession, closeWebdriverSession, ensureSessionPage, webdriverStatus };
}
