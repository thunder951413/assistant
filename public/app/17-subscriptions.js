// ---------------------------------------------------------------------------
// 订阅: one compact row per subscription, grouped by source, edit in a drawer
// ---------------------------------------------------------------------------

const INTERVAL_CHOICES = [[30, "每 30 分钟"], [60, "每小时"], [120, "每 2 小时"], [240, "每 4 小时"], [480, "每 8 小时"], [1440, "每天"]];

function subscriptionDisplayName(job) {
  return String(job?.name || job?.id || "").replace(/\s+refresh$/i, "").trim() || "未命名订阅";
}

function duplicateSubscriptionIds(jobs = state.refreshJobs || []) {
  const seen = new Map();
  const duplicates = new Set();
  for (const job of jobs) {
    const key = normalizeUrlKey(job.url);
    if (!key) continue;
    if (seen.has(key)) { duplicates.add(job.id); duplicates.add(seen.get(key)); }
    else seen.set(key, job.id);
  }
  return duplicates;
}

function subscriptionState(job) {
  if (job.running) return { key: "running", label: "刷新中" };
  if (!job.enabled) return { key: "paused", label: "已暂停" };
  if (job.quarantined) return { key: "warn", label: "待验证" };
  if (job.circuitOpen) return { key: "error", label: "多次失败，已停止重试" };
  if (["failed", "unreachable"].includes(job.status)) return { key: "error", label: job.status === "unreachable" ? "网络不可达" : "刷新失败" };
  if (job.lastRunAt) return { key: "ok", label: "正常" };
  return { key: "idle", label: "还没刷新过" };
}

function subscriptionKind(job) {
  if (job.pageKind === "list" && isGithubIssueSearchUrl(job.url)) return "搜索：跟随过滤结果";
  if (job.pageKind === "list") return "列表：自动收录新条目";
  if (job.managedBy === "content-page") return "页面：检查内容变化";
  return sourceTypeForSubscription(job) === "teams" ? "会话：同步新消息" : "页面：同步更新";
}

function normalizeUrlKey(value) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function subscriptionItems(job) {
  const key = normalizeUrlKey(job.url);
  return (state.allItems || []).filter((item) => item.refreshJob?.id === job.id
    || (key && (normalizeUrlKey(item.url) === key || normalizeUrlKey(item.parentUrl) === key)));
}

function subscriptionMatchesFilters(job) {
  const status = subscriptionState(job).key;
  const filter = state.subscriptionStatusFilter;
  if (filter === "problem" && !["error", "warn"].includes(status)) return false;
  if (filter === "ok" && !["ok", "running", "idle"].includes(status)) return false;
  if (filter === "paused" && status !== "paused") return false;
  const query = state.subscriptionQuery;
  return !query || `${subscriptionDisplayName(job)} ${job.url}`.toLowerCase().includes(query);
}

function renderSubscriptionTabs() {
  const jobs = state.refreshJobs || [];
  const count = (test) => jobs.filter((job) => test(subscriptionState(job).key)).length;
  const tabs = [
    ["all", "全部", jobs.length],
    ["problem", "有问题", count((key) => ["error", "warn"].includes(key))],
    ["ok", "正常", count((key) => ["ok", "running", "idle"].includes(key))],
    ["paused", "已暂停", count((key) => key === "paused")]
  ];
  subscriptionTabs.innerHTML = tabs.map(([key, label, value]) => `
    <button type="button" role="tab" aria-selected="${state.subscriptionStatusFilter === key}" class="${state.subscriptionStatusFilter === key ? "is-active" : ""}" data-subscription-filter="${key}" ${key === "problem" && value ? 'data-alert="1"' : ""}>${label}<span class="tab-count">${value}</span></button>`).join("");
  subscriptionTabs.querySelectorAll("[data-subscription-filter]").forEach((button) => button.addEventListener("click", () => {
    state.subscriptionStatusFilter = button.dataset.subscriptionFilter;
    renderRefreshJobs(state.refreshJobs);
  }));
}

