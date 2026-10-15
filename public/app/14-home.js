// ---------------------------------------------------------------------------
// 动态 (home): what changed, what needs attention
// ---------------------------------------------------------------------------

async function loadHomeOverview() {
  await loadLibraryIndex();
  renderHomeOverview();
}

function renderHomeOverview() {
  if (!homeView) return;
  const items = state.allItems || [];
  const jobs = state.refreshJobs || [];
  const unread = items.filter(isNewContentItem).sort(byActivityDesc);
  const running = jobs.filter((job) => job.enabled).length;
  if (homeSummary) {
    homeSummary.textContent = !items.length
      ? "还没有资料。添加一个链接或一段文本就可以开始。"
      : `${unread.length ? `${unread.length} 条资料有新内容` : "新内容都看过了"}。共 ${items.length} 条资料，${running} 个订阅在自动刷新。`;
  }
  renderHomeAttention();
  renderHomeFeed(unread, items);
  renderHomeSourceHealth(jobs, items);
  renderHomeLibraryStats(items);
  renderMaterialsNewBadge();
}

function renderHomeAttention() {
  if (!homeAttention) return;
  const jobs = state.refreshJobs || [];
  const items = state.allItems || [];
  const rows = [];
  if (state.doNotDisturb) {
    rows.push({ level: "warn", text: "免打扰已开启，订阅不会自动刷新。", action: `<button type="button" data-attention="dnd">恢复自动刷新</button>` });
  }
  for (const job of jobs.filter((candidate) => subscriptionState(candidate).key === "error").slice(0, 4)) {
    rows.push({
      level: "error",
      text: `<strong>${escapeHtml(subscriptionDisplayName(job))}</strong> 刷新失败${job.lastError ? `：${escapeHtml(String(job.lastError).slice(0, 90))}` : ""}`,
      action: `<button type="button" data-attention-run="${escapeHtml(job.id)}">重试</button><button type="button" class="quiet-button" data-attention-open="${escapeHtml(job.id)}">查看</button>`
    });
  }
  const gaps = items.filter((item) => item.coverage?.gap).slice(0, 3);
  for (const item of gaps) {
    rows.push({ level: "warn", text: `<strong>${escapeHtml(item.title)}</strong> 没能接上上次抓取的位置，中间可能缺少消息。`, action: `<button type="button" data-attention-item="${escapeHtml(item.id)}">打开</button>` });
  }
  const duplicates = duplicateSubscriptionIds(jobs);
  if (duplicates.size) {
    rows.push({ level: "warn", text: `${duplicates.size} 个订阅指向相同的地址，会重复刷新。`, action: `<button type="button" data-attention-duplicates>去处理</button>` });
  }
  for (const job of jobs) {
    const left = leftItemsForJob(job).length;
    if (left) rows.push({ level: "warn", text: `<strong>${escapeHtml(subscriptionDisplayName(job))}</strong> 有 ${left} 条资料已不在过滤结果中，已停止更新。`, action: `<button type="button" data-attention-open="${escapeHtml(job.id)}">删除或保留</button>` });
  }
  const quarantined = items.filter((item) => item.integrityStatus === "quarantined").length;
  if (quarantined) {
    rows.push({ level: "warn", text: `${quarantined} 条资料因来源校验未通过被隔离，不会进入问答。`, action: `<button type="button" data-attention-view="quarantined">查看</button>` });
  }
  homeAttention.hidden = !rows.length;
  homeAttention.innerHTML = rows.map((row) => `
    <div class="attention-row" data-level="${row.level}">
      <span class="status-dot" data-status="${row.level}" aria-hidden="true"></span>
      <p>${row.text}</p>
      <div class="row-actions">${row.action}</div>
    </div>`).join("");
  homeAttention.querySelector("[data-attention='dnd']")?.addEventListener("click", toggleDoNotDisturb);
  homeAttention.querySelectorAll("[data-attention-run]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    await switchView("subscriptions");
    await runRefreshJob(button.dataset.attentionRun);
  }));
  homeAttention.querySelectorAll("[data-attention-open]").forEach((button) => button.addEventListener("click", async () => {
    await switchView("subscriptions");
    openSubscriptionDrawer(button.dataset.attentionOpen);
  }));
  homeAttention.querySelector("[data-attention-duplicates]")?.addEventListener("click", async () => {
    state.subscriptionQuery = "";
    state.subscriptionStatusFilter = "all";
    await switchView("subscriptions");
    refreshJobs.querySelector(".subs-name .flag")?.closest(".subs-row")?.scrollIntoView({ block: "center" });
  });
  homeAttention.querySelectorAll("[data-attention-item]").forEach((button) => button.addEventListener("click", () => openItemInLibrary(button.dataset.attentionItem)));
  homeAttention.querySelectorAll("[data-attention-view]").forEach((button) => button.addEventListener("click", async () => {
    state.libraryView = button.dataset.attentionView;
    await switchView("materials");
  }));
}

