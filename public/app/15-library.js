// ---------------------------------------------------------------------------
// 资料 (library): facets, grouped list
// ---------------------------------------------------------------------------

const LIBRARY_VIEWS = [
  ["all", "全部", () => true],
  ["unread", "未读", isNewContentItem],
  ["stale", "整理版待更新", (item) => Boolean(item.processedStale)],
  ["unprocessed", "还没有整理", (item) => !item.hasProcessed],
  ["left", "已移出订阅", isLeftListItem],
  ["quarantined", "隔离区", (item) => item.integrityStatus === "quarantined"]
];

// Items that dropped out of a filtered subscription (e.g. a GitHub issue search).
function isLeftListItem(item) {
  return item?.listMembership?.status === "left";
}

function isGithubIssueSearchUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return /^\/[^/]+\/[^/]+\/(issues|pulls)$/i.test(pathname) || /^\/(issues|pulls)$/i.test(pathname)
      || (pathname === "/search" && /^(issues|pullrequests)$/i.test(parsed.searchParams.get("type") || ""));
  } catch {
    return false;
  }
}

function leftItemsForJob(job) {
  return subscriptionItems(job).filter(isLeftListItem);
}

async function resolveLeftListItems(itemIds, action) {
  if (!itemIds.length) return;
  if (action === "delete" && !confirm(`删除 ${itemIds.length} 条已移出订阅的资料？删除后不能恢复。`)) return;
  try {
    await api("/api/list-membership/resolve", { method: "POST", body: JSON.stringify({ itemIds, action }) });
    notify(action === "delete" ? "已删除" : "已保留", action === "delete" ? `删除了 ${itemIds.length} 条资料。` : `${itemIds.length} 条资料保留在资料库，不再自动更新。`);
    if (action === "delete" && itemIds.includes(state.selectedId)) {
      state.selectedId = null;
    }
    await loadLibraryIndex();
    renderHomeAttention();
    renderLibraryFacets();
    if (state.view === "materials") await loadItems();
    if (state.view === "subscriptions") renderRefreshJobs(state.refreshJobs);
    if (state.selectedSubscriptionId && !subscriptionDrawer.hidden) renderSubscriptionDrawer(state.selectedSubscriptionId);
    if (state.selectedId && action === "keep") await selectItem(state.selectedId);
    if (action === "delete" && !state.selectedId && detailPanel) detailPanel.innerHTML = `<div class="empty-state">选择一条资料查看内容。</div>`;
  } catch (error) {
    notify("没能完成操作", error.message, "error");
  }
}

function renderLibraryFacets() {
  if (!facetViews) return;
  const items = state.allItems || [];
  facetViews.innerHTML = LIBRARY_VIEWS.map(([key, label, test]) => {
    const count = items.filter(test).length;
    if ((key === "quarantined" || key === "left") && !count) return "";
    return `<button type="button" class="facet ${state.libraryView === key ? "is-active" : ""}" data-library-view="${key}"><span class="facet-label">${label}</span><span class="facet-count">${count}</span></button>`;
  }).join("");
  const counts = countSources(items);
  facetSources.innerHTML = [`<button type="button" class="facet ${!state.sourceType ? "is-active" : ""}" data-library-source=""><span class="facet-label">所有来源</span><span class="facet-count">${items.length}</span></button>`,
    ...SOURCE_ORDER.filter((source) => counts.get(source)).map((source) => `
      <button type="button" class="facet ${state.sourceType === source ? "is-active" : ""}" data-library-source="${source}">${sourceMark(source)}<span class="facet-label">${escapeHtml(sourceLabel(source))}</span><span class="facet-count">${counts.get(source)}</span></button>`)].join("");
  facetViews.querySelectorAll("[data-library-view]").forEach((button) => button.addEventListener("click", async () => {
    state.libraryView = button.dataset.libraryView;
    renderLibraryFacets();
    await loadItems();
  }));
  facetSources.querySelectorAll("[data-library-source]").forEach((button) => button.addEventListener("click", async () => {
    state.sourceType = button.dataset.librarySource;
    renderLibraryFacets();
    await loadItems();
  }));
}