function renderRefreshJobs(jobs) {
  state.refreshJobs = jobs || [];
  renderMaterialsNewBadge();
  if (state.view === "home") renderHomeOverview();
  if (!refreshJobs) return;
  renderSubscriptionTabs();
  const all = state.refreshJobs;
  const counts = { ok: 0, error: 0, paused: 0 };
  for (const job of all) {
    const key = subscriptionState(job).key;
    if (key === "error" || key === "warn") counts.error += 1;
    else if (key === "paused") counts.paused += 1;
    else counts.ok += 1;
  }
  if (subsSummary) {
    subsSummary.innerHTML = all.length
      ? `${all.length} 个订阅：<span class="pill" data-status="ok">${counts.ok} 正常</span>${counts.error ? `<span class="pill" data-status="error">${counts.error} 有问题</span>` : ""}${counts.paused ? `<span class="pill" data-status="paused">${counts.paused} 已暂停</span>` : ""}<span class="muted">刷新时段 ${escapeHtml(state.settings?.refreshSchedule?.startTime || "08:00")}–${escapeHtml(state.settings?.refreshSchedule?.endTime || "20:00")}${state.doNotDisturb ? "，免打扰中" : ""}</span>`
      : "还没有订阅。";
  }
  const visible = all.filter(subscriptionMatchesFilters);
  if (!all.length) {
    refreshJobs.innerHTML = `<div class="empty-state">还没有订阅。添加资料时选择“保存并订阅”，或者添加一个 Jira 过滤器、GitHub 通知页、Teams 群聊链接。</div>`;
    return;
  }
  if (!visible.length) {
    refreshJobs.innerHTML = `<div class="empty-state compact">没有符合筛选条件的订阅。</div>`;
    return;
  }
  const groups = new Map();
  for (const job of visible) {
    const source = sourceTypeForSubscription(job);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(job);
  }
  const rank = { error: 0, warn: 1, running: 2, ok: 3, idle: 4, paused: 5 };
  refreshJobs.innerHTML = [...groups.entries()]
    .sort((a, b) => SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]))
    .map(([source, entries]) => {
      entries.sort((a, b) => rank[subscriptionState(a).key] - rank[subscriptionState(b).key] || subscriptionDisplayName(a).localeCompare(subscriptionDisplayName(b), "zh-CN"));
      const problems = entries.filter((job) => ["error", "warn"].includes(subscriptionState(job).key)).length;
      return `
        <section class="subs-group" data-source-group="${source}" ${state.subscriptionFocusSource === source ? 'data-focus="1"' : ""}>
          <header class="subs-group-head">
            <h2>${sourceMark(source)}<span>${escapeHtml(sourceLabel(source))}</span><span class="count">${entries.length}</span>${problems ? `<span class="pill" data-status="error">${problems} 有问题</span>` : ""}</h2>
            <button type="button" class="quiet-button" data-run-group="${source}">刷新这一组</button>
          </header>
          <div class="subs-table" role="table" aria-label="${escapeHtml(sourceLabel(source))} 订阅">
            <div class="subs-row subs-row-head" role="row">
              <span role="columnheader">启用</span><span role="columnheader">名称</span><span role="columnheader">状态</span><span role="columnheader">最近内容</span><span role="columnheader">频率</span><span role="columnheader">资料</span><span role="columnheader"><span class="visually-hidden">操作</span></span>
            </div>
            ${entries.map(renderSubscriptionRow).join("")}
          </div>
        </section>`;
    }).join("");
  bindSubscriptionRows();
  if (state.subscriptionFocusSource) {
    refreshJobs.querySelector(`[data-source-group="${CSS.escape(state.subscriptionFocusSource)}"]`)?.scrollIntoView({ block: "start" });
    state.subscriptionFocusSource = "";
  }
  if (state.selectedSubscriptionId && !subscriptionDrawer.hidden && !state.subscriptionDirty) renderSubscriptionDrawer(state.selectedSubscriptionId);
}

