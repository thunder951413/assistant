import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildGithubIssueSearchApiUrls, collectGithubIssueRows, expandGithubSearchQuery, githubIssueRowsToEntries, githubIssueSearchScope, isGithubIssueSearchUrl } from "../src/sources/github-issue-search.js";
import { diffListMembership, membershipPatch, shouldSkipByListFingerprint } from "../src/list-membership.js";

const SEARCH = "https://github.example.com/VD-SOC-AML/26_T950D5/issues?q=is%3Aissue%20(involves%3A%40me%20OR%20involves%3Ajing-li1)%20state%3Aopen";

test("recognizes GitHub issue search pages but not single issues", () => {
  assert.equal(isGithubIssueSearchUrl(SEARCH), true);
  assert.equal(isGithubIssueSearchUrl("https://github.example.com/o/r/pulls"), true);
  assert.equal(isGithubIssueSearchUrl("https://github.example.com/issues?q=assignee%3A%40me"), true);
  assert.equal(isGithubIssueSearchUrl("https://github.example.com/search?q=foo&type=issues"), true);
  assert.equal(isGithubIssueSearchUrl("https://github.example.com/o/r/issues/12"), false);
  assert.equal(isGithubIssueSearchUrl("https://github.example.com/notifications"), false);
  const scope = githubIssueSearchScope(SEARCH);
  assert.equal(scope.repository, "VD-SOC-AML/26_T950D5");
  assert.equal(scope.query, "is:issue (involves:@me OR involves:jing-li1) state:open");
  const apis = buildGithubIssueSearchApiUrls(SEARCH, "https://github.example.com");
  assert.deepEqual(apis.map((api) => api.searchParams.get("q")), [
    "repo:VD-SOC-AML/26_T950D5 is:issue involves:@me state:open",
    "repo:VD-SOC-AML/26_T950D5 is:issue involves:jing-li1 state:open"
  ]);
  assert.deepEqual(expandGithubSearchQuery("is:issue (label:a OR label:b) (author:x OR author:y)").length, 4);
  assert.deepEqual(expandGithubSearchQuery("is:issue label:a"), ["is:issue label:a"]);
});

test("collects rows from a React-style issue list", () => {
  const dom = new JSDOM(`<body>
    <header><a href="/VD-SOC-AML/26_T950D5/issues/1">pinned nav</a></header>
    <ul>
      <li><div><h3><a href="/VD-SOC-AML/26_T950D5/issues/2653">BM-Hurdle: CI auth timeout</a></h3>
        <span>#2653 · opened <relative-time datetime="2026-10-01T02:00:00Z"></relative-time></span>
        <a href="/VD-SOC-AML/26_T950D5/issues?q=label%3Abm">bm</a>
        <a href="/VD-SOC-AML/26_T950D5/issues/2653" aria-label="7 comments"><svg></svg>7</a></div></li>
      <li><div><h3><a href="/VD-SOC-AML/26_T950D5/issues/2078">PCM signal control</a></h3>
        <span>opened <relative-time datetime="2026-08-01T00:00:00Z"></relative-time></span></div></li>
    </ul>
    <nav><a rel="next" href="/VD-SOC-AML/26_T950D5/issues?q=x&page=2">Next</a></nav>
  </body>`, { url: SEARCH });
  const result = collectGithubIssueRows(SEARCH, dom.window.document);
  assert.deepEqual(result.rows.map((row) => row.number), ["2653", "2078"]);
  const [first] = result.rows;
  assert.equal(first.title, "BM-Hurdle: CI auth timeout");
  assert.equal(first.commentCount, 7);
  assert.deepEqual(first.labels, ["bm"]);
  assert.equal(first.href, "https://github.example.com/VD-SOC-AML/26_T950D5/issues/2653");
  assert.match(result.nextHref, /page=2/);
  const entries = githubIssueRowsToEntries(result.rows);
  assert.equal(entries[0].source, "github-issue-search");
  assert.notEqual(entries[0].fingerprint, entries[1].fingerprint);
});

