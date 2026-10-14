const state = {
  view: "home",
  items: [],
  tags: [],
  chatSessions: [],
  activeChatId: "",
  importPreview: null,
  importPreviewRequest: 0,
  importPreviewController: null,
  importSubmitting: false,
  itemSelectionRequest: 0,
  chatRequest: null,
  chatSessionsHydrated: false,
  chatSessionsLocalOnly: false,
  chatPersistQueue: Promise.resolve(),
  refreshJobs: [],
  tagEditor: {
    item: null,
    selected: [],
    recommended: []
  },
  batchProcess: {
    items: [],
    tagAssignments: [],
    tagOptions: [],
    selectedTags: [],
    errors: [],
    cancelRequested: false,
    running: false
  },
  settingsTags: [],
  selectedSettingsTags: new Set(),
  supplementalEntries: [],
  updateCount: 0,
  refreshReloadTimer: null,
  refreshMonitorTimer: null,
  homeSourceRefresh: {
    confirmSource: "",
    runningSource: "",
    runId: "",
    requestToken: "",
    startedAt: "",
    total: 0,
    completed: 0,
    failed: 0,
    message: "",
    pollErrorCount: 0,
    pollTimer: null,
    timeoutAt: 0
  },
  activeRefreshRun: {
    id: "",
    scope: "",
    pollTimer: null
  },
  seenRefreshRunKey: localStorage.getItem("materialOrganizer.seenRefreshRunKey") || "",
  seenRefreshFailureKey: localStorage.getItem("materialOrganizer.seenRefreshFailureKey") || "",
  toastTimers: new Map(),
  authFailurePrompt: null,
  teamsReadyRunId: "",
  listClassification: null,
  listClassifying: false,
  listClassifier: {
    categories: loadStoredListCategories()
  },
  subscriptionSource: "all",
  subscriptionDirty: false,
  settingsTab: "ai",
  doNotDisturb: false,
  detailMode: localStorage.getItem("materialOrganizer.detailMode") || "processed",
  selectedId: null,
  sourceType: "",
  integrityStatus: "",
  tag: "",
  query: "",
  page: 1,
  pageSize: 50,
  totalItems: 0,
  settings: null
};

const itemList = document.querySelector("#itemList");
const tagList = document.querySelector("#tagList");
const materialsNewBadge = document.querySelector("#materialsNewBadge");
const materialSidebar = document.querySelector("#materialSidebar");
const homeRecentUpdates = document.querySelector("#homeRecentUpdates");
const workbenchSearchForm = document.querySelector("#workbenchSearchForm");
const workbenchSearchInput = document.querySelector("#workbenchSearchInput");
const workbenchAskButton = document.querySelector("#workbenchAskButton");
const homeFirstImportButton = document.querySelector("#homeFirstImportButton");
const homeView = document.querySelector("#homeView");
const doNotDisturbToggle = document.querySelector("#doNotDisturbToggle");
const chatView = document.querySelector("#chatView");
const materialsView = document.querySelector("#materialsView");
const importView = document.querySelector("#importView");
const supplementalView = document.querySelector("#supplementalView");
const subscriptionsView = document.querySelector("#subscriptionsView");
const settingsView = document.querySelector("#settingsView");
const detailPanel = document.querySelector("#detailPanel");
const materialsTitle = document.querySelector("#materialsTitle");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const classifyListButton = document.querySelector("#classifyListButton");
const batchProcessButton = document.querySelector("#batchProcessButton");
const agentRoot = document.querySelector("#agentRoot");
const chatSessionTitle = document.querySelector("#chatSessionTitle");
const chatHistoryList = document.querySelector("#chatHistoryList");
const newChatButton = document.querySelector("#newChatButton");
const clearChatHistoryButton = document.querySelector("#clearChatHistoryButton");
const chatMessages = document.querySelector("#chatMessages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const importForm = document.querySelector("#importForm");
const importContent = document.querySelector("#importContent");
const importSourceType = document.querySelector("#importSourceType");
const importFetchMode = document.querySelector("#importFetchMode");
const importPageKind = document.querySelector("#importPageKind");
const importUrl = document.querySelector("#importUrl");
const dropZone = document.querySelector("#dropZone");
const previewStatus = document.querySelector("#previewStatus");
const previewBadge = document.querySelector("#previewBadge");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmTags = document.querySelector("#confirmTags");
const previewContent = document.querySelector("#previewContent");
const previewReadableContent = document.querySelector("#previewReadableContent");
const summarizeButton = document.querySelector("#summarizeButton");
const summaryStatus = document.querySelector("#summaryStatus");
const summaryContent = document.querySelector("#summaryContent");
const confirmImportButton = document.querySelector("#confirmImportButton");
const clearImportButton = document.querySelector("#clearImportButton");
const copyPreviewButton = document.querySelector("#copyPreviewButton");
const settingsForm = document.querySelector("#settingsForm");
const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
const settingsPanels = [...document.querySelectorAll("[data-settings-panel]")];
const settingBaseUrl = document.querySelector("#settingBaseUrl");
const settingApiKey = document.querySelector("#settingApiKey");
const settingModel = document.querySelector("#settingModel");
const aiPrivacyNotice = document.querySelector("#aiPrivacyNotice");
const settingShowThinking = document.querySelector("#settingShowThinking");
const settingShowToolCalls = document.querySelector("#settingShowToolCalls");
const settingNotificationsEnabled = document.querySelector("#settingNotificationsEnabled");
const notificationSourceInputs = [...document.querySelectorAll("[data-notification-source]")];
const settingRefreshStartTime = document.querySelector("#settingRefreshStartTime");
const settingRefreshEndTime = document.querySelector("#settingRefreshEndTime");
const settingEmbeddingEnabled = document.querySelector("#settingEmbeddingEnabled");
const settingEmbeddingBaseUrl = document.querySelector("#settingEmbeddingBaseUrl");
const settingEmbeddingApiKey = document.querySelector("#settingEmbeddingApiKey");
const settingEmbeddingModel = document.querySelector("#settingEmbeddingModel");
const settingEmbeddingDimensions = document.querySelector("#settingEmbeddingDimensions");
const processingPromptFields = [...document.querySelectorAll("[data-processing-prompt]")];
const settingDocumentRoot = document.querySelector("#settingDocumentRoot");
const activeDocumentRoot = document.querySelector("#activeDocumentRoot");
const storageStatsElement = document.querySelector("#storageStats");
const cleanupSnapshotsButton = document.querySelector("#cleanupSnapshotsButton");
const cleanupBrowserCacheButton = document.querySelector("#cleanupBrowserCacheButton");
const storageCleanupStatus = document.querySelector("#storageCleanupStatus");
const settingsStatus = document.querySelector("#settingsStatus");
const exportSettingsButton = document.querySelector("#exportSettingsButton");
const importSettingsButton = document.querySelector("#importSettingsButton");
const exportDataButton = document.querySelector("#exportDataButton");
const importDataButton = document.querySelector("#importDataButton");
const settingsImportFile = document.querySelector("#settingsImportFile");
const dataImportFile = document.querySelector("#dataImportFile");
const toastRegion = document.querySelector("#toastRegion");
const replaceDataOnImport = document.querySelector("#replaceDataOnImport");
const importExportStatus = document.querySelector("#importExportStatus");
const sourceProfiles = document.querySelector("#sourceProfiles");
const addSourceProfileForm = document.querySelector("#addSourceProfileForm");
const newSourceHostname = document.querySelector("#newSourceHostname");
const newSourceType = document.querySelector("#newSourceType");
const webdriverStatus = document.querySelector("#webdriverStatus");
const subscriptionTabs = document.querySelector("#subscriptionTabs");
const runAllSubscriptionsButton = document.querySelector("#runAllSubscriptionsButton");
const saveSubscriptionsButton = document.querySelector("#saveSubscriptionsButton");
const subscriptionConnectionSettingsButton = document.querySelector("#subscriptionConnectionSettingsButton");
const refreshJobs = document.querySelector("#refreshJobs");
const refreshJobStatus = document.querySelector("#refreshJobStatus");
const newTagInput = document.querySelector("#newTagInput");
const addTagButton = document.querySelector("#addTagButton");
const tagManagerStatus = document.querySelector("#tagManagerStatus");
const selectAllTagsButton = document.querySelector("#selectAllTagsButton");
const clearTagSelectionButton = document.querySelector("#clearTagSelectionButton");
const deleteSelectedTagsButton = document.querySelector("#deleteSelectedTagsButton");
const settingsTagList = document.querySelector("#settingsTagList");
const tagDialog = document.querySelector("#tagDialog");
const tagDialogForm = document.querySelector("#tagDialogForm");
const tagDialogSubtitle = document.querySelector("#tagDialogSubtitle");
const closeTagDialogButton = document.querySelector("#closeTagDialogButton");
const cancelTagDialogButton = document.querySelector("#cancelTagDialogButton");
const tagManualInput = document.querySelector("#tagManualInput");
const addManualTagButton = document.querySelector("#addManualTagButton");
const selectedTagChips = document.querySelector("#selectedTagChips");
const existingTagChips = document.querySelector("#existingTagChips");
const recommendedTagChips = document.querySelector("#recommendedTagChips");
const recommendTagsButton = document.querySelector("#recommendTagsButton");
const tagRecommendStatus = document.querySelector("#tagRecommendStatus");
const supplementalSummary = document.querySelector("#supplementalSummary");
const supplementalList = document.querySelector("#supplementalList");
const supplementalStatus = document.querySelector("#supplementalStatus");
const saveSupplementalButton = document.querySelector("#saveSupplementalButton");
const suggestSupplementalButton = document.querySelector("#suggestSupplementalButton");
const addSupplementalEntryButton = document.querySelector("#addSupplementalEntryButton");
const batchProcessDialog = document.querySelector("#batchProcessDialog");
const batchProcessForm = document.querySelector("#batchProcessForm");
const closeBatchProcessButton = document.querySelector("#closeBatchProcessButton");
const cancelBatchProcessButton = document.querySelector("#cancelBatchProcessButton");
const startBatchProcessButton = document.querySelector("#startBatchProcessButton");
const applyBatchTagsButton = document.querySelector("#applyBatchTagsButton");
const batchProcessTagsToggle = document.querySelector("#batchProcessTagsToggle");
const batchProcessTagMode = document.querySelector("#batchProcessTagMode");
const batchProcessForceToggle = document.querySelector("#batchProcessForceToggle");
const batchProcessConcurrency = document.querySelector("#batchProcessConcurrency");
const batchProcessStatus = document.querySelector("#batchProcessStatus");
const batchProcessCount = document.querySelector("#batchProcessCount");
const batchProcessProgress = document.querySelector("#batchProcessProgress");
const batchProcessSubtitle = document.querySelector("#batchProcessSubtitle");
const batchTagReview = document.querySelector("#batchTagReview");
const batchTagGroups = document.querySelector("#batchTagGroups");
const classifyListDialog = document.querySelector("#classifyListDialog");
const classifyListForm = document.querySelector("#classifyListForm");
const closeClassifyListButton = document.querySelector("#closeClassifyListButton");
const cancelClassifyListButton = document.querySelector("#cancelClassifyListButton");
const runClassifyListButton = document.querySelector("#runClassifyListButton");
const classifyCategoryInput = document.querySelector("#classifyCategoryInput");
const addClassifyCategoryButton = document.querySelector("#addClassifyCategoryButton");
const classificationCategoryChips = document.querySelector("#classificationCategoryChips");
const classificationStatus = document.querySelector("#classificationStatus");
const classificationCount = document.querySelector("#classificationCount");
const classificationProgress = document.querySelector("#classificationProgress");
const classifyListSubtitle = document.querySelector("#classifyListSubtitle");
const authFailureDialog = document.querySelector("#authFailureDialog");
const authFailureMessage = document.querySelector("#authFailureMessage");
const closeAuthFailureButton = document.querySelector("#closeAuthFailureButton");
const dismissAuthFailureButton = document.querySelector("#dismissAuthFailureButton");
const openAuthWebdriverButton = document.querySelector("#openAuthWebdriverButton");
const teamsReadyDialog = document.querySelector("#teamsReadyDialog");
const teamsReadyStatus = document.querySelector("#teamsReadyStatus");
const confirmTeamsReadyButton = document.querySelector("#confirmTeamsReadyButton");
const cancelTeamsRefreshButton = document.querySelector("#cancelTeamsRefreshButton");
const globalAddButton = document.querySelector("#globalAddButton");
const previewImportButton = document.querySelector("#previewImportButton");
const subscribeImportButton = document.querySelector("#subscribeImportButton");
const chatSubmitButton = document.querySelector("#chatSubmitButton");
const stopChatButton = document.querySelector("#stopChatButton");
const chatSessionStatus = document.querySelector("#chatSessionStatus");
const copyCapturePairingButton = document.querySelector("#copyCapturePairingButton");
const capturePairingStatus = document.querySelector("#capturePairingStatus");

chatForm.addEventListener("submit", sendChatMessage);
newChatButton.addEventListener("click", () => createChatSession({ activate: true }));
clearChatHistoryButton.addEventListener("click", clearChatHistory);
importForm.addEventListener("submit", previewImport);
confirmImportButton.addEventListener("click", confirmImport);
subscribeImportButton?.addEventListener("click", () => confirmImport({ subscribe: true }));
globalAddButton?.addEventListener("click", () => switchView("import"));
homeFirstImportButton?.addEventListener("click", () => switchView("import"));
workbenchSearchForm?.addEventListener("submit", openWorkbenchSearch);
workbenchAskButton?.addEventListener("click", openWorkbenchAsk);
stopChatButton?.addEventListener("click", cancelChatRequest);
copyCapturePairingButton?.addEventListener("click", copyCapturePairing);
clearImportButton.addEventListener("click", resetImport);
copyPreviewButton.addEventListener("click", copyPreview);
summarizeButton.addEventListener("click", summarizePreview);
settingsForm.addEventListener("submit", saveSettings);
doNotDisturbToggle?.addEventListener("click", toggleDoNotDisturb);
exportSettingsButton.addEventListener("click", () => downloadExport("/api/export/settings"));
exportDataButton.addEventListener("click", () => downloadExport("/api/export/data"));
importSettingsButton.addEventListener("click", () => settingsImportFile.click());
importDataButton.addEventListener("click", () => dataImportFile.click());
cleanupSnapshotsButton?.addEventListener("click", cleanupSnapshots);
cleanupBrowserCacheButton?.addEventListener("click", cleanupBrowserCache);
settingsImportFile.addEventListener("change", importSettingsFile);
dataImportFile.addEventListener("change", importDataFile);
saveSubscriptionsButton.addEventListener("click", saveSubscriptions);
subscriptionConnectionSettingsButton?.addEventListener("click", async () => {
  state.settingsTab = "capture";
  await switchView("settings");
});
document.querySelector("#addSourceProfileButton")?.addEventListener("click", addSourceProfile);
newSourceHostname?.addEventListener("keydown", (event) => { if (event.key === "Enter") addSourceProfile(event); });
// Unsaved edits live in the drawer; background polling never re-renders it then.
document.querySelector("#subscriptionDrawer")?.addEventListener("input", () => { state.subscriptionDirty = true; });
runAllSubscriptionsButton.addEventListener("click", runAllRefreshJobs);
settingsTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
});
tagDialogForm.addEventListener("submit", saveTagDialog);
closeTagDialogButton.addEventListener("click", closeTagDialog);
cancelTagDialogButton.addEventListener("click", closeTagDialog);
addManualTagButton.addEventListener("click", addManualTag);
recommendTagsButton.addEventListener("click", recommendTagsForCurrentItem);
saveSupplementalButton.addEventListener("click", saveSupplementalContext);
suggestSupplementalButton.addEventListener("click", suggestSupplementalContext);
addSupplementalEntryButton.addEventListener("click", addSupplementalEntry);
batchProcessButton.addEventListener("click", openBatchProcessDialog);
classifyListButton.addEventListener("click", openClassifyListDialog);
closeClassifyListButton.addEventListener("click", closeClassifyListDialog);
cancelClassifyListButton.addEventListener("click", closeClassifyListDialog);
addClassifyCategoryButton.addEventListener("click", addClassificationCategory);
classifyCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addClassificationCategory();
  }
});
runClassifyListButton.addEventListener("click", classifyCurrentList);
classifyListForm.addEventListener("submit", (event) => event.preventDefault());
closeBatchProcessButton.addEventListener("click", closeBatchProcessDialog);
cancelBatchProcessButton.addEventListener("click", closeBatchProcessDialog);
startBatchProcessButton.addEventListener("click", startBatchProcess);
applyBatchTagsButton.addEventListener("click", applyBatchTags);
batchProcessTagsToggle.addEventListener("change", updateBatchProcessCandidates);
batchProcessTagMode.addEventListener("change", updateBatchProcessCandidates);
batchProcessForceToggle.addEventListener("change", updateBatchProcessCandidates);
batchProcessForm.addEventListener("submit", (event) => event.preventDefault());
closeAuthFailureButton?.addEventListener("click", closeAuthFailureDialog);
dismissAuthFailureButton?.addEventListener("click", closeAuthFailureDialog);
openAuthWebdriverButton?.addEventListener("click", openAuthFailureWebdriver);
teamsReadyDialog?.addEventListener("cancel", (event) => event.preventDefault());
confirmTeamsReadyButton?.addEventListener("click", confirmTeamsReady);
cancelTeamsRefreshButton?.addEventListener("click", cancelTeamsReadyRefresh);
addTagButton.addEventListener("click", addSettingsTags);
selectAllTagsButton.addEventListener("click", () => {
  state.selectedSettingsTags = new Set(state.settingsTags.map((tag) => tag.name));
  renderSettingsTags();
});
clearTagSelectionButton.addEventListener("click", () => {
  state.selectedSettingsTags.clear();
  renderSettingsTags();
});
deleteSelectedTagsButton.addEventListener("click", deleteSelectedSettingsTags);
newTagInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addSettingsTags();
});
tagManualInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addManualTag();
});
document.querySelectorAll("[data-webdriver-url]").forEach((button) => {
  button.addEventListener("click", () => openWebdriver(button.dataset.webdriverUrl));
});
document.querySelectorAll("[data-save-cookie-url]").forEach((button) => {
  button.addEventListener("click", () => saveWebdriverCookies(button.dataset.saveCookieUrl));
});
importContent.addEventListener("paste", () => setTimeout(() => scheduleAutoPreviewImport(), 0));
importUrl.addEventListener("paste", () => setTimeout(() => scheduleAutoPreviewImport(), 0));
previewContent.addEventListener("input", () => {
  previewReadableContent.innerHTML = renderMarkdown(previewContent.value || "暂无可阅读内容。");
});
dropZone.addEventListener("dragover", handleDragOver);
dropZone.addEventListener("dragleave", handleDragLeave);
dropZone.addEventListener("drop", handleDrop);

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView(button.dataset.view);
  });
});

