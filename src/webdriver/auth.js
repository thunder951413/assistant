// Sign-in checks in the browser: Jira login, Teams readiness and showing the window for login.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { assertFetchedPageIsAuthenticated, detectAuthenticationPage } from "../sources/html-extractors.js";
import { isTeamsWebAppReady, waitForTeamsReady } from "../sources/teams-page.js";
import { safeHostname } from "../utils.js";

export function createWebdriverAuth(ctx) {
  // Functions that live elsewhere, resolved when called.
  const navigateWebdriverPage = (...args) => ctx.navigateWebdriverPage(...args);
  const normalizeUrlForMatch = (...args) => ctx.normalizeUrlForMatch(...args);
  const sendSystemNotification = (...args) => ctx.sendSystemNotification(...args);
  const updateRefreshRun = (...args) => ctx.updateRefreshRun(...args);

  function shouldPrecheckAuthentication(adapter) {
    return ["jira", "github", "confluence"].includes(adapter.sourceType);
  }

  async function verifyWebdriverAuthentication(page, url, adapter) {
    await navigateWebdriverPage(page, url, adapter);
    await ensureWebdriverPageAuthenticated(page, url, adapter);
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
      // Auth pages and internal apps can keep background requests open.
    }
    const raw = await page.content();
    assertFetchedPageIsAuthenticated({
      adapter,
      requestedUrl: url,
      finalUrl: page.url(),
      title: await page.title(),
      raw
    });
  }

  async function ensureWebdriverPageAuthenticated(page, url, adapter) {
    if (adapter.sourceType !== "jira") return;
    let raw = await page.content();
    let login = detectAuthenticationPage({
      adapter,
      requestedUrl: url,
      finalUrl: page.url(),
      title: await page.title(),
      raw
    });
    if (!login) return;

    const loggedIn = await loginJiraWithWebdriver(page, url, adapter);
    if (!loggedIn) return;

    raw = await page.content();
    login = detectAuthenticationPage({
      adapter,
      requestedUrl: url,
      finalUrl: page.url(),
      title: await page.title(),
      raw
    });
    if (!login) return;

    await navigateWebdriverPage(page, url, adapter);
  }

  async function loginJiraWithWebdriver(page, returnUrl, adapter) {
    const profile = ctx.settings.sources?.[adapter.hostname] || {};
    if (profile.authMode !== "basic" || !profile.username || !profile.password) return false;

    await navigateWebdriverPage(page, jiraLoginUrl(returnUrl, adapter), adapter);
    let username = page.locator("input[name='os_username']:visible, input#login-form-username:visible").first();
    try {
      await username.waitFor({ state: "visible", timeout: 6000 });
    } catch {
      await clickJiraLoginLink(page);
      username = page.locator("input[name='os_username']:visible, input#login-form-username:visible").first();
      try {
        await username.waitFor({ state: "visible", timeout: 8000 });
      } catch {
        return false;
      }
    }

    const password = page.locator("input[name='os_password']:visible, input#login-form-password:visible").first();
    await username.fill(profile.username, { timeout: 5000 });
    await password.fill(profile.password, { timeout: 5000 });
    await page.locator("input[name='os_cookie']:visible, input#login-form-remember-me:visible").first().check({ timeout: 2000 }).catch(() => {});
    const submit = page.locator("input#login-form-submit:visible, input[name='login']:visible, input[value='Log In']:visible, button[type='submit']:visible").first();
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
      submit.click({ timeout: 3000 }).catch(() => password.press("Enter", { timeout: 5000 }))
    ]);
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
      // Jira often keeps background requests open.
    }
    if (normalizeUrlForMatch(page.url()) !== normalizeUrlForMatch(returnUrl)) {
      await navigateWebdriverPage(page, returnUrl, adapter);
    }
    return true;
  }

  async function clickJiraLoginLink(page) {
    const candidates = [
      ".login-link",
      "a[href*='login.jsp']",
      "text=Log In",
      "text=Log in"
    ];
    for (const selector of candidates) {
      try {
        const target = page.locator(selector).first();
        await target.click({ timeout: 3000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
        return true;
      } catch {
        // Try the next login affordance.
      }
    }
    return false;
  }

  function jiraLoginUrl(returnUrl, adapter) {
    try {
      const target = new URL(returnUrl);
      const destination = `${target.pathname}${target.search}${target.hash}`;
      return `https://${adapter.hostname}/login.jsp?os_destination=${encodeURIComponent(destination)}`;
    } catch {
      return `https://${adapter.hostname}/login.jsp`;
    }
  }

  // Brings the Teams WebDriver window on screen (only when the user has to sign in)
  // or parks it off screen again. Rendering keeps running off screen because sessions
  // are launched with the occlusion/background throttling switches disabled.
  async function setWebdriverWindowOnScreen(page, onScreen) {
    let cdp;
    try {
      cdp = await page.context().newCDPSession(page);
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: onScreen
        ? { left: 80, top: 80, width: 1200, height: 820 }
        : { left: -2600, top: 80, width: 1200, height: 820 } });
      if (onScreen) await page.bringToFront();
    } catch {
      // Window placement is best effort; capture does not depend on it.
    } finally {
      await cdp?.detach().catch(() => {});
    }
  }

  async function teamsNeedsSignIn(page) {
    if (!page || page.isClosed()) return false;
    if (/(^|\.)(login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com)$/i.test(safeHostname(page.url()))) return true;
    return page.evaluate(() => Boolean(document.querySelector("input[type='email'], input[name='loginfmt'], input[name='passwd'], input[type='password']"))).catch(() => false);
  }

  // Teams sometimes shows "Use the web app instead" / "Continue on this browser".
  async function clickTeamsUseWebApp(page) {
    if (!page || page.isClosed()) return false;
    return page.evaluate(() => {
      const labels = /use the web app|continue on this browser|使用 ?web ?应用|使用网页版|在此浏览器中继续/i;
      const target = [...document.querySelectorAll("a, button, [role='button']")]
        .find((element) => labels.test(String(element.innerText || element.getAttribute("aria-label") || "")));
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
  }

  // Waits until the Teams web app is usable and continues automatically. The user is
  // only involved when Teams actually needs a sign-in: the window is brought on screen,
  // the run says so, and capture resumes by itself once the chat UI is ready.
  async function prepareTeamsRefreshGroup(page, adapter, run = null, session = null) {
    const host = safeHostname(page.url());
    const onTeams = /(^|\.)teams\.(microsoft\.com|cloud\.microsoft)$/i.test(host);
    const inSignIn = /(^|\.)(microsoftonline\.com|microsoft\.com|live\.com)$/i.test(host);
    if (!onTeams && !inSignIn) {
      await page.goto(`https://${adapter.hostname}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
    const assertActive = () => {
      if (run?.cancelRequested || page.isClosed()) {
        const error = new Error("Teams 登录等待已取消。");
        error.code = "REFRESH_ABORTED";
        throw error;
      }
    };
    let surfaced = false;
    const ready = await waitForTeamsReady({
      isReady: async () => { assertActive(); return isTeamsWebAppReady(page); },
      needsUserAction: () => teamsNeedsSignIn(page),
      tryContinueInBrowser: () => clickTeamsUseWebApp(page),
      wait: (ms) => page.waitForTimeout(ms),
      signal: run?.abortController?.signal,
      timeoutMs: ctx.TEAMS_LOGIN_TIMEOUT_MS,
      onLoginRequired: async () => {
        surfaced = true;
        await setWebdriverWindowOnScreen(page, true);
        if (run) {
          updateRefreshRun(run, {
            status: "waiting_for_teams_confirmation",
            currentJobId: "",
            currentJobName: "Teams 需要登录：请在弹出的浏览器窗口中完成登录，登录后会自动继续"
          });
        }
        await sendSystemNotification("Teams 需要登录", "请在弹出的浏览器窗口中完成登录，登录后刷新会自动继续。").catch(() => {});
      },
      onReady: async () => {
        const readyAt = new Date().toISOString();
        if (session) session.teamsUserConfirmedAt = readyAt;
        if (surfaced) await setWebdriverWindowOnScreen(page, false);
        if (run) {
          updateRefreshRun(run, {
            teamsReadyConfirmed: true,
            teamsReadyConfirmedAt: readyAt,
            status: "running",
            currentJobName: "Teams 已就绪，准备定位目标对话"
          });
        }
      }
    });
    if (!ready) {
      throw new Error([
        "等待 Teams 登录超时，已停止抓取。",
        "浏览器窗口会继续保留；登录完成后下一次刷新会自动继续。"
      ].join(" "));
    }
  }

  return { shouldPrecheckAuthentication, verifyWebdriverAuthentication, ensureWebdriverPageAuthenticated, prepareTeamsRefreshGroup };
}
