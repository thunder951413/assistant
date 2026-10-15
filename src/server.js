import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { validateApiRequest } from "./api-security.js";
import { applyClientJobEdits, createSettingsWriter, isRuntimeOnlyPatch } from "./settings-store.js";
import { assertModelMaterials, normalizeChatHistory } from "./ai-policy.js";
import { createChatSessionStore } from "./chat-session-store.js";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { chromium } from "playwright";
import { cleanText, normalizeTags, safeHostname, safePathname, slugify } from "./utils.js";
import { createRouter } from "./router.js";
import { createAiClient } from "./ai-client.js";
import { areCaptureTitlesConsistent, isSupportedCaptureContentType, paginate } from "./capture-utils.js";
import { mergeTeamsCommentsByIdentity, nextDueCaptureSlot, normalizeCaptureCompleteness, prepareListCapture, readResponseBodyLimited, shouldCloseOwnedWebdriverSession, withWebdriverSessionQueue } from "./capture-policy.js";
import { createItemStore, extractBodyFromDocument, extractSummaryFromDocument } from "./item-store.js";
import { computeSourceHealth, createRunHistory, lineDiff } from "./reliability.js";
import { collectConfluenceComments, normalizeConfluenceComment } from "./sources/confluence-comments.js";
import { shouldAutoProcess } from "./ai-processing.js";
import { collectChatsvcMessages, fetchChatsvcTopic, recordChatsvcAuth } from "./sources/teams-chatsvc.js";
import { collectPullRequestDiscussion, renderGithubDiscussionEntry } from "./sources/github-pull.js";
import { BROWSER_DISK_CACHE_BYTES, trimBrowserProfileIfLarge, writeItemSnapshot } from "./storage-maintenance.js";
import { exists, resolveWritableDir, safeReaddir } from "./fs-helpers.js";
import { detectUrl, isSameRelativeSourceDay, isTruthyFilter, latestTimestampValue, normalizeComments, normalizeSourceType, normalizeSourceUpdatedAt, parseSourceUpdatedAt, sourceLabel, sourceTypeLabel } from "./text-helpers.js";
import { readBody, securityHeaders, sendJson, sendJsonDownload, withResponseCancellation } from "./http-utils.js";
import { defaultSourceProfile, mergeRefreshJobs, normalizeNotificationSettings, normalizeRefreshJob, normalizeWebdriverWindowMode, refreshFailureState } from "./settings-schema.js";
import { assertFetchedPageIsAuthenticated, confluenceHtmlToMarkdown, detectAuthenticationPage, extractContentLinksFromList, extractFilterId, extractTitle, htmlToText, inferTitle, looksLikeHtml } from "./sources/html-extractors.js";
import { extractTeamsConversationId, extractTeamsDeepPath, extractTeamsFromPage, isTeamsWebAppReady, openTeamsConversationFromUi, renderTeamsTextFromComments, scrollTeamsMessages, teamsConversationTitleForJob, validateTeamsExtraction, waitForTeamsConversation, waitForTeamsReady } from "./sources/teams-page.js";
import { clickGithubLoadMore, githubPageGrowthSnapshot } from "./sources/github-page.js";
import { buildGithubIssueSearchApiUrls, collectGithubIssueRows, githubIssueRowsToEntries, githubIssueSearchPageUrl, githubIssueSearchTitle, isGithubIssueSearchUrl, renderGithubIssueSearchText } from "./sources/github-issue-search.js";
import { collectStream, latestMessagePreviews, normalizeFavoriteTags } from "./topics.js";
import { MEMBERSHIP_KEPT, MEMBERSHIP_LEFT, MEMBERSHIP_MEMBER, diffListMembership, membershipPatch, shouldSkipByListFingerprint } from "./list-membership.js";
import { createKnowledgeSearch } from "./knowledge-search.js";
import { createTagsService } from "./tags-service.js";
import { createAiActions } from "./ai-actions.js";
import { createTopicsService } from "./topics-service.js";
import { createSupplemental } from "./supplemental.js";
import { createSettingsService } from "./settings-service.js";
import { createSourceUrls } from "./source-urls.js";
import { createDataMaintenance } from "./data-maintenance.js";

// Modules extracted from this file get their dependencies through this object.
// Everything is read lazily, so module order and later reassignment (settings,
// kbDir…) are not an issue.
const ctx = {
  get APP_VERSION() { return APP_VERSION; },
  get SNAPSHOT_RETENTION_COUNT() { return SNAPSHOT_RETENTION_COUNT; },
  get activeApiOperations() { return activeApiOperations; },
  get ai() { return ai; },
  get configDir() { return configDir; },
  get defaultDocumentRoot() { return defaultDocumentRoot; },
  get embeddingBuilds() { return embeddingBuilds; },
  get embeddingIndexState() { return embeddingIndexState; },
  get ensureKnowledgeBase() { return ensureKnowledgeBase; },
  get flushIndexRebuild() { return flushIndexRebuild; },
  get indexesDir() { return indexesDir; },
  get isEmbeddingEnabled() { return isEmbeddingEnabled; },
  get isInvalidTeamsRootRefreshJob() { return isInvalidTeamsRootRefreshJob; },
  get isRemoteAiAllowed() { return isRemoteAiAllowed; },
  get itemsDir() { return itemsDir; },
  get kbDir() { return kbDir; },
  get libraryMaintenance() { return libraryMaintenance; },
  set libraryMaintenance(value) { libraryMaintenance = value; },
  get listItems() { return listItems; },
  get modelVisibleTags() { return modelVisibleTags; },
  get persistSettings() { return persistSettings; },
  get publicRefreshJobs() { return publicRefreshJobs; },
  get readAllMaterialsForSearch() { return readAllMaterialsForSearch; },
  get readItem() { return readItem; },
  get rebuildIndexes() { return rebuildIndexes; },
  get refreshRuntime() { return refreshRuntime; },
  get renderProcessedDocument() { return renderProcessedDocument; },
  get resolveProcessingPrompt() { return resolveProcessingPrompt; },
  get runtimeJobsPath() { return runtimeJobsPath; },
  get settings() { return settings; },
  set settings(value) { settings = value; },
  get settingsPath() { return settingsPath; },
  get store() { return store; },
  get supplementalPromptBlock() { return supplementalPromptBlock; },
  get updateTitle() { return updateTitle; },
  get webdriverRoot() { return webdriverRoot; },
  get webdriverSessions() { return webdriverSessions; },
  get withItemUrlMutationLock() { return withItemUrlMutationLock; },
};
const { searchItems, buildAskContext, answerFromKnowledgeBase, streamAnswerFromKnowledgeBase, searchKnowledgeBase, readAllMaterialsForSearch, isEmbeddingEnabled, embeddingIndexState } = createKnowledgeSearch(ctx);
const { listTags, addManualTags, renameTag, deleteTags, modelVisibleTags } = createTagsService(ctx);
const { summarizeContent, updateTitleWithAi, recommendTagsForItem, recommendTagsForItems, classifyItems, classifyItem, processItemWithAi } = createAiActions(ctx);
const { loadTopicMaterials, readTopicDigest, topicOverview, generateTopicDigest } = createTopicsService(ctx);
const { supplementalContextPath, supplementalEntriesPath, saveSupplementalContext, readSupplementalEntries, saveSupplementalEntries, renderSupplementalMarkdown, supplementalPromptBlock, suggestSupplementalContext } = createSupplemental(ctx);
const { loadSettings, exportFilename, importSettingsBundle, saveSettings, publicSettings, resolveProcessingPrompt, publicRefreshJobs, isRemoteAiAllowed, publicSourceProfiles, redactSettings } = createSettingsService(ctx);
const { resolvePageKind, detectSourceAdapter, extractByAdapter, inferPageKind, isKnownListUrl, normalizeContentFetchUrl, buildAuthHeaders, normalizeUrlForMatch, isInvalidTeamsRootRefreshJob, isInvalidTeamsRootCapture, canonicalizeMaterialUrl, shouldFetchForPreview } = createSourceUrls(ctx);
const { exportDataBundle, storageStats, cleanupOldSnapshots, cleanupWebdriverCaches, importDataBundle, serviceHealth } = createDataMaintenance(ctx);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown"; } catch { return "unknown"; }
})();
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const configDir = resolveWritableDir(process.env.ASSISTANT_CONFIG_DIR, path.join(rootDir, ".config"));
const settingsPath = path.join(configDir, "settings.json");
const runtimeJobsPath = path.join(configDir, "runtime", "jobs-state.json");
const webdriverRoot = path.join(configDir, "webdriver");
const captureToken = await loadCaptureToken();
let settings = await loadSettings();
// Every settings write goes through this queue and writes the latest state.
const persistSettings = createSettingsWriter({ settingsPath, runtimePath: runtimeJobsPath, getSettings: () => settings });
const ai = createAiClient(() => settings, { authorize: (materials, purpose) => assertModelMaterials(materials, settings, purpose) });
const chatSessionStore = createChatSessionStore(path.join(configDir, "chat-sessions.json"));
let kbDir = resolveDocumentRoot(settings.documentRoot);
let itemsDir = path.join(kbDir, "items");
let tagsDir = path.join(kbDir, "tags");
let indexesDir = path.join(kbDir, "indexes");
const webdriverSessions = new Map();
const itemUrlMutationLocks = new Map();
const pendingItemIds = new Set();
let itemIdReservationQueue = Promise.resolve();
const embeddingBuilds = new Map();
let libraryMaintenance = false;
let activeApiOperations = 0;
const refreshRuntime = {
  timer: null,
  running: new Set(),
  queued: new Set(),
  runs: new Map()
};
const store = createItemStore(() => ({ itemsDir, tagsDir, indexesDir }));
const refreshHistory = createRunHistory(path.join(configDir, "runtime", "refresh-history.jsonl"));

const FETCH_TIMEOUT_MS = 45 * 1000;
const REFRESH_JOB_TIMEOUT_MS = 4 * 60 * 1000;
const LIST_REFRESH_JOB_TIMEOUT_MS = 12 * 60 * 1000;
// Teams may need extra scrolling to close a gap since the previous capture.
const TEAMS_REFRESH_JOB_TIMEOUT_MS = 7 * 60 * 1000;
const TEAMS_GAP_SCROLL_DEADLINE_MS = 3 * 60 * 1000;
const REFRESH_RUN_RETENTION_MS = 6 * 60 * 60 * 1000;
const TEAMS_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const SNAPSHOT_RETENTION_COUNT = 20;
const MAX_FETCH_BYTES = 12 * 1024 * 1024;

const port = Number(process.env.PORT || 8020);
const host = process.env.HOST || "127.0.0.1";

await ensureKnowledgeBase();
await store.rebuildIndexes();
await migrateMisclassifiedListUrls();
await pruneListChildJobs();
await syncContentRefreshJobsFromItems();
await reconcileStaleRunningRefreshJobs();
startRefreshScheduler();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      validateApiRequest(req, url, { captureToken });
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    else if (!res.writableEnded) res.end();
  }
});

server.listen(port, host, () => {
  console.log(`Material Organizer running at http://${host}:${server.address().port}`);
});

// ---- Route table (replaces the 386-line if/else chain) ----

const api = createRouter();

// Items -------------------------------------------------------
api.get("/api/items", async ({ url, res }) => {
  const allItems = await listItems({
    tag: url.searchParams.get("tag"),
    sourceType: url.searchParams.get("sourceType"),
    query: url.searchParams.get("q"),
    updates: url.searchParams.get("updates"),
    includeLists: url.searchParams.get("includeLists"),
    integrityStatus: url.searchParams.get("integrityStatus"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo")
  });
  const pageData = paginate(allItems, url.searchParams.get("page") || 1, url.searchParams.get("pageSize") || allItems.length || 1);
  const items = url.searchParams.has("page") || url.searchParams.has("pageSize") ? pageData.items : allItems;
  sendJson(res, 200, { ...pageData, items });
});

api.post("/api/items", async ({ req, res }) => {
  const body = await readBody(req);
  const item = await createItem(body);
  sendJson(res, 201, { item });
});

api.post("/api/items/upsert-capture", async ({ req, res }) => {
  const body = await readBody(req);
  const item = await upsertCapturedItem(body);
  sendJson(res, 200, { item, changed: Boolean(item.refreshChanged) });
});

api.get("/api/items/:id", async ({ params, res }) => {
  const item = await readItem(params.id);
  sendJson(res, 200, { item });
});

api.get("/api/items/:id/diff", async ({ params, res }) => {
  sendJson(res, 200, { diff: await itemLatestDiff(params.id) });
});

api.delete("/api/items/:id", async ({ params, res }) => {
  await deleteItem(params.id);
  sendJson(res, 200, { ok: true });
});

api.patch("/api/items/:id/tags", async ({ params, req, res }) => {
  const body = await readBody(req);
  const item = await updateTags(params.id, body.tags || []);
  sendJson(res, 200, { item });
});

api.patch("/api/items/:id/title", async ({ params, req, res }) => {
  const body = await readBody(req);
  const item = await updateTitle(params.id, body.title || "");
  sendJson(res, 200, { item });
});

api.post("/api/items/:id/recommend-title", async ({ params, res }) => {
  const item = await updateTitleWithAi(params.id);
  sendJson(res, 200, { item });
});

api.post("/api/items/:id/recommend-tags", async ({ params, res }) => {
  const recommendations = await recommendTagsForItem(params.id);
  sendJson(res, 200, recommendations);
});

api.post("/api/items/:id/process", async ({ req, params, res }) => {
  const body = await readBody(req).catch(() => ({}));
  const item = await processItemWithAi(params.id, { full: Boolean(body?.full) });
  sendJson(res, 200, { item });
});

api.post("/api/list-membership/resolve", async ({ req, res }) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.itemIds) ? body.itemIds.map(String) : [];
  const resolved = await resolveLeftListItems({ itemIds: ids, action: body.action });
  sendJson(res, 200, { ok: true, resolved });
});