document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView(button.dataset.viewShortcut);
  });
});

searchInput.addEventListener("input", debounce(async () => {
  state.query = searchInput.value.trim();
  await loadItems();
}, 200));

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

async function loadMaterialUpdateCount() {
  try {
    const { items } = await api("/api/items?updates=1");
    state.updateCount = items?.length || 0;
    renderMaterialsNewBadge();
    renderHomeOverview();
  } catch (error) {
    console.warn("Failed to load material update count:", error);
  }
}

function syncMaterialUpdateCountFromItems(items) {
  const visibleUpdates = (items || []).filter((item) => item.contentUpdatedAt).length;
  if (visibleUpdates || !state.sourceType && !state.tag && !state.query) {
    state.updateCount = visibleUpdates;
  }
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

function bindItemCards() {
  itemList.querySelectorAll(".item-card").forEach((card) => {
    card.addEventListener("click", () => selectItem(card.dataset.id));
  });
}

function renderClassifiedItems() {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const seen = new Set();
  const groups = (state.listClassification?.groups || []).map((group) => {
    const items = (group.itemIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    return { ...group, items };
  }).filter((group) => group.items.length);
  const leftovers = state.items.filter((item) => !seen.has(item.id));
  if (leftovers.length) {
    groups.push({ name: "未分类", reason: "AI 分类结果中未覆盖的资料。", items: leftovers });
  }

  itemList.innerHTML = groups.map((group) => `
    <section class="item-group">
      <div class="item-group-header">
        <div>
          <strong>${escapeHtml(group.name || "未命名分类")}</strong>
          ${group.reason ? `<p>${escapeHtml(group.reason)}</p>` : ""}
        </div>
        <span>${group.items.length}</span>
      </div>
      ${group.items.map(renderItemCard).join("")}
    </section>
  `).join("");
  bindItemCards();
}

function openClassifyListDialog() {
  if (!state.items.length) return;
  classifyListSubtitle.textContent = `当前列表 ${state.items.length} 条资料。自定义类别后，AI 会逐条归类。`;
  classificationStatus.textContent = "等待分类。";
  classificationCount.textContent = `0 / ${state.items.length}`;
  classificationProgress.value = 0;
  classificationProgress.max = Math.max(state.items.length, 1);
  renderClassificationCategories();
  classifyListDialog.showModal();
}

function closeClassifyListDialog() {
  if (state.listClassifying) return;
  classifyListDialog.close();
}

function addClassificationCategory() {
  const values = classifyCategoryInput.value
    .split(/[,，\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) return;
  state.listClassifier.categories = uniqueValues([
    ...state.listClassifier.categories,
    ...values
  ]).slice(0, 24);
  classifyCategoryInput.value = "";
  saveStoredListCategories();
  renderClassificationCategories();
}

function removeClassificationCategory(category) {
  if (state.listClassifying) return;
  state.listClassifier.categories = state.listClassifier.categories.filter((item) => item !== category);
  saveStoredListCategories();
  renderClassificationCategories();
}

function renderClassificationCategories() {
  const categories = state.listClassifier.categories || [];
  classificationCategoryChips.innerHTML = categories.length
    ? categories.map((category) => `
      <button type="button" class="tag-edit-chip" data-classification-category="${escapeHtml(category)}">
        ${escapeHtml(category)}
        <span>×</span>
      </button>
    `).join("")
    : `<span class="empty-inline">还没有类别。可以手动添加，也可以留空让 AI 自动归纳。</span>`;
  classificationCategoryChips.querySelectorAll("[data-classification-category]").forEach((button) => {
    button.addEventListener("click", () => removeClassificationCategory(button.dataset.classificationCategory));
  });
}

function saveStoredListCategories() {
  localStorage.setItem("materialOrganizer.listCategories", JSON.stringify(state.listClassifier.categories || []));
}

function loadStoredListCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem("materialOrganizer.listCategories") || "[]");
    return Array.isArray(parsed) ? uniqueValues(parsed.map((item) => String(item || "").trim()).filter(Boolean)) : [];
  } catch {
    return [];
  }
}

async function classifyCurrentList() {
  if (!state.items.length || state.listClassifying) return;
  const categories = uniqueValues((state.listClassifier.categories || []).map((category) => category.trim()).filter(Boolean));
  state.listClassifier.categories = categories;
  saveStoredListCategories();
  state.listClassifying = true;
  runClassifyListButton.disabled = true;
  closeClassifyListButton.disabled = true;
  cancelClassifyListButton.disabled = true;
  addClassifyCategoryButton.disabled = true;
  classifyCategoryInput.disabled = true;
  classificationStatus.textContent = categories.length
    ? `正在按 ${categories.length} 个类别分类...`
    : "正在让 AI 自动归纳分类...";
  classificationCount.textContent = `0 / ${state.items.length}`;
  classificationProgress.max = Math.max(state.items.length, 1);
  classificationProgress.value = 0;
  renderItems();
  try {
    if (categories.length) {
      state.listClassification = await classifyCurrentListByCategory(categories);
    } else {
      const result = await api("/api/classify-items", {
        method: "POST",
        body: JSON.stringify({
          ids: state.items.map((item) => item.id),
          categories
        })
      });
      state.listClassification = {
        groups: result.groups || [],
        note: result.note || ""
      };
    }
    classificationProgress.value = state.items.length;
    classificationCount.textContent = `${state.items.length} / ${state.items.length}`;
    classificationStatus.textContent = `分类完成，生成 ${state.listClassification.groups.length} 个分类。`;
    classifyListDialog.close();
  } catch (error) {
    classificationStatus.textContent = `分类失败：${error.message}`;
  } finally {
    state.listClassifying = false;
    runClassifyListButton.disabled = false;
    closeClassifyListButton.disabled = false;
    cancelClassifyListButton.disabled = false;
    addClassifyCategoryButton.disabled = false;
    classifyCategoryInput.disabled = false;
    renderItems();
  }
}

async function classifyCurrentListByCategory(categories) {
  const assignments = [];
  const errors = [];
  let completed = 0;
  for (const item of state.items) {
    classificationStatus.textContent = `正在分类：${item.title}`;
    try {
      const result = await api("/api/classify-item", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          categories
        })
      });
      assignments.push({
        id: item.id,
        category: result.category || "未分类",
        reason: result.reason || ""
      });
    } catch (error) {
      errors.push({ id: item.id, title: item.title, error: error.message });
      assignments.push({
        id: item.id,
        category: "未分类",
        reason: `分类失败：${error.message}`
      });
    }
    completed += 1;
    classificationProgress.value = completed;
    classificationCount.textContent = `${completed} / ${state.items.length}`;
  }
  return buildClassificationFromAssignments(assignments, categories, errors);
}

function buildClassificationFromAssignments(assignments, categories, errors = []) {
  const categorySet = new Set(categories);
  const groupsByName = new Map([...categories, "未分类"].map((category) => [category, {
    name: category,
    itemIds: [],
    reason: ""
  }]));
  for (const assignment of assignments) {
    const name = categorySet.has(assignment.category) ? assignment.category : "未分类";
    const group = groupsByName.get(name) || groupsByName.get("未分类");
    group.itemIds.push(assignment.id);
    if (!group.reason && assignment.reason) group.reason = assignment.reason;
  }
  return {
    groups: [...groupsByName.values()].filter((group) => group.itemIds.length),
    note: errors.length ? `${errors.length} 条资料分类失败，已放入未分类。` : ""
  };
}

function openBatchProcessDialog() {
  state.batchProcess = {
    items: [],
    tagAssignments: [],
    tagOptions: [],
    selectedTags: [],
    errors: [],
    cancelRequested: false,
    running: false
  };
  batchProcessForceToggle.checked = false;
  batchProcessForceToggle.disabled = false;
  batchProcessProgress.value = 0;
  batchProcessTagsToggle.checked = false;
  batchProcessTagsToggle.disabled = false;
  batchProcessTagMode.value = "batch";
  batchProcessTagMode.disabled = false;
  batchProcessConcurrency.value = batchProcessConcurrency.value || "2";
  batchProcessConcurrency.disabled = false;
  startBatchProcessButton.hidden = false;
  startBatchProcessButton.textContent = "开始处理";
  cancelBatchProcessButton.textContent = "关闭";
  cancelBatchProcessButton.disabled = false;
  closeBatchProcessButton.disabled = false;
  applyBatchTagsButton.hidden = true;
  batchTagReview.hidden = true;
  batchTagGroups.innerHTML = "";
  updateBatchProcessCandidates();
  batchProcessDialog.showModal();
}

function updateBatchProcessCandidates() {
  if (state.batchProcess.running) return;
  const force = batchProcessForceToggle.checked;
  const includeTags = batchProcessTagsToggle.checked;
  const tagMode = batchProcessTagMode.value;
  const contentCandidates = state.items.filter((item) => item.pageKind !== "list" && item.integrityStatus !== "quarantined" && (force || !item.hasProcessed));
  const tagOnlyCandidates = includeTags && tagMode === "batch"
    ? state.items.filter((item) => item.pageKind !== "list" && item.integrityStatus !== "quarantined")
    : [];
  const candidates = uniqueItemsById([...contentCandidates, ...tagOnlyCandidates]);
  state.batchProcess.items = candidates;
  state.batchProcess.contentIds = new Set(contentCandidates.map((item) => item.id));
  state.batchProcess.tagScopeIds = new Set((tagMode === "batch" ? tagOnlyCandidates : contentCandidates).map((item) => item.id));
  batchProcessSubtitle.textContent = describeBatchProcessPlan(force, includeTags, tagMode, contentCandidates.length, state.batchProcess.tagScopeIds.size);
  batchProcessStatus.textContent = candidates.length ? "等待开始。" : "没有需要处理的资料。";
  batchProcessCount.textContent = `0 / ${candidates.length}`;
  batchProcessProgress.max = Math.max(1, candidates.length);
  batchProcessProgress.value = 0;
  startBatchProcessButton.disabled = candidates.length === 0;
}

function describeBatchProcessPlan(force, includeTags, tagMode, contentCount, tagCount) {
  const contentText = force
    ? `重新处理 ${contentCount} 条资料`
    : contentCount
      ? `处理 ${contentCount} 条未整理资料`
      : "不重新处理正文";
  if (!includeTags) return contentCount ? `将${contentText}。` : "当前列表没有未整理资料。";
  const tagText = tagMode === "batch"
    ? `并对当前列表 ${tagCount} 条资料统一整理标签`
    : `并对 ${tagCount} 条未整理资料单独整理标签`;
  if (!contentCount && tagCount) return `将${tagText}。`;
  return `将${contentText}，${tagText}。`;
}

function uniqueItemsById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function closeBatchProcessDialog() {
  if (state.batchProcess.running) {
    stopBatchProcess();
    return;
  }
  batchProcessDialog.close();
}

function stopBatchProcess() {
  if (!state.batchProcess.running) return;
  state.batchProcess.cancelRequested = true;
  batchProcessStatus.textContent = "正在停止，已开始的请求完成后会结束。";
  cancelBatchProcessButton.disabled = true;
  closeBatchProcessButton.disabled = true;
}

async function startBatchProcess() {
  const items = state.batchProcess.items || [];
  if (!items.length || state.batchProcess.running) return;
  state.batchProcess.running = true;
  state.batchProcess.cancelRequested = false;
  state.batchProcess.tagAssignments = [];
  state.batchProcess.tagOptions = [];
  state.batchProcess.selectedTags = [];
  state.batchProcess.errors = [];
  const includeTags = batchProcessTagsToggle.checked;
  const tagMode = batchProcessTagMode.value;
  const concurrency = Math.min(8, Math.max(1, Number(batchProcessConcurrency.value || 2) || 2));
  batchProcessTagsToggle.disabled = true;
  batchProcessTagMode.disabled = true;
  batchProcessForceToggle.disabled = true;
  batchProcessConcurrency.disabled = true;
  startBatchProcessButton.disabled = true;
  cancelBatchProcessButton.textContent = "停止处理";
  cancelBatchProcessButton.disabled = false;
  closeBatchProcessButton.disabled = false;
  applyBatchTagsButton.hidden = true;
  batchTagReview.hidden = true;
  batchTagGroups.innerHTML = "";
  batchProcessProgress.max = items.length;
  batchProcessProgress.value = 0;

  let completed = 0;
  let cursor = 0;
  const processOne = async (item) => {
    if (state.batchProcess.cancelRequested) return;
    const needsContentProcessing = state.batchProcess.contentIds?.has(item.id);
    batchProcessStatus.textContent = needsContentProcessing ? `正在处理：${item.title}` : `准备标签：${item.title}`;
    try {
      let titledItem = { metadata: item };
      let processedItem = { metadata: item };
      if (needsContentProcessing) {
        const titleResponse = await api(`/api/items/${encodeURIComponent(item.id)}/recommend-title`, { method: "POST" });
        titledItem = titleResponse.item;
        const processResponse = await api(`/api/items/${encodeURIComponent(item.id)}/process`, { method: "POST" });
        processedItem = processResponse.item;
      }
      state.batchProcess.tagAssignments.push({
        id: item.id,
        title: processedItem?.metadata?.title || titledItem?.metadata?.title || item.title,
        currentTags: processedItem?.metadata?.tags || item.tags || [],
        recommendedTags: []
      });
    } catch (error) {
      state.batchProcess.errors.push({ id: item.id, title: item.title, error: error.message });
      state.batchProcess.tagAssignments.push({
        id: item.id,
        title: item.title,
        currentTags: item.tags || [],
        recommendedTags: [],
        error: error.message
      });
    }
    completed += 1;
    batchProcessProgress.value = completed;
    batchProcessCount.textContent = `${completed} / ${items.length}`;
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      if (state.batchProcess.cancelRequested) break;
      const item = items[cursor];
      cursor += 1;
      await processOne(item);
    }
  });
  batchProcessStatus.textContent = `处理中，并发 ${Math.min(concurrency, items.length)} 个...`;
  await Promise.all(workers);

  state.batchProcess.running = false;
  const wasCancelled = state.batchProcess.cancelRequested;
  startBatchProcessButton.hidden = true;
  batchProcessTagsToggle.disabled = false;
  batchProcessTagMode.disabled = false;
  batchProcessForceToggle.disabled = false;
  batchProcessConcurrency.disabled = false;
  cancelBatchProcessButton.textContent = "关闭";
  cancelBatchProcessButton.disabled = false;
  closeBatchProcessButton.disabled = false;
  if (includeTags && !wasCancelled) {
    await buildBatchTagOptions(tagMode);
  }
  const errorCount = state.batchProcess.errors.length;
  batchProcessStatus.textContent = wasCancelled
    ? `已停止，完成 ${completed} / ${items.length}。`
    : errorCount
    ? `处理完成，${errorCount} 条失败。`
    : includeTags
      ? "处理完成。请选择要保留的标签。"
      : "处理完成。";
  if (includeTags || errorCount) {
    renderBatchTagReview();
    applyBatchTagsButton.hidden = !includeTags;
  }
  await loadItems();
  if (state.selectedId) {
    await selectItem(state.selectedId);
  }
}

