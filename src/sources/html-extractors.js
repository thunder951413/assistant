// HTML parsers for Jira, Confluence, GitHub and generic pages. They turn fetched
// markup into titles, text, comments and list entries; no network or state access.
import { escapeRegExp, latestTimestampValue } from "../text-helpers.js";
import { cleanText, safeHostname, safePathname } from "../utils.js";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export function assertFetchedPageIsAuthenticated({ adapter, requestedUrl, finalUrl, title, raw }) {
  const login = detectAuthenticationPage({
    adapter,
    requestedUrl,
    finalUrl,
    title,
    raw
  });
  if (!login) return;
  throw new Error([
    `检测到 ${login.sourceName} 未登录，已停止抓取，未保存登录页。`,
    "请先在 WebDriver 窗口完成登录，或在设置里重新保存 Cookie 后再刷新。",
    `当前页面：${login.finalUrl || finalUrl || requestedUrl}`
  ].join(" "));
}

export function detectAuthenticationPage({ adapter, finalUrl, title, raw }) {
  const pageTitle = cleanText(title || extractTitle(raw || ""));
  const html = String(raw || "");
  const pathname = safePathname(finalUrl || "");
  if (adapter.sourceType === "jira") {
    const jiraLogin = /\/login\.jsp$/i.test(pathname)
      || /^Log in\b.*\bJIRA$/i.test(pageTitle)
      || /name=["']os_username["']|id=["']login-form["']|class=["'][^"']*\blogin-link\b/i.test(html)
      || isJiraAnonymousPage(html);
    if (jiraLogin) return { sourceName: "Jira", finalUrl };
  }
  if (adapter.sourceType === "confluence") {
    const confluenceLogin = /\/login(?:\.action)?$/i.test(pathname)
      || /^Log in\b|登录/i.test(pageTitle)
      || /name=["']os_username["']|id=["']login-form["']/i.test(html);
    if (confluenceLogin) return { sourceName: "Confluence", finalUrl };
  }
  if (adapter.sourceType === "github") {
    const githubLogin = /\/login$/i.test(pathname)
      || /Sign in to GitHub|Sign in/i.test(pageTitle)
      || /name=["']login["'][\s\S]{0,600}name=["']password["']/i.test(html);
    if (githubLogin) return { sourceName: "GitHub", finalUrl };
  }
  return null;
}

export function isJiraAnonymousPage(html) {
  if (extractJiraIssues(html, "").length > 0) return false;
  const remoteUser = extractMetaContent(html, "ajs-remote-user") || extractMetaContentLoose(html, "ajs-remote-user");
  if (remoteUser) return false;
  return /class=["'][^"']*\blogin-link\b|href=["'][^"']*login\.jsp|>\s*Log In\s*<|data-username=["']anonymous["']|ajaxUnauthorised|not authorized/i.test(String(html || ""));
}

export function extractMetaContentLoose(html, name) {
  const source = String(html || "");
  const tags = source.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!new RegExp(`\\b(?:name|id)=["']${escapeRegExp(name)}["']`, "i").test(tag)) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] || "";
    if (content) return decodeHtml(content);
  }
  return "";
}

