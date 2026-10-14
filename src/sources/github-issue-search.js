// GitHub issue / PR search pages as subscriptions:
//   /{owner}/{repo}/issues?q=...   /{owner}/{repo}/pulls?q=...
//   /issues?q=...  /pulls?q=...    /search?q=...&type=issues
// The list decides membership; each issue is captured as its own item.

const ISSUE_PATH = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/i;

export function isGithubIssueSearchUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (/^\/[^/]+\/[^/]+\/(issues|pulls)$/i.test(pathname)) return true;
  if (/^\/(issues|pulls)$/i.test(pathname)) return true;
  if (pathname === "/search") {
    const type = String(parsed.searchParams.get("type") || "").toLowerCase();
    return type === "issues" || type === "pullrequests";
  }
  return false;
}

export function githubIssueSearchScope(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pulls)\/?$/i);
  const query = cleanQuery(parsed.searchParams.get("q") || "");
  const kind = match ? (match[3].toLowerCase() === "pulls" ? "pr" : "issue") : (/^\/pulls/i.test(parsed.pathname) ? "pr" : "issue");
  const defaultQuery = kind === "pr" ? "is:pr is:open" : "is:issue is:open";
  return {
    repository: match ? `${match[1]}/${match[2]}` : "",
    query: query || defaultQuery,
    kind
  };
}

export function buildGithubIssueSearchApiUrl(url, origin, perPage = 100) {
  const scope = githubIssueSearchScope(url);
  const q = [scope.repository && !/\brepo:/i.test(scope.query) ? `repo:${scope.repository}` : "", scope.query].filter(Boolean).join(" ");
  const apiUrl = new URL(`${origin}/api/v3/search/issues`);
  apiUrl.searchParams.set("q", q);
  apiUrl.searchParams.set("per_page", String(Math.max(1, Math.min(100, Number(perPage) || 100))));
  apiUrl.searchParams.set("sort", "updated");
  apiUrl.searchParams.set("order", "desc");
  // Needed for parentheses / OR on newer GitHub; ignored by servers without it.
  apiUrl.searchParams.set("advanced_search", "true");
  return apiUrl;
}

export function githubIssueSearchPageUrl(url, page) {
  const parsed = new URL(url);
  if (page <= 1) parsed.searchParams.delete("page");
  else parsed.searchParams.set("page", String(page));
  return parsed.toString();
}

