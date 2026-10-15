// HTTP and source APIs: plain fetch, Jira/Confluence/GitHub REST, Microsoft Graph.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { readResponseBodyLimited } from "../capture-policy.js";
import { isSupportedCaptureContentType } from "../capture-utils.js";
import { collectConfluenceComments, normalizeConfluenceComment } from "./confluence-comments.js";
import { buildGithubIssueSearchApiUrls, githubIssueRowsToEntries, githubIssueSearchTitle, isGithubIssueSearchUrl, renderGithubIssueSearchText } from "./github-issue-search.js";
import { collectPullRequestDiscussion, renderGithubDiscussionEntry } from "./github-pull.js";
import { assertFetchedPageIsAuthenticated, confluenceHtmlToMarkdown, extractFilterId, extractTitle, htmlToText } from "./html-extractors.js";
import { extractTeamsDeepPath, renderTeamsTextFromComments } from "./teams-page.js";
import { latestTimestampValue, sourceLabel } from "../text-helpers.js";
import { cleanText, safePathname } from "../utils.js";

export function createSourceApi(ctx) {
  // Functions that live elsewhere, resolved when called.
  const buildAuthHeaders = (...args) => ctx.buildAuthHeaders(...args);
  const canonicalizeMaterialUrl = (...args) => ctx.canonicalizeMaterialUrl(...args);
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);
  const extractByAdapter = (...args) => ctx.extractByAdapter(...args);
  const hasGithubToken = (...args) => ctx.hasGithubToken(...args);
  const hasJiraApiCredentials = (...args) => ctx.hasJiraApiCredentials(...args);

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
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || ctx.FETCH_TIMEOUT_MS));
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
      const raw = await readResponseBodyLimited(response, ctx.MAX_FETCH_BYTES, controller.signal);
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
      if (controller.signal.aborted) throw new Error(`Fetch timed out after ${Math.round(Number(options.timeoutMs || ctx.FETCH_TIMEOUT_MS) / 1000)}s: ${url}`);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  function assertSafeFetchedResponse(response, url) {
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > ctx.MAX_FETCH_BYTES) {
      throw new Error(`Fetched page is larger than ${Math.round(ctx.MAX_FETCH_BYTES / 1024 / 1024)} MB: ${url}`);
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
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || ctx.FETCH_TIMEOUT_MS));
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
      const raw = await readResponseBodyLimited(response, ctx.MAX_FETCH_BYTES, controller.signal);
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
    const profile = ctx.settings.sources?.[adapter.hostname] || {};
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
    const profile = ctx.settings.sources?.[adapter.hostname] || {};
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
    const profile = ctx.settings.sources?.[adapter.hostname] || {};
    return adapter.sourceType === "teams" && profile.authMode === "bearer" && Boolean(profile.token);
  }

  return { fetchUrl, fetchUrlFromSourceApi, hasTeamsGraphCredentials };
}
