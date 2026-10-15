// What one refresh does: list pages (children, skipping, membership) and content pages.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { prepareListCapture } from "./capture-policy.js";
import { areCaptureTitlesConsistent } from "./capture-utils.js";
import { MEMBERSHIP_KEPT, MEMBERSHIP_LEFT, MEMBERSHIP_MEMBER, diffListMembership, membershipPatch, shouldSkipByListFingerprint } from "./list-membership.js";
import { extractContentLinksFromList } from "./sources/html-extractors.js";
import { extractTeamsConversationId, teamsConversationTitleForJob } from "./sources/teams-page.js";
import { cleanText, normalizeTags } from "./utils.js";

export function createRefreshCapture(ctx) {
  // Functions that live elsewhere, resolved when called.
  const assertRefreshActive = (...args) => ctx.assertRefreshActive(...args);
  const closeWebdriverSession = (...args) => ctx.closeWebdriverSession(...args);
  const deleteItem = (...args) => ctx.deleteItem(...args);
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);
  const ensureSessionPage = (...args) => ctx.ensureSessionPage(...args);
  const ensureWebdriverSession = (...args) => ctx.ensureWebdriverSession(...args);
  const fetchUrl = (...args) => ctx.fetchUrl(...args);
  const fetchUrlWithWebdriver = (...args) => ctx.fetchUrlWithWebdriver(...args);
  const findItemByUrl = (...args) => ctx.findItemByUrl(...args);
  const inferPageKind = (...args) => ctx.inferPageKind(...args);
  const normalizeContentFetchUrl = (...args) => ctx.normalizeContentFetchUrl(...args);
  const normalizeUrlForMatch = (...args) => ctx.normalizeUrlForMatch(...args);
  const readItem = (...args) => ctx.readItem(...args);
  const rebuildIndexes = (...args) => ctx.rebuildIndexes(...args);
  const refreshJobTimeoutMs = (...args) => ctx.refreshJobTimeoutMs(...args);
  const resolvePageKind = (...args) => ctx.resolvePageKind(...args);
  const resolvedRefreshFetchMode = (...args) => ctx.resolvedRefreshFetchMode(...args);
  const shouldSkipContentRefresh = (...args) => ctx.shouldSkipContentRefresh(...args);
  const updateRefreshJobState = (...args) => ctx.updateRefreshJobState(...args);
  const upsertFetchedItem = (...args) => ctx.upsertFetchedItem(...args);
  const withItemUrlMutationLock = (...args) => ctx.withItemUrlMutationLock(...args);

  async function refreshListJob(job, refreshContext = null) {
    const adapter = detectSourceAdapter(job.url);
    if (job.pageKind !== "list" && inferPageKind(job.url, adapter) !== "list") {
      throw new Error("当前批量刷新任务需要配置为列表/过滤页。");
    }

    const fetchedAt = new Date().toISOString();
    const listFetched = await fetchForRefreshJob(job.url, { ...job, pageKind: "list" }, adapter, refreshContext);
    assertRefreshActive(refreshContext);
    if (listFetched.notModified) {
      return {
        id: job.id,
        sourceType: adapter.sourceType,
        listUrl: job.url,
        linkCount: 0,
        updatedItemCount: 0,
        skippedItemCount: 1,
        errorCount: 0,
        updatedItems: [],
        skippedItems: [{ url: job.url, reason: "http-not-modified" }],
        errors: []
      };
    }
    const listUrl = listFetched.url || job.url;
    const tags = normalizeTags(job.tags || []);
    // API adapters provide structured entries. Raw is evidence, never a format
    // contract for the list consumer.
    const listCapture = prepareListCapture(
      listFetched,
      job.maxItems,
      () => extractContentLinksFromList(listFetched.raw, listUrl, adapter)
    );
    const listItem = await upsertFetchedItem({
      title: listFetched.title,
      sourceType: adapter.sourceType,
      url: listUrl,
      tags,
      raw: listFetched.raw,
      text: listFetched.text,
      comments: [],
      fetchedAt,
      pageKind: "list",
      fetchMode: resolvedRefreshFetchMode(job, adapter),
      completeness: listCapture.completeness,
      coverage: listCapture.coverage,
      deferIndex: true
    });
    const links = listCapture.links;
    const updatedItems = [];
    const skippedItems = [];
    const errors = [];

    // Leave headroom under the job timeout: whatever does not fit is picked up by the next run
    // (unchanged items are skipped by updated time), instead of failing the whole list.
    const childBudgetMs = refreshJobTimeoutMs(job) - 45 * 1000;
    const childStartedAt = Date.now();
    let deferredCount = 0;
    let slowestChildMs = 0;
    const trackMembership = listFetched.membershipComplete !== undefined;
    for (const link of links) {
      const contentUrl = normalizeContentFetchUrl(link.href, adapter);
      // Stop before a child that would likely overrun the job timeout.
      if (Date.now() - childStartedAt + slowestChildMs > childBudgetMs) {
        deferredCount += 1;
        skippedItems.push({ key: link.key || link.number || "", url: contentUrl, reason: "deferred-time-budget" });
        continue;
      }
      try {
        const existing = await findItemByUrl(contentUrl);
        const listUpdatedAt = cleanText(link.updatedAt || link.updated || "");
        if (shouldSkipByListFingerprint(existing, link.fingerprint)) {
          skippedItems.push({ key: link.key || "", itemId: existing.id, url: existing.url, reason: "unchanged-list-row" });
          continue;
        }
        if (shouldSkipContentRefresh(existing, listUpdatedAt, adapter)) {
          skippedItems.push({
            key: link.key || link.number || "",
            itemId: existing.id,
            url: existing.url,
            sourceUpdatedAt: existing.sourceUpdatedAt,
            reason: "unchanged-list-updated-time"
          });
          continue;
        }
        const childStarted = Date.now();
        const contentFetched = await fetchForRefreshJob(contentUrl, { ...job, pageKind: "content" }, adapter, refreshContext);
        assertRefreshActive(refreshContext);
        slowestChildMs = Math.max(slowestChildMs, Date.now() - childStarted);
        const contentItem = await upsertFetchedItem({
          title: contentFetched.title || link.title || link.key || contentUrl,
          sourceType: adapter.sourceType,
          url: contentFetched.url ? normalizeContentFetchUrl(contentFetched.url, adapter) : contentUrl,
          tags: normalizeTags(job.tags || []),
          raw: contentFetched.raw,
          text: contentFetched.text,
          comments: contentFetched.comments || [],
          commentsComplete: contentFetched.commentsComplete,
          sourceUpdatedAt: listUpdatedAt || contentFetched.sourceUpdatedAt,
          fetchedAt: new Date().toISOString(),
          pageKind: "content",
          fetchMode: resolvedRefreshFetchMode(job, adapter),
          managedBy: "subscription",
          parentUrl: listUrl,
          // Saved inside the same locked write as the content, so a concurrent
          // tag edit cannot be overwritten by a later metadata patch.
          listFingerprint: link.fingerprint || undefined,
          listMembership: trackMembership ? membershipPatch(MEMBERSHIP_MEMBER, listUrl) : undefined,
          deferIndex: true
        });
        const contentResult = {
          key: link.key || link.number || "",
          title: contentItem.metadata.title,
          itemId: contentItem.metadata.id,
          url: contentItem.metadata.url,
          sourceUpdatedAt: contentItem.metadata.sourceUpdatedAt || "",
          sourceUrl: link.href
        };
        if (contentItem.refreshChanged) {
          updatedItems.push(contentResult);
        } else {
          skippedItems.push({
            ...contentResult,
            reason: "unchanged-content"
          });
        }
      } catch (error) {
        errors.push({ key: link.key || link.number || "", url: contentUrl, error: error.message || String(error) });
      }
    }

    const membership = trackMembership
      ? await updateListMembership(listUrl, listCapture, Boolean(listFetched.membershipComplete) && !listCapture.coverage.truncatedByLimit, adapter)
      : { left: [], returned: [] };
    await rebuildIndexes();
    return {
      id: job.id,
      sourceType: adapter.sourceType,
      listItemId: listItem.metadata.id,
      leftItemCount: membership.left.length,
      leftItems: membership.left.map((item) => ({ itemId: item.id, title: item.title, url: item.url })),
      returnedItemCount: membership.returned.length,
      listUrl,
      linkCount: links.length,
      updatedItemCount: updatedItems.length,
      skippedItemCount: skippedItems.length,
      deferredItemCount: deferredCount,
      errorCount: errors.length,
      updatedItems,
      skippedItems,
      errors,
      completeness: deferredCount ? "partial" : listCapture.completeness,
      coverage: listCapture.coverage
    };
  }

  async function listChildItems(listUrl) {
    const key = normalizeUrlForMatch(listUrl);
    return ctx.store.list({ predicate: (metadata) => metadata.pageKind !== "list" && normalizeUrlForMatch(metadata.parentUrl || "") === key });
  }

  async function updateListMembership(listUrl, listCapture, complete, adapter) {
    const currentKeys = new Set((listCapture.links || []).map((link) => normalizeUrlForMatch(normalizeContentFetchUrl(link.href, adapter))));
    const children = await listChildItems(listUrl);
    const diff = diffListMembership({ children, currentKeys, complete, normalize: normalizeUrlForMatch });
    const now = new Date().toISOString();
    for (const child of diff.left) await patchItemMetadata(child.id, (metadata) => ({ listMembership: membershipPatch(MEMBERSHIP_LEFT, listUrl, now, metadata.listMembership) }));
    for (const child of diff.returned) await patchItemMetadata(child.id, () => ({ listMembership: membershipPatch(MEMBERSHIP_MEMBER, listUrl, now) }));
    return diff;
  }

  async function patchItemMetadata(id, buildPatch) {
    const existing = await readItem(id);
    return withItemUrlMutationLock(existing.metadata.url || "", async () => {
      const fresh = await readItem(id);
      await ctx.store.writeMetadata(id, { ...fresh.metadata, ...(buildPatch(fresh.metadata) || {}) });
    });
  }

  // The person decides what happens to items that dropped out of a filtered list.
  async function resolveLeftListItems({ itemIds = [], action }) {
    if (!["keep", "delete"].includes(action)) throw new Error("action 需要是 keep 或 delete。");
    const resolved = [];
    for (const id of itemIds) {
      const item = await readItem(id);
      const status = item.metadata.listMembership?.status;
      if (status !== MEMBERSHIP_LEFT && status !== MEMBERSHIP_KEPT) continue;
      if (action === "delete") await deleteItem(id);
      else await patchItemMetadata(id, (metadata) => ({ listMembership: membershipPatch(MEMBERSHIP_KEPT, metadata.listMembership?.listUrl || metadata.parentUrl || "", new Date().toISOString(), metadata.listMembership) }));
      resolved.push(id);
    }
    await rebuildIndexes();
    return resolved;
  }

  async function refreshContentJob(job, refreshContext = null) {
    const adapter = detectSourceAdapter(job.url);
    const fetchedAt = new Date().toISOString();
    const fetched = await fetchForRefreshJob(job.url, { ...job, pageKind: "content" }, adapter, refreshContext);
    assertRefreshActive(refreshContext);
    if (fetched.notModified) {
      const existing = await findItemByUrl(job.url);
      if (!existing) throw new Error("Source returned 304 but no local item exists.");
      const item = await readItem(existing.id);
      const metadata = {
        ...item.metadata,
        lastFetchedAt: fetchedAt,
        captureMethod: fetched.fetchMethod || "http-304",
        httpValidators: fetched.httpValidators || item.metadata.httpValidators || {}
      };
      await ctx.store.writeMetadata(existing.id, metadata);
      return {
        id: job.id,
        sourceType: adapter.sourceType,
        itemId: existing.id,
        url: existing.url,
        linkCount: 1,
        updatedItemCount: 0,
        skippedItemCount: 1,
        errorCount: 0,
        updatedItems: [],
        skippedItems: [{ title: existing.title, itemId: existing.id, url: existing.url, reason: "http-not-modified" }],
        errors: []
      };
    }
    validateTeamsConversationIdentity(job, fetched, adapter);
    if (adapter.sourceType === "teams" && fetched.title && fetched.conversationId) {
      const previousTitle = teamsConversationTitleForJob(job);
      if (previousTitle && !areCaptureTitlesConsistent(previousTitle, fetched.title)) {
        await updateRefreshJobState(job.id, { name: `${cleanText(fetched.title)} refresh` });
      }
    }
    const item = await upsertFetchedItem({
      title: fetched.title || job.name || job.url,
      sourceType: adapter.sourceType,
      url: fetched.url || job.url,
      tags: normalizeTags(job.tags || []),
      raw: fetched.raw,
      text: fetched.text,
      comments: fetched.comments || [],
      commentsComplete: fetched.commentsComplete,
      sourceUpdatedAt: fetched.sourceUpdatedAt || "",
      captureMethod: fetched.fetchMethod || resolvedRefreshFetchMode(job, adapter),
      httpValidators: fetched.httpValidators || {},
      integrityStatus: adapter.sourceType === "teams" ? "verified" : undefined,
      integrityReason: adapter.sourceType === "teams" ? "" : undefined,
      // Persist what the capture actually covered (scroll stop reason, gaps, identity
      // evidence) so the UI can say when history between captures is missing.
      completeness: fetched.completeness,
      coverage: fetched.coverage,
      identityEvidence: fetched.identityEvidence,
      fetchedAt,
      pageKind: "content",
      fetchMode: resolvedRefreshFetchMode(job, adapter)
    });
    const changed = Boolean(item.refreshChanged);

    await rebuildIndexes();
    return {
      id: job.id,
      sourceType: adapter.sourceType,
      itemId: item.metadata.id,
      url: item.metadata.url,
      linkCount: 1,
      updatedItemCount: changed ? 1 : 0,
      skippedItemCount: changed ? 0 : 1,
      errorCount: 0,
      updatedItems: changed ? [{
        title: item.metadata.title,
        itemId: item.metadata.id,
        url: item.metadata.url,
        sourceUpdatedAt: item.metadata.sourceUpdatedAt || ""
      }] : [],
      skippedItems: changed ? [] : [{
        title: item.metadata.title,
        itemId: item.metadata.id,
        url: item.metadata.url,
        sourceUpdatedAt: item.metadata.sourceUpdatedAt || "",
        reason: "unchanged-content"
      }],
      errors: []
    };
  }

  function validateTeamsConversationIdentity(job, fetched, adapter = detectSourceAdapter(job?.url || "")) {
    if (adapter.sourceType !== "teams") return;
    const expectedConversationId = extractTeamsConversationId(job?.url || "");
    const actualConversationId = cleanText(fetched?.conversationId || "");
    if (expectedConversationId && actualConversationId) {
      if (expectedConversationId === actualConversationId) return;
      throw new Error(`Teams 会话 ID 校验失败：目标“${expectedConversationId}”，实际“${actualConversationId}”。已阻止写入。`);
    }
    const expected = cleanText(job?.name || "").replace(/\s+refresh$/i, "");
    const actual = cleanText(fetched?.title || "");
    if (!expected || !actual) return;
    if (areCaptureTitlesConsistent(expected, actual)) return;
    throw new Error(`Teams 会话校验失败：目标“${expected}”，页面实际为“${actual}”。已阻止写入，避免会话串线。`);
  }

  async function fetchForRefreshJob(url, job, adapter = detectSourceAdapter(url), refreshContext = null) {
    if (resolvedRefreshFetchMode(job, adapter) === "webdriver") {
      return fetchUrlWithWebdriverForRefresh(url, job, adapter, refreshContext);
    }
    const existing = await findItemByUrl(url);
    return fetchUrl(url, {
      pageKind: job.pageKind || "auto",
      signal: refreshContext?.abortSignal,
      maxItems: job.maxItems,
      validators: existing?.httpValidators || {}
    });
  }

  async function fetchUrlWithWebdriverForRefresh(url, job, adapter = detectSourceAdapter(url), refreshContext = null) {
    const existingGithubComments = await readExistingGithubComments(url, adapter);
    const options = {
      pageKind: job.pageKind || "auto",
      session: refreshContext?.webdriverSession,
      page: refreshContext?.webdriverPage,
      run: refreshContext?.run || null,
      teamsConversationTitle: adapter.sourceType === "teams" ? teamsConversationTitleForJob(job) : "",
      maxGithubExpansionPasses: resolvePageKind(url, job.pageKind || "auto") === "content" ? 12 : 0,
      maxItems: job.maxItems,
      existingGithubComments
    };
    try {
      const fetched = await fetchUrlWithWebdriver(url, options);
      validateFetchedGithubNotRegressed(url, adapter, fetched, existingGithubComments);
      return fetched;
    } catch (error) {
      if (!isRetryableWebdriverError(error) || adapter.sourceType !== "github") throw error;
      await resetRefreshWebdriverContext(refreshContext);
      const retryOptions = {
        ...options,
        session: refreshContext?.webdriverSession,
        page: refreshContext?.webdriverPage
      };
      const fetched = await fetchUrlWithWebdriver(url, retryOptions);
      validateFetchedGithubNotRegressed(url, adapter, fetched, existingGithubComments);
      return fetched;
    }
  }

  function validateFetchedGithubNotRegressed(url, adapter, fetched, existingComments = []) {
    if (adapter.sourceType !== "github") return;
    if (resolvePageKind(url, "auto") !== "content") return;
    const previousCount = Array.isArray(existingComments) ? existingComments.length : 0;
    const nextCount = Array.isArray(fetched?.comments) ? fetched.comments.length : 0;
    if (previousCount < 5) return;
    if (nextCount >= Math.max(3, Math.floor(previousCount * 0.8))) return;
    throw new Error([
      "GitHub 抓取到的评论数量明显少于已有内容，已跳过覆盖以避免资料变少。",
      `已有 ${previousCount} 条，本次 ${nextCount} 条。`,
      "请确认 GitHub 登录状态和页面加载完成后再刷新。"
    ].join(" "));
  }

  function isRetryableWebdriverError(error) {
    const message = String(error?.message || error || "");
    return /Target page.*closed|Target context.*closed|browser has been closed|Failed to open a new tab|Target\.createTarget|Timeout|Execution context was destroyed|frame was detached|ERR_ABORTED/i.test(message);
  }

  async function resetRefreshWebdriverContext(refreshContext) {
    if (!refreshContext?.webdriverSession) return;
    const session = refreshContext.webdriverSession;
    const hostname = session.hostname;
    const url = session.page && !session.page.isClosed() ? session.page.url() : `https://${hostname}`;
    try {
      await closeWebdriverSession(session);
    } catch {
      // Best-effort reset before retrying the GitHub fetch.
    }
    const next = await ensureWebdriverSession(hostname, url, {
      autoClose: false,
      windowMode: session.windowMode
    });
    refreshContext.webdriverSession = next;
    refreshContext.webdriverPage = await ensureSessionPage(next);
  }

  async function readExistingGithubComments(url, adapter = detectSourceAdapter(url)) {
    if (adapter.sourceType !== "github") return [];
    if (resolvePageKind(url, "auto") !== "content") return [];
    const existing = await findItemByUrl(normalizeContentFetchUrl(url, adapter) || url);
    if (!existing?.id) return [];
    try {
      const item = await readItem(existing.id);
      return Array.isArray(item.comments) ? item.comments : [];
    } catch {
      return [];
    }
  }

  return { refreshListJob, patchItemMetadata, resolveLeftListItems, refreshContentJob, validateTeamsConversationIdentity };
}