// Runs inside the browser page (Playwright serializes it), and in tests with a
// DOM. It must stay self-contained: no imports, no outer variables.
// Rows are found structurally: start from each issue link and climb while the
// ancestor still only contains links to that one issue.
export function collectGithubIssueRows(baseUrl, doc) {
  doc = doc || document;
  const issuePath = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/i;
  const base = new URL(baseUrl);
  const keyOf = (anchor) => {
    let parsed;
    try { parsed = new URL(anchor.getAttribute("href") || "", base); } catch { return null; }
    if (parsed.host !== base.host) return null;
    const match = parsed.pathname.match(issuePath);
    if (!match) return null;
    return {
      key: `${match[1]}/${match[2]}#${match[4]}`.toLowerCase(),
      href: `${parsed.origin}/${match[1]}/${match[2]}/${match[3].toLowerCase() === "pull" ? "pull" : "issues"}/${match[4]}`,
      repository: `${match[1]}/${match[2]}`,
      number: match[4],
      kind: match[3].toLowerCase() === "pull" ? "pr" : "issue",
      hasHash: Boolean(parsed.hash)
    };
  };
  const textOf = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
  const isTitleText = (text) => text && !/^#?\d+$/.test(text) && !/^\d+\s+comments?$/i.test(text);
  const groups = new Map();
  for (const anchor of doc.querySelectorAll("a[href]")) {
    if (anchor.closest("nav, header, footer, [role='navigation']")) continue;
    const info = keyOf(anchor);
    if (!info) continue;
    if (!groups.has(info.key)) groups.set(info.key, { info, anchors: [] });
    groups.get(info.key).anchors.push(anchor);
  }
  const distinctKeys = (element) => {
    const keys = new Set();
    for (const anchor of element.querySelectorAll("a[href]")) {
      const info = keyOf(anchor);
      if (info) keys.add(info.key);
      if (keys.size > 1) break;
    }
    return keys.size;
  };
  const rows = [];
  for (const { info, anchors } of groups.values()) {
    const titleAnchor = anchors.filter((anchor) => !keyOf(anchor).hasHash && isTitleText(textOf(anchor)))
      .sort((a, b) => textOf(b).length - textOf(a).length)[0];
    if (!titleAnchor) continue;
    let row = titleAnchor;
    const rowLike = "li, tr, [role='listitem'], [role='row'], .js-issue-row, [data-testid='list-view-item']";
    while (!row.matches(rowLike) && row.parentElement && row.parentElement !== doc.body && distinctKeys(row.parentElement) <= 1) row = row.parentElement;
    const times = [...row.querySelectorAll("relative-time[datetime], time[datetime]")]
      .map((node) => node.getAttribute("datetime"))
      .filter(Boolean)
      .sort();
    let commentCount = null;
    for (const node of row.querySelectorAll("[aria-label]")) {
      const match = String(node.getAttribute("aria-label")).match(/(\d+)\s+comments?/i);
      if (match) { commentCount = Number(match[1]); break; }
    }
    if (commentCount === null) {
      const countAnchor = anchors.find((anchor) => row.contains(anchor) && /^\d+$/.test(textOf(anchor)));
      if (countAnchor) commentCount = Number(textOf(countAnchor));
    }
    const labels = [...row.querySelectorAll("a[href*='label%3A'], a[href*='label:'], [data-name], .IssueLabel")]
      .map(textOf).filter(Boolean).slice(0, 12);
    const rowText = textOf(row);
    rows.push({
      href: info.href,
      repository: info.repository,
      number: info.number,
      kind: info.kind,
      title: textOf(titleAnchor),
      times,
      latestTime: times.at(-1) || "",
      commentCount,
      labels,
      closed: /\bClosed\b/.test(rowText) && !/\bOpen\b/.test(rowText)
    });
  }
  const nextLink = doc.querySelector("a[rel='next'], a[aria-label='Next Page'], a[aria-label='Next page'], a.next_page:not(.disabled)");
  const bodyText = textOf(doc.body).slice(0, 20000);
  return {
    rows,
    nextHref: nextLink ? new URL(nextLink.getAttribute("href"), base).toString() : "",
    emptyConfirmed: rows.length === 0 && /No results|No (open |closed )?(issues|pull requests)|didn't match any|0 Open|没有结果/i.test(bodyText),
    totalText: (bodyText.match(/([\d,]+)\s+(Open|results?)\b/i) || [])[0] || ""
  };
}

// Cheap change signal from the list row: when the title, comment count and the
// row's timestamps are unchanged, the issue page does not need a re-fetch.
export function githubIssueRowFingerprint(row) {
  return [row.title || "", row.commentCount ?? "", (row.times || []).join(",") || row.updatedAt || "", (row.labels || []).join(",")].join("|");
}

export function githubIssueRowsToEntries(rows) {
  return rows.map((row) => ({
    key: row.number ? `#${row.number}` : "",
    number: row.number,
    title: row.title,
    href: row.href,
    repository: row.repository,
    updatedAt: /^\d{4}-\d{2}-\d{2}T/.test(row.updatedAt || "") ? row.updatedAt : "",
    fingerprint: githubIssueRowFingerprint(row),
    commentCount: row.commentCount,
    labels: row.labels || [],
    source: "github-issue-search"
  }));
}

export function renderGithubIssueSearchText(title, url, adapterId, entries, note = "") {
  const scope = githubIssueSearchScope(url);
  return [
    `# ${title}`,
    "",
    `Source: ${url}`,
    `Adapter: ${adapterId}`,
    scope.repository ? `Repository: ${scope.repository}` : "",
    `Query: ${scope.query}`,
    note,
    "",
    `## Results (${entries.length})`,
    "",
    ...(entries.length
      ? entries.map((entry) => `- [${entry.title || entry.href}](${entry.href}) ${[entry.repository, entry.key, entry.commentCount != null ? `${entry.commentCount} comments` : "", entry.labels?.length ? entry.labels.join(", ") : ""].filter(Boolean).join(" · ")}`)
      : ["_No matching issues._"])
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

export function githubIssueSearchTitle(url) {
  const scope = githubIssueSearchScope(url);
  return `${scope.repository || "GitHub"} ${scope.kind === "pr" ? "PR" : "issue"} 搜索：${scope.query}`.slice(0, 160);
}

export function isGithubIssueContentUrl(url) {
  try { return ISSUE_PATH.test(new URL(url).pathname); } catch { return false; }
}

function cleanQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
