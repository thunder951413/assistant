function setSettingsTab(tabName) {
  const next = ["ai", "capture", "tags", "storage", "notify"].includes(tabName) ? tabName : "ai";
  state.settingsTab = next;
  settingsTabs.forEach((button) => {
    const active = button.dataset.settingsTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== next;
  });
}

async function loadTags() {
  const { tags } = await api("/api/tags");
  state.tags = tags;
  renderTags();
}

// The unread count comes from the library index (one request for everything).
async function loadMaterialUpdateCount() {
  await loadLibraryIndex();
  renderHomeOverview();
}

async function openWorkbenchSearch(event) {
  event.preventDefault();
  const query = workbenchSearchInput?.value.trim();
  if (!query) return;
  state.query = query;
  searchInput.value = query;
  await switchView("materials");
  await loadItems();
}

async function openWorkbenchAsk() {
  const query = workbenchSearchInput?.value.trim();
  await switchView("chat");
  if (query) {
    chatInput.value = query;
    chatInput.focus();
  }
}

function runStatusText(run) {
  if (!run) return "";
  if (run.status === "queued") return "排队中";
  if (run.status === "waiting_for_teams_confirmation") return run.currentJobName || "等待确认 Teams 聊天窗口";
  if (run.status === "running") return run.currentJobName ? `运行中：${run.currentJobName}` : "运行中";
  if (run.status === "canceling") return "正在取消";
  if (run.status === "canceled") return "已取消";
  if (run.status === "failed") return run.error || "刷新失败";
  if (run.status === "completed") return "刷新完成";
  return run.status || "";
}

function syncTeamsReadyDialog(run) {
  if (!teamsReadyDialog) return;
  if (run?.status === "waiting_for_teams_confirmation") {
    state.teamsReadyRunId = run.id;
    teamsReadyStatus.textContent = "确认聊天列表和聊天窗口可见后再继续。";
    confirmTeamsReadyButton.disabled = false;
    cancelTeamsRefreshButton.disabled = false;
    if (!teamsReadyDialog.open) teamsReadyDialog.showModal();
    return;
  }
  if (state.teamsReadyRunId && (!run || run.id === state.teamsReadyRunId)) {
    state.teamsReadyRunId = "";
    if (teamsReadyDialog.open) teamsReadyDialog.close();
  }
}

async function confirmTeamsReady() {
  const runId = state.teamsReadyRunId;
  if (!runId) return;
  confirmTeamsReadyButton.disabled = true;
  cancelTeamsRefreshButton.disabled = true;
  teamsReadyStatus.textContent = "正在检查 Teams 页面状态...";
  try {
    const { run } = await api(`/api/refresh-runs/${encodeURIComponent(runId)}/teams-ready`, { method: "POST" });
    teamsReadyStatus.textContent = "Teams 页面确认成功，正在定位目标对话...";
    syncTeamsReadyDialog(run);
  } catch (error) {
    teamsReadyStatus.textContent = error.message;
    confirmTeamsReadyButton.disabled = false;
    cancelTeamsRefreshButton.disabled = false;
  }
}

async function cancelTeamsReadyRefresh() {
  const runId = state.teamsReadyRunId;
  if (!runId) return;
  confirmTeamsReadyButton.disabled = true;
  cancelTeamsRefreshButton.disabled = true;
  teamsReadyStatus.textContent = "正在取消刷新...";
  try {
    const { run } = await api(`/api/refresh-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    syncTeamsReadyDialog(run);
  } catch (error) {
    teamsReadyStatus.textContent = error.message;
    confirmTeamsReadyButton.disabled = false;
    cancelTeamsRefreshButton.disabled = false;
  }
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))} 分钟前`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} 小时前`;
  if (diffMs < day * 2) return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  return formatDate(value);
}

function compactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (Date.now() - date.getTime() < 2 * 24 * 60 * 60 * 1000) return relativeTime(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${sameYear ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
}

function countSources(items) {
  const counts = new Map();
  for (const item of items || []) {
    const source = normalizeSourceType(item.sourceType || item.source || "text");
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return counts;
}

function normalizeSourceType(source) {
  const value = String(source || "").toLowerCase();
  if (value.includes("jira") || value.includes("atlassian")) return "jira";
  if (value.includes("github")) return "github";
  if (value.includes("teams")) return "teams";
  if (value.includes("confluence")) return "confluence";
  if (value.includes("web") || value.includes("http")) return "web";
  return value || "text";
}

function captureMethodLabel(method) {
  return { manual: "手动输入", paste: "粘贴内容", fetch: "网页抓取", webdriver: "浏览器抓取", api: "接口抓取", user_capture: "浏览器捕获" }[method] || method;
}

function completenessLabel(value) {
  return { complete: "完整", partial: "部分内容", unknown: "范围未确认" }[value] || value || "";
}

function coverageNote(metadata) {
  if (!metadata?.completeness || metadata.completeness === "complete" || (metadata.captureMethod === "manual" && metadata.completeness === "unknown")) return "";
  const coverage = metadata.coverage;
  const hasCoverage = typeof coverage === "string" ? Boolean(coverage.trim()) : Boolean(coverage && Object.keys(coverage).length);
  const detail = hasCoverage ? ` · ${typeof coverage === "string" ? coverage : coverageSummary(coverage)}` : "";
  return `<div class="detail-note">覆盖范围：${escapeHtml(completenessLabel(metadata.completeness))}${escapeHtml(detail)}</div>`;
}

function coverageSummary(coverage) {
  const parts = [];
  if (coverage.observedCount != null) parts.push(`已读取 ${coverage.observedCount} 条`);
  if (coverage.expectedCount != null) parts.push(`预期 ${coverage.expectedCount} 条`);
  if (coverage.timeRange) parts.push(String(coverage.timeRange));
  if (coverage.gap) parts.push(`⚠ 未能接上上次抓取的位置，${coverage.oldestObservedAt ? `${String(coverage.oldestObservedAt).slice(0, 10)} 之前` : "较早"}可能有消息缺失`);
  else if (coverage.stoppedBy === "no-more-history") parts.push("已到会话开头");
  return parts.join("，") || "";
}