async function buildBatchTagOptions(tagMode) {
  const scopeIds = state.batchProcess.tagScopeIds || new Set();
  const assignments = (state.batchProcess.tagAssignments || [])
    .filter((assignment) => !assignment.error && scopeIds.has(assignment.id));
  if (!assignments.length) return;
  let batchTags = [];
  batchProcessStatus.textContent = tagMode === "batch"
    ? "正在根据全部文档统一生成标签..."
    : "正在为未整理文档单独生成标签...";
  try {
    if (tagMode === "batch") {
      const result = await api("/api/batch-recommend-tags", {
        method: "POST",
        body: JSON.stringify({ ids: assignments.map((assignment) => assignment.id) })
      });
      batchTags = uniqueValues(result.tags || []);
      const assignmentById = new Map((result.assignments || []).map((assignment) => [assignment.id, assignment.tags || []]));
      for (const assignment of assignments) {
        assignment.recommendedTags = uniqueValues(assignmentById.get(assignment.id) || []);
      }
    } else {
      for (const assignment of assignments) {
        const result = await api(`/api/items/${encodeURIComponent(assignment.id)}/recommend-tags`, { method: "POST" });
        assignment.recommendedTags = uniqueValues(result.tags || []);
      }
    }
    const countByTag = new Map();
    for (const assignment of assignments) {
      for (const tag of assignment.recommendedTags || []) {
        countByTag.set(tag, (countByTag.get(tag) || 0) + 1);
      }
    }
    const allTags = uniqueValues([
      ...batchTags,
      ...assignments.flatMap((assignment) => assignment.recommendedTags || [])
    ]);
    state.batchProcess.tagOptions = allTags
      .map((name) => ({ name, count: countByTag.get(name) || 0 }))
      .filter((option) => option.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    state.batchProcess.selectedTags = state.batchProcess.tagOptions.map((option) => option.name);
  } catch (error) {
    state.batchProcess.errors.push({ id: "batch-tags", title: "批量标签生成", error: error.message });
    state.batchProcess.tagAssignments.push({
      id: "batch-tags",
      title: "批量标签生成",
      currentTags: [],
      recommendedTags: [],
      error: error.message
    });
  }
}

function renderBatchTagReview() {
  const assignments = state.batchProcess.tagAssignments || [];
  const tagOptions = state.batchProcess.tagOptions || [];
  const selectedTags = state.batchProcess.selectedTags || [];
  const failed = assignments.filter((assignment) => assignment.error);
  batchTagReview.hidden = false;
  batchTagGroups.innerHTML = tagOptions.length || failed.length
    ? `
      ${tagOptions.length ? `
        <section class="batch-tag-group">
          <div>
            <strong>标签筛选</strong>
            <p class="item-meta">重复标签只显示一次；括号中是将被应用到的文档数量。</p>
          </div>
          <div class="tag-editor-chips">
            ${tagOptions.map((option) => `
              <button type="button" class="tag-edit-chip ${selectedTags.includes(option.name) ? "is-selected" : ""}" data-batch-tag="${escapeHtml(option.name)}">
                ${escapeHtml(option.name)}
                <span>${escapeHtml(String(option.count))}</span>
              </button>
            `).join("")}
          </div>
        </section>
      ` : `<div class="empty-inline">没有生成推荐标签。</div>`}
      ${failed.length ? `
        <section class="batch-tag-group">
          <strong>处理失败</strong>
          ${failed.map((group) => `<p class="status-message">${escapeHtml(group.title)}：${escapeHtml(group.error)}</p>`).join("")}
        </section>
      ` : ""}
    `
    : `<div class="empty-inline">没有生成推荐标签。</div>`;

  batchTagGroups.querySelectorAll("[data-batch-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.batchTag;
      if (state.batchProcess.selectedTags.includes(tag)) {
        state.batchProcess.selectedTags = state.batchProcess.selectedTags.filter((candidate) => candidate !== tag);
      } else {
        state.batchProcess.selectedTags.push(tag);
      }
      renderBatchTagReview();
    });
  });
}

async function applyBatchTags() {
  const selected = new Set(state.batchProcess.selectedTags || []);
  const groups = (state.batchProcess.tagAssignments || []).filter((group) => !group.error);
  applyBatchTagsButton.disabled = true;
  applyBatchTagsButton.textContent = "应用中...";
  try {
    for (const group of groups) {
      const keptGeneratedTags = (group.recommendedTags || []).filter((tag) => selected.has(tag));
      const tags = uniqueValues([...(group.currentTags || []), ...keptGeneratedTags]);
      await api(`/api/items/${encodeURIComponent(group.id)}/tags`, {
        method: "PATCH",
        body: JSON.stringify({ tags })
      });
    }
    batchProcessStatus.textContent = "标签已应用。";
    await loadAll();
    if (state.selectedId) await selectItem(state.selectedId);
  } catch (error) {
    batchProcessStatus.textContent = error.message;
  } finally {
    applyBatchTagsButton.disabled = false;
    applyBatchTagsButton.textContent = "应用标签";
  }
}

function extractMarkdownSection(documentText, marker) {
  const source = String(documentText || "");
  const markerLine = `\n${marker}\n\n`;
  const index = source.indexOf(markerLine);
  if (index !== -1) return unwrapMarkdownFence(source.slice(index + markerLine.length).trim());
  const compactMarker = `${marker}\n\n`;
  if (source.startsWith(compactMarker)) return unwrapMarkdownFence(source.slice(compactMarker.length).trim());
  return unwrapMarkdownFence(source.trim());
}

function unwrapMarkdownFence(markdown) {
  const source = String(markdown || "").trim();
  const match = source.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : source;
}

async function selectItem(id) {
  state.selectedId = id;
  const requestId = ++state.itemSelectionRequest;
  renderItems();
  detailPanel.innerHTML = `<div class="empty-state">正在打开资料…</div>`;
  try {
    const { item } = await api(`/api/items/${encodeURIComponent(id)}`);
    if (requestId !== state.itemSelectionRequest || state.selectedId !== id) return;
    renderDetail(item);
  } catch (error) {
    if (requestId !== state.itemSelectionRequest || state.selectedId !== id) return;
    detailPanel.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "无法打开资料")}</div>`;
  }
}

function setupDetailTitleMarquee() {
  const wrap = document.querySelector("#detailTitleWrap");
  const input = document.querySelector("#detailTitleInput");
  const marquee = document.querySelector("#detailTitleMarquee");
  if (!wrap || !input || !marquee) return;

  const update = () => {
    marquee.textContent = input.value || "Untitled material";
    wrap.classList.remove("is-overflowing");
    wrap.style.setProperty("--title-scroll-distance", "0px");
    requestAnimationFrame(() => {
      const overflow = marquee.scrollWidth - wrap.clientWidth;
      if (overflow > 8) {
        wrap.style.setProperty("--title-scroll-distance", `${overflow + 24}px`);
        wrap.classList.add("is-overflowing");
      }
    });
  };

  wrap.addEventListener("click", () => input.focus());
  input.addEventListener("input", update);
  input.addEventListener("focus", () => wrap.classList.add("is-editing"));
  input.addEventListener("blur", () => {
    wrap.classList.remove("is-editing");
    update();
  });
  update();
}

function setupDetailToc() {
  const doc = document.querySelector("#detailDoc");
  const tocWrap = document.querySelector("#detailTocWrap");
  const tocToggle = document.querySelector("#detailTocToggle");
  const toc = document.querySelector("#detailToc");
  const tocList = document.querySelector("#detailTocList");
  const layout = document.querySelector("#detailContentLayout");
  if (!doc || !tocWrap || !tocToggle || !toc || !tocList || !layout) return;

  const headings = [...doc.querySelectorAll("h1, h2, h3, h4")]
    .map((heading, index) => {
      const text = heading.textContent.trim();
      if (!text) return null;
      const id = uniqueHeadingId(slugForHeading(text), index, doc);
      heading.id = id;
      heading.classList.add("toc-heading");
      return {
        id,
        text,
        level: Number(heading.tagName.slice(1))
      };
    })
    .filter(Boolean);

  if (!headings.length) {
    tocWrap.hidden = true;
    toc.hidden = true;
    layout.classList.remove("has-toc");
    return;
  }

  tocWrap.hidden = false;
  toc.hidden = true;
  tocToggle.setAttribute("aria-expanded", "false");
  tocToggle.textContent = "目录";
  layout.classList.add("has-toc");
  tocList.innerHTML = headings.map((heading) => `
    <button type="button" class="detail-toc-link level-${heading.level}" data-heading-id="${escapeHtml(heading.id)}">
      ${escapeHtml(heading.text)}
    </button>
  `).join("");

  tocList.querySelectorAll("[data-heading-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.headingId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      toc.hidden = true;
      tocToggle.setAttribute("aria-expanded", "false");
      tocToggle.textContent = "目录";
    });
  });
  tocToggle.addEventListener("click", () => {
    const nextOpen = toc.hidden;
    toc.hidden = !nextOpen;
    tocToggle.setAttribute("aria-expanded", String(nextOpen));
    tocToggle.textContent = nextOpen ? "隐藏" : "目录";
  });
}

function slugForHeading(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "heading";
}

function uniqueHeadingId(base, index, root) {
  let id = `doc-${base}`;
  let counter = index + 1;
  while (root.querySelector(`#${CSS.escape(id)}`)) {
    id = `doc-${base}-${counter}`;
    counter += 1;
  }
  return id;
}

async function openTagDialog(item) {
  state.tagEditor = {
    item,
    selected: [...(item.metadata.tags || [])],
    recommended: []
  };
  if (!state.tags.length) {
    await loadTags();
  }
  tagDialogSubtitle.textContent = item.metadata.title;
  tagManualInput.value = "";
  tagRecommendStatus.textContent = "可根据文档内容生成推荐标签。";
  renderTagDialog();
  tagDialog.showModal();
}

function closeTagDialog() {
  tagDialog.close();
}

function renderTagDialog() {
  const selected = state.tagEditor.selected || [];
  const recommended = state.tagEditor.recommended || [];
  const existing = state.tags || [];

  selectedTagChips.innerHTML = selected.length
    ? selected.map((tag) => `
        <button type="button" class="tag-edit-chip is-selected" data-remove-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
          <span aria-hidden="true">×</span>
        </button>
      `).join("")
    : `<div class="empty-inline">还没有选择标签。</div>`;

  existingTagChips.innerHTML = existing.length
    ? existing.map((tag) => `
        <button type="button" class="tag-edit-chip ${selected.includes(tag.name) ? "is-selected" : ""}" data-toggle-existing-tag="${escapeHtml(tag.name)}">
          ${escapeHtml(tag.name)}
          <small>${escapeHtml(String(tag.count || 0))}</small>
        </button>
      `).join("")
    : `<div class="empty-inline">资料库里还没有已有标签。</div>`;

  recommendedTagChips.innerHTML = recommended.length
    ? recommended.map((tag) => `
        <button type="button" class="tag-edit-chip ${selected.includes(tag) ? "is-selected" : ""}" data-toggle-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
        </button>
      `).join("")
    : `<div class="empty-inline">暂无推荐标签。</div>`;

  selectedTagChips.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tagEditor.selected = state.tagEditor.selected.filter((tag) => tag !== button.dataset.removeTag);
      renderTagDialog();
    });
  });

  recommendedTagChips.querySelectorAll("[data-toggle-tag]").forEach((button) => {
    button.addEventListener("click", () => toggleSelectedTag(button.dataset.toggleTag));
  });

  existingTagChips.querySelectorAll("[data-toggle-existing-tag]").forEach((button) => {
    button.addEventListener("click", () => toggleSelectedTag(button.dataset.toggleExistingTag));
  });
}

function addManualTag() {
  const values = tagManualInput.value.split(",").map((tag) => slugTagClient(tag)).filter(Boolean);
  if (!values.length) return;
  state.tagEditor.selected = uniqueValues([...state.tagEditor.selected, ...values]);
  tagManualInput.value = "";
  renderTagDialog();
}

function toggleSelectedTag(tag) {
  if (!tag) return;
  if (state.tagEditor.selected.includes(tag)) {
    state.tagEditor.selected = state.tagEditor.selected.filter((value) => value !== tag);
  } else {
    state.tagEditor.selected = uniqueValues([...state.tagEditor.selected, tag]);
  }
  renderTagDialog();
}

async function recommendTagsForCurrentItem() {
  const item = state.tagEditor.item;
  if (!item) return;
  tagRecommendStatus.textContent = "正在生成推荐标签...";
  recommendTagsButton.disabled = true;
  try {
    const result = await api(`/api/items/${encodeURIComponent(item.metadata.id)}/recommend-tags`, { method: "POST" });
    state.tagEditor.recommended = uniqueValues(result.tags || []);
    tagRecommendStatus.textContent = result.note || "推荐标签已生成。";
    renderTagDialog();
  } catch (error) {
    tagRecommendStatus.textContent = error.message;
  } finally {
    recommendTagsButton.disabled = false;
  }
}

async function saveTagDialog(event) {
  event.preventDefault();
  const item = state.tagEditor.item;
  if (!item) return;
  const nextTags = uniqueValues(state.tagEditor.selected.map((tag) => slugTagClient(tag)).filter(Boolean));
  await api(`/api/items/${encodeURIComponent(item.metadata.id)}/tags`, {
    method: "PATCH",
    body: JSON.stringify({ tags: nextTags })
  });
  closeTagDialog();
  await loadAll();
  await selectItem(item.metadata.id);
}

