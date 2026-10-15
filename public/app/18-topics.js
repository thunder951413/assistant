// ---------------------------------------------------------------------------
// Topics (followed tags) and the time-ordered message stream
// ---------------------------------------------------------------------------
const topicsView = document.querySelector("#topicsView");
const topicList = document.querySelector("#topicList");
const topicMain = document.querySelector("#topicMain");
const manageTopicsButton = document.querySelector("#manageTopicsButton");
const navTopicsCount = document.querySelector("#navTopicsCount");
const feedModeToggle = document.querySelector("#feedModeToggle");
const streamFilters = document.querySelector("#streamFilters");
const ALL_TOPICS = "*";
const DAY_CHOICES = [1, 3, 7, 14, 30];

Object.assign(state, {
  topics: null,
  selectedTopic: "",
  topicTab: "recent",
  topicDays: 7,
  topicDigests: {},
  topicBusy: "",
  topicPickerOpen: false,
  topicPickerQuery: "",
  topicStream: null,
  feedMode: (() => { try { return localStorage.getItem("materialOrganizer.feedMode") || "topic"; } catch { return "topic"; } })(),
  streamDays: 3,
  streamUnreadOnly: false,
  homeStream: null
});

function favoriteTags() {
  return state.topics?.favorites?.map((topic) => topic.tag) || state.settings?.favoriteTags || [];
}

function topicLabel(tag) {
  return tag === ALL_TOPICS ? "全部关注" : tag;
}

async function loadTopics() {
  try {
    state.topics = await api("/api/topics");
  } catch (error) {
    notify("没能读取专题", error.message, "error");
    return;
  }
  const tags = favoriteTags();
  if (!state.selectedTopic || (state.selectedTopic !== ALL_TOPICS && !tags.includes(state.selectedTopic))) {
    state.selectedTopic = tags.length > 1 ? ALL_TOPICS : tags[0] || "";
  }
  renderNavTopicsCount();
  renderTopics();
  if (state.selectedTopic) await loadTopicDetail(state.selectedTopic);
}

function renderNavTopicsCount() {
  if (!navTopicsCount) return;
  const unread = (state.topics?.favorites || []).reduce((sum, topic) => sum + (topic.unreadCount || 0), 0);
  navTopicsCount.hidden = !unread;
  navTopicsCount.textContent = unread ? String(unread) : "";
}

async function setFavoriteTags(tags) {
  try {
    state.topics = await api("/api/topics/favorites", { method: "POST", body: JSON.stringify({ tags }) });
    state.settings = { ...(state.settings || {}), favoriteTags: state.topics.favorites.map((topic) => topic.tag) };
    renderNavTopicsCount();
    if (state.view === "topics") renderTopics();
    if (state.view === "materials") renderTags();
    return true;
  } catch (error) {
    notify("没能保存关注的标签", error.message, "error");
    return false;
  }
}

async function toggleFavoriteTag(tag) {
  if (!state.topics) await loadTopics();
  const current = favoriteTags();
  const next = current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag];
  if (await setFavoriteTags(next)) {
    notify(next.includes(tag) ? "已关注" : "已取消关注", next.includes(tag) ? `「${tag}」已加入专题。` : `「${tag}」已从专题移除。`);
  }
}

function renderTopics() {
  if (!topicList || !topicMain) return;
  const favorites = state.topics?.favorites || [];
  const all = state.topics?.all;
  const row = (topic, label) => `
    <button type="button" class="topic-row ${state.selectedTopic === topic.tag ? "is-active" : ""}" data-topic="${escapeHtml(topic.tag)}">
      <span class="topic-name">${topic.tag === ALL_TOPICS ? "" : `<span class="topic-star" aria-hidden="true">★</span>`}${escapeHtml(label)}</span>
      <span class="topic-meta">${escapeHtml(topic.itemCount)} 条资料${topic.weekEventCount ? ` · 7 天 ${escapeHtml(topic.weekEventCount)} 条动态` : ""}</span>
      ${topic.unreadCount ? `<span class="pill" data-status="accent">${escapeHtml(topic.unreadCount)} 新</span>` : ""}
    </button>`;
  topicList.innerHTML = favorites.length
    ? `${all && favorites.length > 1 ? row(all, "全部关注") : ""}${favorites.map((topic) => row(topic, topic.tag)).join("")}`
    : `<p class="facet-empty">还没有关注的标签。</p>`;
  topicList.querySelectorAll("[data-topic]").forEach((button) => button.addEventListener("click", async () => {
    state.selectedTopic = button.dataset.topic;
    state.topicPickerOpen = false;
    renderTopics();
    await loadTopicDetail(state.selectedTopic);
  }));
  if (state.topicPickerOpen || !favorites.length) {
    renderTopicPicker();
    return;
  }
  renderTopicMain();
}

