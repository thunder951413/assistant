// Items: create, preview, upsert captured/fetched content, edits, URL locks and lookups.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { mergeTeamsCommentsByIdentity, normalizeCaptureCompleteness } from "./capture-policy.js";
import { exists, safeReaddir } from "./fs-helpers.js";
import { extractBodyFromDocument, extractSummaryFromDocument } from "./item-store.js";
import { lineDiff } from "./reliability.js";
import { extractContentLinksFromList, inferTitle, looksLikeHtml } from "./sources/html-extractors.js";
import { renderTeamsTextFromComments } from "./sources/teams-page.js";
import { writeItemSnapshot } from "./storage-maintenance.js";
import { detectUrl, isTruthyFilter, latestTimestampValue, normalizeComments, normalizeSourceType, normalizeSourceUpdatedAt, sourceTypeLabel } from "./text-helpers.js";
import { cleanText, normalizeTags, slugify } from "./utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createItemService(ctx) {
  // Functions that live elsewhere, resolved when called.
  const canonicalizeMaterialUrl = (...args) => ctx.canonicalizeMaterialUrl(...args);
  const defaultRefreshJobNameForListUrl = (...args) => ctx.defaultRefreshJobNameForListUrl(...args);
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);
  const ensureRefreshJobForContentUrl = (...args) => ctx.ensureRefreshJobForContentUrl(...args);
  const ensureRefreshJobForListUrl = (...args) => ctx.ensureRefreshJobForListUrl(...args);
  const extractByAdapter = (...args) => ctx.extractByAdapter(...args);
  const fetchUrl = (...args) => ctx.fetchUrl(...args);
  const fetchUrlWithWebdriver = (...args) => ctx.fetchUrlWithWebdriver(...args);
  const hasTeamsGraphCredentials = (...args) => ctx.hasTeamsGraphCredentials(...args);
  const isAuthenticationRequiredError = (...args) => ctx.isAuthenticationRequiredError(...args);
  const isInvalidTeamsRootCapture = (...args) => ctx.isInvalidTeamsRootCapture(...args);
  const normalizeContentFetchUrl = (...args) => ctx.normalizeContentFetchUrl(...args);
  const normalizeUrlForMatch = (...args) => ctx.normalizeUrlForMatch(...args);
  const previewRefreshJob = (...args) => ctx.previewRefreshJob(...args);
  const rebuildIndexes = (...args) => ctx.rebuildIndexes(...args);
  const resolvePageKind = (...args) => ctx.resolvePageKind(...args);
  const shouldFetchForPreview = (...args) => ctx.shouldFetchForPreview(...args);
  const shouldFetchWithWebdriver = (...args) => ctx.shouldFetchWithWebdriver(...args);
  const startRefreshRunByIds = (...args) => ctx.startRefreshRunByIds(...args);
  const validateTeamsConversationIdentity = (...args) => ctx.validateTeamsConversationIdentity(...args);

  async function createItem(input) {
    const url = canonicalizeMaterialUrl(input.url || "");
    return withItemUrlMutationLock(url, async () => {
      if (url) {
        const existing = await findItemByUrl(url);
        if (existing) return readItem(existing.id);
      }
      return createItemUnlocked(input);
    });
  }

  async function createItemUnlocked(input) {
    const now = new Date().toISOString();
    const itemUrl = canonicalizeMaterialUrl(input.url || "");
    const sourceType = normalizeSourceType(input.sourceType, itemUrl || input.url);
    const tags = normalizeTags(input.tags);
    let title = cleanText(input.title || "");
    let rawContent = cleanText(input.rawContent || input.content || "");
    let extractedContent = cleanText(input.extractedContent || input.content || rawContent);
    let rawFileName = input.rawFileName || "raw.txt";
    let lastFetchedAt = input.lastFetchedAt || null;
    let sourceUpdatedAt = cleanText(input.sourceUpdatedAt || "");
    const summary = cleanText(input.summary || "");
    let comments = normalizeComments(input.comments);

    if (!rawContent && itemUrl && (sourceType === "web" || sourceType === "jira" || sourceType === "github" || sourceType === "confluence" || sourceType === "teams")) {
      const fetched = sourceType === "teams" && !hasTeamsGraphCredentials(detectSourceAdapter(itemUrl))
        ? await fetchUrlWithWebdriver(itemUrl)
        : await fetchUrl(itemUrl);
      rawContent = fetched.raw;
      extractedContent = fetched.text;
      rawFileName = "raw.html";
      title = title || fetched.title || itemUrl;
      lastFetchedAt = now;
      sourceUpdatedAt = sourceUpdatedAt || fetched.sourceUpdatedAt || "";
      comments = normalizeComments(fetched.comments);
    }

    title = title || "Untitled material";
    const id = await reserveUniqueItemId(slugify(`${sourceType}-${title}`));

    const metadata = {
      id,
      title,
      sourceType,
      url: itemUrl || null,
      tags,
      createdAt: now,
      updatedAt: now,
      lastFetchedAt,
      sourceUpdatedAt,
      rawFileName,
      pageKind: input.pageKind || null,
      fetchMode: input.fetchMode || null,
      parentUrl: input.parentUrl || null,
      managedBy: input.managedBy || null,
      captureMethod: cleanText(input.captureMethod || "manual"),
      httpValidators: input.httpValidators || {},
      integrityStatus: cleanText(input.integrityStatus || ""),
      integrityReason: cleanText(input.integrityReason || ""),
      pendingContentUpdatedAt: cleanText(input.pendingContentUpdatedAt || ""),
      contentUpdatedAt: cleanText(input.contentUpdatedAt || input.pendingContentUpdatedAt || ""),
      completeness: normalizeCaptureCompleteness(input.completeness),
      coverage: input.coverage && typeof input.coverage === "object" ? input.coverage : {},
      identityEvidence: input.identityEvidence && typeof input.identityEvidence === "object" ? input.identityEvidence : {},
      subscribe: input.subscribe !== undefined ? Boolean(input.subscribe) : undefined,
      ...(input.listFingerprint !== undefined ? { listFingerprint: input.listFingerprint } : {}),
      ...(input.listMembership !== undefined ? { listMembership: input.listMembership } : {})
    };

    try {
      await ctx.store.commit(id, {
        metadata,
        body: extractedContent,
        summary,
        comments,
        raw: rawContent,
        rawContentType: rawFileName.endsWith(".html") ? "text/html" : "",
        rawFileName
      });
    } finally {
      ctx.pendingItemIds.delete(id);
    }
    if (metadata.subscribe !== false && metadata.pageKind === "list" && metadata.url) {
      metadata.refreshJob = await ensureRefreshJobForListUrl(metadata.url, {
        title,
        sourceType,
        fetchMode: metadata.fetchMode || "auto"
      });
      // The subscription captures the list's items (with skipping, fingerprints and
      // membership tracking); start its first run in the background.
      startRefreshRunByIds([metadata.refreshJob.id], { force: true, sourceType: "all" })
        .catch((error) => console.warn(`First run of ${metadata.refreshJob.id} failed to start:`, error.message || error));
    } else if (metadata.subscribe !== false && metadata.url && !metadata.parentUrl) {
      // Items captured from a list are refreshed by that list's subscription.
      metadata.refreshJob = await ensureRefreshJobForContentUrl(metadata.url, {
        title,
        sourceType,
        fetchMode: metadata.fetchMode || "auto",
        managedBy: metadata.managedBy || "content-page"
      });
      await ctx.store.commit(id, { metadata, body: extractedContent, summary });
    }
    if (!input.deferIndex) await rebuildIndexes();

    return readItem(id);
  }

  async function previewSource(input) {
    const now = new Date().toISOString();
    const pasted = cleanText(input.content || "");
    const detectedUrl = cleanText(input.url || detectUrl(pasted));
    const canonicalDetectedUrl = canonicalizeMaterialUrl(detectedUrl);
    const requestedPageKind = resolvePageKind(canonicalDetectedUrl, input.pageKind || "auto");
    const existingItem = canonicalDetectedUrl ? await findItemByUrl(canonicalDetectedUrl) : null;
    const sourceType = normalizeSourceType(input.sourceType, canonicalDetectedUrl || detectedUrl);
    let title = cleanText(input.title || "");
    let rawContent = pasted;
    let extractedContent = pasted;
    let rawFileName = "raw.txt";
    let lastFetchedAt = null;
    let parseStatus = "ready";
    let parseNote = "文本内容已读取，确认后即可导入。";
    let linkedItems = [];
    let refreshJob = null;
    let skipRefreshJob = false;

    if (canonicalDetectedUrl && requestedPageKind === "list" && shouldFetchForPreview(input, pasted) && !looksLikeHtml(pasted)) {
      const adapter = detectSourceAdapter(canonicalDetectedUrl);
      title = title || defaultRefreshJobNameForListUrl(canonicalDetectedUrl, "");
      rawContent = canonicalDetectedUrl;
      extractedContent = [
        `# ${title}`,
        "",
        `Source: ${canonicalDetectedUrl}`,
        "",
        "该链接已识别为订阅/过滤页。确认后只会加入订阅管理，不会作为资料内容导入。",
        "可以在订阅管理里点击立即刷新，抓取该列表中的内容页。"
      ].join("\n");
      refreshJob = previewRefreshJob(canonicalDetectedUrl, {
        title,
        sourceType: adapter.sourceType,
        fetchMode: input.fetchMode || "auto",
        pageKind: "list"
      });
      return {
        title,
        sourceType: adapter.sourceType,
        url: canonicalDetectedUrl,
        rawContent,
        extractedContent,
        rawFileName,
        lastFetchedAt,
        existingItem: null,
        comments: [],
        sourceUpdatedAt: "",
        linkedItems,
        refreshJob,
        parseStatus: "ready",
        parseNote: "已识别为订阅/过滤页，确认后会加入订阅管理。",
        contentLength: extractedContent.length,
        pageKind: "list",
        fetchMode: input.fetchMode || "auto",
        importMode: "subscription"
      };
    }

    if (existingItem) {
      const existing = await readItem(existingItem.id);
      const existingBody = extractBodyFromDocument(existing.document).trim();
      return {
        title: existing.metadata.title,
        sourceType: existing.metadata.sourceType,
        url: existing.metadata.url || canonicalDetectedUrl || detectedUrl || null,
        rawContent: existingBody,
        extractedContent: existingBody,
        rawFileName: existing.metadata.rawFileName || "raw.html",
        lastFetchedAt: existing.metadata.lastFetchedAt || "",
        existingItem: {
          id: existing.metadata.id,
          title: existing.metadata.title,
          sourceType: existing.metadata.sourceType,
          url: existing.metadata.url,
          updatedAt: existing.metadata.updatedAt,
          lastFetchedAt: existing.metadata.lastFetchedAt
        },
        comments: existing.comments || [],
        sourceUpdatedAt: existing.metadata.sourceUpdatedAt || "",
        linkedItems: [],
        refreshJob: existing.metadata.refreshJob || null,
        parseStatus: "ready",
        parseNote: "检测到该页面已经在资料库中，当前显示已有内容预览。",
        contentLength: existingBody.length,
        pageKind: requestedPageKind,
        fetchMode: existing.metadata.fetchMode || input.fetchMode || "auto"
      };
    }

    if (canonicalDetectedUrl && shouldFetchForPreview(input, pasted)) {
      try {
        const fetched = shouldFetchWithWebdriver(canonicalDetectedUrl, input.fetchMode, requestedPageKind)
          ? await fetchUrlWithWebdriver(canonicalDetectedUrl, { pageKind: requestedPageKind, signal: input.signal })
          : await fetchUrl(canonicalDetectedUrl, { pageKind: requestedPageKind, signal: input.signal });
        title = title || fetched.title || canonicalDetectedUrl;
        rawContent = fetched.raw;
        extractedContent = fetched.text;
        rawFileName = "raw.html";
        lastFetchedAt = now;
        input.sourceUpdatedAt = fetched.sourceUpdatedAt || "";
        input.comments = fetched.comments || [];
        input.captureMethod = fetched.fetchMethod || input.captureMethod;
        input.completeness = fetched.completeness || input.completeness;
        input.coverage = fetched.coverage || input.coverage;
        input.identityEvidence = fetched.identityEvidence || input.identityEvidence;
        parseNote = "网页内容已抓取并过滤为可读文本。";
        linkedItems = extractPreviewLinkedItems(rawContent, canonicalDetectedUrl, sourceType, requestedPageKind);
      } catch (error) {
        const authError = isAuthenticationRequiredError(error);
        title = title || canonicalDetectedUrl;
        if (error?.name === "AbortError" || input.signal?.aborted) throw error;
        const hasPastedBody = Boolean(pasted && pasted !== detectedUrl && pasted !== canonicalDetectedUrl);
        rawContent = hasPastedBody ? pasted : "";
        extractedContent = hasPastedBody ? pasted : "";
        parseStatus = "needs-review";
        parseNote = authError
          ? error.message
          : "页面抓取失败。请检查登录或网络后重试，或粘贴页面正文。";
        input.errorNote = error.message || String(error);
        skipRefreshJob = authError;
      }
    } else if (canonicalDetectedUrl && looksLikeHtml(pasted)) {
      const adapter = detectSourceAdapter(canonicalDetectedUrl);
      const extracted = extractByAdapter(pasted, canonicalDetectedUrl, adapter, requestedPageKind);
      title = title || extracted.title || canonicalDetectedUrl;
      rawContent = pasted;
      extractedContent = extracted.text;
      rawFileName = "raw.html";
      input.comments = extracted.comments || [];
      input.sourceUpdatedAt = extracted.sourceUpdatedAt || "";
      linkedItems = extractPreviewLinkedItems(rawContent, canonicalDetectedUrl, sourceType, requestedPageKind);
      parseNote = "已按对应站点规则解析粘贴的 HTML 内容。";
    }

    title = title || inferTitle(extractedContent) || "Untitled material";
    const resolvedPageKind = requestedPageKind;
    if (!skipRefreshJob && canonicalDetectedUrl && resolvedPageKind === "list") {
      refreshJob = previewRefreshJob(canonicalDetectedUrl, {
        title,
        sourceType,
        fetchMode: input.fetchMode || "auto",
        pageKind: "list",
        managedBy: "content-page"
      });
    } else if (!skipRefreshJob && canonicalDetectedUrl && resolvedPageKind === "content") {
      refreshJob = previewRefreshJob(canonicalDetectedUrl, {
        title,
        sourceType,
        fetchMode: input.fetchMode || "auto",
        pageKind: "content"
      });
    }

    return {
      title,
      sourceType,
      url: canonicalDetectedUrl || detectedUrl || null,
      rawContent,
      extractedContent,
      rawFileName,
      lastFetchedAt,
      existingItem: existingItem ? {
        id: existingItem.id,
        title: existingItem.title,
        sourceType: existingItem.sourceType,
        url: existingItem.url,
        updatedAt: existingItem.updatedAt,
        lastFetchedAt: existingItem.lastFetchedAt
      } : null,
      comments: normalizeComments(input.comments),
      sourceUpdatedAt: cleanText(input.sourceUpdatedAt || ""),
      captureMethod: cleanText(input.captureMethod || ""),
      completeness: normalizeCaptureCompleteness(input.completeness),
      coverage: input.coverage && typeof input.coverage === "object" ? input.coverage : {},
      identityEvidence: input.identityEvidence && typeof input.identityEvidence === "object" ? input.identityEvidence : {},
      errorNote: cleanText(input.errorNote || ""),
      linkedItems,
      refreshJob,
      parseStatus,
      parseNote,
      contentLength: extractedContent.length,
      pageKind: resolvedPageKind,
      fetchMode: input.fetchMode || "auto"
    };
  }

  function extractPreviewLinkedItems(rawContent, url, sourceType, pageKind) {
    const adapter = detectSourceAdapter(url);
    const kind = resolvePageKind(url, pageKind);
    if (kind !== "list") return [];
    return extractContentLinksFromList(rawContent, url, adapter)
      .slice(0, 100)
      .map((link) => ({
        title: link.title || link.key || link.href,
        url: normalizeContentFetchUrl(link.href, adapter),
        sourceUrl: link.href,
        key: link.key || link.number || "",
        sourceType: sourceType || adapter.sourceType
      }));
  }

  async function refreshItem(id) {
    const item = await refreshItemWithContext(id);
    await rebuildIndexes();
    return item;
  }

  async function refreshItemWithContext(id, refreshContext = null) {
    const item = await readItem(id);
    if (!item.metadata.url) {
      throw new Error("Only URL-backed materials can be refreshed.");
    }

    const itemDir = path.join(ctx.itemsDir, id);
    const now = new Date().toISOString();
    let fetched = await fetchForMetadata(item.metadata, refreshContext);
    if (fetched.notModified) {
      const metadata = {
        ...item.metadata,
        lastFetchedAt: now,
        captureMethod: fetched.fetchMethod || item.metadata.captureMethod || "http-304",
        httpValidators: fetched.httpValidators || item.metadata.httpValidators || {}
      };
      await ctx.store.writeMetadata(id, metadata);
      return readItem(id);
    }
    if (fetched.commentsComplete === false) {
      fetched = { ...fetched, comments: mergeCapturedComments(item.comments || [], fetched.comments || []) };
    }
    validateTeamsConversationIdentity({ url: item.metadata.url, name: item.metadata.title }, fetched, detectSourceAdapter(item.metadata.url || ""));
    fetched = mergeFetchedTeamsInputWithExisting(item, {
      ...fetched,
      sourceType: item.metadata.sourceType,
      title: fetched.title || item.metadata.title,
      url: item.metadata.url
    });
    validateFetchedItemNotRegressed(item, {
      sourceType: item.metadata.sourceType,
      comments: fetched.comments || []
    });
    const previousLength = item.document.length;
    const previousBody = extractBodyFromDocument(item.document).trim();
    const currentBody = fetched.text.trim();
    const fetchedSourceUpdatedAt = cleanText(fetched.sourceUpdatedAt || "");
    const nextSourceUpdatedAt = fetchedSourceUpdatedAt || item.metadata.sourceUpdatedAt || "";
    const sourceChanged = nextSourceUpdatedAt
      && normalizeSourceUpdatedAt(nextSourceUpdatedAt) !== normalizeSourceUpdatedAt(item.metadata.sourceUpdatedAt || "");
    const contentChanged = previousBody !== currentBody;
    const hasUpdate = Boolean((fetchedSourceUpdatedAt && sourceChanged) || contentChanged);
    if (hasUpdate) {
      await saveItemSnapshot(itemDir, item.metadata, now);
    }
    const { updateSummary: _ignoredUpdateSummary, ...previousMetadata } = item.metadata;
    const metadata = {
      ...previousMetadata,
      title: item.metadata.title || fetched.title,
      updatedAt: hasUpdate ? now : item.metadata.updatedAt,
      lastFetchedAt: now,
      sourceUpdatedAt: nextSourceUpdatedAt,
      captureMethod: fetched.fetchMethod || item.metadata.captureMethod || "html",
      httpValidators: fetched.httpValidators || item.metadata.httpValidators || {},
      integrityStatus: fetched.integrityStatus !== undefined ? cleanText(fetched.integrityStatus) : cleanText(item.metadata.integrityStatus || ""),
      integrityReason: fetched.integrityReason !== undefined ? cleanText(fetched.integrityReason) : cleanText(item.metadata.integrityReason || ""),
      contentUpdatedAt: hasUpdate ? now : item.metadata.contentUpdatedAt || "",
      pendingContentUpdatedAt: hasUpdate ? now : item.metadata.pendingContentUpdatedAt || "",
      processedStale: hasUpdate ? Boolean(item.metadata.processedAt) : Boolean(item.metadata.processedStale),
      completeness: normalizeCaptureCompleteness(fetched.completeness, item.metadata.completeness || "unknown"),
      coverage: fetched.coverage && typeof fetched.coverage === "object" ? fetched.coverage : item.metadata.coverage || {},
      identityEvidence: fetched.identityEvidence && typeof fetched.identityEvidence === "object" ? fetched.identityEvidence : item.metadata.identityEvidence || {},
      refreshNote: {
        previousDocumentLength: previousLength,
        currentDocumentLength: fetched.text.length,
        lengthDelta: fetched.text.length - previousLength
      }
    };

    const rawFileName = metadata.rawFileName || "raw.html";
    await ctx.store.commit(id, {
      metadata,
      body: fetched.text,
      comments: fetched.comments || [],
      raw: fetched.raw,
      rawContentType: rawFileName.endsWith(".html") ? "text/html" : "",
      rawFileName
    });
    return readItem(id);
  }

  async function fetchForMetadata(metadata, refreshContext = null) {
    if (shouldFetchWithWebdriver(metadata.url, metadata.fetchMode, metadata.pageKind || "auto", metadata.sourceType)) {
      return fetchUrlWithWebdriver(metadata.url, {
        pageKind: metadata.pageKind || "auto",
        session: refreshContext?.webdriverSession,
        page: refreshContext?.webdriverPage,
        validators: metadata.httpValidators || {}
      });
    }
    return fetchUrl(metadata.url, {
      pageKind: metadata.pageKind || "auto",
      validators: metadata.httpValidators || {},
      signal: refreshContext?.abortSignal
    });
  }

  async function upsertFetchedItem(input) {
    const url = canonicalizeMaterialUrl(input.url || "");
    return withItemUrlMutationLock(url, () => upsertFetchedItemUnlocked(input));
  }

  async function upsertFetchedItemUnlocked(input) {
    if (input.sourceType === "teams" && input.comments?.length) {
      input = mergeFetchedTeamsInputWithExisting({ metadata: { sourceType: "teams", url: input.url, title: input.title }, comments: [] }, input);
    }
    const itemUrl = canonicalizeMaterialUrl(input.url || "");
    const existing = await findItemByUrl(itemUrl);
    if (!existing) {
      const created = await createItemUnlocked({
        title: input.title,
        sourceType: input.sourceType,
        url: itemUrl,
        tags: input.tags,
        rawContent: input.raw,
        extractedContent: input.text,
        rawFileName: "raw.html",
        lastFetchedAt: input.fetchedAt,
        comments: input.comments,
        pageKind: input.pageKind,
        fetchMode: input.fetchMode,
        parentUrl: input.parentUrl,
        managedBy: input.managedBy,
        sourceUpdatedAt: input.sourceUpdatedAt,
        captureMethod: input.captureMethod,
        httpValidators: input.httpValidators,
        integrityStatus: input.integrityStatus,
        integrityReason: input.integrityReason,
        pendingContentUpdatedAt: input.fetchedAt,
        contentUpdatedAt: input.fetchedAt,
        completeness: input.completeness,
        coverage: input.coverage,
        identityEvidence: input.identityEvidence,
        subscribe: input.subscribe,
        listFingerprint: input.listFingerprint,
        listMembership: input.listMembership,
        deferIndex: input.deferIndex
      });
      created.refreshChanged = true;
      return created;
    }

    const item = await readItem(existing.id);
    if (input.commentsComplete === false) {
      input = {
        ...input,
        comments: mergeCapturedComments(item.comments || [], input.comments || [])
      };
    }
    input = mergeFetchedTeamsInputWithExisting(item, input);
    validateFetchedItemNotRegressed(item, input);
    const itemDir = path.join(ctx.itemsDir, existing.id);
    const previousBody = extractBodyFromDocument(item.document).trim();
    const currentBody = cleanText(input.text).trim();
    const fetchedSourceUpdatedAt = cleanText(input.sourceUpdatedAt || "");
    const nextSourceUpdatedAt = fetchedSourceUpdatedAt || item.metadata.sourceUpdatedAt || "";
    const sourceChanged = nextSourceUpdatedAt
      && normalizeSourceUpdatedAt(nextSourceUpdatedAt) !== normalizeSourceUpdatedAt(item.metadata.sourceUpdatedAt || "");
    const contentChanged = previousBody !== currentBody;
    const hasUpdate = Boolean((fetchedSourceUpdatedAt && sourceChanged) || contentChanged);
    if (hasUpdate) {
      await saveItemSnapshot(itemDir, item.metadata, input.fetchedAt);
    }
    const { updateSummary: _ignoredUpdateSummary, ...previousMetadata } = item.metadata;
    const metadata = {
      ...previousMetadata,
      title: input.title || item.metadata.title,
      sourceType: input.sourceType || item.metadata.sourceType,
      url: itemUrl,
      tags: item.metadata.tags || [],
      updatedAt: hasUpdate ? input.fetchedAt : item.metadata.updatedAt,
      lastFetchedAt: input.fetchedAt,
      sourceUpdatedAt: nextSourceUpdatedAt,
      contentUpdatedAt: hasUpdate ? input.fetchedAt : item.metadata.contentUpdatedAt || "",
      pendingContentUpdatedAt: hasUpdate ? input.fetchedAt : item.metadata.pendingContentUpdatedAt || "",
      processedStale: hasUpdate ? Boolean(item.metadata.processedAt) : Boolean(item.metadata.processedStale),
      completeness: normalizeCaptureCompleteness(input.completeness, item.metadata.completeness || "unknown"),
      coverage: input.coverage && typeof input.coverage === "object" ? input.coverage : item.metadata.coverage || {},
      identityEvidence: input.identityEvidence && typeof input.identityEvidence === "object" ? input.identityEvidence : item.metadata.identityEvidence || {},
      rawFileName: item.metadata.rawFileName || "raw.html",
      pageKind: input.pageKind || item.metadata.pageKind || null,
      fetchMode: input.fetchMode || item.metadata.fetchMode || null,
      parentUrl: input.parentUrl || item.metadata.parentUrl || null,
      managedBy: input.managedBy || item.metadata.managedBy || null,
      captureMethod: cleanText(input.captureMethod || item.metadata.captureMethod || "html"),
      httpValidators: input.httpValidators || item.metadata.httpValidators || {},
      integrityStatus: input.integrityStatus !== undefined ? cleanText(input.integrityStatus) : cleanText(item.metadata.integrityStatus || ""),
      integrityReason: input.integrityReason !== undefined ? cleanText(input.integrityReason) : cleanText(item.metadata.integrityReason || ""),
      ...(input.listFingerprint !== undefined ? { listFingerprint: input.listFingerprint } : {}),
      ...(input.listMembership !== undefined ? { listMembership: input.listMembership } : {}),
      refreshNote: {
        previousDocumentLength: item.document.length,
        currentDocumentLength: input.text.length,
        lengthDelta: input.text.length - item.document.length
      }
    };

    await ctx.store.commit(existing.id, {
      metadata,
      body: input.text,
      comments: input.comments || [],
      raw: input.raw,
      rawContentType: metadata.rawFileName.endsWith(".html") ? "text/html" : "",
      rawFileName: metadata.rawFileName
    });
    if (!input.deferIndex) await rebuildIndexes();
    const refreshed = await readItem(existing.id);
    refreshed.refreshChanged = hasUpdate;
    return refreshed;
  }

  async function upsertCapturedItem(input = {}) {
    const now = new Date().toISOString();
    const url = canonicalizeMaterialUrl(input.url || "");
    if (!url) throw new Error("URL is required.");
    const sourceType = normalizeSourceType(input.sourceType || "", url);
    const comments = normalizeComments(input.comments || []);
    const title = cleanText(input.title || sourceTypeLabel(sourceType));
    const text = cleanText(input.extractedContent || input.text || renderCapturedText({
      title,
      url,
      sourceType,
      comments,
      content: input.content || input.rawContent || ""
    }));
    const raw = cleanText(input.rawContent || input.raw || text);
    return upsertFetchedItem({
      title,
      sourceType,
      url,
      tags: normalizeTags(input.tags || []),
      raw,
      text,
      comments,
      sourceUpdatedAt: cleanText(input.sourceUpdatedAt || latestTimestampValue(comments.map((comment) => comment.createdAt)) || ""),
      fetchedAt: cleanText(input.fetchedAt || now),
      pageKind: cleanText(input.pageKind || "content"),
      fetchMode: cleanText(input.fetchMode || "userscript"),
      captureMethod: cleanText(input.captureMethod || "userscript"),
      integrityStatus: cleanText(input.integrityStatus || ""),
      integrityReason: cleanText(input.integrityReason || ""),
      completeness: normalizeCaptureCompleteness(input.completeness, sourceType === "teams" ? "partial" : "unknown"),
      coverage: input.coverage && typeof input.coverage === "object" ? input.coverage : {},
      identityEvidence: input.identityEvidence && typeof input.identityEvidence === "object" ? input.identityEvidence : {},
      subscribe: input.subscribe
    });
  }

  function renderCapturedText({ title, url, sourceType, comments, content }) {
    if (sourceType === "teams") {
      return renderTeamsTextFromComments(title || "Microsoft Teams conversation", url, detectSourceAdapter(url), comments || []);
    }
    return [
      `# ${title || "Captured material"}`,
      "",
      `Source: ${url}`,
      "",
      cleanText(content || "")
    ].join("\n");
  }

  async function saveItemSnapshot(itemDir, metadata, timestamp) {
    await writeItemSnapshot(itemDir, metadata, timestamp, { retention: ctx.SNAPSHOT_RETENTION_COUNT });
  }

  function validateFetchedItemNotRegressed(item, input) {
    const sourceType = input.sourceType || item.metadata.sourceType || "";
    if (sourceType !== "teams") return;
    const previousCount = Array.isArray(item.comments) ? item.comments.length : 0;
    const nextCount = Array.isArray(input.comments) ? input.comments.length : 0;
    if (previousCount < 10) return;
    if (nextCount >= 3) return;
    throw new Error([
      "Teams 抓取到的消息数量明显少于已有内容，已跳过覆盖以避免资料变少。",
      `已有 ${previousCount} 条，本次 ${nextCount} 条。`,
      "请确认 Teams 页面打开的是目标会话，并等待消息加载完成后再刷新。"
    ].join(" "));
  }

  function mergeFetchedTeamsInputWithExisting(item, input) {
    const sourceType = input.sourceType || item.metadata.sourceType || "";
    if (sourceType !== "teams") return input;
    const previousComments = Array.isArray(item.comments) ? item.comments : [];
    const nextComments = Array.isArray(input.comments) ? input.comments : [];
    if (!nextComments.length) return input;
    const mergedComments = mergeTeamsCommentsByIdentity(previousComments, nextComments);
    const title = cleanText(input.title || item.metadata.title || "Microsoft Teams conversation");
    const url = canonicalizeMaterialUrl(input.url || item.metadata.url || "");
    const adapter = detectSourceAdapter(url || item.metadata.url || "");
    return {
      ...input,
      title,
      url: url || input.url,
      comments: mergedComments,
      text: renderTeamsTextFromComments(title, url || input.url || item.metadata.url || "", adapter, mergedComments),
      sourceUpdatedAt: latestTimestampValue([
        input.sourceUpdatedAt,
        item.metadata.sourceUpdatedAt,
        ...mergedComments.map((comment) => comment.createdAt)
      ]) || input.sourceUpdatedAt || item.metadata.sourceUpdatedAt || ""
    };
  }

  function mergeCapturedComments(existing = [], observed = []) {
    const byKey = new Map();
    for (const comment of [...existing, ...observed]) {
      const id = cleanText(comment?.id || "");
      const key = id || [cleanText(comment?.author), cleanText(comment?.createdAt), cleanText(comment?.body)].join("\n");
      if (key) byKey.set(key, comment);
    }
    return [...byKey.values()];
  }

  async function findItemByUrl(url) {
    const found = await ctx.store.findByUrl(url, normalizeUrlForMatch);
    // Callers may extend the result; hand out a copy of the cached metadata.
    return found ? { ...found } : null;
  }

  async function withItemUrlMutationLock(url, task) {
    const key = normalizeUrlForMatch(url) || `local:${String(url || "").trim()}`;
    const previous = ctx.itemUrlMutationLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = previous.catch(() => {}).then(() => current);
    ctx.itemUrlMutationLocks.set(key, queued);
    await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (ctx.itemUrlMutationLocks.get(key) === queued) ctx.itemUrlMutationLocks.delete(key);
    }
  }

  async function updateTags(id, tags) {
    const existing = await readItem(id);
    return withItemUrlMutationLock(existing.metadata.url || "", () => updateTagsUnlocked(id, tags));
  }

  async function updateTagsUnlocked(id, tags) {
    const item = await readItem(id);
    const metadata = {
      ...item.metadata,
      tags: normalizeTags(tags),
      updatedAt: new Date().toISOString()
    };
    const body = extractBodyFromDocument(item.document);
    const summary = extractSummaryFromDocument(item.document);
    await ctx.store.commit(id, { metadata, body, summary });
    await rebuildIndexes();
    return readItem(id);
  }

  async function updateTitle(id, title) {
    const existing = await readItem(id);
    return withItemUrlMutationLock(existing.metadata.url || "", () => updateTitleUnlocked(id, title));
  }

  async function updateTitleUnlocked(id, title) {
    const item = await readItem(id);
    const nextTitle = cleanText(title).slice(0, 180);
    if (!nextTitle) throw new Error("标题不能为空。");
    const metadata = {
      ...item.metadata,
      title: nextTitle,
      updatedAt: new Date().toISOString()
    };
    const body = extractBodyFromDocument(item.document);
    const summary = extractSummaryFromDocument(item.document);
    await ctx.store.commit(id, { metadata, body, summary });
    await rebuildIndexes();
    return readItem(id);
  }

  async function acknowledgeItemUpdate(id) {
    const existing = await readItem(id);
    return withItemUrlMutationLock(existing.metadata.url || "", () => acknowledgeItemUpdateUnlocked(id));
  }

  async function acknowledgeItemUpdateUnlocked(id) {
    const item = await readItem(id);
    if (!item.metadata.contentUpdatedAt) return item;

    const metadata = {
      ...item.metadata,
      contentUpdatedAt: "",
      updateAcknowledgedAt: new Date().toISOString()
    };
    const body = extractBodyFromDocument(item.document);
    const summary = extractSummaryFromDocument(item.document);
    await ctx.store.commit(id, { metadata, body, summary });
    await rebuildIndexes();
    return readItem(id);
  }

  async function readItem(id) {
    return ctx.store.read(id);
  }

  async function deleteItem(id) {
    return ctx.store.delete(id);
  }

  async function listItems(filters = {}) {
    return ctx.store.list({
      tag: filters.tag,
      sourceType: filters.sourceType,
      query: filters.query,
      integrityStatus: filters.integrityStatus,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      predicate: (metadata) => {
        if (!isTruthyFilter(filters.includeLists) && metadata.pageKind === "list") return false;
        if (!isTruthyFilter(filters.includeInvalidTeamsRoot) && isInvalidTeamsRootCapture(metadata)) return false;
        if (isTruthyFilter(filters.updates) && !metadata.contentUpdatedAt) return false;
        return true;
      }
    });
  }

  function renderProcessedDocument(metadata, body) {
    const url = metadata.url || "local input";
    return `# ${metadata.title}

  ## Metadata

  - ID: ${metadata.id}
  - Source: ${metadata.sourceType}
  - URL: ${url}
  - Processed: ${metadata.processedAt || new Date().toISOString()}
  - Model: ${metadata.processedModel || ctx.settings.ai?.model || "unknown"}

  ## AI Organized Content

  ${body.trim() || "_No organized content generated yet._"}
  `;
  }

  async function uniqueItemId(base) {
    let id = base;
    let counter = 2;

    while (ctx.pendingItemIds.has(id) || await exists(path.join(ctx.itemsDir, id))) {
      id = `${base}-${counter}`;
      counter += 1;
    }
    ctx.pendingItemIds.add(id);
    return id;
  }

  async function reserveUniqueItemId(base) {
    const previous = ctx.itemIdReservationQueue;
    let release;
    ctx.itemIdReservationQueue = new Promise((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      return await uniqueItemId(base);
    } finally {
      release();
    }
  }

  async function itemLatestDiff(id) {
    const item = await readItem(id);
    const snapshotsRoot = path.join(ctx.itemsDir, id, "snapshots");
    const names = (await safeReaddir(snapshotsRoot)).sort().reverse();
    for (const snapshotId of names) {
      const documentPath = path.join(snapshotsRoot, snapshotId, "document.md");
      if (!(await exists(documentPath))) continue;
      const before = await fs.readFile(documentPath, "utf8");
      return { snapshotId, ...lineDiff(before, item.document) };
    }
    return { snapshotId: "", changed: false, addedLines: 0, removedLines: 0, text: "还没有历史快照可供比较。", truncated: false };
  }

  return { createItem, previewSource, refreshItem, upsertFetchedItem, upsertCapturedItem, findItemByUrl, withItemUrlMutationLock, updateTags, updateTitle, acknowledgeItemUpdate, readItem, deleteItem, listItems, renderProcessedDocument, itemLatestDiff };
}