export function extractListPage(html, url, adapter) {
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

export function extractGithubNotificationsPage(html, url, adapter) {
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

export function extractGithubNotifications(html, baseUrl) {
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

export function extractContentLinksFromList(html, url, adapter) {
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

export function extractGithubNotificationsQuery(html, url) {
  try {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("query");
    if (query) return query;
  } catch {
    // Fall through to the input value embedded in the page.
  }
  return decodeHtml(String(html || "").match(/<input\b[^>]*id=["']notifications-search-input["'][^>]*value=["']([^"']*)["'][^>]*>/i)?.[1] || "");
}

export function extractGithubNotificationsPagination(html) {
  return cleanInlineText(String(html || "").match(/<div\b[^>]*class=["'][^"']*js-notifications-list-paginator-counts[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
}

export function parseGithubRepoAndNumber(text, href) {
  const clean = cleanText(text);
  const textMatch = clean.match(/([^\s]+\/[^\s]+)\s+#(\d+)/);
  if (textMatch) return { repository: textMatch[1], number: textMatch[2] };
  const pathMatch = safePathname(href).match(/^\/([^/]+\/[^/]+)\/(?:issues|pull|discussions)\/(\d+)/i);
  if (pathMatch) return { repository: pathMatch[1], number: pathMatch[2] };
  return { repository: "", number: "" };
}

export function extractJiraFilterPage(html, url, adapter) {
  const title = extractTitle(html) || `Jira Filter ${extractFilterId(url) || ""}`.trim();
  const remoteUser = extractMetaContent(html, "ajs-remote-user");
  const filterId = extractFilterId(url);
  const issues = extractJiraIssues(html, url);
  const isAnonymous = issues.length === 0 && (!remoteUser || /login-link|Log In|ajaxUnauthorised|not authorized/i.test(html));
  if (isAnonymous) {
    assertFetchedPageIsAuthenticated({
      adapter,
      requestedUrl: url,
      finalUrl: url,
      title,
      raw: html
    });
  }
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

export function extractJiraIssues(html, baseUrl) {
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

export function extractJiraCell(rowHtml, classNames) {
  for (const className of classNames) {
    const pattern = new RegExp(`<td\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, "i");
    const match = rowHtml.match(pattern);
    if (match) {
      return extractJiraDateValue(match[1]) || htmlToText(match[1]).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

export function extractJiraDateValue(html) {
  const datetime = decodeHtml(String(html || "").match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || "");
  if (datetime) return datetime;
  const title = decodeHtml(String(html || "").match(/<span\b[^>]*title=["']([^"']+)["'][^>]*>/i)?.[1] || "");
  if (title) return title;
  return "";
}

export function extractFilterId(url) {
  try {
    return new URL(url).searchParams.get("filter") || "";
  } catch {
    return "";
  }
}

export function extractPageId(url) {
  try {
    return new URL(url).searchParams.get("pageId") || "";
  } catch {
    return "";
  }
}

export function extractMetaContent(html, name) {
  const pattern = new RegExp(`<meta\\b[^>]*(?:name|id)=["']${escapeRegExp(name)}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  return decodeHtml(html.match(pattern)?.[1] || "");
}

export function extractContentPage(html, url, adapter) {
  if (adapter.sourceType === "jira" && /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(safePathname(url))) {
    return extractJiraIssuePage(html, url, adapter);
  }
  if (adapter.sourceType === "github" && /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(safePathname(url))) {
    return extractGithubIssuePage(html, url, adapter);
  }
  if (adapter.sourceType === "confluence") {
    return extractConfluencePage(html, url, adapter);
  }

  const readable = extractReadableArticle(html, url);
  const title = readable?.title || extractTitle(html) || url;
  const mainHtml = readable?.content || pickMainHtml(html, adapter);
  const text = [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapter.id}`,
    "",
    "## Extracted Content",
    "",
    readable?.textContent || htmlToText(mainHtml)
  ].join("\n").trim();

  return { title, text, comments: [], sourceUpdatedAt: readable?.publishedTime || "" };
}

export function extractReadableArticle(html, url) {
  try {
    const dom = new JSDOM(String(html || ""), { url });
    const parsed = new Readability(dom.window.document.cloneNode(true), {
      charThreshold: 120,
      maxElemsToParse: 100000
    }).parse();
    if (!parsed?.textContent?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractConfluencePage(html, url, adapter) {
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

export function extractConfluenceUpdatedAt(html, metadataHtml, metadataText) {
  const direct = decodeHtml(String(metadataHtml || html || "").match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || "");
  if (direct) return direct;
  const pageVersion = extractMetaContent(html, "ajs-page-version");
  if (pageVersion) return `version:${pageVersion}`;
  const text = cleanText(metadataText || "");
  const match = text.match(/\b(?:updated|modified|last changed)\b[:\s]*(.+)$/i);
  return cleanText(match?.[1] || "");
}

export function extractGithubIssuePage(html, url, adapter) {
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

export function extractGithubIssuePageFromHtml(html, url, adapter) {
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

export function extractGithubEmbeddedData(html) {
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

export function findGithubIssuePayload(value, seen = new Set()) {
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

export function findGithubRepositoryName(value, url, seen = new Set()) {
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

export function extractGithubLabels(issue) {
  const labels = [];
  const nodes = issue.labels?.nodes || issue.labels?.edges?.map((edge) => edge.node) || [];
  for (const label of nodes) {
    const name = cleanText(label?.name || "");
    if (name && !labels.includes(name)) labels.push(name);
  }
  return labels;
}

export function extractGithubAssignees(issue) {
  const actors = issue.assignees?.nodes || issue.assignedActors?.nodes || issue.assignees?.edges?.map((edge) => edge.node) || [];
  return uniqueClean(actors.map((actor) => githubActorName(actor)).filter(Boolean));
}

export function extractGithubComments(issue) {
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

export function extractGithubTimelineEvents(issue) {
  return uniqueClean(githubTimelineNodes(issue)
    .map((node) => githubTimelineEventText(node))
    .filter(Boolean))
    .slice(0, 100);
}

export function githubTimelineNodes(issue) {
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

export function githubTimelineEventText(node) {
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

export function extractGithubHtmlComments(html, baseUrl) {
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

export function githubActorName(actor) {
  return cleanText(actor?.login || actor?.name || actor?.displayName || "");
}

export function uniqueClean(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

export function extractConfluenceMainHtml(html) {
  const start = html.search(/<div\b[^>]*id=["']main-content["'][^>]*>/i);
  if (start === -1) return pickMainHtml(html, { sourceType: "confluence" });
  const afterStart = html.slice(start);
  const endMatch = afterStart.search(/<div\b[^>]*id=["'](?:labels-section|comments-section)["'][^>]*>/i);
  return endMatch === -1 ? afterStart : afterStart.slice(0, endMatch);
}

export function extractConfluenceMetadataHtml(html) {
  const start = html.search(/<div\b[^>]*class=["'][^"']*page-metadata[^"']*["'][^>]*>/i);
  if (start === -1) return "";
  const afterStart = html.slice(start);
  const endMatch = afterStart.search(/<div\b[^>]*id=["']main-content["'][^>]*>/i);
  return endMatch === -1 ? afterStart.slice(0, 1600) : afterStart.slice(0, endMatch);
}

export function confluenceHtmlToMarkdown(html, baseUrl) {
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

export function extractConfluenceAttachments(html, baseUrl) {
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

export function extractConfluenceComments(html, baseUrl) {
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

export function extractJiraIssuePage(html, url, adapter) {
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

export function extractJiraDescriptionHtml(html) {
  const start = html.search(/<div\b[^>]*id=["']description-val["'][^>]*>/i);
  if (start === -1) return "";
  const nextModule = html.slice(start).search(/<div\b[^>]*id=["'](?:dnd-metadata|attachmentmodule|linkingmodule|activitymodule)["'][^>]*>/i);
  const section = nextModule === -1 ? html.slice(start) : html.slice(start, start + nextModule);
  const contentBlock = section.match(/<div\b[^>]*class=["'][^"']*user-content-block[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (contentBlock) return contentBlock[1];
  return extractHtmlById(section, "description-val");
}

export function extractJiraPeopleField(html, id) {
  const start = html.search(new RegExp(`<span\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*>`, "i"));
  if (start === -1) return "";
  const end = html.indexOf("</dd>", start);
  const section = html.slice(start, end === -1 ? start + 1800 : end);
  return cleanInlineText(section);
}

export function extractJiraComments(html, baseUrl) {
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

export function extractJiraLinkedIssues(html, baseUrl) {
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

export function extractHtmlById(html, id) {
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return html.match(pattern)?.[2] || "";
}

export function extractHtmlByClass(html, className) {
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return html.match(pattern)?.[2] || "";
}

export function cleanInlineText(html) {
  return htmlToText(html).replace(/\s+/g, " ").trim();
}

export function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

export function pickMainHtml(html, adapter) {
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

export function extractLinks(html, baseUrl) {
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

export function isLikelyContentLink(href, adapter) {
  const hostname = safeHostname(href);
  if (hostname && hostname !== adapter.hostname) return false;
  const pathname = safePathname(href);
  if (adapter.sourceType === "jira") return /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(pathname);
  if (adapter.sourceType === "github") return /\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/i.test(pathname);
  if (adapter.sourceType === "confluence") return /\/(display|pages|spaces)\//i.test(pathname) || /pageId=\d+/i.test(href);
  return true;
}

export function dedupeByHref(link, seen) {
  if (seen.has(link.href)) return false;
  seen.add(link.href);
  return true;
}

export function resolveHref(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString().split("#")[0];
  } catch {
    return "";
  }
}

export function resolveHrefWithHash(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

export function inferTitle(content) {
  const firstLine = cleanText(content)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : "";
}

export function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).trim() : "";
}

export function htmlToText(html) {
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

export function decodeHtml(value) {
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