// Topics (followed tags) and the time-ordered stream ------------------------
api.get("/api/stream", async ({ url, res }) => {
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const items = await loadTopicMaterials();
  const result = collectStream(items, {
    since: Date.now() - days * 24 * 60 * 60 * 1000,
    tag: url.searchParams.get("tag") || "",
    favoriteTags: normalizeFavoriteTags(settings.favoriteTags || []),
    sourceType: url.searchParams.get("sourceType") || "",
    limit: Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 300))
  });
  sendJson(res, 200, { ...result, days });
});

// Inbox-style previews: newest message per item and the count since last read.
api.get("/api/previews", async ({ res }) => {
  sendJson(res, 200, { previews: latestMessagePreviews(await loadTopicMaterials()) });
});

api.get("/api/topics", async ({ res }) => {
  sendJson(res, 200, await topicOverview());
});

api.post("/api/topics/favorites", async ({ req, res }) => {
  const body = await readBody(req);
  settings = { ...settings, favoriteTags: normalizeFavoriteTags(body.tags) };
  await persistSettings();
  sendJson(res, 200, await topicOverview());
});

api.get("/api/topics/:tag/digest", async ({ params, res }) => {
  sendJson(res, 200, { digest: await readTopicDigest(params.tag) });
});

api.post("/api/topics/:tag/digest", async ({ params, req, res }) => {
  const body = await readBody(req).catch(() => ({}));
  const digest = await generateTopicDigest(params.tag, {
    mode: body.mode === "recent" ? "recent" : "overview",
    days: Math.min(90, Math.max(1, Number(body.days) || 7))
  });
  sendJson(res, 200, { digest });
});

api.post("/api/items/:id/ack-update", async ({ params, res }) => {
  const item = await acknowledgeItemUpdate(params.id);
  sendJson(res, 200, { item });
});

api.post("/api/items/:id/refresh", async ({ params, res }) => {
  const existing = await readItem(params.id);
  if (existing.metadata.sourceType === "teams") {
    const job = await ensureRefreshJobForContentUrl(existing.metadata.url, {
      title: existing.metadata.title,
      fetchMode: "webdriver",
      managedBy: "content-page"
    });
    const run = await startRefreshRunByIds([job.id], { force: true, sourceType: "teams" });
    sendJson(res, 202, { run, jobs: publicRefreshJobs() });
    return;
  }
  const item = await refreshItem(params.id);
  sendJson(res, 200, { item });
});

// Preview & summarize ------------------------------------------
api.post("/api/preview-source", async ({ req, res }) => {
  const body = await readBody(req);
  const preview = await withResponseCancellation(res, signal => previewSource({ ...body, signal }));
  sendJson(res, 200, { preview });
});

api.post("/api/summarize", async ({ req, res }) => {
  const body = await readBody(req);
  const summary = await withResponseCancellation(res, signal => summarizeContent({ ...body, signal }));
  sendJson(res, 200, { summary });
});

// WebDriver ----------------------------------------------------
api.get("/api/webdriver/status", async ({ res }) => {
  sendJson(res, 200, { sessions: await webdriverStatus() });
});

api.post("/api/webdriver/open", async ({ req, res }) => {
  const body = await readBody(req);
  const session = await openWebdriverSession(body.url || "", body.hostname || "");
  sendJson(res, 200, { session });
});

api.post("/api/webdriver/fetch", async ({ req, res }) => {
  const body = await readBody(req);
  const fetched = await fetchUrlWithWebdriver(body.url, { pageKind: body.pageKind || "auto" });
  sendJson(res, 200, { fetched });
});

api.post("/api/webdriver/save-cookies", async ({ req, res }) => {
  const body = await readBody(req);
  const saved = await saveWebdriverCookies(body.url || "", body.hostname || "");
  sendJson(res, 200, { saved, settings: publicSettings() });
});

// Batch AI operations ------------------------------------------
api.post("/api/batch-recommend-tags", async ({ req, res }) => {
  const body = await readBody(req);
  const recommendations = await recommendTagsForItems(body.ids || []);
  sendJson(res, 200, recommendations);
});

api.post("/api/classify-items", async ({ req, res }) => {
  const body = await readBody(req);
  const classification = await classifyItems(body.ids || [], body.categories || []);
  sendJson(res, 200, classification);
});

api.post("/api/classify-item", async ({ req, res }) => {
  const body = await readBody(req);
  const classification = await classifyItem(body.id || "", body.categories || []);
  sendJson(res, 200, classification);
});

// Tags ---------------------------------------------------------
api.get("/api/tags", async ({ res }) => {
  sendJson(res, 200, { tags: await listTags() });
});

api.post("/api/tags", async ({ req, res }) => {
  const body = await readBody(req);
  const tags = await addManualTags(body.tags || body.tag || []);
  sendJson(res, 200, { tags });
});

api.patch("/api/tags", async ({ req, res }) => {
  const body = await readBody(req);
  const result = await renameTag(body.from || body.oldTag || "", body.to || body.newTag || "");
  sendJson(res, 200, result);
});

api.delete("/api/tags", async ({ req, res }) => {
  const body = await readBody(req);
  const result = await deleteTags(body.tags || []);
  sendJson(res, 200, result);
});

// Search & knowledge -------------------------------------------
api.post("/api/search", async ({ req, res }) => {
  const body = await readBody(req);
  const results = await searchItems(body.query || "");
  sendJson(res, 200, { results });
});

api.post("/api/knowledge-search", async ({ req, res }) => {
  const body = await readBody(req);
  const results = await searchKnowledgeBase(body.query || "", body.limit || 8, body.filters || {});
  sendJson(res, 200, { rootDir: kbDir, results });
});

api.post("/api/ask-context", async ({ req, res }) => {
  const body = await readBody(req);
  const context = await buildAskContext(body.question || "");
  sendJson(res, 200, context);
});

api.get("/api/agent-config", async ({ res }) => {
  await flushIndexRebuild();
  sendJson(res, 200, {
    rootDir: kbDir,
    guidePath: path.join(kbDir, "AGENTS.md")
  });
});

// Supplemental context -----------------------------------------
api.get("/api/supplemental-context", async ({ res }) => {
  const entries = await readSupplementalEntries();
  sendJson(res, 200, {
    entries,
    content: renderSupplementalMarkdown(entries),
    path: supplementalContextPath(),
    entriesPath: supplementalEntriesPath()
  });
});

api.patch("/api/supplemental-context", async ({ req, res }) => {
  const body = await readBody(req);
  const entries = Array.isArray(body.entries)
    ? await saveSupplementalEntries(body.entries)
    : await saveSupplementalContext(body.content || "");
  sendJson(res, 200, {
    entries,
    content: renderSupplementalMarkdown(entries),
    path: supplementalContextPath(),
    entriesPath: supplementalEntriesPath()
  });
});

api.post("/api/supplemental-context/suggest", async ({ req, res }) => {
  const body = await readBody(req);
  const entries = await suggestSupplementalContext(body.existingEntries || []);
  sendJson(res, 200, {
    entries,
    suggestion: renderSupplementalMarkdown(entries)
  });
});

// Settings -----------------------------------------------------
api.get("/api/settings", async ({ res }) => {
  sendJson(res, 200, { settings: publicSettings() });
});

api.patch("/api/settings", async ({ req, res }) => {
  const body = await readBody(req);
  settings = await saveSettings(body);
  configureKnowledgeBase();
  await ensureKnowledgeBase();
  await syncContentRefreshJobsFromItems();
  startRefreshScheduler();
  sendJson(res, 200, { settings: publicSettings() });
});

// Export / import ----------------------------------------------
api.get("/api/export/settings", async ({ url, res }) => {
  const includeSecrets = url.searchParams.get("includeSecrets") === "1";
  sendJsonDownload(res, exportFilename("assistant-settings"), {
    type: "material-organizer-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: includeSecrets ? settings : redactSettings(settings),
    secretsIncluded: includeSecrets
  });
});

api.post("/api/import/settings", async ({ req, res }) => {
  const body = await readBody(req);
  settings = await importSettingsBundle(body);
  configureKnowledgeBase();
  await ensureKnowledgeBase();
  await syncContentRefreshJobsFromItems();
  startRefreshScheduler();
  sendJson(res, 200, { settings: publicSettings() });
});

api.get("/api/export/data", async ({ res }) => {
  sendJsonDownload(res, exportFilename("assistant-data"), await exportDataBundle());
});

api.post("/api/import/data", async ({ req, res }) => {
  const body = await readBody(req);
  const result = await importDataBundle(body.bundle || body, { mode: body.mode || "merge" });
  await syncContentRefreshJobsFromItems();
  sendJson(res, 200, result);
});

// Source profiles ----------------------------------------------
api.get("/api/source-profiles", async ({ res }) => {
  sendJson(res, 200, { profiles: publicSourceProfiles() });
});

api.get("/api/storage-stats", async ({ res }) => {
  sendJson(res, 200, { stats: await storageStats() });
});

api.get("/api/health", async ({ res }) => {
  sendJson(res, 200, await serviceHealth());
});

api.get("/api/source-health", async ({ res }) => {
  sendJson(res, 200, { sources: computeSourceHealth(await listItems({ includeLists: true, includeInvalidTeamsRoot: true }), publicRefreshJobs()) });
});

api.post("/api/storage-cleanup", async ({ res }) => {
  const result = await cleanupOldSnapshots();
  sendJson(res, 200, { result, stats: await storageStats() });
});

api.post("/api/storage-cleanup-browser", async ({ res }) => {
  const result = await cleanupWebdriverCaches();
  sendJson(res, 200, { result, stats: await storageStats() });
});

// Refresh jobs -------------------------------------------------
api.get("/api/refresh-jobs", async ({ res }) => {
  await reconcileStaleRunningRefreshJobs();
  sendJson(res, 200, { jobs: publicRefreshJobs() });
});

api.post("/api/refresh-jobs", async ({ req, res }) => {
  const body = await readBody(req);
  const url = canonicalizeMaterialUrl(body.url || "");
  if (!url) throw new Error("Refresh job URL is required.");
  const pageKind = resolvePageKind(url, body.pageKind || "auto");
  const job = pageKind === "list"
    ? await ensureRefreshJobForListUrl(url, body)
    : await ensureRefreshJobForContentUrl(url, body);
  startRefreshScheduler();
  sendJson(res, 201, { job, jobs: publicRefreshJobs() });
});

// Edit one subscription; only user-editable fields are accepted.
api.patch("/api/refresh-jobs/:id", async ({ params, req, res }) => {
  const body = await readBody(req);
  if (!(settings.refreshJobs || []).some((job) => job.id === params.id)) {
    const error = new Error("订阅不存在，可能已被删除。"); error.statusCode = 404; throw error;
  }
  settings = { ...settings, refreshJobs: applyClientJobEdits(settings.refreshJobs || [], [{ ...body, id: params.id }]) };
  await persistSettings();
  startRefreshScheduler();
  sendJson(res, 200, { job: publicRefreshJobs().find((job) => job.id === params.id), jobs: publicRefreshJobs() });
});

api.post("/api/refresh-jobs/run-batch", async ({ url, req, res }) => {
  await syncContentRefreshJobsFromItems();
  const body = await readBody(req);
  const options = { force: true, sourceType: cleanText(body.sourceType || "all") };
  if (url.searchParams.get("background") === "1" || body.background) {
    const run = await startRefreshRunByIds(body.ids || [], options);
    sendJson(res, 202, { run, jobs: publicRefreshJobs() });
    return;
  }
  const result = await runRefreshJobsByIds(body.ids || [], options);
  sendJson(res, 200, { result, jobs: publicRefreshJobs() });
});

api.post("/api/refresh-jobs/:id/run", async ({ params, url, res }) => {
  await syncContentRefreshJobsFromItems();
  if (url.searchParams.get("background") === "1") {
    const run = await startRefreshRunByIds([params.id], { force: true, sourceType: "all" });
    sendJson(res, 202, { run, jobs: publicRefreshJobs() });
    return;
  }
  const result = await runRefreshJobById(params.id, { force: true });
  sendJson(res, 200, { result, jobs: publicRefreshJobs() });
});

api.delete("/api/refresh-jobs/:id", async ({ params, res }) => {
  const jobs = await deleteRefreshJob(params.id);
  startRefreshScheduler();
  sendJson(res, 200, { jobs });
});

api.delete("/api/refresh-jobs/:id/items", async ({ params, res }) => {
  const result = await deleteRefreshJobItems(params.id);
  sendJson(res, 200, { result, jobs: publicRefreshJobs() });
});

api.delete("/api/refresh-jobs/source/:sourceType/items", async ({ params, res }) => {
  await syncContentRefreshJobsFromItems();
  const result = await deleteRefreshSourceItems(params.sourceType);
  sendJson(res, 200, { result, jobs: publicRefreshJobs() });
});

// Refresh runs -------------------------------------------------
api.get("/api/refresh-runs", async ({ res }) => {
  sendJson(res, 200, { runs: publicRefreshRuns() });
});

api.get("/api/refresh-history", async ({ url, res }) => {
  sendJson(res, 200, { history: await refreshHistory.list(url.searchParams.get("limit") || 50) });
});

api.get("/api/refresh-runs/:runId", async ({ params, res }) => {
  const run = publicRefreshRun(params.runId);
  if (!run) throw new Error("Refresh run not found.");
  sendJson(res, 200, { run });
});

api.post("/api/refresh-runs/:runId/teams-ready", async ({ params, res }) => {
  const run = await confirmTeamsRefreshReady(params.runId);
  sendJson(res, 200, { run, jobs: publicRefreshJobs() });
});

api.post("/api/refresh-runs/:runId/cancel", async ({ params, res }) => {
  const run = await cancelRefreshRun(params.runId);
  sendJson(res, 200, { run, jobs: publicRefreshJobs() });
});

