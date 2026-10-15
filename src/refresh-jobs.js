// Subscriptions (refresh jobs): defaults, creation, fetch mode, migrations, deletion.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { exists, safeReaddir } from "./fs-helpers.js";
import { mergeRefreshJobs, normalizeRefreshJob } from "./settings-schema.js";
import { isRuntimeOnlyPatch } from "./settings-store.js";
import { githubIssueSearchTitle, isGithubIssueSearchUrl } from "./sources/github-issue-search.js";
import { isSameRelativeSourceDay, normalizeSourceUpdatedAt, parseSourceUpdatedAt } from "./text-helpers.js";
import { cleanText, safePathname, slugify } from "./utils.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createRefreshJobs(ctx) {
  // Functions that live elsewhere, resolved when called.
  const canonicalizeMaterialUrl = (...args) => ctx.canonicalizeMaterialUrl(...args);
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);
  const hasTeamsGraphCredentials = (...args) => ctx.hasTeamsGraphCredentials(...args);
  const isInvalidTeamsRootCapture = (...args) => ctx.isInvalidTeamsRootCapture(...args);
  const isKnownListUrl = (...args) => ctx.isKnownListUrl(...args);
  const listItems = (...args) => ctx.listItems(...args);
  const normalizeUrlForMatch = (...args) => ctx.normalizeUrlForMatch(...args);
  const patchItemMetadata = (...args) => ctx.patchItemMetadata(...args);
  const publicRefreshJobs = (...args) => ctx.publicRefreshJobs(...args);
  const rebuildIndexes = (...args) => ctx.rebuildIndexes(...args);
  const resolvePageKind = (...args) => ctx.resolvePageKind(...args);

  function previewRefreshJob(url, options = {}) {
    const canonicalUrl = canonicalizeMaterialUrl(url);
    const adapter = detectSourceAdapter(canonicalUrl);
    const normalizedUrl = normalizeUrlForMatch(canonicalUrl);
    const existing = (ctx.settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
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
    const existing = (ctx.settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
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

    ctx.settings = {
      ...ctx.settings,
      refreshJobs: mergeRefreshJobs(ctx.settings.refreshJobs || [], [job])
    };
    await ctx.persistSettings();

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
    const existing = (ctx.settings.refreshJobs || []).find((job) => normalizeUrlForMatch(job.url) === normalizedUrl);
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

    ctx.settings = {
      ...ctx.settings,
      refreshJobs: mergeRefreshJobs(ctx.settings.refreshJobs || [], [job])
    };
    await ctx.persistSettings();

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
    const refreshJobs = (ctx.settings.refreshJobs || []).map((job) => {
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
      ctx.settings = { ...ctx.settings, refreshJobs };
      await ctx.persistSettings();
    }
    if (itemsChanged) await rebuildIndexes();
    if (itemsChanged || jobsChanged) console.log(`Migrated ${jobsChanged} subscription(s) and ${itemsChanged} item(s) from page to list.`);
  }

  // Older versions created a (disabled) subscription for every item captured from a
  // list. The list's subscription already refreshes them; drop the disabled ones.
  // Enabled ones were switched on by the person and stay.
  async function pruneListChildJobs() {
    const listUrls = new Set((ctx.settings.refreshJobs || []).filter((job) => job.pageKind === "list").map((job) => normalizeUrlForMatch(job.url || "")));
    if (!listUrls.size) return 0;
    const items = await listItems({ includeLists: true });
    const childUrls = new Set(items
      .filter((item) => item.url && item.parentUrl && listUrls.has(normalizeUrlForMatch(item.parentUrl)))
      .map((item) => normalizeUrlForMatch(item.url)));
    const before = ctx.settings.refreshJobs || [];
    const kept = before.filter((job) => !(job.pageKind === "content" && !job.enabled && job.managedBy !== "content-page" && childUrls.has(normalizeUrlForMatch(job.url || ""))));
    if (kept.length === before.length) return 0;
    ctx.settings = { ...ctx.settings, refreshJobs: kept };
    await ctx.persistSettings();
    console.log(`Removed ${before.length - kept.length} disabled subscription(s) for items that their list already refreshes.`);
    return before.length - kept.length;
  }

  async function syncContentRefreshJobsFromItems() {
    const items = await listItems({ includeLists: true });
    const itemsByUrl = new Map(items
      .filter((item) => item.url)
      .map((item) => [normalizeUrlForMatch(item.url), item])
      .filter(([url]) => Boolean(url)));
    const existingByUrl = new Map((ctx.settings.refreshJobs || [])
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
    ctx.settings = {
      ...ctx.settings,
      refreshJobs: mergeRefreshJobs(ctx.settings.refreshJobs || [], jobsToAdd)
    };
    await ctx.persistSettings();
    return jobsToAdd.length;
  }

  function isSubscriptionManagedItem(item) {
    return item.managedBy === "subscription" || Boolean(item.parentUrl) || item.sourceType === "teams";
  }

  async function markItemManagedBySubscription(item) {
    if (item.managedBy === "subscription") return;
    const itemDir = path.join(ctx.itemsDir, item.id);
    const metadataPath = path.join(itemDir, "metadata.json");
    if (!(await exists(metadataPath))) return;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    if (metadata.managedBy === "subscription") return;
    metadata.managedBy = "subscription";
    metadata.updatedAt = metadata.updatedAt || new Date().toISOString();
    // A metadata-only commit also re-renders the document header, atomically.
    await ctx.store.commit(item.id, { metadata });
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
    const profile = ctx.settings.sources?.[adapter.hostname] || {};
    return (profile.authMode === "bearer" && Boolean(profile.token)) || (profile.authMode === "basic" && Boolean(profile.username && profile.password));
  }

  function hasGithubToken(adapter) {
    return adapter.sourceType === "github" && Boolean(ctx.settings.sources?.[adapter.hostname]?.token);
  }

  function requiresWebdriverExpansion(adapter) {
    // With a token the REST API returns the full issue and comments; no page needed.
    return adapter.sourceType === "github" && adapter.hostname === "github.ecodesamsung.com" && !hasGithubToken(adapter);
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
    ctx.settings = {
      ...ctx.settings,
      refreshJobs: (ctx.settings.refreshJobs || []).map((job) => (
        job.id === id ? { ...job, ...patch } : job
      ))
    };
    await ctx.persistSettings({ runtimeOnly: isRuntimeOnlyPatch(patch) });
  }

  async function deleteRefreshJob(id) {
    const before = ctx.settings.refreshJobs || [];
    const nextJobs = before.filter((job) => job.id !== id);
    if (nextJobs.length === before.length) {
      throw new Error("Refresh job not found.");
    }
    ctx.refreshRuntime.running.delete(id);
    ctx.settings = {
      ...ctx.settings,
      refreshJobs: nextJobs
    };
    await ctx.persistSettings();
    return publicRefreshJobs();
  }

  async function deleteRefreshJobItems(id) {
    const job = (ctx.settings.refreshJobs || []).find((candidate) => candidate.id === id);
    if (!job) throw new Error("Refresh job not found.");
    if (job.managedBy === "content-page") {
      throw new Error("普通页面整体管理的内容不能通过订阅清空。");
    }

    const dirs = await safeReaddir(ctx.itemsDir);
    const deletedItems = [];
    for (const itemId of dirs) {
      const metadataPath = path.join(ctx.itemsDir, itemId, "metadata.json");
      if (!(await exists(metadataPath))) continue;
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (!isRefreshJobCapturedItem(job, metadata)) continue;
      await ctx.store.delete(itemId);
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
    const jobs = (ctx.settings.refreshJobs || [])
      .filter((job) => sourceTypeForRefreshJob(job) === source);
    if (!source || !jobs.length) {
      return { sourceType: source, deletedItemCount: 0, deletedItems: [] };
    }

    const jobUrls = new Set(jobs.map((job) => normalizeUrlForMatch(job.url || "")).filter(Boolean));
    const dirs = await safeReaddir(ctx.itemsDir);
    const deletedItems = [];
    for (const itemId of dirs) {
      const metadataPath = path.join(ctx.itemsDir, itemId, "metadata.json");
      if (!(await exists(metadataPath))) continue;
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (!isRefreshSourceCapturedItem(source, jobUrls, metadata)) continue;
      await ctx.store.delete(itemId);
      deletedItems.push({
        id: metadata.id || itemId,
        title: metadata.title || itemId,
        url: metadata.url || ""
      });
    }

    const now = new Date().toISOString();
    ctx.settings = {
      ...ctx.settings,
      refreshJobs: (ctx.settings.refreshJobs || []).map((job) => (
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
    await ctx.persistSettings();
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

  return { shouldSkipContentRefresh, previewRefreshJob, ensureRefreshJobForListUrl, ensureRefreshJobForContentUrl, migrateMisclassifiedListUrls, pruneListChildJobs, syncContentRefreshJobsFromItems, defaultRefreshJobNameForListUrl, shouldFetchWithWebdriver, hasJiraApiCredentials, hasGithubToken, resolvedRefreshFetchMode, updateRefreshJobState, deleteRefreshJob, deleteRefreshJobItems, deleteRefreshSourceItems };
}
