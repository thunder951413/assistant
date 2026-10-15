// Capturing pages through the browser: navigation, GitHub expansion, issue search, Teams chat service.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { shouldCloseOwnedWebdriverSession, withWebdriverSessionQueue } from "../capture-policy.js";
import { areCaptureTitlesConsistent } from "../capture-utils.js";
import { collectGithubIssueRows, githubIssueRowsToEntries, githubIssueSearchPageUrl, githubIssueSearchTitle, isGithubIssueSearchUrl, renderGithubIssueSearchText } from "../sources/github-issue-search.js";
import { clickGithubLoadMore, githubPageGrowthSnapshot } from "../sources/github-page.js";
import { assertFetchedPageIsAuthenticated } from "../sources/html-extractors.js";
import { collectChatsvcMessages, fetchChatsvcTopic } from "../sources/teams-chatsvc.js";
import { extractTeamsConversationId, extractTeamsFromPage, isTeamsWebAppReady, openTeamsConversationFromUi, renderTeamsTextFromComments, scrollTeamsMessages, validateTeamsExtraction, waitForTeamsConversation } from "../sources/teams-page.js";
import { latestTimestampValue } from "../text-helpers.js";
import { cleanText, safeHostname, safePathname } from "../utils.js";

export function createWebdriverFetch(ctx) {
  // Functions that live elsewhere, resolved when called.
  const canonicalizeMaterialUrl = (...args) => ctx.canonicalizeMaterialUrl(...args);
  const closeWebdriverSession = (...args) => ctx.closeWebdriverSession(...args);
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);
  const ensureSessionPage = (...args) => ctx.ensureSessionPage(...args);
  const ensureWebdriverPageAuthenticated = (...args) => ctx.ensureWebdriverPageAuthenticated(...args);
  const ensureWebdriverSession = (...args) => ctx.ensureWebdriverSession(...args);
  const extractByAdapter = (...args) => ctx.extractByAdapter(...args);
  const fetchUrlFromSourceApi = (...args) => ctx.fetchUrlFromSourceApi(...args);
  const findItemByUrl = (...args) => ctx.findItemByUrl(...args);
  const normalizeUrlForMatch = (...args) => ctx.normalizeUrlForMatch(...args);
  const prepareTeamsRefreshGroup = (...args) => ctx.prepareTeamsRefreshGroup(...args);
  const readItem = (...args) => ctx.readItem(...args);
  const resolvePageKind = (...args) => ctx.resolvePageKind(...args);
  const updateRefreshRun = (...args) => ctx.updateRefreshRun(...args);

  async function fetchUrlWithWebdriver(url, options = {}) {
    if (!url) throw new Error("URL is required.");
    const adapter = detectSourceAdapter(url);
    if (adapter.sourceType !== "teams" && options.apiFirst !== false) {
      try {
        const apiResult = await fetchUrlFromSourceApi(url, adapter, options);
        if (apiResult) return apiResult;
      } catch (error) {
        if (options.signal?.aborted || error?.name === "AbortError") throw error;
        console.warn(`Source API fallback to WebDriver for ${url}:`, error.message || error);
      }
    }
    const existingSession = options.session || ctx.webdriverSessions.get(adapter.hostname);
    const session = options.session || await ensureWebdriverSession(adapter.hostname, url, {
      headed: adapter.sourceType === "teams" ? true : Boolean(options.headed),
      manual: adapter.sourceType === "teams",
      autoClose: adapter.sourceType === "teams" ? false : options.keepSession !== true,
      windowMode: adapter.sourceType === "teams" ? "background" : undefined
    });
    const ownsSession = !options.session && !existingSession;
    session.activeOperations = Number(session.activeOperations || 0) + 1;
    if (ownsSession && session.autoClose) session.closeWhenIdle = true;
    // One persistent browser page represents a hostname. Serialize navigation
    // across preview, direct refresh, and scheduled refresh callers.
    try {
      return await withWebdriverSessionQueue(session, () => fetchUrlWithWebdriverInSession(url, { ...options, session }));
    } finally {
      session.activeOperations = Math.max(0, Number(session.activeOperations || 1) - 1);
      if (shouldCloseOwnedWebdriverSession(session, ownsSession)) await closeWebdriverSession(session);
    }
  }

  async function fetchUrlWithWebdriverInSession(url, options = {}) {
    const adapter = detectSourceAdapter(url);
    const session = options.session;
    try {
      const page = options.page && !options.page.isClosed()
        ? options.page
        : await ensureSessionPage(session);
      session.page = page;
      if (adapter.sourceType === "teams" && !(session.teamsUserConfirmedAt && await isTeamsWebAppReady(page))) {
        await prepareTeamsRefreshGroup(page, adapter, options.run || null, session);
      }
      const navigationUrl = url;
      if (adapter.sourceType === "github" && resolvePageKind(url, options.pageKind || "auto") === "content") {
        try {
          await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10000 });
        } catch {
          // Best-effort reset to avoid stale GitHub SPA state before the next issue/PR.
        }
      }
      let teamsLocation = null;
      if (adapter.sourceType === "teams") {
        // Message API first: no UI navigation or scrolling, full history paging.
        const viaApi = await fetchTeamsViaChatsvc(session, page, url, adapter, options);
        if (viaApi) return viaApi;
        teamsLocation = await openTeamsConversationFromUi(page, {
          title: options.teamsConversationTitle,
          url,
          signal: options.signal || options.run?.abortController?.signal,
          onProgress: (text) => { if (options.run) updateRefreshRun(options.run, { status: "running", currentJobName: text }); }
        });
      } else {
        await navigateWebdriverPage(page, navigationUrl, adapter);
      }
      await ensureWebdriverPageAuthenticated(page, navigationUrl, adapter);
      if (adapter.sourceType === "github" && isGithubIssueSearchUrl(url)) {
        return await fetchGithubIssueSearchWithWebdriver(page, url, adapter, options);
      }
      await waitForJiraIssueNavigator(page, adapter, options.pageKind || "auto");
      await expandGithubDynamicContent(page, adapter, options.pageKind || "auto", {
        maxPasses: options.maxGithubExpansionPasses,
        existingComments: options.existingGithubComments || []
      });
      if (adapter.sourceType === "teams") {
        return await fetchTeamsWithWebdriver(page, url, adapter, {
          signal: options.signal || options.run?.abortController?.signal,
          expectedTitle: teamsLocation?.title || options.teamsConversationTitle,
          locatedConversationId: teamsLocation?.conversationId || "",
          identityVerifiedById: Boolean(teamsLocation?.identityVerifiedById)
        });
      }
      const raw = await page.content();
      const currentUrl = page.url();
      const extractionUrl = resolvePageKind(url, options.pageKind || "auto") === "list" ? url : currentUrl || url;
      const extracted = extractByAdapter(raw, extractionUrl, adapter, options.pageKind || "auto");
      const title = extracted.title || await page.title();
      assertFetchedPageIsAuthenticated({
        adapter,
        requestedUrl: url,
        finalUrl: currentUrl,
        title,
        raw
      });
      return {
        raw,
        title,
        text: extracted.text,
        comments: extracted.comments || [],
        sourceUpdatedAt: extracted.sourceUpdatedAt || "",
        url: currentUrl,
        fetchMethod: "webdriver"
      };
    } finally {}
  }

  async function fetchGithubIssueSearchWithWebdriver(page, url, adapter, options = {}) {
    const maxItems = Math.max(1, Number(options.maxItems) || 100);
    const maxPages = Math.min(10, Math.ceil(maxItems / 25) + 1);
    const rows = [];
    const seen = new Set();
    let pageUrl = url;
    let pageIndex = 1;
    let emptyConfirmed = false;
    let exhausted = false;
    let totalText = "";
    let expectedCount = null;
    while (pageIndex <= maxPages) {
      if (pageIndex > 1) {
        await navigateWebdriverPage(page, pageUrl, adapter);
        await ensureWebdriverPageAuthenticated(page, pageUrl, adapter);
      }
      await page.waitForFunction(() => {
        const text = document.body?.innerText || "";
        return Boolean(document.querySelector("a[href*='/issues/'], a[href*='/pull/']"))
          || /No results|No (open |closed )?(issues|pull requests)|didn't match any|没有结果/i.test(text);
      }, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      const collected = await page.evaluate(collectGithubIssueRows, page.url() || pageUrl);
      totalText = totalText || collected.totalText;
      if (pageIndex === 1) expectedCount = collected.expectedCount ?? null;
      if (pageIndex === 1 && collected.emptyConfirmed) emptyConfirmed = true;
      let added = 0;
      for (const row of collected.rows) {
        const key = row.href.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
        added += 1;
      }
      if (rows.length >= maxItems) break;
      // Follow the page's own "next" link; otherwise try ?page=N while it keeps yielding new rows.
      const next = collected.nextHref || (added > 0 && collected.rows.length >= 20 ? githubIssueSearchPageUrl(url, pageIndex + 1) : "");
      if (!next || added === 0) { exhausted = true; break; }
      pageUrl = next;
      pageIndex += 1;
    }
    const entries = githubIssueRowsToEntries(rows.slice(0, maxItems));
    const title = githubIssueSearchTitle(url);
    // The page's own count ("Open 7") must agree before anything can be judged as gone.
    const countAgrees = expectedCount === null || rows.length >= expectedCount;
    const complete = (exhausted && rows.length <= maxItems && countAgrees) || emptyConfirmed;
    // Nothing recognized and no explicit "no results": keep the page so the layout can be diagnosed.
    const diagnosticHtml = !rows.length && !emptyConfirmed ? String(await page.content().catch(() => "")).slice(0, 400000) : undefined;
    return {
      raw: JSON.stringify({ url, pages: pageIndex, totalText, rows, diagnosticHtml }, null, 2),
      title,
      text: renderGithubIssueSearchText(title, url, adapter.id, entries, totalText ? `Count: ${totalText}` : ""),
      comments: [],
      url,
      fetchMethod: "webdriver",
      entries,
      completeness: complete ? "complete" : "partial",
      coverage: { observedCount: entries.length, expectedCount, pageCount: pageIndex, totalText },
      // Only a fully observed list may mark earlier items as having left it.
      membershipComplete: complete && (entries.length > 0 || emptyConfirmed)
    };
  }

  function isAuthenticationRequiredError(error) {
    return /检测到\s+.+未登录，已停止抓取/.test(error?.message || String(error));
  }

  async function navigateWebdriverPage(page, navigationUrl, adapter) {
    try {
      await page.goto(navigationUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (error) {
      if (!isRecoverableNavigationError(error) || page.isClosed()) {
        throw error;
      }

      await waitForRecoveredNavigation(page, navigationUrl, adapter, error);
    }
  }

  function isRecoverableNavigationError(error) {
    const message = error?.message || String(error);
    return /net::ERR_ABORTED|Execution context was destroyed|maybe frame was detached/i.test(message);
  }

  async function waitForRecoveredNavigation(page, navigationUrl, adapter, originalError) {
    const targetHostname = safeHostname(navigationUrl);
    const targetPathname = safePathname(navigationUrl);
    try {
      await page.waitForFunction(
        ({ hostname, pathname }) => {
          const currentPath = window.location.pathname || "";
          return window.location.hostname === hostname
            && (!pathname || currentPath === pathname || currentPath.endsWith(pathname));
        },
        { hostname: targetHostname, pathname: targetPathname },
        { timeout: adapter.sourceType === "github" ? 20000 : 10000 }
      );
    } catch {
      // The page may have recovered through an auth redirect; validate the DOM below.
    }

    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    } catch {
      // Some internal apps keep replacing the document while settling.
    }
    try {
      await page.waitForSelector("body", { timeout: 10000 });
    } catch {
      // Fall through to the explicit validation below.
    }
    await page.waitForTimeout(adapter.sourceType === "github" ? 1200 : 500);

    const recovered = await page.evaluate(() => ({
      href: window.location.href,
      bodyLength: document.body?.innerText?.trim().length || 0,
      title: document.title || ""
    })).catch(() => null);
    const currentHostname = safeHostname(recovered?.href || page.url());
    const sameTarget = !targetHostname || currentHostname === targetHostname;
    const loadedDocument = Boolean(recovered && (recovered.bodyLength > 0 || recovered.title));
    if (!sameTarget || !loadedDocument) {
      throw originalError;
    }
  }

  const CHATSVC_AUTH_MAX_AGE_MS = 20 * 60 * 1000;

  // Waits for the Teams page to send a chatsvc request so its current auth headers
  // are known; reloads the app once when the recorded headers are stale.
  async function ensureChatsvcAuth(session, page, { forceRefresh = false } = {}) {
    const fresh = () => session.chatsvcAuth && Date.now() - session.chatsvcAuth.seenAt < CHATSVC_AUTH_MAX_AGE_MS;
    if (!forceRefresh && fresh()) return session.chatsvcAuth;
    const before = session.chatsvcAuth?.seenAt || 0;
    if (forceRefresh || session.chatsvcAuth) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (session.chatsvcAuth && session.chatsvcAuth.seenAt > before) return session.chatsvcAuth;
      await page.waitForTimeout(500);
    }
    return null;
  }

  // Teams capture through the chatsvc API the web client uses. Returns null (so the
  // caller falls back to UI navigation) when no conversation id or auth is available.
  async function fetchTeamsViaChatsvc(session, page, url, adapter, options = {}) {
    const conversationId = extractTeamsConversationId(url);
    if (!conversationId) return null;
    const signal = options.signal || options.run?.abortController?.signal;
    try {
      let auth = await ensureChatsvcAuth(session, page);
      if (!auth) return null;
      const requestJson = async (target) => {
        const response = await page.context().request.get(target, { headers: session.chatsvcAuth.headers, timeout: 30000 });
        return { status: response.status(), json: response.ok() ? await response.json() : null };
      };
      const stableUrl = canonicalizeMaterialUrl(url) || url;
      const previous = await readExistingTeamsComments(stableUrl);
      // Rows stored by older page extractors have no real message id. While any remain,
      // do one full backfill so the API copies (same author + time) supersede them.
      const hasLegacyRows = previous.some((comment) => !/^(?:message-body-)?\d{13}$/.test(String(comment.id || "")));
      const knownIds = hasLegacyRows ? new Set() : new Set(previous.flatMap((comment) => [comment.id, comment.createdAt].filter(Boolean)));
      if (options.run) updateRefreshRun(options.run, { status: "running", currentJobName: `正在通过 Teams 接口读取：${options.teamsConversationTitle || conversationId}` });
      let collected;
      try {
        collected = await collectChatsvcMessages({ requestJson, base: auth.base, conversationId, conversationUrl: stableUrl, knownIds, signal });
      } catch (error) {
        if (![401, 403].includes(error.status)) throw error;
        auth = await ensureChatsvcAuth(session, page, { forceRefresh: true });
        if (!auth) return null;
        collected = await collectChatsvcMessages({ requestJson, base: auth.base, conversationId, conversationUrl: stableUrl, knownIds, signal });
      }
      if (!collected.comments.length && !previous.length) return null;
      const title = await fetchChatsvcTopic({ requestJson, base: auth.base, conversationId })
        || options.teamsConversationTitle || "Microsoft Teams conversation";
      // A message deleted before it was ever captured has no text to keep; one captured
      // earlier keeps its stored text (the merge never replaces a body with an empty one).
      const storedIds = new Set(previous.map((comment) => comment.id));
      const comments = collected.comments.map((comment) => comment.body || storedIds.has(comment.id)
        ? comment
        : { ...comment, body: comment.deletedAt ? "[消息已删除]" : "[空消息]" });
      return {
        raw: JSON.stringify({ title, conversationId, coverage: collected.coverage, messages: comments }, null, 2),
        title,
        text: renderTeamsTextFromComments(title, stableUrl, adapter, comments),
        comments,
        sourceUpdatedAt: latestTimestampValue(comments.map((comment) => comment.createdAt)) || "",
        url: stableUrl,
        fetchMethod: "teams-chatsvc",
        completeness: collected.completeness,
        coverage: collected.coverage,
        identityEvidence: { method: "chatsvc-conversation-id", conversationId, verified: true },
        conversationId
      };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      console.warn(`Teams message API unavailable for ${conversationId}, falling back to the page:`, error.message || error);
      return null;
    }
  }

  async function fetchTeamsWithWebdriver(page, url, adapter, options = {}) {
    if (options.signal?.aborted) throw new DOMException("Capture canceled", "AbortError");
    await waitForTeamsConversation(page);
    const stableUrl = canonicalizeMaterialUrl(url) || page.url() || url;
    const previousComments = await readExistingTeamsComments(stableUrl);
    const observedMessages = await scrollTeamsMessages(page, {
      maxScrolls: 18,
      extendedMaxScrolls: 150,
      deadlineMs: ctx.TEAMS_GAP_SCROLL_DEADLINE_MS,
      previousMessages: previousComments,
      minScrollsBeforeOverlapStop: 2,
      expectedTitle: options.expectedTitle,
      signal: options.signal
    });
    if (options.signal?.aborted) throw new DOMException("Capture canceled", "AbortError");
    const currentUrl = page.url();
    const currentId = extractTeamsConversationId(currentUrl);
    const expectedId = extractTeamsConversationId(stableUrl);
    if (currentId && expectedId && currentId !== expectedId) throw new Error("Teams 当前群组与目标会话 ID 不一致，已停止抓取。");
    const finalUrl = stableUrl || currentUrl || url;
    const extracted = await extractTeamsFromPage(page, finalUrl, adapter, observedMessages);
    if (options.expectedTitle && !areCaptureTitlesConsistent(options.expectedTitle, extracted.title || "")) {
      throw new Error(`Teams 对话定位失败：目标“${options.expectedTitle}”，当前聊天“${extracted.title || "未知"}”。已阻止抓取。`);
    }
    validateTeamsExtraction(extracted, finalUrl);
    return {
      raw: JSON.stringify({ title: extracted.title, messages: extracted.comments, coverage: observedMessages.coverage || {} }, null, 2),
      title: extracted.title || await page.title(),
      text: extracted.text,
      comments: extracted.comments || [],
      sourceUpdatedAt: extracted.sourceUpdatedAt || "",
      url: finalUrl,
      fetchMethod: "webdriver",
      completeness: "partial",
      coverage: { ...(observedMessages.coverage || {}), observedCount: extracted.comments?.length || 0 },
      identityEvidence: { method: options.identityVerifiedById ? "conversation-list-id" : "title-only", conversationId: options.locatedConversationId || currentId, verified: Boolean(options.identityVerifiedById) },
      conversationId: cleanText(options.locatedConversationId || currentId)
    };
  }

  async function readExistingTeamsComments(url) {
    const existing = await findItemByUrl(canonicalizeMaterialUrl(url) || url);
    if (!existing?.id) return [];
    try {
      const item = await readItem(existing.id);
      return Array.isArray(item.comments) ? item.comments : [];
    } catch {
      return [];
    }
  }

  async function waitForJiraIssueNavigator(page, adapter, pageKind) {
    if (adapter.sourceType !== "jira") return;
    if (pageKind !== "list" && pageKind !== "auto") return;
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {
      // Jira may keep long-polling; DOM content is enough for extraction.
    }
    try {
      await page.waitForSelector("a[href*='/browse/'], tr[data-issuekey], .login-link", { timeout: 15000 });
    } catch {
      // Keep the current HTML; parser will report if nothing was extracted.
    }
  }

  async function expandGithubDynamicContent(page, adapter, pageKind, options = {}) {
    if (adapter.sourceType !== "github") return;
    const kind = resolvePageKind(page.url(), pageKind || "auto");
    if (kind === "list") return;
    const shouldWaitForTimeline = kind !== "list" && /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(safePathname(page.url()));
    const shouldExpandLoadMore = shouldWaitForTimeline;
    if (!shouldExpandLoadMore) return;

    try {
      if (shouldWaitForTimeline) {
        await page.waitForSelector("[data-target='react-app.embeddedData'], [id^='issuecomment-'], [data-testid='issue-viewer-issue-container']", {
          timeout: 15000
        });
      }
    } catch {
      // Keep current DOM; extraction will fall back to embedded data or plain HTML.
    }
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {
      // GitHub can keep background subscriptions open.
    }

    if (await currentGithubPageCoversExisting(page, adapter, options.existingComments || [])) {
      return;
    }

    let stableCount = 0;
    const configuredPasses = Number(options.maxPasses);
    const maxPasses = Number.isFinite(configuredPasses)
      ? Math.max(0, configuredPasses)
      : adapter.hostname === "github.ecodesamsung.com" ? 12 : 30;
    for (let index = 0; index < maxPasses; index += 1) {
      const before = await githubPageGrowthSnapshot(page);
      const clicked = await clickGithubLoadMore(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // Wait for the lazy-loaded page to arrive. GitHub's "Load more" fires a
      // GraphQL request; give it room, then settle on network idle.
      try {
        await page.waitForLoadState("networkidle", { timeout: clicked ? 6000 : 1500 });
      } catch {
        // GitHub keeps subscriptions open; fall back to a fixed settle delay.
      }
      await page.waitForTimeout(clicked ? 900 : 400);
      const after = await githubPageGrowthSnapshot(page);
      if ((options.existingComments || []).length
        && after.comments >= Math.ceil(options.existingComments.length * 0.9)) {
        break;
      }
      if (clicked) {
        stableCount = 0;
      } else if (after.comments <= before.comments
        && after.height <= before.height + 8
        && after.textLength <= before.textLength + 40) {
        stableCount += 1;
        if (stableCount >= 2) break;
      } else {
        stableCount = 0;
      }
    }
  }

  async function currentGithubPageCoversExisting(page, adapter, existingComments) {
    if (!Array.isArray(existingComments) || !existingComments.length) return false;
    const raw = await page.content();
    const extracted = extractByAdapter(raw, page.url(), adapter, "content");
    return githubCommentsCoverExisting(extracted.comments || [], existingComments);
  }

  function githubCommentsCoverExisting(currentComments, existingComments) {
    const existingKeys = githubCommentKeySet(existingComments);
    if (!existingKeys.size) return false;
    const current = currentComments || [];
    const overlapCount = current.filter((comment) => githubCommentKeys(comment).some((key) => existingKeys.has(key))).length;
    return current.length >= Math.ceil(existingComments.length * 0.9)
      && overlapCount >= Math.ceil(existingComments.length * 0.8);
  }

  function githubCommentKeySet(comments) {
    const keys = new Set();
    for (const comment of comments || []) {
      for (const key of githubCommentKeys(comment)) keys.add(key);
    }
    return keys;
  }

  function githubCommentKeys(comment) {
    const id = cleanText(comment?.id || "");
    const url = normalizeUrlForMatch(comment?.url || "");
    const author = cleanText(comment?.author || "").toLowerCase();
    const createdAt = cleanText(comment?.createdAt || "");
    const body = cleanText(comment?.body || "").slice(0, 240).toLowerCase();
    return [
      id ? `id:${id}` : "",
      url ? `url:${url}` : "",
      author && createdAt && body ? `body:${author}|${createdAt}|${body}` : ""
    ].filter(Boolean);
  }

  return { fetchUrlWithWebdriver, isAuthenticationRequiredError, navigateWebdriverPage };
}