// Chat ---------------------------------------------------------
api.get("/api/chat-sessions", async ({ res }) => sendJson(res, 200, await chatSessionStore.read()));
api.patch("/api/chat-sessions", async ({ req, res }) => sendJson(res, 200, await chatSessionStore.write(await readBody(req))));
api.get("/api/capture-token", async ({ res }) => sendJson(res, 200, { token: captureToken }));

api.post("/api/chat", async ({ req, res }) => {
  const body = await readBody(req);
  const answer = await answerFromKnowledgeBase(body.message || "", { history: normalizeChatHistory(body.history) });
  sendJson(res, 200, answer);
});

api.post("/api/chat-stream", async ({ req, res }) => {
  const body = await readBody(req);
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", abort);
  try { await streamAnswerFromKnowledgeBase(body.message || "", res, { history: normalizeChatHistory(body.history), signal: controller.signal }); }
  finally { res.removeListener("close", abort); }
});

// ---- Dispatch -------------------------------------------------

async function handleApi(req, res, url) {
  if (libraryMaintenance) { sendJson(res, 409, { error: "资料库正在导入，请稍后重试。" }); return; }
  activeApiOperations += 1;
  try {
    const matched = await api.handle(req, res, url);
    if (!matched) sendJson(res, 404, { error: "Not found" });
  } finally { activeApiOperations -= 1; }
}

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
    await store.commit(id, {
      metadata,
      body: extractedContent,
      summary,
      comments,
      raw: rawContent,
      rawContentType: rawFileName.endsWith(".html") ? "text/html" : "",
      rawFileName
    });
  } finally {
    pendingItemIds.delete(id);
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
    await store.commit(id, { metadata, body: extractedContent, summary });
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

function previewRefreshJob(url, options = {}) {
  const canonicalUrl = canonicalizeMaterialUrl(url);
  const adapter = detectSourceAdapter(canonicalUrl);
  const normalizedUrl = normalizeUrlForMatch(canonicalUrl);
  const existing = (settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      url: existing.url,
      enabled: Boolean(existing.enabled),
      intervalMinutes: existing.intervalMinutes,
      maxItems: existing.maxItems,
      managedBy: existing.managedBy || "",
      created: false,
      proposed: false
    };
  }
  const pageKind = options.pageKind || resolvePageKind(canonicalUrl, "auto");
  const isList = pageKind === "list";
  return {
    id: isList ? defaultRefreshJobIdForListUrl(canonicalUrl, adapter) : defaultRefreshJobIdForContentUrl(canonicalUrl, adapter),
    name: isList ? defaultRefreshJobNameForListUrl(canonicalUrl, options.title) : defaultRefreshJobNameForContentUrl(canonicalUrl, options.title),
    url: canonicalUrl,
    enabled: false,
    intervalMinutes: 60,
    maxItems: isList ? (isGithubIssueSearchUrl(canonicalUrl) ? 100 : 50) : 1,
    managedBy: options.managedBy || (isList ? "" : "content-page"),
    fetchMode: defaultRefreshFetchModeForAdapter(adapter, options.fetchMode),
    pageKind,
    created: false,
    proposed: true
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

  const itemDir = path.join(itemsDir, id);
  const now = new Date().toISOString();
  let fetched = await fetchForMetadata(item.metadata, refreshContext);
  if (fetched.notModified) {
    const metadata = {
      ...item.metadata,
      lastFetchedAt: now,
      captureMethod: fetched.fetchMethod || item.metadata.captureMethod || "http-304",
      httpValidators: fetched.httpValidators || item.metadata.httpValidators || {}
    };
    await store.writeMetadata(id, metadata);
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
  await store.commit(id, {
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
  const itemDir = path.join(itemsDir, existing.id);
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

  await store.commit(existing.id, {
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
  await writeItemSnapshot(itemDir, metadata, timestamp, { retention: SNAPSHOT_RETENTION_COUNT });
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
  const found = await store.findByUrl(url, normalizeUrlForMatch);
  // Callers may extend the result; hand out a copy of the cached metadata.
  return found ? { ...found } : null;
}

async function withItemUrlMutationLock(url, task) {
  const key = normalizeUrlForMatch(url) || `local:${String(url || "").trim()}`;
  const previous = itemUrlMutationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => current);
  itemUrlMutationLocks.set(key, queued);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (itemUrlMutationLocks.get(key) === queued) itemUrlMutationLocks.delete(key);
  }
}

function shouldSkipContentRefresh(existingMetadata, listUpdatedAt, adapter = detectSourceAdapter(existingMetadata?.url || "")) {
  if (!existingMetadata || !listUpdatedAt || !existingMetadata.sourceUpdatedAt) return false;
  if (adapter.sourceType === "github") {
    // GitHub HTML lists only give relative times ("2 days ago"); trust exact API timestamps only.
    const isoPattern = /^\d{4}-\d{2}-\d{2}T/;
    if (!isoPattern.test(listUpdatedAt) || !isoPattern.test(existingMetadata.sourceUpdatedAt)) return false;
    return Date.parse(existingMetadata.sourceUpdatedAt) >= Date.parse(listUpdatedAt);
  }
  if (isSameRelativeSourceDay(existingMetadata.sourceUpdatedAt, existingMetadata.lastFetchedAt, listUpdatedAt)) return true;
  const existingTime = parseSourceUpdatedAt(existingMetadata.sourceUpdatedAt, existingMetadata.lastFetchedAt);
  const listTime = Date.parse(listUpdatedAt);
  if (!Number.isNaN(existingTime) && !Number.isNaN(listTime)) {
    return existingTime >= listTime || Math.abs(existingTime - listTime) <= 60 * 1000;
  }
  return normalizeSourceUpdatedAt(existingMetadata.sourceUpdatedAt, existingMetadata.lastFetchedAt) === normalizeSourceUpdatedAt(listUpdatedAt);
}

async function ensureRefreshJobForListUrl(url, options = {}) {
  const canonicalUrl = canonicalizeMaterialUrl(url);
  const adapter = detectSourceAdapter(canonicalUrl);
  if (resolvePageKind(canonicalUrl, "auto") !== "list") return null;
  const normalizedUrl = normalizeUrlForMatch(canonicalUrl);
  const existing = (settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      url: existing.url,
      enabled: Boolean(existing.enabled),
      intervalMinutes: existing.intervalMinutes,
      maxItems: existing.maxItems,
      managedBy: existing.managedBy || "",
      created: false
    };
  }

  const job = normalizeRefreshJob({
    id: defaultRefreshJobIdForListUrl(canonicalUrl, adapter),
    name: defaultRefreshJobNameForListUrl(canonicalUrl, options.title),
    url: canonicalUrl,
    enabled: false,
    intervalMinutes: 60,
    maxItems: isGithubIssueSearchUrl(canonicalUrl) ? 100 : 50,
    tags: defaultRefreshTagsForListUrl(canonicalUrl, adapter),
    fetchMode: defaultRefreshFetchModeForAdapter(adapter, options.fetchMode),
    pageKind: "list",
    status: "idle",
    lastRunAt: "",
    lastStartedAt: "",
    lastError: "",
    lastResult: null
  }, {});

  settings = {
    ...settings,
    refreshJobs: mergeRefreshJobs(settings.refreshJobs || [], [job])
  };
  await persistSettings();

  return {
    id: job.id,
    name: job.name,
    url: job.url,
    enabled: job.enabled,
    intervalMinutes: job.intervalMinutes,
    maxItems: job.maxItems,
    created: true
  };
}

async function ensureRefreshJobForContentUrl(url, options = {}) {
  const canonicalUrl = canonicalizeMaterialUrl(url);
  const adapter = detectSourceAdapter(canonicalUrl);
  const normalizedUrl = normalizeUrlForMatch(canonicalUrl);
  const existing = (settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      url: existing.url,
      enabled: Boolean(existing.enabled),
      intervalMinutes: existing.intervalMinutes,
      maxItems: existing.maxItems,
      managedBy: existing.managedBy || "",
      created: false
    };
  }

  const job = normalizeRefreshJob({
    id: defaultRefreshJobIdForContentUrl(canonicalUrl, adapter),
    name: defaultRefreshJobNameForContentUrl(canonicalUrl, options.title),
    url: canonicalUrl,
    enabled: false,
    intervalMinutes: 60,
    maxItems: 1,
    tags: [],
    fetchMode: defaultRefreshFetchModeForAdapter(adapter, options.fetchMode),
    pageKind: "content",
    managedBy: options.managedBy || "content-page",
    status: "idle",
    lastRunAt: "",
    lastStartedAt: "",
    lastError: "",
    lastResult: null
  }, {});

  settings = {
    ...settings,
    refreshJobs: mergeRefreshJobs(settings.refreshJobs || [], [job])
  };
  await persistSettings();

  return {
    id: job.id,
    name: job.name,
    url: job.url,
    enabled: job.enabled,
    intervalMinutes: job.intervalMinutes,
    maxItems: job.maxItems,
    created: true
  };
}

// Older versions saved filter/search pages (e.g. GitHub issue searches) as single
// content pages. Turn those items into list records and their jobs into list
// subscriptions so the next refresh follows the results.
async function migrateMisclassifiedListUrls() {
  const items = await listItems({ includeLists: true });
  let itemsChanged = 0;
  for (const item of items) {
    if (!item.url || item.pageKind === "list" || !isKnownListUrl(item.url)) continue;
    await patchItemMetadata(item.id, () => ({ pageKind: "list", managedBy: null, subscribe: true }));
    itemsChanged += 1;
  }
  let jobsChanged = 0;
  const refreshJobs = (settings.refreshJobs || []).map((job) => {
    if (job.pageKind === "list" || !job.url || !isKnownListUrl(job.url)) return job;
    jobsChanged += 1;
    return {
      ...job,
      pageKind: "list",
      managedBy: "",
      name: defaultRefreshJobNameForListUrl(job.url, ""),
      maxItems: Math.max(Number(job.maxItems) || 0, isGithubIssueSearchUrl(job.url) ? 100 : 50),
      lastResult: null,
      lastError: ""
    };
  });
  if (jobsChanged) {
    settings = { ...settings, refreshJobs };
    await persistSettings();
  }
  if (itemsChanged) await rebuildIndexes();
  if (itemsChanged || jobsChanged) console.log(`Migrated ${jobsChanged} subscription(s) and ${itemsChanged} item(s) from page to list.`);
}

// Older versions created a (disabled) subscription for every item captured from a
// list. The list's subscription already refreshes them; drop the disabled ones.
// Enabled ones were switched on by the person and stay.
async function pruneListChildJobs() {
  const listUrls = new Set((settings.refreshJobs || []).filter((job) => job.pageKind === "list").map((job) => normalizeUrlForMatch(job.url || "")));
  if (!listUrls.size) return 0;
  const items = await listItems({ includeLists: true });
  const childUrls = new Set(items
    .filter((item) => item.url && item.parentUrl && listUrls.has(normalizeUrlForMatch(item.parentUrl)))
    .map((item) => normalizeUrlForMatch(item.url)));
  const before = settings.refreshJobs || [];
  const kept = before.filter((job) => !(job.pageKind === "content" && !job.enabled && job.managedBy !== "content-page" && childUrls.has(normalizeUrlForMatch(job.url || ""))));
  if (kept.length === before.length) return 0;
  settings = { ...settings, refreshJobs: kept };
  await persistSettings();
  console.log(`Removed ${before.length - kept.length} disabled subscription(s) for items that their list already refreshes.`);
  return before.length - kept.length;
}

async function syncContentRefreshJobsFromItems() {
  const items = await listItems({ includeLists: true });
  const itemsByUrl = new Map(items
    .filter((item) => item.url)
    .map((item) => [normalizeUrlForMatch(item.url), item])
    .filter(([url]) => Boolean(url)));
  const existingByUrl = new Map((settings.refreshJobs || [])
    .map((job) => [normalizeUrlForMatch(job.url || ""), job])
    .filter(([url]) => Boolean(url)));
  const existingUrls = new Set(existingByUrl.keys());
  const jobsToAdd = [];
  let touchedExisting = false;

  for (const [url, job] of existingByUrl.entries()) {
    const item = itemsByUrl.get(url);
    if (!item) continue;
    if (isSubscriptionManagedItem(item) && job.pageKind === "content" && job.managedBy === "content-page") {
      job.managedBy = "subscription";
      touchedExisting = true;
    }
  }

  for (const item of items) {
    // Older metadata has no subscribe field and keeps its existing behavior.
    if (item.subscribe === false) continue;
    if (!item.url || item.pageKind === "list") continue;
    if (isInvalidTeamsRootCapture(item)) continue;
    if (isSubscriptionManagedItem(item)) {
      await markItemManagedBySubscription(item);
      continue;
    }
    const canonicalUrl = canonicalizeMaterialUrl(item.url);
    const normalizedUrl = normalizeUrlForMatch(canonicalUrl);
    if (!normalizedUrl) continue;
    const existing = existingByUrl.get(normalizedUrl);
    if (existing) {
      if (existing.pageKind === "content" && existing.managedBy !== "content-page") {
        existing.managedBy = "content-page";
        touchedExisting = true;
      }
      continue;
    }
    const adapter = detectSourceAdapter(canonicalUrl);
    const job = normalizeRefreshJob({
      id: defaultRefreshJobIdForContentUrl(canonicalUrl, adapter),
      name: defaultRefreshJobNameForContentUrl(canonicalUrl, item.title),
      url: canonicalUrl,
      managedBy: "content-page",
      enabled: false,
      intervalMinutes: 60,
      maxItems: 1,
      tags: item.tags || [],
      fetchMode: defaultRefreshFetchModeForAdapter(adapter, item.fetchMode || "auto"),
      pageKind: "content",
      status: "idle",
      lastRunAt: "",
      lastStartedAt: "",
      lastError: "",
      lastResult: null
    }, {});
    jobsToAdd.push(job);
    existingUrls.add(normalizedUrl);
  }

  if (!jobsToAdd.length && !touchedExisting) return 0;
  settings = {
    ...settings,
    refreshJobs: mergeRefreshJobs(settings.refreshJobs || [], jobsToAdd)
  };
  await persistSettings();
  return jobsToAdd.length;
}

function isSubscriptionManagedItem(item) {
  return item.managedBy === "subscription" || Boolean(item.parentUrl) || item.sourceType === "teams";
}

async function markItemManagedBySubscription(item) {
  if (item.managedBy === "subscription") return;
  const itemDir = path.join(itemsDir, item.id);
  const metadataPath = path.join(itemDir, "metadata.json");
  if (!(await exists(metadataPath))) return;
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (metadata.managedBy === "subscription") return;
  metadata.managedBy = "subscription";
  metadata.updatedAt = metadata.updatedAt || new Date().toISOString();
  // A metadata-only commit also re-renders the document header, atomically.
  await store.commit(item.id, { metadata });
}

function defaultRefreshJobIdForContentUrl(url, adapter) {
  if (adapter.sourceType === "teams") return `${slugify(adapter.hostname)}-conversation-${slugify(url).slice(0, 64)}`;
  return `${slugify(adapter.hostname || adapter.sourceType)}-content-${slugify(url).slice(0, 64)}`;
}

function defaultRefreshJobNameForContentUrl(url, title) {
  const adapter = detectSourceAdapter(url);
  if (title && title !== url) return `${title} refresh`;
  if (adapter.sourceType === "teams") return "Teams conversation refresh";
  return "Content refresh";
}

function defaultRefreshJobIdForListUrl(url, adapter) {
  try {
    const parsed = new URL(url);
    if (adapter.sourceType === "jira") {
      const filter = parsed.searchParams.get("filter");
      if (filter) return `${slugify(adapter.hostname)}-filter-${filter}`;
    }
    if (adapter.sourceType === "github" && parsed.pathname === "/notifications") {
      const query = parsed.searchParams.get("query") || "all";
      return `${slugify(adapter.hostname)}-notifications-${slugify(query.replace(/^reason:/i, ""))}`;
    }
    if (adapter.sourceType === "github" && isGithubIssueSearchUrl(url)) {
      return `${slugify(adapter.hostname)}-search-${createHash("sha1").update(url).digest("hex").slice(0, 10)}`;
    }
  } catch {
    // Fall through to a URL-based id.
  }
  return `${slugify(adapter.hostname || adapter.sourceType)}-${slugify(url)}`;
}

function defaultRefreshJobNameForListUrl(url, title) {
  if (title && title !== url) return `${title} refresh`;
  const adapter = detectSourceAdapter(url);
  if (adapter.sourceType === "github" && safePathname(url) === "/notifications") return "GitHub notifications";
  if (adapter.sourceType === "github" && isGithubIssueSearchUrl(url)) return githubIssueSearchTitle(url);
  if (adapter.sourceType === "jira") return "Jira filter";
  return "List refresh";
}

function defaultRefreshTagsForListUrl(url, adapter) {
  return [];
}

function defaultRefreshFetchModeForAdapter(adapter, requestedMode) {
  if (requiresWebdriverExpansion(adapter)) return "webdriver";
  if (requestedMode === "fetch" || requestedMode === "webdriver") return requestedMode;
  return adapterPrefersWebdriver(adapter) ? "webdriver" : "fetch";
}

function shouldFetchWithWebdriver(url, requestedMode, pageKind = "auto", sourceType = "") {
  const adapter = detectSourceAdapter(url || "");
  if (adapter.sourceType === "teams" && hasTeamsGraphCredentials(adapter)) return false;
  if (hasJiraApiCredentials(adapter)) return false;
  if (requiresWebdriverExpansion(adapter)) return true;
  if (requestedMode === "webdriver") return true;
  if (requestedMode === "fetch") return false;
  if (sourceType === "jira" || sourceType === "teams") return true;
  return adapterPrefersWebdriver(adapter);
}

function adapterPrefersWebdriver(adapter) {
  return adapter.sourceType === "jira" || adapter.sourceType === "teams";
}

// Jira with a token or username/password can use the REST API instead of a browser.
function hasJiraApiCredentials(adapter) {
  if (adapter.sourceType !== "jira") return false;
  const profile = settings.sources?.[adapter.hostname] || {};
  return (profile.authMode === "bearer" && Boolean(profile.token)) || (profile.authMode === "basic" && Boolean(profile.username && profile.password));
}

function hasGithubToken(adapter) {
  return adapter.sourceType === "github" && Boolean(settings.sources?.[adapter.hostname]?.token);
}

function requiresWebdriverExpansion(adapter) {
  // With a token the REST API returns the full issue and comments; no page needed.
  return adapter.sourceType === "github" && adapter.hostname === "github.ecodesamsung.com" && !hasGithubToken(adapter);
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
  await store.commit(id, { metadata, body, summary });
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
  await store.commit(id, { metadata, body, summary });
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
  await store.commit(id, { metadata, body, summary });
  await rebuildIndexes();
  return readItem(id);
}


async function readItem(id) {
  return store.read(id);
}

async function deleteItem(id) {
  return store.delete(id);
}

async function listItems(filters = {}) {
  return store.list({
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


// indexes/*.json are for external tools (Codex, AGENTS.md); the server never reads
// them. Coalesce bursts of writes into one rebuild instead of one per item.
let indexRebuildTimer = null;
function rebuildIndexes() {
  clearTimeout(indexRebuildTimer);
  indexRebuildTimer = setTimeout(() => {
    indexRebuildTimer = null;
    store.rebuildIndexes().catch((error) => console.warn("Index rebuild failed:", error.message || error));
  }, 1500);
  indexRebuildTimer.unref?.();
  return Promise.resolve();
}

async function flushIndexRebuild() {
  if (!indexRebuildTimer) return;
  clearTimeout(indexRebuildTimer);
  indexRebuildTimer = null;
  await store.rebuildIndexes();
}

function startRefreshScheduler() {
  if (refreshRuntime.timer) clearInterval(refreshRuntime.timer);
  refreshRuntime.timer = setInterval(() => {
    runDueRefreshJobs().catch((error) => {
      console.error("Scheduled refresh failed:", error);
    });
  }, 60 * 1000);
}

async function runDueRefreshJobs() {
  if (libraryMaintenance) return;
  if (settings.doNotDisturb?.enabled) return;
  const now = new Date();
  const dueJobs = [];
  for (const job of settings.refreshJobs || []) {
    if (!job.enabled || isRefreshJobActive(job.id)) continue;
    const dueAt = nextDueRefreshSlot(job, now, settings.refreshSchedule);
    if (dueAt) dueJobs.push(job);
  }
  if (!dueJobs.length) return;

  const teamsJobs = dueJobs.filter((job) => detectSourceAdapter(job.url || "").sourceType === "teams");
  const unattendedJobs = dueJobs.filter((job) => detectSourceAdapter(job.url || "").sourceType !== "teams");
  if (teamsJobs.length) {
    await startRefreshRunByIds(teamsJobs.map((job) => job.id), { sourceType: "teams" });
  }
  if (!unattendedJobs.length) return;

  const result = await runRefreshJobsBatch(unattendedJobs);
  for (const entry of result.results || []) {
    if (entry.status === "failed") {
      console.error(`Scheduled refresh failed for ${entry.id}:`, entry.error || "unknown error");
    }
  }
}

function nextDueRefreshSlot(job, now = new Date(), schedule = {}) {
  return nextDueCaptureSlot(job, now, schedule);
}

async function runRefreshJobById(id, options = {}) {
  const job = (settings.refreshJobs || []).find((candidate) => candidate.id === id);
  if (!job) throw new Error("Refresh job not found.");
  if (!options.force && !job.enabled) throw new Error("Refresh job is disabled.");
  const result = await runRefreshJobsBatch([job], options);
  return {
    ...result,
    id: job.id
  };
}

async function startRefreshRunByIds(ids, options = {}) {
  const requestedIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
  const requested = new Set(requestedIds);
  const jobs = (settings.refreshJobs || []).filter((job) => requested.has(job.id));
  if (requestedIds.length && jobs.length !== requested.size) {
    throw new Error("Some refresh jobs were not found.");
  }
  if (!options.force) {
    const disabled = jobs.find((job) => !job.enabled);
    if (disabled) throw new Error(`Refresh job is disabled: ${disabled.name || disabled.id}`);
  }
  const runnableJobs = jobs
    .filter((job) => options.force || job.enabled)
    .filter((job) => !isInvalidTeamsRootRefreshJob(job));
  const run = createRefreshRun(runnableJobs, options);
  Promise.resolve()
    .then(async () => {
      updateRefreshRun(run, { status: "running" });
      const result = await runRefreshJobsBatch(runnableJobs, { ...options, run });
      updateRefreshRun(run, {
        status: run.cancelRequested ? "canceled" : result.failureCount ? "failed" : "completed",
        result,
        jobs: publicRefreshJobs(),
        finishedAt: new Date().toISOString(),
        currentJobId: "",
        currentJobName: "",
        completedJobs: result.jobCount || run.totalJobs,
        failedJobs: result.failureCount || 0
      });
    })
    .catch((error) => {
      updateRefreshRun(run, {
        status: run.cancelRequested ? "canceled" : "failed",
        error: error.message || String(error),
        jobs: publicRefreshJobs(),
        finishedAt: new Date().toISOString(),
        currentJobId: "",
        currentJobName: ""
      });
    });
  return publicRefreshRun(run.id);
}

function createRefreshRun(jobs, options = {}) {
  cleanupRefreshRuns();
  const now = new Date().toISOString();
  const sourceType = cleanText(options.sourceType || "all");
  const run = {
    id: `refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "queued",
    sourceType,
    jobIds: jobs.map((job) => job.id),
    totalJobs: jobs.length,
    completedJobs: 0,
    failedJobs: 0,
    currentJobId: "",
    currentJobName: "",
    cancelRequested: false,
    refreshContext: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: "",
    result: null,
    error: "",
    jobs: publicRefreshJobs()
  };
  refreshRuntime.runs.set(run.id, run);
  return run;
}

function updateRefreshRun(run, patch = {}) {
  if (!run) return null;
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  refreshRuntime.runs.set(run.id, run);
  return run;
}

function publicRefreshRuns() {
  cleanupRefreshRuns();
  return [...refreshRuntime.runs.values()].map(publicRefreshRunFromRecord);
}

function publicRefreshRun(id) {
  cleanupRefreshRuns();
  const run = refreshRuntime.runs.get(id);
  return run ? publicRefreshRunFromRecord(run) : null;
}

function publicRefreshRunFromRecord(run) {
  return {
    id: run.id,
    status: run.status,
    sourceType: run.sourceType,
    jobIds: run.jobIds,
    totalJobs: run.totalJobs,
    completedJobs: run.completedJobs,
    failedJobs: run.failedJobs,
    currentJobId: run.currentJobId,
    currentJobName: run.currentJobName,
    cancelRequested: Boolean(run.cancelRequested),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    result: run.result,
    error: run.error,
    // Live status of this run's jobs (not the snapshot taken when it started).
    jobs: publicRefreshJobs().filter((job) => (run.jobIds || []).includes(job.id))
  };
}

function cleanupRefreshRuns() {
  const cutoff = Date.now() - REFRESH_RUN_RETENTION_MS;
  for (const [id, run] of refreshRuntime.runs.entries()) {
    if (!run.finishedAt) continue;
    const finished = Date.parse(run.finishedAt);
    if (!Number.isNaN(finished) && finished < cutoff) refreshRuntime.runs.delete(id);
  }
}

async function cancelRefreshRun(id) {
  const run = refreshRuntime.runs.get(id);
  if (!run) throw new Error("Refresh run not found.");
  if (["completed", "failed", "canceled"].includes(run.status)) return publicRefreshRunFromRecord(run);
  updateRefreshRun(run, {
    status: "canceling",
    cancelRequested: true,
    error: "用户已请求取消刷新。"
  });
  run.abortController?.abort();
  await closeRefreshRunContext(run);
  return publicRefreshRunFromRecord(run);
}

async function closeRefreshRunContext(run) {
  const context = run?.refreshContext;
  if (!context?.webdriverSession) return;
  try {
    await closeWebdriverSession(context.webdriverSession);
  } catch {
    // Best-effort cancellation; the job loop checks cancelRequested between jobs.
  }
}

async function runRefreshJobsByIds(ids, options = {}) {
  const requestedIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
  const requested = new Set(requestedIds);
  const jobs = (settings.refreshJobs || []).filter((job) => requested.has(job.id));
  if (requestedIds.length && jobs.length !== requested.size) {
    throw new Error("Some refresh jobs were not found.");
  }
  if (!options.force) {
    const disabled = jobs.find((job) => !job.enabled);
    if (disabled) throw new Error(`Refresh job is disabled: ${disabled.name || disabled.id}`);
  }
  return runRefreshJobsBatch(jobs, options);
}

async function runRefreshJobsBatch(jobs, options = {}) {
  const runnableJobs = jobs
    .filter((job) => options.force || job.enabled)
    .filter((job) => options.force || (!job.circuitOpen && (!job.nextRetryAt || Date.parse(job.nextRetryAt) <= Date.now())))
    .filter((job) => !isInvalidTeamsRootRefreshJob(job));
  const queuedIds = [];
  for (const job of runnableJobs) {
    if (refreshRuntime.running.has(job.id) || refreshRuntime.queued.has(job.id)) continue;
    refreshRuntime.queued.add(job.id);
    queuedIds.push(job.id);
  }
  const jobsToRun = runnableJobs.filter((job) => queuedIds.includes(job.id));
  const groups = await buildRefreshGroups(jobsToRun, options);
  const results = [];
  const startedAt = new Date().toISOString();
  const run = options.run || null;
  if (run) updateRefreshRun(run, { totalJobs: jobsToRun.length, queuedJobIds: jobsToRun.map((job) => job.id) });

  try {
    for (const group of groups) {
      if (run?.cancelRequested) break;
      let refreshContext = null;
      const refreshedUrls = new Set(group.jobs.map((job) => normalizeUrlForMatch(job.url)).filter(Boolean));
      try {
        refreshContext = await createRefreshGroupContext(group, run);
        if (run) updateRefreshRun(run, { refreshContext });
        await verifyRefreshGroupAuthentication(group, refreshContext);
        for (const job of group.jobs) {
          if (run?.cancelRequested) break;
          try {
            if (run) updateRefreshRun(run, { currentJobId: job.id, currentJobName: job.name || job.id });
            const result = await runRefreshJob(job, { refreshContext, run });
            results.push({ id: job.id, status: result.status || "ok", result });
            rememberRefreshedContentUrls(refreshedUrls, result);
          } catch (error) {
            if (isAuthenticationRequiredError(error)) {
              keepRefreshGroupOpenForLogin(refreshContext);
              throw error;
            }
            results.push({
              id: job.id,
              status: "failed",
              error: error.message || String(error),
              result: failedRefreshJobResult(job, error)
            });
          } finally {
            if (run) {
              const completedJobs = results.filter((entry) => entry.status !== "running").length;
              const failedJobs = results.filter((entry) => entry.status === "failed").length;
              updateRefreshRun(run, { completedJobs, failedJobs });
            }
          }
        }
      } catch (error) {
        if (isAuthenticationRequiredError(error)) {
          keepRefreshGroupOpenForLogin(refreshContext);
        }
        for (const job of group.jobs) {
          if (results.some((entry) => entry.id === job.id)) continue;
          await markRefreshJobFailed(job, error);
          results.push({
            id: job.id,
            status: "failed",
            error: error.message || String(error),
            result: failedRefreshJobResult(job, error)
          });
        }
    } finally {
      updateRefreshRun(run, { refreshContext: null });
      await closeRefreshGroupContext(refreshContext);
    }
    }

    // Jobs that never started (cancel) must not wait for the AI step to become runnable.
    for (const id of queuedIds) refreshRuntime.queued.delete(id);
    const aiProcessing = await processUpdatedItemsAfterRefresh(results, { signal: run?.abortController?.signal });
    await annotateRefreshResultsWithAiProcessing(results, aiProcessing);
    const summary = summarizeRefreshBatch(results, startedAt, groups, aiProcessing);
    if (run?.cancelRequested) {
      summary.canceled = true;
      summary.errorCount = Number(summary.errorCount || 0) + 1;
    }
    await notifyRefreshBatchResult(summary);
    await refreshHistory.append({
      id: run?.id || `refresh-${Date.now()}`,
      sourceType: cleanText(options.sourceType || "all"),
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      jobCount: summary.jobCount,
      successCount: summary.successCount,
      failureCount: summary.failureCount,
      updatedItemCount: summary.updatedItemCount,
      errorCount: summary.errorCount,
      canceled: Boolean(summary.canceled)
    });
    return summary;
  } finally {
    for (const id of queuedIds) refreshRuntime.queued.delete(id);
  }
}

function keepRefreshGroupOpenForLogin(refreshContext) {
  if (!refreshContext?.webdriverSession) return;
  refreshContext.closeWhenDone = false;
  refreshContext.webdriverSession.manual = true;
  refreshContext.webdriverSession.autoClose = false;
}

async function markRefreshJobFailed(job, error) {
  const unreachable = isNetworkUnavailableForJob(job, error);
  const lastError = unreachable ? networkUnavailableMessage(job) : error.message || String(error);
  const retry = refreshFailureState(job);
  await updateRefreshJobState(job.id, {
    status: unreachable ? "unreachable" : "failed",
    lastRunAt: new Date().toISOString(),
    lastError,
    lastResult: failedRefreshJobResult(job, lastError),
    ...retry
  });
}

function failedRefreshJobResult(job, error) {
  const message = typeof error === "string" ? error : error?.message || String(error || "unknown error");
  return {
    id: job?.id || "",
    sourceType: detectSourceAdapter(job?.url || "").sourceType,
    failedAt: new Date().toISOString(),
    linkCount: job?.pageKind === "content" ? 1 : 0,
    updatedItemCount: 0,
    skippedItemCount: 0,
    errorCount: 1,
    updatedItems: [],
    skippedItems: [],
    errors: [{ url: job?.url || "", error: message }]
  };
}

function isRefreshJobActive(id) {
  return refreshRuntime.running.has(id) || refreshRuntime.queued.has(id);
}

async function reconcileStaleRunningRefreshJobs() {
  const staleJobs = (settings.refreshJobs || []).filter((job) => job.status === "running" && !isRefreshJobActive(job.id));
  if (!staleJobs.length) return 0;
  const now = new Date().toISOString();
  settings = {
    ...settings,
    refreshJobs: (settings.refreshJobs || []).map((job) => {
      if (!staleJobs.some((stale) => stale.id === job.id)) return job;
      const error = "刷新任务已中断：服务重启或浏览器会话结束，已自动恢复为失败状态。";
      return {
        ...job,
        status: "failed",
        lastRunAt: job.lastRunAt || now,
        lastError: job.lastError || error,
        lastResult: failedRefreshJobResult(job, job.lastError || error)
      };
    })
  };
  await persistSettings({ runtimeOnly: true });
  return staleJobs.length;
}

function groupRefreshJobsBySource(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    const adapter = detectSourceAdapter(job.url || "");
    const key = `${adapter.sourceType || "web"}:${adapter.hostname || safeHostname(job.url || "") || "unknown"}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        sourceType: adapter.sourceType || "web",
        hostname: adapter.hostname || safeHostname(job.url || ""),
        seedUrl: job.url || "",
        jobs: []
      });
    }
    byKey.get(key).jobs.push(job);
  }
  return sortRefreshGroups([...byKey.values()]);
}

async function buildRefreshGroups(jobs, options = {}) {
  return groupRefreshJobsBySource(jobs);
}

function sortRefreshGroups(groups) {
  return [...groups].sort((a, b) => {
    const priority = { jira: 1, teams: 2 };
    return (priority[a.sourceType] || 10) - (priority[b.sourceType] || 10);
  });
}

async function createRefreshGroupContext(group, run = null) {
  const needsWebdriver = group.jobs.some((job) => {
    const adapter = detectSourceAdapter(job.url || "");
    return resolvedRefreshFetchMode(job, adapter) === "webdriver";
  });
  if (!needsWebdriver) return null;
  const targetUrl = group.seedUrl || group.jobs[0]?.url || "";
  const adapter = detectSourceAdapter(targetUrl);
  const sessionUrl = group.sourceType === "teams" ? `https://${adapter.hostname}` : targetUrl;
  const session = await ensureWebdriverSession(adapter.hostname, sessionUrl, {
    autoClose: false,
    headed: group.sourceType === "teams",
    manual: group.sourceType === "teams",
    windowMode: group.sourceType === "teams" ? "background" : group.sourceType === "jira" ? "normal" : undefined
  });
  const page = await ensureSessionPage(session);
  session.page = page;

  const refreshContext = {
    adapter,
    run,
    webdriverSession: session,
    webdriverPage: page,
    closeWhenDone: group.sourceType === "teams" ? false : !session.manual
  };
  if (run) updateRefreshRun(run, { refreshContext });

  if (group.sourceType === "teams") {
    await prepareTeamsRefreshGroup(page, adapter, run, session);
  }

  return refreshContext;
}

async function verifyRefreshGroupAuthentication(group, refreshContext = null) {
  const targetUrl = group.seedUrl || group.jobs[0]?.url || "";
  const adapter = detectSourceAdapter(targetUrl);
  if (!shouldPrecheckAuthentication(adapter)) return;

  if (refreshContext?.webdriverPage && resolvedRefreshFetchMode({ url: targetUrl, pageKind: inferPageKind(targetUrl, adapter) }, adapter) === "webdriver") {
    await verifyWebdriverAuthentication(refreshContext.webdriverPage, targetUrl, adapter);
    return;
  }

  await fetchUrl(targetUrl, { pageKind: inferPageKind(targetUrl, adapter) });
}

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
  const profile = settings.sources?.[adapter.hostname] || {};
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
    timeoutMs: TEAMS_LOGIN_TIMEOUT_MS,
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

async function confirmTeamsRefreshReady(runId) {
  const run = refreshRuntime.runs.get(runId);
  if (!run) throw new Error("Refresh run not found.");
  if (run.status !== "waiting_for_teams_confirmation") {
    throw new Error("当前刷新任务不在等待 Teams 确认状态。");
  }
  const session = run.refreshContext?.webdriverSession;
  const page = run.refreshContext?.webdriverPage;
  if (!session || !page || page.isClosed()) {
    throw new Error("Teams WebDriver 会话已经关闭，请重新启动刷新。");
  }
  if (!(await isTeamsWebAppReady(page))) {
    throw new Error("尚未检测到 Teams 聊天主界面。请在 WebDriver 中完成登录、选择“使用 Web 应用”，并确认聊天列表可见。");
  }
  const confirmedAt = new Date().toISOString();
  session.teamsUserConfirmedAt = confirmedAt;
  updateRefreshRun(run, {
    teamsReadyConfirmed: true,
    teamsReadyConfirmedAt: confirmedAt,
    status: "running",
    currentJobName: "Teams 页面已确认，准备定位目标对话"
  });
  return publicRefreshRunFromRecord(run);
}

async function closeRefreshGroupContext(refreshContext) {
  if (!refreshContext?.webdriverSession || !refreshContext.closeWhenDone) return;
  await closeWebdriverSession(refreshContext.webdriverSession);
}

function rememberRefreshedContentUrls(refreshedUrls, result) {
  const entries = [
    ...(result?.updatedItems || []),
    ...(result?.skippedItems || []),
    ...(result?.errors || [])
  ];
  for (const entry of entries) {
    for (const value of [entry.url, entry.sourceUrl]) {
      const normalized = normalizeUrlForMatch(value || "");
      if (normalized) refreshedUrls.add(normalized);
    }
  }
}

async function processUpdatedItemsAfterRefresh(results, options = {}) {
  const itemIds = options.signal?.aborted ? [] : await collectRefreshItemIdsNeedingAi(results);
  if (!itemIds.length) {
    return { requestedCount: 0, processedCount: 0, skippedCount: 0, errorCount: 0, processedItems: [], errors: [] };
  }
  if (!settings.ai?.baseUrl || !settings.ai?.apiKey || !settings.ai?.model) {
    return {
      requestedCount: itemIds.length,
      processedCount: 0,
      skippedCount: itemIds.length,
      errorCount: 0,
      processedItems: [],
      errors: [],
      note: "未配置 AI 接口，原文更新已保存并显示为未读。"
    };
  }

  const processedItems = [];
  const errors = [];
  for (const itemId of itemIds) {
    if (options.signal?.aborted) break;
    try {
      const item = await processItemWithAi(itemId, options);
      processedItems.push({
        itemId,
        title: item.metadata.title,
        url: item.metadata.url,
        sourceType: item.metadata.sourceType,
        contentUpdatedAt: item.metadata.contentUpdatedAt || ""
      });
    } catch (error) {
      errors.push({ itemId, error: error.message || String(error) });
    }
  }
  return {
    requestedCount: itemIds.length,
    processedCount: processedItems.length,
    skippedCount: 0,
    errorCount: errors.length,
    processedItems,
    errors
  };
}

async function collectRefreshItemIdsNeedingAi(results) {
  const candidateIds = collectRefreshCandidateItemIds(results);
  const itemIds = [];
  for (const itemId of candidateIds) {
    try {
      const item = await readItem(itemId);
      // Message streams wait until enough has accumulated (settings.autoProcess);
      // below the threshold the item stays marked stale and the reader shows the
      // original messages.
      if (shouldAutoProcess(item, settings.autoProcess).process) itemIds.push(itemId);
    } catch {
      // Ignore missing items; the refresh result may be stale.
    }
  }
  return itemIds;
}

function collectRefreshCandidateItemIds(results) {
  const ids = [];
  const seen = new Set();
  for (const entry of results || []) {
    const result = entry?.result || {};
    const candidates = [
      ...(result.updatedItems || []),
      ...(result.updatedIssues || []),
      ...(result.skippedItems || [])
    ];
    for (const item of candidates) {
      const itemId = cleanText(item.itemId || "");
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);
      ids.push(itemId);
    }
  }
  return ids;
}

async function annotateRefreshResultsWithAiProcessing(results, aiProcessing) {
  const processed = new Set((aiProcessing.processedItems || []).map((item) => item.itemId));
  const failed = new Set((aiProcessing.errors || []).map((item) => item.itemId));
  for (const entry of results || []) {
    if (!entry?.result) continue;
    const updatedEntries = [
      ...(entry.result.updatedItems || []),
      ...(entry.result.updatedIssues || []),
      ...(entry.result.skippedItems || [])
    ];
    const aiProcessedCount = updatedEntries.filter((item) => processed.has(item.itemId)).length;
    const aiProcessErrorCount = updatedEntries.filter((item) => failed.has(item.itemId)).length;
    entry.result = {
      ...entry.result,
      newItemCount: Number(entry.result.updatedItemCount ?? entry.result.updatedIssueCount ?? 0),
      aiProcessedCount,
      aiProcessErrorCount,
      aiProcessingErrors: (aiProcessing.errors || []).filter((item) => updatedEntries.some((updated) => updated.itemId === item.itemId))
    };
  }
  await updateRefreshJobsLastResults(results);
}

async function updateRefreshJobsLastResults(results) {
  const byId = new Map((results || [])
    .filter((entry) => entry?.id && entry.result)
    .map((entry) => [entry.id, entry.result]));
  if (!byId.size) return;
  settings = {
    ...settings,
    refreshJobs: (settings.refreshJobs || []).map((job) => (
      byId.has(job.id) ? { ...job, lastResult: byId.get(job.id) } : job
    ))
  };
  await persistSettings({ runtimeOnly: true });
}

function summarizeRefreshBatch(results, startedAt, groups, aiProcessing = null) {
  const successful = results.filter((entry) => entry.status !== "failed" && entry.status !== "running");
  const failed = results.filter((entry) => entry.status === "failed");
  const running = results.filter((entry) => entry.status === "running");
  const sum = (field, fallback) => successful.reduce((total, entry) => total + Number(entry.result?.[field] ?? (fallback ? entry.result?.[fallback] : 0) ?? 0), 0);
  const aiProcessedCount = Number(aiProcessing?.processedCount || 0);
  const aiProcessErrorCount = Number(aiProcessing?.errorCount || 0);
  return {
    id: "batch-refresh",
    startedAt,
    finishedAt: new Date().toISOString(),
    groupCount: groups.length,
    jobCount: results.length,
    successCount: successful.length,
    runningCount: running.length,
    failureCount: failed.length,
    linkCount: sum("linkCount", "issueCount"),
    updatedItemCount: sum("updatedItemCount", "updatedIssueCount"),
    newItemCount: sum("updatedItemCount", "updatedIssueCount"),
    aiProcessedCount,
    aiProcessErrorCount,
    aiProcessing: aiProcessing || { requestedCount: 0, processedCount: 0, skippedCount: 0, errorCount: 0, processedItems: [], errors: [] },
    skippedItemCount: sum("skippedItemCount"),
    errorCount: failed.length + sum("errorCount"),
    results
  };
}

async function runRefreshJob(job, options = {}) {
  if (refreshRuntime.running.has(job.id)) {
    return { id: job.id, status: "running" };
  }

  refreshRuntime.queued.delete(job.id);
  refreshRuntime.running.add(job.id);
  const startedAt = new Date().toISOString();
  await updateRefreshJobState(job.id, {
    status: "running",
    lastStartedAt: startedAt,
    lastError: ""
  });

  try {
    const result = await withRefreshJobTimeout(job, options.run, async (abortSignal) => {
      const refreshContext = { ...(options.refreshContext || {}), abortSignal };
      return job.pageKind === "content"
        ? refreshContentJob({ ...job, lastStartedAt: startedAt }, refreshContext)
        : refreshListJob({ ...job, lastStartedAt: startedAt }, refreshContext);
    });
    await updateRefreshJobState(job.id, {
      status: "idle",
      lastRunAt: new Date().toISOString(),
      lastResult: result,
      lastError: "",
      quarantined: false,
      quarantineReason: "",
      consecutiveFailures: 0,
      nextRetryAt: "",
      circuitOpen: false
    });
    return result;
  } catch (error) {
    const unreachable = isNetworkUnavailableForJob(job, error);
    const lastError = unreachable ? networkUnavailableMessage(job) : error.message || String(error);
    const retry = refreshFailureState(job);
    await updateRefreshJobState(job.id, {
      status: unreachable ? "unreachable" : "failed",
      lastRunAt: new Date().toISOString(),
      lastError,
      lastResult: failedRefreshJobResult(job, lastError),
      ...retry
    });
    if (unreachable) {
      const friendlyError = new Error(lastError);
      friendlyError.code = "NETWORK_UNAVAILABLE";
      throw friendlyError;
    }
    throw error;
  } finally {
    refreshRuntime.running.delete(job.id);
  }
}

function refreshJobTimeoutMs(job) {
  const adapter = detectSourceAdapter(job.url || "");
  if (adapter.sourceType === "teams") return TEAMS_REFRESH_JOB_TIMEOUT_MS;
  // List jobs open one page per changed child; give them room, and they stop early on their own.
  if (job.pageKind === "list" || inferPageKind(job.url || "", adapter) === "list") return LIST_REFRESH_JOB_TIMEOUT_MS;
  return REFRESH_JOB_TIMEOUT_MS;
}

async function withRefreshJobTimeout(job, run, task) {
  let timer;
  let timedOut = false;
  const controller = new AbortController();
  if (run) run.abortController = controller;
  const timeoutMs = refreshJobTimeoutMs(job);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      timedOut = true;
      controller.abort();
      const error = new Error(`刷新任务超时：${job.name || job.id} 超过 ${Math.round(timeoutMs / 60000)} 分钟未完成。`);
      error.code = "REFRESH_JOB_TIMEOUT";
      if (run) updateRefreshRun(run, { error: error.message });
      await closeRefreshRunContext(run);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    if (run?.abortController === controller) run.abortController = null;
    if (timedOut && run) updateRefreshRun(run, { status: "failed" });
  }
}

