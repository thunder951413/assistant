import { readAppSource, versionedIndexHtml } from "./app-bundle.js";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { validateApiRequest } from "./api-security.js";
import { applyClientJobEdits, createSettingsWriter } from "./settings-store.js";
import { assertModelMaterials, normalizeChatHistory } from "./ai-policy.js";
import { createChatSessionStore } from "./chat-session-store.js";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanText } from "./utils.js";
import { createRouter } from "./router.js";
import { createAiClient } from "./ai-client.js";
import { paginate } from "./capture-utils.js";
import { createItemStore } from "./item-store.js";
import { computeSourceHealth, createRunHistory } from "./reliability.js";
import { exists, resolveWritableDir } from "./fs-helpers.js";
import { readBody, securityHeaders, sendJson, sendJsonDownload, sendTextDownload, withResponseCancellation } from "./http-utils.js";
import { collectStream, latestMessagePreviews, normalizeFavoriteTags } from "./topics.js";
import { createKnowledgeSearch } from "./knowledge-search.js";
import { createTagsService } from "./tags-service.js";
import { createAiActions } from "./ai-actions.js";
import { createTopicsService } from "./topics-service.js";
import { createSupplemental } from "./supplemental.js";
import { createSettingsService } from "./settings-service.js";
import { createSourceUrls } from "./source-urls.js";
import { createDataMaintenance } from "./data-maintenance.js";
import { createItemService } from "./item-service.js";
import { itemExportMarkdown, topicDigestExportMarkdown } from "./markdown-export.js";
import { createRefreshJobs } from "./refresh-jobs.js";
import { createRefreshRunner } from "./refresh-runner.js";
import { createRefreshCapture } from "./refresh-capture.js";
import { createSourceApi } from "./sources/api-fetch.js";
import { createWebdriverSessions } from "./webdriver/sessions.js";
import { createWebdriverAuth } from "./webdriver/auth.js";
import { createWebdriverFetch } from "./webdriver/fetch.js";

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
  get FETCH_TIMEOUT_MS() { return FETCH_TIMEOUT_MS; },
  get LIST_REFRESH_JOB_TIMEOUT_MS() { return LIST_REFRESH_JOB_TIMEOUT_MS; },
  get MAX_FETCH_BYTES() { return MAX_FETCH_BYTES; },
  get REFRESH_JOB_TIMEOUT_MS() { return REFRESH_JOB_TIMEOUT_MS; },
  get REFRESH_RUN_RETENTION_MS() { return REFRESH_RUN_RETENTION_MS; },
  get TEAMS_GAP_SCROLL_DEADLINE_MS() { return TEAMS_GAP_SCROLL_DEADLINE_MS; },
  get TEAMS_LOGIN_TIMEOUT_MS() { return TEAMS_LOGIN_TIMEOUT_MS; },
  get TEAMS_REFRESH_JOB_TIMEOUT_MS() { return TEAMS_REFRESH_JOB_TIMEOUT_MS; },
  get assertRefreshActive() { return assertRefreshActive; },
  get buildAuthHeaders() { return buildAuthHeaders; },
  get canonicalizeMaterialUrl() { return canonicalizeMaterialUrl; },
  get closeWebdriverSession() { return closeWebdriverSession; },
  get defaultRefreshJobNameForListUrl() { return defaultRefreshJobNameForListUrl; },
  get deleteItem() { return deleteItem; },
  get detectSourceAdapter() { return detectSourceAdapter; },
  get ensureRefreshJobForContentUrl() { return ensureRefreshJobForContentUrl; },
  get ensureRefreshJobForListUrl() { return ensureRefreshJobForListUrl; },
  get ensureSessionPage() { return ensureSessionPage; },
  get ensureWebdriverPageAuthenticated() { return ensureWebdriverPageAuthenticated; },
  get ensureWebdriverSession() { return ensureWebdriverSession; },
  get extractByAdapter() { return extractByAdapter; },
  get fetchUrl() { return fetchUrl; },
  get fetchUrlFromSourceApi() { return fetchUrlFromSourceApi; },
  get fetchUrlWithWebdriver() { return fetchUrlWithWebdriver; },
  get findItemByUrl() { return findItemByUrl; },
  get hasGithubToken() { return hasGithubToken; },
  get hasJiraApiCredentials() { return hasJiraApiCredentials; },
  get hasTeamsGraphCredentials() { return hasTeamsGraphCredentials; },
  get inferPageKind() { return inferPageKind; },
  get isAuthenticationRequiredError() { return isAuthenticationRequiredError; },
  get isInvalidTeamsRootCapture() { return isInvalidTeamsRootCapture; },
  get isKnownListUrl() { return isKnownListUrl; },
  get itemIdReservationQueue() { return itemIdReservationQueue; },
  set itemIdReservationQueue(value) { itemIdReservationQueue = value; },
  get itemUrlMutationLocks() { return itemUrlMutationLocks; },
  get navigateWebdriverPage() { return navigateWebdriverPage; },
  get normalizeContentFetchUrl() { return normalizeContentFetchUrl; },
  get normalizeUrlForMatch() { return normalizeUrlForMatch; },
  get patchItemMetadata() { return patchItemMetadata; },
  get pendingItemIds() { return pendingItemIds; },
  get prepareTeamsRefreshGroup() { return prepareTeamsRefreshGroup; },
  get previewRefreshJob() { return previewRefreshJob; },
  get processItemWithAi() { return processItemWithAi; },
  get refreshContentJob() { return refreshContentJob; },
  get refreshHistory() { return refreshHistory; },
  get refreshJobTimeoutMs() { return refreshJobTimeoutMs; },
  get refreshListJob() { return refreshListJob; },
  get resolvePageKind() { return resolvePageKind; },
  get resolvedRefreshFetchMode() { return resolvedRefreshFetchMode; },
  get sendSystemNotification() { return sendSystemNotification; },
  get shouldFetchForPreview() { return shouldFetchForPreview; },
  get shouldFetchWithWebdriver() { return shouldFetchWithWebdriver; },
  get shouldPrecheckAuthentication() { return shouldPrecheckAuthentication; },
  get shouldSkipContentRefresh() { return shouldSkipContentRefresh; },
  get startRefreshRunByIds() { return startRefreshRunByIds; },
  get updateRefreshJobState() { return updateRefreshJobState; },
  get updateRefreshRun() { return updateRefreshRun; },
  get upsertFetchedItem() { return upsertFetchedItem; },
  get validateTeamsConversationIdentity() { return validateTeamsConversationIdentity; },
  get verifyWebdriverAuthentication() { return verifyWebdriverAuthentication; },
};
const { searchItems, buildAskContext, answerFromKnowledgeBase, streamAnswerFromKnowledgeBase, searchKnowledgeBase, readAllMaterialsForSearch, isEmbeddingEnabled, embeddingIndexState } = createKnowledgeSearch(ctx);
const { listTags, addManualTags, renameTag, deleteTags, modelVisibleTags } = createTagsService(ctx);
const { summarizeContent, updateTitleWithAi, recommendTagsForItem, recommendTagsForItems, classifyItems, classifyItem, processItemWithAi } = createAiActions(ctx);
const { loadTopicMaterials, readTopicDigest, topicOverview, generateTopicDigest } = createTopicsService(ctx);
const { supplementalContextPath, supplementalEntriesPath, saveSupplementalContext, readSupplementalEntries, saveSupplementalEntries, renderSupplementalMarkdown, supplementalPromptBlock, suggestSupplementalContext } = createSupplemental(ctx);
const { loadSettings, exportFilename, importSettingsBundle, saveSettings, publicSettings, resolveProcessingPrompt, publicRefreshJobs, isRemoteAiAllowed, publicSourceProfiles, redactSettings } = createSettingsService(ctx);
const { resolvePageKind, detectSourceAdapter, extractByAdapter, inferPageKind, isKnownListUrl, normalizeContentFetchUrl, buildAuthHeaders, normalizeUrlForMatch, isInvalidTeamsRootRefreshJob, isInvalidTeamsRootCapture, canonicalizeMaterialUrl, shouldFetchForPreview } = createSourceUrls(ctx);
const { exportDataBundle, storageStats, cleanupOldSnapshots, cleanupWebdriverCaches, importDataBundle, serviceHealth } = createDataMaintenance(ctx);
const { createItem, previewSource, refreshItem, upsertFetchedItem, upsertCapturedItem, findItemByUrl, withItemUrlMutationLock, updateTags, updateTitle, acknowledgeItemUpdate, readItem, deleteItem, listItems, renderProcessedDocument, itemLatestDiff } = createItemService(ctx);
const { shouldSkipContentRefresh, previewRefreshJob, ensureRefreshJobForListUrl, ensureRefreshJobForContentUrl, migrateMisclassifiedListUrls, pruneListChildJobs, syncContentRefreshJobsFromItems, defaultRefreshJobNameForListUrl, shouldFetchWithWebdriver, hasJiraApiCredentials, hasGithubToken, resolvedRefreshFetchMode, updateRefreshJobState, deleteRefreshJob, deleteRefreshJobItems, deleteRefreshSourceItems } = createRefreshJobs(ctx);
const { startRefreshScheduler, runRefreshJobById, startRefreshRunByIds, updateRefreshRun, publicRefreshRuns, publicRefreshRun, cancelRefreshRun, runRefreshJobsByIds, reconcileStaleRunningRefreshJobs, confirmTeamsRefreshReady, refreshJobTimeoutMs, assertRefreshActive, sendSystemNotification } = createRefreshRunner(ctx);
const { refreshListJob, patchItemMetadata, resolveLeftListItems, refreshContentJob, validateTeamsConversationIdentity } = createRefreshCapture(ctx);
const { fetchUrl, fetchUrlFromSourceApi, hasTeamsGraphCredentials } = createSourceApi(ctx);
const { openWebdriverSession, saveWebdriverCookies, ensureWebdriverSession, closeWebdriverSession, ensureSessionPage, webdriverStatus } = createWebdriverSessions(ctx);
const { shouldPrecheckAuthentication, verifyWebdriverAuthentication, ensureWebdriverPageAuthenticated, prepareTeamsRefreshGroup } = createWebdriverAuth(ctx);
const { fetchUrlWithWebdriver, isAuthenticationRequiredError, navigateWebdriverPage } = createWebdriverFetch(ctx);

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

api.get("/api/items/:id/export.md", async ({ params, res }) => {
  const { filename, content } = itemExportMarkdown(await readItem(params.id));
  sendTextDownload(res, filename, content);
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

api.get("/api/topics/:tag/digest/export.md", async ({ params, url, res }) => {
  const mode = url.searchParams.get("mode") === "recent" ? "recent" : "overview";
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const { filename, content } = topicDigestExportMarkdown(params.tag, await readTopicDigest(params.tag), { mode, days });
  sendTextDownload(res, filename, content);
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


async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  // The app script is assembled from public/app/*.js; index.html carries content hashes.
  if (pathname === "/app.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", ...securityHeaders() });
    res.end(await readAppSource(publicDir));
    return;
  }
  if (pathname === "/index.html") {
    const html = await versionedIndexHtml(publicDir, await fs.readFile(path.join(publicDir, "index.html"), "utf8"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...securityHeaders() });
    res.end(html);
    return;
  }
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