function renderTopicPicker() {
  const tags = state.topics?.tags || [];
  const query = state.topicPickerQuery.trim().toLowerCase();
  const shown = tags.filter((tag) => !query || tag.tag.toLowerCase().includes(query));
  topicMain.innerHTML = `
    <div class="topic-picker">
      <div class="section-head">
        <h2>选择要关注的标签</h2>
        ${favoriteTags().length ? `<button type="button" class="quiet-button" data-picker-close>完成</button>` : ""}
      </div>
      <p class="muted">关注的标签会成为专题。之后在资料页的标签旁点 ★ 也可以加入或取消。</p>
      <input type="search" class="topic-picker-search" placeholder="筛选标签" value="${escapeHtml(state.topicPickerQuery)}" aria-label="筛选标签" />
      <div class="topic-picker-list">
        ${shown.map((tag) => `
          <button type="button" class="tag-choice ${tag.favorite ? "is-on" : ""}" data-pick-tag="${escapeHtml(tag.tag)}" aria-pressed="${tag.favorite}">
            <span aria-hidden="true">${tag.favorite ? "★" : "☆"}</span>${escapeHtml(tag.tag)}<span class="count">${escapeHtml(tag.count)}</span>
          </button>`).join("") || `<p class="muted">没有匹配的标签。</p>`}
      </div>
    </div>`;
  const search = topicMain.querySelector(".topic-picker-search");
  search.addEventListener("input", () => {
    state.topicPickerQuery = search.value;
    const caret = search.selectionStart;
    renderTopicPicker();
    const next = topicMain.querySelector(".topic-picker-search");
    next.focus();
    next.setSelectionRange(caret, caret);
  });
  topicMain.querySelector("[data-picker-close]")?.addEventListener("click", async () => {
    state.topicPickerOpen = false;
    await loadTopics();
  });
  topicMain.querySelectorAll("[data-pick-tag]").forEach((button) => button.addEventListener("click", async () => {
    const tag = button.dataset.pickTag;
    const current = favoriteTags();
    await setFavoriteTags(current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]);
    state.topicPickerOpen = true;
    renderTopics();
  }));
}

async function loadTopicDetail(tag) {
  try {
    const { digest } = await api(`/api/topics/${encodeURIComponent(tag)}/digest`);
    state.topicDigests[tag] = digest;
  } catch {
    state.topicDigests[tag] = { overview: null, recent: {} };
  }
  if (state.topicTab === "stream" || state.topicTab === "recent") await loadTopicStream(tag);
  if (!state.allItems?.length) await loadLibraryIndex();
  if (state.view === "topics" && state.selectedTopic === tag && !state.topicPickerOpen) renderTopicMain();
}

async function loadTopicStream(tag) {
  try {
    const params = new URLSearchParams({ tag, days: String(state.topicDays), limit: "500" });
    state.topicStream = { tag, days: state.topicDays, ...(await api(`/api/stream?${params}`)) };
  } catch {
    state.topicStream = { tag, days: state.topicDays, events: [], total: 0 };
  }
}

function topicMembers(tag) {
  const tags = favoriteTags();
  return (state.allItems || []).filter((item) => tag === ALL_TOPICS ? tags.some((value) => (item.tags || []).includes(value)) : (item.tags || []).includes(tag));
}

