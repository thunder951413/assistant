// Confluence comment collection with pagination and threaded replies.
// `requestJson(url)` is injected (it carries auth, timeouts and abort signals) and
// must resolve to `{ data }` or throw; an error with `status` 400 means the server
// rejected a query parameter.

export const CONFLUENCE_COMMENT_PAGE_SIZE = 100;
export const CONFLUENCE_COMMENT_MAX_PAGES = 30;

function commentsUrl(origin, pageId, { start = 0, depthAll = true } = {}) {
  const params = new URLSearchParams({
    limit: String(CONFLUENCE_COMMENT_PAGE_SIZE),
    start: String(start),
    expand: "body.storage,version,ancestors"
  });
  // depth=all includes replies to comments, not only top-level comments.
  if (depthAll) params.set("depth", "all");
  return `${origin}/rest/api/content/${encodeURIComponent(pageId)}/child/comment?${params}`;
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

// Returns the next page URL, or null when the server points somewhere other than
// the configured origin. Credentials are attached for the configured host only, so a
// misconfigured Confluence base URL (e.g. an internal http:// host behind a proxy)
// must never receive them; the caller then reports the comments as truncated.
export function resolveNext(origin, data) {
  const next = data?._links?.next;
  if (!next) return "";
  if (/^https?:\/\//i.test(next)) return sameOrigin(next, origin) ? next : null;
  const base = data?._links?.base;
  // next omits the context path (e.g. /wiki). Prefer base when it is on our origin,
  // otherwise rebuild the prefix from _links.context.
  const prefix = base && sameOrigin(base, origin)
    ? String(base)
    : `${origin}${String(data?._links?.context || "")}`;
  return `${prefix.replace(/\/$/, "")}${next.startsWith("/") ? "" : "/"}${next}`;
}

export async function collectConfluenceComments(origin, pageId, requestJson, { maxPages = CONFLUENCE_COMMENT_MAX_PAGES } = {}) {
  let depthAll = true;
  let url = commentsUrl(origin, pageId, { depthAll });
  const results = [];
  const seen = new Set();
  let pages = 0;
  while (url && pages < maxPages) {
    let data;
    try {
      ({ data } = await requestJson(url));
    } catch (error) {
      // Older servers reject depth=all; retry the same page without it once.
      if (depthAll && pages === 0 && Number(error?.status) === 400) {
        depthAll = false;
        url = commentsUrl(origin, pageId, { depthAll });
        continue;
      }
      throw error;
    }
    pages += 1;
    for (const comment of data?.results || []) {
      const id = String(comment?.id || "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      results.push(comment);
    }
    url = resolveNext(origin, data);
    if (url === null) return { results, pageCount: pages, truncated: true, repliesIncluded: depthAll, offOriginNext: true };
  }
  return { results, pageCount: pages, truncated: Boolean(url), repliesIncluded: depthAll };
}

export function normalizeConfluenceComment(comment, pageUrl, toMarkdown) {
  const ancestors = Array.isArray(comment?.ancestors) ? comment.ancestors : [];
  const parent = ancestors.filter((ancestor) => ancestor?.type === "comment").at(-1);
  return {
    id: String(comment?.id || ""),
    author: String(comment?.version?.by?.displayName || "").trim(),
    createdAt: String(comment?.version?.when || "").trim(),
    body: toMarkdown(comment?.body?.storage?.value || "", pageUrl),
    url: `${pageUrl}#comment-${comment?.id}`,
    ...(parent?.id ? { parentId: String(parent.id) } : {})
  };
}