function renderTags() {
  if (!tagList) return;
  const tags = [...(state.tags || [])].sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.name).localeCompare(String(b.name)));
  if (!tags.length) {
    tagList.innerHTML = `<p class="facet-empty">还没有标签。打开资料后可以添加，也可以让 AI 推荐。</p>`;
    return;
  }
  const limit = state.showAllTags ? tags.length : 14;
  const favorites = favoriteTags();
  tagList.innerHTML = tags.slice(0, limit).map((tag) => `
    <div class="facet-tag-row">
      <button type="button" class="facet facet-tag ${state.tag === tag.name ? "is-active" : ""}" data-library-tag="${escapeHtml(tag.name)}"><span class="facet-label">${escapeHtml(tag.name)}</span><span class="facet-count">${escapeHtml(tag.count ?? "")}</span></button>
      <button type="button" class="star-toggle ${favorites.includes(tag.name) ? "is-on" : ""}" data-favorite-tag="${escapeHtml(tag.name)}" aria-pressed="${favorites.includes(tag.name)}" title="${favorites.includes(tag.name) ? "取消关注" : "关注这个标签（加入专题）"}">${favorites.includes(tag.name) ? "★" : "☆"}</button>
    </div>`).join("")
    + (tags.length > 14 ? `<button type="button" class="facet-more" data-toggle-tags>${state.showAllTags ? "收起" : `显示全部 ${tags.length} 个标签`}</button>` : "");
  tagList.querySelectorAll("[data-library-tag]").forEach((button) => button.addEventListener("click", async () => {
    state.tag = state.tag === button.dataset.libraryTag ? "" : button.dataset.libraryTag;
    renderTags();
    await loadItems();
  }));
  tagList.querySelectorAll("[data-favorite-tag]").forEach((button) => button.addEventListener("click", () => toggleFavoriteTag(button.dataset.favoriteTag)));
  tagList.querySelector("[data-toggle-tags]")?.addEventListener("click", () => {
    state.showAllTags = !state.showAllTags;
    renderTags();
  });
}

function libraryFilterNeedsFullList() {
  return ["stale", "unprocessed", "left"].includes(state.libraryView) || Boolean(state.subscriptionScope);
}

function libraryParams(page, pageSize) {
  const params = new URLSearchParams();
  if (state.sourceType) params.set("sourceType", state.sourceType);
  if (state.tag) params.set("tag", state.tag);
  if (state.query) params.set("q", state.query);
  if (state.libraryView === "quarantined") params.set("integrityStatus", "quarantined");
  if (state.libraryView === "unread") params.set("updates", "1");
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params;
}

function applyClientLibraryFilters(items) {
  const viewTest = LIBRARY_VIEWS.find(([key]) => key === state.libraryView)?.[2] || (() => true);
  const scope = state.subscriptionScope;
  return items.filter((item) => viewTest(item) && (!scope || scope.itemIds.has(item.id)));
}

async function loadItems() {
  if (!state.query && Array.isArray(state.allItems)) {
    // The full list is already here (loadLibraryIndex); filter it instead of
    // asking the server again. Only full-text search needs the server.
    state.items = applyClientLibraryFilters(state.allItems.filter((item) =>
      (!state.sourceType || item.sourceType === state.sourceType)
      && (!state.tag || (item.tags || []).includes(state.tag))));
    state.page = 1;
    state.totalItems = state.items.length;
    state.listClassification = null;
    renderListScope();
    renderItems();
    renderMaterialsNewBadge();
    return;
  }
  const full = libraryFilterNeedsFullList();
  const { items, total } = await api(`/api/items?${libraryParams(1, full ? 2000 : state.pageSize)}`);
  state.items = full ? applyClientLibraryFilters(items || []) : (items || []);
  state.page = 1;
  state.totalItems = full ? state.items.length : Number(total ?? state.items.length);
  state.listClassification = null;
  renderListScope();
  renderItems();
  renderMaterialsNewBadge();
}

async function loadMoreItems() {
  if (state.items.length >= state.totalItems || libraryFilterNeedsFullList()) return;
  const { items, total } = await api(`/api/items?${libraryParams(state.page + 1, state.pageSize)}`);
  state.items = [...state.items, ...(items || [])];
  state.page += 1;
  state.totalItems = Number(total ?? state.items.length);
  renderItems();
}