function assertRefreshActive(refreshContext) {
  if (refreshContext?.abortSignal?.aborted) {
    const error = new Error("刷新任务已取消或超时，已阻止写入。");
    error.code = "REFRESH_ABORTED";
    throw error;
  }
}

function isNetworkUnavailableForJob(job, error) {
  const adapter = detectSourceAdapter(job.url || "");
  if (!requiresCompanyNetwork(adapter.hostname)) return false;
  return isNetworkAccessError(error);
}

function requiresCompanyNetwork(hostname) {
  return [
    "jira.amlogic.com",
    "confluence.amlogic.com"
  ].includes(String(hostname || "").toLowerCase());
}

function isNetworkAccessError(error) {
  const message = String(error?.message || error || "");
  return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/i.test(message);
}

function networkUnavailableMessage(job) {
  const hostname = safeHostname(job.url || "") || detectSourceAdapter(job.url || "").hostname;
  return `当前网络无法访问 ${hostname}。如果不在公司网络或 VPN 未连接，本次刷新会跳过；连接公司网络后再刷新即可。`;
}

async function notifyRefreshBatchResult(summary) {
  const processedItems = summary?.aiProcessing?.processedItems || [];
  if (!processedItems.length) return;
  const sourceType = processedItems[0]?.sourceType || "web";
  if (!shouldNotifySource(sourceType)) return;

  const title = `资料更新：AI 已整理 ${processedItems.length} 条`;
  const firstTitle = cleanText(processedItems[0]?.title || "");
  const message = processedItems.length === 1
    ? firstTitle || "检测到 1 条新内容"
    : `${firstTitle || "检测到新内容"} 等 ${processedItems.length} 条`;
  await sendSystemNotification(title, message);
}