function renderHomeFeed(unread, items) {
  if (!homeRecentUpdates) return;
  if (state.feedMode === "time") { renderHomeStream(); return; }
  if (streamFilters) streamFilters.hidden = true;
  if (homeFirstImportButton) homeFirstImportButton.hidden = items.length > 0;
  if (homeMarkAllReadButton) homeMarkAllReadButton.hidden = unread.length < 2;
  if (!unread.length) {
    homeRecentUpdates.innerHTML = `<div class="empty-state compact">${items.length ? "订阅的内容有新变化时会出现在这里。" : "保存资料或订阅之后，新变化会集中显示在这里。"}</div>`;
    return;
  }
  const groups = new Map();
  for (const item of unread) {
    const source = normalizeSourceType(item.sourceType);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(item);
  }
  const ordered = [...groups.entries()].sort((a, b) => SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]));
  homeRecentUpdates.innerHTML = ordered.map(([source, entries]) => `
    <section class="feed-group">
      <h3>${sourceMark(source)}<span>${escapeHtml(sourceLabel(source))}</span><span class="count">${entries.length}</span></h3>
      <ul>
        ${entries.slice(0, 8).map((item) => `
          <li class="feed-row">
            <button type="button" class="feed-open" data-home-item-id="${escapeHtml(item.id)}">
              <span class="feed-title">${escapeHtml(item.title || "未命名资料")}</span>
              <span class="feed-meta"><time datetime="${escapeHtml(itemActivityTime(item))}">${escapeHtml(relativeTime(itemActivityTime(item)))}更新</time>${item.processedStale ? `<span class="flag">整理版待更新</span>` : ""}</span>
              ${previewLine(item)}
            </button>
            <button type="button" class="quiet-button" data-home-ack="${escapeHtml(item.id)}">已读</button>
          </li>`).join("")}
      </ul>
      ${entries.length > 8 ? `<button type="button" class="quiet-button more" data-home-source="${escapeHtml(source)}">查看全部 ${entries.length} 条</button>` : ""}
    </section>`).join("");
  homeRecentUpdates.querySelectorAll("[data-home-item-id]").forEach((button) => button.addEventListener("click", () => openItemInLibrary(button.dataset.homeItemId)));
  homeRecentUpdates.querySelectorAll("[data-home-ack]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    await api(`/api/items/${encodeURIComponent(button.dataset.homeAck)}/ack-update`, { method: "POST" }).catch(() => {});
    await loadHomeOverview();
  }));
  homeRecentUpdates.querySelectorAll("[data-home-source]").forEach((button) => button.addEventListener("click", async () => {
    state.libraryView = "unread";
    state.sourceType = button.dataset.homeSource;
    await switchView("materials");
  }));
}

async function markAllHomeUpdatesRead() {
  const unread = (state.allItems || []).filter(isNewContentItem);
  if (!unread.length) return;
  homeMarkAllReadButton.disabled = true;
  for (const item of unread) {
    await api(`/api/items/${encodeURIComponent(item.id)}/ack-update`, { method: "POST" }).catch(() => {});
  }
  homeMarkAllReadButton.disabled = false;
  await loadHomeOverview();
}