function renderTopicMain() {
  const tag = state.selectedTopic;
  if (!tag) { renderTopicPicker(); return; }
  const topic = tag === ALL_TOPICS ? state.topics?.all : state.topics?.favorites?.find((entry) => entry.tag === tag);
  if (!topic) { topicMain.innerHTML = `<div class="empty-state">选择左侧的专题。</div>`; return; }
  const tabs = [["recent", "最近更新"], ["overview", "总览"], ["stream", "消息"], ["items", "资料"]];
  topicMain.innerHTML = `
    <header class="topic-head">
      <div>
        <h2>${tag === ALL_TOPICS ? "" : `<span class="topic-star" aria-hidden="true">★</span>`}${escapeHtml(topicLabel(tag))}</h2>
        <p class="muted">${escapeHtml(topic.itemCount)} 条资料，来自 ${topic.sources.map((source) => escapeHtml(sourceLabel(source))).join("、") || "—"}${topic.lastActivityAt ? `，最近活动 ${escapeHtml(relativeTime(topic.lastActivityAt))}` : ""}</p>
      </div>
      ${tag === ALL_TOPICS ? "" : `<button type="button" class="quiet-button" data-unfollow>取消关注</button>`}
    </header>
    <div class="segmented topic-tabs" role="tablist">
      ${tabs.map(([key, label]) => `<button type="button" role="tab" data-topic-tab="${key}" aria-selected="${state.topicTab === key}">${label}</button>`).join("")}
    </div>
    <div class="topic-body">${renderTopicTab(tag, topic)}</div>`;
  topicMain.querySelector("[data-unfollow]")?.addEventListener("click", () => toggleFavoriteTag(tag));
  topicMain.querySelectorAll("[data-topic-tab]").forEach((button) => button.addEventListener("click", async () => {
    state.topicTab = button.dataset.topicTab;
    if ((state.topicTab === "stream" || state.topicTab === "recent") && (state.topicStream?.tag !== tag || state.topicStream?.days !== state.topicDays)) await loadTopicStream(tag);
    renderTopicMain();
  }));
  bindTopicTab(tag);
}

function daysPicker(current, attr) {
  return `<div class="day-picker" role="group" aria-label="时间范围">最近
    ${DAY_CHOICES.map((days) => `<button type="button" ${attr}="${days}" aria-pressed="${days === current}">${days} 天</button>`).join("")}
    <label class="day-custom">或 <input type="number" min="1" max="90" value="${DAY_CHOICES.includes(current) ? "" : escapeHtml(current)}" placeholder="N" ${attr}-input /> 天</label>
  </div>`;
}

function renderDigestBlock(entry, emptyText) {
  if (!entry) return `<div class="empty-state compact">${emptyText}</div>`;
  const byIndex = new Map((entry.refs || []).map((ref) => [String(ref.index), ref]));
  const html = renderMarkdown(entry.text || "").replace(/\[(\d{1,3})\](?![^<]*>)/g, (match, index) => {
    const ref = byIndex.get(index);
    return ref ? `<button type="button" class="cite" data-cite-item="${escapeHtml(ref.itemId)}" title="${escapeHtml(ref.title)}">${index}</button>` : match;
  });
  return `<article class="digest markdown-body">${html}</article>`;
}