test("collects rows from a classic issue list and confirms empty results", () => {
  const classic = new JSDOM(`<body><div id="issue_54" class="js-issue-row">
      <a class="Link--primary" href="/VD-SOC-AML/demod/issues/54">Demod lock lost</a>
      <span>#54 opened <relative-time datetime="2026-09-01T00:00:00Z"></relative-time></span>
      <a href="/VD-SOC-AML/demod/issues/54" aria-label="2 comments">2</a></div></body>`, { url: SEARCH });
  const rows = collectGithubIssueRows(SEARCH, classic.window.document).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].commentCount, 2);

  const empty = new JSDOM(`<body><p>No results matched your search.</p></body>`, { url: SEARCH });
  const result = collectGithubIssueRows(SEARCH, empty.window.document);
  assert.equal(result.rows.length, 0);
  assert.equal(result.emptyConfirmed, true);
});

test("membership: only a complete list marks items as left; returning items rejoin", () => {
  const children = [
    { id: "a", url: "https://g/x/issues/1" },
    { id: "b", url: "https://g/x/issues/2" },
    { id: "c", url: "https://g/x/issues/3", listMembership: { status: "left" } },
    { id: "d", url: "https://g/x/issues/4", listMembership: { status: "kept" } }
  ];
  const currentKeys = new Set(["https://g/x/issues/1", "https://g/x/issues/3"]);
  const complete = diffListMembership({ children, currentKeys, complete: true });
  assert.deepEqual(complete.left.map((item) => item.id), ["b"]);
  assert.deepEqual(complete.returned.map((item) => item.id), ["c"]);
  const partial = diffListMembership({ children, currentKeys, complete: false });
  assert.deepEqual(partial.left, []);
  const kept = membershipPatch("kept", "https://g/list", "2026-10-14T00:00:00Z", { leftAt: "2026-10-01T00:00:00Z" });
  assert.equal(kept.leftAt, "2026-10-01T00:00:00Z");
});

test("list row fingerprint skips unchanged issues for a week", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  const existing = { listFingerprint: "t|3|x", lastFetchedAt: "2026-10-10T00:00:00Z" };
  assert.equal(shouldSkipByListFingerprint(existing, "t|3|x", now), true);
  assert.equal(shouldSkipByListFingerprint(existing, "t|4|x", now), false);
  assert.equal(shouldSkipByListFingerprint({ ...existing, lastFetchedAt: "2026-09-01T00:00:00Z" }, "t|3|x", now), false);
});

test("a single result stays inside its own row", () => {
  const dom = new JSDOM(`<body><main><aside><relative-time datetime="2020-01-01T00:00:00Z"></relative-time></aside>
    <ul><li><a href="/o/r/issues/9">Only one</a> <relative-time datetime="2026-10-02T00:00:00Z"></relative-time></li></ul></main></body>`, { url: "https://github.example.com/o/r/issues?q=x" });
  const [row] = collectGithubIssueRows("https://github.example.com/o/r/issues?q=x", dom.window.document).rows;
  assert.deepEqual(row.times, ["2026-10-02T00:00:00Z"]);
});

test("new GitHub list: pinned issues are not results and the Open count is read", () => {
  const url = "https://github.example.com/o/r/issues?q=is%3Aissue%20state%3Aopen";
  const dom = new JSDOM(`<body>
    <div class="PinnedIssues-module__area--x"><ul><li class="PinnedIssues-module__container--y"><a href="/o/r/issues/2247">[Request] QA checklist</a></li></ul></div>
    <div><a href="#">Open 2</a><a href="#">Closed 61</a></div>
    <ul><li role="listitem"><h3><a data-testid="issue-pr-title-link" href="/o/r/issues/2653">[CAM test] No signal</a></h3>
      <a href="/o/r/issues?q=label%3AAML">AML</a><relative-time data-testid="created-at" datetime="2026-10-07T12:51:02.000Z"></relative-time>
      <div data-testid="list-row-comments" aria-label=" 18 comments;">18</div></li>
    <li role="listitem"><h3><a data-testid="issue-pr-title-link" href="/o/r/issues/2640">[Sola-F] freeze</a></h3></li></ul></body>`, { url });
  const result = collectGithubIssueRows(url, dom.window.document);
  assert.deepEqual(result.rows.map((row) => row.number), ["2653", "2640"]);
  assert.equal(result.rows[0].commentCount, 18);
  assert.deepEqual(result.rows[0].labels, ["AML"]);
  assert.equal(result.expectedCount, 2);
});