function slugTagClient(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9+\u4e00-\u9fa5-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

async function loadAgentConfig() {
  const config = await api("/api/agent-config");
  agentRoot.textContent = config.rootDir;
}

async function loadSettings() {
  const { settings } = await api("/api/settings");
  state.settings = settings;
  settingBaseUrl.value = settings.ai.baseUrl || "";
  settingApiKey.value = settings.ai.apiKey || "";
  settingModel.value = settings.ai.model || "";
  if (aiPrivacyNotice) {
    let host = "";
    try { host = new URL(settings.ai.baseUrl || "").hostname; } catch { host = ""; }
    const remote = host && !["localhost", "127.0.0.1", "::1"].includes(host);
    let embeddingHost = "";
    try { embeddingHost = new URL(settings.embedding?.baseUrl || "").hostname; } catch { embeddingHost = ""; }
    const embeddingRemote = Boolean(settings.embedding?.enabled && embeddingHost && !["localhost", "127.0.0.1", "::1"].includes(embeddingHost));
    aiPrivacyNotice.textContent = remote
      ? `当前使用远程 AI：${host}。问答、总结、标题、标签和资料整理会发送相关资料片段。`
      : embeddingRemote ? `当前 Embedding 使用远程服务：${embeddingHost}。资料向量化同样受来源隐私策略限制。`
      : host ? "当前 AI 运行在本机地址。" : "尚未配置 AI 或 Embedding；资料不会发送到模型服务。";
    aiPrivacyNotice.classList.toggle("is-remote", Boolean(remote || embeddingRemote));
  }
  settingShowThinking.checked = settings.chat?.showThinking !== false;
  settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
  setDoNotDisturbState(Boolean(settings.doNotDisturb?.enabled), { renderOnly: true });
  settingNotificationsEnabled.checked = settings.notifications?.enabled !== false;
  for (const input of notificationSourceInputs) {
    input.checked = settings.notifications?.sources?.[input.dataset.notificationSource] !== false;
  }
  settingRefreshStartTime.value = settings.refreshSchedule?.startTime || "08:00";
  settingRefreshEndTime.value = settings.refreshSchedule?.endTime || "20:00";
  settingEmbeddingEnabled.checked = Boolean(settings.embedding?.enabled);
  settingEmbeddingBaseUrl.value = settings.embedding?.baseUrl || "";
  settingEmbeddingApiKey.value = settings.embedding?.apiKey || "";
  settingEmbeddingModel.value = settings.embedding?.model || "";
  settingEmbeddingDimensions.value = settings.embedding?.dimensions || "";
  for (const field of processingPromptFields) {
    field.value = settings.processingPrompts?.[field.dataset.processingPrompt] || "";
  }
  settingDocumentRoot.value = settings.documentRoot || "";
  fillAutoProcessFields(settings.autoProcess);
  activeDocumentRoot.textContent = settings.activeDocumentRoot || settings.documentRoot || "";
  renderSourceProfiles(settings.sources || {});
  renderRefreshJobs(settings.refreshJobs || []);
  rememberLatestRefreshRun(settings.refreshJobs || []);
  await loadSettingsTags();
  await loadStorageStats();
}

async function loadStorageStats() {
  if (!storageStatsElement) return;
  try {
    const { stats } = await api("/api/storage-stats");
    storageStatsElement.textContent = formatStorageStats(stats);
  } catch (error) {
    storageStatsElement.textContent = `无法读取存储占用：${error.message}`;
  }
}

function formatStorageStats(stats = {}) {
  return `知识库 ${formatBytes(stats.knowledgeBytes)} · 历史快照 ${formatBytes(stats.snapshotBytes)} · WebDriver 登录数据 ${formatBytes(stats.webdriverBytes)}（其中可清理缓存 ${formatBytes(stats.browserCacheBytes)}）`;
}

async function cleanupSnapshots() {
  if (!cleanupSnapshotsButton) return;
  const confirmed = window.confirm("将删除每条资料超过最近 20 个版本的旧快照，并压缩历史快照中的原始抓取内容。当前资料和最近 20 个版本的正文、评论不受影响。是否继续？");
  if (!confirmed) return;
  cleanupSnapshotsButton.disabled = true;
  storageCleanupStatus.textContent = "正在清理并压缩旧快照...";
  try {
    const { result, stats } = await api("/api/storage-cleanup", { method: "POST" });
    storageCleanupStatus.textContent = `已删除 ${result.removedSnapshots} 个旧快照，压缩 ${result.compressedFiles || 0} 个原始文件，释放 ${formatBytes(result.reclaimedBytes)}。`;
    storageStatsElement.textContent = formatStorageStats(stats);
  } catch (error) {
    storageCleanupStatus.textContent = error.message;
  } finally {
    cleanupSnapshotsButton.disabled = false;
  }
}

async function cleanupBrowserCache() {
  if (!cleanupBrowserCacheButton) return;
  const confirmed = window.confirm("将清理 WebDriver 浏览器的页面缓存、脚本缓存和 Service Worker 缓存。Cookie、登录状态和本地存储会保留；正在使用的浏览器窗口会跳过。是否继续？");
  if (!confirmed) return;
  cleanupBrowserCacheButton.disabled = true;
  storageCleanupStatus.textContent = "正在清理浏览器缓存...";
  try {
    const { result, stats } = await api("/api/storage-cleanup-browser", { method: "POST" });
    const skipped = (result.profiles || []).filter((profile) => profile.skipped).map((profile) => profile.profile);
    storageCleanupStatus.textContent = `已释放 ${formatBytes(result.reclaimedBytes)}。${skipped.length ? `正在使用中已跳过：${skipped.join("、")}。` : ""}`;
    storageStatsElement.textContent = formatStorageStats(stats);
  } catch (error) {
    storageCleanupStatus.textContent = error.message;
  } finally {
    cleanupBrowserCacheButton.disabled = false;
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes;
  let index = -1;
  do {
    amount /= 1024;
    index += 1;
  } while (amount >= 1024 && index < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

async function loadSupplementalContext() {
  supplementalStatus.textContent = "正在载入补充资料...";
  try {
    const { entries, path } = await api("/api/supplemental-context");
    state.supplementalEntries = normalizeSupplementalEntriesClient(entries || []);
    renderSupplementalEntries();
    supplementalStatus.textContent = `保存位置：${path}`;
  } catch (error) {
    supplementalStatus.textContent = error.message;
  }
}

async function saveSupplementalContext() {
  saveSupplementalButton.disabled = true;
  supplementalStatus.textContent = "正在保存补充资料...";
  try {
    syncSupplementalEntriesFromDom();
    const { entries, path } = await api("/api/supplemental-context", {
      method: "PATCH",
      body: JSON.stringify({ entries: state.supplementalEntries })
    });
    state.supplementalEntries = normalizeSupplementalEntriesClient(entries || []);
    renderSupplementalEntries();
    supplementalStatus.textContent = `已保存：${path}`;
  } catch (error) {
    supplementalStatus.textContent = error.message;
  } finally {
    saveSupplementalButton.disabled = false;
  }
}

async function suggestSupplementalContext() {
  suggestSupplementalButton.disabled = true;
  supplementalStatus.textContent = "正在分析现有资料...";
  try {
    syncSupplementalEntriesFromDom();
    const { entries } = await api("/api/supplemental-context/suggest", {
      method: "POST",
      body: JSON.stringify({ existingEntries: state.supplementalEntries })
    });
    const before = state.supplementalEntries.length;
    state.supplementalEntries = mergeSupplementalEntries(state.supplementalEntries, entries || []);
    renderSupplementalEntries();
    const added = state.supplementalEntries.length - before;
    supplementalStatus.textContent = added
      ? `已加入 ${added} 个候选项，请逐条补充说明后保存。`
      : "没有发现新的候选项。";
  } catch (error) {
    supplementalStatus.textContent = error.message;
  } finally {
    suggestSupplementalButton.disabled = false;
  }
}

function renderSupplementalEntries() {
  const entries = state.supplementalEntries || [];
  const completeCount = entries.filter((entry) => entry.explanation.trim()).length;
  const pendingCount = entries.length - completeCount;
  supplementalSummary.innerHTML = entries.length
    ? `
        <span>全部 ${entries.length}</span>
        <span>已说明 ${completeCount}</span>
        <span>未说明 ${pendingCount}</span>
      `
    : `<span>还没有补充项</span>`;
  supplementalList.innerHTML = entries.length
    ? entries.map((entry) => renderSupplementalEntry(entry)).join("")
    : `<div class="empty-state">点击“新增条目”，或让 AI 从已有资料中分析候选项。</div>`;

  supplementalList.querySelectorAll("[data-supplemental-field]").forEach((field) => {
    field.addEventListener("input", () => {
      const entry = state.supplementalEntries.find((candidate) => candidate.id === field.dataset.entryId);
      if (!entry) return;
      entry[field.dataset.supplementalField] = field.value;
      if (field.dataset.supplementalField === "explanation") {
        renderSupplementalEntryStatus(field.dataset.entryId);
      }
    });
  });
  supplementalList.querySelectorAll("[data-delete-supplemental]").forEach((button) => {
    button.addEventListener("click", () => {
      state.supplementalEntries = state.supplementalEntries.filter((entry) => entry.id !== button.dataset.deleteSupplemental);
      renderSupplementalEntries();
    });
  });
}

function renderSupplementalEntry(entry) {
  const isComplete = Boolean(entry.explanation.trim());
  return `
    <section class="supplemental-entry ${isComplete ? "is-complete" : ""}" data-entry-id="${escapeHtml(entry.id)}">
      <div class="supplemental-entry-header">
        <input data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="term" value="${escapeHtml(entry.term)}" placeholder="术语、缩写或项目名">
        <input data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="category" value="${escapeHtml(entry.category)}" placeholder="分类">
        <span class="supplemental-entry-status">${isComplete ? "已说明" : "未说明"}</span>
        <button class="supplemental-entry-delete" type="button" data-delete-supplemental="${escapeHtml(entry.id)}">删除</button>
      </div>
      <div class="supplemental-entry-reason">
        <input data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="reason" value="${escapeHtml(entry.reason)}" placeholder="为什么需要补充说明">
      </div>
      <textarea data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="explanation" placeholder="在这里填写你的解释。只有填写了说明的条目会进入 AI 处理上下文。">${escapeHtml(entry.explanation)}</textarea>
    </section>
  `;
}

function renderSupplementalEntryStatus(id) {
  const entry = state.supplementalEntries.find((candidate) => candidate.id === id);
  const section = supplementalList.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
  if (!entry || !section) return;
  const isComplete = Boolean(entry.explanation.trim());
  section.classList.toggle("is-complete", isComplete);
  const status = section.querySelector(".supplemental-entry-status");
  if (status) status.textContent = isComplete ? "已说明" : "未说明";
  const completeCount = state.supplementalEntries.filter((candidate) => candidate.explanation.trim()).length;
  const pendingCount = state.supplementalEntries.length - completeCount;
  supplementalSummary.innerHTML = `
    <span>全部 ${state.supplementalEntries.length}</span>
    <span>已说明 ${completeCount}</span>
    <span>未说明 ${pendingCount}</span>
  `;
}

function syncSupplementalEntriesFromDom() {
  supplementalList.querySelectorAll("[data-supplemental-field]").forEach((field) => {
    const entry = state.supplementalEntries.find((candidate) => candidate.id === field.dataset.entryId);
    if (entry) entry[field.dataset.supplementalField] = field.value;
  });
}

function addSupplementalEntry() {
  syncSupplementalEntriesFromDom();
  state.supplementalEntries.unshift({
    id: `manual-${Date.now()}`,
    term: "",
    category: "待确认",
    reason: "",
    explanation: ""
  });
  renderSupplementalEntries();
  const firstInput = supplementalList.querySelector("[data-supplemental-field='term']");
  firstInput?.focus();
}

function normalizeSupplementalEntriesClient(entries) {
  return (entries || []).map((entry, index) => ({
    id: String(entry.id || `entry-${index}-${Date.now()}`),
    term: String(entry.term || "").trim(),
    category: String(entry.category || "待确认").trim() || "待确认",
    reason: String(entry.reason || "").trim(),
    explanation: String(entry.explanation || "").trim()
  })).filter((entry) => entry.term || entry.reason || entry.explanation);
}

function mergeSupplementalEntries(current, incoming) {
  const merged = normalizeSupplementalEntriesClient(current);
  const seen = new Set(merged.map((entry) => entry.term.toLowerCase()).filter(Boolean));
  for (const entry of normalizeSupplementalEntriesClient(incoming)) {
    const key = entry.term.toLowerCase();
    if (key && seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (state.chatRequest) return;
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  const session = getActiveChatSession();
  if (!session) return;
  if (session.title === "新对话") {
    session.title = message.slice(0, 32);
  }
  session.messages.push({ role: "user", text: message, at: new Date().toISOString() });
  session.updatedAt = new Date().toISOString();
  appendMessage("user", message);
  chatInput.value = "";
  const pending = settingShowThinking.checked
    ? appendMessage("event", "正在查找相关资料...", { title: "思考", kind: "thinking" })
    : null;
  saveChatSessions();
  renderChatHistory();
  const controller = new AbortController();
  const request = { controller, sessionId: session.id, id: `${Date.now()}-${Math.random()}` };
  state.chatRequest = request;
  chatSubmitButton.disabled = true;
  stopChatButton.hidden = false;

  try {
    let pendingRemoved = false;
    let assistantMessage = null;
    let assistantText = "";
    let latestSources = [];
    const removePending = () => {
      if (pendingRemoved) return;
      if (pending?.isConnected) pending.remove();
      pendingRemoved = true;
    };

    const history = session.messages
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .slice(-12)
      .map((entry) => ({ role: entry.role, content: entry.text }));
    await streamApi("/api/chat-stream", { message, history }, {
      signal: controller.signal,
      trace: (event) => {
        if (!isCurrentChatRequest(request)) return;
        removePending();
        if (!shouldDisplayTraceEvent(event)) return;
        const traceMessage = toTraceMessage(event);
        session.messages.push(traceMessage);
        if (state.activeChatId === session.id) appendMessage(traceMessage.role, traceMessage.text, traceMessage);
      },
      sources: (event) => {
        if (!isCurrentChatRequest(request)) return;
        latestSources = event.sources || [];
      },
      delta: (event) => {
        if (!isCurrentChatRequest(request)) return;
        removePending();
        if (!assistantMessage) {
          if (state.activeChatId === session.id) assistantMessage = appendMessage("assistant", "");
        }
        assistantText += event.text || "";
        if (assistantMessage) {
          setMessageBody(assistantMessage, "assistant", assistantText);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      },
      done: (answer) => {
        if (!isCurrentChatRequest(request)) return;
        removePending();
        latestSources = answer.sources || latestSources;
        const finalText = formatChatAnswer({ ...answer, sources: latestSources, content: answer.content || assistantText });
        if (!assistantMessage) {
          if (state.activeChatId === session.id) assistantMessage = appendMessage("assistant", finalText, { sources: latestSources });
        } else {
          setMessageBody(assistantMessage, "assistant", finalText);
        }
        attachChatSources(assistantMessage, latestSources);
        session.messages.push({ role: "assistant", text: finalText, sources: latestSources, at: new Date().toISOString() });
      },
      error: (event) => {
        throw new Error(event.error || "流式对话失败");
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      session.messages.push({ role: "event", title: "已停止", kind: "error", text: "已停止生成。", at: new Date().toISOString() });
      if (state.activeChatId === session.id) appendMessage("event", "已停止生成。", { title: "已停止", kind: "error" });
    } else {
      const text = error.message;
      if (pending?.isConnected) pending.remove();
      const traceMessage = { role: "event", title: "错误", kind: "error", text, at: new Date().toISOString() };
      session.messages.push(traceMessage);
      if (state.activeChatId === session.id) appendMessage("event", text, traceMessage);
      session.messages.push({ role: "assistant", text, at: new Date().toISOString(), error: true });
      if (state.activeChatId === session.id) appendMessage("assistant", text);
    }
  } finally {
    if (state.chatRequest === request) {
      state.chatRequest = null;
      chatSubmitButton.disabled = false;
      stopChatButton.hidden = true;
    }
  }

  session.updatedAt = new Date().toISOString();
  saveChatSessions();
  renderChatHistory();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function isCurrentChatRequest(request) {
  return state.chatRequest === request && !request.controller.signal.aborted;
}

function cancelChatRequest() {
  state.chatRequest?.controller.abort();
}

function appendMessage(role, text, meta = {}) {
  const message = document.createElement("div");
  message.className = `chat-message ${role} ${meta.kind ? `event-${meta.kind}` : ""}`;
  if (role === "event") {
    message.innerHTML = `
      <button type="button" class="event-toggle" aria-expanded="false">
        <span>${escapeHtml(messageRoleLabel(role, meta))}</span>
        <span class="event-chevron">展开</span>
      </button>
      <div class="message-body" hidden></div>
    `;
    message.querySelector(".event-toggle").addEventListener("click", () => toggleEventMessage(message));
  } else {
    message.innerHTML = `
      <div class="message-role">${escapeHtml(messageRoleLabel(role, meta))}</div>
      <div class="message-body"></div>
    `;
  }
  setMessageBody(message, role, text);
  if (role === "assistant" && meta.sources) attachChatSources(message, meta.sources);
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function setMessageBody(message, role, text) {
  const body = message.querySelector(".message-body");
  if (!body) return;
  if (role === "assistant") {
    body.classList.add("markdown-body");
    body.innerHTML = renderMarkdown(text);
  } else {
    body.classList.remove("markdown-body");
    body.textContent = text;
  }
}

function toggleEventMessage(message) {
  const body = message.querySelector(".message-body");
  const button = message.querySelector(".event-toggle");
  const chevron = message.querySelector(".event-chevron");
  const expanded = body.hidden;
  body.hidden = !expanded;
  button.setAttribute("aria-expanded", String(expanded));
  chevron.textContent = expanded ? "收起" : "展开";
}

function formatChatAnswer(answer) {
  return answer.content;
}

function attachChatSources(message, sources) {
  if (!message || !sources?.length || message.querySelector(".chat-sources")) return;
  const list = document.createElement("div");
  list.className = "chat-sources";
  list.innerHTML = `<strong>参考资料</strong>`;
  sources.slice(0, 5).forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-source-link";
    button.textContent = `${source.title || "未命名资料"} · ${sourceLabel(source.sourceType)}${source.completeness ? ` · ${completenessLabel(source.completeness)}` : ""}`;
    button.addEventListener("click", async () => {
      if (!source.id) return;
      await switchView("materials");
      await selectItem(source.id);
    });
    list.append(button);
  });
  message.append(list);
}

function toTraceMessage(event) {
  return {
    role: "event",
    kind: event.type || "tool",
    title: event.title || "过程",
    text: event.detail || "",
    at: new Date().toISOString()
  };
}

function shouldDisplayTraceEvent(event) {
  if (event.type === "thinking") return settingShowThinking.checked;
  if (event.type === "tool" || event.type === "tool_result") return settingShowToolCalls.checked;
  return true;
}

function messageRoleLabel(role, meta = {}) {
  if (role === "user") return "You";
  if (role === "event") {
    const labels = {
      thinking: "思考",
      tool: "工具调用",
      tool_result: "工具结果",
      error: "错误"
    };
    const prefix = labels[meta.kind] || "过程";
    return meta.title ? `${prefix} · ${meta.title}` : prefix;
  }
  return "Assistant";
}

async function loadChatSessions() {
  let remote = null;
  try {
    remote = await api("/api/chat-sessions");
  } catch (error) {
    console.warn("Failed to load server chat sessions:", error);
  }
  const serverSessions = Array.isArray(remote?.sessions) ? remote.sessions.filter((session) => session.id) : [];
  if (remote?.initialized === false && !serverSessions.length) {
    const local = readLocalChatSessions();
    state.chatSessions = local.sessions;
    state.activeChatId = local.activeChatId || local.sessions[0]?.id || "";
    if (state.chatSessions.length) await saveChatSessions();
  } else if (remote) {
    state.chatSessions = serverSessions;
    state.activeChatId = remote.activeChatId || serverSessions[0]?.id || "";
  } else {
    const local = readLocalChatSessions();
    state.chatSessions = local.sessions;
    state.activeChatId = local.activeChatId || local.sessions[0]?.id || "";
    state.chatSessionsLocalOnly = true;
  }
  state.chatSessionsHydrated = true;
  if (!state.chatSessions.length || !getActiveChatSession()) {
    createChatSession({ activate: true, save: false });
  }
  renderChatHistory();
  renderActiveChat();
  if (!state.chatSessionsLocalOnly) await saveChatSessions();
  renderChatSessionStatus();
}

function renderChatSessionStatus() {
  if (!chatSessionStatus) return;
  chatSessionStatus.hidden = !state.chatSessionsLocalOnly;
  chatSessionStatus.textContent = state.chatSessionsLocalOnly
    ? "暂时使用本机会话缓存；无法读取服务端记录，恢复连接后可重新打开以同步。"
    : "";
}

function readLocalChatSessions() {
  let sessions = [];
  try {
    const saved = JSON.parse(localStorage.getItem("materialOrganizer.chatSessions") || "[]");
    sessions = Array.isArray(saved) ? saved.filter((session) => session.id) : [];
  } catch {
    sessions = [];
  }
  return { sessions, activeChatId: localStorage.getItem("materialOrganizer.activeChatId") || "" };
}

function createChatSession(options = {}) {
  const now = new Date().toISOString();
  const session = {
    id: `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "assistant",
        text: "可以直接问资料库里的内容。后端会先读取本地知识库、检索相关资料，再用设置里的 AI 接口回答；未配置 AI 时会返回可追溯的本地检索结果。",
        at: now
      }
    ]
  };
  state.chatSessions.unshift(session);
  if (options.activate !== false) state.activeChatId = session.id;
  if (options.save !== false) saveChatSessions();
  renderChatHistory();
  renderActiveChat();
  chatInput.focus();
  return session;
}

function getActiveChatSession() {
  return state.chatSessions.find((session) => session.id === state.activeChatId) || null;
}

function activateChatSession(id) {
  state.activeChatId = id;
  saveChatSessions();
  renderChatHistory();
  renderActiveChat();
}

function deleteChatSession(id) {
  const session = state.chatSessions.find((candidate) => candidate.id === id);
  if (!session) return;
  const ok = confirm(`删除对话“${session.title || "新对话"}”？`);
  if (!ok) return;

  state.chatSessions = state.chatSessions.filter((candidate) => candidate.id !== id);
  if (state.activeChatId === id) {
    state.activeChatId = state.chatSessions[0]?.id || "";
  }
  if (!state.chatSessions.length) {
    createChatSession({ activate: true, save: false });
  }
  saveChatSessions();
  renderChatHistory();
  renderActiveChat();
}

function clearChatHistory() {
  if (!state.chatSessions.length) return;
  const ok = confirm("清除所有 AI 对话历史？");
  if (!ok) return;

  state.chatSessions = [];
  state.activeChatId = "";
  createChatSession({ activate: true, save: false });
  saveChatSessions();
  renderChatHistory();
  renderActiveChat();
}

function renderActiveChat() {
  const session = getActiveChatSession();
  if (!session) return;
  chatSessionTitle.textContent = session.title || "新对话";
  chatMessages.innerHTML = "";
  for (const message of session.messages || []) {
    appendMessage(message.role, message.text, message);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatHistory() {
  const sessions = [...state.chatSessions].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  chatHistoryList.innerHTML = sessions.map((session) => {
    const last = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.at(-1);
    return `
      <div class="chat-history-row ${session.id === state.activeChatId ? "is-active" : ""}">
        <button type="button" class="chat-history-item" data-chat-id="${escapeHtml(session.id)}">
          <span>${escapeHtml(session.title || "新对话")}</span>
          <small>${escapeHtml(last?.text || "暂无消息")}</small>
        </button>
        <button type="button" class="chat-history-delete" data-delete-chat-id="${escapeHtml(session.id)}" aria-label="删除对话">×</button>
      </div>
    `;
  }).join("");
  chatHistoryList.querySelectorAll("[data-chat-id]").forEach((button) => {
    button.addEventListener("click", () => activateChatSession(button.dataset.chatId));
  });
  chatHistoryList.querySelectorAll("[data-delete-chat-id]").forEach((button) => {
    button.addEventListener("click", () => deleteChatSession(button.dataset.deleteChatId));
  });
}

async function saveChatSessions() {
  const sessions = state.chatSessions
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 30);
  state.chatSessions = sessions;
  localStorage.setItem("materialOrganizer.chatSessions", JSON.stringify(sessions));
  localStorage.setItem("materialOrganizer.activeChatId", state.activeChatId);
  if (!state.chatSessionsHydrated || state.chatSessionsLocalOnly) return;
  const snapshot = JSON.parse(JSON.stringify({ sessions, activeChatId: state.activeChatId }));
  state.chatPersistQueue = state.chatPersistQueue
    .catch(() => {})
    .then(() => api("/api/chat-sessions", {
      method: "PATCH",
      body: JSON.stringify(snapshot)
    }))
    .catch((error) => {
      console.warn("Failed to save server chat sessions:", error);
    });
  return state.chatPersistQueue;
}

async function buildAskContext(question) {
  return api("/api/ask-context", {
    method: "POST",
    body: JSON.stringify({ question })
  });
}

async function autoPreviewImport() {
  const content = importContent.value.trim();
  const url = importUrl.value.trim();
  if (!content && !url) return;
  await previewImport();
}

const scheduleAutoPreviewImport = debounce(() => autoPreviewImport(), 350);

async function previewImport(event) {
  event?.preventDefault();
  const content = importContent.value.trim();
  const url = importUrl.value.trim();
  if (!content && !url) {
    previewStatus.textContent = "先粘贴内容、输入 URL，或拖入文本文件。";
    previewBadge.textContent = "等待输入";
    return;
  }

  previewStatus.textContent = "正在解析内容...";
  previewBadge.textContent = "解析中";
  confirmImportButton.disabled = true;
  subscribeImportButton.disabled = true;
  previewImportButton.disabled = true;
  if (state.importPreviewController) state.importPreviewController.abort();
  const controller = new AbortController();
  state.importPreviewController = controller;
  const requestId = ++state.importPreviewRequest;

  try {
    const { preview } = await api("/api/preview-source", {
      method: "POST",
      body: JSON.stringify({
        content,
        url,
        sourceType: importSourceType.value,
        fetchMode: importFetchMode.value,
        pageKind: importPageKind.value,
      }),
      signal: controller.signal
    });
    if (requestId !== state.importPreviewRequest) return;

    state.importPreview = preview;
    confirmTitle.value = preview.title;
    previewContent.value = preview.extractedContent;
    previewReadableContent.innerHTML = renderMarkdown(preview.extractedContent || "暂无可阅读内容。");
    summaryContent.value = "";
    const duplicateNote = preview.existingItem
      ? ` 已发现相同页面已导入：${preview.existingItem.title}（${formatDate(preview.existingItem.updatedAt)}）。`
      : "";
    const linkedNote = preview.linkedItems?.length
      ? ` 检测到 ${preview.linkedItems.length} 个内容链接，确认导入后会同步导入这些内容页。`
      : "";
    const refreshJobNote = preview.refreshJob
      ? preview.refreshJob.proposed
        ? ` 确认后将加入订阅管理：${preview.refreshJob.name}（默认关闭）。`
        : ` 已存在订阅任务：${preview.refreshJob.name}（当前${preview.refreshJob.enabled ? "开启" : "关闭"}）。`
      : "";
    previewStatus.textContent = `${preview.parseNote} 内容长度 ${preview.contentLength} 字符。${linkedNote}${refreshJobNote}${duplicateNote}`;
    const isSubscription = preview.importMode === "subscription" || (preview.pageKind === "list" && preview.refreshJob);
    summaryStatus.textContent = isSubscription ? "订阅链接不需要生成总结，刷新订阅后会导入内容页。" : "可以生成 AI 总结，或手动填写总结。";
    previewBadge.textContent = isSubscription ? "订阅" : preview.existingItem ? "已存在" : (preview.parseStatus === "ready" ? "可导入" : "需确认");
    confirmImportButton.textContent = isSubscription ? "查看关注" : preview.existingItem ? "查看已有资料" : "一次保存";
    confirmImportButton.disabled = isSubscription ? !preview.refreshJob : (!preview.extractedContent.trim() && !preview.existingItem);
    subscribeImportButton.textContent = isSubscription ? "创建关注" : "持续关注";
    subscribeImportButton.disabled = Boolean(preview.existingItem) || (!preview.url && !preview.extractedContent.trim());
    summarizeButton.disabled = isSubscription || !preview.extractedContent.trim();
  } catch (error) {
    if (requestId !== state.importPreviewRequest) return;
    if (error.name === "AbortError") return;
    previewStatus.textContent = error.message;
    previewBadge.textContent = "失败";
    confirmImportButton.disabled = true;
    summarizeButton.disabled = true;
  }
  finally {
    if (requestId === state.importPreviewRequest) previewImportButton.disabled = false;
  }
}

async function confirmImport(options = {}) {
  if (!state.importPreview || state.importSubmitting) return;
  state.importSubmitting = true;
  confirmImportButton.disabled = true;
  subscribeImportButton.disabled = true;
  const activeButton = options.subscribe ? subscribeImportButton : confirmImportButton;
  const originalText = activeButton.textContent;
  activeButton.textContent = options.subscribe ? "正在创建关注…" : "正在保存…";

  const preview = state.importPreview;
  try {
  if (preview.existingItem?.id) {
    const existingId = preview.existingItem.id;
    resetImport();
    await switchView("materials");
    await selectItem(existingId);
    return;
  }

  if (preview.importMode === "subscription" || (preview.pageKind === "list" && preview.refreshJob)) {
    if (preview.refreshJob?.proposed) {
      await api("/api/refresh-jobs", {
        method: "POST",
        body: JSON.stringify({
          url: preview.url,
          title: confirmTitle.value.trim() || preview.title,
          sourceType: preview.sourceType,
          fetchMode: preview.fetchMode,
          pageKind: preview.pageKind,
          managedBy: preview.refreshJob.managedBy || "",
          subscribe: true
        })
      });
    }
    resetImport();
    await switchView("subscriptions");
    return;
  }

  const item = await api("/api/items", {
    method: "POST",
    body: JSON.stringify({
      title: confirmTitle.value.trim() || preview.title,
      sourceType: preview.sourceType,
      url: preview.url,
      tags: confirmTags.value,
      rawContent: preview.rawContent,
      extractedContent: previewContent.value,
      summary: summaryContent.value,
      comments: preview.comments || [],
      rawFileName: preview.rawFileName,
      lastFetchedAt: preview.lastFetchedAt,
      pageKind: preview.pageKind,
      fetchMode: preview.fetchMode,
      maxItems: 50,
      subscribe: Boolean(options.subscribe),
      captureMethod: preview.captureMethod,
      completeness: preview.completeness,
      coverage: preview.coverage,
      identityEvidence: preview.identityEvidence,
      sourceUpdatedAt: preview.sourceUpdatedAt,
      httpValidators: preview.httpValidators
    })
  });

    resetImport();
    if (options.subscribe) {
      await switchView("subscriptions");
      return;
    }
    await switchView("materials");
    await selectItem(item.item.metadata.id);
  } catch (error) {
    previewStatus.textContent = error.message || "保存失败，请重试。";
    previewBadge.textContent = "保存失败";
  } finally {
    state.importSubmitting = false;
    if (state.importPreview) {
      confirmImportButton.disabled = false;
      subscribeImportButton.disabled = false;
      activeButton.textContent = originalText;
    }
  }
}

function resetImport() {
  state.importPreviewRequest += 1;
  state.importPreviewController?.abort();
  state.importPreviewController = null;
  state.importPreview = null;
  importForm.reset();
  confirmTitle.value = "";
  confirmTags.value = "";
  previewContent.value = "";
  previewReadableContent.textContent = "解析后会显示可阅读的正文。";
  summaryContent.value = "";
  previewStatus.textContent = "等待输入内容。";
  summaryStatus.textContent = "解析内容后可生成总结。";
  previewBadge.textContent = "未解析";
  confirmImportButton.textContent = "确认导入";
  confirmImportButton.disabled = true;
  subscribeImportButton.textContent = "持续关注";
  subscribeImportButton.disabled = true;
  summarizeButton.disabled = true;
}

async function summarizePreview() {
  const content = previewContent.value.trim();
  if (!content) return;

  summaryStatus.textContent = "正在生成总结...";
  summarizeButton.disabled = true;
  try {
    const { summary } = await api("/api/summarize", {
      method: "POST",
      body: JSON.stringify({ content, sourceType: state.importPreview?.sourceType, url: state.importPreview?.url })
    });
    summaryContent.value = summary.text;
    summaryStatus.textContent = summary.note;
  } catch (error) {
    summaryStatus.textContent = error.message;
  } finally {
    summarizeButton.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  settingsStatus.textContent = "正在保存...";
  try {
    const { settings } = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        ai: {
          baseUrl: settingBaseUrl.value,
          apiKey: settingApiKey.value === "********" ? undefined : settingApiKey.value,
          model: settingModel.value
        },
        chat: {
          showThinking: settingShowThinking.checked,
          showToolCalls: settingShowToolCalls.checked
        },
        doNotDisturb: {
          enabled: state.doNotDisturb
        },
        notifications: collectNotificationSettings(),
        refreshSchedule: {
          startTime: settingRefreshStartTime.value,
          endTime: settingRefreshEndTime.value
        },
        embedding: {
          enabled: settingEmbeddingEnabled.checked,
          baseUrl: settingEmbeddingBaseUrl.value,
          apiKey: settingEmbeddingApiKey.value === "********" ? undefined : settingEmbeddingApiKey.value,
          model: settingEmbeddingModel.value,
          dimensions: Number(settingEmbeddingDimensions.value || 0)
        },
        processingPrompts: collectProcessingPrompts(),
        autoProcess: {
          mode: settingAutoProcessMode?.value,
          minNewMessages: Number(settingAutoProcessMessages?.value || 20),
          minNewChars: Number(settingAutoProcessChars?.value || 3000),
          maxStaleDays: Number(settingAutoProcessDays?.value || 7)
        },
        documentRoot: settingDocumentRoot.value,
        sources: collectSourceProfiles(),
        refreshJobs: collectRefreshJobs()
      })
    });
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    settingApiKey.value = settings.ai.apiKey;
    settingShowThinking.checked = settings.chat?.showThinking !== false;
    settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
    setDoNotDisturbState(Boolean(settings.doNotDisturb?.enabled), { renderOnly: true });
    settingNotificationsEnabled.checked = settings.notifications?.enabled !== false;
    for (const input of notificationSourceInputs) {
      input.checked = settings.notifications?.sources?.[input.dataset.notificationSource] !== false;
    }
    settingRefreshStartTime.value = settings.refreshSchedule?.startTime || "08:00";
    settingRefreshEndTime.value = settings.refreshSchedule?.endTime || "20:00";
    settingEmbeddingEnabled.checked = Boolean(settings.embedding?.enabled);
    settingEmbeddingApiKey.value = settings.embedding?.apiKey || "";
    settingEmbeddingBaseUrl.value = settings.embedding?.baseUrl || "";
    settingEmbeddingModel.value = settings.embedding?.model || "";
    settingEmbeddingDimensions.value = settings.embedding?.dimensions || "";
    for (const field of processingPromptFields) {
      field.value = settings.processingPrompts?.[field.dataset.processingPrompt] || field.value;
    }
    agentRoot.textContent = settings.activeDocumentRoot;
    fillAutoProcessFields(settings.autoProcess);
    settingsStatus.textContent = "设置已保存。";
    renderRefreshJobs(settings.refreshJobs || []);
    await loadSettingsTags();
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

async function toggleDoNotDisturb() {
  if (!doNotDisturbToggle) return;
  const next = !state.doNotDisturb;
  doNotDisturbToggle.disabled = true;
  setDoNotDisturbState(next, { renderOnly: true });
  try {
    const { settings } = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        doNotDisturb: {
          enabled: next
        }
      })
    });
    setDoNotDisturbState(Boolean(settings.doNotDisturb?.enabled));
  } catch (error) {
    setDoNotDisturbState(!next);
    console.warn("Failed to update do not disturb mode:", error);
  }
}

async function downloadExport(path) {
  importExportStatus.textContent = "正在生成导出文件...";
  try {
    const response = await fetch(path);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `导出失败：${response.status}`);
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("Content-Disposition"))
      || (path.includes("settings") ? "assistant-settings.json" : "assistant-data.json");
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    importExportStatus.textContent = `已导出 ${filename}。`;
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

async function importSettingsFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  importExportStatus.textContent = "正在导入设置...";
  try {
    const payload = JSON.parse(await file.text());
    const { settings } = await api("/api/import/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadSettings();
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    agentRoot.textContent = settings.activeDocumentRoot;
    importExportStatus.textContent = "设置导入完成。";
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

async function importDataFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  importExportStatus.textContent = "正在导入数据...";
  try {
    const bundle = JSON.parse(await file.text());
    const result = await api("/api/import/data", {
      method: "POST",
      body: JSON.stringify({
        bundle,
        mode: replaceDataOnImport.checked ? "replace" : "merge"
      })
    });
    await loadTags();
    if (state.view === "materials") await loadItems();
    importExportStatus.textContent = `数据导入完成：写入 ${result.writtenFileCount} 个文件。`;
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

function filenameFromDisposition(disposition) {
  const value = String(disposition || "");
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : "";
}

function collectProcessingPrompts() {
  return Object.fromEntries(processingPromptFields.map((field) => [
    field.dataset.processingPrompt,
    field.value
  ]));
}

function collectNotificationSettings() {
  return {
    enabled: settingNotificationsEnabled.checked,
    sources: Object.fromEntries(notificationSourceInputs.map((input) => [
      input.dataset.notificationSource,
      input.checked
    ]))
  };
}

async function loadSettingsTags() {
  const { tags } = await api("/api/tags");
  state.settingsTags = tags || [];
  state.selectedSettingsTags = new Set([...state.selectedSettingsTags].filter((tag) => state.settingsTags.some((item) => item.name === tag)));
  renderSettingsTags();
}

function renderSettingsTags() {
  if (!settingsTagList) return;
  const selectedCount = state.selectedSettingsTags.size;
  tagManagerStatus.textContent = selectedCount
    ? `已选择 ${selectedCount} 个标签。`
    : `共 ${state.settingsTags.length} 个标签。`;
  deleteSelectedTagsButton.disabled = selectedCount === 0;
  clearTagSelectionButton.disabled = selectedCount === 0;
  selectAllTagsButton.disabled = state.settingsTags.length === 0 || selectedCount === state.settingsTags.length;

  settingsTagList.innerHTML = state.settingsTags.length
    ? state.settingsTags.map((tag) => `
        <div class="settings-tag-row">
          <label class="settings-tag-check">
            <input type="checkbox" data-settings-tag="${escapeHtml(tag.name)}" ${state.selectedSettingsTags.has(tag.name) ? "checked" : ""} />
            <span>${escapeHtml(tag.name)}</span>
          </label>
          <small>${escapeHtml(tag.count)} 条资料</small>
          <button type="button" data-rename-settings-tag="${escapeHtml(tag.name)}">改名</button>
        </div>
      `).join("")
    : `<div class="empty-inline">还没有标签。</div>`;

  settingsTagList.querySelectorAll("[data-settings-tag]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedSettingsTags.add(checkbox.dataset.settingsTag);
      } else {
        state.selectedSettingsTags.delete(checkbox.dataset.settingsTag);
      }
      renderSettingsTags();
    });
  });
  settingsTagList.querySelectorAll("[data-rename-settings-tag]").forEach((button) => {
    button.addEventListener("click", () => renameSettingsTag(button.dataset.renameSettingsTag));
  });
}

async function addSettingsTags() {
  const value = newTagInput.value.trim();
  if (!value) return;
  tagManagerStatus.textContent = "正在新增标签...";
  try {
    const { tags } = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ tags: value })
    });
    newTagInput.value = "";
    state.settingsTags = tags || [];
    await loadTags();
    renderSettingsTags();
    tagManagerStatus.textContent = "标签已新增。";
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function deleteSelectedSettingsTags() {
  const tags = [...state.selectedSettingsTags];
  if (!tags.length) return;
  const totalUsage = state.settingsTags
    .filter((tag) => state.selectedSettingsTags.has(tag.name))
    .reduce((sum, tag) => sum + Number(tag.count || 0), 0);
  const ok = confirm(`确认删除 ${tags.length} 个标签？这些标签会从 ${totalUsage} 处资料标签中移除，资料本身不会删除。`);
  if (!ok) return;

  tagManagerStatus.textContent = "正在删除标签...";
  try {
    const result = await api("/api/tags", {
      method: "DELETE",
      body: JSON.stringify({ tags })
    });
    state.selectedSettingsTags.clear();
    state.settingsTags = result.tags || [];
    await loadTags();
    if (state.view === "materials") await loadItems();
    renderSettingsTags();
    tagManagerStatus.textContent = `已删除 ${result.deletedTags.length} 个标签，影响 ${result.touchedItems.length} 条资料。`;
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function renameSettingsTag(oldTag) {
  const tag = state.settingsTags.find((item) => item.name === oldTag);
  const nextName = prompt(`将标签“${oldTag}”改名为：`, oldTag);
  if (nextName === null) return;
  const normalized = slugTagClient(nextName);
  if (!normalized || normalized === oldTag) return;
  const exists = state.settingsTags.some((item) => item.name === normalized && item.name !== oldTag);
  const ok = exists
    ? confirm(`标签“${normalized}”已存在。继续会把“${oldTag}”合并到这个标签，并更新 ${tag?.count || 0} 条资料。`)
    : confirm(`确认将“${oldTag}”改名为“${normalized}”？会更新 ${tag?.count || 0} 条资料。`);
  if (!ok) return;

  tagManagerStatus.textContent = "正在改名标签...";
  try {
    const wasSelected = state.selectedSettingsTags.has(oldTag);
    const result = await api("/api/tags", {
      method: "PATCH",
      body: JSON.stringify({ from: oldTag, to: normalized })
    });
    state.selectedSettingsTags.delete(oldTag);
    if (wasSelected) state.selectedSettingsTags.add(result.newTag);
    state.settingsTags = result.tags || [];
    await loadTags();
    await loadItems();
    renderSettingsTags();
    tagManagerStatus.textContent = `已将 ${result.oldTag} 改名为 ${result.newTag}，影响 ${result.touchedItems.length} 条资料。`;
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function openWebdriver(url) {
  webdriverStatus.textContent = "正在打开登录浏览器...";
  try {
    const { session } = await api("/api/webdriver/open", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    webdriverStatus.textContent = `已打开 ${session.hostname}，登录态会保存到 ${session.userDataDir}`;
  } catch (error) {
    webdriverStatus.textContent = error.message;
  }
}

async function saveWebdriverCookies(url) {
  webdriverStatus.textContent = "正在保存当前登录 Cookie...";
  try {
    const { saved, settings } = await api("/api/webdriver/save-cookies", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    renderSourceProfiles(settings.sources || {});
    webdriverStatus.textContent = `已保存 ${saved.hostname} 的 ${saved.cookieCount} 个 Cookie，后续普通抓取会优先使用 Cookie。`;
  } catch (error) {
    webdriverStatus.textContent = error.message;
  }
}

function renderSourceProfiles(profiles) {
  const labels = {
    "confluence.amlogic.com": "Amlogic Confluence",
    "jira.amlogic.com": "Amlogic Jira",
    "roku.atlassian.net": "Roku Atlassian",
    "github.ecodesamsung.com": "Samsung GitHub",
    "teams.microsoft.com": "Microsoft Teams"
  };
  sourceProfiles.innerHTML = Object.entries(profiles).map(([hostname, profile]) => `
    <section class="source-profile" data-hostname="${escapeHtml(hostname)}">
      <div>
        <strong>${escapeHtml(labels[hostname] || hostname)}</strong>
        <span>${escapeHtml(hostname)} · ${escapeHtml(sourceLabel(profile.sourceType || "web"))}</span>
      </div>
      <input data-field="sourceType" type="hidden" value="${escapeHtml(profile.sourceType || "web")}" />
      <label>
        认证方式
        <select data-field="authMode">
          <option value="none" ${profile.authMode === "none" ? "selected" : ""}>无</option>
          <option value="cookie" ${profile.authMode === "cookie" ? "selected" : ""}>Cookie</option>
          <option value="basic" ${profile.authMode === "basic" ? "selected" : ""}>用户名密码 / Basic</option>
          <option value="bearer" ${profile.authMode === "bearer" ? "selected" : ""}>Bearer Token</option>
        </select>
      </label>
      <label class="checkbox-row">
        <input data-field="webdriverHeadless" type="checkbox" ${profile.webdriverHeadless ? "checked" : ""} />
        <span>后台抓取使用无头浏览器</span>
      </label>
      <label class="checkbox-row">
        <input data-field="allowRemoteAi" type="checkbox" ${profile.allowRemoteAi !== false ? "checked" : ""} />
        <span>允许将该来源的相关片段发送到远程 AI</span>
      </label>
      <label>
        Webdriver 窗口模式
        <select data-field="webdriverWindowMode">
          <option value="compact" ${profile.webdriverWindowMode !== "normal" && profile.webdriverWindowMode !== "minimized" ? "selected" : ""}>小窗口后台</option>
          <option value="normal" ${profile.webdriverWindowMode === "normal" ? "selected" : ""}>正常窗口</option>
          <option value="minimized" ${profile.webdriverWindowMode === "minimized" ? "selected" : ""}>尝试最小化</option>
        </select>
      </label>
      <label data-auth-field="basic">
        用户名
        <input data-field="username" value="${escapeHtml(profile.username || "")}" placeholder="Basic 认证时使用" />
      </label>
      <label data-auth-field="basic">
        密码
        <input data-field="password" type="password" value="${escapeHtml(profile.password || "")}" placeholder="Basic 认证时使用" />
      </label>
      <label data-auth-field="cookie">
        Cookie
        <textarea data-field="cookie" rows="2" placeholder="从浏览器复制 Cookie 请求头">${escapeHtml(profile.cookie || "")}</textarea>
      </label>
      <label data-auth-field="bearer">
        Token
        <input data-field="token" type="password" value="${escapeHtml(profile.token || "")}" placeholder="Bearer token" />
      </label>
    </section>
  `).join("");

  sourceProfiles.querySelectorAll(".source-profile").forEach((section) => {
    const select = section.querySelector('[data-field="authMode"]');
    updateAuthFields(section);
    select.addEventListener("change", () => updateAuthFields(section));
  });
}

function addSourceProfile(event) {
  event?.preventDefault();
  const hostname = newSourceHostname?.value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!hostname || /\s/.test(hostname)) return;
  const profiles = collectSourceProfiles();
  if (!profiles[hostname]) {
    profiles[hostname] = { sourceType: newSourceType?.value || "web", authMode: "none", allowRemoteAi: true, webdriverWindowMode: "compact" };
  }
  state.settings = { ...(state.settings || {}), sources: profiles };
  renderSourceProfiles(profiles);
  newSourceHostname.value = "";
}

function collectSourceProfiles() {
  const profiles = {};
  sourceProfiles.querySelectorAll(".source-profile").forEach((section) => {
    const hostname = section.dataset.hostname;
    profiles[hostname] = {};
    section.querySelectorAll("[data-field]").forEach((field) => {
      profiles[hostname][field.dataset.field] = field.type === "checkbox" ? field.checked : field.value;
    });
  });
  return profiles;
}

function updateAuthFields(section) {
  const authMode = section.querySelector('[data-field="authMode"]')?.value || "none";
  section.querySelectorAll("[data-auth-field]").forEach((field) => {
    field.hidden = field.dataset.authField !== authMode;
  });
}

function sourceTypeForSubscription(job) {
  const url = String(job.url || "").toLowerCase();
  if (url.includes("jira") || url.includes("atlassian.net")) return "jira";
  if (url.includes("github")) return "github";
  if (url.includes("teams.microsoft") || url.includes("teams.cloud.microsoft")) return "teams";
  if (url.includes("confluence")) return "confluence";
  return "web";
}

function refreshJobTagsText(tags) {
  return Array.isArray(tags) ? tags.join(", ") : String(tags || "");
}

function isManagedContentPageJob(job) {
  return job?.managedBy === "content-page";
}

function subscriptionSourceLabel(source) {
  return {
    all: "全部",
    content: "普通页面",
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams",
    web: "文本"
  }[source] || source;
}

function formatRefreshStatus(status) {
  return {
    idle: "空闲",
    running: "运行中",
    failed: "失败",
    unreachable: "网络不可达",
    canceled: "已取消"
  }[status] || status;
}

async function runRefreshJob(id) {
  const job = state.refreshJobs.find((candidate) => candidate.id === id);
  refreshJobStatus.textContent = "正在启动刷新任务...";
  try {
    const { run, jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}/run?background=1`, { method: "POST" });
    renderRefreshJobs(jobs || state.refreshJobs);
    await monitorSubscriptionRefreshRun(run, `正在刷新 ${job?.name || id}`);
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

async function monitorSubscriptionRefreshRun(run, initialMessage = "刷新中") {
  if (!run?.id) throw new Error("刷新任务启动失败：没有返回 runId。");
  stopActiveRefreshRunPolling();
  state.activeRefreshRun.id = run.id;
  state.activeRefreshRun.scope = "subscriptions";
  refreshJobStatus.textContent = `${initialMessage}：0 / ${run.totalJobs || 0}`;
  const timeoutAt = Date.now() + 10 * 60 * 1000;
  let pollErrors = 0;
  return new Promise((resolve) => {
    state.activeRefreshRun.pollTimer = setInterval(async () => {
      try {
        const { run: latest } = await api(`/api/refresh-runs/${encodeURIComponent(run.id)}`);
        if (!latest) return;
        syncTeamsReadyDialog(latest);
        pollErrors = 0;
        state.refreshJobs = latest.jobs || state.refreshJobs;
        renderRefreshJobs(state.refreshJobs);
        const completed = Number(latest.completedJobs || 0);
        const total = Number(latest.totalJobs || 0);
        const failed = Number(latest.failedJobs || 0);
        refreshJobStatus.textContent = `${runStatusText(latest)}：${completed} / ${total}${failed ? `，失败 ${failed}` : ""}`;
        if (["completed", "failed", "canceled"].includes(latest.status)) {
          stopActiveRefreshRunPolling();
          const result = latest.result || {};
          const updated = Number(result.updatedItemCount ?? result.updatedIssueCount ?? 0);
          const newCount = Number(result.newItemCount || 0);
          const aiFailed = Number(result.aiProcessErrorCount || 0);
          const totalItems = Number(result.linkCount ?? result.issueCount ?? 0);
          const skipped = Number(result.skippedItemCount || 0);
          const errorCount = Number(result.errorCount || failed || 0);
          refreshJobStatus.textContent = `${latest.status === "completed" ? "刷新完成" : latest.status === "canceled" ? "刷新已取消" : "刷新结束，有失败"}：更新 ${updated} / ${totalItems} 个内容页，AI 已整理 ${newCount} 个，AI 失败 ${aiFailed} 个，跳过 ${skipped} 个，失败 ${errorCount} 个。`;
          if (errorCount) showRefreshFailureToastFromRun(latest);
          if (state.view === "materials") await loadAll();
          await loadMaterialUpdateCount();
          scheduleReloadAfterRefreshUpdates(newCount);
          resolve(latest);
        } else if (Date.now() > timeoutAt) {
          stopActiveRefreshRunPolling();
          refreshJobStatus.textContent = "刷新仍在后台运行，已停止前台等待；稍后会自动同步状态。";
          resolve(latest);
        }
      } catch (error) {
        pollErrors += 1;
        refreshJobStatus.textContent = `刷新进度同步失败：${error.message}`;
        console.warn("Failed to poll refresh run:", error);
        if (pollErrors >= 5) {
          stopActiveRefreshRunPolling();
          refreshJobStatus.textContent = "刷新进度同步连续失败，已恢复按钮；后台任务可能仍在运行。";
          resolve(null);
        }
      }
    }, 1000);
  });
}

function stopActiveRefreshRunPolling() {
  if (state.activeRefreshRun.pollTimer) clearInterval(state.activeRefreshRun.pollTimer);
  state.activeRefreshRun.pollTimer = null;
  state.activeRefreshRun.id = "";
  state.activeRefreshRun.scope = "";
}

function scheduleReloadAfterRefreshUpdates(updatedCount) {
  if (!updatedCount) return;
  refreshJobStatus.textContent = `${refreshJobStatus.textContent} 已同步资料更新。`;
  loadMaterialUpdateCount();
  loadHomeOverview();
  if (state.view === "materials") loadItems();
}

function startRefreshJobMonitor() {
  if (state.refreshMonitorTimer) clearInterval(state.refreshMonitorTimer);
  state.refreshMonitorTimer = setInterval(checkRefreshJobsForUpdates, 60 * 1000);
}

async function checkRefreshJobsForUpdates() {
  try {
    const [{ jobs }, { runs }] = await Promise.all([
      api("/api/refresh-jobs"),
      api("/api/refresh-runs")
    ]);
    const waitingTeamsRun = (runs || []).find((run) => run.status === "waiting_for_teams_confirmation");
    if (waitingTeamsRun) syncTeamsReadyDialog(waitingTeamsRun);
    state.refreshJobs = jobs || state.refreshJobs;
    renderHomeOverview();
    if (state.view === "subscriptions") renderRefreshJobs(state.refreshJobs);
    showNewRefreshFailureToast(jobs || []);
    const latest = latestUpdatedRefreshRun(jobs || []);
    if (!latest || latest.key <= state.seenRefreshRunKey) return;
    const updated = refreshResultUpdatedCount(latest.job.lastResult);
    if (!updated) return;
    rememberRefreshRunKey(latest.key);
    schedulePageReloadForBackgroundRefresh(updated);
  } catch (error) {
    console.warn("Failed to check refresh jobs:", error);
  }
}

function rememberLatestRefreshRun(jobs) {
  const latest = latestUpdatedRefreshRun(jobs || []);
  if (!latest || latest.key <= state.seenRefreshRunKey) return;
  rememberRefreshRunKey(latest.key);
}

function rememberRefreshRunKey(key) {
  state.seenRefreshRunKey = key;
  localStorage.setItem("materialOrganizer.seenRefreshRunKey", key);
}

function rememberRefreshFailureKey(key) {
  state.seenRefreshFailureKey = key;
  localStorage.setItem("materialOrganizer.seenRefreshFailureKey", key);
}

function latestUpdatedRefreshRun(jobs) {
  return (jobs || [])
    .filter((job) => job.lastRunAt && refreshResultUpdatedCount(job.lastResult) > 0)
    .map((job) => ({
      job,
      key: `${job.lastRunAt}|${job.id}`
    }))
    .sort((a, b) => b.key.localeCompare(a.key))[0] || null;
}

function refreshResultUpdatedCount(result) {
  if (Object.prototype.hasOwnProperty.call(result || {}, "newItemCount")) {
    return Number(result?.newItemCount || 0);
  }
  return Number(result?.updatedItemCount ?? result?.updatedIssueCount ?? 0);
}

function showRefreshFailureToastFromRun(run) {
  const entries = [
    ...(run?.result?.results || []),
    ...(run?.result?.contentResults || [])
  ].filter((entry) => entry?.status === "failed" || Number(entry?.result?.errorCount || 0) > 0);
  const failures = entries.map((entry) => ({
    sourceType: entry.result?.sourceType || run?.sourceType || "refresh",
    name: entry.name || entry.id || "刷新任务",
    url: entry.result?.errors?.find((item) => item?.url)?.url || "",
    error: refreshResultErrorText(entry.result) || entry.error || run?.error || "刷新失败"
  })).filter((entry) => entry.error);
  if (!failures.length && run?.error) {
    failures.push({
      sourceType: run.sourceType || "refresh",
      name: "刷新任务",
      url: "",
      error: run.error
    });
  }
  if (!failures.length) return;
  showRefreshFailureToast(failures);
}

function showNewRefreshFailureToast(jobs) {
  const latest = latestFailedRefreshJob(jobs);
  if (!latest || latest.key <= state.seenRefreshFailureKey) return;
  rememberRefreshFailureKey(latest.key);
  showRefreshFailureToast([{
    sourceType: sourceTypeForSubscription(latest.job),
    name: latest.job.name || latest.job.id,
    url: latest.job.url || latest.job.lastResult?.errors?.find((entry) => entry?.url)?.url || "",
    error: refreshJobErrorText(latest.job)
  }]);
}

function latestFailedRefreshJob(jobs) {
  return (jobs || [])
    .filter((job) => job.lastRunAt && ["failed", "unreachable"].includes(job.status) && refreshJobErrorText(job))
    .map((job) => ({
      job,
      key: `${job.lastRunAt}|${job.id}|${refreshJobErrorText(job)}`
    }))
    .sort((a, b) => b.key.localeCompare(a.key))[0] || null;
}

function refreshJobErrorText(job) {
  return job?.lastError || refreshResultErrorText(job?.lastResult);
}

function refreshResultErrorText(result) {
  return result?.errors?.find((entry) => entry?.error)?.error || "";
}

function showRefreshFailureToast(failures) {
  const authFailure = failures.find(isAuthenticationFailure);
  if (authFailure) {
    showAuthFailureDialog(authFailure);
  }
  const nonAuthFailures = authFailure ? failures.filter((failure) => !isAuthenticationFailure(failure)) : failures;
  if (!nonAuthFailures.length) return;
  failures = nonAuthFailures;
  const visible = failures.slice(0, 3);
  const title = failures.length > 1 ? `${failures.length} 个刷新任务失败` : `${subscriptionSourceLabel(visible[0].sourceType)} 刷新失败`;
  const lines = visible.map((failure) => {
    const name = failure.name ? `${failure.name}：` : "";
    return `${subscriptionSourceLabel(failure.sourceType)} · ${name}${failure.error}`;
  });
  if (failures.length > visible.length) lines.push(`还有 ${failures.length - visible.length} 个失败任务，请到订阅管理查看。`);
  showToast({
    title,
    message: lines.join("\n")
  });
}

function isAuthenticationFailure(failure) {
  const text = `${failure?.sourceType || ""} ${failure?.name || ""} ${failure?.url || ""} ${failure?.error || ""}`;
  return /未登录|401|Unauthorized|Unauthori[sz]ed|authentication|required|登录态|login/i.test(text);
}

function showAuthFailureDialog(failure) {
  if (!authFailureDialog || !authFailureMessage) return;
  const source = subscriptionSourceLabel(failure.sourceType);
  const loginUrl = authFailureLoginUrl(failure);
  state.authFailurePrompt = { ...failure, loginUrl };
  authFailureMessage.textContent = `${source} 的登录态已失效，刷新任务“${failure.name || "未命名"}”无法继续。`;
  if (openAuthWebdriverButton) {
    openAuthWebdriverButton.textContent = `打开 ${source} 登录`;
  }
  if (!authFailureDialog.open) authFailureDialog.showModal();
}

function closeAuthFailureDialog() {
  authFailureDialog?.close();
}

async function openAuthFailureWebdriver() {
  const url = state.authFailurePrompt?.loginUrl;
  closeAuthFailureDialog();
  if (!url) return;
  await openWebdriver(url);
  showToast({
    title: "已打开 WebDriver 登录",
    message: "请在新打开的浏览器窗口完成登录，然后回到订阅管理重新刷新。"
  });
}

function authFailureLoginUrl(failure) {
  const text = `${failure?.sourceType || ""} ${failure?.url || ""} ${failure?.error || ""}`;
  if (/confluence/i.test(text)) return "https://confluence.amlogic.com";
  if (/jira/i.test(text)) return failure?.url || "https://jira.amlogic.com/issues/?filter=50724";
  return failure?.url || "";
}

function showToast({ title, message, duration = 9000, tone = "" }) {
  if (!toastRegion) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  if (tone) toast.dataset.tone = tone;
  toast.innerHTML = `
    <div><strong>${escapeHtml(title || "提示")}</strong></div>
    <button type="button" aria-label="关闭提示">×</button>
    <p>${escapeHtml(message || "").replace(/\n/g, "<br>")}</p>
  `;
  const close = () => {
    const timer = state.toastTimers.get(toast);
    if (timer) clearTimeout(timer);
    state.toastTimers.delete(toast);
    toast.remove();
  };
  toast.querySelector("button")?.addEventListener("click", close);
  toastRegion.append(toast);
  const timer = setTimeout(close, duration);
  state.toastTimers.set(toast, timer);
}

function schedulePageReloadForBackgroundRefresh(updatedCount) {
  if (!updatedCount) return;
  loadMaterialUpdateCount();
  loadHomeOverview();
  if (state.view === "materials") loadItems();
}

async function copyPreview() {
  const text = previewContent.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  previewStatus.textContent = "预览内容已复制。";
}

async function copyCapturePairing() {
  if (!copyCapturePairingButton || !capturePairingStatus) return;
  copyCapturePairingButton.disabled = true;
  capturePairingStatus.textContent = "正在生成配对信息…";
  try {
    const { token } = await api("/api/capture-token");
    if (!token) throw new Error("没有收到配对令牌");
    await navigator.clipboard.writeText(JSON.stringify({
      endpoint: `${location.origin}/api/items/upsert-capture`,
      token
    }));
    capturePairingStatus.textContent = "已复制。请在 Teams 用户脚本菜单中粘贴，令牌不会显示在这里。";
  } catch (error) {
    capturePairingStatus.textContent = error.message || "无法复制配对信息。";
  } finally {
    copyCapturePairingButton.disabled = false;
  }
}

function handleDragOver(event) {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
}

function handleDragLeave() {
  dropZone.classList.remove("is-dragging");
}

async function handleDrop(event) {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files?.[0];
  if (!file) return;

  importContent.value = await file.text();
  if (!confirmTitle.value) {
    confirmTitle.value = file.name.replace(/\.[^.]+$/, "");
  }
  await previewImport();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function streamApi(path, body, handlers) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: handlers.signal
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "流式请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n+/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      handlers[event.event]?.(event.data);
    }
  }

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);
    if (event) handlers[event.event]?.(event.data);
  }
}

function parseSseEvent(block) {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value === false ? "" : value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(markdown) {
  const normalizedMarkdown = String(markdown || "").replace(/(https?:\/\/[^\s<>()\[\]]+)([（【])/g, "$1 $2");
  if (window.marked && window.DOMPurify) {
    window.marked.setOptions({
      breaks: false,
      gfm: true
    });
    const rawHtml = window.marked.parse(normalizedMarkdown);
    return addSafeLinkAttributes(window.DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["target", "rel"]
    }));
  }
  return renderMarkdownFallback(normalizedMarkdown);
}

function renderMarkdownFallback(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let table = [];
  let code = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    blocks.push(renderMarkdownTable(table));
    table = [];
  };
  const flushCode = () => {
    blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      flushTable();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushAll();
  return blocks.join("");
}

function addSafeLinkAttributes(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!sanitizeMarkdownHref(href)) {
      link.replaceWith(document.createTextNode(link.textContent || ""));
      return;
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer");
  });
  return template.innerHTML;
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = sanitizeMarkdownHref(href);
    return safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  return text;
}

function renderMarkdownTable(rows) {
  const parsed = rows
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  if (parsed.length < 2 || !parsed[1].every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return `<p>${rows.map((row) => renderInlineMarkdown(row)).join("<br>")}</p>`;
  }
  const headers = parsed[0];
  const bodyRows = parsed.slice(2);
  return [
    "<table>",
    `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`,
    `<tbody>${bodyRows.map((row) => `<tr>${headers.map((_, index) => `<td>${renderInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>"
  ].join("");
}

function sanitizeMarkdownHref(href) {
  const value = String(href || "").trim();
  if (/^(https?:|mailto:)/i.test(value) || value.startsWith("/")) return value;
  return "";
}

// ---------------------------------------------------------------------------
// Shell, shared presentation helpers
// ---------------------------------------------------------------------------

const SOURCE_ORDER = ["teams", "jira", "confluence", "github", "web", "text"];
const SOURCE_META = {
  teams: { label: "Teams", mark: "T" },
  jira: { label: "Jira", mark: "J" },
  confluence: { label: "Confluence", mark: "C" },
  github: { label: "GitHub", mark: "G" },
  web: { label: "网页", mark: "W" },
  text: { label: "文本", mark: "文" }
};
const homeSummary = document.querySelector("#homeSummary");
const homeAttention = document.querySelector("#homeAttention");
const homeSourceHealth = document.querySelector("#homeSourceHealth");
const homeLibraryStats = document.querySelector("#homeLibraryStats");
const homeMarkAllReadButton = document.querySelector("#homeMarkAllReadButton");
const navUnreadCount = document.querySelector("#navUnreadCount");
const navSubscriptionAlert = document.querySelector("#navSubscriptionAlert");
const railLibraryMeta = document.querySelector("#railLibraryMeta");
const facetViews = document.querySelector("#facetViews");
const facetSources = document.querySelector("#facetSources");
const listScope = document.querySelector("#listScope");
const subsSummary = document.querySelector("#subsSummary");
const subscriptionSearch = document.querySelector("#subscriptionSearch");
const subscriptionDrawer = document.querySelector("#subscriptionDrawer");
const dndHint = document.querySelector("#dndHint");
const settingAutoProcessMode = document.querySelector("#settingAutoProcessMode");
const settingAutoProcessMessages = document.querySelector("#settingAutoProcessMessages");
const settingAutoProcessChars = document.querySelector("#settingAutoProcessChars");
const settingAutoProcessDays = document.querySelector("#settingAutoProcessDays");

Object.assign(state, {
  allItems: [],
  libraryView: "all",
  subscriptionScope: null,
  subscriptionStatusFilter: "all",
  subscriptionQuery: "",
  selectedSubscriptionId: "",
  detailModeFor: { id: "", mode: "" },
  readerMessageLimit: 150
});

homeMarkAllReadButton?.addEventListener("click", markAllHomeUpdatesRead);
document.querySelector("#facetToggleButton")?.addEventListener("click", (event) => {
  const open = !document.body.classList.contains("show-facets");
  document.body.classList.toggle("show-facets", open);
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
document.querySelector("#materialSidebar")?.addEventListener("click", (event) => {
  if (event.target.closest(".facet") && document.body.classList.contains("show-facets")) {
    document.body.classList.remove("show-facets");
    document.querySelector("#facetToggleButton")?.setAttribute("aria-expanded", "false");
  }
});
subscriptionSearch?.addEventListener("input", debounce(() => {
  state.subscriptionQuery = subscriptionSearch.value.trim().toLowerCase();
  renderRefreshJobs(state.refreshJobs);
}, 120));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !subscriptionDrawer.hidden) closeSubscriptionDrawer();
});
document.addEventListener("click", (event) => {
  // Close open menus when clicking elsewhere.
  document.querySelectorAll("details.menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});

function sourceLabel(source) {
  return SOURCE_META[normalizeSourceType(source)]?.label || source || "资料";
}

function sourceIcon(source) {
  return SOURCE_META[normalizeSourceType(source)]?.mark || "·";
}

function sourceMark(source, extraClass = "") {
  const key = SOURCE_META[normalizeSourceType(source)] ? normalizeSourceType(source) : "text";
  return `<span class="source-mark ${extraClass}" data-source="${escapeHtml(key)}" aria-hidden="true">${escapeHtml(SOURCE_META[key].mark)}</span>`;
}

function isNewContentItem(item) {
  return Boolean(item?.contentUpdatedAt || item?.pendingContentUpdatedAt);
}

// When the content last changed at its source (latest Teams message, page edit),
// falling back to when this app noticed the change, then to the record's own time.
function itemActivityTime(item) {
  const source = item?.sourceUpdatedAt && !Number.isNaN(Date.parse(item.sourceUpdatedAt)) ? item.sourceUpdatedAt : "";
  return source || item?.contentUpdatedAt || item?.pendingContentUpdatedAt || item?.updatedAt || "";
}

function byActivityDesc(a, b) {
  return String(itemActivityTime(b)).localeCompare(String(itemActivityTime(a)));
}

function formatInterval(minutes) {
  const value = Number(minutes) || 60;
  if (value < 60) return `每 ${value} 分钟`;
  if (value % 1440 === 0) return value === 1440 ? "每天" : `每 ${value / 1440} 天`;
  const hours = Math.round(value / 60);
  return hours === 1 ? "每小时" : `每 ${hours} 小时`;
}

function dayBucket(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更早";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (date >= startOfToday) return "今天";
  if (date >= new Date(startOfToday - day)) return "昨天";
  if (date >= new Date(startOfToday - 6 * day)) return "本周";
  if (date >= new Date(startOfToday - 30 * day)) return "本月";
  return "更早";
}

async function loadAll() {
  await Promise.all([loadTags(), loadLibraryIndex()]);
  await loadItems();
}

async function loadLibraryIndex() {
  try {
    const { items } = await api("/api/items");
    state.allItems = items || [];
    state.updateCount = state.allItems.filter(isNewContentItem).length;
  } catch (error) {
    console.warn("Failed to load library index:", error);
  }
  renderLibraryFacets();
  renderMaterialsNewBadge();
}

function renderView() {
  const views = { home: homeView, chat: chatView, materials: materialsView, import: importView, supplemental: supplementalView, subscriptions: subscriptionsView, settings: settingsView };
  for (const [name, element] of Object.entries(views)) {
    if (element) element.hidden = state.view !== name;
  }
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === state.view;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  globalAddButton?.classList.toggle("is-active", state.view === "import");
  document.body.dataset.activeView = state.view;
  if (state.view === "settings") setSettingsTab(state.settingsTab);
  if (state.view !== "subscriptions") closeSubscriptionDrawer();
  renderMaterialsNewBadge();
}

async function switchView(view) {
  state.view = view;
  renderView();
  if (view === "home") await loadHomeOverview();
  if (view === "materials") await loadAll();
  if (view === "settings") await loadSettings();
  if (view === "subscriptions") {
    await Promise.all([loadSettings(), loadLibraryIndex()]);
    renderRefreshJobs(state.refreshJobs);
  }
  if (view === "supplemental") await loadSupplementalContext();
}

function renderMaterialsNewBadge() {
  const unread = state.updateCount || 0;
  for (const badge of [materialsNewBadge, navUnreadCount]) {
    if (!badge) continue;
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.title = unread ? `${unread} 条资料有未读的新内容` : "";
  }
  const problems = (state.refreshJobs || []).filter((job) => subscriptionState(job).key === "error").length;
  if (navSubscriptionAlert) {
    navSubscriptionAlert.hidden = !problems;
    navSubscriptionAlert.textContent = String(problems);
    navSubscriptionAlert.title = problems ? `${problems} 个订阅刷新失败` : "";
  }
  if (railLibraryMeta && state.allItems?.length) railLibraryMeta.textContent = `${state.allItems.length} 条资料`;
}

function setDoNotDisturbState(enabled, options = {}) {
  state.doNotDisturb = Boolean(enabled);
  if (!doNotDisturbToggle) return;
  doNotDisturbToggle.classList.toggle("is-active", state.doNotDisturb);
  doNotDisturbToggle.setAttribute("aria-checked", String(state.doNotDisturb));
  doNotDisturbToggle.title = state.doNotDisturb ? "关闭免打扰，恢复定时刷新" : "开启免打扰，暂停定时刷新和通知";
  if (dndHint) dndHint.textContent = state.doNotDisturb ? "定时刷新已暂停" : "定时刷新照常进行";
  if (!options.renderOnly) doNotDisturbToggle.disabled = false;
  if (state.view === "home") renderHomeAttention();
}

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

async function openItemInLibrary(id) {
  state.libraryView = "all";
  state.sourceType = "";
  state.tag = "";
  state.query = "";
  state.subscriptionScope = null;
  if (searchInput) searchInput.value = "";
  await switchView("materials");
  await selectItem(id);
  itemList.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// 资料 (library): facets, grouped list
// ---------------------------------------------------------------------------

const LIBRARY_VIEWS = [
  ["all", "全部", () => true],
  ["unread", "未读", isNewContentItem],
  ["stale", "整理版待更新", (item) => Boolean(item.processedStale)],
  ["unprocessed", "还没有整理", (item) => !item.hasProcessed],
  ["quarantined", "隔离区", (item) => item.integrityStatus === "quarantined"]
];

function renderLibraryFacets() {
  if (!facetViews) return;
  const items = state.allItems || [];
  facetViews.innerHTML = LIBRARY_VIEWS.map(([key, label, test]) => {
    const count = items.filter(test).length;
    if (key === "quarantined" && !count) return "";
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
  tagList.innerHTML = tags.slice(0, limit).map((tag) => `
    <button type="button" class="facet facet-tag ${state.tag === tag.name ? "is-active" : ""}" data-library-tag="${escapeHtml(tag.name)}"><span class="facet-label">${escapeHtml(tag.name)}</span><span class="facet-count">${escapeHtml(tag.count ?? "")}</span></button>`).join("")
    + (tags.length > 14 ? `<button type="button" class="facet-more" data-toggle-tags>${state.showAllTags ? "收起" : `显示全部 ${tags.length} 个标签`}</button>` : "");
  tagList.querySelectorAll("[data-library-tag]").forEach((button) => button.addEventListener("click", async () => {
    state.tag = state.tag === button.dataset.libraryTag ? "" : button.dataset.libraryTag;
    renderTags();
    await loadItems();
  }));
  tagList.querySelector("[data-toggle-tags]")?.addEventListener("click", () => {
    state.showAllTags = !state.showAllTags;
    renderTags();
  });
}

function libraryFilterNeedsFullList() {
  return ["stale", "unprocessed"].includes(state.libraryView) || Boolean(state.subscriptionScope);
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
      </span>
      ${unread ? `<span class="unread-dot" title="有未读的新内容"></span>` : ""}
    </button>`;
}

// ---------------------------------------------------------------------------
// Reader: original first when the organized version is out of date, newest first
// ---------------------------------------------------------------------------

function linkifyEscaped(text) {
  return text.replace(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]，。；：！？）])/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function renderMessageText(text) {
  const lines = String(text || "").split("\n");
  const html = [];
  let quote = [];
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote>${quote.map((line) => linkifyEscaped(escapeHtml(line))).join("<br>")}</blockquote>`);
    quote = [];
  };
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map((line) => linkifyEscaped(escapeHtml(line))).join("<br>")}</p>`);
    paragraph = [];
  };
  for (const line of lines) {
    if (/^>\s?/.test(line)) { flushParagraph(); quote.push(line.replace(/^>\s?/, "")); continue; }
    flushQuote();
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line);
  }
  flushParagraph();
  flushQuote();
  return html.join("");
}

function renderMessageBody(text) {
  return String(text || "").split("```").map((part, index) => index % 2
    ? `<pre class="msg-code"><code>${escapeHtml(part.replace(/^\n+|\n+$/g, ""))}</code></pre>`
    : renderMessageText(part)).join("") || `<p class="muted">（空消息）</p>`;
}

function messageDayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const bucket = dayBucket(value);
  const label = date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return bucket === "今天" || bucket === "昨天" ? `${bucket} · ${label}` : label;
}

function renderMessageTimeline(comments, { since = "", limit = 150, kind = "消息" } = {}) {
  const sorted = [...comments].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const shown = sorted.slice(0, limit);
  let currentDay = "";
  const rows = [];
  for (const comment of shown) {
    const day = messageDayLabel(comment.createdAt);
    if (day !== currentDay) {
      currentDay = day;
      rows.push(`<h3 class="msg-day">${escapeHtml(day)}</h3>`);
    }
    const isNew = since && String(comment.createdAt || "") > since;
    const time = comment.createdAt && !Number.isNaN(new Date(comment.createdAt).getTime())
      ? new Date(comment.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
    rows.push(`
      <article class="msg ${isNew ? "is-new" : ""} ${comment.author ? "" : "is-system"}">
        <header>
          <strong>${escapeHtml(comment.author || "系统")}</strong>
          ${time ? `<time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(time)}</time>` : ""}
          ${isNew ? `<span class="flag" data-tone="accent">新</span>` : ""}
        </header>
        <div class="msg-body">${renderMessageBody(comment.body)}</div>
      </article>`);
  }
  if (sorted.length > shown.length) {
    rows.push(`<button type="button" class="load-more-button" data-more-messages>显示更早的 ${Math.min(300, sorted.length - shown.length)} 条${kind}（还有 ${sorted.length - shown.length} 条）</button>`);
  }
  return rows.join("");
}

// The stored original starts with a title and capture metadata that the reader
// header already shows; drop that preamble and a leading "## Content" heading.
function cleanRawBody(markdown, title = "") {
  const lines = String(markdown || "").split("\n");
  let index = 0;
  const skip = (line) => !line.trim()
    || (line.startsWith("# ") && (!title || line.slice(2).trim() === String(title).trim()))
    || /^(Source|Adapter|Page ID|Space|Version|Labels|Source updated|Messages captured|Latest message|URL|Fetched|Captured)\s*:/i.test(line)
    || /^##\s+Content\s*$/i.test(line);
  while (index < lines.length && index < 20 && skip(lines[index])) index += 1;
  return lines.slice(index).join("\n").trim() || String(markdown || "");
}

function stripCommentSections(markdown) {
  return String(markdown || "").replace(/\n##\s+(Comments|Messages|评论)\s*\n[\s\S]*$/i, "").trim();
}

function renderDetail(item) {
  const metadata = item.metadata;
  const comments = Array.isArray(item.comments) ? item.comments : [];
  const source = normalizeSourceType(metadata.sourceType);
  const isStream = source === "teams";
  const hasProcessed = Boolean(item.processedDocument?.trim());
  const stale = Boolean(metadata.processedStale);
  const quarantined = metadata.integrityStatus === "quarantined";
  if (state.detailModeFor.id !== metadata.id) state.detailModeFor = { id: metadata.id, mode: "", limit: state.readerMessageLimit };
  const preferred = hasProcessed && !stale && state.detailMode !== "raw" ? "processed" : "raw";
  const mode = state.detailModeFor.mode || preferred;
  const unread = isNewContentItem(metadata);
  const since = unread ? metadata.updateAcknowledgedAt || "" : "";
  const newSinceRead = since ? comments.filter((comment) => String(comment.createdAt || "") > since).length : 0;
  const throughAt = metadata.processedThroughAt || metadata.processedAt || "";
  const newSinceProcessed = throughAt ? comments.filter((comment) => String(comment.createdAt || "") > throughAt).length : 0;
  const rawLabel = isStream ? "消息" : "原文";
  const processLabel = !hasProcessed ? "生成整理" : stale ? "更新整理" : "重新整理";
  const tags = metadata.tags || [];

  const banners = [];
  if (quarantined) banners.push(`<div class="banner" data-tone="error"><p><strong>已隔离：</strong>${escapeHtml(metadata.integrityReason || "来源校验未通过")}。在验证通过前不会进入问答和批量处理。</p></div>`);
  if (unread) banners.push(`<div class="banner" data-tone="accent"><p>有新内容${newSinceRead ? `：上次阅读后新增 ${newSinceRead} 条${isStream ? "消息" : "评论"}，已标“新”` : `，${escapeHtml(relativeTime(metadata.contentUpdatedAt || metadata.pendingContentUpdatedAt))}更新`}。</p><button id="acknowledgeUpdateButton" type="button">标为已读</button></div>`);
  if (hasProcessed && stale && mode === "raw") {
    banners.push(`<div class="banner"><p>整理版生成于 ${escapeHtml(formatDate(metadata.processedAt))}${isStream && newSinceProcessed ? `，之后又有 ${newSinceProcessed} 条消息` : "，之后原文有变化"}，所以这里先显示${rawLabel}。</p><button type="button" data-banner-process>${escapeHtml(processLabel)}</button><button type="button" class="quiet-button" data-show-mode="processed">看旧整理版</button></div>`);
  }
  if (hasProcessed && stale && mode === "processed") {
    banners.push(`<div class="banner"><p>这是 ${escapeHtml(formatDate(metadata.processedAt))} 的整理版，之后${isStream && newSinceProcessed ? `新增了 ${newSinceProcessed} 条消息` : "原文有变化"}。</p><button type="button" data-banner-process>${escapeHtml(processLabel)}</button><button type="button" class="quiet-button" data-show-mode="raw">看${rawLabel}</button></div>`);
  }
  const coverage = coverageNote(metadata);

  let body;
  if (mode === "processed" && hasProcessed) {
    body = `
      <div id="detailContentLayout" class="detail-content-layout">
        <div id="detailTocWrap" class="detail-toc-wrap" hidden>
          <button id="detailTocToggle" type="button" class="detail-toc-toggle" aria-expanded="false">目录</button>
          <aside id="detailToc" class="detail-toc" hidden><div class="detail-toc-title">目录</div><nav id="detailTocList" class="detail-toc-list" aria-label="内容目录"></nav></aside>
        </div>
        <div id="detailDoc" class="detail-doc markdown-body">${renderMarkdown(extractMarkdownSection(item.processedDocument || "", "## AI Organized Content"))}</div>
      </div>`;
  } else if (isStream) {
    body = `<div class="msg-summary">${comments.length} 条消息，最新的在最上面${metadata.coverage?.gap ? `；<span class="warn-text">中间可能缺少部分历史</span>` : ""}</div>
      <div id="detailDoc" class="timeline">${renderMessageTimeline(comments, { since, limit: state.detailModeFor.limit || state.readerMessageLimit })}</div>`;
  } else {
    const rawDocument = cleanRawBody(extractMarkdownSection(item.document, "## Content"), metadata.title);
    const main = comments.length ? stripCommentSections(rawDocument) : rawDocument;
    body = `<div id="detailDoc" class="detail-doc markdown-body">${renderMarkdown(main)}</div>
      ${comments.length ? `<section class="comments-block"><h2>评论 <span class="count">${comments.length}</span><small>最新的在最上面</small></h2><div class="timeline">${renderMessageTimeline(comments, { since, limit: state.detailModeFor.limit || state.readerMessageLimit, kind: "评论" })}</div></section>` : ""}`;
  }

  detailPanel.innerHTML = `
    <header class="reader-head">
      <div class="reader-source">
        ${sourceMark(source)}<span>${escapeHtml(sourceLabel(source))}</span>
        ${metadata.url ? `<a href="${escapeHtml(metadata.url)}" target="_blank" rel="noopener noreferrer">打开原页面</a>` : ""}
      </div>
      <div class="reader-title-row">
        <input id="detailTitleInput" class="reader-title" value="${escapeHtml(metadata.title)}" aria-label="标题" />
        <button id="saveTitleButton" type="button" class="primary-button" hidden>保存标题</button>
      </div>
      <dl class="reader-meta">
        <div><dt>更新</dt><dd>${escapeHtml(relativeTime(itemActivityTime(metadata)))}</dd></div>
        ${metadata.lastFetchedAt ? `<div><dt>抓取</dt><dd>${escapeHtml(relativeTime(metadata.lastFetchedAt))}${metadata.captureMethod ? `（${escapeHtml(captureMethodLabel(metadata.captureMethod))}）` : ""}</dd></div>` : ""}
        <div><dt>整理</dt><dd>${hasProcessed ? `${escapeHtml(relativeTime(metadata.processedAt))}${stale ? `<span class="flag">待更新</span>` : ""}` : "还没有整理"}</dd></div>
        <div class="reader-tags"><dt>标签</dt><dd>${tags.length ? tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : `<span class="muted">无</span>`}<button id="editTagsButton" type="button" class="quiet-button">编辑</button></dd></div>
      </dl>
      <div class="reader-toolbar">
        <div class="segmented" role="tablist" aria-label="显示内容">
          <button id="showRawButton" type="button" role="tab" aria-selected="${mode === "raw"}" class="${mode === "raw" ? "is-active" : ""}">${rawLabel}</button>
          <button id="showProcessedButton" type="button" role="tab" aria-selected="${mode === "processed"}" class="${mode === "processed" ? "is-active" : ""}" ${hasProcessed ? "" : "disabled"}>整理版${hasProcessed && stale ? `<span class="tab-flag">待更新</span>` : ""}</button>
        </div>
        <div class="toolbar-spacer"></div>
        ${metadata.url ? `<button id="refreshButton" type="button">检查更新</button>` : ""}
        <button id="processItemButton" type="button" ${quarantined ? "disabled" : ""}>${escapeHtml(processLabel)}</button>
        <details class="menu">
          <summary class="icon-button" aria-label="更多操作">⋯</summary>
          <div class="menu-panel">
            <button id="diffItemButton" type="button">对比上次的变化</button>
            <button id="generateTitleButton" type="button" ${quarantined ? "disabled" : ""}>用 AI 生成标题</button>
            ${hasProcessed ? `<button id="fullProcessButton" type="button" ${quarantined ? "disabled" : ""}>完整重新整理</button>` : ""}
            <button id="deleteItemButton" type="button" class="danger-button">删除这条资料</button>
          </div>
        </details>
      </div>
    </header>
    <div class="reader-banners">${banners.join("")}${coverage}</div>
    <section id="detailDiff" class="detail-diff" hidden></section>
    <div class="reader-body">${body}</div>
  `;
  if (mode === "processed") setupDetailToc();
  bindReaderEvents(item, { mode });
}

function bindReaderEvents(item, { mode }) {
  const metadata = item.metadata;
  const setMode = (next) => {
    state.detailModeFor = { ...state.detailModeFor, id: metadata.id, mode: next };
    state.detailMode = next;
    localStorage.setItem("materialOrganizer.detailMode", next);
    renderDetail(item);
  };
  document.querySelector("#showRawButton")?.addEventListener("click", () => setMode("raw"));
  document.querySelector("#showProcessedButton")?.addEventListener("click", () => setMode("processed"));
  detailPanel.querySelectorAll("[data-show-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.showMode)));
  detailPanel.querySelector("[data-more-messages]")?.addEventListener("click", () => {
    state.detailModeFor.limit = (state.detailModeFor.limit || state.readerMessageLimit) + 300;
    renderDetail(item);
  });

  const titleInput = document.querySelector("#detailTitleInput");
  const saveTitleButton = document.querySelector("#saveTitleButton");
  titleInput?.addEventListener("input", () => { saveTitleButton.hidden = titleInput.value.trim() === metadata.title; });
  titleInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") saveTitleButton.click(); });
  saveTitleButton?.addEventListener("click", async () => {
    saveTitleButton.disabled = true;
    try {
      const { item: next } = await api(`/api/items/${encodeURIComponent(metadata.id)}/title`, { method: "PATCH", body: JSON.stringify({ title: titleInput.value }) });
      notify("标题已保存", next.metadata.title);
      renderDetail(next);
      await loadItems();
    } catch (error) {
      notify("没能保存标题", error.message, "error");
      saveTitleButton.disabled = false;
    }
  });

  document.querySelector("#acknowledgeUpdateButton")?.addEventListener("click", async () => {
    const next = await acknowledgeSelectedItemUpdate(metadata.id);
    if (state.selectedId === metadata.id) renderDetail(next || item);
  });

  const runProcess = async (button, full = false) => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "整理中……";
    try {
      const { item: next } = await api(`/api/items/${encodeURIComponent(metadata.id)}/process`, { method: "POST", body: JSON.stringify({ full }) });
      state.detailModeFor = { id: metadata.id, mode: "processed", limit: state.readerMessageLimit };
      renderDetail(next);
      await loadLibraryIndex();
      await loadItems();
      notify(next.metadata.processedMode === "incremental" ? "已把新增内容合并进整理版" : "整理版已更新", next.metadata.title);
    } catch (error) {
      notify("整理没有完成", error.message, "error");
      button.disabled = false;
      button.textContent = original;
    }
  };
  document.querySelector("#processItemButton")?.addEventListener("click", (event) => runProcess(event.currentTarget));
  detailPanel.querySelectorAll("[data-banner-process]").forEach((button) => button.addEventListener("click", () => runProcess(button)));
  document.querySelector("#fullProcessButton")?.addEventListener("click", (event) => runProcess(event.currentTarget, true));

  document.querySelector("#generateTitleButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { item: next } = await api(`/api/items/${encodeURIComponent(metadata.id)}/recommend-title`, { method: "POST" });
      renderDetail(next);
      await loadItems();
    } catch (error) {
      notify("没能生成标题", error.message, "error");
      button.disabled = false;
    }
  });
  document.querySelector("#editTagsButton")?.addEventListener("click", () => openTagDialog(item));
  document.querySelector("#refreshButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "检查中……";
    try {
      const payload = await api(`/api/items/${encodeURIComponent(metadata.id)}/refresh`, { method: "POST" });
      if (payload.run) await monitorSubscriptionRefreshRun(payload.run, `正在检查 ${metadata.title}`);
      await loadLibraryIndex();
      await loadItems();
      await selectItem(metadata.id);
    } catch (error) {
      notify("检查更新失败", error.message, "error");
      button.disabled = false;
      button.textContent = "检查更新";
    }
  });
  document.querySelector("#diffItemButton")?.addEventListener("click", async () => {
    const panel = document.querySelector("#detailDiff");
    try {
      const { diff } = await api(`/api/items/${encodeURIComponent(metadata.id)}/diff`);
      panel.hidden = false;
      panel.innerHTML = `<div class="detail-diff-header"><strong>和上一个版本相比</strong><span>新增 ${escapeHtml(diff.addedLines)} 行，删除 ${escapeHtml(diff.removedLines)} 行${diff.truncated ? "（已截断）" : ""}</span><button type="button" class="quiet-button" data-close-diff>关闭</button></div><pre>${escapeHtml(diff.text || "没有变化")}</pre>`;
      panel.querySelector("[data-close-diff]").addEventListener("click", () => { panel.hidden = true; });
      panel.scrollIntoView({ block: "nearest" });
    } catch (error) {
      notify("没能读取变化", error.message, "error");
    }
  });
  document.querySelector("#deleteItemButton")?.addEventListener("click", async () => {
    if (!confirm(`删除“${metadata.title}”？正文、原始文件、评论和历史快照都会删除，无法恢复。`)) return;
    try {
      await api(`/api/items/${encodeURIComponent(metadata.id)}`, { method: "DELETE" });
      state.selectedId = null;
      detailPanel.innerHTML = `<div class="empty-state">资料已删除。</div>`;
      await loadAll();
    } catch (error) {
      notify("没能删除", error.message, "error");
    }
  });
}