function renderTopicTab(tag, topic) {
  const digest = state.topicDigests[tag] || { overview: null, recent: {} };
  const busy = state.topicBusy === `${tag}:${state.topicTab}`;
  if (state.topicTab === "overview") {
    const entry = digest.overview;
    return `
      <div class="digest-bar">
        <p class="muted">${entry ? `生成于 ${escapeHtml(formatDate(entry.generatedAt))}，基于 ${escapeHtml(entry.itemCount)} 条资料${entry.excludedCount ? `（${escapeHtml(entry.excludedCount)} 条按设置不发送给 AI）` : ""}${entry.omitted ? `，另有 ${escapeHtml(entry.omitted)} 条因篇幅未包含` : ""}。` : "把这个专题的所有资料放在一起，让 AI 整理出现状、结论、未解决的问题和进展。"}</p>
        ${entry && !busy ? `<button type="button" class="quiet-button" data-digest-export="overview">导出 Markdown</button>` : ""}
        <button type="button" class="primary-button" data-digest="overview" ${busy ? "disabled" : ""}>${busy ? "整理中…" : entry ? "重新整理" : "生成总览"}</button>
      </div>
      ${busy ? `<div class="empty-state compact">正在整理 ${escapeHtml(topic.itemCount)} 条资料，可能需要一两分钟。</div>` : renderDigestBlock(entry, "还没有总览。")}`;
  }
  if (state.topicTab === "recent") {
    const entry = digest.recent?.[String(state.topicDays)];
    const preview = state.topicStream?.tag === tag && state.topicStream.days === state.topicDays ? state.topicStream.total : null;
    return `
      ${daysPicker(state.topicDays, "data-topic-days")}
      <div class="digest-bar">
        <p class="muted">${preview === null ? "" : preview ? `这段时间有 ${escapeHtml(preview)} 条消息、评论或页面更新。` : "这段时间没有新内容。"}${entry ? ` 上次整理：${escapeHtml(formatDate(entry.generatedAt))}。` : ""}</p>
        ${entry && !busy ? `<button type="button" class="quiet-button" data-digest-export="recent">导出 Markdown</button>` : ""}
        <button type="button" class="primary-button" data-digest="recent" ${busy || preview === 0 ? "disabled" : ""}>${busy ? "整理中…" : entry ? `重新整理这 ${escapeHtml(state.topicDays)} 天` : `整理这 ${escapeHtml(state.topicDays)} 天的更新`}</button>
      </div>
      ${busy ? `<div class="empty-state compact">正在整理最近 ${escapeHtml(state.topicDays)} 天的更新……</div>` : renderDigestBlock(entry, preview ? "点右上角按钮，让 AI 整理这段时间都有哪些更新。" : "选择更长的时间范围试试。")}`;
  }
  if (state.topicTab === "stream") {
    const stream = state.topicStream?.tag === tag ? state.topicStream : { events: [], total: 0 };
    return `${daysPicker(state.topicDays, "data-topic-days")}${renderStreamList(stream.events, { emptyText: `最近 ${state.topicDays} 天没有新消息。` })}`;
  }
  const members = topicMembers(tag).sort(byActivityDesc);
  const adder = tag === ALL_TOPICS ? "" : `
    <div class="topic-adder">
      <input type="search" data-topic-add-search placeholder="搜索资料加入「${escapeHtml(tag)}」，比如 Teams 会话名" value="${escapeHtml(state.topicAddQuery || "")}" aria-label="搜索要加入专题的资料" />
      ${topicAddCandidates(tag).map((item) => `
        <div class="topic-add-row">${sourceMark(item.sourceType)}<span class="item-row-title">${escapeHtml(item.title || "未命名资料")}</span>
          <button type="button" class="quiet-button" data-topic-add="${escapeHtml(item.id)}">加入</button></div>`).join("")}
    </div>`;
  return adder + (members.length ? `<ul class="topic-items">${members.map((item) => `
    <li><button type="button" class="item-row" data-topic-item="${escapeHtml(item.id)}">
      ${sourceMark(item.sourceType)}<span class="item-row-title">${escapeHtml(item.title || "未命名资料")}</span>
      <span class="muted">${escapeHtml(relativeTime(itemActivityTime(item)))}</span>
      ${isNewContentItem(item) ? `<span class="pill" data-status="accent">新</span>` : ""}
    </button></li>`).join("")}</ul>` : `<div class="empty-state compact">这个标签下还没有资料。</div>`);
}

// Items not yet in the topic that match the search; adding one tags it.
function topicAddCandidates(tag) {
  const query = String(state.topicAddQuery || "").trim().toLowerCase();
  if (!query) return [];
  return (state.allItems || [])
    .filter((item) => item.pageKind !== "list" && !(item.tags || []).includes(tag) && String(item.title || "").toLowerCase().includes(query))
    .sort(byActivityDesc)
    .slice(0, 8);
}