function shouldNotifySource(sourceType) {
  const notifications = normalizeNotificationSettings(settings.notifications || {});
  if (!notifications.enabled) return false;
  return notifications.sources?.[sourceType] !== false;
}

async function sendSystemNotification(title, message) {
  if (process.platform !== "darwin") {
    console.log(`[notification] ${title}: ${message}`);
    return;
  }
  await new Promise((resolve) => {
    const child = execFile("osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`
    ], () => resolve());
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The notification process may have already exited.
      }
      resolve();
    }, 3000).unref();
  });
}

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
  return store.list({ predicate: (metadata) => metadata.pageKind !== "list" && normalizeUrlForMatch(metadata.parentUrl || "") === key });
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
    await store.writeMetadata(id, { ...fresh.metadata, ...(buildPatch(fresh.metadata) || {}) });
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
    await store.writeMetadata(existing.id, metadata);
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

function resolvedRefreshFetchMode(job, adapter) {
  if (adapter.sourceType === "teams" && hasTeamsGraphCredentials(adapter)) return "fetch";
  // Issue search pages render client-side; only a token can use the search API instead.
  if (adapter.sourceType === "github" && hasGithubToken(adapter)) return "fetch";
  if (hasJiraApiCredentials(adapter)) return "fetch";
  if (adapter.sourceType === "github" && isGithubIssueSearchUrl(job.url || "")) return "webdriver";
  if (requiresWebdriverExpansion(adapter)) return "webdriver";
  if (
    adapter.sourceType === "github"
    && resolvePageKind(job.url || "", job.pageKind || "auto") === "content"
    && /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(safePathname(job.url || ""))
  ) {
    return "webdriver";
  }
  if (job.fetchMode === "fetch") return "fetch";
  if (job.fetchMode === "webdriver") return "webdriver";
  return adapterPrefersWebdriver(adapter) ? "webdriver" : "fetch";
}