function renderHomeSourceHealth(jobs, items) {
  if (!homeSourceHealth) return;
  const bySource = new Map();
  for (const job of jobs) {
    const source = sourceTypeForSubscription(job);
    if (!bySource.has(source)) bySource.set(source, { ok: 0, error: 0, paused: 0, latest: "" });
    const entry = bySource.get(source);
    const status = subscriptionState(job).key;
    if (status === "error") entry.error += 1;
    else if (status === "paused") entry.paused += 1;
    else entry.ok += 1;
    if ((job.lastRunAt || "") > entry.latest) entry.latest = job.lastRunAt;
  }
  if (!bySource.size) {
    homeSourceHealth.innerHTML = `<div class="empty-state compact">还没有订阅。添加资料时选择“保存并订阅”，之后的变化会自动收进来。</div>`;
    return;
  }
  homeSourceHealth.innerHTML = [...bySource.entries()]
    .sort((a, b) => SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]))
    .map(([source, entry]) => `
      <button type="button" class="health-row" data-health-source="${escapeHtml(source)}">
        ${sourceMark(source)}
        <span class="health-name">${escapeHtml(sourceLabel(source))}</span>
        <span class="health-counts">
          ${entry.error ? `<span class="pill" data-status="error">${entry.error} 失败</span>` : ""}
          <span class="pill" data-status="ok">${entry.ok} 正常</span>
          ${entry.paused ? `<span class="pill" data-status="paused">${entry.paused} 暂停</span>` : ""}
        </span>
        <span class="health-time">${entry.latest ? escapeHtml(relativeTime(entry.latest)) : "未运行"}</span>
      </button>`).join("");
  homeSourceHealth.querySelectorAll("[data-health-source]").forEach((button) => button.addEventListener("click", async () => {
    state.subscriptionStatusFilter = "all";
    state.subscriptionFocusSource = button.dataset.healthSource;
    await switchView("subscriptions");
  }));
}

function renderHomeLibraryStats(items) {
  if (!homeLibraryStats) return;
  const counts = countSources(items);
  const stale = items.filter((item) => item.processedStale).length;
  const unprocessed = items.filter((item) => !item.hasProcessed).length;
  homeLibraryStats.innerHTML = `
    <div class="stat-rows">
      ${SOURCE_ORDER.filter((source) => counts.get(source)).map((source) => `
        <button type="button" class="stat-row" data-stat-source="${source}">${sourceMark(source)}<span>${escapeHtml(sourceLabel(source))}</span><span class="count">${counts.get(source)}</span></button>`).join("")}
    </div>
    <div class="stat-notes">
      ${stale ? `<button type="button" class="quiet-button" data-stat-view="stale">${stale} 条整理版待更新</button>` : ""}
      ${unprocessed ? `<button type="button" class="quiet-button" data-stat-view="unprocessed">${unprocessed} 条还没有整理</button>` : ""}
    </div>`;
  homeLibraryStats.querySelectorAll("[data-stat-source]").forEach((button) => button.addEventListener("click", async () => {
    state.libraryView = "all";
    state.sourceType = button.dataset.statSource;
    state.tag = "";
    await switchView("materials");
  }));
  homeLibraryStats.querySelectorAll("[data-stat-view]").forEach((button) => button.addEventListener("click", async () => {
    state.libraryView = button.dataset.statView;
    state.sourceType = "";
    await switchView("materials");
  }));
}

async function openItemInLibrary(id, { messageId = "" } = {}) {
  state.libraryView = "all";
  state.sourceType = "";
  state.tag = "";
  state.query = "";
  state.subscriptionScope = null;
  if (searchInput) searchInput.value = "";
  await switchView("materials");
  await selectItem(id);
  itemList.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  // Coming from the stream: show that message in the conversation.
  const message = messageId ? detailPanel?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) : null;
  if (message) {
    message.scrollIntoView({ block: "center" });
    message.classList.add("is-target");
    setTimeout(() => message.classList.remove("is-target"), 2400);
  }
}

