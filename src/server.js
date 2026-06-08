import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

const port = Number(process.env.PORT || 5173);

await ensureKnowledgeBase();
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

  if (req.method === "PATCH" && url.pathname.endsWith("/tags")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const body = await readBody(req);
    const item = await updateTags(id, body.tags || []);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/recommend-tags")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const recommendations = await recommendTagsForItem(id);
    sendJson(res, 200, recommendations);
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

  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, { settings: publicSettings() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/source-profiles") {
    sendJson(res, 200, { profiles: publicSourceProfiles() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/refresh-jobs") {
    sendJson(res, 200, { jobs: publicRefreshJobs() });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/refresh-jobs/") && url.pathname.endsWith("/run")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const result = await runRefreshJobById(id, { force: true });
    sendJson(res, 200, { result, jobs: publicRefreshJobs() });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    settings = await saveSettings(body);
    configureKnowledgeBase();
    await ensureKnowledgeBase();
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
  const sourceType = normalizeSourceType(input.sourceType, input.url);
  const tags = normalizeTags(input.tags);
  let title = cleanText(input.title || "");
  let rawContent = cleanText(input.rawContent || input.content || "");
  let extractedContent = cleanText(input.extractedContent || input.content || rawContent);
  let rawFileName = input.rawFileName || "raw.txt";
  let lastFetchedAt = input.lastFetchedAt || null;
  let sourceUpdatedAt = cleanText(input.sourceUpdatedAt || "");
  const summary = cleanText(input.summary || "");
  let comments = normalizeComments(input.comments);

  if (!rawContent && input.url && (sourceType === "web" || sourceType === "jira" || sourceType === "github" || sourceType === "confluence")) {
    const fetched = await fetchUrl(input.url);
    rawContent = fetched.raw;
    extractedContent = fetched.text;
    rawFileName = "raw.html";
    title = title || fetched.title || input.url;
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
    url: input.url || null,
    tags,
    createdAt: now,
    updatedAt: now,
    lastFetchedAt,
    sourceUpdatedAt,
    rawFileName,
    pageKind: input.pageKind || null,
    fetchMode: input.fetchMode || null,
    parentUrl: input.parentUrl || null
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
  }
  await rebuildIndexes();

  return readItem(id);
}

async function previewSource(input) {
  const now = new Date().toISOString();
  const pasted = cleanText(input.content || "");
  const detectedUrl = cleanText(input.url || detectUrl(pasted));
  const existingItem = detectedUrl ? await findItemByUrl(detectedUrl) : null;
  const sourceType = normalizeSourceType(input.sourceType, detectedUrl);
  let title = cleanText(input.title || "");
  let rawContent = pasted;
  let extractedContent = pasted;
  let rawFileName = "raw.txt";
  let lastFetchedAt = null;
  let parseStatus = "ready";
  let parseNote = "文本内容已读取，确认后即可导入。";
  let linkedItems = [];
  let refreshJob = null;

  if (detectedUrl && shouldFetchForPreview(input, pasted)) {
    try {
      const fetched = input.fetchMode === "webdriver"
        ? await fetchUrlWithWebdriver(detectedUrl, { pageKind: input.pageKind || "auto" })
        : await fetchUrl(detectedUrl, { pageKind: input.pageKind || "auto" });
      title = title || fetched.title || detectedUrl;
      rawContent = fetched.raw;
      extractedContent = fetched.text;
      rawFileName = "raw.html";
      lastFetchedAt = now;
      input.sourceUpdatedAt = fetched.sourceUpdatedAt || "";
      input.comments = fetched.comments || [];
      parseNote = "网页内容已抓取并过滤为可读文本。";
      linkedItems = extractPreviewLinkedItems(rawContent, detectedUrl, sourceType, input.pageKind || "auto");
    } catch (error) {
      title = title || detectedUrl;
      rawContent = pasted || detectedUrl;
      extractedContent = pasted || `无法直接抓取该页面。可以粘贴页面正文后再解析。\n\n错误：${error.message}`;
      parseStatus = "needs-review";
      parseNote = "页面可能需要登录或 webdriver。当前保留你粘贴的内容供确认。";
    }
  } else if (detectedUrl && looksLikeHtml(pasted)) {
    const adapter = detectSourceAdapter(detectedUrl);
    const extracted = extractByAdapter(pasted, detectedUrl, adapter, input.pageKind || "auto");
    title = title || extracted.title || detectedUrl;
    rawContent = pasted;
    extractedContent = extracted.text;
    rawFileName = "raw.html";
    input.comments = extracted.comments || [];
    input.sourceUpdatedAt = extracted.sourceUpdatedAt || "";
    linkedItems = extractPreviewLinkedItems(rawContent, detectedUrl, sourceType, input.pageKind || "auto");
    parseNote = "已按对应站点规则解析粘贴的 HTML 内容。";
  }

  title = title || inferTitle(extractedContent) || "Untitled material";
  const resolvedPageKind = resolvePageKind(detectedUrl, input.pageKind || "auto");
  if (detectedUrl && resolvedPageKind === "list") {
    refreshJob = await ensureRefreshJobForListUrl(detectedUrl, {
      title,
      sourceType,
      fetchMode: input.fetchMode || "auto"
    });
  }

  return {
    title,
    sourceType,
    url: detectedUrl || null,
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
  if (pageKind && pageKind !== "auto") return pageKind;
  if (!url) return pageKind || "auto";
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

  const fetched = await fetchForMetadata(item.metadata);
  const previousLength = item.document.length;
  const previousBody = extractBodyFromDocument(item.document).trim();
  const currentBody = fetched.text.trim();
  const nextSourceUpdatedAt = cleanText(fetched.sourceUpdatedAt || item.metadata.sourceUpdatedAt || "");
  const sourceChanged = nextSourceUpdatedAt
    && normalizeSourceUpdatedAt(nextSourceUpdatedAt) !== normalizeSourceUpdatedAt(item.metadata.sourceUpdatedAt || "");
  const contentChanged = previousBody !== currentBody;
  const metadata = {
    ...item.metadata,
    title: item.metadata.title || fetched.title,
    updatedAt: now,
    lastFetchedAt: now,
    sourceUpdatedAt: nextSourceUpdatedAt,
    contentUpdatedAt: sourceChanged || contentChanged ? now : item.metadata.contentUpdatedAt || "",
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
  await rebuildIndexes();

  return readItem(id);
}

async function fetchForMetadata(metadata) {
  if (metadata.fetchMode === "webdriver" || metadata.sourceType === "jira") {
    return fetchUrlWithWebdriver(metadata.url, { pageKind: metadata.pageKind || "auto" });
  }
  return fetchUrl(metadata.url, { pageKind: metadata.pageKind || "auto" });
}

async function upsertFetchedItem(input) {
  const existing = await findItemByUrl(input.url);
  if (!existing) {
    return createItem({
      title: input.title,
      sourceType: input.sourceType,
      url: input.url,
      tags: input.tags,
      rawContent: input.raw,
      extractedContent: input.text,
      rawFileName: "raw.html",
      lastFetchedAt: input.fetchedAt,
      comments: input.comments,
      pageKind: input.pageKind,
      fetchMode: input.fetchMode,
      parentUrl: input.parentUrl,
      sourceUpdatedAt: input.sourceUpdatedAt
    });
  }

  const item = await readItem(existing.id);
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
  const nextSourceUpdatedAt = cleanText(input.sourceUpdatedAt || item.metadata.sourceUpdatedAt || "");
  const sourceChanged = nextSourceUpdatedAt
    && normalizeSourceUpdatedAt(nextSourceUpdatedAt) !== normalizeSourceUpdatedAt(item.metadata.sourceUpdatedAt || "");
  const contentChanged = previousBody !== currentBody;
  const metadata = {
    ...item.metadata,
    title: input.title || item.metadata.title,
    sourceType: input.sourceType || item.metadata.sourceType,
    url: input.url,
    tags: mergeTags(item.metadata.tags || [], input.tags || []),
    updatedAt: input.fetchedAt,
    lastFetchedAt: input.fetchedAt,
    sourceUpdatedAt: nextSourceUpdatedAt,
    contentUpdatedAt: sourceChanged || contentChanged ? input.fetchedAt : item.metadata.contentUpdatedAt || "",
    rawFileName: item.metadata.rawFileName || "raw.html",
    pageKind: input.pageKind || item.metadata.pageKind || null,
    fetchMode: input.fetchMode || item.metadata.fetchMode || null,
    parentUrl: input.parentUrl || item.metadata.parentUrl || null,
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
  return readItem(existing.id);
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

function shouldSkipContentRefresh(existingMetadata, listUpdatedAt) {
  if (!existingMetadata || !listUpdatedAt || !existingMetadata.sourceUpdatedAt) return false;
  const existingTime = Date.parse(existingMetadata.sourceUpdatedAt);
  const listTime = Date.parse(listUpdatedAt);
  if (!Number.isNaN(existingTime) && !Number.isNaN(listTime)) {
    return existingTime >= listTime;
  }
  return normalizeSourceUpdatedAt(existingMetadata.sourceUpdatedAt) === normalizeSourceUpdatedAt(listUpdatedAt);
}

function normalizeSourceUpdatedAt(value) {
  const clean = cleanText(value);
  if (!clean) return "";
  const parsed = Date.parse(clean);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return clean.toLowerCase().replace(/\s+/g, " ");
}

async function ensureRefreshJobForListUrl(url, options = {}) {
  const adapter = detectSourceAdapter(url);
  if (resolvePageKind(url, "auto") !== "list") return null;
  const normalizedUrl = normalizeUrlForMatch(url);
  const existing = (settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      url: existing.url,
      enabled: Boolean(existing.enabled),
      intervalMinutes: existing.intervalMinutes,
      maxItems: existing.maxItems,
      created: false
    };
  }

  const job = normalizeRefreshJob({
    id: defaultRefreshJobIdForListUrl(url, adapter),
    name: defaultRefreshJobNameForListUrl(url, options.title),
    url,
    enabled: false,
    intervalMinutes: 60,
    maxItems: 50,
    tags: defaultRefreshTagsForListUrl(url, adapter),
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
  const tags = [adapter.sourceType, `${adapter.sourceType}-filter`];
  try {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("query") || "";
    const reason = query.match(/reason:([^\s]+)/i)?.[1];
    if (reason) tags.push(reason);
  } catch {
    // Tags are best-effort.
  }
  return normalizeTags(tags);
}

function defaultRefreshFetchModeForAdapter(adapter, requestedMode) {
  if (requestedMode === "fetch" || requestedMode === "webdriver") return requestedMode;
  return adapter.sourceType === "jira" ? "webdriver" : "fetch";
}

async function importLinkedItemsFromList(input) {
  const adapter = detectSourceAdapter(input.url);
  const links = extractContentLinksFromList(input.raw || "", input.url, adapter)
    .slice(0, Math.max(1, Number(input.maxItems) || 50));
  const imported = [];
  const errors = [];
  const fetchMode = input.fetchMode === "webdriver" ? "webdriver" : input.fetchMode === "fetch" ? "fetch" : resolvedRefreshFetchMode({}, adapter);

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
        tags: mergeTags(input.tags || [], [adapter.sourceType, link.key || link.number ? `${link.key || link.number}`.toLowerCase() : "content"]),
        raw: fetched.raw,
        text: fetched.text,
        comments: fetched.comments || [],
        sourceUpdatedAt: fetched.sourceUpdatedAt || listUpdatedAt,
        fetchedAt: new Date().toISOString(),
        pageKind: "content",
        fetchMode,
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

async function recommendTagsWithOpenAICompatible({ content, allTags, currentTags }) {
  const baseUrl = settings.ai.baseUrl.replace(/\/+$/, "");
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
            "只返回 JSON，格式为 {\"tags\":[\"tag-a\",\"tag-b\"]}。"
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

async function readItem(id) {
  if (!id || id.includes("..") || id.includes("/")) {
    throw new Error("Invalid item id.");
  }

  const itemDir = path.join(itemsDir, id);
  const metadata = JSON.parse(await fs.readFile(path.join(itemDir, "metadata.json"), "utf8"));
  const document = await fs.readFile(path.join(itemDir, "document.md"), "utf8");
  const commentsPath = path.join(itemDir, "comments.jsonl");
  const comments = await readJsonLines(commentsPath);
  return { metadata, document, comments };
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
    const searchText = `${metadata.title} ${(metadata.tags || []).join(" ")} ${document}`.toLowerCase();

    if (!isTruthyFilter(filters.includeLists) && metadata.pageKind === "list") continue;
    if (filters.tag && !(metadata.tags || []).includes(filters.tag)) continue;
    if (filters.sourceType && metadata.sourceType !== filters.sourceType) continue;
    if (isTruthyFilter(filters.updates) && !metadata.contentUpdatedAt) continue;
    if (filters.query && !searchText.includes(filters.query.toLowerCase())) continue;

    items.push({
      ...metadata,
      excerpt: summarizeExcerpt(document)
    });
  }

  return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
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
    return `- ${item.title} (${item.sourceType}, tags: ${(item.tags || []).join(", ") || "none"})\n  - metadata: ${itemPath}/metadata.json\n  - document: ${itemPath}/document.md\n  - comments: ${itemPath}/comments.jsonl\n  - url: ${item.url || "local input"}\n  - last fetched: ${item.lastFetchedAt || "not fetched"}`;
  });

  const prompt = `请基于当前项目目录里的 knowledge-base 回答这个问题：

${cleanQuestion || "(这里填写问题)"}

优先阅读：
${sourceLines.join("\n") || "- knowledge-base/indexes/by-updated.json\n- knowledge-base/items/*/document.md"}

回答要求：
- 先给结论，再列关键依据。
- 需要查原文时读取 document.md、comments.jsonl 和 raw 文件。
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

内容:
${result.context}`;
  }).join("\n\n---\n\n");
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
          content: "你是本地知识库问答助手。只能基于提供的资料回答；如果资料不足，要明确说不知道。回答使用中文。结论在前，并在关键依据处引用资料 ID、URL 或文件路径。"
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
          content: "你是本地知识库问答助手。只能基于提供的资料回答；如果资料不足，要明确说不知道。回答使用中文。结论在前，并在关键依据处引用资料 ID、URL 或文件路径。"
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
  const dirs = await safeReaddir(itemsDir);
  const results = [];

  for (const id of dirs) {
    const itemDir = path.join(itemsDir, id);
    const metadataPath = path.join(itemDir, "metadata.json");
    const documentPath = path.join(itemDir, "document.md");
    if (!(await exists(metadataPath)) || !(await exists(documentPath))) continue;

    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    const document = await fs.readFile(documentPath, "utf8");
    const commentsPath = path.join(itemDir, "comments.jsonl");
    const comments = await readJsonLines(commentsPath);
    const commentsText = comments.map((comment) => JSON.stringify(comment)).join("\n");
    const haystack = `${metadata.title}\n${(metadata.tags || []).join(" ")}\n${metadata.sourceType}\n${metadata.url || ""}\n${document}\n${commentsText}`.toLowerCase();
    const score = scoreKnowledgeMatch(haystack, terms, metadata);

    if (score > 0 || !terms.length) {
      results.push({
        score,
        item: {
          ...metadata,
          paths: {
            metadata: path.join(itemDir, "metadata.json"),
            document: documentPath,
            comments: commentsPath,
            raw: path.join(itemDir, metadata.rawFileName || "raw.txt")
          }
        },
        context: buildKnowledgeContext(document, commentsText, terms)
      });
    }
  }

  if (!results.length && terms.length) {
    for (const id of dirs) {
      const fallback = await readKnowledgeSearchResult(id, 0, []);
      if (fallback) results.push(fallback);
    }
  }

  return results
    .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)))
    .slice(0, Math.max(1, Number(limit) || 8));
}

async function readKnowledgeSearchResult(id, score, terms) {
  const itemDir = path.join(itemsDir, id);
  const metadataPath = path.join(itemDir, "metadata.json");
  const documentPath = path.join(itemDir, "document.md");
  if (!(await exists(metadataPath)) || !(await exists(documentPath))) return null;

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const document = await fs.readFile(documentPath, "utf8");
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
        comments: commentsPath,
        raw: path.join(itemDir, metadata.rawFileName || "raw.txt")
      }
    },
    context: buildKnowledgeContext(document, commentsText, terms)
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
    return `${index + 1}. ${item.title} (${item.id})\n   来源：${item.sourceType} · ${item.url || "local input"}\n   最后抓取：${item.lastFetchedAt || "not fetched"}\n   文件：${item.paths.document}\n   相关片段：${result.context.slice(0, 420).replace(/\n/g, " ")}`;
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
  const cjkTerms = lower.match(/[\p{Script=Han}]{2,}/gu) || [];
  const shortTerms = lower.split(/\s+/).filter((term) => term.length >= 2);
  return [...new Set([...asciiTerms, ...cjkTerms, ...shortTerms])].slice(0, 24);
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
  const now = Date.now();
  for (const job of settings.refreshJobs || []) {
    if (!job.enabled || refreshRuntime.running.has(job.id)) continue;
    const intervalMs = Math.max(5, Number(job.intervalMinutes) || 60) * 60 * 1000;
    const lastRunAt = job.lastRunAt ? Date.parse(job.lastRunAt) : 0;
    if (!lastRunAt || now - lastRunAt >= intervalMs) {
      await runRefreshJob(job);
    }
  }
}