async function updateRefreshJobState(id, patch) {
  settings = {
    ...settings,
    refreshJobs: (settings.refreshJobs || []).map((job) => (
      job.id === id ? { ...job, ...patch } : job
    ))
  };
  await persistSettings({ runtimeOnly: isRuntimeOnlyPatch(patch) });
}

async function deleteRefreshJob(id) {
  const before = settings.refreshJobs || [];
  const nextJobs = before.filter((job) => job.id !== id);
  if (nextJobs.length === before.length) {
    throw new Error("Refresh job not found.");
  }
  refreshRuntime.running.delete(id);
  settings = {
    ...settings,
    refreshJobs: nextJobs
  };
  await persistSettings();
  return publicRefreshJobs();
}

async function deleteRefreshJobItems(id) {
  const job = (settings.refreshJobs || []).find((candidate) => candidate.id === id);
  if (!job) throw new Error("Refresh job not found.");
  if (job.managedBy === "content-page") {
    throw new Error("普通页面整体管理的内容不能通过订阅清空。");
  }

  const dirs = await safeReaddir(itemsDir);
  const deletedItems = [];
  for (const itemId of dirs) {
    const metadataPath = path.join(itemsDir, itemId, "metadata.json");
    if (!(await exists(metadataPath))) continue;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    if (!isRefreshJobCapturedItem(job, metadata)) continue;
    await store.delete(itemId);
    deletedItems.push({
      id: metadata.id || itemId,
      title: metadata.title || itemId,
      url: metadata.url || ""
    });
  }

  const now = new Date().toISOString();
  await updateRefreshJobState(job.id, {
    status: "idle",
    lastError: "",
    lastResult: {
      clearedAt: now,
      deletedItemCount: deletedItems.length,
      deletedItems
    }
  });
  await rebuildIndexes();
  return {
    id: job.id,
    deletedItemCount: deletedItems.length,
    deletedItems
  };
}

async function deleteRefreshSourceItems(sourceType) {
  const source = cleanText(sourceType).toLowerCase();
  const jobs = (settings.refreshJobs || [])
    .filter((job) => sourceTypeForRefreshJob(job) === source);
  if (!source || !jobs.length) {
    return { sourceType: source, deletedItemCount: 0, deletedItems: [] };
  }

  const jobUrls = new Set(jobs.map((job) => normalizeUrlForMatch(job.url || "")).filter(Boolean));
  const dirs = await safeReaddir(itemsDir);
  const deletedItems = [];
  for (const itemId of dirs) {
    const metadataPath = path.join(itemsDir, itemId, "metadata.json");
    if (!(await exists(metadataPath))) continue;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    if (!isRefreshSourceCapturedItem(source, jobUrls, metadata)) continue;
    await store.delete(itemId);
    deletedItems.push({
      id: metadata.id || itemId,
      title: metadata.title || itemId,
      url: metadata.url || ""
    });
  }

  const now = new Date().toISOString();
  settings = {
    ...settings,
    refreshJobs: (settings.refreshJobs || []).map((job) => (
      sourceTypeForRefreshJob(job) === source
        ? {
            ...job,
            status: "idle",
            lastError: "",
            lastResult: {
              clearedAt: now,
              deletedItemCount: deletedItems.length
            }
          }
        : job
    ))
  };
  await persistSettings();
  await rebuildIndexes();
  return {
    sourceType: source,
    deletedItemCount: deletedItems.length,
    deletedItems
  };
}

function sourceTypeForRefreshJob(job) {
  return detectSourceAdapter(job?.url || "").sourceType || "";
}

function isRefreshSourceCapturedItem(sourceType, jobUrls, metadata) {
  if (!metadata || metadata.pageKind === "list") return false;
  if (String(metadata.sourceType || "").toLowerCase() !== sourceType) return false;
  const itemUrl = normalizeUrlForMatch(metadata.url || "");
  const parentUrl = normalizeUrlForMatch(metadata.parentUrl || "");
  if (itemUrl && jobUrls.has(itemUrl)) return true;
  if (parentUrl && jobUrls.has(parentUrl)) return true;
  return metadata.managedBy === "subscription" || metadata.managedBy === "content-page";
}

function isRefreshJobCapturedItem(job, metadata) {
  if (!metadata || metadata.pageKind === "list") return false;
  if (metadata.managedBy !== "subscription" && !metadata.parentUrl) return false;
  const jobUrl = normalizeUrlForMatch(job.url || "");
  if (!jobUrl) return false;
  const itemUrl = normalizeUrlForMatch(metadata.url || "");
  const parentUrl = normalizeUrlForMatch(metadata.parentUrl || "");
  return itemUrl === jobUrl || parentUrl === jobUrl;
}