async function addItemToTopic(itemId, tag) {
  const item = (state.allItems || []).find((entry) => entry.id === itemId);
  if (!item) return;
  try {
    await api(`/api/items/${encodeURIComponent(itemId)}/tags`, { method: "PATCH", body: JSON.stringify({ tags: [...new Set([...(item.tags || []), tag])] }) });
    item.tags = [...new Set([...(item.tags || []), tag])];
    notify("已加入专题", `「${item.title}」已加上标签 ${tag}。`);
    await loadTopics();
  } catch (error) {
    notify("没能加入专题", error.message, "error");
  }
}

function bindTopicTab(tag) {
  topicMain.querySelectorAll("[data-topic-days]").forEach((button) => button.addEventListener("click", () => setTopicDays(tag, Number(button.dataset.topicDays))));
  topicMain.querySelector("[data-topic-days-input]")?.addEventListener("change", (event) => {
    const days = Math.min(90, Math.max(1, Number(event.target.value) || 7));
    setTopicDays(tag, days);
  });
  topicMain.querySelector("[data-digest]")?.addEventListener("click", (event) => generateTopicDigest(tag, event.currentTarget.dataset.digest));
  topicMain.querySelector("[data-digest-export]")?.addEventListener("click", (event) => {
    const mode = event.currentTarget.dataset.digestExport;
    const query = new URLSearchParams({ mode, days: String(state.topicDays) });
    exportMarkdown(`/api/topics/${encodeURIComponent(tag)}/digest/export.md?${query}`, `${topicLabel(tag)}.md`);
  });
  const addSearch = topicMain.querySelector("[data-topic-add-search]");
  addSearch?.addEventListener("input", () => {
    state.topicAddQuery = addSearch.value;
    const caret = addSearch.selectionStart;
    renderTopicMain();
    const next = topicMain.querySelector("[data-topic-add-search]");
    next?.focus();
    next?.setSelectionRange(caret, caret);
  });
  topicMain.querySelectorAll("[data-topic-add]").forEach((button) => button.addEventListener("click", () => addItemToTopic(button.dataset.topicAdd, tag)));
  topicMain.querySelectorAll("[data-cite-item], [data-topic-item]").forEach((button) => button.addEventListener("click", () => openItemInLibrary(button.dataset.citeItem || button.dataset.topicItem)));
  bindStreamList(topicMain);
}

async function setTopicDays(tag, days) {
  state.topicDays = days;
  await loadTopicStream(tag);
  renderTopicMain();
}

async function generateTopicDigest(tag, mode) {
  state.topicBusy = `${tag}:${mode}`;
  renderTopicMain();
  try {
    const { digest } = await api(`/api/topics/${encodeURIComponent(tag)}/digest`, { method: "POST", body: JSON.stringify({ mode, days: state.topicDays }) });
    state.topicDigests[tag] = digest;
    notify("整理完成", mode === "recent" ? `「${topicLabel(tag)}」最近 ${state.topicDays} 天的更新已整理好。` : `「${topicLabel(tag)}」的总览已更新。`);
  } catch (error) {
    notify("没能整理", error.message, "error");
  } finally {
    state.topicBusy = "";
    if (state.view === "topics" && state.selectedTopic === tag) renderTopicMain();
  }
}