async function runRefreshJobById(id, options = {}) {
  const job = (settings.refreshJobs || []).find((candidate) => candidate.id === id);
  if (!job) throw new Error("Refresh job not found.");
  if (!options.force && !job.enabled) throw new Error("Refresh job is disabled.");
  return runRefreshJob(job);
}

async function runRefreshJob(job) {
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
    const result = await refreshListJob({ ...job, lastStartedAt: startedAt });
    await updateRefreshJobState(job.id, {
      status: "idle",
      lastRunAt: new Date().toISOString(),
      lastResult: result,
      lastError: ""
    });
    return result;
  } catch (error) {
    await updateRefreshJobState(job.id, {
      status: "failed",
      lastRunAt: new Date().toISOString(),
      lastError: error.message || String(error)
    });
    throw error;
  } finally {
    refreshRuntime.running.delete(job.id);
  }
}

async function refreshListJob(job) {
  const adapter = detectSourceAdapter(job.url);
  if (job.pageKind !== "list" && inferPageKind(job.url, adapter) !== "list") {
    throw new Error("当前批量刷新任务需要配置为列表/过滤页。");
  }

  const fetchedAt = new Date().toISOString();
  const listFetched = await fetchForRefreshJob(job.url, { ...job, pageKind: "list" }, adapter);
  const listUrl = listFetched.url || job.url;
  const sourceTag = adapter.sourceType === "github" ? "github-filter" : `${adapter.sourceType}-filter`;
  const tags = mergeTags(job.tags || [], [adapter.sourceType, sourceTag]);
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
      if (shouldSkipContentRefresh(existing, listUpdatedAt)) {
        skippedItems.push({
          key: link.key || link.number || "",
          itemId: existing.id,
          url: existing.url,
          sourceUpdatedAt: existing.sourceUpdatedAt,
          reason: "unchanged-list-updated-time"
        });
        continue;
      }
      const contentFetched = await fetchForRefreshJob(contentUrl, { ...job, pageKind: "content" }, adapter);
      const contentItem = await upsertFetchedItem({
        title: contentFetched.title || link.title || link.key || contentUrl,
        sourceType: adapter.sourceType,
        url: contentFetched.url ? normalizeContentFetchUrl(contentFetched.url, adapter) : contentUrl,
        tags: mergeTags(job.tags || [], [adapter.sourceType, link.key || link.number ? `${link.key || link.number}`.toLowerCase() : "content"]),
        raw: contentFetched.raw,
        text: contentFetched.text,
        comments: contentFetched.comments || [],
        sourceUpdatedAt: contentFetched.sourceUpdatedAt || listUpdatedAt,
        fetchedAt: new Date().toISOString(),
        pageKind: "content",
        fetchMode: resolvedRefreshFetchMode(job, adapter),
        parentUrl: listUrl
      });
      updatedItems.push({
        key: link.key || link.number || "",
        title: contentItem.metadata.title,
        itemId: contentItem.metadata.id,
        url: contentItem.metadata.url,
        sourceUpdatedAt: contentItem.metadata.sourceUpdatedAt || "",
        sourceUrl: link.href
      });
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

async function refreshJiraFilterJob(job) {
  const adapter = detectSourceAdapter(job.url);
  if (adapter.sourceType !== "jira") {
    throw new Error("当前批量刷新任务先支持 Jira filter。");
  }

  const fetchedAt = new Date().toISOString();
  const listFetched = await fetchUrlWithWebdriver(job.url, { pageKind: "list" });
  const listUrl = listFetched.url || job.url;
  const tags = mergeTags(job.tags || [], ["jira", "jira-filter"]);
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
        tags: mergeTags(job.tags || [], ["jira", issue.key.toLowerCase()]),
        raw: issueFetched.raw,
        text: issueFetched.text,
        comments: issueFetched.comments || [],
        fetchedAt: new Date().toISOString(),
        pageKind: "content",
        fetchMode: "webdriver",
        parentUrl: listUrl
      });
      updatedIssues.push({ key: issue.key, itemId: issueItem.metadata.id, url: issueItem.metadata.url });
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