async function fetchUrl(url, options = {}) {
  const adapter = detectSourceAdapter(url);
  if (options.apiFirst !== false) {
    try {
      const apiResult = await fetchUrlFromSourceApi(url, adapter, options);
      if (apiResult) return apiResult;
    } catch (error) {
      if (options.signal?.aborted || error?.name === "AbortError") throw error;
      // With a GitHub token the API is the capture path; a page fetch would only return the app shell.
      if (hasGithubToken(adapter)) throw new Error(`GitHub 接口请求失败（请检查令牌是否有效、是否有 repo 读取权限）：${error.message || error}`);
      if (hasJiraApiCredentials(adapter)) throw new Error(`Jira 接口请求失败（请检查「站点登录」里的账号密码或令牌）：${error.message || error}`);
      console.warn(`Source API fallback for ${url}:`, error.message || error);
    }
  }
  const headers = {
    "User-Agent": "MaterialOrganizer/0.1",
    ...buildAuthHeaders(url),
    ...(options.validators?.etag ? { "If-None-Match": options.validators.etag } : {}),
    ...(options.validators?.lastModified ? { "If-Modified-Since": options.validators.lastModified } : {})
  };
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || FETCH_TIMEOUT_MS));
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    if (response.status === 304) {
      return {
        notModified: true,
        url: response.url || url,
        httpValidators: options.validators || {},
        fetchMethod: "http-304"
      };
    }
    if (!response.ok) {
      throw new Error(`Could not fetch URL: ${response.status} ${response.statusText}`);
    }

    assertSafeFetchedResponse(response, url);
    const raw = await readResponseBodyLimited(response, MAX_FETCH_BYTES, controller.signal);
    const extracted = extractByAdapter(raw, url, adapter, options.pageKind || "auto");
    const title = extracted.title || extractTitle(raw);
    assertFetchedPageIsAuthenticated({
      adapter,
      requestedUrl: url,
      finalUrl: response.url || url,
      title,
      raw
    });
    return {
      raw,
      title,
      text: extracted.text,
      comments: extracted.comments || [],
      sourceUpdatedAt: extracted.sourceUpdatedAt || "",
      url: response.url || url,
      fetchMethod: "html",
      httpValidators: responseValidators(response)
    };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Capture canceled", "AbortError");
    if (controller.signal.aborted) throw new Error(`Fetch timed out after ${Math.round(Number(options.timeoutMs || FETCH_TIMEOUT_MS) / 1000)}s: ${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.("abort", abortFromCaller);
  }
}

function assertSafeFetchedResponse(response, url) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_FETCH_BYTES) {
    throw new Error(`Fetched page is larger than ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)} MB: ${url}`);
  }
  if (!isSupportedCaptureContentType(contentType)) {
    throw new Error(`Unsupported content type for page capture: ${contentType}`);
  }
}

function responseValidators(response) {
  return {
    etag: cleanText(response?.headers?.get?.("etag") || ""),
    lastModified: cleanText(response?.headers?.get?.("last-modified") || "")
  };
}

async function fetchUrlFromSourceApi(url, adapter, options = {}) {
  if (adapter.sourceType === "jira") return fetchJiraFromApi(url, adapter, options);
  if (adapter.sourceType === "confluence") return fetchConfluenceFromApi(url, adapter, options);
  if (adapter.sourceType === "github") return fetchGithubFromApi(url, adapter, options);
  if (adapter.sourceType === "teams") return fetchTeamsFromGraph(url, adapter, options);
  return null;
}

async function requestSourceJson(url, adapter, options = {}) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || FETCH_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "User-Agent": "MaterialOrganizer/0.1",
        "Accept": "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...buildAuthHeaders(`https://${adapter.hostname}`),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(`检测到 ${sourceLabel(adapter.sourceType)} 未登录，已停止抓取，未保存登录页。`);
    }
    if (response.status === 304) {
      return { data: null, raw: "", response, notModified: true };
    }
    if (!response.ok) {
      const error = new Error(`Source API request failed: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    const raw = await readResponseBodyLimited(response, MAX_FETCH_BYTES, controller.signal);
    return { data: JSON.parse(raw), raw, response };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.("abort", abortFromCaller);
  }
}

async function requestSourceCollection(url, adapter, options = {}) {
  const values = [];
  let nextUrl = String(url);
  let firstResponse = null;
  let pages = 0;
  while (nextUrl && pages < 20 && values.length < 1000) {
    const result = await requestSourceJson(nextUrl, adapter, options);
    if (result.notModified) return result;
    if (!firstResponse) firstResponse = result.response;
    const pageValues = Array.isArray(result.data) ? result.data : Array.isArray(result.data?.value) ? result.data.value : [];
    values.push(...pageValues);
    const link = String(result.response?.headers?.get?.("link") || "");
    const linkNext = link.split(",").map((part) => part.trim()).find((part) => /rel=["']?next["']?/i.test(part))?.match(/<([^>]+)>/)?.[1] || "";
    nextUrl = cleanText(result.data?.["@odata.nextLink"] || linkNext || "");
    pages += 1;
  }
  const truncated = Boolean(nextUrl) || values.length > 1000;
  return {
    data: values.slice(0, 1000),
    raw: JSON.stringify(values.slice(0, 1000), null, 2),
    response: firstResponse,
    pageCount: pages,
    truncated,
    nextUrl: truncated ? nextUrl : ""
  };
}

async function fetchJiraFromApi(url, adapter, options = {}) {
  const key = safePathname(url).match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1];
  const filterId = extractFilterId(url);
  if (!key && !filterId) return null;
  const origin = `https://${adapter.hostname}`;
  if (filterId) {
    const filter = await requestSourceJson(`${origin}/rest/api/2/filter/${encodeURIComponent(filterId)}`, adapter, options);
    const jql = filter.data?.jql;
    if (!jql) return null;
    const search = await requestSourceJson(`${origin}/rest/api/2/search`, adapter, {
      ...options,
      method: "POST",
      body: { jql, maxResults: Math.max(1, Number(options.maxItems || 100)), fields: ["summary", "status", "assignee", "updated"] }
    });
    const issues = (search.data?.issues || []).map((issue) => ({
      key: issue.key,
      href: `${origin}/browse/${issue.key}`,
      summary: cleanText(issue.fields?.summary || ""),
      status: cleanText(issue.fields?.status?.name || ""),
      assignee: cleanText(issue.fields?.assignee?.displayName || issue.fields?.assignee?.name || ""),
      updated: cleanText(issue.fields?.updated || "")
    }));
    return {
      ...renderJiraApiFilter(url, adapter, filter.data, issues, search.raw),
      // Filter results decide membership: issues that leave the filter are flagged for keep/delete.
      membershipComplete: Number(search.data?.total ?? issues.length) <= issues.length,
      completeness: Number(search.data?.total || issues.length) > issues.length ? "partial" : "complete",
      coverage: {
        observedCount: issues.length,
        expectedCount: Number(search.data?.total || issues.length),
        maxItems: Math.max(1, Number(options.maxItems || 100))
      }
    };
  }
  const result = await requestSourceJson(`${origin}/rest/api/2/issue/${encodeURIComponent(key)}?expand=renderedFields,changelog&fields=*all`, adapter, options);
  const commentResult = await requestSourceJson(`${origin}/rest/api/2/issue/${encodeURIComponent(key)}/comment?maxResults=1000`, adapter, options);
  const comments = commentResult.data?.comments || [];
  const commentsComplete = Number(commentResult.data?.total || comments.length) <= comments.length;
  return {
    ...renderJiraApiIssue(url, adapter, result.data, JSON.stringify({ issue: result.data, comments: commentResult.data }, null, 2), comments),
    commentsComplete,
    completeness: commentsComplete ? "complete" : "partial",
    coverage: { observedCount: comments.length, expectedCount: Number(commentResult.data?.total || comments.length) }
  };
}

function renderJiraApiFilter(url, adapter, filter, issues, raw) {
  const title = cleanText(filter?.name || `Jira Filter ${extractFilterId(url)}`);
  return {
    raw,
    title,
    text: [`# ${title}`, "", `Source: ${url}`, `Adapter: ${adapter.id}-api`, "", "## Issues", "", ...issues.map((issue) => `- [${issue.key}](${issue.href}) ${[issue.summary, issue.status && `status: ${issue.status}`, issue.assignee && `assignee: ${issue.assignee}`, issue.updated && `updated: ${issue.updated}`].filter(Boolean).join(" · ")}`)].join("\n"),
    comments: [],
    sourceUpdatedAt: latestTimestampValue(issues.map((issue) => issue.updated)),
    url,
    fetchMethod: "jira-rest",
    entries: issues,
    completeness: "complete",
    coverage: { observedCount: issues.length }
  };
}

function renderJiraApiIssue(url, adapter, issue, raw, apiComments = []) {
  const fields = issue?.fields || {};
  const rendered = issue?.renderedFields || {};
  const key = issue?.key || safePathname(url).split("/").pop();
  const title = `${key} ${cleanText(fields.summary || "")}`.trim();
  const comments = (apiComments.length ? apiComments : fields.comment?.comments || []).map((comment) => ({
    id: String(comment.id || ""),
    author: cleanText(comment.author?.displayName || comment.author?.name || ""),
    createdAt: cleanText(comment.created || comment.updated || ""),
    body: cleanText(htmlToText(comment.renderedBody || "") || comment.body || ""),
    url: `${url}?focusedCommentId=${comment.id}`
  }));
  const fieldLines = [
    ["Type", fields.issuetype?.name], ["Status", fields.status?.name], ["Priority", fields.priority?.name],
    ["Resolution", fields.resolution?.name], ["Assignee", fields.assignee?.displayName], ["Reporter", fields.reporter?.displayName], ["Updated", fields.updated]
  ].filter(([, value]) => value).map(([name, value]) => `- ${name}: ${cleanText(value)}`);
  const description = cleanText(htmlToText(rendered.description || "") || fields.description || "") || "_No description captured._";
  return {
    raw,
    title,
    text: [`# ${title}`, "", `Source: ${url}`, `Adapter: ${adapter.id}-api`, "", "## Fields", "", ...fieldLines, "", "## Description", "", description, "", "## Comments", "", ...(comments.length ? comments.map((comment) => `### ${comment.author} · ${comment.createdAt}\n\n${comment.body}`) : ["_No comments captured._"])].join("\n"),
    comments,
    sourceUpdatedAt: cleanText(fields.updated || ""),
    url,
    fetchMethod: "jira-rest"
  };
}

async function fetchConfluenceFromApi(url, adapter, options = {}) {
  const parsed = new URL(url);
  let pageId = parsed.searchParams.get("pageId") || "";
  const origin = `https://${adapter.hostname}`;
  if (!pageId) {
    let spaceKey = parsed.searchParams.get("spaceKey") || "";
    let title = parsed.searchParams.get("title") || "";
    const display = parsed.pathname.match(/^\/display\/([^/]+)\/(.+)$/i);
    if (display) {
      spaceKey = decodeURIComponent(display[1]);
      title = decodeURIComponent(display[2].replace(/\+/g, " "));
    }
    if (!spaceKey || !title) return null;
    const query = new URLSearchParams({ type: "page", spaceKey, title, limit: "1" });
    const lookup = await requestSourceJson(`${origin}/rest/api/content?${query}`, adapter, options);
    pageId = lookup.data?.results?.[0]?.id || "";
  }
  if (!pageId) return null;
  const result = await requestSourceJson(`${origin}/rest/api/content/${encodeURIComponent(pageId)}?expand=body.storage,version,space,metadata.labels`, adapter, options);
  let commentResult;
  let commentsFetchFailed = false;
  try {
    commentResult = await collectConfluenceComments(origin, pageId, (commentUrl) => requestSourceJson(commentUrl, adapter, options));
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError") throw error;
    commentsFetchFailed = true;
    commentResult = { results: [], truncated: false, pageCount: 0, repliesIncluded: false };
  }
  const page = result.data || {};
  const bodyHtml = page.body?.storage?.value || "";
  const comments = commentResult.results.map((comment) => normalizeConfluenceComment(comment, url, confluenceHtmlToMarkdown));
  const title = cleanText(page.title || url);
  const labels = (page.metadata?.labels?.results || []).map((label) => label.name).filter(Boolean);
  return {
    raw: result.raw,
    title,
    text: [`# ${title}`, "", `Source: ${url}`, `Adapter: ${adapter.id}-api`, `Page ID: ${pageId}`, page.space?.name ? `Space: ${page.space.name}` : "", page.version?.number ? `Version: ${page.version.number}` : "", labels.length ? `Labels: ${labels.join(", ")}` : "", "", "## Content", "", confluenceHtmlToMarkdown(bodyHtml, url), "", "## Comments", "", ...(comments.length ? comments.map((comment) => `### ${comment.author} · ${comment.createdAt}\n\n${comment.body}`) : ["_No comments captured._"])].filter((line) => line !== "").join("\n"),
    comments,
    sourceUpdatedAt: cleanText(page.version?.when || (page.version?.number ? `version:${page.version.number}` : "")),
    url,
    fetchMethod: "confluence-rest",
    httpValidators: responseValidators(result.response),
    commentsComplete: !commentsFetchFailed && !commentResult.truncated,
    completeness: commentsFetchFailed || commentResult.truncated ? "partial" : "complete",
    coverage: { observedCount: comments.length, commentsFetchFailed, truncated: commentResult.truncated, pageCount: commentResult.pageCount, repliesIncluded: commentResult.repliesIncluded }
  };
}

async function fetchGithubFromApi(url, adapter, options = {}) {
  const profile = settings.sources?.[adapter.hostname] || {};
  if (!profile.token && profile.authMode !== "basic") return null;
  const origin = `https://${adapter.hostname}`;
  if (isGithubIssueSearchUrl(url)) {
    // One request per OR alternative; merge by issue URL, newest update first.
    const byUrl = new Map();
    let incomplete = false;
    const raws = [];
    for (const apiUrl of buildGithubIssueSearchApiUrls(url, origin, options.maxItems || 100)) {
      const part = await requestSourceJson(apiUrl, adapter, options);
      raws.push(part.data || {});
      const partItems = part.data?.items || [];
      if (part.data?.incomplete_results || Number(part.data?.total_count ?? partItems.length) > partItems.length) incomplete = true;
      for (const issue of partItems) byUrl.set(String(issue.html_url || ""), issue);
    }
    const merged = [...byUrl.values()].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    const result = { data: { items: merged, total_count: merged.length, incomplete_results: incomplete } };
    const entries = githubIssueRowsToEntries((result.data?.items || []).map((issue) => ({
      href: cleanText(issue.html_url || ""),
      repository: cleanText(String(issue.repository_url || "").split("/repos/")[1] || ""),
      number: String(issue.number || ""),
      title: cleanText(issue.title || ""),
      times: [cleanText(issue.updated_at || "")].filter(Boolean),
      updatedAt: cleanText(issue.updated_at || ""),
      commentCount: Number(issue.comments ?? 0),
      labels: (issue.labels || []).map((label) => cleanText(label.name || "")).filter(Boolean)
    })));
    const total = Number(result.data?.total_count ?? entries.length);
    const title = githubIssueSearchTitle(url);
    return {
      raw: JSON.stringify(raws, null, 2), title, text: renderGithubIssueSearchText(title, url, `${adapter.id}-api`, entries), comments: [],
      url, fetchMethod: "github-rest", entries,
      completeness: total > entries.length || result.data?.incomplete_results ? "partial" : "complete",
      coverage: { observedCount: entries.length, expectedCount: total },
      membershipComplete: total <= entries.length && !result.data?.incomplete_results
    };
  }
  if (safePathname(url) === "/notifications") {
    const parsed = new URL(url);
    const apiUrl = new URL(`${origin}/api/v3/notifications`);
    apiUrl.searchParams.set("all", "true");
    apiUrl.searchParams.set("per_page", String(Math.max(1, Math.min(100, Number(options.maxItems || 50)))));
    const result = await requestSourceCollection(apiUrl, adapter, {
      ...options,
      headers: {
        ...(options.validators?.etag ? { "If-None-Match": options.validators.etag } : {}),
        ...(options.validators?.lastModified ? { "If-Modified-Since": options.validators.lastModified } : {})
      }
    });
    if (result.notModified) {
      return { notModified: true, url, fetchMethod: "github-rest-304", httpValidators: options.validators || {} };
    }
    const reasonFilter = (parsed.searchParams.get("query") || "").match(/reason:([\w-]+)/i)?.[1]?.toLowerCase() || "";
    const notifications = (result.data || []).filter((item) => !reasonFilter || String(item.reason || "").toLowerCase() === reasonFilter).map((item) => ({
      id: String(item.id || ""), title: cleanText(item.subject?.title || ""), href: cleanText(item.subject?.url || "").replace(`${origin}/api/v3/repos/`, `${origin}/`).replace(/\/(issues|pulls)\/(\d+)$/, "/$1/$2").replace("/pulls/", "/pull/"),
      repository: cleanText(item.repository?.full_name || ""), updatedAt: cleanText(item.updated_at || ""), status: item.unread ? "unread" : "read"
    }));
    const title = "GitHub Notifications";
    return { raw: result.raw, title, text: [`# ${title}`, "", `Source: ${url}`, `Adapter: ${adapter.id}-api`, "", "## Notifications", "", ...notifications.map((item) => `- [${item.title}](${item.href}) ${[item.repository, item.status, item.updatedAt && `updated: ${item.updatedAt}`].filter(Boolean).join(" · ")}`)].join("\n"), comments: [], sourceUpdatedAt: latestTimestampValue(notifications.map((item) => item.updatedAt)), url, fetchMethod: "github-rest", httpValidators: responseValidators(result.response), entries: notifications, completeness: result.truncated ? "partial" : "complete", coverage: { observedCount: notifications.length, pageCount: result.pageCount, nextCursor: result.nextUrl || "" } };
  }
  const match = safePathname(url).match(/^\/([^/]+)\/([^/]+)\/(issues|pull|discussions)\/(\d+)/i);
  if (!match || match[3].toLowerCase() === "discussions") return null;
  const [, owner, repo, kind, number] = match;
  const resource = kind.toLowerCase() === "pull" ? "pulls" : "issues";
  const apiBase = `${origin}/api/v3/repos/${owner}/${repo}`;
  const issueResult = await requestSourceJson(`${apiBase}/${resource}/${number}`, adapter, options);
  const isPullRequest = resource === "pulls";
  const requestCollection = (collectionUrl) => requestSourceCollection(collectionUrl, adapter, options);
  let discussion;
  if (isPullRequest) {
    discussion = await collectPullRequestDiscussion(apiBase, number, requestCollection);
  } else {
    const commentsResult = await requestCollection(`${apiBase}/issues/${number}/comments?per_page=100`);
    discussion = {
      comments: (commentsResult.data || []).map((comment) => ({ id: String(comment.id || ""), author: cleanText(comment.user?.login || ""), createdAt: cleanText(comment.created_at || ""), body: cleanText(comment.body || ""), url: cleanText(comment.html_url || "") })),
      raw: { comments: commentsResult.data },
      truncated: commentsResult.truncated,
      missing: []
    };
  }
  const issue = issueResult.data || {};
  const comments = discussion.comments;
  const title = `${owner}/${repo}#${number} ${cleanText(issue.title || "")}`;
  const partial = discussion.truncated || discussion.missing.length > 0;
  return { raw: JSON.stringify({ issue, ...discussion.raw }, null, 2), title, text: [`# ${title}`, "", `Source: ${url}`, `Adapter: ${adapter.id}-api`, "", "## Fields", "", `- State: ${issue.state || "unknown"}`, `- Author: ${issue.user?.login || ""}`, `- Updated: ${issue.updated_at || ""}`, `- Labels: ${(issue.labels || []).map((label) => label.name).join(", ")}`, "", "## Description", "", cleanText(issue.body || "") || "_No description captured._", "", "## Comments", "", ...(comments.length ? comments.map(renderGithubDiscussionEntry) : ["_No comments captured._"])].join("\n"), comments, sourceUpdatedAt: latestTimestampValue([issue.updated_at, ...comments.map((comment) => comment.createdAt)]), url: issue.html_url || url, fetchMethod: "github-rest", httpValidators: responseValidators(issueResult.response), commentsComplete: !partial, completeness: partial ? "partial" : "complete", coverage: { observedCount: comments.length, truncated: discussion.truncated, missing: discussion.missing } };
}

async function fetchTeamsFromGraph(url, adapter, options = {}) {
  const profile = settings.sources?.[adapter.hostname] || {};
  if (profile.authMode !== "bearer" || !profile.token) return null;
  const deepPath = extractTeamsDeepPath(url);
  const chatId = decodeURIComponent(deepPath.match(/^\/l\/chat\/([^/]+)/i)?.[1] || "");
  if (!chatId) return null;
  const graphAdapter = { ...adapter, hostname: "teams.microsoft.com" };
  const chatResult = await requestSourceJson(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}`, graphAdapter, { ...options, headers: { Authorization: `Bearer ${profile.token}` } });
  const result = await requestSourceCollection(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages?$top=50`, graphAdapter, { ...options, headers: { Authorization: `Bearer ${profile.token}` } });
  const comments = (result.data || []).map((message) => ({ id: String(message.id || ""), author: cleanText(message.from?.user?.displayName || message.from?.application?.displayName || ""), createdAt: cleanText(message.createdDateTime || message.lastModifiedDateTime || ""), body: cleanText(htmlToText(message.body?.content || "")), url: cleanText(message.webUrl || url) })).filter((message) => message.body);
  const title = cleanText(chatResult.data?.topic || `Teams ${chatId.slice(0, 18)}`);
  return { raw: result.raw, title, text: renderTeamsTextFromComments(title, url, adapter, comments), comments, sourceUpdatedAt: latestTimestampValue(comments.map((comment) => comment.createdAt)), url: canonicalizeMaterialUrl(url), fetchMethod: "microsoft-graph", conversationId: chatId, completeness: result.truncated ? "partial" : "complete", coverage: { observedCount: comments.length, pageCount: result.pageCount, truncated: result.truncated }, identityEvidence: { method: "graph-chat-id", conversationId: chatId, verified: true } };
}

