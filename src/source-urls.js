// Recognizing sources and page kinds from URLs, canonical URLs and auth headers.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { isGithubIssueSearchUrl } from "./sources/github-issue-search.js";
import { extractContentPage, extractListPage } from "./sources/html-extractors.js";
import { extractTeamsDeepPath } from "./sources/teams-page.js";
import { detectUrl } from "./text-helpers.js";
import { cleanText, safeHostname, safePathname, safeSearch } from "./utils.js";

export function createSourceUrls(ctx) {
  function resolvePageKind(url, pageKind = "auto") {
    if (!url) return pageKind || "auto";
    if (isKnownListUrl(url)) return "list";
    if (pageKind && pageKind !== "auto") return pageKind;
    return inferPageKind(url, detectSourceAdapter(url));
  }

  function detectSourceAdapter(url) {
    const hostname = safeHostname(url);
    const configuredType = cleanText(ctx.settings.sources?.[hostname]?.sourceType || "").toLowerCase();
    if (["jira", "confluence", "github", "teams"].includes(configuredType)) {
      // A configured instance opts into the existing adapter protocol. This is
      // intentionally not a claim that every cloud/API variant is supported.
      return { id: `configured-${configuredType}`, sourceType: configuredType, hostname };
    }
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
    if (adapter.sourceType === "github" && isGithubIssueSearchUrl(url)) return true;
    return false;
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

  function buildAuthHeaders(url) {
    const hostname = safeHostname(url);
    const profile = ctx.settings.sources?.[hostname];
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

  function shouldFetchForPreview(input, pasted) {
    if (input.fetchMode === "paste") return false;
    if (input.fetchMode === "fetch") return true;
    const trimmed = cleanText(pasted);
    return !trimmed || trimmed === detectUrl(trimmed);
  }

  return { resolvePageKind, detectSourceAdapter, extractByAdapter, inferPageKind, isKnownListUrl, normalizeContentFetchUrl, buildAuthHeaders, normalizeUrlForMatch, isInvalidTeamsRootRefreshJob, isInvalidTeamsRootCapture, canonicalizeMaterialUrl, shouldFetchForPreview };
}