async function fetchForRefreshJob(url, job, adapter = detectSourceAdapter(url)) {
  if (resolvedRefreshFetchMode(job, adapter) === "webdriver") {
    return fetchUrlWithWebdriver(url, { pageKind: job.pageKind || "auto" });
  }
  return fetchUrl(url, { pageKind: job.pageKind || "auto" });
}

function resolvedRefreshFetchMode(job, adapter) {
  if (job.fetchMode === "fetch") return "fetch";
  if (job.fetchMode === "webdriver") return "webdriver";
  return adapter.sourceType === "jira" ? "webdriver" : "fetch";
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
  const session = await ensureWebdriverSession(adapter.hostname, url, false);
  const page = session.page || await session.context.newPage();
  session.page = page;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForJiraIssueNavigator(page, adapter, options.pageKind || "auto");
  const raw = await page.content();
  const currentUrl = page.url();
  const extracted = extractByAdapter(raw, currentUrl || url, adapter, options.pageKind || "auto");
  return {
    raw,
    title: extracted.title || await page.title(),
    text: extracted.text,
    comments: extracted.comments || [],
    sourceUpdatedAt: extracted.sourceUpdatedAt || "",
    url: currentUrl
  };
}

async function openWebdriverSession(url, hostname) {
  const target = url || (hostname ? `https://${hostname}` : "https://jira.amlogic.com");
  const adapter = detectSourceAdapter(target);
  const session = await ensureWebdriverSession(adapter.hostname, target, true);
  await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  return describeWebdriverSession(adapter.hostname, session);
}

