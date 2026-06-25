import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { chromium } from "playwright";
import {
  cleanText,
  normalizeTags,
  safeHostname,
  safePathname,
  safeSearch,
  slugify,
  uniqueValues
} from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const configDir = path.join(rootDir, ".config");
const settingsPath = path.join(configDir, "settings.json");
const webdriverRoot = path.join(configDir, "webdriver");
let settings = await loadSettings();
let kbDir = resolveDocumentRoot(settings.documentRoot);
let itemsDir = path.join(kbDir, "items");
let tagsDir = path.join(kbDir, "tags");
let indexesDir = path.join(kbDir, "indexes");
const webdriverSessions = new Map();
const refreshRuntime = {
  timer: null,
  running: new Set()
};

const port = Number(process.env.PORT || 8020);

await ensureKnowledgeBase();
await syncContentRefreshJobsFromItems();
startRefreshScheduler();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Material Organizer running at http://localhost:${port}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/items") {
    const items = await listItems({
      tag: url.searchParams.get("tag"),
      sourceType: url.searchParams.get("sourceType"),
      query: url.searchParams.get("q"),
      updates: url.searchParams.get("updates"),
      includeLists: url.searchParams.get("includeLists")
    });
    sendJson(res, 200, { items });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/items") {
    const body = await readBody(req);
    const item = await createItem(body);
    sendJson(res, 201, { item });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/preview-source") {
    const body = await readBody(req);
    const preview = await previewSource(body);
    sendJson(res, 200, { preview });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/webdriver/status") {
    sendJson(res, 200, { sessions: await webdriverStatus() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/webdriver/open") {
    const body = await readBody(req);
    const session = await openWebdriverSession(body.url || "", body.hostname || "");
    sendJson(res, 200, { session });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/webdriver/fetch") {
    const body = await readBody(req);
    const fetched = await fetchUrlWithWebdriver(body.url, { pageKind: body.pageKind || "auto" });
    sendJson(res, 200, { fetched });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/webdriver/save-cookies") {
    const body = await readBody(req);
    const saved = await saveWebdriverCookies(body.url || "", body.hostname || "");
    sendJson(res, 200, { saved, settings: publicSettings() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/summarize") {
    const body = await readBody(req);
    const summary = await summarizeContent(body);
    sendJson(res, 200, { summary });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/items/")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const item = await readItem(id);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/items/")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    await deleteItem(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/items/") && url.pathname.endsWith("/tags")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const body = await readBody(req);
    const item = await updateTags(id, body.tags || []);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "PATCH" && url.pathname.endsWith("/title")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const body = await readBody(req);
    const item = await updateTitle(id, body.title || "");
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/recommend-title")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const item = await updateTitleWithAi(id);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/recommend-tags")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const recommendations = await recommendTagsForItem(id);
    sendJson(res, 200, recommendations);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/batch-recommend-tags") {
    const body = await readBody(req);
    const recommendations = await recommendTagsForItems(body.ids || []);
    sendJson(res, 200, recommendations);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classify-items") {
    const body = await readBody(req);
    const classification = await classifyItems(body.ids || [], body.categories || []);
    sendJson(res, 200, classification);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classify-item") {
    const body = await readBody(req);
    const classification = await classifyItem(body.id || "", body.categories || []);
    sendJson(res, 200, classification);
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/process")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const item = await processItemWithAi(id);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/ack-update")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const item = await acknowledgeItemUpdate(id);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/refresh")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const item = await refreshItem(id);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tags") {
    sendJson(res, 200, { tags: await listTags() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tags") {
    const body = await readBody(req);
    const tags = await addManualTags(body.tags || body.tag || []);
    sendJson(res, 200, { tags });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/tags") {
    const body = await readBody(req);
    const result = await renameTag(body.from || body.oldTag || "", body.to || body.newTag || "");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/tags") {
    const body = await readBody(req);
    const result = await deleteTags(body.tags || []);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/search") {
    const body = await readBody(req);
    const results = await searchItems(body.query || "");
    sendJson(res, 200, { results });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge-search") {
    const body = await readBody(req);
    const results = await searchKnowledgeBase(body.query || "", body.limit || 8);
    sendJson(res, 200, { rootDir: kbDir, results });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ask-context") {
    const body = await readBody(req);
    const context = await buildAskContext(body.question || "");
    sendJson(res, 200, context);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent-config") {
    sendJson(res, 200, {
      rootDir: kbDir,
      guidePath: path.join(kbDir, "AGENTS.md")
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/supplemental-context") {
    const entries = await readSupplementalEntries();
    sendJson(res, 200, {
      entries,
      content: renderSupplementalMarkdown(entries),
      path: supplementalContextPath(),
      entriesPath: supplementalEntriesPath()
    });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/supplemental-context") {
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
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/supplemental-context/suggest") {
    const body = await readBody(req);
    const entries = await suggestSupplementalContext(body.existingEntries || []);
    sendJson(res, 200, {
      entries,
      suggestion: renderSupplementalMarkdown(entries)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    await syncContentRefreshJobsFromItems();
    sendJson(res, 200, { settings: publicSettings() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export/settings") {
    sendJsonDownload(res, exportFilename("assistant-settings"), {
      type: "material-organizer-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/settings") {
    const body = await readBody(req);
    settings = await importSettingsBundle(body);
    configureKnowledgeBase();
    await ensureKnowledgeBase();
    await syncContentRefreshJobsFromItems();
    startRefreshScheduler();
    sendJson(res, 200, { settings: publicSettings() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export/data") {
    sendJsonDownload(res, exportFilename("assistant-data"), await exportDataBundle());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/data") {
    const body = await readBody(req);
    const result = await importDataBundle(body.bundle || body, { mode: body.mode || "merge" });
    await syncContentRefreshJobsFromItems();
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/source-profiles") {
    sendJson(res, 200, { profiles: publicSourceProfiles() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/refresh-jobs") {
    await syncContentRefreshJobsFromItems();
    sendJson(res, 200, { jobs: publicRefreshJobs() });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/refresh-jobs/") && url.pathname.endsWith("/run")) {
    await syncContentRefreshJobsFromItems();
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const result = await runRefreshJobById(id, { force: true });
    sendJson(res, 200, { result, jobs: publicRefreshJobs() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/refresh-jobs/run-batch") {
    await syncContentRefreshJobsFromItems();
    const body = await readBody(req);
    const result = await runRefreshJobsByIds(body.ids || [], {
      force: true,
      sourceType: cleanText(body.sourceType || "all")
    });
    sendJson(res, 200, { result, jobs: publicRefreshJobs() });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/refresh-jobs/") && url.pathname.endsWith("/items")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const result = await deleteRefreshJobItems(id);
    sendJson(res, 200, { result, jobs: publicRefreshJobs() });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/refresh-jobs/")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const jobs = await deleteRefreshJob(id);
    startRefreshScheduler();
    sendJson(res, 200, { jobs });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    settings = await saveSettings(body);
    configureKnowledgeBase();
    await ensureKnowledgeBase();
    await syncContentRefreshJobsFromItems();
    startRefreshScheduler();
    sendJson(res, 200, { settings: publicSettings() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readBody(req);
    const answer = await answerFromKnowledgeBase(body.message || "");
    sendJson(res, 200, answer);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat-stream") {
    const body = await readBody(req);
    await streamAnswerFromKnowledgeBase(body.message || "", res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function createItem(input) {
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
    const fetched = sourceType === "teams" ? await fetchUrlWithWebdriver(itemUrl) : await fetchUrl(itemUrl);
    rawContent = fetched.raw;
    extractedContent = fetched.text;
    rawFileName = "raw.html";
    title = title || fetched.title || itemUrl;
    lastFetchedAt = now;
    sourceUpdatedAt = sourceUpdatedAt || fetched.sourceUpdatedAt || "";
    comments = normalizeComments(fetched.comments);
  }

  title = title || "Untitled material";
  const id = await uniqueItemId(slugify(`${sourceType}-${title}`));
  const itemDir = path.join(itemsDir, id);
  await fs.mkdir(itemDir, { recursive: true });

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
    pendingContentUpdatedAt: cleanText(input.pendingContentUpdatedAt || "")
  };

  await fs.writeFile(path.join(itemDir, rawFileName), rawContent, "utf8");
  await fs.writeFile(path.join(itemDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(itemDir, "comments.jsonl"), renderJsonLines(comments), "utf8");
  await fs.writeFile(path.join(itemDir, "document.md"), renderDocument(metadata, extractedContent, summary), "utf8");
  if (metadata.pageKind === "list" && metadata.url) {
    metadata.refreshJob = await ensureRefreshJobForListUrl(metadata.url, {
      title,
      sourceType,
      fetchMode: metadata.fetchMode || "auto"
    });
    const linkedImport = await importLinkedItemsFromList({
      url: metadata.url,
      raw: rawContent,
      tags,
      fetchMode: metadata.fetchMode,
      maxItems: input.maxItems || 50,
      parentUrl: metadata.url
    });
    if (linkedImport.linkCount) {
      metadata.listImport = linkedImport;
      await fs.writeFile(path.join(itemDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      await fs.writeFile(path.join(itemDir, "document.md"), renderDocument(metadata, extractedContent, summary), "utf8");
    }
  } else if (metadata.url) {
    metadata.refreshJob = await ensureRefreshJobForContentUrl(metadata.url, {
      title,
      sourceType,
      fetchMode: metadata.fetchMode || "auto",
      managedBy: metadata.managedBy || "content-page"
    });
    await fs.writeFile(path.join(itemDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(itemDir, "document.md"), renderDocument(metadata, extractedContent, summary), "utf8");
  }
  await rebuildIndexes();

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
    refreshJob = await ensureRefreshJobForListUrl(canonicalDetectedUrl, {
      title,
      sourceType: adapter.sourceType,
      fetchMode: input.fetchMode || "auto"
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
        ? await fetchUrlWithWebdriver(canonicalDetectedUrl, { pageKind: requestedPageKind })
        : await fetchUrl(canonicalDetectedUrl, { pageKind: requestedPageKind });
      title = title || fetched.title || canonicalDetectedUrl;
      rawContent = fetched.raw;
      extractedContent = fetched.text;
      rawFileName = "raw.html";
      lastFetchedAt = now;
      input.sourceUpdatedAt = fetched.sourceUpdatedAt || "";
      input.comments = fetched.comments || [];
      parseNote = "网页内容已抓取并过滤为可读文本。";
      linkedItems = extractPreviewLinkedItems(rawContent, canonicalDetectedUrl, sourceType, requestedPageKind);
    } catch (error) {
      title = title || canonicalDetectedUrl;
      rawContent = pasted || canonicalDetectedUrl;
      extractedContent = pasted || `无法直接抓取该页面。可以粘贴页面正文后再解析。\n\n错误：${error.message}`;
      parseStatus = "needs-review";
      parseNote = "页面可能需要登录或 webdriver。当前保留你粘贴的内容供确认。";
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
  if (canonicalDetectedUrl && resolvedPageKind === "list") {
    refreshJob = await ensureRefreshJobForListUrl(canonicalDetectedUrl, {
      title,
      sourceType,
      fetchMode: input.fetchMode || "auto",
      managedBy: "content-page"
    });
  } else if (canonicalDetectedUrl && resolvedPageKind === "content") {
    refreshJob = await ensureRefreshJobForContentUrl(canonicalDetectedUrl, {
      title,
      sourceType,
      fetchMode: input.fetchMode || "auto"
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

function resolvePageKind(url, pageKind = "auto") {
  if (!url) return pageKind || "auto";
  if (isKnownListUrl(url)) return "list";
  if (pageKind && pageKind !== "auto") return pageKind;
  return inferPageKind(url, detectSourceAdapter(url));
}

async function summarizeContent(input) {
  const content = cleanText(input.content || "");
  if (!content) {
    throw new Error("没有可总结的内容。");
  }

  if (settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model) {
    return summarizeWithOpenAICompatible(content);
  }

  return {
    mode: "local",
    text: buildLocalSummary(content),
    note: "未配置 AI 接口，当前使用本地提取式摘要。"
  };
}

async function summarizeWithOpenAICompatible(content) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "你是资料整理助手。请用中文总结资料，突出主题、关键进展、评论/讨论结论、未解决问题和下一步。"
        },
        {
          role: "user",
          content: content.slice(0, 24000)
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 总结失败：${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("AI 接口没有返回可用总结。");
  }

  return {
    mode: "ai",
    text,
    note: `使用模型 ${settings.ai.model} 生成。`
  };
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
  const snapshotDir = path.join(itemDir, "snapshots", now.replace(/[:.]/g, "-"));
  await fs.mkdir(snapshotDir, { recursive: true });

  for (const file of ["document.md", "metadata.json", "comments.jsonl", item.metadata.rawFileName || "raw.html"]) {
    const sourcePath = path.join(itemDir, file);
    if (await exists(sourcePath)) {
      await fs.copyFile(sourcePath, path.join(snapshotDir, file));
    }
  }

  let fetched = await fetchForMetadata(item.metadata, refreshContext);
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
  const { updateSummary: _ignoredUpdateSummary, ...previousMetadata } = item.metadata;
  const metadata = {
    ...previousMetadata,
    title: item.metadata.title || fetched.title,
    updatedAt: now,
    lastFetchedAt: now,
    sourceUpdatedAt: nextSourceUpdatedAt,
    contentUpdatedAt: item.metadata.contentUpdatedAt || "",
    pendingContentUpdatedAt: hasUpdate ? now : item.metadata.pendingContentUpdatedAt || "",
    processedStale: hasUpdate && item.metadata.processedAt ? true : false,
    refreshNote: {
      previousDocumentLength: previousLength,
      currentDocumentLength: fetched.text.length,
      lengthDelta: fetched.text.length - previousLength
    }
  };

  const rawFileName = metadata.rawFileName || "raw.html";
  await fs.writeFile(path.join(itemDir, rawFileName), fetched.raw, "utf8");
  await fs.writeFile(path.join(itemDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(itemDir, "comments.jsonl"), renderJsonLines(fetched.comments || []), "utf8");
  await fs.writeFile(path.join(itemDir, "document.md"), renderDocument(metadata, fetched.text), "utf8");
  return readItem(id);
}

async function fetchForMetadata(metadata, refreshContext = null) {
  if (shouldFetchWithWebdriver(metadata.url, metadata.fetchMode, metadata.pageKind || "auto", metadata.sourceType)) {
    return fetchUrlWithWebdriver(metadata.url, {
      pageKind: metadata.pageKind || "auto",
      session: refreshContext?.webdriverSession,
      page: refreshContext?.webdriverPage
    });
  }
  return fetchUrl(metadata.url, { pageKind: metadata.pageKind || "auto" });
}

async function upsertFetchedItem(input) {
  const itemUrl = canonicalizeMaterialUrl(input.url || "");
  const existing = await findItemByUrl(itemUrl);
  if (!existing) {
    const created = await createItem({
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
      pendingContentUpdatedAt: input.fetchedAt
    });
    created.refreshChanged = true;
    return created;
  }

  const item = await readItem(existing.id);
  input = mergeFetchedTeamsInputWithExisting(item, input);
  validateFetchedItemNotRegressed(item, input);
  const itemDir = path.join(itemsDir, existing.id);
  const snapshotDir = path.join(itemDir, "snapshots", input.fetchedAt.replace(/[:.]/g, "-"));
  await fs.mkdir(snapshotDir, { recursive: true });

  for (const file of ["document.md", "metadata.json", "comments.jsonl", item.metadata.rawFileName || "raw.html"]) {
    const sourcePath = path.join(itemDir, file);
    if (await exists(sourcePath)) {
      await fs.copyFile(sourcePath, path.join(snapshotDir, file));
    }
  }

  const previousBody = extractBodyFromDocument(item.document).trim();
  const currentBody = cleanText(input.text).trim();
  const fetchedSourceUpdatedAt = cleanText(input.sourceUpdatedAt || "");
  const nextSourceUpdatedAt = fetchedSourceUpdatedAt || item.metadata.sourceUpdatedAt || "";
  const sourceChanged = nextSourceUpdatedAt
    && normalizeSourceUpdatedAt(nextSourceUpdatedAt) !== normalizeSourceUpdatedAt(item.metadata.sourceUpdatedAt || "");
  const contentChanged = previousBody !== currentBody;
  const hasUpdate = Boolean((fetchedSourceUpdatedAt && sourceChanged) || contentChanged);
  const { updateSummary: _ignoredUpdateSummary, ...previousMetadata } = item.metadata;
  const metadata = {
    ...previousMetadata,
    title: input.title || item.metadata.title,
    sourceType: input.sourceType || item.metadata.sourceType,
    url: itemUrl,
    tags: item.metadata.tags || [],
    updatedAt: input.fetchedAt,
    lastFetchedAt: input.fetchedAt,
    sourceUpdatedAt: nextSourceUpdatedAt,
    contentUpdatedAt: item.metadata.contentUpdatedAt || "",
    pendingContentUpdatedAt: hasUpdate ? input.fetchedAt : item.metadata.pendingContentUpdatedAt || "",
    processedStale: hasUpdate && item.metadata.processedAt ? true : false,
    rawFileName: item.metadata.rawFileName || "raw.html",
    pageKind: input.pageKind || item.metadata.pageKind || null,
    fetchMode: input.fetchMode || item.metadata.fetchMode || null,
    parentUrl: input.parentUrl || item.metadata.parentUrl || null,
    managedBy: input.managedBy || item.metadata.managedBy || null,
    refreshNote: {
      previousDocumentLength: item.document.length,
      currentDocumentLength: input.text.length,
      lengthDelta: input.text.length - item.document.length
    }
  };

  await fs.writeFile(path.join(itemDir, metadata.rawFileName), input.raw, "utf8");
  await fs.writeFile(path.join(itemDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(itemDir, "comments.jsonl"), renderJsonLines(input.comments || []), "utf8");
  await fs.writeFile(path.join(itemDir, "document.md"), renderDocument(metadata, input.text), "utf8");
  await rebuildIndexes();
  const refreshed = await readItem(existing.id);
  refreshed.refreshChanged = hasUpdate;
  return refreshed;
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
  if (!previousComments.length || !nextComments.length) return input;
  if (previousComments.length >= 10 && nextComments.length < 3) return input;
  if (previousComments.length >= 10 && nextComments.length < previousComments.length) {
    const title = cleanText(item.metadata.title || input.title || "Microsoft Teams conversation");
    const url = canonicalizeMaterialUrl(item.metadata.url || input.url || "");
    const adapter = detectSourceAdapter(url || input.url || "");
    return {
      ...input,
      title,
      url: url || input.url,
      comments: previousComments,
      text: renderTeamsTextFromComments(title, url || input.url || item.metadata.url || "", adapter, previousComments),
      sourceUpdatedAt: item.metadata.sourceUpdatedAt || input.sourceUpdatedAt || ""
    };
  }
  const mergedComments = mergeTeamsComments([...previousComments, ...nextComments]);
  if (mergedComments.length <= nextComments.length) return input;
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

async function findItemByUrl(url) {
  const normalized = normalizeUrlForMatch(url);
  if (!normalized) return null;
  const dirs = await safeReaddir(itemsDir);
  for (const id of dirs) {
    const metadataPath = path.join(itemsDir, id, "metadata.json");
    if (!(await exists(metadataPath))) continue;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    if (normalizeUrlForMatch(metadata.url) === normalized) return metadata;
  }
  return null;
}

function shouldSkipContentRefresh(existingMetadata, listUpdatedAt, adapter = detectSourceAdapter(existingMetadata?.url || "")) {
  if (adapter.sourceType === "github") return false;
  if (!existingMetadata || !listUpdatedAt || !existingMetadata.sourceUpdatedAt) return false;
  if (isSameRelativeSourceDay(existingMetadata.sourceUpdatedAt, existingMetadata.lastFetchedAt, listUpdatedAt)) return true;
  const existingTime = parseSourceUpdatedAt(existingMetadata.sourceUpdatedAt, existingMetadata.lastFetchedAt);
  const listTime = Date.parse(listUpdatedAt);
  if (!Number.isNaN(existingTime) && !Number.isNaN(listTime)) {
    return existingTime >= listTime || Math.abs(existingTime - listTime) <= 60 * 1000;
  }
  return normalizeSourceUpdatedAt(existingMetadata.sourceUpdatedAt, existingMetadata.lastFetchedAt) === normalizeSourceUpdatedAt(listUpdatedAt);
}

function isSameRelativeSourceDay(existingValue, referenceDate, listValue) {
  if (!/^(today|yesterday)$/i.test(cleanText(existingValue))) return false;
  const existingTime = parseSourceUpdatedAt(existingValue, referenceDate);
  const listTime = Date.parse(listValue);
  if (Number.isNaN(existingTime) || Number.isNaN(listTime)) return false;
  return toDateKey(existingTime) === toDateKey(listTime);
}

function toDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function normalizeSourceUpdatedAt(value, referenceDate = "") {
  const clean = cleanText(value);
  if (!clean) return "";
  const parsed = parseSourceUpdatedAt(clean, referenceDate);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return clean.toLowerCase().replace(/\s+/g, " ");
}

function latestTimestampValue(values) {
  let latestValue = "";
  let latestTime = Number.NEGATIVE_INFINITY;
  let lastNonEmpty = "";
  for (const value of values) {
    const clean = cleanText(value || "");
    if (!clean) continue;
    lastNonEmpty = clean;
    const parsed = Date.parse(clean);
    if (Number.isNaN(parsed) || parsed <= latestTime) continue;
    latestValue = clean;
    latestTime = parsed;
  }
  // Prefer the chronologically latest parseable timestamp. When none of the
  // values parse (e.g. Teams captured only localized/relative time strings),
  // fall back to the last non-empty raw value so callers don't lose the
  // field entirely — matching the previous `.at(-1)` behavior in that case.
  return latestValue || lastNonEmpty;
}

function parseSourceUpdatedAt(value, referenceDate = "") {
  const clean = cleanText(value);
  if (!clean) return Number.NaN;
  const parsed = Date.parse(clean);
  if (!Number.isNaN(parsed)) return parsed;

  const reference = Date.parse(referenceDate);
  if (Number.isNaN(reference)) return Number.NaN;
  const referenceDay = new Date(reference);
  referenceDay.setHours(0, 0, 0, 0);
  if (/^yesterday$/i.test(clean)) return referenceDay.getTime() - 24 * 60 * 60 * 1000;
  if (/^today$/i.test(clean)) return referenceDay.getTime();
  return Number.NaN;
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
    maxItems: 50,
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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const documentPath = path.join(itemDir, "document.md");
  if (await exists(documentPath)) {
    const document = await fs.readFile(documentPath, "utf8");
    await fs.writeFile(documentPath, renderDocument(metadata, extractBodyFromDocument(document), extractSummaryFromDocument(document)), "utf8");
  }
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
  } catch {
    // Fall through to a URL-based id.
  }
  return `${slugify(adapter.hostname || adapter.sourceType)}-${slugify(url)}`;
}

function defaultRefreshJobNameForListUrl(url, title) {
  if (title && title !== url) return `${title} refresh`;
  const adapter = detectSourceAdapter(url);
  if (adapter.sourceType === "github" && safePathname(url) === "/notifications") return "GitHub notifications";
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
  if (requiresWebdriverExpansion(adapter)) return true;
  if (requestedMode === "webdriver") return true;
  if (requestedMode === "fetch") return false;
  if (sourceType === "jira" || sourceType === "teams") return true;
  return adapterPrefersWebdriver(adapter);
}

function adapterPrefersWebdriver(adapter) {
  return adapter.sourceType === "jira" || adapter.sourceType === "teams";
}

function requiresWebdriverExpansion(adapter) {
  return adapter.sourceType === "github" && adapter.hostname === "github.ecodesamsung.com";
}

async function importLinkedItemsFromList(input) {
  const adapter = detectSourceAdapter(input.url);
  const links = extractContentLinksFromList(input.raw || "", input.url, adapter)
    .slice(0, Math.max(1, Number(input.maxItems) || 50));
  const imported = [];
  const errors = [];
  const fetchMode = requiresWebdriverExpansion(adapter)
    ? "webdriver"
    : input.fetchMode === "webdriver" ? "webdriver" : input.fetchMode === "fetch" ? "fetch" : resolvedRefreshFetchMode({}, adapter);

  for (const link of links) {
    const contentUrl = normalizeContentFetchUrl(link.href, adapter);
    try {
      const listUpdatedAt = cleanText(link.updatedAt || link.updated || "");
      const fetched = fetchMode === "webdriver"
        ? await fetchUrlWithWebdriver(contentUrl, { pageKind: "content" })
        : await fetchUrl(contentUrl, { pageKind: "content" });
      const item = await upsertFetchedItem({
        title: fetched.title || link.title || link.key || contentUrl,
        sourceType: adapter.sourceType,
        url: fetched.url ? normalizeContentFetchUrl(fetched.url, adapter) : contentUrl,
        tags: normalizeTags(input.tags || []),
        raw: fetched.raw,
        text: fetched.text,
        comments: fetched.comments || [],
        sourceUpdatedAt: listUpdatedAt || fetched.sourceUpdatedAt,
        fetchedAt: new Date().toISOString(),
        pageKind: "content",
        fetchMode,
        managedBy: "subscription",
        parentUrl: input.parentUrl || input.url
      });
      imported.push({
        key: link.key || link.number || "",
        title: item.metadata.title,
        itemId: item.metadata.id,
        url: item.metadata.url,
        sourceUpdatedAt: item.metadata.sourceUpdatedAt || "",
        sourceUrl: link.href
      });
    } catch (error) {
      errors.push({ key: link.key || link.number || "", url: contentUrl, error: error.message || String(error) });
    }
  }

  return {
    linkCount: links.length,
    importedCount: imported.length,
    errorCount: errors.length,
    imported,
    errors
  };
}

function mergeTags(...tagLists) {
  return normalizeTags(tagLists.flat().join(","));
}

async function updateTags(id, tags) {
  const item = await readItem(id);
  const metadata = {
    ...item.metadata,
    tags: normalizeTags(tags),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(itemsDir, id, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(itemsDir, id, "document.md"), renderDocument(metadata, extractBodyFromDocument(item.document), extractSummaryFromDocument(item.document)), "utf8");
  await rebuildIndexes();
  return readItem(id);
}

async function updateTitle(id, title) {
  const item = await readItem(id);
  const nextTitle = cleanText(title).slice(0, 180);
  if (!nextTitle) throw new Error("标题不能为空。");
  const metadata = {
    ...item.metadata,
    title: nextTitle,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(itemsDir, id, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(itemsDir, id, "document.md"), renderDocument(metadata, extractBodyFromDocument(item.document), extractSummaryFromDocument(item.document)), "utf8");
  await rebuildIndexes();
  return readItem(id);
}

async function updateTitleWithAi(id) {
  const item = await readItem(id);
  const title = settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model
    ? await recommendTitleWithOpenAICompatible(item)
    : recommendTitleLocally(item);
  return updateTitle(id, title);
}

async function recommendTitleWithOpenAICompatible(item) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const body = extractBodyFromDocument(item.document).trim().slice(0, 12000);
  const supplemental = await supplementalPromptBlock();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "你是知识库资料标题生成助手。",
            "根据资料正文生成一个便于检索的中文标题，主要描述内容涉及的核心对象、问题或主题。",
            "要求：不要复述冗长原始标题；不要使用 Markdown；不要加引号；长度控制在 12 到 40 个中文字符左右。",
            supplemental
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `来源类型：${item.metadata.sourceType || "unknown"}`,
            `原标题：${item.metadata.title || ""}`,
            "",
            "正文：",
            body
          ].join("\n")
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AI 标题生成失败：${response.status} ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  return cleanGeneratedTitle(data.choices?.[0]?.message?.content || "");
}

function recommendTitleLocally(item) {
  const body = extractBodyFromDocument(item.document);
  const lines = body.split(/\n+/)
    .map((line) => cleanText(line.replace(/^[-#*>`\s]+/, "")))
    .filter((line) => line.length >= 6 && !/^source:|^adapter:|^url:/i.test(line));
  return cleanGeneratedTitle(lines[0] || item.metadata.title || "未命名资料");
}

function cleanGeneratedTitle(title) {
  return cleanText(String(title || "")
    .replace(/^#+\s*/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^标题[:：]\s*/i, ""))
    .slice(0, 180) || "未命名资料";
}

async function acknowledgeItemUpdate(id) {
  const item = await readItem(id);
  if (!item.metadata.contentUpdatedAt) return item;

  const metadata = {
    ...item.metadata,
    contentUpdatedAt: "",
    updateAcknowledgedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(itemsDir, id, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(itemsDir, id, "document.md"), renderDocument(metadata, extractBodyFromDocument(item.document), extractSummaryFromDocument(item.document)), "utf8");
  await rebuildIndexes();
  return readItem(id);
}

async function recommendTagsForItem(id) {
  const item = await readItem(id);
  const allTags = (await listTags()).map((tag) => tag.name);
  const currentTags = item.metadata.tags || [];
  const content = [
    `Title: ${item.metadata.title}`,
    `Source: ${item.metadata.sourceType}`,
    `URL: ${item.metadata.url || ""}`,
    "",
    item.document,
    "",
    item.comments?.length ? `Comments:\n${item.comments.map((comment) => comment.body).join("\n\n")}` : ""
  ].join("\n").slice(0, 24000);

  if (settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model) {
    const tags = await recommendTagsWithOpenAICompatible({ content, allTags, currentTags });
    return {
      mode: "ai",
      tags,
      currentTags,
      existingTags: allTags,
      note: `使用模型 ${settings.ai.model} 推荐。`
    };
  }

  return {
    mode: "local",
    tags: recommendTagsLocally(content, allTags, currentTags),
    currentTags,
    existingTags: allTags,
    note: "未配置 AI 接口，当前使用本地关键词和已有标签推荐。"
  };
}

async function recommendTagsForItems(ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => cleanText(id)).filter(Boolean))].slice(0, 80);
  if (!uniqueIds.length) return { tags: [], assignments: [] };
  const items = [];
  for (const id of uniqueIds) {
    try {
      items.push(await readItem(id));
    } catch {
      // Ignore deleted or invalid items in a long-running batch.
    }
  }
  const allTags = (await listTags()).map((tag) => tag.name);
  const result = settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model
    ? await recommendBatchTagsWithOpenAICompatible(items, allTags)
    : recommendBatchTagsLocally(items, allTags);
  return normalizeBatchTagRecommendations(result, items, allTags);
}

async function recommendBatchTagsWithOpenAICompatible(items, allTags) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const supplemental = await supplementalPromptBlock();
  const documents = items.map((item) => {
    const processed = item.processedDocument
      ? extractProcessedBodyFromDocument(item.processedDocument)
      : "";
    const source = processed || extractBodyFromDocument(item.document);
    return [
      `ID: ${item.metadata.id}`,
      `标题: ${item.metadata.title}`,
      `来源: ${item.metadata.sourceType}`,
      `当前标签: ${(item.metadata.tags || []).join(", ") || "none"}`,
      "内容:",
      source.slice(0, 3500)
    ].join("\n");
  }).join("\n\n---\n\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "你是资料库批量标签分类助手。",
            "请根据一批文档的整体主题、来源、状态、问题类型和行动项，设计统一的标签池，并给每篇文档分配适合的标签。",
            "优先复用已有标签；同义标签必须合并，只保留一种写法。",
            "标签使用小写短词、数字或连字符，不要包含空格。",
            "不要给每篇文档都创造独有标签；优先生成能横向分类多篇文档的标签。",
            "只返回 JSON，格式为 {\"tags\":[\"tag-a\"],\"assignments\":[{\"id\":\"item-id\",\"tags\":[\"tag-a\"]}]}。",
            supplemental
          ].filter(Boolean).join("\n")
        },
        {
          role: "user",
          content: [
            `资料库已有标签：${allTags.join(", ") || "none"}`,
            "",
            "待分类文档：",
            documents
          ].join("\n")
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AI 批量标签推荐失败：${response.status} ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  return parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
}

function recommendBatchTagsLocally(items, allTags) {
  const assignments = items.map((item) => {
    const content = [
      item.metadata.title,
      item.processedDocument || item.document
    ].join("\n");
    return {
      id: item.metadata.id,
      tags: recommendTagsLocally(content, allTags, item.metadata.tags || [])
    };
  });
  return {
    tags: uniqueValues(assignments.flatMap((assignment) => assignment.tags)),
    assignments
  };
}

function normalizeBatchTagRecommendations(result, items, allTags) {
  const itemIds = new Set(items.map((item) => item.metadata.id));
  const knownTags = new Map(allTags.map((tag) => [tag.toLowerCase(), tag]));
  const canonicalize = (tags) => normalizeTags(tags || []).map((tag) => knownTags.get(tag.toLowerCase()) || tag);
  const assignments = (result.assignments || [])
    .filter((assignment) => itemIds.has(assignment.id))
    .map((assignment) => ({
      id: assignment.id,
      tags: uniqueValues(canonicalize(assignment.tags)).slice(0, 12)
    }));
  const assignedIds = new Set(assignments.map((assignment) => assignment.id));
  for (const item of items) {
    if (!assignedIds.has(item.metadata.id)) {
      assignments.push({ id: item.metadata.id, tags: [] });
    }
  }
  const tags = uniqueValues([
    ...canonicalize(result.tags || []),
    ...assignments.flatMap((assignment) => assignment.tags)
  ]).slice(0, 40);
  return { tags, assignments };
}

async function classifyItems(ids, categories = []) {
  const uniqueIds = [...new Set((ids || []).map((id) => cleanText(id)).filter(Boolean))].slice(0, 120);
  const normalizedCategories = normalizeClassificationCategories(categories);
  const items = [];
  for (const id of uniqueIds) {
    try {
      items.push(await readItem(id));
    } catch {
      // Ignore items deleted while a list classification request is running.
    }
  }
  if (!items.length) return { groups: [], note: "当前列表没有可分类的资料。" };
  const result = settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model
    ? await classifyItemsWithOpenAICompatible(items, normalizedCategories)
    : classifyItemsLocally(items, normalizedCategories);
  return normalizeItemClassification(result, items, normalizedCategories);
}

async function classifyItem(id, categories = []) {
  const normalizedCategories = normalizeClassificationCategories(categories);
  if (!normalizedCategories.length) {
    throw new Error("请先提供分类类别。");
  }
  const item = await readItem(cleanText(id));
  if (!settings.ai?.baseUrl || !settings.ai?.apiKey || !settings.ai?.model) {
    return classifyItemLocally(item, normalizedCategories);
  }
  return classifyItemWithOpenAICompatible(item, normalizedCategories);
}

async function classifyItemsWithOpenAICompatible(items, categories = []) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const supplemental = await supplementalPromptBlock();
  const documents = items.map((item) => {
    const processed = item.processedDocument
      ? extractProcessedBodyFromDocument(item.processedDocument)
      : "";
    const source = processed || extractBodyFromDocument(item.document);
    return [
      `ID: ${item.metadata.id}`,
      `标题: ${item.metadata.title}`,
      `来源: ${item.metadata.sourceType || "unknown"}`,
      `标签: ${(item.metadata.tags || []).join(", ") || "none"}`,
      "内容摘要:",
      source.slice(0, 1800)
    ].join("\n");
  }).join("\n\n---\n\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "你是资料库列表分类助手。",
            categories.length
              ? "用户已经给出固定类别。你必须逐条阅读资料，并且只把资料分配到这些类别中；不能新增类别。确实不适合任何类别时才放到“未分类”。"
              : "请把当前资料列表按主题、项目、问题类型或工作流分成适合浏览的分类。",
            categories.length ? "" : "分类数量通常为 3 到 10 个；避免每篇文档单独一个分类。",
            "每个资料 ID 最多出现一次，尽量覆盖所有资料。",
            "分类名要短且清晰，适合显示在左侧列表。",
            "只返回 JSON，格式为 {\"groups\":[{\"name\":\"分类名\",\"itemIds\":[\"item-id\"],\"reason\":\"分类依据\"}]}。",
            supplemental
          ].filter(Boolean).join("\n")
        },
        {
          role: "user",
          content: [
            `当前列表共有 ${items.length} 条资料。`,
            categories.length ? `可用类别：${categories.join("、")}、未分类` : "",
            "",
            documents
          ].filter(Boolean).join("\n")
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AI 列表分类失败：${response.status} ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  return parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
}

async function classifyItemWithOpenAICompatible(item, categories) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const supplemental = await supplementalPromptBlock();
  const processed = item.processedDocument
    ? extractProcessedBodyFromDocument(item.processedDocument)
    : "";
  const source = processed || extractBodyFromDocument(item.document);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.ai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.ai.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "你是资料库单条资料分类助手。",
              "请阅读资料内容，并且只从用户提供的类别中选择一个最合适的类别。",
              "如果资料确实不适合任何类别，返回“未分类”。不能新增类别，不能改写类别名。",
              "只返回 JSON，格式为 {\"category\":\"类别名\",\"reason\":\"一句话分类依据\"}。",
              supplemental
            ].filter(Boolean).join("\n")
          },
          {
            role: "user",
            content: [
              `可用类别：${categories.join("、")}、未分类`,
              `ID: ${item.metadata.id}`,
              `标题: ${item.metadata.title}`,
              `来源: ${item.metadata.sourceType || "unknown"}`,
              `标签: ${(item.metadata.tags || []).join(", ") || "none"}`,
              "",
              "内容：",
              source.slice(0, 5000)
            ].join("\n")
          }
        ]
      })
    });
  } catch (error) {
    throw new Error(`AI 单条分类请求失败：${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`AI 单条分类失败：${response.status} ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const parsed = parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
  return normalizeSingleClassification(parsed, item, categories);
}

function classifyItemLocally(item, categories) {
  const content = [
    item.metadata.title,
    item.metadata.sourceType,
    ...(item.metadata.tags || []),
    extractBodyFromDocument(item.document).slice(0, 2000)
  ].join("\n").toLowerCase();
  const matchedCategory = categories.find((category) => content.includes(category.toLowerCase()));
  return {
    id: item.metadata.id,
    category: matchedCategory || "未分类",
    reason: matchedCategory ? "按类别关键词本地匹配。" : "未配置 AI，且未命中类别关键词。"
  };
}

function classifyItemsLocally(items, categories = []) {
  const groupsByName = new Map();
  for (const item of items) {
    const tags = item.metadata.tags || [];
    const content = [
      item.metadata.title,
      item.metadata.sourceType,
      ...(item.metadata.tags || []),
      extractBodyFromDocument(item.document).slice(0, 1200)
    ].join("\n").toLowerCase();
    const matchedCategory = categories.find((category) => content.includes(category.toLowerCase()));
    const name = matchedCategory || tags[0] || sourceTypeLabel(item.metadata.sourceType) || "未分类";
    if (!groupsByName.has(name)) {
      groupsByName.set(name, {
        name,
        itemIds: [],
        reason: categories.length
          ? "未配置 AI，当前按类别关键词本地匹配。"
          : tags[0] ? "按已有标签分组。" : "未配置 AI，按来源类型分组。"
      });
    }
    groupsByName.get(name).itemIds.push(item.metadata.id);
  }
  return {
    groups: [...groupsByName.values()],
    note: categories.length
      ? "未配置 AI 接口，当前按自定义类别关键词本地匹配。"
      : "未配置 AI 接口，当前按标签或来源本地分类。"
  };
}

function sourceTypeLabel(sourceType) {
  const labels = {
    text: "文本",
    web: "网页",
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams"
  };
  return labels[sourceType] || sourceType || "";
}

function normalizeClassificationCategories(categories) {
  return uniqueValues((categories || [])
    .map((category) => cleanText(category).slice(0, 40))
    .filter(Boolean))
    .slice(0, 24);
}

function normalizeSingleClassification(result, item, categories) {
  const categoryByLower = new Map(categories.map((category) => [category.toLowerCase(), category]));
  const rawCategory = cleanText(result.category || result.name || "").slice(0, 40);
  const category = categoryByLower.get(rawCategory.toLowerCase()) || (rawCategory === "未分类" ? "未分类" : "未分类");
  return {
    id: item.metadata.id,
    category,
    reason: cleanText(result.reason || "").slice(0, 120)
  };
}

function normalizeItemClassification(result, items, categories = []) {
  const itemIds = new Set(items.map((item) => item.metadata.id));
  const categoryByLower = new Map(categories.map((category) => [category.toLowerCase(), category]));
  const assigned = new Set();
  const groupsByName = new Map();
  const addGroupItems = (name, itemIds, reason = "") => {
    if (!groupsByName.has(name)) {
      groupsByName.set(name, { name, itemIds: [], reason });
    }
    const group = groupsByName.get(name);
    group.itemIds.push(...itemIds);
    if (!group.reason && reason) group.reason = reason;
  };
  for (const group of result.groups || []) {
    const ids = uniqueValues((group.itemIds || group.items || [])
      .map((id) => cleanText(typeof id === "string" ? id : id?.id))
      .filter((id) => itemIds.has(id) && !assigned.has(id)));
    if (!ids.length) continue;
    ids.forEach((id) => assigned.add(id));
    const rawName = cleanText(group.name || group.title || "未命名分类").slice(0, 40) || "未命名分类";
    const name = categories.length
      ? categoryByLower.get(rawName.toLowerCase()) || (rawName === "未分类" ? "未分类" : "未分类")
      : rawName;
    addGroupItems(name, ids, cleanText(group.reason || "").slice(0, 120));
  }
  const leftovers = items.map((item) => item.metadata.id).filter((id) => !assigned.has(id));
  if (leftovers.length) {
    addGroupItems("未分类", leftovers, "分类结果中未覆盖的资料。");
  }
  return {
    groups: [...groupsByName.values()].map((group) => ({
      ...group,
      itemIds: uniqueValues(group.itemIds)
    })),
    note: result.note || ""
  };
}

async function recommendTagsWithOpenAICompatible({ content, allTags, currentTags }) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const supplemental = await supplementalPromptBlock();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "你是资料库标签整理助手。",
            "请根据文档内容推荐 3 到 8 个短标签。",
            "优先复用已有标签，只有已有标签明显不合适时才创建新标签。",
            "避免同义但写法不同的标签，例如已有 github 就不要新建 github-issue，已有 jira 就不要新建 jira-ticket。",
            "标签使用小写短词、数字或连字符，不要包含空格。",
            "只返回 JSON，格式为 {\"tags\":[\"tag-a\",\"tag-b\"]}。",
            supplemental
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `当前文档标签：${currentTags.join(", ") || "none"}`,
            `资料库已有标签：${allTags.join(", ") || "none"}`,
            "",
            "文档内容：",
            content
          ].join("\n")
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 标签推荐失败：${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim() || "";
  const parsed = parseTagsFromAiText(text);
  return normalizeRecommendedTags(parsed, allTags, currentTags);
}

function parseTagsFromAiText(text) {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.tags)) return parsed.tags;
  } catch {
    // Fall through to comma/newline parsing.
  }
  return text.split(/[,\n]/).map((tag) => tag.replace(/^[-*\d.\s]+/, "").trim());
}

function parseJsonObjectFromText(text) {
  const raw = String(text || "");
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try {
    return JSON.parse(jsonText);
  } catch {
    return {};
  }
}

function recommendTagsLocally(content, allTags, currentTags) {
  const lowerContent = content.toLowerCase();
  const matchedExisting = allTags.filter((tag) => lowerContent.includes(tag.toLowerCase())).slice(0, 8);
  const inferred = [
    /github|pull request|issuecomment|repository/i.test(content) ? "github" : "",
    /jira|assignee|reporter|resolution/i.test(content) ? "jira" : "",
    /confluence|page id|space:/i.test(content) ? "confluence" : "",
    /blocked|blocker|阻塞/i.test(content) ? "blocked" : "",
    /test|测试|ci\b|certification/i.test(content) ? "test" : "",
    /requirement|需求|request/i.test(content) ? "requirement" : "",
    /hardware|hw\b|electrical/i.test(content) ? "hw" : "",
    /software|sw\b/i.test(content) ? "sw" : ""
  ].filter(Boolean);
  return normalizeRecommendedTags([...currentTags, ...matchedExisting, ...inferred], allTags, currentTags);
}

function normalizeRecommendedTags(tags, allTags, currentTags = []) {
  const normalized = normalizeTags(tags);
  const existingByLower = new Map(allTags.map((tag) => [tag.toLowerCase(), tag]));
  const current = new Set(currentTags.map((tag) => tag.toLowerCase()));
  const canonical = normalized.map((tag) => existingByLower.get(tag.toLowerCase()) || tag);
  return [...new Set([...canonical])].sort((a, b) => {
    const aCurrent = current.has(a.toLowerCase()) ? 0 : 1;
    const bCurrent = current.has(b.toLowerCase()) ? 0 : 1;
    return aCurrent - bCurrent || a.localeCompare(b);
  }).slice(0, 10);
}

async function processItemWithAi(id) {
  const item = await readItem(id);
  if (!settings.ai?.baseUrl || !settings.ai?.apiKey || !settings.ai?.model) {
    throw new Error("请先在设置页配置 AI 接口后再生成整理版。");
  }

  const prompt = resolveProcessingPrompt(item.metadata.sourceType);
  const processedText = unwrapMarkdownFence(await processDocumentWithOpenAICompatible(item, prompt));
  const now = new Date().toISOString();
  const metadata = {
    ...item.metadata,
    processedAt: now,
    processedModel: settings.ai.model,
    processedPromptSource: item.metadata.sourceType || "default",
    processedStale: false,
    contentUpdatedAt: item.metadata.contentUpdatedAt || item.metadata.pendingContentUpdatedAt || "",
    pendingContentUpdatedAt: "",
    updatedAt: now
  };
  const itemDir = path.join(itemsDir, id);
  await fs.writeFile(path.join(itemDir, "processed.md"), renderProcessedDocument(metadata, processedText), "utf8");
  await fs.writeFile(path.join(itemDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await rebuildIndexes();
  return readItem(id);
}

async function processDocumentWithOpenAICompatible(item, prompt) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const supplemental = await supplementalPromptBlock();
  const sourceBody = extractBodyFromDocument(item.document).trim();
  const summary = extractSummaryFromDocument(item.document).trim();
  const comments = (item.comments || [])
    .map((comment) => [
      comment.author ? `Author: ${comment.author}` : "",
      comment.createdAt ? `Time: ${comment.createdAt}` : "",
      comment.body || ""
    ].filter(Boolean).join("\n"))
    .join("\n\n---\n\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            prompt,
            "",
            "输出要求：",
            "- 使用中文。",
            "- 输出 Markdown。",
            "- 只整理资料内容，不编造原文没有的信息。",
            "- 如果信息不足或状态不明确，要明确写出“不明确”。",
            "- 保留关键原始标识，例如 Jira key、GitHub issue/PR 编号、URL、时间、人名。",
            supplemental
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `标题：${item.metadata.title}`,
            `来源类型：${item.metadata.sourceType}`,
            `URL：${item.metadata.url || "local input"}`,
            `标签：${(item.metadata.tags || []).join(", ") || "none"}`,
            `最后抓取：${item.metadata.lastFetchedAt || "not fetched"}`,
            `来源更新时间：${item.metadata.sourceUpdatedAt || "unknown"}`,
            "",
            summary ? `已有摘要：\n${summary}\n` : "",
            "原始提取内容：",
            sourceBody.slice(0, 28000),
            comments ? `\n\n评论/对话结构化内容：\n${comments.slice(0, 12000)}` : ""
          ].join("\n")
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 整理失败：${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("AI 接口没有返回可用整理结果。");
  }
  return text;
}

async function readItem(id) {
  if (!id || id.includes("..") || id.includes("/")) {
    throw new Error("Invalid item id.");
  }

  const itemDir = path.join(itemsDir, id);
  const metadata = JSON.parse(await fs.readFile(path.join(itemDir, "metadata.json"), "utf8"));
  const document = await fs.readFile(path.join(itemDir, "document.md"), "utf8");
  const processedPath = path.join(itemDir, "processed.md");
  const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
  const commentsPath = path.join(itemDir, "comments.jsonl");
  const comments = await readJsonLines(commentsPath);
  return { metadata, document, processedDocument, comments };
}

async function deleteItem(id) {
  if (!id || id.includes("..") || id.includes("/")) {
    throw new Error("Invalid item id.");
  }

  const itemDir = path.join(itemsDir, id);
  if (!(await exists(itemDir))) {
    throw new Error("Item not found.");
  }

  await fs.rm(itemDir, { recursive: true, force: true });
  await rebuildIndexes();
}

async function listItems(filters = {}) {
  const dirs = await safeReaddir(itemsDir);
  const items = [];

  for (const id of dirs) {
    const metadataPath = path.join(itemsDir, id, "metadata.json");
    if (!(await exists(metadataPath))) continue;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    const document = await fs.readFile(path.join(itemsDir, id, "document.md"), "utf8");
    const processedPath = path.join(itemsDir, id, "processed.md");
    const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
    const searchText = `${metadata.title} ${(metadata.tags || []).join(" ")} ${processedDocument} ${document}`.toLowerCase();

    if (!isTruthyFilter(filters.includeLists) && metadata.pageKind === "list") continue;
    if (!isTruthyFilter(filters.includeInvalidTeamsRoot) && isInvalidTeamsRootCapture(metadata)) continue;
    if (filters.tag && !(metadata.tags || []).includes(filters.tag)) continue;
    if (filters.sourceType && metadata.sourceType !== filters.sourceType) continue;
    if (isTruthyFilter(filters.updates) && !metadata.contentUpdatedAt) continue;
    if (filters.query && !searchText.includes(filters.query.toLowerCase())) continue;

    items.push({
      ...metadata,
      hasProcessed: Boolean(processedDocument),
      excerpt: summarizeExcerpt(processedDocument || document)
    });
  }

  return items.sort((a, b) => {
    const updateState = Number(Boolean(b.contentUpdatedAt)) - Number(Boolean(a.contentUpdatedAt));
    if (updateState !== 0) return updateState;
    const updateTime = String(b.contentUpdatedAt || "").localeCompare(String(a.contentUpdatedAt || ""));
    if (updateTime !== 0) return updateTime;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

async function searchItems(query) {
  if (!query.trim()) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = await listItems();

  return items
    .map((item) => {
      const haystack = `${item.title} ${item.excerpt} ${(item.tags || []).join(" ")}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function buildAskContext(question) {
  const cleanQuestion = cleanText(question);
  const results = await searchItems(cleanQuestion);
  const selected = results.slice(0, 6).map((result) => result.item);
  const sourceLines = selected.map((item) => {
    const itemPath = `knowledge-base/items/${item.id}`;
    return `- ${item.title} (${item.sourceType}, tags: ${(item.tags || []).join(", ") || "none"})\n  - metadata: ${itemPath}/metadata.json\n  - processed: ${itemPath}/processed.md（如果存在，优先阅读）\n  - document: ${itemPath}/document.md\n  - comments: ${itemPath}/comments.jsonl\n  - url: ${item.url || "local input"}\n  - last fetched: ${item.lastFetchedAt || "not fetched"}`;
  });

  const prompt = `请基于当前项目目录里的 knowledge-base 回答这个问题：

${cleanQuestion || "(这里填写问题)"}

优先阅读：
${sourceLines.join("\n") || "- knowledge-base/indexes/by-updated.json\n- knowledge-base/items/*/document.md"}

回答要求：
- 先给结论，再列关键依据。
- 优先读取 processed.md；需要查原文时读取 document.md、comments.jsonl 和 raw 文件。
- 引用资料时带上 item id、URL 和 lastFetchedAt。
- 如果资料可能过期，明确提醒。`;

  return {
    question: cleanQuestion,
    rootDir: kbDir,
    prompt,
    sources: selected
  };
}

async function answerFromKnowledgeBase(message) {
  const cleanMessage = cleanText(message);
  if (!cleanMessage) {
    throw new Error("请输入问题。");
  }

  const results = await searchKnowledgeBase(cleanMessage, 8);
  const trace = [
    {
      type: "thinking",
      title: "理解问题",
      detail: `准备基于本地知识库回答：“${cleanMessage.slice(0, 120)}”`
    },
    {
      type: "tool",
      title: "检索本地知识库",
      detail: `在 ${kbDir} 中检索相关资料，返回 ${results.length} 条候选。`
    },
    {
      type: "tool_result",
      title: "命中资料",
      detail: results.length
        ? results.slice(0, 5).map((result, index) => `${index + 1}. ${result.item.title} (${result.item.sourceType})`).join("\n")
        : "没有命中资料，将按空上下文回答。"
    }
  ];
  if (settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model) {
    return answerWithOpenAICompatible(cleanMessage, results, trace);
  }

  return {
    role: "assistant",
    mode: "local",
    content: buildLocalKnowledgeAnswer(cleanMessage, results),
    rootDir: kbDir,
    sources: results.map(toPublicKnowledgeSource),
    trace: [
      ...trace,
      {
        type: "tool_result",
        title: "本地回答",
        detail: "未配置 AI 接口，返回本地检索结果。"
      }
    ]
  };
}

async function answerWithOpenAICompatible(question, results, trace = []) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const context = results.map((result, index) => {
    const source = result.item;
    return `资料 ${index + 1}
ID: ${source.id}
标题: ${source.title}
来源: ${source.sourceType}
URL: ${source.url || "local input"}
标签: ${(source.tags || []).join(", ") || "none"}
最后抓取: ${source.lastFetchedAt || "not fetched"}
文件: ${source.paths.document}
整理版: ${source.paths.processed || "not generated"}

内容:
${result.context}`;
  }).join("\n\n---\n\n");
  const supplemental = await supplementalPromptBlock();
  const endpointHost = safeHostname(endpoint) || baseUrl;
  const requestTrace = [
    ...trace,
    {
      type: "tool",
      title: "调用 AI 接口",
      detail: `模型：${settings.ai.model}\n接口：${endpointHost}\n上下文资料：${results.length} 条`
    }
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "你是本地知识库问答助手。只能基于提供的资料回答；如果资料不足，要明确说不知道。回答使用中文。结论在前，并在关键依据处引用资料 ID、URL 或文件路径。",
            supplemental
          ].filter(Boolean).join("\n\n")
        },
        {
          role: "user",
          content: `问题：${question}\n\n本地知识库根目录：${kbDir}\n\n检索到的资料：\n${context || "没有检索到相关资料。"}`
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 问答失败：${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("AI 接口没有返回可用回答。");
  }

  return {
    role: "assistant",
    mode: "ai",
    content,
    rootDir: kbDir,
    sources: results.map(toPublicKnowledgeSource),
    trace: [
      ...requestTrace,
      {
        type: "tool_result",
        title: "AI 返回",
        detail: `收到模型回答，长度 ${content.length} 字符。`
      }
    ]
  };
}

async function streamAnswerFromKnowledgeBase(message, res) {
  startSse(res);
  try {
    const cleanMessage = cleanText(message);
    if (!cleanMessage) {
      throw new Error("请输入问题。");
    }

    sendSse(res, "trace", {
      type: "thinking",
      title: "理解问题",
      detail: `准备基于本地知识库回答：“${cleanMessage.slice(0, 120)}”`
    });

    const results = await searchKnowledgeBase(cleanMessage, 8);
    const sources = results.map(toPublicKnowledgeSource);
    sendSse(res, "trace", {
      type: "tool",
      title: "检索本地知识库",
      detail: `在 ${kbDir} 中检索相关资料，返回 ${results.length} 条候选。`
    });
    sendSse(res, "trace", {
      type: "tool_result",
      title: "命中资料",
      detail: results.length
        ? results.slice(0, 5).map((result, index) => `${index + 1}. ${result.item.title} (${result.item.sourceType})`).join("\n")
        : "没有命中资料，将按空上下文回答。"
    });
    sendSse(res, "sources", { sources });

    if (settings.ai?.baseUrl && settings.ai?.apiKey && settings.ai?.model) {
      await streamWithOpenAICompatible(cleanMessage, results, sources, res);
      return;
    }

    const content = buildLocalKnowledgeAnswer(cleanMessage, results);
    sendSse(res, "trace", {
      type: "tool_result",
      title: "本地回答",
      detail: "未配置 AI 接口，返回本地检索结果。"
    });
    sendSse(res, "delta", { text: content });
    sendSse(res, "done", {
      role: "assistant",
      mode: "local",
      content,
      rootDir: kbDir,
      sources
    });
    res.end();
  } catch (error) {
    sendSse(res, "error", { error: error.message || String(error) });
    res.end();
  }
}

async function streamWithOpenAICompatible(question, results, sources, res) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const context = buildOpenAIContext(results);
  const supplemental = await supplementalPromptBlock();
  sendSse(res, "trace", {
    type: "tool",
    title: "调用 AI 接口",
    detail: `模型：${settings.ai.model}\n接口：${safeHostname(endpoint) || baseUrl}\n上下文资料：${results.length} 条`
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      stream: true,
      messages: [
        {
          role: "system",
          content: [
            "你是本地知识库问答助手。只能基于提供的资料回答；如果资料不足，要明确说不知道。回答使用中文。结论在前，并在关键依据处引用资料 ID、URL 或文件路径。",
            supplemental
          ].filter(Boolean).join("\n\n")
        },
        {
          role: "user",
          content: `问题：${question}\n\n本地知识库根目录：${kbDir}\n\n检索到的资料：\n${context || "没有检索到相关资料。"}`
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 问答失败：${response.status} ${text.slice(0, 300)}`);
  }

  let content = "";
  if (!response.body) {
    throw new Error("AI 接口没有返回可读取的流。");
  }

  let streamBuffer = "";
  for await (const chunk of response.body) {
    streamBuffer += Buffer.from(chunk).toString("utf8");
    const parsed = parseOpenAIStreamPayloads(streamBuffer);
    streamBuffer = parsed.rest;
    for (const payload of parsed.payloads) {
      if (payload === "[DONE]") continue;
      const delta = payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || "";
      if (!delta) continue;
      content += delta;
      sendSse(res, "delta", { text: delta });
    }
  }

  sendSse(res, "trace", {
    type: "tool_result",
    title: "AI 返回",
    detail: `收到模型回答，长度 ${content.length} 字符。`
  });
  sendSse(res, "done", {
    role: "assistant",
    mode: "ai",
    content,
    rootDir: kbDir,
    sources
  });
  res.end();
}

function buildOpenAIContext(results) {
  return results.map((result, index) => {
    const source = result.item;
    return `资料 ${index + 1}
ID: ${source.id}
标题: ${source.title}
来源: ${source.sourceType}
URL: ${source.url || "local input"}
标签: ${(source.tags || []).join(", ") || "none"}
最后抓取: ${source.lastFetchedAt || "not fetched"}
文件: ${source.paths.document}

内容:
${result.context}`;
  }).join("\n\n---\n\n");
}

function parseOpenAIStreamPayloads(chunk) {
  const parts = chunk.split(/\n\n+/);
  const rest = parts.pop() || "";
  const payloads = parts
    .flatMap((part) => part.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((payload) => payload === "[DONE]" ? payload : JSON.parse(payload));
  return { payloads, rest };
}

async function searchKnowledgeBase(query, limit = 8) {
  const terms = tokenizeQuery(query);
  const desiredLimit = Math.max(1, Number(limit) || 8);
  const embeddingEnabled = isEmbeddingEnabled();
  const dirs = await safeReaddir(itemsDir);
  const results = [];

  for (const id of dirs) {
    const material = await readMaterialForSearch(id);
    if (!material) continue;
    const { metadata, document, processedDocument, commentsText, paths } = material;
    const haystack = `${metadata.title}\n${(metadata.tags || []).join(" ")}\n${metadata.sourceType}\n${metadata.url || ""}\n${processedDocument}\n${document}\n${commentsText}`.toLowerCase();
    const score = scoreKnowledgeMatch(haystack, terms, metadata);

    if (score > 0 || !terms.length) {
      results.push({
        score,
        keywordScore: score,
        vectorScore: 0,
        item: {
          ...metadata,
          paths
        },
        context: buildKnowledgeContext(processedDocument || document, commentsText, terms)
      });
    }
  }

  if (!embeddingEnabled) {
    const sorted = results
      .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));
    return diversifyKnowledgeResults(sorted, desiredLimit, terms);
  }

  try {
    const vectorResults = await searchKnowledgeBaseByEmbedding(query, terms, desiredLimit * 2);
    const merged = mergeKnowledgeResults(results, vectorResults);
    return diversifyKnowledgeResults(merged, desiredLimit, terms);
  } catch (error) {
    console.error("Embedding search failed, falling back to keyword search:", error);
    const sorted = results
      .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));
    return diversifyKnowledgeResults(sorted, desiredLimit, terms);
  }
}

async function readMaterialForSearch(id) {
  const itemDir = path.join(itemsDir, id);
  const metadataPath = path.join(itemDir, "metadata.json");
  const documentPath = path.join(itemDir, "document.md");
  if (!(await exists(metadataPath)) || !(await exists(documentPath))) return null;

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const document = await fs.readFile(documentPath, "utf8");
  const processedPath = path.join(itemDir, "processed.md");
  const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
  const commentsPath = path.join(itemDir, "comments.jsonl");
  const comments = await readJsonLines(commentsPath);
  const commentsText = comments.map((comment) => JSON.stringify(comment)).join("\n");
  return {
    metadata,
    document,
    processedDocument,
    commentsText,
    paths: {
      metadata: metadataPath,
      document: documentPath,
      processed: processedDocument ? processedPath : "",
      comments: commentsPath,
      raw: path.join(itemDir, metadata.rawFileName || "raw.txt")
    }
  };
}

function diversifyKnowledgeResults(results, limit, terms) {
  if (!results.length) return [];
  if (!terms.length) return results.slice(0, limit);

  const selected = [];
  const seen = new Set();
  const bySource = new Map();
  for (const result of results) {
    const sourceType = result.item.sourceType || "unknown";
    if (!bySource.has(sourceType)) bySource.set(sourceType, []);
    bySource.get(sourceType).push(result);
  }

  for (const group of bySource.values()) {
    const candidate = group[0];
    if (!candidate || seen.has(candidate.item.id)) continue;
    selected.push(candidate);
    seen.add(candidate.item.id);
    if (selected.length >= limit) return selected;
  }

  for (const result of results) {
    if (seen.has(result.item.id)) continue;
    selected.push(result);
    seen.add(result.item.id);
    if (selected.length >= limit) break;
  }

  return selected.sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));
}

async function searchKnowledgeBaseByEmbedding(query, terms, limit) {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) return [];
  const index = await ensureEmbeddingIndex();
  if (!index.records.length) return [];

  const queryVector = await createEmbedding(cleanQuery);
  const bestByItem = new Map();
  for (const record of index.records) {
    const vectorScore = cosineSimilarity(queryVector, record.vector);
    if (!Number.isFinite(vectorScore)) continue;
    const previous = bestByItem.get(record.itemId);
    if (!previous || vectorScore > previous.vectorScore) {
      bestByItem.set(record.itemId, { record, vectorScore });
    }
  }

  const candidates = [...bestByItem.values()]
    .filter((candidate) => candidate.vectorScore > 0.2)
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, Math.max(1, limit));

  const results = [];
  for (const candidate of candidates) {
    const material = await readMaterialForSearch(candidate.record.itemId);
    if (!material) continue;
    const { metadata, document, processedDocument, commentsText, paths } = material;
    results.push({
      score: candidate.vectorScore * 20,
      keywordScore: 0,
      vectorScore: candidate.vectorScore,
      item: {
        ...metadata,
        paths
      },
      context: buildVectorKnowledgeContext(candidate.record.text, processedDocument || document, commentsText, terms)
    });
  }
  return results;
}

function mergeKnowledgeResults(keywordResults, vectorResults) {
  const merged = new Map();
  for (const result of [...keywordResults, ...vectorResults]) {
    const id = result.item.id;
    const previous = merged.get(id);
    if (!previous) {
      merged.set(id, result);
      continue;
    }
    const keywordScore = Math.max(previous.keywordScore || 0, result.keywordScore || 0);
    const vectorScore = Math.max(previous.vectorScore || 0, result.vectorScore || 0);
    merged.set(id, {
      ...previous,
      keywordScore,
      vectorScore,
      score: keywordScore + vectorScore * 20,
      context: result.vectorScore > (previous.vectorScore || 0) ? result.context : previous.context
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));
}

function isEmbeddingEnabled() {
  return Boolean(
    settings.embedding?.enabled
    && settings.embedding?.baseUrl
    && settings.embedding?.apiKey
    && settings.embedding?.model
  );
}

function embeddingIndexPath() {
  return path.join(indexesDir, "embeddings.json");
}

function embeddingConfigKey() {
  return [
    settings.embedding?.baseUrl || "",
    settings.embedding?.model || "",
    Number(settings.embedding?.dimensions || 0) || ""
  ].join("|");
}

async function ensureEmbeddingIndex() {
  await fs.mkdir(indexesDir, { recursive: true });
  const currentManifest = await buildEmbeddingManifest();
  const filePath = embeddingIndexPath();
  if (await exists(filePath)) {
    try {
      const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (
        saved.configKey === embeddingConfigKey()
        && JSON.stringify(saved.manifest || []) === JSON.stringify(currentManifest)
        && Array.isArray(saved.records)
      ) {
        return saved;
      }
    } catch {
      // Rebuild malformed embedding indexes.
    }
  }

  const rebuilt = await rebuildEmbeddingIndex(currentManifest);
  await fs.writeFile(filePath, `${JSON.stringify(rebuilt)}\n`, "utf8");
  return rebuilt;
}

async function buildEmbeddingManifest() {
  const dirs = await safeReaddir(itemsDir);
  const manifest = [];
  for (const id of dirs) {
    const material = await readMaterialForSearch(id);
    if (!material) continue;
    if (material.metadata.pageKind === "list") continue;
    manifest.push({
      id,
      updatedAt: material.metadata.updatedAt || "",
      processedAt: material.metadata.processedAt || "",
      sourceUpdatedAt: material.metadata.sourceUpdatedAt || ""
    });
  }
  return manifest.sort((a, b) => a.id.localeCompare(b.id));
}

async function rebuildEmbeddingIndex(manifest) {
  const records = [];
  for (const entry of manifest) {
    const material = await readMaterialForSearch(entry.id);
    if (!material) continue;
    const chunks = chunkMaterialForEmbedding(material).slice(0, 20);
    if (!chunks.length) continue;
    const vectors = await createEmbeddings(chunks.map((chunk) => chunk.text));
    for (let index = 0; index < chunks.length; index += 1) {
      records.push({
        itemId: entry.id,
        chunkId: chunks[index].id,
        sourceType: material.metadata.sourceType,
        title: material.metadata.title,
        text: chunks[index].text,
        vector: vectors[index] || []
      });
    }
  }
  return {
    version: 1,
    configKey: embeddingConfigKey(),
    generatedAt: new Date().toISOString(),
    manifest,
    records
  };
}

function chunkMaterialForEmbedding(material) {
  const metadata = material.metadata;
  const base = material.processedDocument || material.document;
  const body = extractBodyFromDocument(base).trim();
  const header = [
    `标题：${metadata.title}`,
    `来源：${metadata.sourceType}`,
    `URL：${metadata.url || "local input"}`,
    `标签：${(metadata.tags || []).join(", ") || "none"}`
  ].join("\n");
  const text = `${header}\n\n${body}`.replace(/\n{3,}/g, "\n\n");
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > 1200 && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => ({
    id: `${metadata.id || "item"}-${index + 1}`,
    text: chunk.slice(0, 1800)
  }));
}

async function createEmbedding(text) {
  const vectors = await createEmbeddings([text]);
  return vectors[0] || [];
}

async function createEmbeddings(inputs) {
  if (!inputs.length) return [];
  const baseUrl = settings.embedding.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.embedding.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.embedding.model,
      input: inputs,
      ...(Number(settings.embedding.dimensions) > 0 ? { dimensions: Number(settings.embedding.dimensions) } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Embedding 生成失败：${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((item) => Array.isArray(item.embedding) ? item.embedding.map(Number) : []);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

function buildVectorKnowledgeContext(bestChunk, document, commentsText, terms) {
  const keywordContext = buildKnowledgeContext(document, commentsText, terms);
  return [
    "语义命中片段：",
    bestChunk,
    keywordContext ? "\n关键词相关片段：" : "",
    keywordContext
  ].filter(Boolean).join("\n").slice(0, 6000);
}

async function readKnowledgeSearchResult(id, score, terms) {
  const itemDir = path.join(itemsDir, id);
  const metadataPath = path.join(itemDir, "metadata.json");
  const documentPath = path.join(itemDir, "document.md");
  if (!(await exists(metadataPath)) || !(await exists(documentPath))) return null;

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const document = await fs.readFile(documentPath, "utf8");
  const processedPath = path.join(itemDir, "processed.md");
  const processedDocument = await exists(processedPath) ? await fs.readFile(processedPath, "utf8") : "";
  const commentsPath = path.join(itemDir, "comments.jsonl");
  const comments = await readJsonLines(commentsPath);
  const commentsText = comments.map((comment) => JSON.stringify(comment)).join("\n");
  return {
    score,
    item: {
      ...metadata,
      paths: {
        metadata: metadataPath,
        document: documentPath,
        processed: processedDocument ? processedPath : "",
        comments: commentsPath,
        raw: path.join(itemDir, metadata.rawFileName || "raw.txt")
      }
    },
    context: buildKnowledgeContext(processedDocument || document, commentsText, terms)
  };
}

function buildKnowledgeContext(document, commentsText, terms) {
  const body = extractBodyFromDocument(document);
  const summary = extractSummaryFromDocument(document);
  const lines = `${summary ? `摘要:\n${summary}\n\n` : ""}${body}\n${commentsText ? `\n评论:\n${commentsText}` : ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const matched = terms.length
    ? lines.filter((line) => terms.some((term) => line.toLowerCase().includes(term))).slice(0, 12)
    : [];
  const selected = matched.length ? matched : lines.slice(0, 18);
  return selected.join("\n").slice(0, 6000);
}

function buildLocalKnowledgeAnswer(question, results) {
  if (!results.length) {
    return `我没有在本地知识库中找到和“${question}”明显相关的资料。\n\n知识库根目录：${kbDir}`;
  }

  const sources = results.map((result, index) => {
    const item = result.item;
    return `${index + 1}. ${item.title} (${item.id})\n   来源：${item.sourceType} · ${item.url || "local input"}\n   最后抓取：${item.lastFetchedAt || "not fetched"}\n   文件：${item.paths.processed || item.paths.document}\n   相关片段：${result.context.slice(0, 420).replace(/\n/g, " ")}`;
  }).join("\n\n");

  return `我在本地知识库里找到了这些相关资料。当前未配置 AI 接口，所以先返回可追溯的检索结果；配置 OpenAI 兼容接口后会直接基于这些内容生成回答。\n\n问题：${question}\n\n${sources}`;
}

function toPublicKnowledgeSource(result) {
  return {
    id: result.item.id,
    title: result.item.title,
    sourceType: result.item.sourceType,
    url: result.item.url,
    tags: result.item.tags || [],
    lastFetchedAt: result.item.lastFetchedAt,
    updatedAt: result.item.updatedAt,
    score: result.score,
    paths: result.item.paths,
    excerpt: result.context.slice(0, 500)
  };
}

function scoreKnowledgeMatch(haystack, terms, metadata) {
  if (!terms.length) return 1;
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const occurrences = haystack.split(term).length - 1;
    score += Math.min(occurrences, 6);
    if (String(metadata.title || "").toLowerCase().includes(term)) score += 6;
    if ((metadata.tags || []).some((tag) => tag.includes(term))) score += 4;
    if (String(metadata.sourceType || "").toLowerCase().includes(term)) score += 2;
  }
  return score;
}

function tokenizeQuery(query) {
  const lower = cleanText(query).toLowerCase();
  const asciiTerms = lower.match(/[a-z0-9._/-]{2,}/g) || [];
  const cjkPhrases = lower.match(/[\p{Script=Han}]{2,}/gu) || [];
  const cjkTerms = cjkPhrases.flatMap((phrase) => {
    const terms = [phrase];
    for (let index = 0; index < phrase.length - 1; index += 1) {
      const term = phrase.slice(index, index + 2);
      if (!/[的了和是有在与及或这那哪]/u.test(term)) terms.push(term);
    }
    return terms;
  });
  const shortTerms = lower.split(/\s+/).filter((term) => term.length >= 2);
  const stopTerms = new Set(["有关", "相关", "内容", "资料", "信息", "什么", "哪些", "一下", "这个", "那个"]);
  return [...new Set([...asciiTerms, ...cjkTerms, ...shortTerms])]
    .filter((term) => !stopTerms.has(term) && !(/^[\p{Script=Han}]+$/u.test(term) && term.length > 8))
    .slice(0, 32);
}

async function listTags() {
  const items = await listItems();
  const tagMap = new Map();
  const manualTags = await readManualTags();

  for (const item of items) {
    for (const tag of item.tags || []) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }

  for (const tag of manualTags) {
    if (!tagMap.has(tag)) tagMap.set(tag, 0);
  }

  return [...tagMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function addManualTags(tags) {
  const nextTags = normalizeTags(tags);
  if (!nextTags.length) return listTags();
  const manualTags = await readManualTags();
  await writeManualTags([...new Set([...manualTags, ...nextTags])]);
  await rebuildIndexes();
  return listTags();
}

async function renameTag(from, to) {
  const [oldTag] = normalizeTags([from]);
  const [newTag] = normalizeTags([to]);
  if (!oldTag || !newTag) {
    throw new Error("请输入有效的原标签和新标签。");
  }
  if (oldTag === newTag) {
    return { oldTag, newTag, touchedItems: [], tags: await listTags() };
  }

  const touchedItems = [];
  const dirs = await safeReaddir(itemsDir);
  for (const id of dirs) {
    const metadataPath = path.join(itemsDir, id, "metadata.json");
    const documentPath = path.join(itemsDir, id, "document.md");
    if (!(await exists(metadataPath)) || !(await exists(documentPath))) continue;

    const item = await readItem(id);
    const previousTags = item.metadata.tags || [];
    if (!previousTags.includes(oldTag)) continue;

    const nextTags = uniqueValues(previousTags.map((tag) => tag === oldTag ? newTag : tag));
    const metadata = {
      ...item.metadata,
      tags: nextTags,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await fs.writeFile(documentPath, renderDocument(metadata, extractBodyFromDocument(item.document), extractSummaryFromDocument(item.document)), "utf8");
    touchedItems.push({ id, title: metadata.title });
  }

  const manualTags = await readManualTags();
  const nextManualTags = uniqueValues(manualTags.map((tag) => tag === oldTag ? newTag : tag));
  if (manualTags.includes(oldTag) || !nextManualTags.includes(newTag)) {
    await writeManualTags([...nextManualTags, newTag]);
  } else {
    await writeManualTags(nextManualTags);
  }
  await rebuildIndexes();

  return {
    oldTag,
    newTag,
    touchedItems,
    tags: await listTags()
  };
}

async function deleteTags(tags) {
  const targetTags = normalizeTags(tags);
  if (!targetTags.length) {
    return { deletedTags: [], touchedItems: [], tags: await listTags() };
  }

  const targetSet = new Set(targetTags);
  const touchedItems = [];
  const dirs = await safeReaddir(itemsDir);
  for (const id of dirs) {
    const metadataPath = path.join(itemsDir, id, "metadata.json");
    const documentPath = path.join(itemsDir, id, "document.md");
    if (!(await exists(metadataPath)) || !(await exists(documentPath))) continue;

    const item = await readItem(id);
    const previousTags = item.metadata.tags || [];
    const nextTags = previousTags.filter((tag) => !targetSet.has(tag));
    if (nextTags.length === previousTags.length) continue;

    const metadata = {
      ...item.metadata,
      tags: nextTags,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await fs.writeFile(documentPath, renderDocument(metadata, extractBodyFromDocument(item.document), extractSummaryFromDocument(item.document)), "utf8");
    touchedItems.push({ id, title: metadata.title });
  }

  const manualTags = await readManualTags();
  await writeManualTags(manualTags.filter((tag) => !targetSet.has(tag)));
  await rebuildIndexes();

  return {
    deletedTags: targetTags,
    touchedItems,
    tags: await listTags()
  };
}

async function readManualTags() {
  const manualPath = path.join(indexesDir, "tags-manual.json");
  if (!(await exists(manualPath))) return [];
  try {
    const payload = JSON.parse(await fs.readFile(manualPath, "utf8"));
    return normalizeTags(Array.isArray(payload) ? payload : payload.tags || []);
  } catch {
    return [];
  }
}

async function writeManualTags(tags) {
  await fs.mkdir(indexesDir, { recursive: true });
  await fs.writeFile(path.join(indexesDir, "tags-manual.json"), `${JSON.stringify({ tags: normalizeTags(tags) }, null, 2)}\n`, "utf8");
}

async function rebuildIndexes() {
  await fs.mkdir(tagsDir, { recursive: true });
  await fs.mkdir(indexesDir, { recursive: true });

  const items = await listItems();
  const byTag = {};
  const bySource = {};

  for (const item of items) {
    bySource[item.sourceType] ||= [];
    bySource[item.sourceType].push(item.id);

    for (const tag of item.tags || []) {
      byTag[tag] ||= [];
      byTag[tag].push(item.id);
    }
  }

  await fs.writeFile(path.join(indexesDir, "by-tag.json"), `${JSON.stringify(byTag, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(indexesDir, "by-source.json"), `${JSON.stringify(bySource, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(indexesDir, "by-updated.json"), `${JSON.stringify(items.map((item) => item.id), null, 2)}\n`, "utf8");

  const existingTagFiles = await safeReaddir(tagsDir);
  for (const file of existingTagFiles) {
    if (file.endsWith(".json")) await fs.unlink(path.join(tagsDir, file));
  }
  for (const [tag, ids] of Object.entries(byTag)) {
    await fs.writeFile(path.join(tagsDir, `${slugify(tag)}.json`), `${JSON.stringify({ tag, items: ids }, null, 2)}\n`, "utf8");
  }
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
  const now = new Date();
  const dueJobs = [];
  for (const job of settings.refreshJobs || []) {
    if (!job.enabled || refreshRuntime.running.has(job.id)) continue;
    const dueAt = nextDueRefreshSlot(job, now, settings.refreshSchedule);
    if (dueAt) dueJobs.push(job);
  }
  if (!dueJobs.length) return;

  const result = await runRefreshJobsBatch(dueJobs);
  for (const entry of result.results || []) {
    if (entry.status === "failed") {
      console.error(`Scheduled refresh failed for ${entry.id}:`, entry.error || "unknown error");
    }
  }
  for (const entry of result.contentResults || []) {
    if (entry.status === "failed") {
      console.error(`Scheduled content refresh failed for ${entry.id}:`, entry.error || "unknown error");
    }
  }
}

function nextDueRefreshSlot(job, now = new Date(), schedule = {}) {
  const intervalMinutes = Math.max(5, Number(job.intervalMinutes) || 60);
  const start = parseTimeOfDay(schedule?.startTime || "08:00", "08:00");
  const end = parseTimeOfDay(schedule?.endTime || "20:00", "20:00");
  const startAt = new Date(now);
  startAt.setHours(start.hours, start.minutes, 0, 0);
  const endAt = new Date(now);
  endAt.setHours(end.hours, end.minutes, 0, 0);
  if (endAt < startAt) endAt.setDate(endAt.getDate() + 1);
  if (now < startAt || now > endAt) return null;

  const elapsedMinutes = Math.floor((now.getTime() - startAt.getTime()) / 60000);
  const slotIndex = Math.floor(elapsedMinutes / intervalMinutes);
  const dueAt = new Date(startAt.getTime() + slotIndex * intervalMinutes * 60000);
  if (dueAt > endAt) return null;
  const lastRunAt = job.lastRunAt ? new Date(job.lastRunAt) : null;
  if (lastRunAt && lastRunAt >= dueAt) return null;
  return dueAt;
}

function parseTimeOfDay(value, fallback) {
  const text = /^\d{1,2}:\d{2}$/.test(cleanText(value)) ? cleanText(value) : fallback;
  const [rawHours, rawMinutes] = text.split(":").map((part) => Number(part));
  return {
    hours: Math.min(23, Math.max(0, rawHours || 0)),
    minutes: Math.min(59, Math.max(0, rawMinutes || 0))
  };
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
    .filter((job) => !isInvalidTeamsRootRefreshJob(job));
  const groups = await buildRefreshGroups(runnableJobs, options);
  const results = [];
  const contentResults = [];
  const startedAt = new Date().toISOString();

  for (const group of groups) {
    let refreshContext = null;
    const refreshedUrls = new Set(group.jobs.map((job) => normalizeUrlForMatch(job.url)).filter(Boolean));
    try {
      refreshContext = await createRefreshGroupContext(group);
      for (const job of group.jobs) {
        try {
          const result = await runRefreshJob(job, { refreshContext });
          results.push({ id: job.id, status: result.status || "ok", result });
          rememberRefreshedContentUrls(refreshedUrls, result);
        } catch (error) {
          results.push({
            id: job.id,
            status: "failed",
            error: error.message || String(error)
          });
        }
      }
    } catch (error) {
      for (const job of group.jobs) {
        if (results.some((entry) => entry.id === job.id)) continue;
        await markRefreshJobFailed(job, error);
        results.push({
          id: job.id,
          status: "failed",
          error: error.message || String(error)
        });
      }
    } finally {
      await closeRefreshGroupContext(refreshContext);
    }
  }

  const aiProcessing = await processUpdatedItemsAfterRefresh(results);
  await annotateRefreshResultsWithAiProcessing(results, aiProcessing);
  const summary = summarizeRefreshBatch(results, startedAt, groups, contentResults, aiProcessing);
  await notifyRefreshBatchResult(summary);
  return summary;
}

async function markRefreshJobFailed(job, error) {
  const unreachable = isNetworkUnavailableForJob(job, error);
  const lastError = unreachable ? networkUnavailableMessage(job) : error.message || String(error);
  await updateRefreshJobState(job.id, {
    status: unreachable ? "unreachable" : "failed",
    lastRunAt: new Date().toISOString(),
    lastError
  });
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

async function createRefreshGroupContext(group) {
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
    windowMode: group.sourceType === "teams" ? "normal" : undefined
  });
  const page = await ensureSessionPage(session);
  session.page = page;

  if (group.sourceType === "teams") {
    await prepareTeamsRefreshGroup(page, adapter);
  }

  return {
    adapter,
    webdriverSession: session,
    webdriverPage: page,
    closeWhenDone: !session.manual
  };
}

async function prepareTeamsRefreshGroup(page, adapter) {
  const homeUrl = `https://${adapter.hostname}`;
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await resolveTeamsLauncher(page, homeUrl);
  try {
    await page.waitForLoadState("networkidle", { timeout: 8000 });
  } catch {
    // Teams may keep background requests open; a loaded shell is enough before opening each subscription link.
  }
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

async function processUpdatedItemsAfterRefresh(results) {
  const itemIds = await collectRefreshItemIdsNeedingAi(results);
  if (!itemIds.length) {
    return { requestedCount: 0, processedCount: 0, skippedCount: 0, errorCount: 0, processedItems: [], errors: [] };
  }
  if (!settings.ai?.baseUrl || !settings.ai?.apiKey || !settings.ai?.model) {
    return {
      requestedCount: itemIds.length,
      processedCount: 0,
      skippedCount: itemIds.length,
      errorCount: itemIds.length,
      processedItems: [],
      errors: itemIds.map((itemId) => ({ itemId, error: "AI 接口未配置，刷新内容已暂存，未显示 NEW。" }))
    };
  }

  const processedItems = [];
  const errors = [];
  for (const itemId of itemIds) {
    try {
      const item = await processItemWithAi(itemId);
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
      if (item.metadata.pendingContentUpdatedAt || item.metadata.processedStale) {
        itemIds.push(itemId);
      }
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
      newItemCount: aiProcessedCount,
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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function summarizeRefreshBatch(results, startedAt, groups, contentResults = [], aiProcessing = null) {
  const successful = results.filter((entry) => entry.status !== "failed" && entry.status !== "running");
  const failed = results.filter((entry) => entry.status === "failed");
  const running = results.filter((entry) => entry.status === "running");
  const successfulContent = contentResults.filter((entry) => entry.status !== "failed");
  const failedContent = contentResults.filter((entry) => entry.status === "failed");
  const updatedContent = successfulContent.filter((entry) => entry.updated);
  const aiProcessedCount = Number(aiProcessing?.processedCount || 0);
  const aiProcessErrorCount = Number(aiProcessing?.errorCount || 0);
  return {
    id: "batch-refresh",
    startedAt,
    finishedAt: new Date().toISOString(),
    groupCount: groups.length,
    jobCount: results.length,
    contentItemCount: contentResults.length,
    successCount: successful.length,
    runningCount: running.length,
    contentSuccessCount: successfulContent.length,
    failureCount: failed.length + failedContent.length,
    linkCount: successful.reduce((sum, entry) => sum + Number(entry.result?.linkCount ?? entry.result?.issueCount ?? 0), 0) + contentResults.length,
    updatedItemCount: successful.reduce((sum, entry) => sum + Number(entry.result?.updatedItemCount ?? entry.result?.updatedIssueCount ?? 0), 0) + updatedContent.length,
    newItemCount: aiProcessedCount,
    aiProcessedCount,
    aiProcessErrorCount,
    aiProcessing: aiProcessing || { requestedCount: 0, processedCount: 0, skippedCount: 0, errorCount: 0, processedItems: [], errors: [] },
    skippedItemCount: successful.reduce((sum, entry) => sum + Number(entry.result?.skippedItemCount || 0), 0) + (successfulContent.length - updatedContent.length),
    errorCount: failed.length + failedContent.length + successful.reduce((sum, entry) => sum + Number(entry.result?.errorCount || 0), 0),
    results,
    contentResults
  };
}

async function runRefreshJob(job, options = {}) {
  if (refreshRuntime.running.has(job.id)) {
    return { id: job.id, status: "running" };
  }

  refreshRuntime.running.add(job.id);
  const startedAt = new Date().toISOString();
  await updateRefreshJobState(job.id, {
    status: "running",
    lastStartedAt: startedAt,
    lastError: ""
  });

  try {
    const result = job.pageKind === "content"
      ? await refreshContentJob({ ...job, lastStartedAt: startedAt }, options.refreshContext)
      : await refreshListJob({ ...job, lastStartedAt: startedAt }, options.refreshContext);
    await updateRefreshJobState(job.id, {
      status: "idle",
      lastRunAt: new Date().toISOString(),
      lastResult: result,
      lastError: ""
    });
    return result;
  } catch (error) {
    const unreachable = isNetworkUnavailableForJob(job, error);
    const lastError = unreachable ? networkUnavailableMessage(job) : error.message || String(error);
    await updateRefreshJobState(job.id, {
      status: unreachable ? "unreachable" : "failed",
      lastRunAt: new Date().toISOString(),
      lastError
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

function sourceLabel(sourceType) {
  return {
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams",
    web: "网页",
    text: "文本"
  }[sourceType] || sourceType || "资料";
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
  const listUrl = listFetched.url || job.url;
  const tags = normalizeTags(job.tags || []);
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
    fetchMode: resolvedRefreshFetchMode(job, adapter)
  });

  const links = extractContentLinksFromList(listFetched.raw, listUrl, adapter)
    .slice(0, Math.max(1, Number(job.maxItems) || 50));
  const updatedItems = [];
  const skippedItems = [];
  const errors = [];

  for (const link of links) {
    const contentUrl = normalizeContentFetchUrl(link.href, adapter);
    try {
      const existing = await findItemByUrl(contentUrl);
      const listUpdatedAt = cleanText(link.updatedAt || link.updated || "");
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
      const contentFetched = await fetchForRefreshJob(contentUrl, { ...job, pageKind: "content" }, adapter, refreshContext);
      const contentItem = await upsertFetchedItem({
        title: contentFetched.title || link.title || link.key || contentUrl,
        sourceType: adapter.sourceType,
        url: contentFetched.url ? normalizeContentFetchUrl(contentFetched.url, adapter) : contentUrl,
        tags: normalizeTags(job.tags || []),
        raw: contentFetched.raw,
        text: contentFetched.text,
        comments: contentFetched.comments || [],
        sourceUpdatedAt: listUpdatedAt || contentFetched.sourceUpdatedAt,
        fetchedAt: new Date().toISOString(),
        pageKind: "content",
        fetchMode: resolvedRefreshFetchMode(job, adapter),
        managedBy: "subscription",
        parentUrl: listUrl
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

  await rebuildIndexes();
  return {
    id: job.id,
    sourceType: adapter.sourceType,
    listItemId: listItem.metadata.id,
    listUrl,
    linkCount: links.length,
    updatedItemCount: updatedItems.length,
    skippedItemCount: skippedItems.length,
    errorCount: errors.length,
    updatedItems,
    skippedItems,
    errors
  };
}

async function refreshContentJob(job, refreshContext = null) {
  const adapter = detectSourceAdapter(job.url);
  const fetchedAt = new Date().toISOString();
  const fetched = await fetchForRefreshJob(job.url, { ...job, pageKind: "content" }, adapter, refreshContext);
  const item = await upsertFetchedItem({
    title: fetched.title || job.name || job.url,
    sourceType: adapter.sourceType,
    url: fetched.url || job.url,
    tags: normalizeTags(job.tags || []),
    raw: fetched.raw,
    text: fetched.text,
    comments: fetched.comments || [],
    sourceUpdatedAt: fetched.sourceUpdatedAt || "",
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

async function refreshJiraFilterJob(job) {
  const adapter = detectSourceAdapter(job.url);
  if (adapter.sourceType !== "jira") {
    throw new Error("当前批量刷新任务先支持 Jira filter。");
  }

  const fetchedAt = new Date().toISOString();
  const listFetched = await fetchUrlWithWebdriver(job.url, { pageKind: "list" });
  const listUrl = listFetched.url || job.url;
  const tags = normalizeTags(job.tags || []);
  const listItem = await upsertFetchedItem({
    title: listFetched.title,
    sourceType: "jira",
    url: listUrl,
    tags,
    raw: listFetched.raw,
    text: listFetched.text,
    comments: [],
    fetchedAt,
    pageKind: "list",
    fetchMode: "webdriver"
  });

  const issues = extractJiraIssues(listFetched.raw, listUrl).slice(0, Math.max(1, Number(job.maxItems) || 50));
  const updatedIssues = [];
  const errors = [];

  for (const issue of issues) {
    try {
      const issueFetched = await fetchUrlWithWebdriver(issue.href, { pageKind: "content" });
      const issueItem = await upsertFetchedItem({
        title: issueFetched.title || `${issue.key} ${issue.summary || ""}`.trim(),
        sourceType: "jira",
        url: issueFetched.url || issue.href,
        tags: normalizeTags(job.tags || []),
        raw: issueFetched.raw,
        text: issueFetched.text,
        comments: issueFetched.comments || [],
        fetchedAt: new Date().toISOString(),
        pageKind: "content",
        fetchMode: "webdriver",
        managedBy: "subscription",
        parentUrl: listUrl
      });
      if (issueItem.refreshChanged) {
        updatedIssues.push({ key: issue.key, itemId: issueItem.metadata.id, url: issueItem.metadata.url });
      }
    } catch (error) {
      errors.push({ key: issue.key, url: issue.href, error: error.message || String(error) });
    }
  }

  await rebuildIndexes();
  return {
    id: job.id,
    listItemId: listItem.metadata.id,
    listUrl,
    issueCount: issues.length,
    updatedIssueCount: updatedIssues.length,
    errorCount: errors.length,
    updatedIssues,
    errors
  };
}

async function fetchForRefreshJob(url, job, adapter = detectSourceAdapter(url), refreshContext = null) {
  if (resolvedRefreshFetchMode(job, adapter) === "webdriver") {
    return fetchUrlWithWebdriver(url, {
      pageKind: job.pageKind || "auto",
      session: refreshContext?.webdriverSession,
      page: refreshContext?.webdriverPage
    });
  }
  return fetchUrl(url, { pageKind: job.pageKind || "auto" });
}

function resolvedRefreshFetchMode(job, adapter) {
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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
    await fs.rm(path.join(itemsDir, itemId), { recursive: true, force: true });
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
  const headers = {
    "User-Agent": "MaterialOrganizer/0.1",
    ...buildAuthHeaders(url)
  };
  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    throw new Error(`Could not fetch URL: ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  const extracted = extractByAdapter(raw, url, adapter, options.pageKind || "auto");
  return {
    raw,
    title: extracted.title || extractTitle(raw),
    text: extracted.text,
    comments: extracted.comments || [],
    sourceUpdatedAt: extracted.sourceUpdatedAt || "",
    url: response.url || url
  };
}

async function fetchUrlWithWebdriver(url, options = {}) {
  if (!url) throw new Error("URL is required.");
  const adapter = detectSourceAdapter(url);
  const session = options.session || await ensureWebdriverSession(adapter.hostname, url, {
    headed: Boolean(options.headed),
    autoClose: options.keepSession !== true,
    windowMode: adapter.sourceType === "teams" ? "normal" : undefined
  });
  try {
    const page = options.page && !options.page.isClosed()
      ? options.page
      : await ensureSessionPage(session);
    session.page = page;
    const navigationUrl = adapter.sourceType === "teams" ? normalizeTeamsNavigationUrl(url) : url;
    if (adapter.sourceType === "teams") {
      // Refresh batches reuse one page across multiple Teams conversations.
      // Navigating between two `https://teams.microsoft.com/v2/#/l/chat/...` URLs
      // is a same-document hash change, so the SPA switches conversations
      // asynchronously while the previous conversation's header and messages
      // linger in the DOM — causing titles and captured content to cross
      // between jobs. Reset to a blank document first so the target loads as a
      // fresh cross-document navigation, guaranteeing the header and messages
      // belong to the requested conversation.
      if (safeHostname(page.url()) === "teams.microsoft.com" || safeHostname(page.url()) === "teams.cloud.microsoft") {
        try {
          await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15000 });
        } catch {
          // Best-effort reset; the target navigation below still loads fresh.
        }
      }
    }
    await page.goto(navigationUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForJiraIssueNavigator(page, adapter, options.pageKind || "auto");
    await expandGithubDynamicContent(page, adapter, options.pageKind || "auto");
    if (adapter.sourceType === "teams") {
      return await fetchTeamsWithWebdriver(page, url, adapter);
    }
    const raw = await page.content();
    const currentUrl = page.url();
    const extractionUrl = resolvePageKind(url, options.pageKind || "auto") === "list" ? url : currentUrl || url;
    const extracted = extractByAdapter(raw, extractionUrl, adapter, options.pageKind || "auto");
    return {
      raw,
      title: extracted.title || await page.title(),
      text: extracted.text,
      comments: extracted.comments || [],
      sourceUpdatedAt: extracted.sourceUpdatedAt || "",
      url: currentUrl
    };
  } finally {
    if (!options.session && session.autoClose) {
      await closeWebdriverSession(session);
    }
  }
}

async function fetchTeamsWithWebdriver(page, url, adapter) {
  await resolveTeamsLauncher(page, url);
  await waitForTeamsConversation(page);
  const observedMessages = await scrollTeamsMessages(page, 18);
  const raw = await page.content();
  const currentUrl = page.url();
  const stableUrl = canonicalizeMaterialUrl(url) || currentUrl || url;
  const extracted = await extractTeamsFromPage(page, stableUrl, adapter, observedMessages);
  validateTeamsExtraction(extracted, stableUrl);
  return {
    raw,
    title: extracted.title || await page.title(),
    text: extracted.text,
    comments: extracted.comments || [],
    sourceUpdatedAt: extracted.sourceUpdatedAt || "",
    url: stableUrl
  };
}

function validateTeamsExtraction(extracted, url) {
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

async function resolveTeamsLauncher(page, originalUrl) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = page.url();
    const launchUrl = extractTeamsLaunchTarget(current) || extractTeamsLaunchTarget(originalUrl);
    if (launchUrl && safeHostname(current) !== "teams.microsoft.com") {
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);
      continue;
    }

    const clicked = await clickTeamsLauncherButton(page);
    if (!clicked) break;
    await page.waitForTimeout(2500);
  }
}

function extractTeamsLaunchTarget(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "teams.cloud.microsoft" && /^\/l\/(?:chat|channel)\//i.test(parsed.pathname)) {
      return "";
    }
    const target = parsed.searchParams.get("url") || parsed.searchParams.get("deeplink");
    if (!target) return "";
    const decoded = decodeURIComponent(target);
    if (/^\/_#\//.test(decoded) || /^\/l\/(?:chat|channel)\//i.test(decoded)) {
      return `https://teams.cloud.microsoft${decoded}`;
    }
    if (/^_#\//.test(decoded)) {
      return `https://teams.cloud.microsoft/${decoded}`;
    }
    if (/https:\/\/teams\.cloud\.microsoft\//i.test(decoded)) return decoded;
    if (/https:\/\/teams\.microsoft\.com\//i.test(decoded)) {
      return decoded.replace(/^https:\/\/teams\.microsoft\.com/i, "https://teams.cloud.microsoft");
    }
    return "";
  } catch {
    return "";
  }
}

function normalizeTeamsNavigationUrl(url) {
  const deepPath = extractTeamsDeepPath(url);
  if (!deepPath) return url;
  return `https://teams.microsoft.com/v2/#${deepPath}`;
}

function extractTeamsDeepPath(url) {
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

async function clickTeamsLauncherButton(page) {
  const labels = [
    "继续此浏览器",
    "在此浏览器中继续",
    "使用 Web 应用",
    "使用网页版",
    "加入对话",
    "打开 Teams",
    "Continue on this browser",
    "Use the web app",
    "Join conversation",
    "Open Teams",
    "Launch it now"
  ];
  for (const label of labels) {
    try {
      const locator = page.getByText(label, { exact: false }).first();
      if (await locator.count()) {
        await locator.click({ timeout: 3000 });
        return true;
      }
    } catch {
      // Try the next possible launcher label.
    }
  }
  return false;
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
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  return {
    hostname: adapter.hostname,
    authMode: "cookie",
    cookieCount: cookies.length,
    savedAt: new Date().toISOString()
  };
}

async function ensureWebdriverSession(hostname, url, options = {}) {
  const normalizedOptions = typeof options === "boolean" ? { headed: options } : options;
  const headed = Boolean(normalizedOptions.headed);
  const manual = Boolean(normalizedOptions.manual);
  const key = hostname || safeHostname(url) || "default";
  const profile = settings.sources?.[key] || {};
  const headless = headed ? false : Boolean(profile.webdriverHeadless);
  const autoClose = Boolean(normalizedOptions.autoClose && !manual);
  const windowMode = normalizeWebdriverWindowMode(normalizedOptions.windowMode || profile.webdriverWindowMode);
  const existing = webdriverSessions.get(key);
  if (existing) {
    if ((headed && existing.headless) || existing.windowMode !== windowMode) {
      await existing.context.close();
    } else {
      return existing;
    }
  }

  await fs.mkdir(webdriverRoot, { recursive: true });
  const userDataDir = path.join(webdriverRoot, slugify(key));
  const windowPlacement = webdriverWindowPlacement(windowMode, manual);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: windowPlacement.size,
    args: [
      "--disable-blink-features=AutomationControlled",
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
  webdriverSessions.set(key, session);
  context.on("close", () => webdriverSessions.delete(key));
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

function normalizeWebdriverWindowMode(value) {
  return ["normal", "compact", "minimized"].includes(value) ? value : "compact";
}

function webdriverWindowPlacement(mode, manual) {
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

async function expandGithubDynamicContent(page, adapter, pageKind) {
  if (adapter.sourceType !== "github") return;
  const kind = resolvePageKind(page.url(), pageKind || "auto");
  const shouldWaitForTimeline = kind !== "list" && /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(safePathname(page.url()));
  const shouldExpandLoadMore = adapter.hostname === "github.ecodesamsung.com" || shouldWaitForTimeline;
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

  let stableCount = 0;
  for (let index = 0; index < 30; index += 1) {
    const before = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      y: window.scrollY,
      comments: document.querySelectorAll("[id^='issuecomment-']").length,
      textLength: document.body?.innerText?.length || 0
    }));
    const clicked = await clickGithubLoadMore(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // Wait for the lazy-loaded page to arrive. GitHub's "Load more" fires a
    // GraphQL request; give it room, then settle on network idle.
    try {
      await page.waitForLoadState("networkidle", { timeout: 6000 });
    } catch {
      // GitHub keeps subscriptions open; fall back to a fixed settle delay.
    }
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      y: window.scrollY,
      comments: document.querySelectorAll("[id^='issuecomment-']").length,
      textLength: document.body?.innerText?.length || 0
    }));
    if (clicked) {
      stableCount = 0;
    } else if (after.comments <= before.comments
      && after.height <= before.height
      && after.y === before.y
      && after.textLength <= before.textLength) {
      stableCount += 1;
      if (stableCount >= 2) break;
    } else {
      stableCount = 0;
    }
  }
}

async function clickGithubLoadMore(page) {
  // GitHub's issue/PR timeline lazily loads older items behind a button such
  // as `data-testid="issue-timeline-load-more-load-top"` ("Load more"). A DOM
  // `.click()` from page.evaluate does not always trigger the React handler,
  // so prefer a real Playwright pointer click on the known testid first, then
  // fall back to a text-based match for other "load more" controls.
  const knownSelectors = [
    "[data-testid='issue-timeline-load-more-load-top']",
    "[data-testid^='issue-timeline-load-more']"
  ];
  for (const selector of knownSelectors) {
    try {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 1500 }).catch(() => false);
      if (!visible) continue;
      const disabled = await locator.isDisabled().catch(() => true)
        || await locator.getAttribute("aria-disabled") === "true";
      if (disabled) continue;
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      return true;
    } catch {
      // Button may have disappeared or be mid-render; try the next strategy.
    }
  }

  const clicked = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const loadMorePattern = /(?:show|load|view)\s+more|more\s+items|remaining\s+items|查看更多|加载更多/i;
    const candidates = [...document.querySelectorAll("button, a, [role='button']")]
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        const text = [
          el.innerText,
          el.textContent,
          el.getAttribute("aria-label"),
          el.getAttribute("title")
        ].map(clean).filter(Boolean).join(" ");
        return loadMorePattern.test(text);
      });
    const target = candidates.find((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.hasAttribute("disabled")
        && el.getAttribute("aria-disabled") !== "true"
        && style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    });
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  });
  if (clicked) {
    await page.waitForTimeout(1200);
  }
  return clicked;
}

async function waitForTeamsConversation(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {
    // Teams often keeps background requests open.
  }
  try {
    await page.waitForSelector([
      "[data-tid*='message']",
      "[role='main']",
      "[data-tid='chat-pane-list']",
      "[aria-label*='Message']",
      "[aria-label*='消息']"
    ].join(","), { timeout: 30000 });
  } catch {
    // Keep current DOM; extractor will produce a review note if no messages are visible.
  }
}

async function readVisibleTeamsMessages(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const pickTitle = () => {
      const selectors = [
        "[data-tid='channel-name']",
        "[data-tid='chat-title']",
        "[data-tid='conversation-header-title']",
        "h1",
        "[role='heading']"
      ];
      for (const selector of selectors) {
        const text = clean(document.querySelector(selector)?.textContent);
        if (text) return text;
      }
      return clean(document.title) || "Microsoft Teams conversation";
    };
    const messageSelectors = [
      "[data-tid='chat-pane-message']",
      "[data-tid='chat-pane-item']",
      "[data-tid='message-container']",
      "[data-tid*='message-item']",
      "[data-tid*='message'][role='listitem']",
      "[data-mid]",
      "[role='listitem'][aria-label*='message' i]",
      "[role='listitem'][aria-label*='消息']"
    ];
    const candidates = [...document.querySelectorAll(messageSelectors.join(","))]
      .filter((node) => node instanceof HTMLElement && clean(node.textContent).length > 8);
    const nodes = candidates.filter((node, index, list) => (
      list.findIndex((candidate) => candidate !== node && candidate.contains(node)) === -1
        && list.findIndex((candidate) => candidate === node || node.contains(candidate)) === index
    ));
    const fallbackNodes = nodes.length ? nodes : [...document.querySelectorAll("[role='listitem'], [data-tid*='messageBody'], [data-tid*='message-body']")]
      .filter((node) => node instanceof HTMLElement && clean(node.textContent).length > 12)
      .slice(-120);
    const messages = fallbackNodes.map((node, index) => {
      const author = clean(node.querySelector([
        "[data-tid*='author']",
        "[data-tid*='sender']",
        "[data-tid*='message-author']",
        "[class*='author']",
        "[class*='sender']"
      ].join(","))?.textContent)
        || clean(node.getAttribute("data-author"))
        || "";
      const time = node.querySelector("time")?.getAttribute("datetime")
        || node.querySelector("[datetime]")?.getAttribute("datetime")
        || clean(node.querySelector([
          "[data-tid*='timestamp']",
          "[class*='timestamp']",
          "[aria-label*='sent']",
          "[aria-label*='发送']"
        ].join(","))?.textContent)
        || "";
      const bodyNode = node.querySelector([
        "[data-tid='messageBodyContent']",
        "[data-tid*='messageBody']",
        "[data-tid*='message-body']",
        "[data-tid*='content']",
        "[class*='messageBody']",
        "[class*='message-body']"
      ].join(",")) || node;
      const text = clean(bodyNode.innerText || bodyNode.textContent);
      const links = [...node.querySelectorAll("a[href]")].map((link) => ({
        text: clean(link.textContent),
        href: link.href
      })).filter((link) => link.href);
      return {
        id: node.id || node.getAttribute("data-mid") || node.getAttribute("data-tid") || `teams-message-${index + 1}`,
        author,
        createdAt: time,
        body: text,
        links
      };
    }).filter((message) => message.body);
    return { title: pickTitle(), messages };
  });
}

function mergeTeamsMessages(messages) {
  const byKey = new Map();
  for (const message of messages) {
    const body = cleanText(message?.body || "");
    if (!body) continue;
    const createdAt = cleanText(message.createdAt || "");
    const key = `${createdAt}\n${body}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: cleanText(message.id || `teams-message-${byKey.size + 1}`),
        author: cleanText(message.author || ""),
        createdAt,
        body,
        links: Array.isArray(message.links) ? message.links : []
      });
    }
  }
  return [...byKey.values()];
}

function mergeTeamsComments(comments) {
  return mergeTeamsMessages(comments).map((comment, index) => ({
    id: cleanText(comment.id || `teams-message-${index + 1}`),
    author: cleanText(comment.author || ""),
    createdAt: cleanText(comment.createdAt || ""),
    body: cleanText(comment.body || ""),
    links: Array.isArray(comment.links) ? comment.links : [],
    url: cleanText(comment.url || "")
  }));
}

function renderTeamsTextFromComments(title, url, adapter, comments) {
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

async function scrollTeamsMessages(page, maxScrolls = 18) {
  const observed = [];
  const remember = async () => {
    const visible = await readVisibleTeamsMessages(page);
    observed.push(...(visible.messages || []));
  };

  await remember();
  try {
    const box = await page.locator("[data-tid='chat-pane-list'], [role='main'], main").first().boundingBox({ timeout: 3000 });
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  } catch {
    // Keyboard/mouse focus is best-effort; direct scroll fallback below still applies.
  }

  let stableRounds = 0;
  for (let index = 0; index < maxScrolls; index += 1) {
    const beforeCount = mergeTeamsMessages(observed).length;
    const moved = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll("[data-tid='chat-pane-list'], [role='main'], main, [data-tid*='chat'], [data-tid*='message'], div")]
        .filter((el) => el instanceof HTMLElement)
        .map((el) => ({
          el,
          score: (el.scrollHeight - el.clientHeight) * Math.max(1, el.getBoundingClientRect().height)
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const target = candidates[0]?.el;
      if (!target) return false;
      const before = target.scrollTop;
      target.scrollTop = Math.max(0, target.scrollTop - Math.max(420, Math.floor(target.clientHeight * 0.85)));
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
      return target.scrollTop !== before;
    });
    try {
      await page.mouse.wheel(0, -900);
    } catch {
      // Some environments do not allow wheel injection; direct scroll was already attempted.
    }
    await page.waitForTimeout(1200);
    await remember();
    const afterCount = mergeTeamsMessages(observed).length;
    stableRounds = moved || afterCount > beforeCount ? 0 : stableRounds + 1;
    if (stableRounds >= 3) break;
  }

  try {
    await page.mouse.wheel(0, 2400);
  } catch {
    // Returning near the latest messages is best-effort only.
  }
  await page.waitForTimeout(800);
  await remember();
  return mergeTeamsMessages(observed).slice(-240);
}

async function extractTeamsFromPage(page, url, adapter, observedMessages = []) {
  const visible = await readVisibleTeamsMessages(page);
  const data = {
    title: visible.title,
    messages: mergeTeamsMessages([...(observedMessages || []), ...(visible.messages || [])]).slice(-240)
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
    sourceUpdatedAt
  };
}

function detectSourceAdapter(url) {
  const hostname = safeHostname(url);
  if (hostname === "confluence.amlogic.com") return { id: "amlogic-confluence", sourceType: "confluence", hostname };
  if (hostname === "jira.amlogic.com") return { id: "amlogic-jira", sourceType: "jira", hostname };
  if (hostname === "roku.atlassian.net") return { id: "roku-jira", sourceType: "jira", hostname };
  if (hostname === "github.ecodesamsung.com") return { id: "ecodesamsung-github", sourceType: "github", hostname };
  if (hostname === "teams.microsoft.com" || hostname.endsWith(".teams.microsoft.com") || hostname === "teams.live.com" || hostname === "teams.cloud.microsoft") {
    return { id: "microsoft-teams", sourceType: "teams", hostname: "teams.microsoft.com" };
  }
  return { id: "generic-web", sourceType: "web", hostname };
}

function extractByAdapter(html, url, adapter, pageKind) {
  const kind = pageKind === "auto" ? inferPageKind(url, adapter) : pageKind;
  if (kind === "list") {
    return extractListPage(html, url, adapter);
  }

  return extractContentPage(html, url, adapter);
}

function inferPageKind(url, adapter) {
  const pathname = safePathname(url);
  const search = safeSearch(url);
  if (isKnownListUrl(url, adapter)) return "list";
  if (adapter.sourceType === "jira" && pathname === "/issues/" && /[?&]filter=\d+/i.test(search)) return "list";
  if (adapter.sourceType === "jira" && pathname === "/issues" && /[?&]filter=\d+/i.test(search)) return "list";
  if (adapter.sourceType === "jira" && /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(pathname)) return "content";
  if (adapter.sourceType === "github" && pathname === "/notifications") return "list";
  if (adapter.sourceType === "github" && /\/(issues|pull|discussions)\/\d+/i.test(pathname)) return "content";
  if (adapter.sourceType === "teams") return "content";
  if (adapter.sourceType === "confluence" && (/\/pages\/viewpage\.action/i.test(pathname) || /\/display\//i.test(pathname))) return "content";
  return "content";
}

function isKnownListUrl(url, adapter = detectSourceAdapter(url)) {
  const pathname = safePathname(url);
  const search = safeSearch(url);
  if (adapter.sourceType === "jira" && (pathname === "/issues/" || pathname === "/issues") && /[?&]filter=\d+/i.test(search)) return true;
  if (adapter.sourceType === "github" && pathname === "/notifications") return true;
  return false;
}

function extractListPage(html, url, adapter) {
  if (adapter.sourceType === "jira") {
    return extractJiraFilterPage(html, url, adapter);
  }
  if (adapter.sourceType === "github" && safePathname(url) === "/notifications") {
    return extractGithubNotificationsPage(html, url, adapter);
  }

  const seen = new Set();
  const links = extractLinks(html, url)
    .filter((link) => isLikelyContentLink(link.href, adapter))
    .filter((link) => dedupeByHref(link, seen))
    .slice(0, 100);
  const title = extractTitle(html) || `List from ${adapter.hostname}`;
  const lines = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    "",
    "## Links",
    "",
    ...links.map((link) => `- [${link.text || link.href}](${link.href})`)
  ];

  return {
    title,
    text: lines.join("\n"),
    comments: []
  };
}

function extractGithubNotificationsPage(html, url, adapter) {
  const title = extractTitle(html) || "GitHub Notifications";
  const query = extractGithubNotificationsQuery(html, url);
  const notifications = extractGithubNotifications(html, url);
  const counts = extractGithubNotificationsPagination(html);
  const lines = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    query ? `Query: ${query}` : "",
    counts ? `Count: ${counts}` : "",
    "",
    "## Notifications",
    "",
    ...(notifications.length
      ? notifications.map((item) => {
          const fields = [
            item.repository,
            item.number ? `#${item.number}` : "",
            item.status,
            item.updatedAt ? `updated: ${item.updatedAt}` : "",
            item.extraCount ? `related: ${item.extraCount}` : ""
          ].filter(Boolean).join(" · ");
          return `- [${item.title || item.href}](${item.href})${fields ? ` ${fields}` : ""}`;
        })
      : ["_No notifications captured._"])
  ].filter((line) => line !== "");

  return {
    title,
    text: lines.join("\n"),
    comments: []
  };
}

function extractGithubNotifications(html, baseUrl) {
  const items = [];
  const matches = [...String(html || "").matchAll(/<li\b[^>]*class=["'][^"']*notifications-list-item[^"']*["'][^>]*data-notification-id=["']([^"']+)["'][^>]*>/gi)];
  for (let index = 0; index < matches.length; index += 1) {
    const id = decodeHtml(matches[index][1] || "");
    const start = matches[index].index || 0;
    const end = matches[index + 1]?.index || html.indexOf("<div style=\"margin-right: auto\"", start);
    const block = html.slice(start, end === -1 ? html.length : end);
    const href = resolveHrefWithHash(decodeHtml(block.match(/<a\b[^>]*class=["'][^"']*notification-list-item-link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || ""), baseUrl);
    const repoAndNumber = cleanInlineText(block.match(/<p\b[^>]*class=["'][^"']*\bf6\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    const parsed = parseGithubRepoAndNumber(repoAndNumber, href);
    const title = cleanInlineText(block.match(/<p\b[^>]*class=["'][^"']*markdown-title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    const updatedAt = decodeHtml(block.match(/<relative-time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || "");
    const extraCount = cleanInlineText(block.match(/<span\b[^>]*class=["'][^"']*\bf6\b[^"']*["'][^>]*>\s*(\+\d+)\s*<\/span>/i)?.[1] || "");
    const status = /\bnotification-unread\b/i.test(block) ? "unread" : /\bnotification-read\b/i.test(block) ? "read" : "";
    if (!href && !title) continue;
    items.push({
      id,
      href,
      repository: parsed.repository,
      number: parsed.number,
      title,
      updatedAt,
      extraCount,
      status
    });
  }
  return items;
}

function extractContentLinksFromList(html, url, adapter) {
  if (adapter.sourceType === "jira") {
    return extractJiraIssues(html, url).map((issue) => ({
      key: issue.key,
      title: issue.summary || issue.key,
      href: issue.href,
      updatedAt: issue.updated || "",
      source: "jira-filter"
    }));
  }

  if (adapter.sourceType === "github" && safePathname(url) === "/notifications") {
    return extractGithubNotifications(html, url)
      .filter((item) => item.href && isLikelyContentLink(item.href, adapter))
      .map((item) => ({
        key: item.number ? `#${item.number}` : "",
        number: item.number,
        title: item.title,
        href: item.href,
        repository: item.repository,
        source: "github-notifications",
        notificationId: item.id,
        status: item.status,
        updatedAt: item.updatedAt
      }));
  }

  const seen = new Set();
  return extractLinks(html, url)
    .filter((link) => isLikelyContentLink(link.href, adapter))
    .filter((link) => dedupeByHref(link, seen))
    .map((link) => ({
      title: link.text,
      href: link.href,
      source: "generic-list"
    }));
}

function normalizeContentFetchUrl(url, adapter) {
  if (adapter.sourceType === "teams") return canonicalizeMaterialUrl(url);
  if (adapter.sourceType !== "github") return url;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.delete("notification_referrer_id");
    parsed.searchParams.delete("notifications_query");
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractGithubNotificationsQuery(html, url) {
  try {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("query");
    if (query) return query;
  } catch {
    // Fall through to the input value embedded in the page.
  }
  return decodeHtml(String(html || "").match(/<input\b[^>]*id=["']notifications-search-input["'][^>]*value=["']([^"']*)["'][^>]*>/i)?.[1] || "");
}

function extractGithubNotificationsPagination(html) {
  return cleanInlineText(String(html || "").match(/<div\b[^>]*class=["'][^"']*js-notifications-list-paginator-counts[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
}

function parseGithubRepoAndNumber(text, href) {
  const clean = cleanText(text);
  const textMatch = clean.match(/([^\s]+\/[^\s]+)\s+#(\d+)/);
  if (textMatch) return { repository: textMatch[1], number: textMatch[2] };
  const pathMatch = safePathname(href).match(/^\/([^/]+\/[^/]+)\/(?:issues|pull|discussions)\/(\d+)/i);
  if (pathMatch) return { repository: pathMatch[1], number: pathMatch[2] };
  return { repository: "", number: "" };
}

function extractJiraFilterPage(html, url, adapter) {
  const title = extractTitle(html) || `Jira Filter ${extractFilterId(url) || ""}`.trim();
  const remoteUser = extractMetaContent(html, "ajs-remote-user");
  const filterId = extractFilterId(url);
  const issues = extractJiraIssues(html, url);
  const isAnonymous = issues.length === 0 && (!remoteUser || /login-link|Log In|ajaxUnauthorised|not authorized/i.test(html));
  const lines = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    `Filter ID: ${filterId || "unknown"}`,
    `Login: ${isAnonymous ? "anonymous or not authenticated" : remoteUser}`,
    "",
    "## Issues",
    "",
    ...(issues.length
      ? issues.map((issue) => {
          const fields = [
            issue.summary,
            issue.status ? `status: ${issue.status}` : "",
            issue.assignee ? `assignee: ${issue.assignee}` : "",
            issue.updated ? `updated: ${issue.updated}` : ""
          ].filter(Boolean).join(" · ");
          return `- [${issue.key}](${issue.href})${fields ? ` ${fields}` : ""}`;
        })
      : [`_No issues extracted.${isAnonymous ? " This page appears to require login; configure Cookie in Settings and retry." : ""}_`])
  ];

  return {
    title,
    text: lines.join("\n"),
    comments: []
  };
}

function extractJiraIssues(html, baseUrl) {
  const issuesByKey = new Map();
  const rowPattern = /<tr\b[^>]*(?:data-issuekey|data-issue-key|rel)=["']?([A-Z][A-Z0-9]+-\d+)["']?[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html))) {
    const key = rowMatch[1];
    const rowHtml = rowMatch[2];
    issuesByKey.set(key, {
      key,
      href: resolveHref(`/browse/${key}`, baseUrl),
      summary: extractJiraCell(rowHtml, ["summary", "issue_summary", "description"]),
      status: extractJiraCell(rowHtml, ["status"]),
      assignee: extractJiraCell(rowHtml, ["assignee"]),
      updated: extractJiraCell(rowHtml, ["updated"])
    });
  }

  if (issuesByKey.size) {
    return [...issuesByKey.values()].slice(0, 200);
  }

  const links = extractLinks(html, baseUrl).filter((link) => /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(safePathname(link.href)));
  for (const link of links) {
    const key = link.href.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1];
    if (!key || issuesByKey.has(key)) continue;
    issuesByKey.set(key, {
      key,
      href: link.href,
      summary: link.text && link.text !== key ? link.text : ""
    });
  }

  return [...issuesByKey.values()].slice(0, 200);
}

function extractJiraCell(rowHtml, classNames) {
  for (const className of classNames) {
    const pattern = new RegExp(`<td\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, "i");
    const match = rowHtml.match(pattern);
    if (match) {
      return extractJiraDateValue(match[1]) || htmlToText(match[1]).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function extractJiraDateValue(html) {
  const datetime = decodeHtml(String(html || "").match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || "");
  if (datetime) return datetime;
  const title = decodeHtml(String(html || "").match(/<span\b[^>]*title=["']([^"']+)["'][^>]*>/i)?.[1] || "");
  if (title) return title;
  return "";
}

function extractFilterId(url) {
  try {
    return new URL(url).searchParams.get("filter") || "";
  } catch {
    return "";
  }
}

function extractPageId(url) {
  try {
    return new URL(url).searchParams.get("pageId") || "";
  } catch {
    return "";
  }
}

function extractMetaContent(html, name) {
  const pattern = new RegExp(`<meta\\\\b[^>]*(?:name|id)=["']${escapeRegExp(name)}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  return decodeHtml(html.match(pattern)?.[1] || "");
}

function extractContentPage(html, url, adapter) {
  if (adapter.sourceType === "jira" && /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(safePathname(url))) {
    return extractJiraIssuePage(html, url, adapter);
  }
  if (adapter.sourceType === "github" && /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(safePathname(url))) {
    return extractGithubIssuePage(html, url, adapter);
  }
  if (adapter.sourceType === "confluence") {
    return extractConfluencePage(html, url, adapter);
  }

  const title = extractTitle(html) || url;
  const mainHtml = pickMainHtml(html, adapter);
  const text = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    "",
    "## Extracted Content",
    "",
    htmlToText(mainHtml)
  ].join("\n").trim();

  return { title, text, comments: [] };
}

function extractConfluencePage(html, url, adapter) {
  const pageTitle = extractMetaContent(html, "ajs-page-title") || cleanInlineText(extractHtmlById(html, "title-text")) || extractTitle(html) || url;
  const spaceName = extractMetaContent(html, "ajs-space-name") || "";
  const pageId = extractMetaContent(html, "ajs-page-id") || extractPageId(url);
  const metadataHtml = extractConfluenceMetadataHtml(html);
  const metadataText = cleanInlineText(metadataHtml);
  const sourceUpdatedAt = extractConfluenceUpdatedAt(html, metadataHtml, metadataText);
  const contentHtml = extractConfluenceMainHtml(html);
  const body = confluenceHtmlToMarkdown(contentHtml, url) || "_No Confluence content captured._";
  const attachments = extractConfluenceAttachments(contentHtml, url);
  const links = extractLinks(contentHtml, url)
    .filter((link) => link.text || link.href)
    .filter((link, index, list) => list.findIndex((candidate) => candidate.href === link.href && candidate.text === link.text) === index)
    .slice(0, 80);
  const comments = extractConfluenceComments(html, url);
  const title = pageTitle;
  const lines = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    pageId ? `Page ID: ${pageId}` : "",
    spaceName ? `Space: ${spaceName}` : "",
    metadataText ? `Metadata: ${metadataText}` : "",
    "",
    "## Content",
    "",
    body,
    "",
    "## Attachments",
    "",
    ...(attachments.length
      ? attachments.map((attachment) => `- [${attachment.name}](${attachment.url})${attachment.type ? ` · ${attachment.type}` : ""}`)
      : ["_No attachments detected._"]),
    "",
    "## Links",
    "",
    ...(links.length
      ? links.map((link) => `- [${link.text || link.href}](${link.href})`)
      : ["_No links detected._"]),
    "",
    "## Comments",
    "",
    ...(comments.length
      ? comments.map((comment) => {
          const heading = [comment.author, comment.createdAt].filter(Boolean).join(" · ");
          return `### ${heading || `Comment ${comment.id}`}\n\n${comment.body || "_Empty comment._"}`;
        })
      : ["_No comments captured._"])
  ].filter((line) => line !== "");

  return {
    title,
    text: lines.join("\n"),
    comments,
    sourceUpdatedAt
  };
}

function extractConfluenceUpdatedAt(html, metadataHtml, metadataText) {
  const direct = decodeHtml(String(metadataHtml || html || "").match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || "");
  if (direct) return direct;
  const pageVersion = extractMetaContent(html, "ajs-page-version");
  if (pageVersion) return `version:${pageVersion}`;
  const text = cleanText(metadataText || "");
  const match = text.match(/\b(?:updated|modified|last changed)\b[:\s]*(.+)$/i);
  return cleanText(match?.[1] || "");
}

function extractGithubIssuePage(html, url, adapter) {
  const embedded = extractGithubEmbeddedData(html);
  const issue = embedded ? findGithubIssuePayload(embedded) : null;
  if (!issue) {
    return extractGithubIssuePageFromHtml(html, url, adapter);
  }

  const repository = findGithubRepositoryName(embedded, url);
  const number = issue.number || safePathname(url).match(/\/(issues|pull|discussions)\/(\d+)/i)?.[2] || "";
  const titleText = cleanText(issue.title || extractTitle(html) || url);
  const author = githubActorName(issue.author);
  const labels = extractGithubLabels(issue);
  const assignees = extractGithubAssignees(issue);
  const embeddedComments = extractGithubComments(issue);
  const htmlComments = extractGithubHtmlComments(html, url);
  const comments = htmlComments.length > embeddedComments.length ? htmlComments : embeddedComments;
  const events = extractGithubTimelineEvents(issue);
  const sourceUpdatedAt = latestTimestampValue([
    issue.updatedAt,
    ...comments.map((comment) => comment.createdAt),
    ...githubTimelineNodes(issue).map((node) => node.createdAt)
  ]) || issue.updatedAt || "";
  const body = cleanText(issue.body || htmlToText(issue.bodyHTML || "")) || "_No description captured._";
  const title = `${repository ? `${repository}#` : "#"}${number} ${titleText}`.trim();
  const fields = [
    repository ? `- Repository: ${repository}` : "",
    number ? `- Issue: #${number}` : "",
    issue.state ? `- State: ${issue.state}` : "",
    author ? `- Author: ${author}` : "",
    issue.createdAt ? `- Created: ${issue.createdAt}` : "",
    issue.updatedAt ? `- Updated: ${issue.updatedAt}` : "",
    labels.length ? `- Labels: ${labels.join(", ")}` : "",
    assignees.length ? `- Assignees: ${assignees.join(", ")}` : "",
    issue.url ? `- Canonical URL: ${issue.url}` : ""
  ].filter(Boolean);
  const timelineHasMore = Boolean(issue.frontTimelineItems?.pageInfo?.hasNextPage || issue.timelineItems?.pageInfo?.hasNextPage);
  const lines = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    "",
    "## Fields",
    "",
    ...(fields.length ? fields : ["_No fields captured._"]),
    "",
    "## Description",
    "",
    body,
    "",
    "## Comments",
    "",
    ...(comments.length
      ? comments.map((comment) => {
          const heading = [comment.author, comment.createdAt].filter(Boolean).join(" · ");
          return `### ${heading || `Comment ${comment.id}`}\n\n${comment.body || "_Empty comment._"}`;
        })
      : ["_No comments captured._"]),
    "",
    "## Timeline Events",
    "",
    ...(events.length ? events.map((event) => `- ${event}`) : ["_No timeline events captured._"]),
    timelineHasMore ? "\n_Note: GitHub indicated more timeline items are available beyond the preloaded page._" : ""
  ].filter((line) => line !== "");

  return {
    title,
    text: lines.join("\n"),
    comments,
    sourceUpdatedAt
  };
}

function extractGithubIssuePageFromHtml(html, url, adapter) {
  const title = extractTitle(html) || url;
  const comments = extractGithubHtmlComments(html, url);
  const mainHtml = pickMainHtml(html, adapter);
  const text = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    "",
    "## Extracted Content",
    "",
    htmlToText(mainHtml) || "_No GitHub content captured._",
    "",
    "## Comments",
    "",
    ...(comments.length
      ? comments.map((comment) => {
          const heading = [comment.author, comment.createdAt].filter(Boolean).join(" · ");
          return `### ${heading || `Comment ${comment.id}`}\n\n${comment.body || "_Empty comment._"}`;
        })
      : ["_No comments captured._"])
  ].join("\n").trim();

  return { title, text, comments };
}

function extractGithubEmbeddedData(html) {
  const match = String(html || "").match(/<script\b[^>]*data-target=["']react-app\.embeddedData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const jsonText = decodeHtml(match[1]).trim();
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function findGithubIssuePayload(value, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (
    (value.__typename === "Issue" || value.__typename === "PullRequest" || value.__typename === "Discussion")
    && value.number
    && value.title
  ) {
    return value;
  }

  if (value.repository?.issue && typeof value.repository.issue === "object") return value.repository.issue;
  if (value.repository?.pullRequest && typeof value.repository.pullRequest === "object") return value.repository.pullRequest;
  if (value.repository?.discussion && typeof value.repository.discussion === "object") return value.repository.discussion;

  for (const child of Object.values(value)) {
    if (!child || typeof child !== "object") continue;
    const found = Array.isArray(child)
      ? child.map((entry) => findGithubIssuePayload(entry, seen)).find(Boolean)
      : findGithubIssuePayload(child, seen);
    if (found) return found;
  }
  return null;
}

function findGithubRepositoryName(value, url, seen = new Set()) {
  if (value && typeof value === "object") {
    if (seen.has(value)) return "";
    seen.add(value);
    if (value.repository && typeof value.repository === "object") {
      const owner = value.repository.owner?.login || value.repository.owner?.name || "";
      const name = value.repository.name || "";
      if (owner && name) return `${owner}/${name}`;
      if (value.repository.nameWithOwner) return value.repository.nameWithOwner;
    }
    if (value.nameWithOwner) return value.nameWithOwner;
    for (const child of Object.values(value)) {
      if (!child || typeof child !== "object") continue;
      const found = Array.isArray(child)
        ? child.map((entry) => findGithubRepositoryName(entry, url, seen)).find(Boolean)
        : findGithubRepositoryName(child, url, seen);
      if (found) return found;
    }
  }
  const pathMatch = safePathname(url).match(/^\/([^/]+\/[^/]+)\//);
  return pathMatch?.[1] || "";
}

function extractGithubLabels(issue) {
  const labels = [];
  const nodes = issue.labels?.nodes || issue.labels?.edges?.map((edge) => edge.node) || [];
  for (const label of nodes) {
    const name = cleanText(label?.name || "");
    if (name && !labels.includes(name)) labels.push(name);
  }
  return labels;
}

function extractGithubAssignees(issue) {
  const actors = issue.assignees?.nodes || issue.assignedActors?.nodes || issue.assignees?.edges?.map((edge) => edge.node) || [];
  return uniqueClean(actors.map((actor) => githubActorName(actor)).filter(Boolean));
}

function extractGithubComments(issue) {
  return githubTimelineNodes(issue)
    .filter((node) => node?.__typename === "IssueComment" || node?.__typename === "PullRequestReviewComment")
    .map((node) => ({
      id: cleanText(node.databaseId || node.id || ""),
      author: githubActorName(node.author),
      createdAt: cleanText(node.createdAt || ""),
      body: cleanText(node.body || htmlToText(node.bodyHTML || "")),
      url: cleanText(node.url || "")
    }))
    .filter((comment) => comment.body || comment.author || comment.id);
}

function extractGithubTimelineEvents(issue) {
  return uniqueClean(githubTimelineNodes(issue)
    .map((node) => githubTimelineEventText(node))
    .filter(Boolean))
    .slice(0, 100);
}

function githubTimelineNodes(issue) {
  const collections = [
    issue.frontTimelineItems,
    issue.timelineItems,
    issue.backTimelineItems,
    issue.comments
  ].filter(Boolean);
  const nodes = [];
  for (const collection of collections) {
    if (Array.isArray(collection.nodes)) nodes.push(...collection.nodes);
    if (Array.isArray(collection.edges)) nodes.push(...collection.edges.map((edge) => edge.node));
  }
  return nodes.filter(Boolean);
}

function githubTimelineEventText(node) {
  if (!node || !node.__typename || node.__typename === "IssueComment" || node.__typename === "PullRequestReviewComment") return "";
  const actor = githubActorName(node.actor);
  const date = cleanText(node.createdAt || "");
  const prefix = [date, actor].filter(Boolean).join(" · ");
  const label = cleanText(node.label?.name || "");
  const assignee = githubActorName(node.assignee || node.user);
  const common = prefix ? `${prefix}: ` : "";
  if (node.__typename === "LabeledEvent" && label) return `${common}labeled ${label}`;
  if (node.__typename === "UnlabeledEvent" && label) return `${common}unlabeled ${label}`;
  if (node.__typename === "AssignedEvent" && assignee) return `${common}assigned ${assignee}`;
  if (node.__typename === "UnassignedEvent" && assignee) return `${common}unassigned ${assignee}`;
  if (node.__typename === "ClosedEvent") return `${common}closed`;
  if (node.__typename === "ReopenedEvent") return `${common}reopened`;
  if (node.__typename === "RenamedTitleEvent") return `${common}renamed title`;
  if (node.__typename === "ReferencedEvent" && node.commit?.oid) return `${common}referenced commit ${node.commit.oid}`;
  return `${common}${node.__typename}`;
}

function extractGithubHtmlComments(html, baseUrl) {
  const comments = [];
  const seen = new Set();
  const idMatches = [...String(html || "").matchAll(/\bid=["']issuecomment-(\d+)["']/gi)];
  for (let index = 0; index < idMatches.length; index += 1) {
    const match = idMatches[index];
    const id = cleanText(match[1] || "");
    if (!id || seen.has(id)) continue;
    const start = Math.max(0, match.index || 0);
    const end = idMatches[index + 1]?.index || html.length;
    const block = html.slice(start, end);
    const author = cleanInlineText(
      block.match(/data-testid=["']avatar-link["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]
      || block.match(/<a\b[^>]*class=["'][^"']*(?:author|Link--primary)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]
      || ""
    );
    const createdAt = decodeHtml(block.match(/<relative-time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || "");
    const bodyHtml = block.match(/<div\b[^>]*data-testid=["']markdown-body["'][^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>\s*<div\b[^>]*role=["']toolbar["']|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/i)?.[1]
      || block.match(/<td\b[^>]*class=["'][^"']*comment-body[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]
      || block.match(/<div\b[^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || "";
    const comment = {
      id,
      author,
      createdAt,
      body: htmlToText(bodyHtml),
      url: resolveHref(`#issuecomment-${id}`, baseUrl)
    };
    if (comment.body || comment.author) {
      seen.add(id);
      comments.push(comment);
    }
  }

  const pattern = /<div\b[^>]*(?:id=["']issuecomment-(\d+)["']|class=["'][^"']*js-comment-container[^"']*["'])[^>]*>([\s\S]*?)(?=<div\b[^>]*(?:id=["']issuecomment-\d+["']|class=["'][^"']*js-comment-container)|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const block = match[0] || "";
    const id = match[1] || cleanText(block.match(/\bid=["']issuecomment-(\d+)["']/i)?.[1] || "");
    if (id && seen.has(id)) continue;
    const author = cleanInlineText(block.match(/<a\b[^>]*class=["'][^"']*(?:author|Link--primary)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const createdAt = decodeHtml(block.match(/<relative-time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || "");
    const bodyHtml = block.match(/<td\b[^>]*class=["'][^"']*comment-body[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]
      || block.match(/<div\b[^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || "";
    const comment = {
      id,
      author,
      createdAt,
      body: htmlToText(bodyHtml),
      url: id ? resolveHref(`#issuecomment-${id}`, baseUrl) : ""
    };
    if (comment.body || comment.author) {
      if (id) seen.add(id);
      comments.push(comment);
    }
  }
  return comments;
}

function githubActorName(actor) {
  return cleanText(actor?.login || actor?.name || actor?.displayName || "");
}

function uniqueClean(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function extractConfluenceMainHtml(html) {
  const start = html.search(/<div\b[^>]*id=["']main-content["'][^>]*>/i);
  if (start === -1) return pickMainHtml(html, { sourceType: "confluence" });
  const afterStart = html.slice(start);
  const endMatch = afterStart.search(/<div\b[^>]*id=["'](?:labels-section|comments-section)["'][^>]*>/i);
  return endMatch === -1 ? afterStart : afterStart.slice(0, endMatch);
}

function extractConfluenceMetadataHtml(html) {
  const start = html.search(/<div\b[^>]*class=["'][^"']*page-metadata[^"']*["'][^>]*>/i);
  if (start === -1) return "";
  const afterStart = html.slice(start);
  const endMatch = afterStart.search(/<div\b[^>]*id=["']main-content["'][^>]*>/i);
  return endMatch === -1 ? afterStart.slice(0, 1600) : afterStart.slice(0, endMatch);
}

function confluenceHtmlToMarkdown(html, baseUrl) {
  let value = String(html || "");
  value = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<div\b[^>]*class=["'][^"']*codeContent[^"']*["'][^>]*>\s*<pre\b[^>]*>([\s\S]*?)<\/pre>\s*<\/div>/gi, (_, code) => `\n\n\`\`\`\n${htmlToText(code)}\n\`\`\`\n\n`)
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\n\`\`\`\n${htmlToText(code)}\n\`\`\`\n\n`)
    .replace(/<img\b([^>]*)>/gi, (_, attrs) => {
      const name = decodeHtml(attrs.match(/\bdata-linked-resource-default-alias=["']([^"']+)["']/i)?.[1] || attrs.match(/\balt=["']([^"']*)["']/i)?.[1] || "image");
      const src = decodeHtml(attrs.match(/\bdata-image-src=["']([^"']+)["']/i)?.[1] || attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "");
      const href = src ? resolveHref(src, baseUrl) : "";
      return href ? `\n[Image: ${name}](${href})\n` : `\n[Image: ${name}]\n`;
    })
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = htmlToText(label).replace(/\s+/g, " ").trim();
      const resolved = resolveHref(decodeHtml(href), baseUrl);
      return resolved ? `${text || resolved} (${resolved})` : text;
    })
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n# ${htmlToText(text)}\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n## ${htmlToText(text)}\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n### ${htmlToText(text)}\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n#### ${htmlToText(text)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${htmlToText(text).replace(/\n+/g, " ").trim()}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|table|tr|ul|ol)>/gi, "\n");

  return htmlToText(value)
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function extractConfluenceAttachments(html, baseUrl) {
  const attachments = new Map();
  const pattern = /<(?:a|img)\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = match[1] || "";
    const name = decodeHtml(attrs.match(/\bdata-linked-resource-default-alias=["']([^"']+)["']/i)?.[1] || "");
    if (!name) continue;
    const href = decodeHtml(attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] || attrs.match(/\bdata-image-src=["']([^"']+)["']/i)?.[1] || attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "");
    const url = resolveHref(href, baseUrl);
    attachments.set(name, {
      name,
      url,
      type: decodeHtml(attrs.match(/\bdata-linked-resource-content-type=["']([^"']+)["']/i)?.[1] || attrs.match(/\bdata-nice-type=["']([^"']+)["']/i)?.[1] || "")
    });
  }
  return [...attachments.values()].slice(0, 100);
}

function extractConfluenceComments(html, baseUrl) {
  const comments = [];
  const sectionStart = html.search(/<div\b[^>]*id=["']comments-section["'][^>]*>/i);
  if (sectionStart === -1) return comments;
  const section = html.slice(sectionStart);
  const blocks = [...section.matchAll(/<li\b[^>]*id=["']comment-(\d+)["'][^>]*>([\s\S]*?)(?=<li\b[^>]*id=["']comment-\d+["']|<\/ol>|<\/div>\s*<\/div>)/gi)];
  for (const block of blocks) {
    const id = block[1];
    const bodyHtml = block[2] || "";
    const author = cleanInlineText(bodyHtml.match(/<a\b[^>]*class=["'][^"']*confluence-userlink[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const createdAt = cleanInlineText(bodyHtml.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || bodyHtml.match(/<span\b[^>]*class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const content = bodyHtml.match(/<div\b[^>]*class=["'][^"']*comment-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || bodyHtml;
    const comment = {
      id,
      author,
      createdAt,
      body: confluenceHtmlToMarkdown(content, baseUrl),
      url: resolveHref(`#comment-${id}`, baseUrl)
    };
    if (comment.body || comment.author) comments.push(comment);
  }
  return comments;
}

function extractJiraIssuePage(html, url, adapter) {
  const key = cleanInlineText(extractHtmlById(html, "key-val")) || safePathname(url).match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1] || "";
  const summary = cleanInlineText(extractHtmlById(html, "summary-val")) || extractTitle(html) || key || url;
  const updatedHtml = extractHtmlById(html, "updated-val");
  const fields = {
    type: cleanInlineText(extractHtmlById(html, "type-val")),
    status: cleanInlineText(extractHtmlById(html, "status-val")),
    priority: cleanInlineText(extractHtmlById(html, "priority-val")),
    resolution: cleanInlineText(extractHtmlById(html, "resolution-val")),
    updated: extractJiraDateValue(updatedHtml),
    assignee: extractJiraPeopleField(html, "assignee-val"),
    reporter: extractJiraPeopleField(html, "reporter-val")
  };
  const descriptionHtml = extractJiraDescriptionHtml(html);
  const description = htmlToText(descriptionHtml) || "_No description captured._";
  const comments = extractJiraComments(html, url);
  const linkedIssues = extractJiraLinkedIssues(html, url);
  const title = key ? `${key} ${summary}` : summary;
  const fieldLines = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([name, value]) => `- ${capitalize(name)}: ${value}`);
  const lines = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    key ? `Issue: ${key}` : "",
    "",
    "## Fields",
    "",
    ...(fieldLines.length ? fieldLines : ["_No fields captured._"]),
    "",
    "## Description",
    "",
    description,
    "",
    "## Linked Issues",
    "",
    ...(linkedIssues.length
      ? linkedIssues.map((issue) => `- [${issue.key}](${issue.href})${issue.summary ? ` ${issue.summary}` : ""}${issue.status ? ` · status: ${issue.status}` : ""}`)
      : ["_No linked issues captured._"]),
    "",
    "## Comments",
    "",
    ...(comments.length
      ? comments.map((comment) => {
          const heading = [comment.author, comment.createdAt].filter(Boolean).join(" · ");
          return `### ${heading || `Comment ${comment.id}`}\n\n${comment.body || "_Empty comment._"}`;
        })
      : ["_No comments captured._"])
  ].filter((line) => line !== "");

  return {
    title,
    text: lines.join("\n"),
    comments,
    sourceUpdatedAt: fields.updated
  };
}

function extractJiraDescriptionHtml(html) {
  const start = html.search(/<div\b[^>]*id=["']description-val["'][^>]*>/i);
  if (start === -1) return "";
  const nextModule = html.slice(start).search(/<div\b[^>]*id=["'](?:dnd-metadata|attachmentmodule|linkingmodule|activitymodule)["'][^>]*>/i);
  const section = nextModule === -1 ? html.slice(start) : html.slice(start, start + nextModule);
  const contentBlock = section.match(/<div\b[^>]*class=["'][^"']*user-content-block[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (contentBlock) return contentBlock[1];
  return extractHtmlById(section, "description-val");
}

function extractJiraPeopleField(html, id) {
  const start = html.search(new RegExp(`<span\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*>`, "i"));
  if (start === -1) return "";
  const end = html.indexOf("</dd>", start);
  const section = html.slice(start, end === -1 ? start + 1800 : end);
  return cleanInlineText(section);
}

function extractJiraComments(html, baseUrl) {
  const comments = [];
  const matches = [...html.matchAll(/<div\b[^>]*id=["']comment-(\d+)["'][^>]*>/gi)];
  for (let index = 0; index < matches.length; index += 1) {
    const id = matches[index][1];
    const start = matches[index].index || 0;
    const end = matches[index + 1]?.index || html.indexOf("</div></div><div id=\"viewissuesidebar\"", start);
    const block = html.slice(start, end === -1 ? html.length : end);
    const verboseAuthor = block.match(new RegExp(`<a\\b[^>]*id=["']commentauthor_${escapeRegExp(id)}_verbose["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"));
    const conciseAuthor = block.match(new RegExp(`<a\\b[^>]*id=["']commentauthor_${escapeRegExp(id)}_concise["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"));
    const bodyMatch = block.match(/<div\b[^>]*class=["'][^"']*action-body flooded[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div\b[^>]*class=["'][^"']*twixi-wrap concise/i)
      || block.match(/<div\b[^>]*class=["'][^"']*action-body flooded[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const permalink = decodeHtml(block.match(/<a\b[^>]*href=["']([^"']*focusedCommentId=[^"']+)["'][^>]*>/i)?.[1] || `#comment-${id}`);
    const comment = {
      id,
      author: cleanInlineText(verboseAuthor?.[1] || conciseAuthor?.[1] || ""),
      createdAt: decodeHtml(block.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || ""),
      body: htmlToText(bodyMatch?.[1] || ""),
      url: resolveHref(permalink, baseUrl)
    };
    if (comment.body || comment.author) comments.push(comment);
  }
  return comments;
}

function extractJiraLinkedIssues(html, baseUrl) {
  const section = extractHtmlByClass(html, "links-container");
  if (!section) return [];
  const issues = new Map();
  const pattern = /<a\b[^>]*href=["']([^"']*\/browse\/([A-Z][A-Z0-9]+-\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,600}?)(?=<\/p>|<a\b|<\/dd>)/gi;
  let match;
  while ((match = pattern.exec(section))) {
    const key = match[2];
    if (issues.has(key)) continue;
    const nearby = match[4] || "";
    issues.set(key, {
      key,
      href: resolveHref(match[1], baseUrl),
      summary: cleanInlineText(nearby.match(/<span\b[^>]*class=["'][^"']*link-summary[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""),
      status: cleanInlineText(nearby.match(/<span\b[^>]*class=["'][^"']*jira-issue-status-lozenge[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "")
    });
  }
  return [...issues.values()].slice(0, 50);
}

function extractHtmlById(html, id) {
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return html.match(pattern)?.[2] || "";
}

function extractHtmlByClass(html, className) {
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return html.match(pattern)?.[2] || "";
}

function cleanInlineText(html) {
  return htmlToText(html).replace(/\s+/g, " ").trim();
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function pickMainHtml(html, adapter) {
  const candidates = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+id=["']main-content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*(issue-body-content|comment-body|markdown-body|ak-renderer-document|wiki-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];
  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (match) return match[1] || match[0];
  }
  return html;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = resolveHref(decodeHtml(match[1]), baseUrl);
    if (!href) continue;
    links.push({
      href,
      text: htmlToText(match[2]).replace(/\s+/g, " ").trim().slice(0, 160)
    });
  }
  return links;
}

function isLikelyContentLink(href, adapter) {
  const hostname = safeHostname(href);
  if (hostname && hostname !== adapter.hostname) return false;
  const pathname = safePathname(href);
  if (adapter.sourceType === "jira") return /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(pathname);
  if (adapter.sourceType === "github") return /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(pathname);
  if (adapter.sourceType === "confluence") return /\/(display|pages|spaces)\//i.test(pathname) || /pageId=\d+/i.test(href);
  return true;
}

function dedupeByHref(link, seen) {
  if (seen.has(link.href)) return false;
  seen.add(link.href);
  return true;
}

function resolveHref(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString().split("#")[0];
  } catch {
    return "";
  }
}

function resolveHrefWithHash(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function buildAuthHeaders(url) {
  const hostname = safeHostname(url);
  const profile = settings.sources?.[hostname];
  if (!profile || profile.authMode === "none") return {};
  if (profile.authMode === "cookie" && profile.cookie) {
    return { Cookie: profile.cookie };
  }
  if (profile.authMode === "bearer" && profile.token) {
    return { Authorization: `Bearer ${profile.token}` };
  }
  if (profile.authMode === "basic" && profile.username && profile.password) {
    return { Authorization: `Basic ${Buffer.from(`${profile.username}:${profile.password}`).toString("base64")}` };
  }
  return {};
}

function normalizeUrlForMatch(url) {
  const canonical = canonicalizeMaterialUrl(url);
  try {
    const parsed = new URL(canonical);
    parsed.hash = "";
    const adapter = detectSourceAdapter(canonical);
    if (adapter.sourceType === "teams") {
      parsed.search = "";
    }
    return parsed.toString();
  } catch {
    return cleanText(canonical);
  }
}

function isInvalidTeamsRootRefreshJob(job) {
  return isInvalidTeamsRootUrl(job?.url || "");
}

function isInvalidTeamsRootCapture(metadata) {
  return metadata?.sourceType === "teams" && isInvalidTeamsRootUrl(metadata.url || "");
}

function isInvalidTeamsRootUrl(url) {
  const value = cleanText(url);
  if (!value) return false;
  const adapter = detectSourceAdapter(value);
  if (adapter.sourceType !== "teams") return false;
  if (extractTeamsDeepPath(value)) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return (hostname === "teams.cloud.microsoft" || hostname === "teams.microsoft.com") && !pathname;
  } catch {
    return false;
  }
}

function canonicalizeMaterialUrl(url) {
  const value = cleanText(url);
  if (!value) return "";
  const adapter = detectSourceAdapter(value);
  if (adapter.sourceType !== "teams") return value;
  const deepPath = extractTeamsDeepPath(value);
  if (deepPath) return `https://teams.microsoft.com${deepPath}`;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.searchParams.delete("deeplinkId");
    parsed.searchParams.delete("directDl");
    parsed.searchParams.delete("msLaunch");
    parsed.searchParams.delete("enableMobilePage");
    return parsed.toString();
  } catch {
    return value;
  }
}

function isTruthyFilter(value) {
  return value === true || value === "1" || value === "true" || value === "yes";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderDocument(metadata, body, summary = "") {
  const tags = (metadata.tags || []).join(", ") || "none";
  const url = metadata.url || "local input";
  const refreshNote = metadata.refreshNote
    ? `\n## Latest Refresh\n\n- Previous length: ${metadata.refreshNote.previousDocumentLength}\n- Current length: ${metadata.refreshNote.currentDocumentLength}\n- Delta: ${metadata.refreshNote.lengthDelta}\n`
    : "";
  const summaryBlock = summary.trim() ? `\n## Summary\n\n${summary.trim()}\n` : "";

  return `# ${metadata.title}

## Metadata

- ID: ${metadata.id}
- Source: ${metadata.sourceType}
- URL: ${url}
- Tags: ${tags}
- Created: ${metadata.createdAt}
- Updated: ${metadata.updatedAt}
- Last fetched: ${metadata.lastFetchedAt || "not fetched"}
- Source updated: ${metadata.sourceUpdatedAt || "unknown"}
${refreshNote}
${summaryBlock}
## Content

${body.trim() || "_No content captured yet._"}
`;
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

function extractBodyFromDocument(document) {
  const marker = "\n## Content\n\n";
  const index = document.indexOf(marker);
  return index === -1 ? document : document.slice(index + marker.length);
}

function unwrapMarkdownFence(markdown) {
  const source = String(markdown || "").trim();
  const match = source.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : source;
}

function extractProcessedBodyFromDocument(document) {
  const marker = "\n## AI Organized Content\n\n";
  const index = document.indexOf(marker);
  return index === -1 ? document : document.slice(index + marker.length);
}

function extractSummaryFromDocument(document) {
  const startMarker = "\n## Summary\n\n";
  const endMarker = "\n## Content\n\n";
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return "";
  return document.slice(start + startMarker.length, end).trim();
}

function normalizeSourceType(sourceType, url) {
  if (sourceType) return sourceType;
  if (!url) return "text";
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("confluence.amlogic.com")) return "confluence";
  if (lowerUrl.includes("github.com")) return "github";
  if (lowerUrl.includes("github.ecodesamsung.com")) return "github";
  if (lowerUrl.includes("teams.microsoft.com") || lowerUrl.includes("teams.live.com") || lowerUrl.includes("teams.cloud.microsoft")) return "teams";
  if (lowerUrl.includes("jira") || lowerUrl.includes("/browse/")) return "jira";
  if (lowerUrl.includes("roku.atlassian.net")) return "jira";
  return "web";
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .map((comment) => ({
      id: cleanText(comment.id || ""),
      author: cleanText(comment.author || ""),
      createdAt: cleanText(comment.createdAt || ""),
      body: cleanText(comment.body || ""),
      url: cleanText(comment.url || "")
    }))
    .filter((comment) => comment.body || comment.author || comment.id);
}

function renderJsonLines(values) {
  const lines = normalizeComments(values).map((value) => JSON.stringify(value));
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function detectUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function shouldFetchForPreview(input, pasted) {
  if (input.fetchMode === "paste") return false;
  if (input.fetchMode === "fetch") return true;
  const trimmed = cleanText(pasted);
  return !trimmed || trimmed === detectUrl(trimmed);
}

function inferTitle(content) {
  const firstLine = cleanText(content)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : "";
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

async function uniqueItemId(base) {
  let id = base;
  let counter = 2;

  while (await exists(path.join(itemsDir, id))) {
    id = `${base}-${counter}`;
    counter += 1;
  }

  return id;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).trim() : "";
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

function decodeHtml(value) {
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
    "&nbsp;": " "
  };
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity] || entity);
}

function summarizeExcerpt(document) {
  return extractBodyFromDocument(document)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function sendJsonDownload(res, filename, payload) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`
  });
  res.end(content);
}

function startSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
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
    "Content-Type": contentTypes[ext] || "application/octet-stream"
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
}

function supplementalContextPath() {
  return path.join(kbDir, "SUPPLEMENTAL.md");
}

function supplementalEntriesPath() {
  return path.join(kbDir, "SUPPLEMENTAL.json");
}

async function readSupplementalContext() {
  return renderSupplementalMarkdown(await readSupplementalEntries(), { includePending: false });
}

async function saveSupplementalContext(content) {
  return saveSupplementalEntries(parseSupplementalMarkdown(content));
}

async function readSupplementalEntries() {
  const entriesPath = supplementalEntriesPath();
  if (await exists(entriesPath)) {
    try {
      const payload = JSON.parse(await fs.readFile(entriesPath, "utf8"));
      return normalizeSupplementalEntries(Array.isArray(payload) ? payload : payload.entries || []);
    } catch {
      return [];
    }
  }

  const markdownPath = supplementalContextPath();
  if (!(await exists(markdownPath))) return [];
  return normalizeSupplementalEntries(parseSupplementalMarkdown(await fs.readFile(markdownPath, "utf8")));
}

async function saveSupplementalEntries(entries) {
  const normalized = normalizeSupplementalEntries(entries);
  await fs.mkdir(kbDir, { recursive: true });
  await fs.writeFile(supplementalEntriesPath(), `${JSON.stringify({ entries: normalized }, null, 2)}\n`, "utf8");
  await fs.writeFile(supplementalContextPath(), renderSupplementalMarkdown(normalized, { includePending: true }), "utf8");
  return normalized;
}

function normalizeSupplementalEntries(entries) {
  const seen = new Set();
  return (entries || [])
    .map((entry, index) => {
      const term = cleanText(entry.term || entry.title || "");
      const category = cleanText(entry.category || "待确认") || "待确认";
      const reason = cleanText(entry.reason || entry.note || "");
      const explanation = cleanText(entry.explanation || entry.description || "");
      const id = cleanText(entry.id || slugId(term || reason || `entry-${index}`));
      return { id, term, category, reason, explanation };
    })
    .filter((entry) => entry.term || entry.reason || entry.explanation)
    .map((entry, index) => {
      const base = entry.id || slugId(entry.term || `entry-${index}`);
      let id = base;
      let counter = 2;
      while (seen.has(id)) {
        id = `${base}-${counter}`;
        counter += 1;
      }
      seen.add(id);
      return { ...entry, id };
    });
}

function parseSupplementalMarkdown(content) {
  const entries = [];
  let category = "待确认";
  for (const line of String(content || "").replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      category = heading[1].replace(/^已说明[:：]?|^待说明[:：]?/, "").trim() || "待确认";
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(?:\*\*)?([^:*：]+?)(?:\*\*)?\s*[:：]\s*(.+?)\s*$/);
    if (bullet) {
      const term = bullet[1].trim();
      const value = bullet[2].trim();
      const isPending = /待补充|需要补充|未定义|未明确|需确认|待确认/.test(value);
      entries.push({
        id: slugId(term),
        term,
        category,
        reason: isPending ? value : "",
        explanation: isPending ? "" : value
      });
    }
  }
  return entries;
}

function renderSupplementalMarkdown(entries, options = {}) {
  const includePending = options.includePending !== false;
  const normalized = normalizeSupplementalEntries(entries);
  const complete = normalized.filter((entry) => entry.explanation);
  const pending = normalized.filter((entry) => !entry.explanation);
  const groups = new Map();
  for (const entry of complete) {
    const group = entry.category || "补充说明";
    groups.set(group, [...(groups.get(group) || []), entry]);
  }

  const lines = [];
  for (const [category, groupEntries] of groups) {
    lines.push(`## ${category}`);
    for (const entry of groupEntries) {
      const reason = entry.reason ? `（${entry.reason}）` : "";
      lines.push(`- ${entry.term}: ${entry.explanation}${reason}`);
    }
    lines.push("");
  }

  if (includePending && pending.length) {
    lines.push("## 待说明");
    for (const entry of pending) {
      lines.push(`- ${entry.term || "未命名"}: ${entry.reason || "待补充"}`);
    }
    lines.push("");
  }

  return cleanTextBlock(lines.join("\n"));
}

function cleanTextBlock(content) {
  return String(content || "").replace(/\r\n/g, "\n").trim() + "\n";
}

async function supplementalPromptBlock() {
  const content = (await readSupplementalContext()).trim();
  if (!content) return "";
  return [
    "以下是用户维护的补充资料、缩写和项目背景。处理资料时必须优先参考，但不要把补充资料本身当作原文事实来源：",
    content.slice(0, 12000)
  ].join("\n\n");
}

async function suggestSupplementalContext(existingEntries = []) {
  if (!settings.ai?.baseUrl || !settings.ai?.apiKey || !settings.ai?.model) {
    throw new Error("请先在设置页配置 AI 接口后再分析补充资料。");
  }
  const existing = normalizeSupplementalEntries(existingEntries.length ? existingEntries : await readSupplementalEntries());
  const corpus = await buildSupplementalAnalysisCorpus();
  if (!corpus.trim()) throw new Error("当前资料库没有足够内容可分析。");
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.ai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "你是资料库术语分析助手。",
            "请从资料片段中找出可能需要用户补充解释的缩写、项目名、模块名、测试名、产品代号、组织内部词汇。",
            "不要重复已有候选项。",
            "不要编造确定含义，只说明为什么需要用户补充或确认。",
            "只返回 JSON，格式为 {\"entries\":[{\"term\":\"CI+\",\"category\":\"缩写\",\"reason\":\"多次出现但上下文不完整\",\"explanation\":\"\"}]}。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `已有候选项：${existing.map((entry) => entry.term).filter(Boolean).join(", ") || "none"}`,
            "",
            corpus
          ].join("\n")
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AI 分析补充资料失败：${response.status} ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const parsed = parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
  const existingTerms = new Set(existing.map((entry) => entry.term.toLowerCase()).filter(Boolean));
  return normalizeSupplementalEntries(parsed.entries || [])
    .filter((entry) => entry.term && !existingTerms.has(entry.term.toLowerCase()))
    .map((entry) => ({ ...entry, explanation: "" }))
    .slice(0, 40);
}

async function buildSupplementalAnalysisCorpus() {
  const dirs = await safeReaddir(itemsDir);
  const chunks = [];
  for (const id of dirs.slice(0, 80)) {
    const metadataPath = path.join(itemsDir, id, "metadata.json");
    const documentPath = path.join(itemsDir, id, "document.md");
    if (!(await exists(metadataPath)) || !(await exists(documentPath))) continue;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    if (metadata.pageKind === "list") continue;
    const document = await fs.readFile(documentPath, "utf8");
    chunks.push([
      `# ${metadata.title}`,
      `Source: ${metadata.sourceType}`,
      extractBodyFromDocument(document).slice(0, 1800)
    ].join("\n"));
    if (chunks.join("\n\n---\n\n").length > 60000) break;
  }
  return chunks.join("\n\n---\n\n");
}

async function loadSettings() {
  const defaults = defaultSettings();
  if (!(await exists(settingsPath))) {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    return defaults;
  }

  const saved = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  return mergeSettings(defaults, saved);
}

function exportFilename(prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.json`;
}

async function importSettingsBundle(payload) {
  const imported = payload?.settings || payload;
  if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
    throw new Error("设置导入文件格式不正确。");
  }
  const next = mergeSettings(defaultSettings(), imported);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function exportDataBundle() {
  await ensureKnowledgeBase();
  const files = await collectDataFiles(kbDir);
  return {
    type: "material-organizer-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    documentRootName: path.basename(kbDir),
    fileCount: files.length,
    files
  };
}

async function collectDataFiles(baseDir, relativeDir = "") {
  const dir = path.join(baseDir, relativeDir);
  const names = await safeReaddir(dir);
  const files = [];
  for (const name of names) {
    if (name === ".DS_Store") continue;
    const relativePath = relativeDir ? path.posix.join(relativeDir, name) : name;
    const absolutePath = path.join(baseDir, relativePath);
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      files.push(...await collectDataFiles(baseDir, relativePath));
      continue;
    }
    if (!stat.isFile()) continue;
    const content = await fs.readFile(absolutePath);
    files.push({
      path: relativePath.split(path.sep).join("/"),
      encoding: "base64",
      content: content.toString("base64")
    });
  }
  return files;
}

async function importDataBundle(bundle, options = {}) {
  if (!bundle || bundle.type !== "material-organizer-data" || !Array.isArray(bundle.files)) {
    throw new Error("数据导入文件格式不正确。");
  }

  const mode = options.mode === "replace" ? "replace" : "merge";
  await fs.mkdir(path.dirname(kbDir), { recursive: true });
  let backupPath = "";
  if (mode === "replace" && await exists(kbDir)) {
    backupPath = `${kbDir}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await fs.rename(kbDir, backupPath);
  }
  await fs.mkdir(kbDir, { recursive: true });

  let writtenFileCount = 0;
  for (const file of bundle.files) {
    const relativePath = validateDataBundlePath(file.path);
    const targetPath = path.join(kbDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const content = Buffer.from(String(file.content || ""), file.encoding === "utf8" ? "utf8" : "base64");
    await fs.writeFile(targetPath, content);
    writtenFileCount += 1;
  }

  await ensureKnowledgeBase();
  await rebuildIndexes();
  return {
    ok: true,
    mode,
    backupPath,
    writtenFileCount
  };
}

function validateDataBundlePath(value) {
  const relativePath = String(value || "").replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error(`非法数据文件路径：${value}`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`非法数据文件路径：${value}`);
  }
  return normalized;
}

async function saveSettings(input) {
  const next = mergeSettings(settings, {
    ai: {
      baseUrl: cleanText(input.ai?.baseUrl ?? input.baseUrl ?? settings.ai.baseUrl),
      apiKey: cleanText(input.ai?.apiKey ?? input.apiKey ?? settings.ai.apiKey),
      model: cleanText(input.ai?.model ?? input.model ?? settings.ai.model)
    },
    embedding: {
      enabled: Boolean(input.embedding?.enabled ?? settings.embedding?.enabled ?? false),
      baseUrl: cleanText(input.embedding?.baseUrl ?? settings.embedding?.baseUrl ?? ""),
      apiKey: cleanText(input.embedding?.apiKey ?? settings.embedding?.apiKey ?? ""),
      model: cleanText(input.embedding?.model ?? settings.embedding?.model ?? ""),
      dimensions: Number(input.embedding?.dimensions || settings.embedding?.dimensions || 0)
    },
    chat: {
      showThinking: Boolean(input.chat?.showThinking ?? settings.chat?.showThinking ?? true),
      showToolCalls: Boolean(input.chat?.showToolCalls ?? settings.chat?.showToolCalls ?? true)
    },
    notifications: normalizeNotificationSettings(input.notifications || settings.notifications || {}),
    refreshSchedule: normalizeRefreshSchedule(input.refreshSchedule || settings.refreshSchedule || {}),
    processingPrompts: normalizeProcessingPrompts(input.processingPrompts || settings.processingPrompts || {}),
    documentRoot: cleanText(input.documentRoot ?? settings.documentRoot),
    sources: mergeSourceProfiles(settings.sources, input.sources || {}),
    refreshJobs: mergeRefreshJobs(settings.refreshJobs || [], input.refreshJobs || settings.refreshJobs || [])
  });

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function defaultSettings() {
  return {
    documentRoot: path.join(rootDir, "knowledge-base"),
    ai: {
      baseUrl: "",
      apiKey: "",
      model: "gpt-4.1-mini"
    },
    embedding: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      model: "Qwen/Qwen3-Embedding-0.6B",
      dimensions: 1024
    },
    chat: {
      showThinking: true,
      showToolCalls: true
    },
    notifications: defaultNotificationSettings(),
    refreshSchedule: defaultRefreshSchedule(),
    processingPrompts: defaultProcessingPrompts(),
    sources: {
      "confluence.amlogic.com": defaultSourceProfile("confluence.amlogic.com", "confluence"),
      "jira.amlogic.com": defaultSourceProfile("jira.amlogic.com", "jira"),
      "roku.atlassian.net": defaultSourceProfile("roku.atlassian.net", "jira"),
      "github.ecodesamsung.com": defaultSourceProfile("github.ecodesamsung.com", "github"),
      "teams.microsoft.com": defaultSourceProfile("teams.microsoft.com", "teams")
    },
    refreshJobs: [
      defaultRefreshJob("jira-amlogic-filter-50724", "Amlogic Jira Filter 50724", "https://jira.amlogic.com/issues/?filter=50724")
    ]
  };
}

function mergeSettings(base, patch) {
  return {
    ...base,
    ...patch,
    ai: {
      ...base.ai,
      ...(patch.ai || {})
    },
    embedding: {
      ...base.embedding,
      ...(patch.embedding || {})
    },
    chat: {
      ...base.chat,
      ...(patch.chat || {})
    },
    notifications: normalizeNotificationSettings({
      ...(base.notifications || {}),
      ...(patch.notifications || {})
    }),
    refreshSchedule: normalizeRefreshSchedule({
      ...(base.refreshSchedule || {}),
      ...(patch.refreshSchedule || {})
    }),
    processingPrompts: normalizeProcessingPrompts({
      ...(base.processingPrompts || {}),
      ...(patch.processingPrompts || {})
    }),
    sources: mergeSourceProfiles(base.sources || {}, patch.sources || {}),
    refreshJobs: mergeRefreshJobs(base.refreshJobs || [], patch.refreshJobs || [])
  };
}

function publicSettings() {
  return {
    documentRoot: settings.documentRoot,
    activeDocumentRoot: kbDir,
    ai: {
      baseUrl: settings.ai.baseUrl,
      apiKey: settings.ai.apiKey ? "********" : "",
      model: settings.ai.model
    },
    embedding: {
      enabled: Boolean(settings.embedding?.enabled),
      baseUrl: settings.embedding?.baseUrl || "",
      apiKey: settings.embedding?.apiKey ? "********" : "",
      model: settings.embedding?.model || "",
      dimensions: Number(settings.embedding?.dimensions || 0)
    },
    chat: {
      showThinking: settings.chat?.showThinking !== false,
      showToolCalls: settings.chat?.showToolCalls !== false
    },
    notifications: normalizeNotificationSettings(settings.notifications || {}),
    refreshSchedule: normalizeRefreshSchedule(settings.refreshSchedule || {}),
    processingPrompts: normalizeProcessingPrompts(settings.processingPrompts || {}),
    sources: publicSourceProfiles(),
    refreshJobs: publicRefreshJobs()
  };
}

function defaultNotificationSettings() {
  return {
    enabled: true,
    sources: {
      confluence: true,
      jira: true,
      github: true,
      teams: true,
      web: false,
      text: false
    }
  };
}

function defaultRefreshSchedule() {
  return {
    startTime: "08:00",
    endTime: "20:00"
  };
}

function normalizeRefreshSchedule(input = {}) {
  const defaults = defaultRefreshSchedule();
  return {
    startTime: formatTimeOfDay(input.startTime || defaults.startTime, defaults.startTime),
    endTime: formatTimeOfDay(input.endTime || defaults.endTime, defaults.endTime)
  };
}

function formatTimeOfDay(value, fallback) {
  const parsed = parseTimeOfDay(value, fallback);
  return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}

function normalizeNotificationSettings(input = {}) {
  const defaults = defaultNotificationSettings();
  const sourceTypes = Object.keys(defaults.sources);
  return {
    enabled: input.enabled !== false,
    sources: Object.fromEntries(sourceTypes.map((sourceType) => [
      sourceType,
      input.sources?.[sourceType] ?? defaults.sources[sourceType]
    ]).map(([sourceType, enabled]) => [sourceType, Boolean(enabled)]))
  };
}

function defaultProcessingPrompts() {
  return {
    text: [
      "你是文本资料整理助手。",
      "请把输入内容整理成可检索、可复用的知识条目。",
      "重点提取主题、关键事实、术语、结论、待确认问题和后续动作。"
    ].join("\n"),
    web: [
      "你是网页资料整理助手。",
      "请过滤导航、页脚、广告和重复内容，保留正文信息。",
      "整理为：一句话结论、关键内容、重要链接/引用、可能需要后续追踪的点。"
    ].join("\n"),
    confluence: [
      "你是 Confluence 文档整理助手。",
      "请提取页面目的、背景、方案/规则、关键步骤、配置项、风险点和待办。",
      "如果内容像需求或设计文档，请按模块和决策点整理。"
    ].join("\n"),
    jira: [
      "你是 Jira 问题进展整理助手。",
      "请重点提取：问题概述、当前状态、负责人/相关人、复现条件、关键进展、阻塞点、评论结论、下一步动作。",
      "评论很多时不要逐条复述，只保留推动问题状态变化的信息。"
    ].join("\n"),
    github: [
      "你是 GitHub issue/PR 讨论整理助手。",
      "请提取问题背景、讨论结论、代码/方案变化、review 关注点、未解决分歧、下一步动作。",
      "对通知列表或多条 issue，请按条目归纳高优先级事项。"
    ].join("\n"),
    teams: [
      "你是 Teams 对话整理助手。",
      "请从聊天记录中提取真正有用的信息：结论、决策、问题、行动项、负责人、时间点和待确认事项。",
      "不要流水账复述寒暄；如果对话只是沟通背景，请压缩成简短背景说明。"
    ].join("\n")
  };
}

function normalizeProcessingPrompts(prompts) {
  const defaults = defaultProcessingPrompts();
  const sourceTypes = ["text", "web", "confluence", "jira", "github", "teams"];
  return Object.fromEntries(sourceTypes.map((sourceType) => [
    sourceType,
    cleanText(prompts?.[sourceType] || defaults[sourceType])
  ]));
}

function resolveProcessingPrompt(sourceType) {
  const prompts = normalizeProcessingPrompts(settings.processingPrompts || {});
  return prompts[sourceType] || prompts.web || defaultProcessingPrompts().web;
}

function defaultRefreshJob(id, name, url) {
  return {
    id,
    name,
    url,
    enabled: false,
    intervalMinutes: 60,
    maxItems: 50,
    tags: [],
    fetchMode: "webdriver",
    pageKind: "list",
    status: "idle",
    lastRunAt: "",
    lastStartedAt: "",
    lastError: "",
    lastResult: null
  };
}

function mergeRefreshJobs(base = [], patch = []) {
  const next = new Map();
  for (const job of base) {
    if (job?.id) next.set(job.id, normalizeRefreshJob(job, job));
  }
  for (const job of patch) {
    if (!job?.id && !job?.url) continue;
    const id = cleanText(job.id || slugify(job.url));
    const previous = next.get(id) || defaultRefreshJob(id, cleanText(job.name || id), cleanText(job.url || ""));
    next.set(id, normalizeRefreshJob(job, previous));
  }
  return [...next.values()];
}

function normalizeRefreshJob(input, previous = {}) {
  const id = cleanText(input.id || previous.id || slugify(input.url || previous.url || "refresh-job"));
  return {
    ...previous,
    id,
    name: cleanText(input.name ?? previous.name ?? id),
    url: cleanText(input.url ?? previous.url ?? ""),
    enabled: Boolean(input.enabled),
    intervalMinutes: Math.max(5, Number(input.intervalMinutes ?? previous.intervalMinutes ?? 60) || 60),
    maxItems: Math.max(1, Number(input.maxItems ?? previous.maxItems ?? 50) || 50),
    tags: normalizeTags(input.tags ?? previous.tags ?? []),
    fetchMode: cleanText(input.fetchMode ?? previous.fetchMode ?? "webdriver"),
    pageKind: cleanText(input.pageKind ?? previous.pageKind ?? "list"),
    managedBy: cleanText(input.managedBy ?? previous.managedBy ?? ""),
    status: cleanText(input.status ?? previous.status ?? "idle"),
    lastRunAt: cleanText(input.lastRunAt ?? previous.lastRunAt ?? ""),
    lastStartedAt: cleanText(input.lastStartedAt ?? previous.lastStartedAt ?? ""),
    lastError: cleanText(input.lastError ?? previous.lastError ?? ""),
    lastResult: input.lastResult ?? previous.lastResult ?? null
  };
}

function publicRefreshJobs() {
  return (settings.refreshJobs || [])
    .filter((job) => !isInvalidTeamsRootRefreshJob(job))
    .map((job) => ({
      ...job,
      running: refreshRuntime.running.has(job.id)
    }));
}

function defaultSourceProfile(hostname, sourceType) {
  return {
    hostname,
    sourceType,
    authMode: "none",
    username: "",
    password: "",
    cookie: "",
    token: "",
    webdriverHeadless: false,
    webdriverWindowMode: "compact"
  };
}

function mergeSourceProfiles(base = {}, patch = {}) {
  const next = { ...base };
  for (const [hostname, profile] of Object.entries(patch)) {
    const previous = next[hostname] || defaultSourceProfile(hostname, "web");
    next[hostname] = {
      ...previous,
      ...profile,
      hostname,
      webdriverHeadless: Boolean(profile.webdriverHeadless ?? previous.webdriverHeadless),
      webdriverWindowMode: normalizeWebdriverWindowMode(profile.webdriverWindowMode ?? previous.webdriverWindowMode),
      password: profile.password === "********" ? previous.password : cleanText(profile.password ?? previous.password),
      cookie: profile.cookie === "********" ? previous.cookie : cleanText(profile.cookie ?? previous.cookie),
      token: profile.token === "********" ? previous.token : cleanText(profile.token ?? previous.token)
    };
  }
  return next;
}

function publicSourceProfiles() {
  return Object.fromEntries(Object.entries(settings.sources || {}).map(([hostname, profile]) => [
    hostname,
    {
      ...profile,
      password: profile.password ? "********" : "",
      cookie: profile.cookie ? "********" : "",
      token: profile.token ? "********" : ""
    }
  ]));
}

function resolveDocumentRoot(documentRoot) {
  const configured = cleanText(documentRoot);
  return configured ? path.resolve(configured) : path.join(rootDir, "knowledge-base");
}

function configureKnowledgeBase() {
  kbDir = resolveDocumentRoot(settings.documentRoot);
  itemsDir = path.join(kbDir, "items");
  tagsDir = path.join(kbDir, "tags");
  indexesDir = path.join(kbDir, "indexes");
}

function buildLocalSummary(content) {
  const lines = cleanText(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLines = lines.slice(0, 5).join("\n");
  const commentLines = lines.filter((line) => /comment|评论|讨论|回复|alice|bob/i.test(line)).slice(0, 5);
  const statusLines = lines.filter((line) => /状态|进展|blocked|blocker|todo|action|下一步|待办/i.test(line)).slice(0, 5);

  return [
    "### 摘要",
    firstLines || content.slice(0, 600),
    "",
    "### 可能的进展/状态",
    statusLines.length ? statusLines.map((line) => `- ${line}`).join("\n") : "- 未从文本中识别到明确状态。",
    "",
    "### 可能的评论/讨论",
    commentLines.length ? commentLines.map((line) => `- ${line}`).join("\n") : "- 未从文本中识别到明确评论。"
  ].join("\n");
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

async function readJsonLines(filePath) {
  if (!(await exists(filePath))) return [];
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function safeReaddir(dir) {
  if (!(await exists(dir))) return [];
  return fs.readdir(dir);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