// Stream rows, grouped by day. Long runs from one conversation collapse so a
// busy chat does not push everything else out of view.
function renderStreamList(events, { emptyText = "没有新消息。" } = {}) {
  if (!events?.length) return `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  const rows = [];
  let day = "";
  for (let index = 0; index < events.length;) {
    let end = index + 1;
    while (end < events.length && events[end].itemId === events[index].itemId && messageDayLabel(events[end].at) === messageDayLabel(events[index].at)) end += 1;
    const label = messageDayLabel(events[index].at);
    if (label !== day) {
      day = label;
      rows.push(`<h3 class="stream-day">${escapeHtml(label)}</h3>`);
    }
    const run = events.slice(index, end);
    const visible = run.length > 3 ? run.slice(0, 2) : run;
    for (const event of visible) rows.push(streamRow(event));
    if (run.length > visible.length) {
      const hidden = run.slice(visible.length);
      rows.push(`<button type="button" class="stream-more" data-stream-expand>${escapeHtml(run[0].itemTitle)} 还有 ${hidden.length} 条</button><div class="stream-hidden" hidden>${hidden.map(streamRow).join("")}</div>`);
    }
    index = end;
  }
  return `<div class="stream-list">${rows.join("")}</div>`;
}

function streamRow(event) {
  const time = new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return `
    <button type="button" class="stream-row ${event.isNew ? "is-new" : ""}" data-stream-item="${escapeHtml(event.itemId)}" data-stream-message="${escapeHtml(event.messageId || "")}">
      <time datetime="${escapeHtml(event.at)}">${escapeHtml(time)}</time>
      ${sourceMark(event.sourceType)}
      <span class="stream-text">
        <span class="stream-where">${escapeHtml(event.itemTitle)}${event.author ? ` · <strong>${escapeHtml(event.author)}</strong>` : ""}${event.kind === "update" ? ` · <em>页面更新</em>` : ""}</span>
        <span class="stream-snippet">${escapeHtml(event.text)}</span>
      </span>
      ${event.isNew ? `<span class="flag" data-tone="accent">新</span>` : ""}
    </button>`;
}

function bindStreamList(root) {
  root.querySelectorAll("[data-stream-item]").forEach((button) => button.addEventListener("click", () => openItemInLibrary(button.dataset.streamItem, { messageId: button.dataset.streamMessage })));
  root.querySelectorAll("[data-stream-expand]").forEach((button) => button.addEventListener("click", () => {
    button.nextElementSibling.hidden = false;
    button.remove();
  }));
}

// Home feed: by topic (one row per item) or by time (every message).
function setFeedMode(mode) {
  state.feedMode = mode;
  try { localStorage.setItem("materialOrganizer.feedMode", mode); } catch {}
  feedModeToggle?.querySelectorAll("[data-feed-mode]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.feedMode === mode)));
  const previewButton = document.querySelector("#feedPreviewToggle");
  if (previewButton) previewButton.hidden = mode === "time";
}

async function renderHomeStream() {
  if (!homeRecentUpdates) return;
  if (homeMarkAllReadButton) homeMarkAllReadButton.hidden = true;
  if (streamFilters) {
    streamFilters.hidden = false;
    streamFilters.innerHTML = `${daysPicker(state.streamDays, "data-stream-days")}
      <label class="inline-toggle"><input type="checkbox" data-stream-unread ${state.streamUnreadOnly ? "checked" : ""} /> 只看未读</label>`;
    streamFilters.querySelectorAll("[data-stream-days]").forEach((button) => button.addEventListener("click", async () => { state.streamDays = Number(button.dataset.streamDays); await renderHomeStream(); }));
    streamFilters.querySelector("[data-stream-days-input]")?.addEventListener("change", async (event) => { state.streamDays = Math.min(90, Math.max(1, Number(event.target.value) || 3)); await renderHomeStream(); });
    streamFilters.querySelector("[data-stream-unread]")?.addEventListener("change", async (event) => { state.streamUnreadOnly = event.target.checked; await renderHomeStream(); });
  }
  try {
    const params = new URLSearchParams({ days: String(state.streamDays), limit: "500" });
    state.homeStream = await api(`/api/stream?${params}`);
  } catch {
    state.homeStream = { events: [], total: 0 };
  }
  if (state.feedMode !== "time") return;
  const events = (state.homeStream.events || []).filter((event) => !state.streamUnreadOnly || event.isNew);
  homeRecentUpdates.innerHTML = renderStreamList(events, { emptyText: state.streamUnreadOnly ? "这段时间没有未读消息。" : `最近 ${state.streamDays} 天没有新消息。` });
  bindStreamList(homeRecentUpdates);
}

feedModeToggle?.querySelectorAll("[data-feed-mode]").forEach((button) => button.addEventListener("click", async () => {
  setFeedMode(button.dataset.feedMode);
  if (state.feedMode === "time") await renderHomeStream();
  else {
    if (streamFilters) streamFilters.hidden = true;
    await loadHomeOverview();
  }
}));
setFeedMode(state.feedMode);

manageTopicsButton?.addEventListener("click", async () => {
  if (!state.topics) await loadTopics();
  state.topicPickerOpen = true;
  renderTopics();
});