async function saveWebdriverCookies(url, hostname) {
  const target = url || (hostname ? `https://${hostname}` : "");
  const adapter = detectSourceAdapter(target);
  if (!adapter.hostname) throw new Error("需要 URL 或 hostname 才能保存 Cookie。");
  const session = await ensureWebdriverSession(adapter.hostname, target || `https://${adapter.hostname}`, false);
  const cookies = await session.context.cookies(`https://${adapter.hostname}`);
  const cookieHeader = cookiesToHeader(cookies);
  if (!cookieHeader) {
    throw new Error("没有读取到可保存的 Cookie。请先在 Webdriver 窗口完成登录。");
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

async function ensureWebdriverSession(hostname, url, headed) {
  const key = hostname || safeHostname(url) || "default";
  const existing = webdriverSessions.get(key);
  if (existing) return existing;

  await fs.mkdir(webdriverRoot, { recursive: true });
  const userDataDir = path.join(webdriverRoot, slugify(key));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = context.pages()[0] || await context.newPage();
  const session = {
    hostname: key,
    userDataDir,
    context,
    page,
    startedAt: new Date().toISOString()
  };
  webdriverSessions.set(key, session);
  context.on("close", () => webdriverSessions.delete(key));
  return session;
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
    startedAt: session.startedAt,
    url: session.page?.url?.() || ""
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

function detectSourceAdapter(url) {
  const hostname = safeHostname(url);
  if (hostname === "confluence.amlogic.com") return { id: "amlogic-confluence", sourceType: "confluence", hostname };
  if (hostname === "jira.amlogic.com") return { id: "amlogic-jira", sourceType: "jira", hostname };
  if (hostname === "roku.atlassian.net") return { id: "roku-jira", sourceType: "jira", hostname };
  if (hostname === "github.ecodesamsung.com") return { id: "ecodesamsung-github", sourceType: "github", hostname };
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
  if (adapter.sourceType === "jira" && pathname === "/issues/" && /[?&]filter=\d+/i.test(search)) return "list";
  if (adapter.sourceType === "jira" && pathname === "/issues" && /[?&]filter=\d+/i.test(search)) return "list";
  if (adapter.sourceType === "jira" && /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(pathname)) return "content";
  if (adapter.sourceType === "github" && pathname === "/notifications") return "list";
  if (adapter.sourceType === "github" && /\/(issues|pull|discussions)\/\d+/i.test(pathname)) return "content";
  if (adapter.sourceType === "confluence" && (/\/pages\/viewpage\.action/i.test(pathname) || /\/display\//i.test(pathname))) return "content";
  return "content";
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
    const pattern = new RegExp(`<td\\\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\\\s\\\\S]*?)<\\\\/td>`, "i");
    const match = rowHtml.match(pattern);
    if (match) return htmlToText(match[1]).replace(/\s+/g, " ").trim();
  }
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
  const comments = extractGithubComments(issue);
  const events = extractGithubTimelineEvents(issue);
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
    sourceUpdatedAt: issue.updatedAt || ""
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
  const pattern = /<div\b[^>]*(?:id=["']issuecomment-(\d+)["']|class=["'][^"']*js-comment-container[^"']*["'])[^>]*>([\s\S]*?)(?=<div\b[^>]*(?:id=["']issuecomment-\d+["']|class=["'][^"']*js-comment-container)|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const block = match[0] || "";
    const id = match[1] || cleanText(block.match(/\bid=["']issuecomment-(\d+)["']/i)?.[1] || "");
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
    if (comment.body || comment.author) comments.push(comment);
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
  const fields = {
    type: cleanInlineText(extractHtmlById(html, "type-val")),
    status: cleanInlineText(extractHtmlById(html, "status-val")),
    priority: cleanInlineText(extractHtmlById(html, "priority-val")),
    resolution: cleanInlineText(extractHtmlById(html, "resolution-val")),
    updated: cleanInlineText(extractHtmlById(html, "updated-val")),
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

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function safePathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function safeSearch(url) {
  try {
    return new URL(url).search;
  } catch {
    return "";
  }
}

function normalizeUrlForMatch(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return cleanText(url);
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

function extractBodyFromDocument(document) {
  const marker = "\n## Content\n\n";
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
  if (lowerUrl.includes("jira") || lowerUrl.includes("/browse/")) return "jira";
  if (lowerUrl.includes("roku.atlassian.net")) return "jira";
  return "web";
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((tag) => slugTag(tag)).filter(Boolean))];
  }
  return [...new Set(String(tags || "").split(",").map((tag) => slugTag(tag)).filter(Boolean))];
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

function slugTag(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._/-]/g, "");
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "item";
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

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
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

async function saveSettings(input) {
  const next = mergeSettings(settings, {
    ai: {
      baseUrl: cleanText(input.ai?.baseUrl ?? input.baseUrl ?? settings.ai.baseUrl),
      apiKey: cleanText(input.ai?.apiKey ?? input.apiKey ?? settings.ai.apiKey),
      model: cleanText(input.ai?.model ?? input.model ?? settings.ai.model)
    },
    chat: {
      showThinking: Boolean(input.chat?.showThinking ?? settings.chat?.showThinking ?? true),
      showToolCalls: Boolean(input.chat?.showToolCalls ?? settings.chat?.showToolCalls ?? true)
    },
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
    chat: {
      showThinking: true,
      showToolCalls: true
    },
    sources: {
      "confluence.amlogic.com": defaultSourceProfile("confluence.amlogic.com", "confluence"),
      "jira.amlogic.com": defaultSourceProfile("jira.amlogic.com", "jira"),
      "roku.atlassian.net": defaultSourceProfile("roku.atlassian.net", "jira"),
      "github.ecodesamsung.com": defaultSourceProfile("github.ecodesamsung.com", "github")
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
    chat: {
      ...base.chat,
      ...(patch.chat || {})
    },
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
    chat: {
      showThinking: settings.chat?.showThinking !== false,
      showToolCalls: settings.chat?.showToolCalls !== false
    },
    sources: publicSourceProfiles(),
    refreshJobs: publicRefreshJobs()
  };
}

function defaultRefreshJob(id, name, url) {
  return {
    id,
    name,
    url,
    enabled: false,
    intervalMinutes: 60,
    maxItems: 50,
    tags: ["jira"],
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
    status: cleanText(input.status ?? previous.status ?? "idle"),
    lastRunAt: cleanText(input.lastRunAt ?? previous.lastRunAt ?? ""),
    lastStartedAt: cleanText(input.lastStartedAt ?? previous.lastStartedAt ?? ""),
    lastError: cleanText(input.lastError ?? previous.lastError ?? ""),
    lastResult: input.lastResult ?? previous.lastResult ?? null
  };
}

function publicRefreshJobs() {
  return (settings.refreshJobs || []).map((job) => ({
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
    token: ""
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

## Answering Questions

1. Start with indexes when the user asks by tag, source, or recency.
2. Read metadata.json to confirm the item source, URL, and fetch time.
3. Read document.md for summaries and extracted content.
4. Read comments.jsonl when the user asks about comments, discussion, decisions, or original remarks.
5. Cite item ids and URLs when answering so the user can trace information back to the source.
6. If the information may have changed, mention the lastFetchedAt timestamp.
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