function renderSubscriptionRow(job) {
  const status = subscriptionState(job);
  const items = subscriptionItems(job);
  const unread = items.filter(isNewContentItem).length;
  const left = items.filter(isLeftListItem).length;
  const latest = items.map(itemActivityTime).filter(Boolean).sort().at(-1) || "";
  let host = "";
  try { host = new URL(job.url).host; } catch {}
  const statusTime = job.running ? "" : status.key === "error" ? (job.lastRunAt ? relativeTime(job.lastRunAt) : "") : job.lastRunAt ? relativeTime(job.lastRunAt) : "";
  return `
    <div class="subs-row ${state.selectedSubscriptionId === job.id ? "is-selected" : ""}" role="row" data-subscription-id="${escapeHtml(job.id)}" tabindex="0">
      <span role="cell"><label class="switch" title="${job.enabled ? "已启用自动刷新" : "已暂停"}"><input type="checkbox" data-toggle-job="${escapeHtml(job.id)}" ${job.enabled ? "checked" : ""} aria-label="自动刷新 ${escapeHtml(subscriptionDisplayName(job))}" /><span aria-hidden="true"></span></label></span>
      <span role="cell" class="subs-name"><strong>${escapeHtml(subscriptionDisplayName(job))}${duplicateSubscriptionIds().has(job.id) ? ` <span class="flag" title="另一个订阅指向同一个地址，可以删除其中一个">重复</span>` : ""}</strong><small>${escapeHtml(subscriptionKind(job))}${host ? ` · ${escapeHtml(host)}` : ""}</small></span>
      <span role="cell" class="subs-status"><span class="status-dot" data-status="${status.key}" aria-hidden="true"></span><span>${escapeHtml(status.label)}${statusTime ? `<small>${escapeHtml(statusTime)}</small>` : ""}</span></span>
      <span role="cell" class="subs-latest" title="${escapeHtml(latest ? formatDate(latest) : "")}">${latest ? escapeHtml(compactDate(latest)) : `<span class="muted">—</span>`}</span>
      <span role="cell" class="subs-interval">${escapeHtml(formatInterval(job.intervalMinutes))}</span>
      <span role="cell" class="subs-items">${items.length}${unread ? `<span class="pill" data-status="accent">${unread} 新</span>` : ""}${left ? `<span class="pill" data-status="warn" title="已不在过滤结果中，不再更新">${left} 移出</span>` : ""}</span>
      <span role="cell" class="subs-actions"><button type="button" class="quiet-button" data-run-job="${escapeHtml(job.id)}" ${job.running ? "disabled" : ""}>${job.running ? "刷新中" : "刷新"}</button></span>
    </div>`;
}