async function acknowledgeSelectedItemUpdate(id) {
  try {
    const { item } = await api(`/api/items/${encodeURIComponent(id)}/ack-update`, { method: "POST" });
    for (const list of [state.items, state.allItems]) {
      const index = (list || []).findIndex((candidate) => candidate.id === id);
      if (index !== -1) list[index] = { ...list[index], contentUpdatedAt: "", pendingContentUpdatedAt: "", updateAcknowledgedAt: item.metadata.updateAcknowledgedAt || "" };
    }
    state.updateCount = (state.allItems || []).filter(isNewContentItem).length;
    renderItems();
    renderLibraryFacets();
    renderMaterialsNewBadge();
    return item;
  } catch (error) {
    console.warn("Failed to acknowledge item update:", error);
    return null;
  }
}

function notify(title, message = "", tone = "info") {
  showToast({ title, message, duration: tone === "error" ? 14000 : 5000, tone });
}

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

function collectRefreshJobs() {
  return (state.refreshJobs || []).map((job) => ({ ...job, tags: job.tags || [] }));
}

function refreshJobsForCurrentTab() {
  return (state.refreshJobs || []).filter((job) => job.enabled && subscriptionMatchesFilters(job));
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
      <span role="cell" class="subs-items">${items.length}${unread ? `<span class="pill" data-status="accent">${unread} 新</span>` : ""}</span>
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

async function updateSubscription(id, patch, { quiet = false } = {}) {
  const next = (state.refreshJobs || []).map((job) => job.id === id ? { ...job, ...patch } : job);
  try {
    const { settings } = await api("/api/settings", { method: "PATCH", body: JSON.stringify({ refreshJobs: next.map((job) => ({ ...job, tags: job.tags || [] })) }) });
    state.settings = { ...(state.settings || {}), refreshJobs: settings.refreshJobs };
    renderRefreshJobs(settings.refreshJobs || next);
    if (!quiet) refreshJobStatus.textContent = patch.enabled === false ? "已暂停自动刷新。" : patch.enabled === true ? "已恢复自动刷新。" : "订阅已保存。";
    return true;
  } catch (error) {
    refreshJobStatus.textContent = `没能保存：${error.message}`;
    renderRefreshJobs(state.refreshJobs);
    return false;
  }
}

async function saveSubscriptions() {
  return updateSubscription("", {}, { quiet: false });
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
      ${job.lastResult && !job.lastError ? `<p class="muted">检查了 ${escapeHtml(result.linkCount ?? result.issueCount ?? 0)} 个页面，更新 ${escapeHtml(result.updatedItemCount ?? result.updatedIssueCount ?? 0)} 个，新增 ${escapeHtml(result.newItemCount || 0)} 个。</p>` : ""}
      ${job.quarantined ? `<p class="error-text">${escapeHtml(job.quarantineReason || "需要手动刷新一次验证后才能恢复自动刷新。")}</p>` : ""}
    </section>
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

// Startup runs last so every declaration above is initialized.
await loadAgentConfig();
await loadSettings();
startRefreshJobMonitor();
await loadMaterialUpdateCount();
await loadHomeOverview();
await loadChatSessions();
renderView();