function renderListScope() {
  if (!listScope) return;
  const chips = [];
  const view = LIBRARY_VIEWS.find(([key]) => key === state.libraryView);
  if (state.libraryView !== "all" && view) chips.push({ key: "view", label: view[1] });
  if (state.sourceType) chips.push({ key: "source", label: sourceLabel(state.sourceType) });
  if (state.tag) chips.push({ key: "tag", label: `标签：${state.tag}` });
  if (state.subscriptionScope) chips.push({ key: "scope", label: `订阅：${state.subscriptionScope.name}` });
  listScope.hidden = !chips.length;
  listScope.innerHTML = chips.map((chip) => `<button type="button" class="scope-chip" data-clear-scope="${chip.key}" aria-label="移除筛选 ${escapeHtml(chip.label)}">${escapeHtml(chip.label)}<span aria-hidden="true">×</span></button>`).join("")
    + (chips.length > 1 ? `<button type="button" class="quiet-button" data-clear-scope="all">清除全部</button>` : "");
  listScope.querySelectorAll("[data-clear-scope]").forEach((button) => button.addEventListener("click", async () => {
    const key = button.dataset.clearScope;
    if (key === "view" || key === "all") state.libraryView = "all";
    if (key === "source" || key === "all") state.sourceType = "";
    if (key === "tag" || key === "all") state.tag = "";
    if (key === "scope" || key === "all") state.subscriptionScope = null;
    renderLibraryFacets();
    renderTags();
    await loadItems();
  }));
}

function renderItems() {
  const classified = state.listClassification?.groups?.length;
  resultCount.textContent = `${state.totalItems || state.items.length} 条${classified ? `，已分成 ${state.listClassification.groups.length} 类` : ""}`;
  classifyListButton.textContent = state.listClassifying ? "正在分类……" : classified ? "重新用 AI 分类" : "用 AI 给当前列表分类";
  classifyListButton.disabled = state.listClassifying || !state.items.length;
  if (!state.items.length) {
    const filtered = state.query || state.tag || state.sourceType || state.libraryView !== "all" || state.subscriptionScope;
    itemList.innerHTML = `<div class="empty-state compact">${filtered ? "没有符合当前筛选的资料。" : "资料库还是空的。点左侧“添加资料”保存第一条。"}</div>`;
    return;
  }
  if (classified) {
    renderClassifiedItems();
    return;
  }
  const groups = new Map();
  for (const item of state.items) {
    const bucket = state.query ? "搜索结果" : dayBucket(itemActivityTime(item));
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(item);
  }
  itemList.innerHTML = [...groups.entries()].map(([bucket, entries]) => `
    <section class="item-group" aria-label="${escapeHtml(bucket)}">
      <h3 class="item-group-label">${escapeHtml(bucket)}</h3>
      ${entries.map(renderItemCard).join("")}
    </section>`).join("")
    + (state.items.length < state.totalItems ? `<button class="load-more-button" type="button" data-load-more>再显示 ${Math.min(state.pageSize, state.totalItems - state.items.length)} 条（还有 ${state.totalItems - state.items.length} 条）</button>` : "");
  bindItemCards();
  itemList.querySelector("[data-load-more]")?.addEventListener("click", loadMoreItems);
}

function renderItemCard(item) {
  const unread = isNewContentItem(item);
  const flags = [
    item.integrityStatus === "quarantined" ? `<span class="flag" data-tone="error">已隔离</span>` : "",
    item.processedStale ? `<span class="flag">整理版待更新</span>` : !item.hasProcessed ? `<span class="flag" data-tone="muted">未整理</span>` : ""
  ].join("");
  return `
    <button type="button" class="item-card item-row ${state.selectedId === item.id ? "is-selected" : ""} ${unread ? "is-unread" : ""}" data-id="${escapeHtml(item.id)}" ${state.selectedId === item.id ? 'aria-current="true"' : ""}>
      ${sourceMark(item.sourceType)}
      <span class="item-main">
        <span class="item-title">${escapeHtml(item.title || "未命名资料")}</span>
        <span class="item-sub"><time datetime="${escapeHtml(itemActivityTime(item))}">${escapeHtml(relativeTime(itemActivityTime(item)))}</time>${flags}</span>
        ${previewLine(item)}
      </span>
      ${unread ? `<span class="unread-dot" title="有未读的新内容"></span>` : ""}
    </button>`;
}