function bindSubscriptionRows() {
  refreshJobs.querySelectorAll("[data-subscription-id]").forEach((row) => {
    const open = (event) => {
      if (event.target.closest("button, input, label, a")) return;
      openSubscriptionDrawer(row.dataset.subscriptionId);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") open(event); });
  });
  refreshJobs.querySelectorAll("[data-run-job]").forEach((button) => button.addEventListener("click", () => runRefreshJob(button.dataset.runJob)));
  refreshJobs.querySelectorAll("[data-toggle-job]").forEach((input) => input.addEventListener("change", () => updateSubscription(input.dataset.toggleJob, { enabled: input.checked })));
  refreshJobs.querySelectorAll("[data-run-group]").forEach((button) => button.addEventListener("click", () => {
    const ids = (state.refreshJobs || []).filter((job) => job.enabled && sourceTypeForSubscription(job) === button.dataset.runGroup).map((job) => job.id);
    runRefreshJobsByIds(ids, `${sourceLabel(button.dataset.runGroup)} 订阅`);
  }));
}

// Sends only this subscription's edited fields; the server ignores everything
// else, so a save can never overwrite live refresh status or revive a deleted job.
async function updateSubscription(id, patch, { quiet = false } = {}) {
  try {
    const { jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    state.settings = { ...(state.settings || {}), refreshJobs: jobs };
    renderRefreshJobs(jobs);
    if (!quiet) refreshJobStatus.textContent = patch.enabled === false ? "已暂停自动刷新。" : patch.enabled === true ? "已恢复自动刷新。" : "订阅已保存。";
    return true;
  } catch (error) {
    refreshJobStatus.textContent = `没能保存：${error.message}`;
    renderRefreshJobs(state.refreshJobs);
    return false;
  }
}

async function saveSubscriptions() {
  await loadSettings();
  renderRefreshJobs(state.refreshJobs);
}

async function runAllRefreshJobs() {
  const ids = (state.refreshJobs || []).filter((job) => job.enabled).map((job) => job.id);
  await runRefreshJobsByIds(ids, "全部已启用的订阅");
}

async function runRefreshJobsByIds(ids, label) {
  if (!ids.length) {
    refreshJobStatus.textContent = "没有已启用的订阅可以刷新。";
    return;
  }
  runAllSubscriptionsButton.disabled = true;
  refreshJobStatus.textContent = `正在启动 ${label}（${ids.length} 个）……`;
  try {
    const { run, jobs } = await api("/api/refresh-jobs/run-batch?background=1", { method: "POST", body: JSON.stringify({ ids, background: true }) });
    renderRefreshJobs(jobs || state.refreshJobs);
    await monitorSubscriptionRefreshRun(run, `正在刷新 ${label}`);
    await loadLibraryIndex();
    renderRefreshJobs(state.refreshJobs);
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  } finally {
    runAllSubscriptionsButton.disabled = false;
  }
}

function openSubscriptionDrawer(id) {
  state.selectedSubscriptionId = id;
  state.subscriptionDirty = false;
  renderSubscriptionDrawer(id);
  subscriptionDrawer.hidden = false;
  document.body.classList.add("has-drawer");
  refreshJobs.querySelectorAll("[data-subscription-id]").forEach((row) => row.classList.toggle("is-selected", row.dataset.subscriptionId === id));
  subscriptionDrawer.querySelector("input, button")?.focus();
}

function closeSubscriptionDrawer() {
  if (!subscriptionDrawer || subscriptionDrawer.hidden) return;
  subscriptionDrawer.hidden = true;
  state.subscriptionDirty = false;
  document.body.classList.remove("has-drawer");
  state.selectedSubscriptionId = "";
  refreshJobs?.querySelectorAll(".subs-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
}

function renderSubscriptionDrawer(id) {
  const job = (state.refreshJobs || []).find((candidate) => candidate.id === id);
  if (!job) { closeSubscriptionDrawer(); return; }
  const status = subscriptionState(job);
  const source = sourceTypeForSubscription(job);
  const items = subscriptionItems(job).sort(byActivityDesc);
  const leftItems = items.filter(isLeftListItem);
  const result = job.lastResult || {};
  const interval = Number(job.intervalMinutes) || 60;
  const intervalOptions = INTERVAL_CHOICES.some(([value]) => value === interval) ? INTERVAL_CHOICES : [...INTERVAL_CHOICES, [interval, formatInterval(interval)]].sort((a, b) => a[0] - b[0]);
  const managedPage = isManagedContentPageJob(job);
  subscriptionDrawer.innerHTML = `
    <header class="drawer-head">
      <div class="reader-source">${sourceMark(source)}<span>${escapeHtml(sourceLabel(source))}</span><span class="muted">${escapeHtml(subscriptionKind(job))}</span></div>
      <button type="button" class="icon-button" data-close-drawer aria-label="关闭">×</button>
    </header>
    <form class="drawer-body" data-subscription-form>
      <label>名称<input name="name" value="${escapeHtml(subscriptionDisplayName(job))}" /></label>
      <label>地址<input name="url" value="${escapeHtml(job.url || "")}" ${managedPage ? "readonly" : ""} /></label>
      <div class="field-row">
        <label>自动刷新<select name="intervalMinutes">${intervalOptions.map(([value, label]) => `<option value="${value}" ${value === interval ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
        ${job.pageKind === "list" ? `<label>每次最多收录<input name="maxItems" type="number" min="1" value="${escapeHtml(job.maxItems || 50)}" /></label>` : ""}
      </div>
      <label>给收录的资料加标签<input name="tags" value="${escapeHtml(refreshJobTagsText(job.tags))}" placeholder="用逗号分隔" /></label>
      <label class="inline-toggle"><input name="enabled" type="checkbox" ${job.enabled ? "checked" : ""} /> 启用自动刷新</label>
      <div class="drawer-actions">
        <button type="submit" class="primary-button">保存</button>
        <button type="button" data-drawer-run ${job.running ? "disabled" : ""}>${job.running ? "刷新中" : "立即刷新"}</button>
      </div>
    </form>
    <section class="drawer-section">
      <h3>最近一次刷新</h3>
      <p class="drawer-status"><span class="status-dot" data-status="${status.key}" aria-hidden="true"></span>${escapeHtml(status.label)}${job.lastRunAt ? `，${escapeHtml(formatDate(job.lastRunAt))}` : ""}</p>
      ${job.lastError ? `<p class="error-text">${escapeHtml(job.lastError)}</p>` : ""}
      ${job.circuitOpen ? `<p class="muted">连续失败 ${escapeHtml(job.consecutiveFailures || 5)} 次后已停止自动重试，手动刷新成功后会自动恢复。</p>` : job.nextRetryAt ? `<p class="muted">将在 ${escapeHtml(formatDate(job.nextRetryAt))} 自动重试。</p>` : ""}
      ${job.lastResult && !job.lastError ? `<p class="muted">检查了 ${escapeHtml(result.linkCount ?? result.issueCount ?? 0)} 个页面，更新 ${escapeHtml(result.updatedItemCount ?? result.updatedIssueCount ?? 0)} 个，新增 ${escapeHtml(result.newItemCount || 0)} 个${result.leftItemCount ? `，${escapeHtml(result.leftItemCount)} 个移出过滤结果` : ""}${result.deferredItemCount ? `，还有 ${escapeHtml(result.deferredItemCount)} 个下次继续` : ""}。</p>` : ""}
      ${job.quarantined ? `<p class="error-text">${escapeHtml(job.quarantineReason || "需要手动刷新一次验证后才能恢复自动刷新。")}</p>` : ""}
    </section>
    ${leftItems.length ? `<section class="drawer-section left-items">
      <h3>已不在过滤结果中 <span class="count">${leftItems.length}</span></h3>
      <p class="muted">这些资料之前出现在过滤结果里，现在不在了，已停止更新。可以删除，或者留在资料库里。</p>
      <ul class="drawer-items">${leftItems.map((item) => `<li class="left-item"><button type="button" data-drawer-item="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span><small>${item.listMembership?.leftAt ? `${escapeHtml(relativeTime(item.listMembership.leftAt))}移出` : ""}</small></button><span class="row-actions"><button type="button" class="quiet-button" data-left-keep="${escapeHtml(item.id)}">保留</button><button type="button" class="quiet-button danger-text" data-left-delete="${escapeHtml(item.id)}">删除</button></span></li>`).join("")}</ul>
      <div class="drawer-actions">
        <button type="button" data-left-keep-all>全部保留</button>
        <button type="button" class="danger-button" data-left-delete-all>全部删除</button>
      </div>
    </section>` : ""}
    <section class="drawer-section">
      <h3>收录的资料 <span class="count">${items.length}</span></h3>
      ${items.length ? `<ul class="drawer-items">${items.slice(0, 8).map((item) => `<li><button type="button" data-drawer-item="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span><small>${escapeHtml(relativeTime(itemActivityTime(item)))}${isNewContentItem(item) ? `<span class="pill" data-status="accent">新</span>` : ""}</small></button></li>`).join("")}</ul>
        ${items.length > 8 ? `<button type="button" class="quiet-button" data-drawer-all-items>在资料中查看全部 ${items.length} 条</button>` : ""}` : `<p class="muted">还没有收录资料。刷新一次后会出现在这里。</p>`}
    </section>
    ${managedPage ? "" : `<section class="drawer-section danger-zone">
      <h3>危险操作</h3>
      <div class="drawer-actions">
        <button type="button" class="danger-button" data-drawer-clear>清空已收录的资料</button>
        <button type="button" class="danger-button" data-drawer-delete>删除订阅</button>
      </div>
      <p class="muted">删除订阅不会删除已经收录的资料。</p>
    </section>`}
  `;
  subscriptionDrawer.querySelector("[data-close-drawer]").addEventListener("click", closeSubscriptionDrawer);
  subscriptionDrawer.querySelector("[data-subscription-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const saved = await updateSubscription(job.id, {
      name: /\srefresh$/i.test(job.name || "") && name ? `${name} refresh` : name || job.name,
      url: String(form.get("url") || job.url).trim(),
      intervalMinutes: Number(form.get("intervalMinutes") || interval),
      ...(job.pageKind === "list" ? { maxItems: Number(form.get("maxItems") || job.maxItems || 50) } : {}),
      tags: String(form.get("tags") || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      enabled: form.get("enabled") === "on"
    });
    if (saved) {
      state.subscriptionDirty = false;
      renderSubscriptionDrawer(job.id);
      notify("订阅已保存", name);
    }
  });
  subscriptionDrawer.querySelector("[data-drawer-run]")?.addEventListener("click", () => runRefreshJob(job.id));
  subscriptionDrawer.querySelectorAll("[data-drawer-item]").forEach((button) => button.addEventListener("click", () => openItemInLibrary(button.dataset.drawerItem)));
  subscriptionDrawer.querySelector("[data-drawer-all-items]")?.addEventListener("click", async () => {
    state.subscriptionScope = { id: job.id, name: subscriptionDisplayName(job), itemIds: new Set(items.map((item) => item.id)) };
    state.libraryView = "all";
    state.sourceType = "";
    state.tag = "";
    await switchView("materials");
  });
  subscriptionDrawer.querySelectorAll("[data-left-keep]").forEach((button) => button.addEventListener("click", () => resolveLeftListItems([button.dataset.leftKeep], "keep")));
  subscriptionDrawer.querySelectorAll("[data-left-delete]").forEach((button) => button.addEventListener("click", () => resolveLeftListItems([button.dataset.leftDelete], "delete")));
  subscriptionDrawer.querySelector("[data-left-keep-all]")?.addEventListener("click", () => resolveLeftListItems(leftItems.map((item) => item.id), "keep"));
  subscriptionDrawer.querySelector("[data-left-delete-all]")?.addEventListener("click", () => resolveLeftListItems(leftItems.map((item) => item.id), "delete"));
  subscriptionDrawer.querySelector("[data-drawer-clear]")?.addEventListener("click", () => clearRefreshJobItems(job.id));
  subscriptionDrawer.querySelector("[data-drawer-delete]")?.addEventListener("click", () => deleteRefreshJob(job.id));
}

async function deleteRefreshJob(id) {
  const job = (state.refreshJobs || []).find((candidate) => candidate.id === id);
  if (!confirm(`删除订阅“${subscriptionDisplayName(job)}”？已经收录的资料会保留。`)) return;
  try {
    const { jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    closeSubscriptionDrawer();
    renderRefreshJobs(jobs || []);
    refreshJobStatus.textContent = "订阅已删除。";
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

async function clearRefreshJobItems(id) {
  const job = (state.refreshJobs || []).find((candidate) => candidate.id === id);
  if (!confirm(`清空订阅“${subscriptionDisplayName(job)}”已经收录的资料？订阅本身保留，下次刷新会重新收录。`)) return;
  try {
    const { result, jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}/items`, { method: "DELETE" });
    await loadLibraryIndex();
    renderRefreshJobs(jobs || []);
    refreshJobStatus.textContent = `已清空 ${result.deletedItemCount || 0} 条资料。`;
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

function fillAutoProcessFields(policy = {}) {
  if (!settingAutoProcessMode) return;
  settingAutoProcessMode.value = policy.mode || "threshold";
  settingAutoProcessMessages.value = policy.minNewMessages ?? 20;
  settingAutoProcessChars.value = policy.minNewChars ?? 3000;
  settingAutoProcessDays.value = policy.maxStaleDays ?? 7;
  const manual = settingAutoProcessMode.value !== "threshold";
  for (const input of [settingAutoProcessMessages, settingAutoProcessChars, settingAutoProcessDays]) input.disabled = manual;
}
settingAutoProcessMode?.addEventListener("change", () => fillAutoProcessFields({
  mode: settingAutoProcessMode.value,
  minNewMessages: settingAutoProcessMessages.value,
  minNewChars: settingAutoProcessChars.value,
  maxStaleDays: settingAutoProcessDays.value
}));