function hasTeamsGraphCredentials(adapter) {
  const profile = settings.sources?.[adapter.hostname] || {};
  return adapter.sourceType === "teams" && profile.authMode === "bearer" && Boolean(profile.token);
}

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
  const existingSession = options.session || webdriverSessions.get(adapter.hostname);
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
    deadlineMs: TEAMS_GAP_SCROLL_DEADLINE_MS,
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

  const previous = settings.sources?.[adapter.hostname] || defaultSourceProfile(adapter.hostname, adapter.sourceType);
  settings = {
    ...settings,
    sources: {
      ...(settings.sources || {}),
      [adapter.hostname]: {
        ...previous,
        hostname: adapter.hostname,
        sourceType: adapter.sourceType,
        authMode: "cookie",
        cookie: cookieHeader
      }
    }
  };
  await persistSettings();

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
  const profile = settings.sources?.[key] || {};
  const headless = headed ? false : Boolean(profile.webdriverHeadless);
  const autoClose = Boolean(normalizedOptions.autoClose && !manual);
  const windowMode = normalizeWebdriverWindowMode(normalizedOptions.windowMode || profile.webdriverWindowMode);
  const existing = webdriverSessions.get(key);
  if (existing) {
    const needsRelaunch = (headed && existing.headless) || (manual && !existing.manual);
    const inUse = Number(existing.activeOperations || 0) > 0;
    // A different window placement alone is not worth interrupting work in progress.
    if (!needsRelaunch && (existing.windowMode === windowMode || inUse)) return existing;
    if (inUse) await waitForWebdriverIdle(existing);
    await existing.context.close().catch(() => {});
  }

  await fs.mkdir(webdriverRoot, { recursive: true });
  await fs.chmod(webdriverRoot, 0o700).catch(() => {});
  const userDataDir = path.join(webdriverRoot, slugify(key));
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
  webdriverSessions.set(key, session);
  context.on("close", () => {
    if (webdriverSessions.get(key) === session) webdriverSessions.delete(key);
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
  for (const [hostname, session] of webdriverSessions.entries()) {
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


function renderProcessedDocument(metadata, body) {
  const url = metadata.url || "local input";
  return `# ${metadata.title}

## Metadata

- ID: ${metadata.id}
- Source: ${metadata.sourceType}
- URL: ${url}
- Processed: ${metadata.processedAt || new Date().toISOString()}
- Model: ${metadata.processedModel || settings.ai?.model || "unknown"}

## AI Organized Content

${body.trim() || "_No organized content generated yet._"}
`;
}


async function uniqueItemId(base) {
  let id = base;
  let counter = 2;

  while (pendingItemIds.has(id) || await exists(path.join(itemsDir, id))) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  pendingItemIds.add(id);
  return id;
}

async function reserveUniqueItemId(base) {
  const previous = itemIdReservationQueue;
  let release;
  itemIdReservationQueue = new Promise((resolve) => { release = resolve; });
  await previous.catch(() => {});
  try {
    return await uniqueItemId(base);
  } finally {
    release();
  }
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!(await exists(filePath))) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    ...securityHeaders()
  });
  res.end(await fs.readFile(filePath));
}

async function ensureKnowledgeBase() {
  await fs.mkdir(itemsDir, { recursive: true });
  await fs.mkdir(tagsDir, { recursive: true });
  await fs.mkdir(indexesDir, { recursive: true });

  const agentsPath = path.join(kbDir, "AGENTS.md");
  if (!(await exists(agentsPath))) {
    await fs.writeFile(agentsPath, defaultAgentsGuide(), "utf8");
  }
  const schemaPath = path.join(kbDir, "schema.json");
  let currentVersion = 0;
  try { currentVersion = Number(JSON.parse(await fs.readFile(schemaPath, "utf8")).version || 0); } catch {}
  if (currentVersion < 1) {
    await fs.writeFile(schemaPath, `${JSON.stringify({ version: 1, migratedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  }
}

async function itemLatestDiff(id) {
  const item = await readItem(id);
  const snapshotsRoot = path.join(itemsDir, id, "snapshots");
  const names = (await safeReaddir(snapshotsRoot)).sort().reverse();
  for (const snapshotId of names) {
    const documentPath = path.join(snapshotsRoot, snapshotId, "document.md");
    if (!(await exists(documentPath))) continue;
    const before = await fs.readFile(documentPath, "utf8");
    return { snapshotId, ...lineDiff(before, item.document) };
  }
  return { snapshotId: "", changed: false, addedLines: 0, removedLines: 0, text: "还没有历史快照可供比较。", truncated: false };
}


function resolveDocumentRoot(documentRoot) {
  const configured = cleanText(documentRoot);
  return configured ? path.resolve(configured) : defaultDocumentRoot();
}

function defaultDocumentRoot() {
  return resolveWritableDir(process.env.ASSISTANT_DOCUMENT_ROOT, path.join(rootDir, "knowledge-base"));
}

function configureKnowledgeBase() {
  kbDir = resolveDocumentRoot(settings.documentRoot);
  itemsDir = path.join(kbDir, "items");
  tagsDir = path.join(kbDir, "tags");
  indexesDir = path.join(kbDir, "indexes");
}

function defaultAgentsGuide() {
  return `# Knowledge Base Guide

This directory is the primary storage for the material organizer. Agents should read it directly when answering questions.

## Layout

- items/<item-id>/metadata.json: title, source type, URL, tags, timestamps, and fetch metadata.
- items/<item-id>/document.md: readable extracted content with metadata at the top.
- items/<item-id>/comments.jsonl: one JSON object per extracted comment. This may be empty for early captures.
- items/<item-id>/raw.html or raw.txt: original captured material.
- items/<item-id>/snapshots/: older versions created before refresh.
- indexes/by-tag.json: tag to item ids.
- indexes/by-source.json: source type to item ids.
- indexes/by-updated.json: item ids sorted by recent update.
- tags/<tag>.json: reverse index for a single tag.
- SUPPLEMENTAL.md: user-maintained glossary, abbreviations, project background, and interpretation notes. Read this before interpreting internal terms.

## Answering Questions

1. Start with indexes when the user asks by tag, source, or recency.
2. Read SUPPLEMENTAL.md for glossary/context when interpreting abbreviations, project names, and internal terminology.
3. Read metadata.json to confirm the item source, URL, and fetch time.
4. Read document.md for summaries and extracted content.
5. Read comments.jsonl when the user asks about comments, discussion, decisions, or original remarks.
6. Cite item ids and URLs when answering so the user can trace information back to the source.
7. If the information may have changed, mention the lastFetchedAt timestamp.
`;
}

async function loadCaptureToken() {
  const tokenPath = path.join(configDir, "capture-token");
  await fs.mkdir(configDir, { recursive: true });
  try { return (await fs.readFile(tokenPath, "utf8")).trim(); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const token = randomBytes(32).toString("hex");
  await fs.writeFile(tokenPath, token, { mode: 0o600 });
  return token;
}


